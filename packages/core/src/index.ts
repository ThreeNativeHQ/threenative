/**
 * The version this library reports.
 *
 * It read `0.1.0` while the package published `0.2.0`, and `__tests__/build.spec.ts` asserted the
 * stale literal, so the test held the bug in place rather than catching it. A literal is
 * unavoidable here — core is bundled for browsers and cannot read `package.json` at runtime — so
 * the spec now asserts this equals the manifest instead of asserting a number somebody typed.
 */
export const version = "0.2.0";

export { AnimationPlayer } from "./animation.js";
export type { IAudioBusOptions, IAudioPlayOptions } from "./audio.js";
export { AudioBus } from "./audio.js";
export { CanvasLayer } from "./canvas-layer.js";
export type {
  IThreeNativeBootSplash,
  IThreeNativeConfig,
  IThreeNativeIconVariants,
  ThreeNativeOrientation,
} from "./config.js";
export { createRandom } from "./random.js";
export type { IRandom } from "./random.js";
export { defineGame } from "./game.js";
export type {
  IGame,
  IGameObservationContribution,
  IGameObservationSampleRequest,
  IGamePluginHooks,
  IGamePluginRuntime,
  IGamePlatformSource,
} from "./game.js";
export { GPUParticles3D } from "./particles.js";
export { PathFollow3D } from "./path-follow.js";
export type {
  IPathFollow3DOptions,
  IPathFollow3DProjection,
  IPathFollow3DSample,
} from "./path-follow.js";
export { ScenePicker } from "./picking.js";
export type { IRaycastOptions, IScenePickerOptions } from "./picking.js";
export { createReplayDriver, replay } from "./replay.js";
export type { Recording } from "./replay.js";
export { Scheduler } from "./schedule.js";
export type { ScheduleHandle } from "./schedule.js";
export { Scene } from "./scene.js";
export type { ICtx, SceneFrame } from "./scene.js";
export { attachToBone, skeletonBones } from "./skeleton.js";
export type { ContextMenuPolicy, IInputAction, IRawInputPointer } from "./input.js";
