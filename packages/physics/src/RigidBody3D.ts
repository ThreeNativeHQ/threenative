import * as RAPIER from "@dimforge/rapier3d-compat";
import type { Mesh } from "three";
import type { PhysicsContext } from "./plugin.js";

export type RigidBodyType = "dynamic" | "fixed" | "kinematic";

export interface RigidBody3DOptions {
  readonly mesh: Mesh;
  readonly physics?: PhysicsContext;
  readonly world?: RAPIER.World;
  readonly shape: RAPIER.ColliderDesc;
  readonly mass?: number;
  readonly type?: RigidBodyType;
}

function bodyDescription(type: RigidBodyType): RAPIER.RigidBodyDesc {
  if (type === "fixed") return RAPIER.RigidBodyDesc.fixed();
  if (type === "kinematic") return RAPIER.RigidBodyDesc.kinematicPositionBased();
  return RAPIER.RigidBodyDesc.dynamic();
}

export class RigidBody3D {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly mesh: Mesh;
  readonly type: RigidBodyType;
  #world: RAPIER.World;
  #physics: PhysicsContext | undefined;
  #disposed = false;

  constructor(options: RigidBody3DOptions) {
    const world = options.world ?? options.physics?.world;
    if (world === undefined) throw new Error("RigidBody3D requires a physics context or world.");
    this.#world = world;
    this.#physics = options.physics;
    this.mesh = options.mesh;
    this.type = options.type ?? "dynamic";
    const description = bodyDescription(this.type)
      .setTranslation(this.mesh.position.x, this.mesh.position.y, this.mesh.position.z)
      .setRotation({
        x: this.mesh.quaternion.x,
        y: this.mesh.quaternion.y,
        z: this.mesh.quaternion.z,
        w: this.mesh.quaternion.w,
      });
    if (options.mass !== undefined) description.setAdditionalMass(options.mass);
    this.body = world.createRigidBody(description);
    this.body.userData = this;
    this.collider = world.createCollider(options.shape, this.body);
    this.syncFromPhysics();
    this.#physics?.add(this);
  }

  syncToPhysics(): void {
    if (!this.body.isValid() || !this.body.isKinematic()) return;
    this.body.setNextKinematicTranslation({
      x: this.mesh.position.x,
      y: this.mesh.position.y,
      z: this.mesh.position.z,
    });
    this.body.setNextKinematicRotation({
      x: this.mesh.quaternion.x,
      y: this.mesh.quaternion.y,
      z: this.mesh.quaternion.z,
      w: this.mesh.quaternion.w,
    });
  }

  syncFromPhysics(): void {
    if (!this.body.isValid()) return;
    const translation = this.body.translation();
    const rotation = this.body.rotation();
    this.mesh.position.set(translation.x, translation.y, translation.z);
    this.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#physics?.remove(this);
    if (this.body.isValid()) this.#world.removeRigidBody(this.body);
  }
}
