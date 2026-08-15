import type { ICtx } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { BoxGeometry, Group, Mesh, Vector3 } from "three";
import { crateBody, cratePlanks } from "../render/crate.js";
import type { Materials } from "../render/materials.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

/**
 * Layer 2 is the pass-through layer. The player's collision mask excludes it,
 * so a phantom crate still stacks and topples with everything else in the room
 * while the player walks straight through it.
 */
export const SOLID_LAYER = 1;
export const PHANTOM_LAYER = 2;
/** The player's own kinematic push volume; the player must not collide with it. */
export const PUSHER_LAYER = 4;

export interface ICrateOptions {
  readonly phantom?: boolean;
  readonly tint?: number;
  readonly yaw?: number;
}

export class Crate {
  readonly object: Group;
  readonly body: RigidBody3D;
  readonly phantom: boolean;
  readonly #last = new Vector3();
  readonly #spawn = new Vector3();

  constructor(ctx: GameCtx, position: Vector3, materials: Materials, options: ICrateOptions = {}) {
    this.phantom = options.phantom ?? false;
    const tint = options.tint ?? 0;
    this.object = new Group();
    const shell = new Mesh(
      crateBody(),
      this.phantom ? materials.phantom : (materials.crate[tint] ?? materials.crate[0]),
    );
    shell.castShadow = !this.phantom;
    shell.receiveShadow = !this.phantom;
    const planks = new Mesh(
      cratePlanks(),
      this.phantom ? materials.phantomEdge : (materials.cratePlank[tint] ?? materials.cratePlank[0]),
    );
    planks.castShadow = !this.phantom;
    this.object.add(shell, planks);
    this.object.position.copy(position);
    this.object.rotation.y = options.yaw ?? 0;
    ctx.add(this.object);

    this.body = new RigidBody3D({
      collisionLayer: this.phantom ? PHANTOM_LAYER : SOLID_LAYER,
      mass: this.phantom ? 3 : 9,
      object: this.object,
      physics: ctx.physics,
      shape: CollisionShape3D.box(1, 1, 1),
    });
    this.#last.copy(position);
    this.#spawn.copy(position);
  }

  /** How far this crate has been shoved from where it spawned. */
  displaced(): number {
    return this.#spawn.distanceTo(this.object.position);
  }

  /** True once the crate has stopped moving between frames. */
  settled(epsilon = 0.004): boolean {
    const moved = this.#last.distanceToSquared(this.object.position);
    this.#last.copy(this.object.position);
    return moved < epsilon * epsilon;
  }

  dispose(): void {
    this.body.dispose();
    this.object.removeFromParent();
  }
}

/** A halo that makes the pass-through crate legible before you touch it. */
export function phantomHalo(materials: Materials): Mesh {
  const halo = new Mesh(new BoxGeometry(1.16, 1.16, 1.16), materials.phantom);
  halo.name = "phantom-halo";
  return halo;
}
