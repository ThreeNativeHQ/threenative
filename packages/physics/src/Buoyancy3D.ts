import { Quaternion, Vector3 } from "three";
import type { RigidBody3D } from "./RigidBody3D.js";
import type { IPhysicsContext } from "./plugin.js";

export interface IBuoyancySurfaceSample {
  readonly height: number;
  readonly normal?: { readonly x: number; readonly y: number; readonly z: number };
}

export interface IBuoyancySurface {
  sample(x: number, z: number, time: number): IBuoyancySurfaceSample;
}

export type BuoyancyPointPosition =
  | readonly [number, number, number]
  | { readonly x: number; readonly y: number; readonly z: number };

export interface IBuoyancyHullPoint {
  readonly position: BuoyancyPointPosition;
  readonly volume?: number;
  readonly spacing?: number;
}

export interface IBuoyancy3DOptions {
  readonly body: RigidBody3D;
  readonly hullPoints: readonly IBuoyancyHullPoint[];
  readonly surface?: IBuoyancySurface;
  readonly heightSource?: IBuoyancySurface;
  readonly field?: IBuoyancySurface;
  readonly physics?: IPhysicsContext;
  /** Fluid density in the same units as the body's mass and world gravity. */
  readonly density?: number;
  /** Total displaced volume when points do not carry individual volumes. */
  readonly volume?: number;
  /** Vertical sample span used to turn a hull point into a partial volume. */
  readonly pointSpacing?: number;
  /** Continuous velocity drag for the submerged volume. */
  readonly drag?: number;
  readonly gravity?: number;
  /** Convention switch. Measurement continues when false. */
  readonly buoyancy?: boolean;
}

interface IPointState {
  readonly position: Vector3;
  readonly volume: number;
  readonly spacing: number;
  readonly force: { x: number; y: number; z: number };
  readonly worldPosition: Vector3;
  submergedFraction: number;
}

function finite(name: string, value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`Buoyancy3D.${name} must be finite.`);
  return value;
}

function nonNegative(name: string, value: number): number {
  finite(name, value);
  if (value < 0) throw new Error(`Buoyancy3D.${name} must be non-negative.`);
  return value;
}

function positive(name: string, value: number): number {
  finite(name, value);
  if (value <= 0) throw new Error(`Buoyancy3D.${name} must be positive.`);
  return value;
}

function pointVector(value: BuoyancyPointPosition): Vector3 {
  let x: number;
  let y: number;
  let z: number;
  if ("x" in value) {
    x = value.x;
    y = value.y;
    z = value.z;
  } else {
    x = value[0];
    y = value[1];
    z = value[2];
  }
  return new Vector3(
    finite("hullPoints.position.x", x),
    finite("hullPoints.position.y", y),
    finite("hullPoints.position.z", z),
  );
}

function shapeVolume(body: RigidBody3D): number {
  const shape = body.shape.descriptor;
  if (shape.kind === "box") return 8 * shape.x * shape.y * shape.z;
  if (shape.kind === "sphere") return (4 / 3) * Math.PI * shape.x ** 3;
  if (shape.kind === "capsule") return Math.PI * shape.y ** 2 * (2 * shape.x + (4 / 3) * shape.y);
  return 1;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Applies game-authored displaced-volume forces before the shared physics step. */
export class Buoyancy3D {
  readonly body: RigidBody3D;
  readonly hullPoints: readonly IBuoyancyHullPoint[];
  readonly density: number;
  readonly drag: number;
  readonly gravity: number;
  readonly #surface: IBuoyancySurface;
  readonly #physics: IPhysicsContext;
  readonly #points: readonly IPointState[];
  readonly #rotation = new Quaternion();
  #elapsed = 0;
  #submergedFraction = 0;
  #enabled: boolean;
  #disposed = false;

  constructor(options: IBuoyancy3DOptions) {
    if (options.hullPoints.length === 0)
      throw new Error("Buoyancy3D.hullPoints must contain at least one point.");
    const surface = options.surface ?? options.heightSource ?? options.field;
    if (surface === undefined) throw new Error("Buoyancy3D requires a surface height source.");
    const physics = options.physics ?? options.body.physics;
    if (physics === undefined || physics.addBuoyancy === undefined)
      throw new Error("Buoyancy3D requires the body's physics context.");
    this.body = options.body;
    this.hullPoints = options.hullPoints;
    this.density = positive("density", options.density ?? 1_000);
    this.drag = nonNegative("drag", options.drag ?? 0);
    this.gravity = positive("gravity", options.gravity ?? 9.81);
    this.#surface = surface;
    this.#physics = physics;
    this.#enabled = options.buoyancy ?? true;

    const totalVolume = positive("volume", options.volume ?? shapeVolume(options.body));
    const yValues = options.hullPoints.map(({ position }) => pointVector(position).y);
    const minimumY = Math.min(...yValues);
    const maximumY = Math.max(...yValues);
    const defaultSpacing = options.pointSpacing ?? Math.max(maximumY - minimumY, 1);
    const pointVolume = totalVolume / options.hullPoints.length;
    this.#points = options.hullPoints.map((point) => {
      const position = pointVector(point.position);
      const volume = positive("hullPoints.volume", point.volume ?? pointVolume);
      const spacing = positive("hullPoints.spacing", point.spacing ?? defaultSpacing);
      return {
        force: { x: 0, y: 0, z: 0 },
        position,
        spacing,
        submergedFraction: 0,
        volume,
        worldPosition: new Vector3(),
      };
    });
    this.body.buoyancy = this;
    physics.addBuoyancy(this);
    this.#measure();
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  set enabled(value: boolean) {
    this.#enabled = value;
  }

  get buoyancy(): boolean {
    return this.#enabled;
  }

  set buoyancy(value: boolean) {
    this.#enabled = value;
  }

  get submergedFraction(): number {
    return this.#submergedFraction;
  }

  get time(): number {
    return this.#elapsed;
  }

  /** Called by `rapier()` immediately before its fixed-step backend call. */
  apply(deltaTime: number): void {
    if (this.#disposed) return;
    if (!Number.isFinite(deltaTime) || deltaTime < 0)
      throw new Error("Buoyancy3D.apply requires a finite non-negative deltaTime.");
    this.#measure();
    if (this.#enabled) {
      const velocity = this.body.linearVelocity;
      for (const point of this.#points) {
        const submergedVolume = point.volume * point.submergedFraction;
        if (submergedVolume === 0) continue;
        point.force.x = -velocity.x * this.drag * submergedVolume;
        point.force.y = -velocity.y * this.drag * submergedVolume;
        point.force.z = -velocity.z * this.drag * submergedVolume;
        point.force.y += this.density * this.gravity * submergedVolume;
        this.body.applyForceAtPoint(point.force, point.worldPosition);
      }
    }
    this.#elapsed += deltaTime;
    if (!Number.isFinite(this.#elapsed)) throw new Error("Buoyancy3D time overflowed.");
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#physics.removeBuoyancy?.(this);
    if (this.body.buoyancy === this) this.body.buoyancy = undefined;
  }

  #measure(): void {
    const points = this.#points;
    const object = this.body.object;
    if (object === undefined) throw new Error("Buoyancy3D requires a body with an object.");
    this.#rotation.copy(object.quaternion);
    let volume = 0;
    let submerged = 0;
    for (const point of points) {
      point.worldPosition.copy(point.position).applyQuaternion(this.#rotation).add(object.position);
      const result = this.#surface.sample(
        point.worldPosition.x,
        point.worldPosition.z,
        this.#elapsed,
      );
      const height = finite("surface.height", result.height);
      const fraction = clamp01(0.5 + (height - point.worldPosition.y) / point.spacing);
      point.submergedFraction = fraction;
      volume += point.volume;
      submerged += point.volume * fraction;
    }
    this.#submergedFraction = volume === 0 ? 0 : submerged / volume;
  }
}
