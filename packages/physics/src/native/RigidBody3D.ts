import type { Object3D } from "three";
import type { RigidBody3DOptions, RigidBodyType } from "../RigidBody3D.js";
import { physicsBodyHandle, physicsColliderHandle } from "../handles.js";
import type { PhysicsBodyHandle, PhysicsColliderHandle } from "../handles.js";
import type { CollisionShape3D } from "./CollisionShape3D.js";
import { nativeSimulation } from "./host.js";
import type { NativeSimulation } from "./host.js";

export class RigidBody3D {
  readonly body: PhysicsBodyHandle;
  readonly collider: PhysicsColliderHandle;
  readonly object: Object3D;
  readonly type: RigidBodyType;
  readonly #simulation: NativeSimulation;
  readonly #physics: RigidBody3DOptions["physics"];
  #disposed = false;

  constructor(options: Omit<RigidBody3DOptions, "shape"> & { readonly shape: CollisionShape3D }) {
    const world = options.world ?? options.physics?.world;
    if (world === undefined) throw new Error("RigidBody3D requires a physics context or world.");
    this.#simulation = nativeSimulation(
      typeof world === "object" && world !== null && "raw" in world ? world.raw : world,
    );
    this.#physics = options.physics;
    this.object = options.object;
    this.type = options.type ?? "dynamic";
    const shape = options.shape.raw;
    const id = this.#simulation.createBody({
      collisionLayer: options.collisionLayer ?? shape.collisionLayer,
      collisionMask: options.collisionMask ?? shape.collisionMask,
      mass: options.mass ?? 0,
      position: this.object.position,
      rotation: this.object.quaternion,
      sensor: false,
      shape,
      type: this.type,
    });
    const raw = { backend: "native", id } as const;
    this.body = physicsBodyHandle(id, raw);
    this.collider = physicsColliderHandle(id, raw);
    this.#physics?.add(this as never);
  }

  syncToPhysics(): void {}

  syncFromPhysics(): void {}

  applyTransform(values: Readonly<Float32Array>, offset: number): void {
    this.object.position.set(
      values[offset + 1] ?? 0,
      values[offset + 2] ?? 0,
      values[offset + 3] ?? 0,
    );
    this.object.quaternion.set(
      values[offset + 4] ?? 0,
      values[offset + 5] ?? 0,
      values[offset + 6] ?? 0,
      values[offset + 7] ?? 1,
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#physics?.remove(this as never);
    this.#simulation.removeBody(this.body.id);
  }
}
