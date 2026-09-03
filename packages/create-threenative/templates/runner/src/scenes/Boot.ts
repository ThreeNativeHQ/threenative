import { Scene } from "@threenative/core";
import type { RunnerPhysics } from "../physics.js";
import type { GameState } from "../state.js";
import { type GameCtx, Run } from "./Run.js";

export class Boot extends Scene<GameState, RunnerPhysics> {
  static override readonly initialState = Run.initialState;

  override enter(ctx: GameCtx): void {
    void ctx.goto("run");
  }
}
