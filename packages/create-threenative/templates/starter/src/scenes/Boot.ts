import { Scene } from "@threenative/core";
import type { GameState } from "../state.js";
import type { GameCtx } from "./Play.js";

export class Boot extends Scene<GameState, GameCtx["physics"]> {
  override enter(ctx: GameCtx): void {
    void ctx.goto("play");
  }
}
