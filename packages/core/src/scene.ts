import type { Camera, Intersection, Object3D, Scene as ThreeScene } from "three";
import type { AssetLoader } from "./assets.js";
import type { Registry } from "./entities.js";
import type { InputMap } from "./input.js";
import type { RaycastOptions } from "./picking.js";
import type { Random } from "./random.js";
import type { RendererLike } from "./renderer.js";
import type { ScheduleHandle } from "./schedule.js";
import type { GameStore } from "./state.js";
import type { Viewport } from "./viewport.js";

export abstract class Scene<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> {
  static readonly initialState: Record<string, unknown> | undefined = undefined;

  load(_ctx: Ctx<TState, TPhysics>): void | Promise<void> {}

  enter(_ctx: Ctx<TState, TPhysics>): SceneEnterResult<TState, TPhysics> {
    return undefined;
  }

  exit(_ctx: Ctx<TState, TPhysics>): void {}

  update(_ctx: Ctx<TState, TPhysics>, _dt: number): void {}

  render(_ctx: Ctx<TState, TPhysics>): void {}
}

export type SceneConstructor<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> = new () => Scene<TState, TPhysics>;

export type SceneFrame<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> = (ctx: Ctx<TState, TPhysics>, dt: number) => void;

export type SceneEnterResult<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> = // biome-ignore lint/suspicious/noConfusingVoidType: void preserves existing Scene.enter overrides.
void | SceneFrame<TState, TPhysics>;

export interface StartupStatus {
  /**
   * `observing` while the collapse watches what moves, `collapsing` during the single frame it
   * bakes in, `ready` once the world is safe to show.
   */
  readonly phase: "observing" | "collapsing" | "ready";
  /** 0 to 1 across the observation window, then 1. Real progress for the part that has any. */
  readonly progress: number;
  /** Resolves on every path, including a scene too small to collapse, so it is always awaitable. */
  whenReady(): Promise<void>;
}

export interface Ctx<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> {
  readonly fps: number;
  readonly renderer: RendererLike;
  readonly viewport: Viewport;
  readonly scene: ThreeScene;
  readonly camera: Camera;
  readonly entities: Registry;
  readonly add: (object: Object3D) => Object3D;
  readonly input: InputMap;
  readonly assets: AssetLoader;
  readonly after: (delay: number, callback: () => void) => ScheduleHandle;
  readonly every: (callback: (dt: number) => void) => ScheduleHandle;
  readonly state: GameStore<TState>;
  readonly tween: <T extends object>(
    target: T,
    properties: { [K in keyof T]?: number },
    duration: number,
  ) => Promise<void>;
  readonly random: Random;
  readonly raycast: (options?: RaycastOptions) => Intersection | undefined;
  /**
   * The framework's own startup work — what a loading screen waits on.
   *
   * Two costs land before a game is ready and both are real: each shader is compiled the first
   * time something using it is drawn, and the scene collapse runs inside a single frame. On a
   * Pixel 8 that was 2.5 s of half-drawn map followed by a 3.2 s stall, measured.
   *
   * Keeping the world hidden until `whenReady()` resolves does more than hide the mess: the
   * shaders that would have been compiled for geometry the collapse then throws away are never
   * compiled at all, so waiting is *faster* than not waiting.
   */
  readonly startup: StartupStatus;
  readonly goto: (name: string) => Promise<void>;
  physics: TPhysics;
}
