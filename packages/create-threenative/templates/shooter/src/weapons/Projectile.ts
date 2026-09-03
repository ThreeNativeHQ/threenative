import type { ICtx } from "@threenative/core";
import {
  CollisionShape3D,
  type IPhysicsContext,
  type IRayHit,
  RigidBody3D,
} from "@threenative/physics";
import { type Mesh, Vector3 } from "three";
import { PROJECTILE_LAYER } from "../entities/Player.js";

import { createProjectileVisual } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

export class Projectile {
  readonly mesh: Mesh;
  readonly body: RigidBody3D;
  readonly tags = ["projectile"];
  #direction = new Vector3();
  #from = new Vector3();
  #to = new Vector3();
  #life = 2.4;
  readonly #speed = 10;
  readonly #collisionMask: number;
  #onHit: (hit: IRayHit) => void = () => undefined;
  #dead = false;

  constructor(
    ctx: GameCtx,
    materials: Parameters<typeof createProjectileVisual>[0],
    origin: Vector3,
    direction: Vector3,
    collisionMask: number,
    onHit: (hit: IRayHit) => void,
  ) {
    this.#collisionMask = collisionMask;
    this.mesh = createProjectileVisual(materials);
    this.reset(origin, direction, onHit);
    ctx.add(this.mesh);
    this.body = new RigidBody3D({
      collisionLayer: PROJECTILE_LAYER,
      collisionMask,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.sphere(0.12),
      type: "kinematic",
    });
  }

  get dead(): boolean {
    return this.#dead;
  }

  reset(origin: Vector3, direction: Vector3, onHit: (hit: IRayHit) => void): void {
    this.#life = 2.4;
    this.#dead = false;
    this.#onHit = onHit;
    this.#direction.copy(direction).normalize();
    this.mesh.position.copy(origin);
    this.mesh.visible = true;
  }

  update(ctx: GameCtx, dt: number): void {
    if (this.#dead) return;
    this.#life -= dt;
    if (this.#life <= 0) {
      this.#dead = true;
      this.mesh.visible = false;
      return;
    }
    const from = this.#from.copy(this.mesh.position);
    const to = this.#to.copy(from).addScaledVector(this.#direction, this.#speed * dt);
    const hit = ctx.physics.directSpaceState.intersectRay({
      collisionMask: this.#collisionMask,
      from,
      to,
    });
    if (hit !== undefined) {
      this.#dead = true;
      this.mesh.visible = false;
      this.#onHit(hit);
      return;
    }
    this.mesh.position.copy(to);
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
