import { Scene } from "@threenative/core";
import type { GameState } from "../state.js";
import { Play } from "./Play.js";
import type { GameCtx } from "./Play.js";

export class Boot extends Scene<GameState> {
  static override readonly initialState = Play.initialState;

  override enter(ctx: GameCtx): void {
    void ctx.goto("play");
  }
}
