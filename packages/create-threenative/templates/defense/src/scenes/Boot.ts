import { Scene } from "@threenative/core";
import type { DefensePhysics } from "../physics.js";
import type { GameState } from "../state.js";
import { Defense, type GameCtx } from "./Defense.js";

export class Boot extends Scene<GameState, DefensePhysics> {
  static override readonly initialState = Defense.initialState;

  override enter(ctx: GameCtx): void {
    void ctx.goto("defense");
  }
}
