import { CharacterBody3D, CollisionShape3D, type IPhysicsBodyHandle } from "@threenative/physics";
import { Vector3 } from "three";
import { hostileMaterial } from "../render/materials.js";
import { Fighter, type GameCtx, type IMannequin } from "./Fighter.js";
import { HOSTILE_LAYER, PLAYER_LAYER, WORLD_LAYER } from "./Player.js";

export type EnemyState = "idle" | "aggro" | "attack" | "dead";

/** The clips `assets/mannequin-combat.glb` ships, by the action this file plays them under. */
const CLIPS = {
  attack: "Punch_Jab",
  death: "Death01",
  hit: "Hit_Chest",
  idle: "Idle_Loop",
  walk: "Walk_Loop",
} as const;

/** The boss is a raider that took the room: same rig, same clips, a metre and a third taller. */
const BOSS_SCALE = 1.3;
const BOSS_HALF_HEIGHT = 0.58;
const BOSS_RADIUS = 0.5;
const HALF_HEIGHT = 0.4;
const RADIUS = 0.32;
const SIGHT_RANGE = 4.8;
const MELEE_RANGE = 1.45;
const SWING = 0.4;

interface IEnemyOptions {
  readonly boss?: boolean;
  readonly health?: number;
  readonly onAttack: (amount: number) => void;
  readonly onDeath: (enemy: Enemy) => void;
}

export class Enemy extends Fighter {
  readonly body: CharacterBody3D;
  readonly boss: boolean;
  /** The body handle's id, read once: the body is disposed on death and the map key outlives it. */
  readonly id: number;
  readonly tags = ["enemy", "hostile"];
  health: number;
  state: EnemyState = "idle";
  lineOfSight = false;
  lineOfSightBlocked = false;
  alive = true;
  #attackTimer = 0.8;
  #bodyDisposed = false;
  #onAttack: (amount: number) => void;
  #onDeath: (enemy: Enemy) => void;
  #playerBody: IPhysicsBodyHandle;
  #rangeShape = CollisionShape3D.sphere(SIGHT_RANGE);
  #from = new Vector3();
  #to = new Vector3();
  #direction = new Vector3();

  constructor(
    ctx: GameCtx,
    model: IMannequin,
    position: Vector3,
    playerBody: IPhysicsBodyHandle,
    options: IEnemyOptions,
  ) {
    super(ctx, model, CLIPS, {
      halfExtent: options.boss === true ? BOSS_HALF_HEIGHT + BOSS_RADIUS : HALF_HEIGHT + RADIUS,
      ...(options.boss === true ? { scale: BOSS_SCALE } : {}),
    });
    this.boss = options.boss ?? false;
    this.health = options.health ?? (this.boss ? 64 : 28);
    this.#onAttack = options.onAttack;
    this.#onDeath = options.onDeath;
    this.#playerBody = playerBody;
    this.mesh.position.copy(position);
    // The shell ships white, and a white figure and a white hero are one silhouette at this camera
    // distance. The tint is the cheapest read that says "this one hits you" — and it costs no
    // second asset, because the material is replaced on this instance's cloned rig.
    this.character.root.traverse((object) => {
      const mesh = object as { isMesh?: boolean; material?: unknown };
      if (mesh.isMesh === true) mesh.material = hostileMaterial;
    });
    this.body = new CharacterBody3D({
      collisionLayer: HOSTILE_LAYER,
      collisionMask: WORLD_LAYER,
      gravity: 0,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(
        this.boss ? BOSS_HALF_HEIGHT : HALF_HEIGHT,
        this.boss ? BOSS_RADIUS : RADIUS,
      ),
    });
    this.id = this.body.body.id;
  }

  update(ctx: GameCtx, dt: number, playerPosition: Vector3): void {
    if (!this.alive) {
      this.animateStill(dt);
      return;
    }
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
      this.animateRig(dt, undefined, 0);
      return;
    }

    const direction = this.#direction.copy(playerPosition).sub(this.mesh.position).setY(0);
    const distance = direction.length();
    const heading = Math.atan2(direction.x, direction.z);
    if (distance <= MELEE_RANGE) {
      this.state = "attack";
      this.body.velocity.set(0, 0, 0);
      this.#attackTimer -= dt;
      if (this.#attackTimer <= 0) {
        this.#attackTimer = this.boss ? 1.2 : 1.5;
        this.play("attack", { fade: 0.06, hold: SWING });
        this.#onAttack(this.boss ? 10 : 5);
      }
      this.body.moveAndSlide(dt);
      this.animateRig(dt, heading, this.busy ? MELEE_RANGE : 0);
      return;
    }

    this.state = "aggro";
    if (distance > 0.001) direction.normalize().multiplyScalar(this.boss ? 2.1 : 2.7);
    this.body.velocity.set(direction.x, 0, direction.z);
    this.body.moveAndSlide(dt);
    this.animateRig(dt, heading, direction.length());
  }

  takeDamage(amount: number): boolean {
    if (!this.alive || !Number.isFinite(amount) || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    if (this.health > 0) {
      if (!this.busy) this.play("hit", { fade: 0.04, hold: 0.25 });
      return false;
    }
    this.alive = false;
    this.state = "dead";
    // The body stops blocking the doorway, but the figure stays where it fell: a raider that
    // vanishes on the frame it dies gives the kill no feedback at all at this camera distance.
    this.#disposeBody();
    this.play("death", { fade: 0.05, hold: Number.POSITIVE_INFINITY });
    this.#onDeath(this);
    return true;
  }

  debug(): Record<string, unknown> {
    return {
      action: this.action,
      alive: this.alive,
      boss: this.boss,
      health: this.health,
      lineOfSight: this.lineOfSight,
      lineOfSightBlocked: this.lineOfSightBlocked,
      normaliseFactor: this.conventions.normaliseFactor,
      position: this.mesh.position.toArray(),
      state: this.state,
    };
  }

  #disposeBody(): void {
    if (this.#bodyDisposed) return;
    this.#bodyDisposed = true;
    this.body.dispose();
  }

  dispose(): void {
    this.#disposeBody();
    this.mesh.removeFromParent();
  }
}
