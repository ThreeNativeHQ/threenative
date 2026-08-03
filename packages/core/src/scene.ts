import type { Camera, Object3D, Scene as ThreeScene } from "three";
import type { AssetLoader } from "./assets.js";
import type { Registry } from "./entities.js";
import type { InputMap } from "./input.js";
import type { RendererLike } from "./renderer.js";
import type { GameStore } from "./state.js";

export abstract class Scene<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> {
  load(_ctx: Ctx<TState, TPhysics>): void | Promise<void> {}

  enter(_ctx: Ctx<TState, TPhysics>): void {}

  exit(_ctx: Ctx<TState, TPhysics>): void {}

  update(_ctx: Ctx<TState, TPhysics>, _dt: number): void {}

  render(_ctx: Ctx<TState, TPhysics>): void {}
}

export type SceneConstructor<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> = new () => Scene<TState, TPhysics>;

export interface Ctx<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> {
  readonly renderer: RendererLike;
  readonly scene: ThreeScene;
  readonly camera: Camera;
  readonly entities: Registry;
  readonly add: (object: Object3D) => Object3D;
  readonly input: InputMap;
  readonly assets: AssetLoader;
  readonly state: GameStore<TState>;
  readonly goto: (name: string) => Promise<void>;
  physics: TPhysics;
}
