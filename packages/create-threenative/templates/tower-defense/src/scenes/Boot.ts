import { Scene } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import type { GameState } from "../state.js";
import { Battle, type GameCtx } from "./Battle.js";

export class Boot extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState = Battle.initialState;

  override enter(ctx: GameCtx): void {
    void ctx.goto("battle");
  }
}
