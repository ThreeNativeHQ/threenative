export const version = "0.1.0";

export { AnimationPlayer } from "./animation.js";
export type { IAudioBusOptions, IAudioPlayOptions } from "./audio.js";
export { AudioBus } from "./audio.js";
export type { IThreeNativeConfig, ThreeNativeOrientation } from "./config.js";
export { createRandom } from "./random.js";
export type { IRandom } from "./random.js";
export { defineGame } from "./game.js";
export type {
  IGame,
  IGamePluginHooks,
  IGamePluginRuntime,
  IGamePlatformSource,
} from "./game.js";
export { GPUParticles3D } from "./particles.js";
export { ScenePicker } from "./picking.js";
export type { IRaycastOptions, IScenePickerOptions } from "./picking.js";
export { createReplayDriver, replay } from "./replay.js";
export type { Recording } from "./replay.js";
export { Scheduler } from "./schedule.js";
export type { ScheduleHandle } from "./schedule.js";
export { Scene } from "./scene.js";
export type { ICtx, SceneFrame } from "./scene.js";
export type { IRawInputPointer } from "./input.js";
