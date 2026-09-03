import type { ICtx } from "@threenative/core";
import { type Group, Vector3 } from "three";
import { type IPuzzleConventions, prepareGripperConventions } from "../conventions.js";
import type { PuzzlePhysics } from "../physics.js";
import { gripper as gripperMesh } from "../render/shapes.js";
import type { ITouchInput } from "../render/touch-controls.js";
import { ROOM_DEPTH, ROOM_WIDTH } from "../room.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, PuzzlePhysics>;

const MOVE_SPEED = 5.2;
const SPAWN = new Vector3(-5.5, 0, 9);
const MARGIN = 1.4;

/**
 * The player.
 *
 * A claw rather than a character: this game is about what the player moves, not about the mover,
 * so the gripper is kinematic, stays on the floor, and carries exactly one crate. It is a plain
 * transform with no rigid body — nothing in the room should be solvable by shoving the player
 * into it.
 */
export class Gripper {
  readonly mesh: Group;
  readonly tags = ["player", "gripper"];
  #conventions: IPuzzleConventions;

  constructor(ctx: GameCtx) {
    this.mesh = gripperMesh();
    this.mesh.name = "player";
    this.mesh.position.copy(SPAWN);
    this.#conventions = prepareGripperConventions(this.mesh);
    ctx.add(this.mesh);
  }

  update(ctx: GameCtx, dt: number, touch?: ITouchInput): void {
    const move = ctx.input.vector("move");
    if (touch !== undefined) {
      move.x += touch.move.x;
      move.y += touch.move.y;
      move.clampLength(0, 1);
    }
    const limitX = ROOM_WIDTH / 2 - MARGIN;
    const limitZ = ROOM_DEPTH / 2 - MARGIN;
    this.mesh.position.x = Math.min(
      limitX,
      Math.max(-limitX, this.mesh.position.x + move.x * MOVE_SPEED * dt),
    );
    this.mesh.position.z = Math.min(
      limitZ,
      Math.max(-limitZ, this.mesh.position.z - move.y * MOVE_SPEED * dt),
    );
    if (move.lengthSq() > 0) this.mesh.rotation.y = Math.atan2(move.x, -move.y);
    this.#conventions.applyGrounding(0, dt);
  }

  debug(): Record<string, unknown> {
    return {
      groundClearance: this.#conventions.groundSnap.clearance,
      normaliseFactor: this.#conventions.normaliseFactor,
      position: this.mesh.position.toArray(),
    };
  }

  dispose(): void {
    this.mesh.removeFromParent();
  }
}
