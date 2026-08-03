import * as RAPIER from "@dimforge/rapier3d-compat";
import type { Mesh, Vector3 } from "three";
import type { PhysicsContext } from "./plugin.js";

export interface CharacterBody3DOptions {
  readonly mesh: Mesh;
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
}

export class CharacterBody3D {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
  readonly mesh: Mesh;
  grounded = false;
  #world: RAPIER.World;
  #physics: PhysicsContext | undefined;
  #desired = { x: 0, y: 0, z: 0 };
  #disposed = false;

  constructor(options: CharacterBody3DOptions) {
    const world = options.world ?? options.physics?.world;
    if (world === undefined)
      throw new Error("CharacterBody3D requires a physics context or world.");
    this.#world = world;
    this.#physics = options.physics;
    this.mesh = options.mesh;
    const description = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(this.mesh.position.x, this.mesh.position.y, this.mesh.position.z)
      .setRotation({
        x: this.mesh.quaternion.x,
        y: this.mesh.quaternion.y,
        z: this.mesh.quaternion.z,
        w: this.mesh.quaternion.w,
      });
    this.body = world.createRigidBody(description);
    this.body.userData = this;
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
  }

  step(): void {
    if (this.#disposed || !this.body.isValid()) return;
    this.controller.computeColliderMovement(
      this.collider,
      this.#desired,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    const movement = this.controller.computedMovement();
    const current = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: current.x + movement.x,
      y: current.y + movement.y,
      z: current.z + movement.z,
    });
    this.grounded = this.controller.computedGrounded();
    this.#desired = { x: 0, y: 0, z: 0 };
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
    this.#world.removeCharacterController(this.controller);
    if (this.body.isValid()) this.#world.removeRigidBody(this.body);
  }
}
