import type { ICtx } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { Group, Mesh } from "three";
import { crateBodyGeometry, crateTrimGeometry } from "../render/crate-geometry.js";
import type { CrateColor, Materials } from "../render/materials.js";
import type { GameState } from "../state.js";

/**
 * Collision layers, Godot-style. The player's mask omits `ghost`, and the ghost
 * crate's mask omits `player`, so the two never see each other — that is the
 * whole pass-through mechanic, and it costs one bit rather than a sensor and a
 * pile of bookkeeping.
 */
export const LAYER = { world: 1, solid: 2, ghost: 4, player: 8 } as const;
export const MASK = {
  world: 0xffff,
  solid: 0xffff,
  ghost: LAYER.world | LAYER.solid | LAYER.ghost,
  player: LAYER.world | LAYER.solid | LAYER.player,
  goal: LAYER.solid | LAYER.player,
} as const;

export type CrateKind = "solid" | "ghost";

export interface ICrateOptions {
  readonly color: CrateColor;
  readonly kind?: CrateKind;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly yaw?: number;
}

export class Crate {
  readonly object: Group;
  readonly body: RigidBody3D;
  readonly kind: CrateKind;

  constructor(
    ctx: ICtx<GameState, IPhysicsContext>,
    materials: Materials,
    options: ICrateOptions,
  ) {
    this.kind = options.kind ?? "solid";
    const skin =
      this.kind === "ghost"
        ? { body: materials.ghost, trim: materials.ghostTrim }
        : materials.crate[options.color];

    const body = new Mesh(crateBodyGeometry(), skin.body);
    const trim = new Mesh(crateTrimGeometry(), skin.trim);
    // Only the solid body casts. The plank frame is 3 cm proud, so letting it
    // cast drops a hard shadow onto its own panel and the crate reads as a
    // bright frame over a dark hole.
    body.castShadow = this.kind === "solid";
    body.receiveShadow = this.kind === "solid";
    trim.castShadow = false;
    trim.receiveShadow = this.kind === "solid";

    this.object = new Group();
    this.object.add(body, trim);
    this.object.position.set(options.position.x, options.position.y, options.position.z);
    this.object.rotation.y = options.yaw ?? 0;
    ctx.add(this.object);

    this.body = new RigidBody3D({
      collisionLayer: this.kind === "ghost" ? LAYER.ghost : LAYER.solid,
      collisionMask: this.kind === "ghost" ? MASK.ghost : MASK.solid,
      mass: this.kind === "ghost" ? 3 : 9,
      object: this.object,
      physics: ctx.physics,
      shape: CollisionShape3D.box(1, 1, 1),
      type: "dynamic",
    });
  }

  dispose(): void {
    this.body.dispose();
    this.object.removeFromParent();
  }
}
