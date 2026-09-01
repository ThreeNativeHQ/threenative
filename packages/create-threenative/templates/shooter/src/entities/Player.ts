import type { ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Group, Vector3 } from "three";
import { type IShooterConventions, preparePlayerConventions } from "../conventions.js";
import { createPlayerVisual } from "../render/shapes.js";
import type { GameState } from "../state.js";

export const WORLD_LAYER = 1;
export const PLAYER_LAYER = 2;
export const HOSTILE_LAYER = 4;
export const FRIENDLY_LAYER = 8;
export const PROJECTILE_LAYER = 16;

type GameCtx = ICtx<GameState, IPhysicsContext>;

const SPAWN = new Vector3(0, 0.85, 5);
const MOVE_SPEED = 4.2;

export class Player {
  readonly mesh: Group;
  readonly visual: Group;
  readonly body: CharacterBody3D;
  readonly maxHealth = 100;
  health = 100;
  dead = false;
  #onDamage: (amount: number) => void;
  #onDeath: () => void;
  #conventions: IShooterConventions;

  constructor(
    ctx: GameCtx,
    materials: Parameters<typeof createPlayerVisual>[0],
    spawn: Vector3 = SPAWN,
    onDamage: (amount: number) => void = () => undefined,
    onDeath: () => void = () => undefined,
  ) {
    this.#onDamage = onDamage;
    this.#onDeath = onDeath;
    this.mesh = new Group();
    this.visual = createPlayerVisual(materials);
    this.mesh.add(this.visual);
    this.mesh.position.copy(spawn);
    this.#conventions = preparePlayerConventions(this.visual);
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      collisionLayer: PLAYER_LAYER,
      collisionMask: WORLD_LAYER | HOSTILE_LAYER,
      autostep: { maxHeight: 0.25, minWidth: 0.18 },
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.45, 0.38),
    });
  }

  update(ctx: GameCtx, dt: number): void {
    if (this.dead) return;
    const move = ctx.input.vector("move");
    this.body.velocity.x = move.x * MOVE_SPEED;
    this.body.velocity.z = -move.y * MOVE_SPEED;
    this.body.moveAndSlide(dt);
    this.#conventions.applyGrounding(0, dt);
  }

  takeDamage(amount: number): void {
    if (this.dead || !Number.isFinite(amount) || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.#onDamage(amount);
    if (this.health > 0) return;
    this.dead = true;
    this.mesh.visible = false;
    this.body.velocity.set(0, 0, 0);
    this.#onDeath();
  }

  respawn(spawn: Vector3): void {
    this.body.teleport(spawn);
    this.health = 40;
    this.dead = false;
    this.mesh.visible = true;
  }

  aimOrigin(): Vector3 {
    return this.mesh.position.clone().add(new Vector3(0, 0.72, -0.72));
  }

  debug(): Record<string, unknown> {
    return {
      dead: this.dead,
      groundClearance: this.#conventions.groundSnap.clearance,
      health: this.health,
      normaliseFactor: this.#conventions.normaliseFactor,
      position: this.mesh.position.toArray(),
      skeletonBones: this.#conventions.boneNames,
      weaponBone: this.#conventions.attachedBone,
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}

export { SPAWN };
