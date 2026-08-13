import { Scene } from "@threenative/core";
import type { GameState } from "../state.js";
import { Race } from "./Race.js";
import type { GameCtx } from "./Race.js";

export class Boot extends Scene<GameState, GameCtx["physics"]> {
  static override readonly initialState = Race.initialState;

  override enter(ctx: GameCtx): void {
    void ctx.goto("race");
  }
}
