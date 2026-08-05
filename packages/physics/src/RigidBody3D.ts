import * as RAPIER from "@dimforge/rapier3d-compat";
import type { Object3D } from "three";
import type { PhysicsContext } from "./plugin.js";

export type RigidBodyType = "dynamic" | "fixed" | "kinematic";

export interface RigidBody3DOptions {
  readonly object: Object3D;
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
  readonly object: Object3D;
  readonly type: RigidBodyType;
  #world: RAPIER.World;
  #physics: PhysicsContext | undefined;
  #disposed = false;

  constructor(options: RigidBody3DOptions) {
    const world = options.world ?? options.physics?.world;
    if (world === undefined) throw new Error("RigidBody3D requires a physics context or world.");
    this.#world = world;
    this.#physics = options.physics;
    this.object = options.object;
    this.type = options.type ?? "dynamic";
    const description = bodyDescription(this.type)
      .setTranslation(this.object.position.x, this.object.position.y, this.object.position.z)
      .setRotation({
        x: this.object.quaternion.x,
        y: this.object.quaternion.y,
        z: this.object.quaternion.z,
        w: this.object.quaternion.w,
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
      x: this.object.position.x,
      y: this.object.position.y,
      z: this.object.position.z,
    });
    this.body.setNextKinematicRotation({
      x: this.object.quaternion.x,
      y: this.object.quaternion.y,
      z: this.object.quaternion.z,
      w: this.object.quaternion.w,
    });
  }

  syncFromPhysics(): void {
    if (!this.body.isValid()) return;
    const translation = this.body.translation();
    const rotation = this.body.rotation();
    this.object.position.set(translation.x, translation.y, translation.z);
    this.object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#physics?.remove(this);
    if (this.body.isValid()) this.#world.removeRigidBody(this.body);
  }
}
