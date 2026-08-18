import type { Object3D, Vector3 } from "three";
import { resolveInitialTransform } from "./Area3D.js";
import type { CollisionShape3D } from "./CollisionShape3D.js";
import { interactionGroups } from "./collision.js";
import type { IPhysicsBodyHandle, IPhysicsColliderHandle, IPhysicsWorldHandle } from "./handles.js";
import type { IPhysicsContext } from "./plugin.js";
import { type IPhysicsSimulation, requirePhysicsSimulation } from "./simulation.js";

export type RigidBodyType = "dynamic" | "fixed" | "kinematic";

export interface IRigidBody3DOptions {
  /** The transform this body drives. Omit for a fixed collider with no visual; supply `position`. */
  readonly object?: Object3D;
  /** Initial world position. Only for a fixed body with no `object`. */
  readonly position?: Pick<Vector3, "x" | "y" | "z">;
  readonly entity?: string;
  readonly physics?: IPhysicsContext;
  /** @deprecated Prefer `physics`; a raw web world is backend-specific. */
  readonly world?: IPhysicsWorldHandle | unknown;
  readonly shape: CollisionShape3D;
  readonly mass?: number;
  readonly type?: RigidBodyType;
  /** Godot's collision_layer — which layers this body occupies. Default 1. */
  readonly collisionLayer?: number;
  /** Godot's collision_mask — which layers this body scans. Default 0xffff. */
  readonly collisionMask?: number;
}

type TransformRecord = [number, number, number, number, number, number, number, number];

function finiteTransform(values: Readonly<Float32Array>, offset: number): TransformRecord {
  const result = Array.from({ length: 8 }, (_, index) => values[offset + index]);
  if (result.some((value) => value === undefined || !Number.isFinite(value)))
    throw new Error("IPhysicsSimulation returned a malformed transform.");
  return result as TransformRecord;
}

export class RigidBody3D {
  readonly body: IPhysicsBodyHandle;
  readonly collider: IPhysicsColliderHandle;
  /** The supplied transform; position-only fixed bodies have no runtime object. */
  readonly object: Object3D | undefined;
  readonly type: RigidBodyType;
  readonly #simulation: IPhysicsSimulation;
  readonly #physics: IPhysicsContext | undefined;
  readonly #object: Object3D | undefined;
  #lastPosition: { x: number; y: number; z: number };
  #disposed = false;

  constructor(options: IRigidBody3DOptions) {
    const initial = resolveInitialTransform(options);
    const type = options.type ?? "dynamic";
    if (options.object === undefined && type !== "fixed")
      throw new Error("RigidBody3D position-only bodies must be fixed.");
    this.#simulation = requirePhysicsSimulation(options.physics, options.world);
    this.#physics = options.physics;
    this.object = options.object;
    this.#object = options.object;
    this.type = type;
    const shape = options.shape.descriptor;
    if (options.collisionLayer !== undefined || options.collisionMask !== undefined) {
      const layer = options.collisionLayer ?? shape.collisionLayer;
      const mask = options.collisionMask ?? shape.collisionMask;
      options.shape.setCollisionGroups(interactionGroups(layer, mask));
    }
    const registration = this.#simulation.createBody({
      entity: options.entity,
      mass: options.mass ?? 0,
      position: initial.position,
      rotation: initial.rotation,
      sensor: shape.sensor,
      shape,
      type: this.type,
    });
    options.shape.bindRaw(registration.rawShape);
    this.body = registration.body;
    this.collider = registration.collider;
    this.#lastPosition = {
      x: initial.position.x,
      y: initial.position.y,
      z: initial.position.z,
    };
    this.#physics?.add(this);
  }

  /** Called by the shared plugin before a bulk step. */
  writeKinematic(buffer: Float32Array, offset: number): void {
    const object = this.#object;
    if (this.#disposed || object === undefined) return;
    buffer.set(
      [
        this.body.id,
        object.position.x,
        object.position.y,
        object.position.z,
        object.quaternion.x,
        object.quaternion.y,
        object.quaternion.z,
        object.quaternion.w,
      ],
      offset,
    );
  }

  /** Displacement since the last backend transform, used for moving-platform carry. */
  kinematicMotion(): { readonly x: number; readonly y: number; readonly z: number } {
    const object = this.#object;
    if (object === undefined) return { x: 0, y: 0, z: 0 };
    return {
      x: object.position.x - this.#lastPosition.x,
      y: object.position.y - this.#lastPosition.y,
      z: object.position.z - this.#lastPosition.z,
    };
  }

  syncToPhysics(): void {
    // The plugin collects this object's transform into the reusable bulk input buffer.
  }

  /**
   * Godot's `apply_impulse`. The one-shot shove: a thrown crate, a jump pad, a hit reaction.
   *
   * These four members exist because there is otherwise no portable way to move a dynamic body
   * at all. `body.raw` is a Rapier object on web and opaque on native, so reaching through it
   * forks the game by platform, and a transform write is discarded by the next step.
   */
  applyImpulse(impulse: { readonly x: number; readonly y: number; readonly z: number }): void {
    this.#requireLive("applyImpulse");
    this.#simulation.applyBodyImpulse(this.body.id, impulse);
  }

  /** Godot's `apply_force`. Continuous push; cleared by the backend each step. */
  applyForce(force: { readonly x: number; readonly y: number; readonly z: number }): void {
    this.#requireLive("applyForce");
    this.#simulation.applyBodyForce(this.body.id, force);
  }

  /** Godot's `linear_velocity`. */
  get linearVelocity(): { readonly x: number; readonly y: number; readonly z: number } {
    this.#requireLive("linearVelocity");
    return this.#simulation.readBodyLinearVelocity(this.body.id);
  }

  set linearVelocity(velocity: { readonly x: number; readonly y: number; readonly z: number }) {
    this.#requireLive("linearVelocity");
    this.#simulation.setBodyLinearVelocity(this.body.id, velocity);
  }

  #requireLive(operation: string): void {
    if (this.#disposed) throw new Error(`RigidBody3D.${operation} cannot be used after dispose.`);
  }

  syncFromPhysics(): void {
    const transform = this.#simulation.readBodyTransform?.(this.body.id);
    const object = this.#object;
    if (transform === undefined || object === undefined) return;
    object.position.set(transform.position.x, transform.position.y, transform.position.z);
    object.quaternion.set(
      transform.rotation.x,
      transform.rotation.y,
      transform.rotation.z,
      transform.rotation.w,
    );
    this.#lastPosition = { ...transform.position };
  }

  applyTransform(values: Readonly<Float32Array>, offset: number): void {
    const [, x, y, z, qx, qy, qz, qw] = finiteTransform(values, offset);
    const object = this.#object;
    if (object === undefined) return;
    object.position.set(x, y, z);
    object.quaternion.set(qx, qy, qz, qw);
    this.#lastPosition = { x, y, z };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#physics?.remove(this);
    this.#simulation.removeBody(this.body.id);
  }
}
