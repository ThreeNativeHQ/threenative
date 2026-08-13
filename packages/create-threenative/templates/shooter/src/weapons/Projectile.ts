import type { ICtx } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import type { Mesh, Vector3 } from "three";
import { PROJECTILE_LAYER } from "../entities/Player.js";
import { type IRayHit, directSpaceState } from "../physics.js";
import { createProjectileVisual } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

export class Projectile {
  readonly mesh: Mesh;
  readonly body: RigidBody3D;
  readonly tags = ["projectile"];
  #direction: Vector3;
  #life = 2.4;
  #speed = 10;
  #collisionMask: number;
  #onHit: (hit: IRayHit) => void;
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
    this.#direction = direction.clone().normalize();
    this.#onHit = onHit;
    this.mesh = createProjectileVisual(materials);
    this.mesh.position.copy(origin);
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

  update(ctx: GameCtx, dt: number): void {
    if (this.#dead) return;
    this.#life -= dt;
    if (this.#life <= 0) {
      this.#dead = true;
      return;
    }
    const from = this.mesh.position.clone();
    const to = from.clone().addScaledVector(this.#direction, this.#speed * dt);
    const hit = directSpaceState(ctx.physics).intersectRay({
      collisionMask: this.#collisionMask,
      from,
      to,
    });
    if (hit !== undefined) {
      this.#dead = true;
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
