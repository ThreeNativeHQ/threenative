export const version = "0.1.0";

export { createAssetLoader } from "./assets.js";
export type { AssetLoader, AssetLoaderOptions } from "./assets.js";
export { defineGame } from "./game.js";
export type {
  Game,
  GameConfig,
  GamePlugin,
  GamePluginFunction,
  GamePluginHooks,
  PluginCleanup,
} from "./game.js";
export { FixedStepLoop } from "./loop.js";
export type { FixedStepLoopOptions } from "./loop.js";
export { input, InputMap } from "./input.js";
export type { InputAction, InputBindings, RawInputState } from "./input.js";
export { createRenderer } from "./renderer.js";
export type { RendererKind, RendererLike, RendererOptions } from "./renderer.js";
export { Scene } from "./scene.js";
export type { Ctx, SceneConstructor } from "./scene.js";
export { createGameStore } from "./state.js";
export type { GameStore, StatePatch } from "./state.js";
