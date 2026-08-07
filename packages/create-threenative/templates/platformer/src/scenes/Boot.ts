import { Scene } from "@threenative/core";
import type { GameState } from "../state.js";
import { Level } from "./Level.js";
import type { GameCtx } from "./Level.js";

export class Boot extends Scene<GameState, GameCtx["physics"]> {
  static override readonly initialState = Level.initialState;

  override enter(ctx: GameCtx): void {
    void ctx.goto("level");
  }
}
