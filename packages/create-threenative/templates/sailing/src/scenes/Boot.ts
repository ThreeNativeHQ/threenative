import { Scene } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import type { GameState } from "../state.js";
import { Sailing } from "./Sailing.js";

export class Boot extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState = Sailing.initialState;

  override enter(ctx: Parameters<Sailing["enter"]>[0]): void {
    void ctx.goto("sailing");
  }
}
