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
import { Viewport, type ViewportOptions } from "./viewport.js";

export type PluginCleanup = () => void;

export interface GamePluginRuntime {
  fixedStep(ticks: number): number;
  readonly random?: Pick<Random, "state">;
  rapier?: string | null;
  readonly seed: number | null;
  readonly step: number;
}

interface DevTools {
  snapshot(): EntitySnapshot;
}

type DevToolsHost = Record<string, unknown> & { __THREENATIVE__?: DevTools };

export interface GamePlatformSource {
  readonly devToolsHost?: Record<string, unknown>;
  readonly input: NonNullable<ConstructorParameters<typeof InputMap>[3]>;
  readonly inputTarget?: EventTarget;
  readonly renderer: NonNullable<RendererOptions["source"]>;
  readonly viewport: NonNullable<ViewportOptions["source"]>;
  mountCanvas(canvas: HTMLCanvasElement, container?: HTMLElement): void;
  unmountCanvas(canvas: HTMLCanvasElement): void;
}

function installDevTools(entities: Registry, host: DevToolsHost | undefined): PluginCleanup {
  const isDev = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;
  if (!isDev || host === undefined) return () => undefined;
  const devTools: DevTools = {
    ...(host.__THREENATIVE__ as (DevTools & Record<string, unknown>) | undefined),
    snapshot: () => entities.snapshot(),
  };
  host.__THREENATIVE__ = devTools;
  return () => {
    if (host.__THREENATIVE__ !== devTools) return;
    const remaining = Object.fromEntries(
      Object.entries(devTools).filter(([key]) => key !== "snapshot"),
    );
    host.__THREENATIVE__ =
      Object.keys(remaining).length === 0 ? undefined : (remaining as unknown as DevTools);
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
  beforeUpdate?(ctx: Ctx<TState, TPhysics>, dt: number): void;
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
  readonly inputTarget?: EventTarget;
  readonly maxSteps?: number;
  readonly platform?: GamePlatformSource;
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
  /** Rebuilds the requested scene from the game's declared initial state. */
  goto(name: string): Promise<void>;
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
  #initialState: TState;
  #loop: FixedStepLoop | undefined;
  #cleanup: Array<() => void> = [];
  #particles = new Set<GPUParticles3D>();
  #entities: Registry | undefined;
  #random: Random | undefined;
  #scheduler: Scheduler | undefined;
  #activePlugins: Array<GamePluginHooks<TState, TPhysics>> = [];
  #disposedPlugins = new Set<GamePluginHooks<TState, TPhysics>>();
  #pendingStart: Promise<void> | undefined;
  #aborted = false;
  #sceneEntered = false;
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
    this.#initialState = { ...initialState };
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

  goto(name: string): Promise<void> {
    if (this.#ctx === undefined) throw new Error("Cannot call game.goto() before start().");
    this.#state.stop();
    this.#state.setState({ ...this.#initialState });
    this.#state.start();
    return this.#goto(name, this.#ctx);
  }

  #goto(name: string, ctx: Ctx<TState, TPhysics>): Promise<void> {
    const SceneType = this.#config.scenes[name];
    if (SceneType === undefined) throw new Error(`Unknown scene '${name}'.`);

    this.#sceneFrame = undefined;
    this.#scene?.exit(ctx);
    this.#sceneEntered = false;
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
    this.#sceneEntered = true;
  }

  start(): Promise<void> {
    if (this.#started) return Promise.resolve();
    if (this.#pendingStart !== undefined) return this.#pendingStart;
    this.#aborted = false;
    const pendingStart = this.#boot();
    this.#pendingStart = pendingStart;
    void pendingStart.then(
      () => {
        if (this.#pendingStart === pendingStart) this.#pendingStart = undefined;
      },
      () => {
        if (this.#pendingStart === pendingStart) this.#pendingStart = undefined;
      },
    );
    return pendingStart;
  }

  async #boot(): Promise<void> {
    const SceneType = this.#config.scenes[this.#config.start];
    if (SceneType === undefined) throw new Error(`Unknown start scene '${this.#config.start}'.`);

    const renderer = await createRenderer({
      ...this.#config.renderer,
      canvas: this.#config.canvas ?? this.#config.renderer?.canvas,
      preferWebGPU: this.#config.render?.preferWebGPU ?? this.#config.renderer?.preferWebGPU,
      source: this.#config.renderer?.source ?? this.#config.platform?.renderer,
    });
    if (this.#aborted) {
      renderer.dispose();
      return;
    }
    this.#renderer = renderer;
    const canvas = renderer.domElement;
    const platform = this.#config.platform;
    if (platform !== undefined) platform.mountCanvas(canvas, this.#config.container);
    else if (
      this.#config.container !== undefined &&
      canvas.parentElement !== this.#config.container
    )
      this.#config.container.append(canvas);
    else if (canvas.parentElement === null && typeof document !== "undefined")
      document.body.append(canvas);

    const inputTarget =
      this.#config.inputTarget ??
      (platform === undefined
        ? typeof window === "undefined"
          ? canvas
          : window
        : (platform.inputTarget ?? canvas));
    this.#input = new InputMap(this.#config.input, inputTarget, canvas, platform?.input);
    this.#state.start();
    const threeScene = new ThreeScene();
    const camera = createCamera(this.#config.camera);
    const viewport = new Viewport({ camera, renderer: this.#renderer, source: platform?.viewport });
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
          const activeRenderer = this.#renderer;
          if (activeRenderer === undefined)
            throw new Error("Cannot add particles before the game starts.");
          object.attachRenderer(activeRenderer);
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
    const devToolsHost =
      platform === undefined
        ? typeof window === "undefined"
          ? undefined
          : window
        : platform.devToolsHost;
    this.#cleanup.push(installDevTools(entities, devToolsHost as DevToolsHost | undefined));
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
        renderer.render(threeScene, camera);
        this.#scene?.render(ctx);
      },
      onUpdate: (dt) => {
        if (this.#paused) return;
        this.#input?.tick();
        scheduler.tick(dt);
        for (const plugin of this.#activePlugins) plugin.beforeUpdate?.(ctx, dt);
        const scene = this.#scene;
        const frame = this.#sceneFrame;
        if (frame !== undefined) frame(ctx, dt);
        else scene?.update(ctx, dt);
        if (this.#scene !== scene || this.#sceneFrame !== frame) return;
        for (const plugin of this.#activePlugins) plugin.update?.(ctx, dt);
      },
      step: this.#config.step,
    });
    loopState.current = gameLoop;
    this.#loop = gameLoop;
    const runtime: GamePluginRuntime = {
      fixedStep: (ticks) => gameLoop.advance(ticks),
      random,
      rapier: null,
      seed: this.#config.seed ?? null,
      step: gameLoop.step,
    };
    for (const plugin of this.#config.plugins ?? []) {
      const cleanup =
        typeof plugin === "function" ? plugin(ctx) : await plugin.setup?.(ctx, runtime);
      if (typeof plugin !== "function") this.#activePlugins.push(plugin);
      if (this.#aborted) {
        if (cleanup !== undefined) this.#cleanup.push(cleanup);
        this.#teardown(ctx);
        return;
      }
      if (cleanup !== undefined) this.#cleanup.push(cleanup);
    }
    const scene = this.#scene;
    if (scene === undefined) {
      this.#teardown(ctx);
      return;
    }
    await scene.load(ctx);
    if (this.#aborted) {
      this.#teardown(ctx);
      return;
    }
    this.#enterScene(scene, ctx);
    if (this.#aborted) {
      this.#teardown(ctx);
      return;
    }
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
    this.#aborted = true;
    this.#teardown();
  }

  #disposePlugin(plugin: GamePluginHooks<TState, TPhysics>, ctx: Ctx<TState, TPhysics>): void {
    if (this.#disposedPlugins.has(plugin)) return;
    this.#disposedPlugins.add(plugin);
    plugin.dispose?.(ctx);
  }

  #teardown(startingCtx?: Ctx<TState, TPhysics>): void {
    const ctx = this.#ctx ?? startingCtx;
    this.#loop?.stop();
    if (this.#sceneEntered && ctx !== undefined) this.#scene?.exit(ctx);
    this.#sceneFrame = undefined;
    this.#sceneEntered = false;
    this.#scheduler?.clear();
    this.#entities?.clear();
    this.#entities = undefined;
    if (ctx !== undefined)
      for (const plugin of this.#activePlugins) this.#disposePlugin(plugin, ctx);
    this.#activePlugins = [];
    for (const cleanup of this.#cleanup.splice(0)) cleanup();
    if (ctx !== undefined) clearScene(ctx.scene, this.#particles);
    this.#input?.dispose();
    this.#state.stop();
    this.#viewport?.dispose();
    const renderer = this.#renderer;
    renderer?.dispose();
    if (renderer !== undefined) {
      if (this.#config.platform === undefined) renderer.domElement.remove?.();
      else this.#config.platform.unmountCanvas(renderer.domElement);
    }
    this.#renderer = undefined;
    this.#viewport = undefined;
    this.#input = undefined;
    this.#scene = undefined;
    this.#ctx = undefined;
    this.#loop = undefined;
    this.#random = undefined;
    this.#scheduler = undefined;
    this.#disposedPlugins.clear();
    this.#paused = false;
    this.#started = false;
  }
}

export function defineGame<TState extends Record<string, unknown>, TPhysics = undefined>(
  config: GameConfig<TState, TPhysics>,
): Game<TState, TPhysics> {
  return new GameImpl<TState, TPhysics>(config);
}
