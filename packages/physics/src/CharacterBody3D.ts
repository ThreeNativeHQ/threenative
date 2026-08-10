import type { Object3D, Vector3 } from "three";
import type { CollisionShape3D } from "./CollisionShape3D.js";
import { interactionGroups } from "./collision.js";
import type {
  PhysicsBodyHandle,
  PhysicsColliderHandle,
  PhysicsHandle,
  PhysicsWorldHandle,
} from "./handles.js";
import type { PhysicsContext } from "./plugin.js";
import {
  type PhysicsCharacterOptions,
  type PhysicsSimulation,
  requirePhysicsSimulation,
} from "./simulation.js";

export interface CharacterBody3DOptions {
  readonly object: Object3D;
  readonly physics?: PhysicsContext;
  /** @deprecated Prefer `physics`; a raw web world is backend-specific. */
  readonly world?: PhysicsWorldHandle | unknown;
  readonly shape: CollisionShape3D;
  readonly offset?: number;
  readonly maxSlopeClimbAngle?: number;
  readonly autostep?: {
    readonly maxHeight: number;
    readonly minWidth: number;
    readonly includeDynamicBodies?: boolean;
  };
  readonly snapToGround?: number;
  readonly gravity?: number;
  readonly maxFallSpeed?: number;
  /** Godot's collision_layer — which layers this body occupies. Default 1. */
  readonly collisionLayer?: number;
  /** Godot's collision_mask — which layers this body scans. Default 0xffff. */
  readonly collisionMask?: number;
  /** Collider layer bits to ignore while moving upward. */
  readonly oneWayLayers?: number;
}

type TransformRecord = [number, number, number, number, number, number, number, number];

function finiteTransform(values: Readonly<Float32Array>, offset: number): TransformRecord {
  const result = Array.from({ length: 8 }, (_, index) => values[offset + index]);
  if (result.some((value) => value === undefined || !Number.isFinite(value)))
    throw new Error("PhysicsSimulation returned a malformed transform.");
  return result as TransformRecord;
}

export class CharacterBody3D {
  readonly body: PhysicsBodyHandle;
  readonly collider: PhysicsColliderHandle;
  readonly controller: PhysicsHandle;
  readonly object: Object3D;
  readonly velocity: Vector3;
  gravity: number;
  maxFallSpeed: number;
  readonly oneWayLayers: number;
  grounded = false;
  readonly #simulation: PhysicsSimulation;
  readonly #physics: PhysicsContext | undefined;
  #desired = { x: 0, y: 0, z: 0 };
  #sliding = false;
  #groundCollider: number | undefined;
  #beforeY = 0;
  #desiredY = 0;
  #disposed = false;

  constructor(options: CharacterBody3DOptions) {
    this.#simulation = requirePhysicsSimulation(options.physics, options.world);
    this.#physics = options.physics;
    this.object = options.object;
    this.velocity = this.object.position.clone().set(0, 0, 0);
    this.gravity = options.gravity ?? -9.81;
    this.maxFallSpeed = options.maxFallSpeed ?? 50;
    this.oneWayLayers = options.oneWayLayers ?? 0;
    const shape = options.shape.descriptor;
    if (options.collisionLayer !== undefined || options.collisionMask !== undefined) {
      const layer = options.collisionLayer ?? shape.collisionLayer;
      const mask = options.collisionMask ?? shape.collisionMask;
      options.shape.setCollisionGroups(interactionGroups(layer, mask));
    }
    const registration = this.#simulation.createBody({
      mass: 0,
      position: this.object.position,
      rotation: this.object.quaternion,
      sensor: shape.sensor,
      shape,
      type: "character",
    });
    if (registration.controller === undefined) {
      this.#simulation.removeBody(registration.body.id);
      throw new Error("Physics character backend did not provide a controller handle.");
    }
    options.shape.bindRaw(registration.rawShape);
    this.body = registration.body;
    this.collider = registration.collider;
    this.controller = registration.controller;
    const characterOptions: PhysicsCharacterOptions = {
      autostep:
        options.autostep === undefined
          ? undefined
          : {
              includeDynamicBodies: options.autostep.includeDynamicBodies ?? false,
              maxHeight: options.autostep.maxHeight,
              minWidth: options.autostep.minWidth,
            },
      maxSlopeClimbAngle: options.maxSlopeClimbAngle ?? Math.PI / 4,
      offset: options.offset ?? 0.01,
      oneWayLayers: this.oneWayLayers,
      snapToGround: options.snapToGround,
    };
    try {
      this.#simulation.configureCharacter(this.body.id, characterOptions);
    } catch (error) {
      this.#simulation.removeBody(this.body.id);
      throw error;
    }
    this.#physics?.add(this);
  }

  move(desiredTranslation: Pick<Vector3, "x" | "y" | "z">): void {
    this.#desired = { x: desiredTranslation.x, y: desiredTranslation.y, z: desiredTranslation.z };
    this.#sliding = false;
  }

  moveAndSlide(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0)
      throw new Error("CharacterBody3D.moveAndSlide requires a finite non-negative dt.");
    this.velocity.y = Math.max(this.velocity.y + this.gravity * dt, -this.maxFallSpeed);
    this.#desired = {
      x: this.velocity.x * dt,
      y: this.velocity.y * dt,
      z: this.velocity.z * dt,
    };
    this.#sliding = true;
  }

  /** Called by the shared plugin before a bulk step. */
  writeKinematic(buffer: Float32Array, offset: number): void {
    if (this.#disposed) return;
    this.#beforeY = this.object.position.y;
    this.#desiredY = this.#desired.y;
    const carry =
      this.#sliding && this.grounded && this.velocity.y <= 0 && this.#groundCollider !== undefined
        ? this.#physics?.kinematicMotion?.(this.#groundCollider)
        : undefined;
    buffer.set(
      [
        this.body.id,
        this.object.position.x + this.#desired.x + (carry?.x ?? 0),
        this.object.position.y + this.#desired.y + (carry?.y ?? 0),
        this.object.position.z + this.#desired.z + (carry?.z ?? 0),
        this.object.quaternion.x,
        this.object.quaternion.y,
        this.object.quaternion.z,
        this.object.quaternion.w,
      ],
      offset,
    );
  }

  syncToPhysics(): void {
    // The plugin collects the requested target into the reusable bulk input buffer.
  }

  step(): void {
    // Kept as a public compatibility method; the shared plugin performs the bulk step.
  }

  teleport(position: Pick<Vector3, "x" | "y" | "z">): void {
    if (this.#disposed) throw new Error("CharacterBody3D.teleport cannot be used after dispose.");
    this.#simulation.setBodyTransform(this.body.id, position);
    this.object.position.set(position.x, position.y, position.z);
    this.velocity.set(0, 0, 0);
    this.#desired = { x: 0, y: 0, z: 0 };
    this.#sliding = false;
    this.#groundCollider = undefined;
    this.grounded = false;
  }

  applyTransform(values: Readonly<Float32Array>, offset: number): void {
    const [, x, y, z, qx, qy, qz, qw] = finiteTransform(values, offset);
    const state = this.#simulation.readCharacterState?.(this.body.id);
    this.grounded =
      state?.grounded ??
      (this.#sliding && this.#desiredY < 0 && y - this.#beforeY > this.#desiredY + 0.0001);
    this.#groundCollider = state?.groundCollider;
    if (this.#sliding && this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    this.object.position.set(x, y, z);
    this.object.quaternion.set(qx, qy, qz, qw);
    this.#desired = { x: 0, y: 0, z: 0 };
    this.#sliding = false;
  }

  syncFromPhysics(): void {
    const transform = this.#simulation.readBodyTransform?.(this.body.id);
    if (transform === undefined) return;
    this.object.position.set(transform.position.x, transform.position.y, transform.position.z);
    this.object.quaternion.set(
      transform.rotation.x,
      transform.rotation.y,
      transform.rotation.z,
      transform.rotation.w,
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#physics?.remove(this);
    this.#simulation.removeBody(this.body.id);
  }
}
