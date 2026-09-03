import { Scene } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import type { GameState } from "../state.js";
import { Defense, type GameCtx } from "./Defense.js";

export class Boot extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState = Defense.initialState;

  override enter(ctx: GameCtx): void {
    void ctx.goto("defense");
  }
}
