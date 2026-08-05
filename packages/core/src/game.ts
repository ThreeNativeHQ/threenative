import { PerspectiveCamera, Scene as ThreeScene } from "three";
import { type AssetLoader, type AssetLoaderOptions, createAssetLoader } from "./assets.js";
import { type EntitySnapshot, Registry } from "./entities.js";
import { type InputBindings, InputMap } from "./input.js";
import { FixedStepLoop } from "./loop.js";
import { type Random, createRandom } from "./random.js";
import { type RendererLike, type RendererOptions, createRenderer } from "./renderer.js";
import type { Ctx, Scene, SceneConstructor } from "./scene.js";
import { Scheduler } from "./schedule.js";
import { type GameStore, createGameStore } from "./state.js";

export type PluginCleanup = () => void;

export interface GamePluginRuntime {
  fixedStep(ticks: number): number;
  readonly seed: number | null;
}

interface DevTools {
  snapshot(): EntitySnapshot;
}

declare global {
  interface Window {
    __THREENATIVE__?: DevTools;
  }
}

function installDevTools(entities: Registry): PluginCleanup {
  const isDev = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;
  if (!isDev || typeof window === "undefined") return () => undefined;
  const devTools: DevTools = { snapshot: () => entities.snapshot() };
  window.__THREENATIVE__ = devTools;
  return () => {
    if (window.__THREENATIVE__ === devTools) window.__THREENATIVE__ = undefined;
  };
}

export type GamePluginFunction<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> = (ctx: Ctx<TState, TPhysics>) => undefined | PluginCleanup;

export interface GamePluginHooks<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> {
  setup?(
    ctx: Ctx<TState, TPhysics>,
    runtime?: GamePluginRuntime,
  ): undefined | PluginCleanup | Promise<undefined | PluginCleanup>;
  update?(ctx: Ctx<TState, TPhysics>, dt: number): void;
  dispose?(ctx: Ctx<TState, TPhysics>): void;
}

export type GamePlugin<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> = GamePluginFunction<TState, TPhysics> | GamePluginHooks<TState, TPhysics>;

export interface GameConfig<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> {
  readonly assets?: AssetLoaderOptions;
  readonly canvas?: HTMLCanvasElement;
  readonly container?: HTMLElement;
  readonly input?: InputBindings;
  readonly initialState?: TState;
  readonly maxSteps?: number;
  readonly plugins?: readonly GamePlugin<TState, TPhysics>[];
  readonly render?: Pick<RendererOptions, "preferWebGPU">;
  readonly renderer?: RendererOptions;
  readonly seed?: number;
  readonly scenes: Record<string, SceneConstructor<TState, TPhysics>>;
  readonly step?: number;
  readonly start: string;
  readonly stateFlushMs?: number;
}

export interface Game<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> {
  readonly ctx: Ctx<TState, TPhysics> | undefined;
  readonly scene: Scene<TState, TPhysics> | undefined;
  readonly state: GameStore<TState>;
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
}

class GameImpl<TState extends Record<string, unknown>, TPhysics> implements Game<TState, TPhysics> {
  #config: GameConfig<TState, TPhysics>;
  #ctx: Ctx<TState, TPhysics> | undefined;
  #scene: Scene<TState, TPhysics> | undefined;
  #renderer: RendererLike | undefined;
  #input: InputMap | undefined;
  #state: GameStore<TState>;
  #loop: FixedStepLoop | undefined;
  #cleanup: Array<() => void> = [];
  #entities: Registry | undefined;
  #random: Random | undefined;
  #scheduler: Scheduler | undefined;
  #paused = false;
  #started = false;

  constructor(config: GameConfig<TState, TPhysics>) {
    this.#config = config;
    this.#state = createGameStore(
      this.#config.initialState ?? ({} as TState),
      this.#config.stateFlushMs,
    );
  }

  get ctx(): Ctx<TState, TPhysics> | undefined {
    return this.#ctx;
  }

  get scene(): Scene<TState, TPhysics> | undefined {
    return this.#scene;
  }

  get state(): GameStore<TState> {
    return this.#state;
  }

  #goto(name: string, ctx: Ctx<TState, TPhysics>): Promise<void> {
    const SceneType = this.#config.scenes[name];
    if (SceneType === undefined) throw new Error(`Unknown scene '${name}'.`);

    this.#scheduler?.clear();
    this.#scene?.exit(ctx);
    this.#entities?.clear();
    const scene = new SceneType();
    this.#scene = scene;
    const loaded = scene.load(ctx);
    if (loaded === undefined) {
      scene.enter(ctx);
      return Promise.resolve();
    }
    return Promise.resolve(loaded).then(() => scene.enter(ctx));
  }

  async start(): Promise<void> {
    if (this.#started) return;
    const SceneType = this.#config.scenes[this.#config.start];
    if (SceneType === undefined) throw new Error(`Unknown start scene '${this.#config.start}'.`);

    this.#renderer = await createRenderer({
      ...this.#config.renderer,
      canvas: this.#config.canvas ?? this.#config.renderer?.canvas,
      preferWebGPU: this.#config.render?.preferWebGPU ?? this.#config.renderer?.preferWebGPU,
    });
    const canvas = this.#renderer.domElement;
    if (this.#config.container !== undefined && canvas.parentElement !== this.#config.container) {
      this.#config.container.append(canvas);
    } else if (canvas.parentElement === null && typeof document !== "undefined") {
      document.body.append(canvas);
    }

    const inputTarget = typeof window === "undefined" ? canvas : window;
    this.#input = new InputMap(this.#config.input, inputTarget, canvas);
    this.#state.start();
    const threeScene = new ThreeScene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 2_000);
    const assets = createAssetLoader(this.#config.assets);
    const entities = new Registry();
    const random = createRandom(this.#config.seed);
    const scheduler = new Scheduler();
    const ctx: Ctx<TState, TPhysics> = {
      add: (object) => {
        threeScene.add(object);
        return object;
      },
      assets,
      after: (delay, callback) => scheduler.after(delay, callback),
      camera,
      entities,
      every: (callback) => scheduler.every(callback),
      goto: (name) => this.#goto(name, ctx),
      input: this.#input,
      physics: undefined as TPhysics,
      random,
      renderer: this.#renderer,
      scene: threeScene,
      state: this.#state,
      tween: (target, properties, duration) => scheduler.tween(target, properties, duration),
    };
    this.#ctx = ctx;
    this.#entities = entities;
    this.#random = random;
    this.#scheduler = scheduler;
    this.#cleanup.push(installDevTools(entities));
    this.#scene = new SceneType();
    const loop = new FixedStepLoop({
      maxSteps: this.#config.maxSteps,
      onRender: () => {
        this.#renderer?.render(threeScene, camera);
        this.#scene?.render(ctx);
      },
      onUpdate: (dt) => {
        if (this.#paused) return;
        this.#input?.tick();
        scheduler.tick(dt);
        this.#scene?.update(ctx, dt);
        for (const plugin of this.#config.plugins ?? []) {
          if (typeof plugin !== "function") plugin.update?.(ctx, dt);
        }
      },
      step: this.#config.step,
    });
    this.#loop = loop;
    const runtime: GamePluginRuntime = {
      fixedStep: (ticks) => loop.advance(ticks),
      seed: this.#config.seed ?? null,
    };
    for (const plugin of this.#config.plugins ?? []) {
      const cleanup =
        typeof plugin === "function" ? plugin(ctx) : await plugin.setup?.(ctx, runtime);
      if (cleanup !== undefined) this.#cleanup.push(cleanup);
    }
    await this.#scene.load(ctx);
    this.#scene.enter(ctx);
    this.#started = true;
    loop.start();
  }

  pause(): void {
    this.#paused = true;
  }

  resume(): void {
    this.#paused = false;
  }

  stop(): void {
    if (!this.#started) return;
    this.#loop?.stop();
    this.#scheduler?.clear();
    if (this.#ctx !== undefined) this.#scene?.exit(this.#ctx);
    this.#entities?.clear();
    this.#entities = undefined;
    for (const plugin of this.#config.plugins ?? []) {
      if (typeof plugin !== "function" && this.#ctx !== undefined) plugin.dispose?.(this.#ctx);
    }
    for (const cleanup of this.#cleanup.splice(0)) cleanup();
    this.#input?.dispose();
    this.#state.stop();
    this.#renderer?.dispose();
    this.#renderer = undefined;
    this.#input = undefined;
    this.#scene = undefined;
    this.#ctx = undefined;
    this.#loop = undefined;
    this.#random = undefined;
    this.#scheduler = undefined;
    this.#paused = false;
    this.#started = false;
  }
}

export function defineGame<TState extends Record<string, unknown>, TPhysics = undefined>(
  config: GameConfig<TState, TPhysics>,
): Game<TState, TPhysics> {
  return new GameImpl<TState, TPhysics>(config);
}
