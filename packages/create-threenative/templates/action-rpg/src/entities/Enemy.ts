import type { ICtx } from "@threenative/core";
import {
  CharacterBody3D,
  CollisionShape3D,
  type IPhysicsBodyHandle,
  type IPhysicsContext,
} from "@threenative/physics";
import { type Group, Vector3 } from "three";
import { type RpgMaterials, createEnemyVisual } from "../render/shapes.js";
import type { GameState } from "../state.js";
import { HOSTILE_LAYER, PLAYER_LAYER, WORLD_LAYER } from "./Player.js";

export type EnemyState = "idle" | "aggro" | "attack" | "dead";

type GameCtx = ICtx<GameState, IPhysicsContext>;

interface IEnemyOptions {
  readonly boss?: boolean;
  readonly health?: number;
  readonly onAttack: (amount: number) => void;
  readonly onDeath: (enemy: Enemy) => void;
}

export class Enemy {
  readonly body: CharacterBody3D;
  readonly boss: boolean;
  readonly mesh: Group;
  readonly tags = ["enemy", "hostile"];
  health: number;
  state: EnemyState = "idle";
  lineOfSight = false;
  lineOfSightBlocked = false;
  alive = true;
  #attackTimer = 0.8;
  #onAttack: (amount: number) => void;
  #onDeath: (enemy: Enemy) => void;
  #playerBody: IPhysicsBodyHandle;
  #rangeShape = CollisionShape3D.sphere(4.8);
  #from = new Vector3();
  #to = new Vector3();
  #direction = new Vector3();

  constructor(
    ctx: GameCtx,
    materials: RpgMaterials,
    position: Vector3,
    playerBody: IPhysicsBodyHandle,
    options: IEnemyOptions,
  ) {
    this.boss = options.boss ?? false;
    this.health = options.health ?? (this.boss ? 64 : 28);
    this.#onAttack = options.onAttack;
    this.#onDeath = options.onDeath;
    this.#playerBody = playerBody;
    this.mesh = createEnemyVisual(materials, this.boss);
    this.mesh.position.copy(position);
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      collisionLayer: HOSTILE_LAYER,
      collisionMask: WORLD_LAYER,
      gravity: 0,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(this.boss ? 0.58 : 0.4, this.boss ? 0.5 : 0.32),
    });
  }

  update(ctx: GameCtx, dt: number, playerPosition: Vector3): void {
    if (!this.alive) return;
    const rangeHits = ctx.physics.directSpaceState.intersectShape({
      collisionMask: PLAYER_LAYER,
      maxResults: 4,
      position: this.mesh.position,
      shape: this.#rangeShape,
    });
    let inRange = false;
    for (const hit of rangeHits) {
      if (hit.body.id !== this.#playerBody.id) continue;
      inRange = true;
      break;
    }
    this.lineOfSight = false;
    this.lineOfSightBlocked = false;
    if (inRange) {
      const from = this.#from.copy(this.mesh.position);
      from.y += this.boss ? 0.9 : 0.5;
      const to = this.#to.copy(playerPosition);
      to.y += 0.5;
      const ray = ctx.physics.directSpaceState.intersectRay({
        collisionMask: WORLD_LAYER | PLAYER_LAYER,
        from,
        to,
      });
      this.lineOfSight = ray?.body.id === this.#playerBody.id;
      this.lineOfSightBlocked = !this.lineOfSight && ray !== undefined;
    }

    if (!this.lineOfSight) {
      this.state = "idle";
      this.body.velocity.set(0, 0, 0);
      this.body.moveAndSlide(dt);
      return;
    }

    const direction = this.#direction.copy(playerPosition).sub(this.mesh.position).setY(0);
    const distance = direction.length();
    if (distance <= 1.45) {
      this.state = "attack";
      this.body.velocity.set(0, 0, 0);
      this.#attackTimer -= dt;
      if (this.#attackTimer <= 0) {
        this.#attackTimer = this.boss ? 1.2 : 1.5;
        this.#onAttack(this.boss ? 10 : 5);
      }
      this.body.moveAndSlide(dt);
      return;
    }

    this.state = "aggro";
    if (distance > 0.001) direction.normalize().multiplyScalar(this.boss ? 2.1 : 2.7);
    this.body.velocity.set(direction.x, 0, direction.z);
    this.body.moveAndSlide(dt);
  }

  takeDamage(amount: number): boolean {
    if (!this.alive || !Number.isFinite(amount) || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    if (this.health > 0) return false;
    this.alive = false;
    this.state = "dead";
    this.mesh.visible = false;
    this.body.dispose();
    this.#onDeath(this);
    return true;
  }

  debug(): Record<string, unknown> {
    return {
      alive: this.alive,
      boss: this.boss,
      lineOfSight: this.lineOfSight,
      lineOfSightBlocked: this.lineOfSightBlocked,
      position: this.mesh.position.toArray(),
      state: this.state,
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
