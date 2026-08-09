import type { Object3D } from "three";
import type { CollisionShape3D } from "./CollisionShape3D.js";
import { interactionGroups } from "./collision.js";
import {
  type PhysicsBodyHandle,
  type PhysicsColliderHandle,
  type PhysicsWorldHandle,
} from "./handles.js";
import type { PhysicsContext } from "./plugin.js";
import { requirePhysicsSimulation, type PhysicsSimulation } from "./simulation.js";

export type RigidBodyType = "dynamic" | "fixed" | "kinematic";

export interface RigidBody3DOptions {
  readonly object: Object3D;
  readonly physics?: PhysicsContext;
  /** @deprecated Prefer `physics`; a raw web world is backend-specific. */
  readonly world?: PhysicsWorldHandle | unknown;
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
    throw new Error("PhysicsSimulation returned a malformed transform.");
  return result as TransformRecord;
}

export class RigidBody3D {
  readonly body: PhysicsBodyHandle;
  readonly collider: PhysicsColliderHandle;
  readonly object: Object3D;
  readonly type: RigidBodyType;
  readonly #simulation: PhysicsSimulation;
  readonly #physics: PhysicsContext | undefined;
  #lastPosition: { x: number; y: number; z: number };
  #disposed = false;

  constructor(options: RigidBody3DOptions) {
    this.#simulation = requirePhysicsSimulation(options.physics, options.world);
    this.#physics = options.physics;
    this.object = options.object;
    this.type = options.type ?? "dynamic";
    const shape = options.shape.descriptor;
    if (options.collisionLayer !== undefined || options.collisionMask !== undefined) {
      const layer = options.collisionLayer ?? shape.collisionLayer;
      const mask = options.collisionMask ?? shape.collisionMask;
      options.shape.setCollisionGroups(interactionGroups(layer, mask));
    }
    let registration;
    try {
      registration = this.#simulation.createBody({
        mass: options.mass ?? 0,
        position: this.object.position,
        rotation: this.object.quaternion,
        sensor: false,
        shape,
        type: this.type,
      });
    } catch (error) {
      throw error;
    }
    options.shape.bindRaw(registration.rawShape);
    this.body = registration.body;
    this.collider = registration.collider;
    this.#lastPosition = {
      x: this.object.position.x,
      y: this.object.position.y,
      z: this.object.position.z,
    };
    this.#physics?.add(this);
  }

  /** Called by the shared plugin before a bulk step. */
  writeKinematic(buffer: Float32Array, offset: number): void {
    if (this.#disposed) return;
    buffer.set(
      [
        this.body.id,
        this.object.position.x,
        this.object.position.y,
        this.object.position.z,
        this.object.quaternion.x,
        this.object.quaternion.y,
        this.object.quaternion.z,
        this.object.quaternion.w,
      ],
      offset,
    );
  }

  /** Displacement since the last backend transform, used for moving-platform carry. */
  kinematicMotion(): { readonly x: number; readonly y: number; readonly z: number } {
    return {
      x: this.object.position.x - this.#lastPosition.x,
      y: this.object.position.y - this.#lastPosition.y,
      z: this.object.position.z - this.#lastPosition.z,
    };
  }

  syncToPhysics(): void {
    // The plugin collects this object's transform into the reusable bulk input buffer.
  }

  syncFromPhysics(): void {
    const transform = this.#simulation.readBodyTransform?.(this.body.id);
    if (transform === undefined) return;
    this.object.position.set(
      transform.position.x,
      transform.position.y,
      transform.position.z,
    );
    this.object.quaternion.set(
      transform.rotation.x,
      transform.rotation.y,
      transform.rotation.z,
      transform.rotation.w,
    );
    this.#lastPosition = { ...transform.position };
  }

  applyTransform(values: Readonly<Float32Array>, offset: number): void {
    const [, x, y, z, qx, qy, qz, qw] = finiteTransform(values, offset);
    this.object.position.set(x, y, z);
    this.object.quaternion.set(qx, qy, qz, qw);
    this.#lastPosition = { x, y, z };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#physics?.remove(this);
    this.#simulation.removeBody(this.body.id);
  }
}
