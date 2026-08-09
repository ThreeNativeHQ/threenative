import type { Object3D, Vector3 } from "three";
import type { CharacterBody3DOptions } from "../CharacterBody3D.js";
import { physicsBodyHandle, physicsColliderHandle, physicsHandle } from "../handles.js";
import type { PhysicsBodyHandle, PhysicsColliderHandle, PhysicsHandle } from "../handles.js";
import type { CollisionShape3D } from "./CollisionShape3D.js";
import { nativeSimulation } from "./host.js";
import type { NativeSimulation } from "./host.js";

export class CharacterBody3D {
  readonly body: PhysicsBodyHandle;
  readonly collider: PhysicsColliderHandle;
  readonly controller: PhysicsHandle;
  readonly object: Object3D;
  readonly velocity: Vector3;
  readonly oneWayLayers: number;
  gravity: number;
  maxFallSpeed: number;
  grounded = false;
  readonly #simulation: NativeSimulation;
  readonly #physics: CharacterBody3DOptions["physics"];
  #desired = { x: 0, y: 0, z: 0 };
  #sliding = false;
  #disposed = false;
  #beforeY = 0;
  #desiredY = 0;

  constructor(
    options: Omit<CharacterBody3DOptions, "shape"> & { readonly shape: CollisionShape3D },
  ) {
    const world = options.world ?? options.physics?.world;
    if (world === undefined)
      throw new Error("CharacterBody3D requires a physics context or world.");
    this.#simulation = nativeSimulation(
      typeof world === "object" && world !== null && "raw" in world ? world.raw : world,
    );
    this.#physics = options.physics;
    this.object = options.object;
    this.velocity = this.object.position.clone().set(0, 0, 0);
    this.gravity = options.gravity ?? -9.81;
    this.maxFallSpeed = options.maxFallSpeed ?? 50;
    this.oneWayLayers = options.oneWayLayers ?? 0;
    const shape = options.shape.raw;
    const id = this.#simulation.createBody({
      collisionLayer: options.collisionLayer ?? shape.collisionLayer,
      collisionMask: options.collisionMask ?? shape.collisionMask,
      mass: 0,
      position: this.object.position,
      rotation: this.object.quaternion,
      sensor: false,
      shape,
      type: "character",
    });
    const raw = { backend: "native", id } as const;
    this.body = physicsBodyHandle(id, raw);
    this.collider = physicsColliderHandle(id, raw);
    this.controller = physicsHandle(raw);
    this.#physics?.add(this as never);
  }

  move(desiredTranslation: Pick<Vector3, "x" | "y" | "z">): void {
    this.#desired = { ...desiredTranslation };
    this.#sliding = false;
  }

  moveAndSlide(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0)
      throw new Error("CharacterBody3D.moveAndSlide requires a finite non-negative dt.");
    this.velocity.y = Math.max(this.velocity.y + this.gravity * dt, -this.maxFallSpeed);
    this.#desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    this.#sliding = true;
  }

  syncToPhysics(): void {}

  prepareStep(): void {
    this.#beforeY = this.object.position.y;
    this.#desiredY = this.#desired.y;
    this.object.position.add(this.#desired as Vector3);
    this.#desired = { x: 0, y: 0, z: 0 };
  }

  applyTransform(values: Readonly<Float32Array>, offset: number): void {
    const y = values[offset + 2] ?? this.object.position.y;
    this.grounded = this.#desiredY < 0 && y - this.#beforeY > this.#desiredY + 0.0001;
    if (this.#sliding && this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    this.#sliding = false;
    this.object.position.set(values[offset + 1] ?? 0, y, values[offset + 3] ?? 0);
    this.object.quaternion.set(
      values[offset + 4] ?? 0,
      values[offset + 5] ?? 0,
      values[offset + 6] ?? 0,
      values[offset + 7] ?? 1,
    );
  }

  teleport(position: Pick<Vector3, "x" | "y" | "z">): void {
    if (this.#disposed) throw new Error("CharacterBody3D.teleport cannot be used after dispose.");
    this.object.position.set(position.x, position.y, position.z);
    this.velocity.set(0, 0, 0);
    this.#desired = { x: 0, y: 0, z: 0 };
    this.grounded = false;
  }

  step(): void {}

  syncFromPhysics(): void {}

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#physics?.remove(this as never);
    this.#simulation.removeBody(this.body.id);
  }
}
