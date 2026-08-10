export const version = "0.1.0";

export { AudioBus } from "./audio.js";
export { defineGame } from "./game.js";
export type {
  Game,
  GamePluginHooks,
  GamePluginRuntime,
  GamePlatformSource,
} from "./game.js";
export { GPUParticles3D } from "./particles.js";
export { ScenePicker } from "./picking.js";
export type { RaycastOptions, ScenePickerOptions } from "./picking.js";
export { createReplayDriver, replay } from "./replay.js";
export type { Recording } from "./replay.js";
export { Scene } from "./scene.js";
export type { Ctx, SceneFrame } from "./scene.js";
export type { RawInputPointer } from "./input.js";
