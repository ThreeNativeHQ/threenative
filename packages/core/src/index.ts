export const version = "0.1.0";

export { AudioBus } from "./audio.js";
export type { AudioBusOptions, AudioPlayOptions } from "./audio.js";
export { createAssetLoader } from "./assets.js";
export type { AssetLoader, AssetLoaderOptions } from "./assets.js";
export { AnimationPlayer } from "./animation.js";
export type { AnimationPlayOptions, AnimationPlayerOptions } from "./animation.js";
export { defineGame } from "./game.js";
export type {
  Game,
  GameConfig,
  GamePlugin,
  GamePluginFunction,
  GamePluginHooks,
  GamePluginRuntime,
  GamePlatformSource,
  CameraConfig,
  OrthogonalCameraConfig,
  PerspectiveCameraConfig,
  PluginCleanup,
} from "./game.js";
export { FixedStepLoop } from "./loop.js";
export type { FixedStepLoopOptions } from "./loop.js";
export { GPUParticles3D } from "./particles.js";
export type { GPUParticles3DBuffers, GPUParticles3DOptions } from "./particles.js";
export { createRandom } from "./random.js";
export type { Random } from "./random.js";
export { createReplayDriver, replay } from "./replay.js";
export type { Recording } from "./replay.js";
export { autoFields, Registry } from "./entities.js";
export type { Debuggable, EntitySnapshot } from "./entities.js";
export { input, InputMap } from "./input.js";
export type { InputAction, InputBindings, RawInputPointer, RawInputState } from "./input.js";
export { createRenderer } from "./renderer.js";
export type { RendererKind, RendererLike, RendererOptions } from "./renderer.js";
export { Scene } from "./scene.js";
export type { Ctx, SceneConstructor, SceneEnterResult, SceneFrame } from "./scene.js";
export { Scheduler } from "./schedule.js";
export type { ScheduleHandle } from "./schedule.js";
export { createGameStore } from "./state.js";
export type { GameStore, StatePatch } from "./state.js";
export { Viewport } from "./viewport.js";
export type { ViewportOptions, ViewportResizeHandler, ViewportSize } from "./viewport.js";
