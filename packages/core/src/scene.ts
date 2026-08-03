import type { Camera, Object3D, Scene as ThreeScene } from "three";
import type { AssetLoader } from "./assets.js";
import type { InputMap } from "./input.js";
import type { RendererLike } from "./renderer.js";
import type { GameStore } from "./state.js";

export abstract class Scene<TState extends Record<string, unknown> = Record<string, unknown>> {
  load(_ctx: Ctx<TState>): void | Promise<void> {}

  enter(_ctx: Ctx<TState>): void {}

  exit(_ctx: Ctx<TState>): void {}

  update(_ctx: Ctx<TState>, _dt: number): void {}
}

export type SceneConstructor<TState extends Record<string, unknown> = Record<string, unknown>> =
  new () => Scene<TState>;

export interface Ctx<TState extends Record<string, unknown> = Record<string, unknown>> {
  readonly renderer: RendererLike;
  readonly scene: ThreeScene;
  readonly camera: Camera;
  readonly add: (object: Object3D) => Object3D;
  readonly input: InputMap;
  readonly assets: AssetLoader;
  readonly state: GameStore<TState>;
  readonly physics: undefined;
}
