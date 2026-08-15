import type { ICtx } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { Object3D, Vector3 } from "three";
import type { GameState } from "../state.js";
import { PUSHER_LAYER } from "./Crate.js";
import type { Crate } from "./Crate.js";
import type { Player } from "./Player.js";

/**
 * Shoving crates, by hand.
 *
 * `CharacterBody3D` collides with dynamic bodies but never pushes them, and
 * `RigidBody3D` exposes no impulse, force or velocity. Writing a dynamic
 * body's transform and calling `syncToPhysics()` does nothing either — the
 * backend overwrites it on the next step (measured: a crate nudged 2 units
 * was back at its old position one frame later).
 *
 * So the player carries an invisible kinematic body. Kinematic transforms are
 * the one thing the backend does read back, and the solver turns that into a
 * real push: the crate takes the shove, and whatever it was leaning on topples
 * on its own.
 */
const MAX_REACH = 1.0;
const MAX_LOAD = 2;

export class Pusher {
  /**
   * Also the player's stand-in for sensors: `Area3D` never reported the
   * `CharacterBody3D` walking into it, but it does report this body.
   */
  readonly body: RigidBody3D;
  readonly #object = new Object3D();
  readonly #offset = new Vector3();

  constructor(ctx: ICtx<GameState, IPhysicsContext>, player: Player) {
    this.#object.position.copy(player.position);
    this.body = new RigidBody3D({
      collisionLayer: PUSHER_LAYER,
      object: this.#object,
      physics: ctx.physics,
      shape: CollisionShape3D.box(0.52, 0.95, 0.52),
      type: "kinematic",
    });
  }

  /**
   * Call after the character controller has moved, every frame.
   *
   * A kinematic body has infinite mass, so left alone the player ploughs
   * through the whole pile. Counting what is actually in front of the paddle
   * gives the shove a load limit: one or two crates move, a wall of them does
   * not, and the player's own capsule then stops against the stack.
   */
  follow(player: Player, facing: number, crates: readonly Crate[]): void {
    // Lead the capsule slightly so the paddle reaches a crate at the moment
    // the player's own collider stops against it.
    this.#offset.set(Math.sin(facing), 0, Math.cos(facing)).multiplyScalar(0.26);
    this.#object.position.copy(player.position).add(this.#offset);

    let load = 0;
    for (const crate of crates) {
      if (crate.phantom) continue;
      const dx = crate.object.position.x - this.#object.position.x;
      const dz = crate.object.position.z - this.#object.position.z;
      if (Math.abs(crate.object.position.y - this.#object.position.y) > 1.1) continue;
      if (dx * dx + dz * dz < MAX_REACH * MAX_REACH) load += 1;
    }
    // Over the limit the paddle is parked out of the world rather than
    // disabled: there is no API to toggle a collider off.
    if (load > MAX_LOAD) this.#object.position.set(0, -80, 0);
    this.body.syncToPhysics();
  }

  dispose(): void {
    this.body.dispose();
  }
}
