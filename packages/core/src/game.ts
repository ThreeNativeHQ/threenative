import { type Camera, OrthographicCamera, PerspectiveCamera, Scene as ThreeScene } from "three";
import { type AssetLoader, type AssetLoaderOptions, createAssetLoader } from "./assets.js";
import { type EntitySnapshot, Registry } from "./entities.js";
import { type InputBindings, InputMap } from "./input.js";
import { FixedStepLoop } from "./loop.js";
import { GPUParticles3D } from "./particles.js";
import { type Random, createRandom } from "./random.js";
import { type RendererLike, type RendererOptions, createRenderer } from "./renderer.js";
import type { Ctx, Scene, SceneConstructor, SceneFrame } from "./scene.js";
import { Scheduler } from "./schedule.js";
import { type GameStore, createGameStore } from "./state.js";
import { Viewport } from "./viewport.js";

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
  sceneExit?(ctx: Ctx<TState, TPhysics>): void;
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
  readonly camera?: CameraConfig;
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

export interface PerspectiveCameraConfig {
  readonly projection: "perspective";
  readonly fov?: number;
  readonly near?: number;
  readonly far?: number;
}

export interface OrthogonalCameraConfig {
  readonly projection: "orthogonal";
  readonly size: number;
  readonly near?: number;
  readonly far?: number;
}

export type CameraConfig = PerspectiveCameraConfig | OrthogonalCameraConfig;

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

function positiveCameraValue(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`camera.${name} must be finite and positive.`);
  return value;
}

function validateCameraConfig(config: CameraConfig | undefined): void {
  if (config === undefined) return;
  const near = positiveCameraValue("near", config.near ?? 0.1);
  const far = positiveCameraValue("far", config.far ?? 2_000);
  if (far <= near) throw new Error("camera.far must be greater than camera.near.");
  if (config.projection === "perspective") {
    const fov = config.fov ?? 60;
    if (!Number.isFinite(fov) || fov <= 0 || fov >= 180)
      throw new Error("camera.fov must be finite and between 0 and 180 degrees.");
    return;
  }
  positiveCameraValue("size", config.size);
}

function clearScene(scene: ThreeScene, particles: Set<GPUParticles3D>): void {
  for (const particle of particles) particle.detach();
  particles.clear();
  scene.clear();
  scene.background = null;
  scene.environment = null;
  scene.fog = null;
}

function createCamera(config: CameraConfig | undefined): Camera {
  if (config === undefined) return new PerspectiveCamera(60, 1, 0.1, 2_000);
  validateCameraConfig(config);
  const near = config.near ?? 0.1;
  const far = config.far ?? 2_000;
  if (config.projection === "perspective")
    return new PerspectiveCamera(config.fov ?? 60, 1, near, far);
  const size = config.size;
  return new OrthographicCamera(-size, size, size, -size, near, far);
}

class GameImpl<TState extends Record<string, unknown>, TPhysics> implements Game<TState, TPhysics> {
  #config: GameConfig<TState, TPhysics>;
  #ctx: Ctx<TState, TPhysics> | undefined;
  #scene: Scene<TState, TPhysics> | undefined;
  #sceneFrame: SceneFrame<TState, TPhysics> | undefined;
  #renderer: RendererLike | undefined;
  #viewport: Viewport | undefined;
  #input: InputMap | undefined;
  #state: GameStore<TState>;
  #loop: FixedStepLoop | undefined;
  #cleanup: Array<() => void> = [];
  #particles = new Set<GPUParticles3D>();
  #entities: Registry | undefined;
  #random: Random | undefined;
  #scheduler: Scheduler | undefined;
  #paused = false;
  #started = false;

  constructor(config: GameConfig<TState, TPhysics>) {
    this.#config = config;
    validateCameraConfig(config.camera);
    const startScene = this.#config.scenes[this.#config.start];
    if (startScene === undefined) throw new Error(`Unknown start scene '${this.#config.start}'.`);
    const initialState =
      this.#config.initialState ??
      (startScene as SceneConstructor<TState, TPhysics> & { initialState?: TState }).initialState;
    if (initialState === undefined) {
      throw new Error(
        `Scene '${this.#config.start}' must declare static initialState or provide config.initialState.`,
      );
    }
    this.#state = createGameStore(initialState, this.#config.stateFlushMs);
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

    this.#sceneFrame = undefined;
    this.#scene?.exit(ctx);
    this.#scheduler?.clear();
    this.#entities?.clear();
    for (const plugin of this.#config.plugins ?? []) {
      if (typeof plugin !== "function") plugin.sceneExit?.(ctx);
    }
    clearScene(ctx.scene, this.#particles);
    const scene = new SceneType();
    this.#scene = scene;
    const loaded = scene.load(ctx);
    if (loaded === undefined) {
      this.#enterScene(scene, ctx);
      return Promise.resolve();
    }
    return Promise.resolve(loaded).then(() => this.#enterScene(scene, ctx));
  }

  #enterScene(scene: Scene<TState, TPhysics>, ctx: Ctx<TState, TPhysics>): void {
    const frame = scene.enter(ctx);
    if (frame !== undefined && typeof frame !== "function") {
      throw new Error("Scene.enter() must return a frame function or undefined.");
    }
    // A boot scene may synchronously navigate to its destination from enter().
    // In that case, #goto() has already installed the destination frame; do not
    // overwrite it with the boot scene's undefined return value.
    if (this.#scene !== scene) return;
    this.#sceneFrame = typeof frame === "function" ? frame : undefined;
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
    const camera = createCamera(this.#config.camera);
    const viewport = new Viewport({ camera, renderer: this.#renderer });
    this.#viewport = viewport;
    const assets = createAssetLoader(this.#config.assets);
    const entities = new Registry();
    const random = createRandom(this.#config.seed);
    const scheduler = new Scheduler();
    const loopState: { current?: FixedStepLoop } = {};
    const ctx: Ctx<TState, TPhysics> = {
      add: (object) => {
        threeScene.add(object);
        if (object instanceof GPUParticles3D) {
          const renderer = this.#renderer;
          if (renderer === undefined)
            throw new Error("Cannot add particles before the game starts.");
          object.attachRenderer(renderer);
          this.#particles.add(object);
        }
        return object;
      },
      assets,
      after: (delay, callback) => scheduler.after(delay, callback),
      camera,
      entities,
      every: (callback) => scheduler.every(callback),
      get fps() {
        return loopState.current?.fps ?? 0;
      },
      goto: (name) => this.#goto(name, ctx),
      input: this.#input,
      physics: undefined as TPhysics,
      random,
      renderer: this.#renderer,
      viewport,
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
    const gameLoop = new FixedStepLoop({
      maxSteps: this.#config.maxSteps,
      onRender: () => {
        for (const particle of this.#particles) {
          if (particle.released || particle.parent === null) {
            particle.detach();
            this.#particles.delete(particle);
          } else {
            particle.process(this.#renderer);
          }
        }
        this.#renderer?.render(threeScene, camera);
        this.#scene?.render(ctx);
      },
      onUpdate: (dt) => {
        if (this.#paused) return;
        this.#input?.tick();
        scheduler.tick(dt);
        if (this.#sceneFrame !== undefined) this.#sceneFrame(ctx, dt);
        else this.#scene?.update(ctx, dt);
        for (const plugin of this.#config.plugins ?? []) {
          if (typeof plugin !== "function") plugin.update?.(ctx, dt);
        }
      },
      step: this.#config.step,
    });
    loopState.current = gameLoop;
    this.#loop = gameLoop;
    const runtime: GamePluginRuntime = {
      fixedStep: (ticks) => gameLoop.advance(ticks),
      seed: this.#config.seed ?? null,
    };
    for (const plugin of this.#config.plugins ?? []) {
      const cleanup =
        typeof plugin === "function" ? plugin(ctx) : await plugin.setup?.(ctx, runtime);
      if (cleanup !== undefined) this.#cleanup.push(cleanup);
    }
    await this.#scene.load(ctx);
    this.#enterScene(this.#scene, ctx);
    this.#started = true;
    gameLoop.start();
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
    if (this.#ctx !== undefined) this.#scene?.exit(this.#ctx);
    this.#sceneFrame = undefined;
    this.#scheduler?.clear();
    this.#entities?.clear();
    this.#entities = undefined;
    for (const plugin of this.#config.plugins ?? []) {
      if (typeof plugin !== "function" && this.#ctx !== undefined) plugin.dispose?.(this.#ctx);
    }
    for (const cleanup of this.#cleanup.splice(0)) cleanup();
    if (this.#ctx !== undefined) clearScene(this.#ctx.scene, this.#particles);
    this.#input?.dispose();
    this.#state.stop();
    this.#viewport?.dispose();
    this.#renderer?.dispose();
    this.#renderer = undefined;
    this.#viewport = undefined;
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
