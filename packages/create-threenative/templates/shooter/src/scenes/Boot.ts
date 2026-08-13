import { Scene } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import type { GameState } from "../state.js";
import { type GameCtx, Play } from "./Play.js";

export class Boot extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState = Play.initialState;

  override enter(ctx: GameCtx): void {
    void ctx.goto("play");
  }
}
