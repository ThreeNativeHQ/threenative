import type { ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Group, Vector3 } from "three";
import { type IActionRpgConventions, preparePlayerConventions } from "../conventions.js";
import { createPlayerVisual } from "../render/shapes.js";
import type { RpgMaterials } from "../render/shapes.js";
import type { GameState } from "../state.js";

export const WORLD_LAYER = 1;
export const PLAYER_LAYER = 2;
export const HOSTILE_LAYER = 4;

type GameCtx = ICtx<GameState, IPhysicsContext>;

export class Player {
  readonly body: CharacterBody3D;
  readonly maxHealth = 100;
  readonly mesh: Group;
  readonly visual: Group;
  health: number;
  dead = false;
  equippedItem = "";
  #onDamage: (amount: number) => void;
  #onDeath: () => void;
  #conventions: IActionRpgConventions;

  constructor(
    ctx: GameCtx,
    materials: RpgMaterials,
    spawn: Vector3,
    health: number,
    onDamage: (amount: number) => void,
    onDeath: () => void,
  ) {
    this.#onDamage = onDamage;
    this.#onDeath = onDeath;
    this.health = Math.max(0, Math.min(this.maxHealth, health));
    this.mesh = new Group();
    this.visual = createPlayerVisual(materials);
    this.mesh.add(this.visual);
    this.mesh.position.copy(spawn);
    this.#conventions = preparePlayerConventions(this.visual);
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      collisionLayer: PLAYER_LAYER,
      collisionMask: WORLD_LAYER | HOSTILE_LAYER,
      gravity: 0,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.38, 0.34),
    });
  }

  update(ctx: GameCtx, dt: number): void {
    if (this.dead) return;
    const move = ctx.input.vector("move");
    this.body.velocity.set(move.x * 4.8, 0, -move.y * 4.8);
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

  attackOrigin(): Vector3 {
    return this.mesh.position.clone().add(new Vector3(0, 0.8, -0.9));
  }

  debug(): Record<string, unknown> {
    return {
      dead: this.dead,
      equippedItem: this.equippedItem,
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
