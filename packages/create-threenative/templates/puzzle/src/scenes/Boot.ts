import { Scene } from "@threenative/core";
import type { PuzzlePhysics } from "../physics.js";
import type { GameState } from "../state.js";
import { type GameCtx, Puzzle } from "./Puzzle.js";

export class Boot extends Scene<GameState, PuzzlePhysics> {
  static override readonly initialState = Puzzle.initialState;

  override enter(ctx: GameCtx): void {
    void ctx.goto("puzzle");
  }
}
