import type { ICtx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Group, MathUtils, Vector3 } from "three";
import type { Materials } from "../render/materials.js";
import { ball, block } from "../render/shapes.js";
import type { GameState } from "../state.js";
import { PHANTOM_LAYER, PUSHER_LAYER } from "./Crate.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

const MOVE_SPEED = 3.4;
const JUMP_SPEED = 4.6;
const SPAWN = new Vector3(-4.8, 0.95, 3.2);
/** Everything except the pass-through layer: that is the whole trick. */
const SOLID_MASK = 0xffff & ~PHANTOM_LAYER & ~PUSHER_LAYER;

function buildBody(materials: Materials): {
  readonly root: Group;
  readonly rig: Group;
  readonly arms: readonly Group[];
  readonly legs: readonly Group[];
} {
  const root = new Group();
  const rig = new Group();
  rig.scale.setScalar(1.75);
  const torso = block(0.42, 0.5, 0.3, materials.player, { radius: 0.14 });
  torso.position.y = 0.12;
  const head = ball(0.21, materials.player, { segments: 20 });
  head.position.y = 0.5;
  rig.add(torso, head);

  const arms = [-1, 1].map((side) => {
    const shoulder = new Group();
    const arm = block(0.14, 0.44, 0.14, materials.player, { radius: 0.07 });
    arm.position.y = -0.2;
    shoulder.add(arm);
    shoulder.position.set(side * 0.24, 0.3, 0);
    rig.add(shoulder);
    return shoulder;
  });
  const legs = [-1, 1].map((side) => {
    const hip = new Group();
    const leg = block(0.16, 0.42, 0.16, materials.player, { radius: 0.08 });
    leg.position.y = -0.21;
    hip.add(leg);
    hip.position.set(side * 0.11, -0.12, 0);
    rig.add(hip);
    return hip;
  });
  root.add(rig);
  return { root, rig, arms, legs };
}

export class Player {
  readonly object: Group;
  readonly body: CharacterBody3D;
  readonly #rig: Group;
  readonly #arms: readonly Group[];
  readonly #legs: readonly Group[];
  #facing = 0;
  #stride = 0;
  #pushing = 0;

  constructor(ctx: GameCtx, materials: Materials, spawn: Vector3 = SPAWN) {
    const parts = buildBody(materials);
    this.object = parts.root;
    this.#rig = parts.rig;
    this.#arms = parts.arms;
    this.#legs = parts.legs;
    this.object.position.copy(spawn);
    ctx.add(this.object);
    this.body = new CharacterBody3D({
      autostep: { includeDynamicBodies: true, maxHeight: 0.35, minWidth: 0.2 },
      collisionMask: SOLID_MASK,
      object: this.object,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.36, 0.36),
      snapToGround: 0.3,
    });
  }

  get facing(): number {
    return this.#facing;
  }

  get position(): Vector3 {
    return this.object.position;
  }

  update(ctx: GameCtx, dt: number): { readonly moving: boolean } {
    const move = ctx.input.vector("move");
    const speed = Math.hypot(move.x, move.y);
    this.body.velocity.x = move.x * MOVE_SPEED;
    this.body.velocity.z = -move.y * MOVE_SPEED;
    if (ctx.input.justPressed("jump") && this.body.grounded) this.body.velocity.y = JUMP_SPEED;
    this.body.moveAndSlide(dt);

    if (speed > 0.01) this.#facing = Math.atan2(move.x, -move.y);
    this.object.rotation.y = MathUtils.damp(this.object.rotation.y, this.#facing, 14, dt);

    // Lean into the push and swing the limbs: the pose is what reads at this
    // camera distance, not the model.
    this.#pushing = MathUtils.damp(this.#pushing, speed > 0.05 ? 1 : 0, 8, dt);
    this.#stride += speed * dt * 9;
    this.#rig.rotation.x = this.#pushing * 0.42;
    this.#rig.position.z = this.#pushing * 0.05;
    const swing = Math.sin(this.#stride) * 0.7 * speed;
    for (const [index, leg] of this.#legs.entries()) leg.rotation.x = index === 0 ? swing : -swing;
    for (const [index, arm] of this.#arms.entries()) {
      // Both arms reach forward while pushing, and alternate while walking.
      arm.rotation.x = MathUtils.lerp(index === 0 ? -swing : swing, -2.0, this.#pushing);
      arm.rotation.z = this.#pushing * (index === 0 ? 0.25 : -0.25);
    }
    return { moving: speed > 0.05 };
  }

  teleport(position: Vector3 = SPAWN): void {
    this.body.teleport(position);
  }

  dispose(): void {
    this.body.dispose();
    this.object.removeFromParent();
  }
}

export const PLAYER_SPAWN = SPAWN;
