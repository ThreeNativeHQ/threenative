import { Scene } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import type { Texture } from "three";
import { loadSky } from "../render/sky.js";
import type { GameState } from "../state.js";
import { Sailing } from "./Sailing.js";

export class Boot extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState = Sailing.initialState;

  // The photograph is fetched here, in the one method a scene is allowed to await, so that
  // `Sailing.enter` stays synchronous. That is not only tidiness: a playtest runner asks the
  // registry what this game can report as soon as the start scene's `enter()` returns, and a
  // scene that awaited its own load would still have no entities registered at that moment — so
  // every scenario with a component assertion would abort on `runtime.components` before taking a
  // frame. See `loadSky`.
  override async load(ctx: {
    readonly assets: { texture(path: string): Promise<Texture> };
  }): Promise<void> {
    await loadSky(ctx.assets);
  }

  override enter(ctx: Parameters<Sailing["enter"]>[0]): void {
    void ctx.goto("sailing");
  }
}
