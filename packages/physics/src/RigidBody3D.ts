import * as RAPIER from "@dimforge/rapier3d-compat";
import type { Object3D } from "three";
import type { CollisionShape3D } from "./CollisionShape3D.js";
import { interactionGroups } from "./collision.js";
import {
  type PhysicsBodyHandle,
  type PhysicsColliderHandle,
  type PhysicsWorldHandle,
  physicsBodyHandle,
  physicsColliderHandle,
} from "./handles.js";
import type { PhysicsContext } from "./plugin.js";

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

function bodyDescription(type: RigidBodyType): RAPIER.RigidBodyDesc {
  if (type === "fixed") return RAPIER.RigidBodyDesc.fixed();
  if (type === "kinematic") return RAPIER.RigidBodyDesc.kinematicPositionBased();
  return RAPIER.RigidBodyDesc.dynamic();
}

export class RigidBody3D {
  readonly body: PhysicsBodyHandle;
  readonly collider: PhysicsColliderHandle;
  readonly object: Object3D;
  readonly type: RigidBodyType;
  #world: RAPIER.World;
  #physics: PhysicsContext | undefined;
  #disposed = false;

  #rawBody(): RAPIER.RigidBody {
    return this.body.raw as RAPIER.RigidBody;
  }

  constructor(options: RigidBody3DOptions) {
    const worldHandle = options.world ?? options.physics?.world;
    if (worldHandle === undefined)
      throw new Error("RigidBody3D requires a physics context or world.");
    const world =
      typeof worldHandle === "object" && worldHandle !== null && "raw" in worldHandle
        ? ((worldHandle as PhysicsWorldHandle).raw as RAPIER.World)
        : (worldHandle as RAPIER.World);
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
    const rawBody = world.createRigidBody(description);
    rawBody.userData = this;
    if (options.collisionLayer !== undefined || options.collisionMask !== undefined) {
      options.shape.setCollisionGroups(
        interactionGroups(options.collisionLayer ?? 1, options.collisionMask ?? 0xffff),
      );
    }
    const rawCollider = world.createCollider(options.shape.raw as RAPIER.ColliderDesc, rawBody);
    this.body = physicsBodyHandle(rawBody.handle, rawBody);
    this.collider = physicsColliderHandle(rawCollider.handle, rawCollider);
    this.syncFromPhysics();
    this.#physics?.add(this);
  }

  syncToPhysics(): void {
    const body = this.#rawBody();
    if (!body.isValid() || !body.isKinematic()) return;
    body.setNextKinematicTranslation({
      x: this.object.position.x,
      y: this.object.position.y,
      z: this.object.position.z,
    });
    body.setNextKinematicRotation({
      x: this.object.quaternion.x,
      y: this.object.quaternion.y,
      z: this.object.quaternion.z,
      w: this.object.quaternion.w,
    });
  }

  syncFromPhysics(): void {
    const body = this.#rawBody();
    if (!body.isValid()) return;
    const translation = body.translation();
    const rotation = body.rotation();
    this.object.position.set(translation.x, translation.y, translation.z);
    this.object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#physics?.remove(this);
    const body = this.#rawBody();
    if (body.isValid()) this.#world.removeRigidBody(body);
  }
}
