import type { Camera, Intersection, Object3D, Scene as ThreeScene } from "three";
import type { IAssetLoader } from "./assets.js";
import type { CanvasLayer } from "./canvas-layer.js";
import type { Registry } from "./entities.js";
import type { InputMap } from "./input.js";
import type { IRaycastOptions } from "./picking.js";
import type { IRandom } from "./random.js";
import type { IRendererLike } from "./renderer.js";
import type { ScheduleHandle } from "./schedule.js";
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

export interface IStartupStatus {
  /**
   * `collapsing` until first-use work and a sustained in-budget frame window complete, `ready`
   * once the world is safe to show.
   */
  readonly phase: "observing" | "collapsing" | "ready";
  /** 0 while first-use work or the sustained frame window is pending, then 1. */
  readonly progress: number;
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
  readonly add: (object: Object3D) => Object3D;
  readonly input: InputMap;
  readonly assets: IAssetLoader;
  readonly after: (delay: number, callback: () => void) => ScheduleHandle;
  readonly every: (callback: (dt: number) => void) => ScheduleHandle;
  readonly state: GameStore<TState>;
  readonly tween: <T extends object>(
    target: T,
    properties: { [K in keyof T]?: number },
    duration: number,
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
