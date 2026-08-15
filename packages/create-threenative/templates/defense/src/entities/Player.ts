import type { ICtx } from "@threenative/core";
import { type Group, Vector3 } from "three";
import type { DefensePhysics } from "../physics.js";
import { commander as commanderMesh } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, DefensePhysics>;

const MOVE_SPEED = 4;
const SPAWN = new Vector3(9, 0, 8);
const BOARD_BOUNDS = { maxX: 12, maxZ: 8, minX: -12, minZ: -8 } as const;

export class Player {
  readonly mesh: Group;
  readonly tags = ["player", "commander"];

  constructor(ctx: GameCtx) {
    this.mesh = commanderMesh();
    this.mesh.name = "player";
    this.mesh.position.copy(SPAWN);
    ctx.add(this.mesh);
  }

  update(ctx: GameCtx, dt: number): void {
    const move = ctx.input.vector("move");
    this.mesh.position.x = Math.max(
      BOARD_BOUNDS.minX,
      Math.min(BOARD_BOUNDS.maxX, this.mesh.position.x + move.x * MOVE_SPEED * dt),
    );
    this.mesh.position.z = Math.max(
      BOARD_BOUNDS.minZ,
      Math.min(BOARD_BOUNDS.maxZ, this.mesh.position.z - move.y * MOVE_SPEED * dt),
    );
    if (move.lengthSq() > 0) this.mesh.rotation.y = Math.atan2(move.x, -move.y);
  }

  debug(): Record<string, unknown> {
    return { position: this.mesh.position.toArray() };
  }

  dispose(): void {
    this.mesh.removeFromParent();
  }
}
