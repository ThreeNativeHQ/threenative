import type { Vector3 } from "three";
import type { CollisionShape3D } from "./CollisionShape3D.js";
import { interactionGroups } from "./collision.js";
import type { PhysicsBodyHandle, PhysicsColliderHandle, PhysicsWorldHandle } from "./handles.js";
import type { PhysicsBody3D, PhysicsContext } from "./plugin.js";
import { type PhysicsSimulation, requirePhysicsSimulation } from "./simulation.js";

export type AreaEvent = "bodyEntered" | "bodyExited";
export type AreaHandler = (body: PhysicsBody3D) => void;
const MAX_CONTACT_LOG = 1_000;

export interface AreaContact {
  readonly area: Area3D;
  readonly body: PhysicsBody3D;
  readonly entity?: string;
  readonly started: boolean;
}

export interface Area3DOptions {
  readonly entity?: string;
  readonly physics?: PhysicsContext;
  /** @deprecated Prefer `physics`; a raw web world is backend-specific. */
  readonly world?: PhysicsWorldHandle | unknown;
  readonly shape: CollisionShape3D;
  readonly position?: Pick<Vector3, "x" | "y" | "z">;
  /** Godot's collision_layer — which layers this area occupies. Default 1. */
  readonly collisionLayer?: number;
  /** Godot's collision_mask — which layers this area scans. Default 0xffff. */
  readonly collisionMask?: number;
}

type TransformRecord = [number, number, number, number, number, number, number, number];

function finiteTransform(values: Readonly<Float32Array>, offset: number): TransformRecord {
  const result = Array.from({ length: 8 }, (_, index) => values[offset + index]);
  if (result.some((value) => value === undefined || !Number.isFinite(value)))
    throw new Error("PhysicsSimulation returned a malformed transform.");
  return result as TransformRecord;
}

export class Area3D {
  readonly entity: string | undefined;
  readonly body: PhysicsBodyHandle;
  readonly collider: PhysicsColliderHandle;
  readonly #simulation: PhysicsSimulation;
  readonly #physics: PhysicsContext | undefined;
  readonly #position = { x: 0, y: 0, z: 0 };
  #entered = new Map<number, PhysicsBody3D>();
  #contacts: AreaContact[] = [];
  #monitoring = true;
  #listeners: Record<AreaEvent, Set<AreaHandler>> = {
    bodyEntered: new Set(),
    bodyExited: new Set(),
  };
  #disposed = false;

  constructor(options: Area3DOptions) {
    this.#simulation = requirePhysicsSimulation(options.physics, options.world);
    this.#physics = options.physics;
    this.entity = options.entity;
    Object.assign(this.#position, options.position ?? { x: 0, y: 0, z: 0 });
    const shape = options.shape.setSensor(true).descriptor;
    if (options.collisionLayer !== undefined || options.collisionMask !== undefined) {
      const layer = options.collisionLayer ?? shape.collisionLayer;
      const mask = options.collisionMask ?? shape.collisionMask;
      options.shape.setCollisionGroups(interactionGroups(layer, mask));
    }
    const registration = this.#simulation.createBody({
      mass: 0,
      position: this.#position,
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      sensor: true,
      shape,
      type: "kinematic",
    });
    options.shape.bindRaw(registration.rawShape);
    this.body = registration.body;
    this.collider = registration.collider;
    this.#physics?.addArea(this);
  }

  on(event: AreaEvent, handler: AreaHandler): () => void {
    this.#listeners[event].add(handler);
    return () => this.#listeners[event].delete(handler);
  }

  /** Mirrors Godot's Area3D.monitoring. When false the area reports no contacts. */
  get monitoring(): boolean {
    return this.#monitoring;
  }

  set monitoring(value: boolean) {
    if (this.#monitoring === value) return;
    this.#monitoring = value;
    if (!value) this.#entered.clear();
  }

  setPosition(position: Pick<Vector3, "x" | "y" | "z">): void {
    if (!this.#disposed) {
      Object.assign(this.#position, position);
      this.#simulation.setBodyTransform(this.body.id, position);
    }
  }

  /** Called by the shared plugin before a bulk step. */
  writeKinematic(buffer: Float32Array, offset: number): void {
    if (this.#disposed) return;
    buffer.set(
      [this.body.id, this.#position.x, this.#position.y, this.#position.z, 0, 0, 0, 1],
      offset,
    );
  }

  applyTransform(values: Readonly<Float32Array>, offset: number): void {
    const [, x, y, z] = finiteTransform(values, offset);
    Object.assign(this.#position, { x, y, z });
  }

  handleCollision(body: PhysicsBody3D, started: boolean): void {
    if (this.#disposed || !this.#monitoring) return;
    const handle = body.body.id;
    if (started) {
      if (this.#entered.has(handle)) return;
      this.#entered.set(handle, body);
      this.#contacts.push({ area: this, body, entity: this.entity, started: true });
      if (this.#contacts.length > MAX_CONTACT_LOG) this.#contacts.shift();
      for (const handler of this.#listeners.bodyEntered) handler(body);
      return;
    }
    const entered = this.#entered.get(handle);
    if (entered === undefined) return;
    this.#entered.delete(handle);
    this.#contacts.push({ area: this, body: entered, entity: this.entity, started: false });
    if (this.#contacts.length > MAX_CONTACT_LOG) this.#contacts.shift();
    for (const handler of this.#listeners.bodyExited) handler(entered);
  }

  drainContacts(): AreaContact[] {
    const contacts = this.#contacts;
    this.#contacts = [];
    return contacts;
  }

  reconcileIntersections(current: ReadonlyMap<number, PhysicsBody3D>): void {
    for (const body of current.values()) this.handleCollision(body, true);
    for (const [handle, body] of this.#entered) {
      if (!current.has(handle)) this.handleCollision(body, false);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#physics?.removeArea(this);
    this.#simulation.removeBody(this.body.id);
    this.#entered.clear();
    this.#listeners.bodyEntered.clear();
    this.#listeners.bodyExited.clear();
  }
}
