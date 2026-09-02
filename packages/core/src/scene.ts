import type { Camera, Intersection, Object3D, Scene as ThreeScene } from "three";
import type { IAssetLoader } from "./assets.js";
import type { CanvasLayer } from "./canvas-layer.js";
import type { Registry } from "./entities.js";
import type { InputMap } from "./input.js";
import type { IRaycastOptions } from "./picking.js";
import type { IPointerEvents3D } from "./pointer-events.js";
import type { IRandom } from "./random.js";
import type { IRendererLike } from "./renderer.js";
import type { ITweenOptions, ScheduleHandle } from "./schedule.js";
import type { GameStore } from "./state.js";
import type { Viewport } from "./viewport.js";

export abstract class Scene<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> {
  static readonly initialState: Record<string, unknown> | undefined = undefined;

  load(_ctx: ICtx<TState, TPhysics>): void | Promise<void> {}

  enter(_ctx: ICtx<TState, TPhysics>): SceneEnterResult<TState, TPhysics> {
    return undefined;
  }

  exit(_ctx: ICtx<TState, TPhysics>): void {}

  update(_ctx: ICtx<TState, TPhysics>, _dt: number): void {}

  render(_ctx: ICtx<TState, TPhysics>): void {}
}

export type SceneConstructor<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> = new () => Scene<TState, TPhysics>;

export type SceneFrame<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> = (ctx: ICtx<TState, TPhysics>, dt: number) => void;

export type SceneEnterResult<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> = // biome-ignore lint/suspicious/noConfusingVoidType: void preserves existing Scene.enter overrides.
void | SceneFrame<TState, TPhysics>;

/**
 * When the framework's startup milestones happened, in milliseconds on the host's monotonic
 * clock (`performance.now()`: since navigation on the web, since process start on native).
 *
 * Absent members have not happened yet. Published to the playtest bridge so a scenario asserts
 * startup time as an observation rather than reading it off a console log.
 */
export interface IStartupTimeline {
  /** The start scene's `load()` began. */
  readonly loadStartedMs?: number;
  /** The start scene's `enter()` returned: the world is built and the loop can move. */
  readonly enteredMs?: number;
  /** First-use compilation settled or its budget expired. */
  readonly compileSettledMs?: number;
  /** `whenReady()` resolved: the world is safe to show. */
  readonly readyMs?: number;
}

export interface IStartupStatus {
  /**
   * True once first-use compilation has settled — earlier than `phase === "ready"`, which also
   * waits for a sustained in-budget frame window.
   *
   * This is the signal a game wants when something must not run during the launch. `phase` cannot
   * express it: it is binary, and on a software rasteriser the frame window can only ever expire
   * rather than be met, so a game gated on `phase` alone does nothing for tens of seconds there.
   * Measured as a chase route of length `0.000000` against a required `6`, because the scenario
   * ended before the window did.
   */
  readonly compileSettled: boolean;
  /**
   * `collapsing` until first-use work and a sustained in-budget frame window complete, `ready`
   * once the world is safe to show.
   */
  readonly phase: "observing" | "collapsing" | "ready";
  /**
   * 0 to 1, monotonic and honest: the loader's settled/requested ratio carries the first 0.7
   * while the start scene loads, 0.8 once the world is entered, 0.9 once first-use compilation
   * settled, 1 when `whenReady()` resolves.
   */
  readonly progress: number;
  /** When each milestone happened; members appear as they are reached. */
  readonly timeline: IStartupTimeline;
  /** Resolves after first-use work and the sustained frame window, so it is always awaitable. */
  whenReady(): Promise<void>;
}

export interface ICtx<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> {
  readonly fps: number;
  readonly renderer: IRendererLike;
  readonly viewport: Viewport;
  readonly scene: ThreeScene;
  readonly camera: Camera;
  readonly canvasLayer: CanvasLayer;
  readonly entities: Registry;
  /**
   * Adds a node to the scene and hands it straight back, with its own type intact.
   *
   * Generic rather than `Object3D` because a game writes `const sea = ctx.add(new SpectralOcean())`
   * and then calls a method on it. Erasing the type here makes every typed node in every scene need
   * a cast back to what it already was, and that cast is where a game stops noticing it is holding
   * something else.
   */
  readonly add: <T extends Object3D>(object: T) => T;
  readonly input: InputMap;
  readonly pointer: IPointerEvents3D;
  readonly assets: IAssetLoader;
  readonly after: (delay: number, callback: () => void) => ScheduleHandle;
  readonly every: (callback: (dt: number) => void) => ScheduleHandle;
  readonly state: GameStore<TState>;
  readonly tween: <T extends object>(
    target: T,
    properties: { [K in keyof T]?: number },
    duration: number,
    options?: ITweenOptions,
  ) => Promise<void>;
  readonly random: IRandom;
  readonly raycast: (options?: IRaycastOptions) => Intersection | undefined;
  readonly raycastAll: (
    options?: IRaycastOptions,
    target?: Intersection[],
  ) => readonly Intersection[];
  /**
   * The framework's own startup work — what a loading screen waits on.
   *
   * A shader may compile the first time something using it is drawn, and the render projection may
   * do its first build in that same frame. Both costs are real and belong before the world is shown.
   *
   * Keeping the world hidden until `whenReady()` resolves does more than hide the mess: the
   * shaders that would have been compiled for geometry the projection then discards are never
   * compiled at all, so waiting is *faster* than not waiting.
   */
  readonly startup: IStartupStatus;
  readonly goto: (name: string) => Promise<void>;
  physics: TPhysics;
}
