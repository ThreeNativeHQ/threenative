import { type Camera, OrthographicCamera, PerspectiveCamera, Scene as ThreeScene } from "three";
import { type IAssetLoader, type IAssetLoaderOptions, createAssetLoader } from "./assets.js";
import { CanvasLayer } from "./canvas-layer.js";
import { type EntitySnapshot, Registry } from "./entities.js";
import { type ContextMenuPolicy, type InputBindings, InputMap } from "./input.js";
import {
  FixedStepLoop,
  type IRenderPerformanceMetrics,
  type IRenderPerformanceSample,
} from "./loop.js";
import { GPUParticles3D } from "./particles.js";
import { ScenePicker } from "./picking.js";
import { type IRandom, createRandom } from "./random.js";
import { SceneRenderProjection } from "./renderProjection.js";
import { type IRendererLike, type IRendererOptions, createRenderer } from "./renderer.js";
import type { ICtx, Scene, SceneConstructor, SceneFrame } from "./scene.js";
import { Scheduler } from "./schedule.js";
import { type GameStore, createGameStore } from "./state.js";
import { type IViewportOptions, Viewport } from "./viewport.js";

export type PluginCleanup = () => void;

export interface IGameObservationSampleRequest {
  readonly entities?: readonly string[];
  readonly include?: readonly string[];
  readonly label?: string;
  readonly resources?: readonly string[];
}

export interface IGameObservationContribution {
  readonly capabilities: readonly string[];
  readonly sample: (request: IGameObservationSampleRequest) => Readonly<Record<string, unknown>>;
}

export interface IGameRuntimeObservations {
  contribute(contribution: IGameObservationContribution): PluginCleanup;
  contributions(): readonly IGameObservationContribution[];
}

export interface IGamePluginRuntime {
  readonly fixedStep: (ticks: number) => number;
  /**
   * Announces that a diagnostics consumer is going to read render metrics, turning per-frame
   * sample collection on for the rest of the run. Optional: a runtime without collection
   * support just never enables. Games collect nothing until this fires — the samples exist for
   * assertions, not for every frame of every game.
   */
  readonly enableRuntimeDiagnostics?: () => void;
  /**
   * Hold the frame loop until `gate` settles, after the start scene has entered.
   *
   * A plugin that blocks its own `setup` blocks it too early: entity-derived capabilities are
   * registered by the scene, which runs after plugin setup, so a runner reading `describe()`
   * during that hold sees a description missing them. Handing the gate here instead holds the
   * loop at the last possible moment — everything is registered, nothing has stepped.
   */
  readonly holdStart?: (gate: Promise<void>) => void;
  readonly observations: IGameRuntimeObservations;
  readonly tick: () => number;
  readonly runtimeDiagnosticsSeries?: () => readonly IRenderPerformanceSample[];
  readonly random?: Pick<IRandom, "state">;
  rapier?: string | null;
  readonly seed: number | null;
  readonly step: number;
}

interface IDevTools {
  snapshot(): EntitySnapshot;
}

type DevToolsHost = Record<string, unknown> & Partial<Record<"__THREENATIVE__", IDevTools>>;

export interface IGamePlatformSource {
  readonly devToolsHost?: Record<string, unknown>;
  readonly input: NonNullable<ConstructorParameters<typeof InputMap>[3]>;
  readonly inputTarget?: EventTarget;
  readonly renderer: NonNullable<IRendererOptions["source"]>;
  readonly viewport: NonNullable<IViewportOptions["source"]>;
  mountCanvas(canvas: HTMLCanvasElement, container?: HTMLElement): void;
  unmountCanvas(canvas: HTMLCanvasElement): void;
}

function installDevTools(entities: Registry, host: DevToolsHost | undefined): PluginCleanup {
  const isDev =
    (import.meta as ImportMeta & { env?: Record<"DEV", boolean | undefined> }).env?.DEV === true;
  if (!isDev || host === undefined) return () => undefined;
  const devTools: IDevTools = {
    ...(host.__THREENATIVE__ as (IDevTools & Record<string, unknown>) | undefined),
    snapshot: () => entities.snapshot(),
  };
  host.__THREENATIVE__ = devTools;
  return () => {
    if (host.__THREENATIVE__ !== devTools) return;
    const remaining = Object.fromEntries(
      Object.entries(devTools).filter(([key]) => key !== "snapshot"),
    );
    host.__THREENATIVE__ =
      Object.keys(remaining).length === 0 ? undefined : (remaining as unknown as IDevTools);
  };
}

export type GamePluginFunction<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> = (ctx: ICtx<TState, TPhysics>) => undefined | PluginCleanup;

export interface IGamePluginHooks<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> {
  setup?(
    ctx: ICtx<TState, TPhysics>,
    runtime?: IGamePluginRuntime,
  ): undefined | PluginCleanup | Promise<undefined | PluginCleanup>;
  beforeUpdate?(ctx: ICtx<TState, TPhysics>, dt: number): void;
  update?(ctx: ICtx<TState, TPhysics>, dt: number): void;
  sceneExit?(ctx: ICtx<TState, TPhysics>): void;
  dispose?(ctx: ICtx<TState, TPhysics>): void;
}

export type GamePlugin<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> = GamePluginFunction<TState, TPhysics> | IGamePluginHooks<TState, TPhysics>;

export interface IGameConfig<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> {
  readonly assets?: IAssetLoaderOptions;
  readonly camera?: CameraConfig;
  readonly canvas?: HTMLCanvasElement;
  readonly container?: HTMLElement;
  readonly input?: InputBindings;
  /**
   * Browser context menu over the game surface. Defaults to `"suppress"`, which is what a game
   * wants: right-click is a binding, not a menu. Set `"allow"` only if your game genuinely needs
   * the browser menu over its canvas.
   */
  readonly contextMenu?: ContextMenuPolicy;
  readonly initialState?: TState;
  readonly inputTarget?: EventTarget;
  /**
   * Maximum simulation steps per rendered frame. Default 5. Caps the catch-up burst after a
   * stall so a slow frame cannot cascade into a spiral of longer frames.
   */
  readonly maxSteps?: number;
  readonly platform?: IGamePlatformSource;
  readonly plugins?: readonly GamePlugin<TState, TPhysics>[];
  readonly render?: Pick<IRendererOptions, "preferWebGPU">;
  readonly renderer?: IRendererOptions;
  readonly seed?: number;
  readonly scenes: Record<string, SceneConstructor<TState, TPhysics>>;
  /**
   * Fixed simulation step in seconds, e.g. `1 / 60`. **This is the fixed-step knob a game
   * wants**; every `update(ctx, dt)` receives exactly this `dt`, never a variable frame time,
   * so gameplay and physics advance together and never see a stall.
   *
   * Do not write your own accumulator on top of this. Doing so runs the scene's update several
   * times per already-fixed step and decouples gameplay from the simulation — a real build lost
   * its largest wrong turn to exactly that, because this field carried no documentation.
   */
  readonly step?: number;
  readonly start: string;
  readonly stateFlushMs?: number;
}

export interface IPerspectiveCameraConfig {
  readonly projection: "perspective";
  readonly fov?: number;
  readonly near?: number;
  readonly far?: number;
}

export interface IOrthogonalCameraConfig {
  readonly projection: "orthogonal";
  readonly size: number;
  readonly near?: number;
  readonly far?: number;
}

export type CameraConfig = IPerspectiveCameraConfig | IOrthogonalCameraConfig;

export interface IGame<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TPhysics = undefined,
> {
  readonly ctx: ICtx<TState, TPhysics> | undefined;
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

function rendererPerformanceMetrics(raw: unknown): {
  drawCalls?: number;
  triangles?: number;
} {
  if (typeof raw !== "object" || raw === null) return {};
  const info = (raw as { info?: unknown }).info;
  if (typeof info !== "object" || info === null) return {};
  const render = (info as { render?: unknown }).render;
  if (typeof render !== "object" || render === null) return {};
  const drawCalls = (render as { drawCalls?: unknown }).drawCalls;
  const calls = drawCalls ?? (render as { calls?: unknown }).calls;
  const triangles = (render as { triangles?: unknown }).triangles;
  return {
    ...(typeof calls === "number" && Number.isFinite(calls) && calls >= 0
      ? { drawCalls: calls }
      : {}),
    ...(typeof triangles === "number" && Number.isFinite(triangles) && triangles >= 0
      ? { triangles }
      : {}),
  };
}

function addRenderPerformanceMetrics(
  world: IRenderPerformanceMetrics,
  overlay: IRenderPerformanceMetrics,
): IRenderPerformanceMetrics {
  return {
    ...(world.drawCalls === undefined || overlay.drawCalls === undefined
      ? {}
      : { drawCalls: world.drawCalls + overlay.drawCalls }),
    ...(world.triangles === undefined || overlay.triangles === undefined
      ? {}
      : { triangles: world.triangles + overlay.triangles }),
  };
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

class GameImpl<TState extends Record<string, unknown>, TPhysics>
  implements IGame<TState, TPhysics>
{
  #config: IGameConfig<TState, TPhysics>;
  #ctx: ICtx<TState, TPhysics> | undefined;
  #scene: Scene<TState, TPhysics> | undefined;
  #sceneFrame: SceneFrame<TState, TPhysics> | undefined;
  #renderer: IRendererLike | undefined;
  #viewport: Viewport | undefined;
  #input: InputMap | undefined;
  #state: GameStore<TState>;
  #initialState: TState;
  #loop: FixedStepLoop | undefined;
  #projection: SceneRenderProjection | undefined;
  #cleanup: Array<() => void> = [];
  #particles = new Set<GPUParticles3D>();
  #entities: Registry | undefined;
  #random: IRandom | undefined;
  #picker: ScenePicker | undefined;
  #scheduler: Scheduler | undefined;
  #activePlugins: Array<IGamePluginHooks<TState, TPhysics>> = [];
  #disposedPlugins = new Set<IGamePluginHooks<TState, TPhysics>>();
  #pendingStart: Promise<void> | undefined;
  #aborted = false;
  #sceneEntered = false;
  #paused = false;
  #started = false;
  // Flipped only by a diagnostics consumer announcing itself; see enableRuntimeDiagnostics().
  #renderMetricsEnabled = false;

  constructor(config: IGameConfig<TState, TPhysics>) {
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

  get ctx(): ICtx<TState, TPhysics> | undefined {
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
    // Validate before the reset: a typo'd scene name must not wipe the live session's state on
    // its way to throwing.
    if (this.#config.scenes[name] === undefined) throw new Error(`Unknown scene '${name}'.`);
    this.#state.stop();
    this.#state.setState({ ...this.#initialState });
    this.#state.start();
    return this.#goto(name, this.#ctx);
  }

  #goto(name: string, ctx: ICtx<TState, TPhysics>): Promise<void> {
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
    // The projection holds batches built from the outgoing scene's geometry. Released before the
    // scene is cleared, so a scene change cannot leave the next level drawing the last one's
    // props — and released rather than rebuilt, because every source it referenced is about to go.
    this.#projection?.dispose();
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

  #enterScene(scene: Scene<TState, TPhysics>, ctx: ICtx<TState, TPhysics>): void {
    const frame = scene.enter(ctx);
    if (frame !== undefined && typeof frame !== "function") {
      throw new Error("Scene.enter() must return a frame function or undefined.");
    }
    // A boot scene may navigate synchronously; do not replace the frame installed by #goto().
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
    this.#input = new InputMap(
      this.#config.input,
      inputTarget,
      canvas,
      platform?.input,
      this.#config.contextMenu,
    );
    this.#state.start();
    const threeScene = new ThreeScene();
    const camera = createCamera(this.#config.camera);
    const viewport = new Viewport({ camera, renderer: this.#renderer, source: platform?.viewport });
    const canvasLayer = new CanvasLayer(viewport);
    this.#viewport = viewport;
    // The renderer goes to the asset loader so compiled KTX2 textures detect transcoding
    // support against the real backend; a target that supports none fails right here.
    const assets = createAssetLoader({ ...this.#config.assets, renderer: renderer.raw });
    if (assets.compressedTextures !== undefined) await assets.compressedTextures.ready;
    const entities = new Registry();
    const random = createRandom(this.#config.seed);
    const scheduler = new Scheduler();
    const input = this.#input;
    const picker = new ScenePicker({
      camera,
      pointer: () => input.raw.pointer.position,
      scene: threeScene,
      viewport,
    });
    this.#picker = picker;
    const loopState: { current?: FixedStepLoop } = {};
    // Built before the context because `ctx.startup` reads it: a game asks what the framework's
    // startup is doing, and the answer is this pass.
    const projection = new SceneRenderProjection(threeScene);
    this.#projection = projection;
    let projectionSettled = false;
    let markProjectionSettled: () => void = () => undefined;
    const projectionReady = new Promise<void>((resolve) => {
      markProjectionSettled = resolve;
    });
    const ctx: ICtx<TState, TPhysics> = {
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
      canvasLayer,
      entities,
      every: (callback) => scheduler.every(callback),
      get fps() {
        return loopState.current?.fps ?? 0;
      },
      goto: (name) => this.#goto(name, ctx),
      input: this.#input,
      physics: undefined as TPhysics,
      random,
      raycast: (options) => picker.raycast(options),
      raycastAll: (options) => picker.raycastAll(options),
      startup: {
        get phase() {
          // The projection reaches its verdict on the first frame it reconciles rather than after
          // an observation window, so there is no longer a span where the framework is watching
          // the scene to decide. A loading screen still waits on `whenReady`; what it waits for is
          // now the first projection build rather than a guess about what will move.
          if (projectionSettled) return "ready" as const;
          return "collapsing" as const;
        },
        get progress() {
          return projectionSettled ? 1 : 0;
        },
        whenReady: () => projectionReady,
      },
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
        // Runs on web as well as native, so the two stay one behaviour rather than diverging into
        // a fast path nobody tests. Reconciling here — before the render, inside the same frame —
        // is what lets a change the game made this tick reach the screen this tick instead of the
        // next one. Scenes under its mesh floor get their own graph back and pay nothing.
        this.#projection?.reconcile();
        if (!projectionSettled) {
          projectionSettled = true;
          markProjectionSettled();
        }
        let worldMetrics: IRenderPerformanceMetrics | undefined;
        if (!canvasLayer.opaque) {
          // The projection's own scene when it is faithful, the game's when it is not. Nothing
          // here branches on which: `root` is the single render input either way, so there is no
          // second optional render path to leave untested.
          renderer.render(this.#projection?.root ?? threeScene, camera);
          this.#scene?.render(ctx);
          if (this.#renderMetricsEnabled) worldMetrics = rendererPerformanceMetrics(renderer.raw);
        }
        if (canvasLayer.scene.children.length > 0) {
          renderer.renderOverlay(canvasLayer.scene, canvasLayer.camera);
          if (!this.#renderMetricsEnabled) return undefined;
          const overlayMetrics = rendererPerformanceMetrics(renderer.raw);
          return worldMetrics === undefined
            ? overlayMetrics
            : addRenderPerformanceMetrics(worldMetrics, overlayMetrics);
        }
        return this.#renderMetricsEnabled ? worldMetrics : undefined;
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
        this.#entities?.sweep();
      },
      step: this.#config.step,
    });
    loopState.current = gameLoop;
    this.#loop = gameLoop;
    const startGates: Promise<void>[] = [];
    const runtime: IGamePluginRuntime = {
      fixedStep: (ticks) => gameLoop.advance(ticks),
      enableRuntimeDiagnostics: () => {
        this.#renderMetricsEnabled = true;
        gameLoop.setCollectMetrics(true);
      },
      holdStart: (gate) => startGates.push(gate),
      observations: createRuntimeObservations(),
      tick: gameLoop.tick,
      random,
      rapier: null,
      seed: this.#config.seed ?? null,
      step: gameLoop.step,
      runtimeDiagnosticsSeries: () => gameLoop.runtimeDiagnosticsSeries(),
    };
    // A boot that throws must end exactly like an aborted boot: every cleanup attempted, every
    // resource released — and the original error rethrown, not a teardown error standing in
    // for it. The abort branches below stay outside these guards: they tear down themselves.
    for (const plugin of this.#config.plugins ?? []) {
      let cleanup: PluginCleanup | undefined;
      try {
        cleanup = typeof plugin === "function" ? plugin(ctx) : await plugin.setup?.(ctx, runtime);
      } catch (error) {
        this.#teardown(ctx);
        throw error;
      }
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
    try {
      await scene.load(ctx);
    } catch (error) {
      this.#teardown(ctx);
      throw error;
    }
    if (this.#aborted) {
      this.#teardown(ctx);
      return;
    }
    try {
      this.#enterScene(scene, ctx);
    } catch (error) {
      this.#teardown(ctx);
      throw error;
    }
    if (this.#aborted) {
      this.#teardown(ctx);
      return;
    }
    // Plugins that must not let the game step before something external arrives wait here, with
    // the scene entered and every capability registered, and with the loop still stopped.
    if (startGates.length > 0) {
      try {
        await Promise.all(startGates);
      } catch (error) {
        this.#teardown(ctx);
        throw error;
      }
      if (this.#aborted) {
        this.#teardown(ctx);
        return;
      }
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

  #disposePlugin(plugin: IGamePluginHooks<TState, TPhysics>, ctx: ICtx<TState, TPhysics>): void {
    if (this.#disposedPlugins.has(plugin)) return;
    this.#disposedPlugins.add(plugin);
    plugin.dispose?.(ctx);
  }

  #teardown(startingCtx?: ICtx<TState, TPhysics>): void {
    const ctx = this.#ctx ?? startingCtx;
    // Teardown is failure-atomic: one throwing release must not strand the resources after it.
    // Every attempt runs, errors are collected, and the first — the original cause — is thrown
    // once all attempts and the final leak check have completed.
    const failures: unknown[] = [];
    this.#loop?.stop();
    if (this.#sceneEntered && ctx !== undefined) this.#scene?.exit(ctx);
    this.#sceneFrame = undefined;
    this.#sceneEntered = false;
    this.#scheduler?.clear();
    this.#entities?.clear();
    this.#entities = undefined;
    if (ctx !== undefined)
      for (const plugin of this.#activePlugins) {
        try {
          this.#disposePlugin(plugin, ctx);
        } catch (error) {
          failures.push(error);
        }
      }
    this.#activePlugins = [];
    for (const cleanup of this.#cleanup.splice(0)) {
      try {
        cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (ctx !== undefined) clearScene(ctx.scene, this.#particles);
    this.#input?.dispose();
    this.#state.stop();
    ctx?.canvasLayer.dispose();
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
    this.#picker?.dispose();
    this.#picker = undefined;
    this.#scheduler = undefined;
    this.#disposedPlugins.clear();
    this.#paused = false;
    this.#started = false;
    // Runs even when releases above failed; its verdict loses to a real cleanup error, which is
    // the more actionable diagnosis of what went wrong while stopping.
    if ((ctx?.scene.children.length ?? 0) > 0)
      failures.push(new Error("IGame teardown leaked scene objects."));
    if (failures.length > 0) throw failures[0];
  }
}

function createRuntimeObservations(): IGameRuntimeObservations {
  const contributions = new Set<IGameObservationContribution>();
  return {
    contribute: (contribution) => {
      contributions.add(contribution);
      return () => contributions.delete(contribution);
    },
    contributions: () => [...contributions],
  };
}

export function defineGame<TState extends Record<string, unknown>, TPhysics = undefined>(
  config: IGameConfig<TState, TPhysics>,
): IGame<TState, TPhysics> {
  return new GameImpl<TState, TPhysics>(config);
}
