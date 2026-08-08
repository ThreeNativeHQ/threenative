import * as RAPIER from "@dimforge/rapier3d-compat";
import type { Object3D, Vector3 } from "three";
import { interactionGroups } from "./collision.js";
import type { PhysicsContext } from "./plugin.js";

export interface CharacterBody3DOptions {
  readonly object: Object3D;
  readonly physics?: PhysicsContext;
  readonly world?: RAPIER.World;
  readonly shape: RAPIER.ColliderDesc;
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

export class CharacterBody3D {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
  readonly object: Object3D;
  readonly velocity: Vector3;
  gravity: number;
  maxFallSpeed: number;
  readonly oneWayLayers: number;
  grounded = false;
  #world: RAPIER.World;
  #physics: PhysicsContext | undefined;
  #desired = { x: 0, y: 0, z: 0 };
  #sliding = false;
  #groundCollider: number | undefined;
  #disposed = false;

  constructor(options: CharacterBody3DOptions) {
    const world = options.world ?? options.physics?.world;
    if (world === undefined)
      throw new Error("CharacterBody3D requires a physics context or world.");
    this.#world = world;
    this.#physics = options.physics;
    this.object = options.object;
    this.velocity = this.object.position.clone().set(0, 0, 0);
    this.gravity = options.gravity ?? -9.81;
    this.maxFallSpeed = options.maxFallSpeed ?? 50;
    this.oneWayLayers = options.oneWayLayers ?? 0;
    const description = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(this.object.position.x, this.object.position.y, this.object.position.z)
      .setRotation({
        x: this.object.quaternion.x,
        y: this.object.quaternion.y,
        z: this.object.quaternion.z,
        w: this.object.quaternion.w,
      });
    this.body = world.createRigidBody(description);
    this.body.userData = this;
    options.shape.setCollisionGroups(
      interactionGroups(options.collisionLayer ?? 1, options.collisionMask ?? 0xffff),
    );
    this.collider = world.createCollider(options.shape, this.body);
    this.controller = world.createCharacterController(options.offset ?? 0.01);
    this.controller.setMaxSlopeClimbAngle(options.maxSlopeClimbAngle ?? Math.PI / 4);
    if (options.autostep !== undefined) {
      this.controller.enableAutostep(
        options.autostep.maxHeight,
        options.autostep.minWidth,
        options.autostep.includeDynamicBodies ?? false,
      );
    }
    if (options.snapToGround !== undefined)
      this.controller.enableSnapToGround(options.snapToGround);
    this.syncFromPhysics();
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

  syncToPhysics(): void {
    if (this.#disposed || !this.body.isValid()) return;
    const rotation = this.object.quaternion;
    this.body.setNextKinematicRotation({
      x: rotation.x,
      y: rotation.y,
      z: rotation.z,
      w: rotation.w,
    });
  }

  teleport(position: Pick<Vector3, "x" | "y" | "z">): void {
    if (this.#disposed || !this.body.isValid())
      throw new Error("CharacterBody3D.teleport cannot be used after dispose.");
    this.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    this.velocity.set(0, 0, 0);
    this.#desired = { x: 0, y: 0, z: 0 };
    this.#sliding = false;
    this.#groundCollider = undefined;
    this.grounded = false;
    this.syncFromPhysics();
  }

  step(): void {
    if (this.#disposed || !this.body.isValid()) return;
    const carry =
      this.#sliding && this.grounded && this.velocity.y <= 0 && this.#groundCollider !== undefined
        ? this.#physics?.kinematicMotion?.(this.#groundCollider)
        : undefined;
    const desired = {
      x: this.#desired.x + (carry?.x ?? 0),
      y: this.#desired.y + (carry?.y ?? 0),
      z: this.#desired.z + (carry?.z ?? 0),
    };
    const filterGroups =
      this.velocity.y > 0 && this.oneWayLayers !== 0
        ? interactionGroups(0xffff, 0xffff ^ this.oneWayLayers)
        : undefined;
    const filterPredicate =
      this.velocity.y > 0 && this.oneWayLayers !== 0
        ? (collider: RAPIER.Collider) =>
            ((collider.collisionGroups() >>> 16) & this.oneWayLayers) === 0
        : undefined;
    this.controller.computeColliderMovement(
      this.collider,
      desired,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      filterGroups,
      filterPredicate,
    );
    const movement = this.controller.computedMovement();
    const current = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: current.x + movement.x,
      y: current.y + movement.y,
      z: current.z + movement.z,
    });
    this.grounded = this.controller.computedGrounded();
    this.#groundCollider = this.grounded ? this.#findGroundCollider() : undefined;
    if (this.#sliding && this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    this.#desired = { x: 0, y: 0, z: 0 };
    this.#sliding = false;
  }

  #findGroundCollider(): number | undefined {
    for (let index = 0; index < this.controller.numComputedCollisions(); index += 1) {
      const collision = this.controller.computedCollision(index);
      if (collision === null || collision.collider === null) continue;
      if ((collision.normal1.y ?? Number.NEGATIVE_INFINITY) >= 0.5)
        return collision.collider.handle;
    }
    return undefined;
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
    this.#world.removeCharacterController(this.controller);
    if (this.body.isValid()) this.#world.removeRigidBody(this.body);
  }
}
