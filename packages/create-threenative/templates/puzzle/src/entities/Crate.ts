import type { ICtx } from "@threenative/core";
import { CollisionShape3D, RigidBody3D } from "@threenative/physics";
import type { Mesh, Vector3 } from "three";
import { CRATE_LAYER, CRATE_MASK, type PuzzlePhysics } from "../physics.js";
import { CRATE_SIZE, crate as crateMesh } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, PuzzlePhysics>;

const CARRY_HEIGHT = 1.15;
const CARRY_BLEND = 12;

/**
 * A box the player can pick up, carry and set down.
 *
 * Carrying is a velocity, not a teleport. Snapping a dynamic body to the claw each frame makes it
 * pass through walls and pop the solver; steering its velocity toward the carry point keeps every
 * contact the room has honest, which is the whole point of a physics puzzle.
 */
export class Crate {
  readonly mesh: Mesh;
  readonly body: RigidBody3D;
  #held = false;

  constructor(
    ctx: GameCtx,
    position: Vector3,
    readonly id: string,
  ) {
    this.mesh = crateMesh();
    this.mesh.position.copy(position);
    ctx.add(this.mesh);
    this.body = new RigidBody3D({
      collisionLayer: CRATE_LAYER,
      collisionMask: CRATE_MASK,
      entity: `crate.${id}`,
      mass: 14,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE),
    });
  }

  get held(): boolean {
    return this.#held;
  }

  hold(): void {
    this.#held = true;
  }

  /** Lets go, keeping whatever velocity the carry gave it — a shove is a legitimate solution. */
  release(): void {
    this.#held = false;
  }

  carry(target: Vector3, dt: number): void {
    if (!this.#held) return;
    const blend = Math.min(1, Math.max(0, dt) * CARRY_BLEND);
    const position = this.mesh.position;
    this.body.linearVelocity = {
      x: ((target.x - position.x) / Math.max(dt, 1 / 240)) * blend,
      y: ((target.y + CARRY_HEIGHT - position.y) / Math.max(dt, 1 / 240)) * blend,
      z: ((target.z - position.z) / Math.max(dt, 1 / 240)) * blend,
    };
  }

  debug(): Record<string, unknown> {
    return { held: this.#held, position: this.mesh.position.toArray() };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
