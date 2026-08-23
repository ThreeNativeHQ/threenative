/**
 * The version this library reports.
 *
 * It read `0.1.0` while the package published `0.2.0`, and `__tests__/build.spec.ts` asserted the
 * stale literal, so the test held the bug in place rather than catching it. A literal is
 * unavoidable here — core is bundled for browsers and cannot read `package.json` at runtime — so
 * the spec now asserts this equals the manifest instead of asserting a number somebody typed.
 */
export const version = "0.3.0";

/**
 * Play a skinned or sprite animation from game code.
 * @situation play an animation on a character
 * @situation switch a character between idle and attack clips
 * @example const player = new AnimationPlayer(model);
 */
export { AnimationPlayer } from "./animation.js";
/**
 * Create the portable asset loader a scene also receives as `ctx.assets`.
 * @situation preload models, textures, or audio before a scene enters
 * @situation load assets from a nonstandard base path or a compiled asset manifest
 * @constraint reuse the loader handed to scenes as `ctx.assets` instead of building parallel caches
 * @example const assets = createAssetLoader({ basePath: "/assets" });
 * const rock = await assets.texture("rock.png");
 */
export { createAssetLoader } from "./assets.js";
export type { IAssetLoader, IAssetLoaderOptions } from "./assets.js";
export type { IAudioBusOptions, IAudioPlayOptions } from "./audio.js";
/**
 * Route effects through a named audio bus.
 * @situation play a sound effect with a volume bus
 * @situation mute or adjust a category of game audio
 * @situation keep a gunshot audible at 20 metres by tuning positional falloff
 * @constraint create buses before playing clips and dispose them with the game
 * @constraint refDistance and rolloffFactor tune positional falloff and apply to playAt only
 * @supersedes new Audio(
 * @example const effects = new AudioBus({ camera });
 */
export { AudioBus } from "./audio.js";
/**
 * Manage a camera or screen-facing canvas layer.
 * @situation place a HUD layer above the Three.js scene
 * @situation attach a canvas layer to a camera
 * @example const hud = new CanvasLayer({ camera });
 */
export { CanvasLayer } from "./canvas-layer.js";
export type {
  IThreeNativeBootSplash,
  IThreeNativeConfig,
  IThreeNativeIconVariants,
  IThreeNativeTexturesConfig,
  ThreeNativeOrientation,
} from "./config.js";
/**
 * Create a deterministic random source for portable gameplay.
 * @situation seed enemy patrol choices
 * @situation reproduce the same procedural level in a playtest
 * @constraint use the returned source instead of Math.random for replayable behavior
 * @supersedes Math.random(
 * @example const random = createRandom(42);
 */
export { createRandom } from "./random.js";
export type { IRandom } from "./random.js";
/**
 * Define the portable game entry shared by web and native.
 * @situation start a ThreeNative game from src/game.ts
 * @situation register physics and gameplay plugins
 * @constraint keep DOM and React mounting in src/main.ts
 * @example const game = defineGame({ scenes: { Play } });
 */
export { defineGame } from "./game.js";
export type {
  IGame,
  IGameObservationContribution,
  IGameObservationSampleRequest,
  IGamePluginHooks,
  IGamePluginRuntime,
  IGamePlatformSource,
} from "./game.js";
/**
 * Dispatch a game-owned particle surface and process function through a pooled system.
 * @situation emit sparks, smoke, or other transient effects
 * @situation update many small visual particles
 * @constraint geometry, color, and timing remain supplied by the game
 * @example const particles = new GPUParticles3D(particleOptions);
 */
export { GPUParticles3D } from "./particles.js";
/**
 * Build a soft round sprite as pixel data instead of painting a canvas.
 * @situation give smoke, flash, or glow sprites a radial alpha falloff
 * @situation generate sprite images that render identically under every backend
 * @constraint canvas-painted images sample black under WebGPURenderer; write sprites as pixel data there
 * @example const puff = softCircleDataTexture(64, 0.25);
 */
export { softCircleDataTexture } from "./textures.js";
/**
 * Pool travelling bullet-streak meshes for hitscan shots.
 * @situation show where a hitscan round went
 * @situation draw incoming fire without spawning projectiles
 * @constraint the surface comes from the game; pooling, travel, and fading belong to the engine
 * @constraint update once per frame and dispose with the owning scene
 * @example const tracers = new TracerPool3D(ctx.scene, tracerOptions);
 * tracers.spawn(muzzle, shotDirection, hit.distance);
 */
export { TracerPool3D } from "./tracers.js";
export type { ITracerPool3DOptions, ITracerSpawnOptions } from "./tracers.js";
/**
 * Move an object along a Three.js curve with Godot-style path following.
 * @situation move an enemy or prop along a patrol path
 * @situation sample a racing line from a curve
 * @example const follower = new PathFollow3D(curve, { loop: true });
 */
export { PathFollow3D } from "./path-follow.js";
/**
 * Keep a rendered model's feet on a surface while preserving an auditable override.
 * @situation keep a character's feet on the floor
 * @situation correct visual grounding after an animation update
 * @constraint import from `@threenative/core`; this moves the rendered model, not its physics collider
 * @override enabled controls whether correction is applied while clearance is still measured
 * @example import { GroundSnap } from "@threenative/core";
 * const snap = new GroundSnap(character, { enabled: true });
 */
export { GroundSnap } from "./grounding.js";
export type { IGroundSnapOptions } from "./grounding.js";
/**
 * Measure a Three.js pose for grounded or attachment-aware checks.
 * @situation inspect a skinned model's posed bounds
 * @situation verify a character's visual pose
 * @constraint precise per-vertex measurement is opt-in and not for frame loops
 * @example const measurement = measureThreePose(model);
 */
export { measureThreePose, posedBounds } from "./pose-measure.js";
export type {
  IMeasureThreePoseOptions,
  IThreePoseBounds,
  IThreePoseMeasurement,
  ThreePoseQuaternion,
  ThreePoseVector,
} from "./pose-measure.js";
export type {
  IPathFollow3DOptions,
  IPathFollow3DProjection,
  IPathFollow3DSample,
} from "./path-follow.js";
/**
 * Read the host platform without reaching for browser globals.
 * @situation branch a portable game on web or native
 * @situation choose touch controls for a mobile device
 * @constraint only use the returned platform facts; native globals are host-owned
 * @example if (isMobile()) showTouchControls();
 */
export { getPlatform, isMobile, isNative, isTouchscreenAvailable, isWeb } from "./platform.js";
export type {
  IPlatformInfo,
  PlatformFormFactor,
  PlatformOS,
  PlatformRuntime,
} from "./platform.js";
/**
 * Raycast the game scene using the framework's picker.
 * @situation select an object under the pointer
 * @situation interact with the first collider or mesh hit
 * @supersedes new Raycaster(
 * @example const picker = new ScenePicker({ camera, scene });
 */
export { ScenePicker } from "./picking.js";
export type { IRaycastOptions, IScenePickerOptions } from "./picking.js";
/**
 * Record or replay deterministic game input and state.
 * @situation reproduce a gameplay bug from recorded input
 * @situation run a deterministic replay in a playtest
 * @constraint use a seeded random source and fixed-step simulation for meaningful replays
 * @example const driver = createReplayDriver({ recording });
 */
export { createReplayDriver, replay } from "./replay.js";
export type { IReplayOptions, Recording } from "./replay.js";
/**
 * Validate and parse a replay recording file.
 * @situation validate a recording before replaying it in another host
 * @constraint recordings are version 1; the parser fails closed with TN_REPLAY_* codes
 * @example const recording = parseReplayRecording(rawRecording);
 */
export { parseReplayRecording } from "./replay-protocol.js";
export type {
  IReplayRecording,
  IReplayRecordingSample,
  ReplayPointer,
} from "./replay-protocol.js";
/**
 * Schedule delayed and repeating callbacks with game-owned cleanup.
 * @situation delay an enemy patrol transition
 * @situation run a callback every simulation tick
 * @constraint dispose returned handles when the owning scene exits
 * @example const scheduler = new Scheduler();
 */
export { Scheduler } from "./schedule.js";
export type { ScheduleHandle } from "./schedule.js";
/**
 * Implement a portable Godot-shaped game scene lifecycle.
 * @situation add a playable level or menu scene
 * @situation move scene setup and per-frame gameplay out of the entry point
 * @constraint scene code must stay portable across web and native
 * @example class Play extends Scene { update(ctx, dt) {} }
 */
export { Scene } from "./scene.js";
export type { ICtx, SceneFrame } from "./scene.js";
/**
 * Keep transient render surfaces in the renderer's pipeline cache before first use.
 * @situation prewarm a projectile, tracer, particle, or other transient effect
 * @situation avoid a long first-use frame for a newly visible effect
 * @constraint keep the surface visible with zero opacity; do not hide it with `visible = false`
 * @supersedes .visible = false
 * @example prewarm(tracerPool);
 */
export { prewarm } from "./renderer.js";
/**
 * Scale an asset to a real-world measurement and return the applied factor.
 * @situation make a character exactly 1.8 metres tall
 * @situation normalize a prop or weapon to a known longest axis
 * @constraint skinned height uses a crown bone; game-specific asset expectations stay in render code
 * @supersedes new Box3().setFromObject(
 * @example normaliseToMetres(character, { metres: 1.8, axis: "height" });
 */
export { normaliseToMetres } from "./scale.js";
export type { INormaliseToMetresOptions, NormaliseAxis } from "./scale.js";
/**
 * Attach a game-owned object to a named skeleton bone.
 * @situation put a weapon in a character's hand
 * @situation hold a rifle in a character's right hand
 * @situation add an enemy that patrols the level, chases the player when it sees them, and holds a rifle in its right hand
 * @situation attach an accessory to a skinned model
 * @constraint when a request is to hold or attach a weapon to a hand, import and call `attachToBone` from `@threenative/core`; do not manually parent, position, or rotate the rifle
 * @constraint if a stock visual has no skeleton, add a portable Three.js Bone named `RightHand` under the character, then call `attachToBone`; do not replace the helper with manual parenting
 * @example import { attachToBone } from "@threenative/core";
 * attachToBone(character, "RightHand", rifle);
 */
export { attachToBone, skeletonBones } from "./skeleton.js";
export type { ContextMenuPolicy, IInputAction, IRawInputPointer } from "./input.js";
