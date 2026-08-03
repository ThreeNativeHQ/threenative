import { PerspectiveCamera, Scene as ThreeScene } from "three";
import { type AssetLoader, type AssetLoaderOptions, createAssetLoader } from "./assets.js";
import { type InputBindings, InputMap } from "./input.js";
import { FixedStepLoop } from "./loop.js";
import { type RendererLike, type RendererOptions, createRenderer } from "./renderer.js";
import type { Ctx, Scene, SceneConstructor } from "./scene.js";
import { type GameStore, createGameStore } from "./state.js";

export type GamePlugin<TState extends Record<string, unknown> = Record<string, unknown>> = (
  ctx: Ctx<TState>,
) => undefined | (() => void);

export interface GameConfig<TState extends Record<string, unknown> = Record<string, unknown>> {
  readonly assets?: AssetLoaderOptions;
  readonly canvas?: HTMLCanvasElement;
  readonly container?: HTMLElement;
  readonly input?: InputBindings;
  readonly initialState?: TState;
  readonly plugins?: readonly GamePlugin<TState>[];
  readonly render?: Pick<RendererOptions, "preferWebGPU">;
  readonly renderer?: RendererOptions;
  readonly scenes: Record<string, SceneConstructor<TState>>;
  readonly start: string;
  readonly stateFlushMs?: number;
}

export interface Game<TState extends Record<string, unknown> = Record<string, unknown>> {
  readonly ctx: Ctx<TState> | undefined;
  readonly scene: Scene<TState> | undefined;
  start(): Promise<void>;
  stop(): void;
}

class GameImpl<TState extends Record<string, unknown>> implements Game<TState> {
  #config: GameConfig<TState>;
  #ctx: Ctx<TState> | undefined;
  #scene: Scene<TState> | undefined;
  #renderer: RendererLike | undefined;
  #input: InputMap | undefined;
  #state: GameStore<TState> | undefined;
  #loop: FixedStepLoop | undefined;
  #cleanup: Array<() => void> = [];
  #started = false;

  constructor(config: GameConfig<TState>) {
    this.#config = config;
  }

  get ctx(): Ctx<TState> | undefined {
    return this.#ctx;
  }

  get scene(): Scene<TState> | undefined {
    return this.#scene;
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
    this.#state = createGameStore(
      this.#config.initialState ?? ({} as TState),
      this.#config.stateFlushMs,
    );
    this.#state.start();
    const threeScene = new ThreeScene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 2_000);
    const assets = createAssetLoader(this.#config.assets);
    const ctx: Ctx<TState> = {
      add: (object) => {
        threeScene.add(object);
        return object;
      },
      assets,
      camera,
      input: this.#input,
      physics: undefined,
      renderer: this.#renderer,
      scene: threeScene,
      state: this.#state,
    };
    this.#ctx = ctx;
    this.#scene = new SceneType();
    for (const plugin of this.#config.plugins ?? []) {
      const cleanup = plugin(ctx);
      if (cleanup !== undefined) this.#cleanup.push(cleanup);
    }
    await this.#scene.load(ctx);
    this.#scene.enter(ctx);
    this.#loop = new FixedStepLoop({
      onRender: () => this.#renderer?.render(threeScene, camera),
      onUpdate: (dt) => {
        this.#input?.tick();
        this.#scene?.update(ctx, dt);
      },
    });
    this.#started = true;
    this.#loop.start();
  }

  stop(): void {
    if (!this.#started) return;
    this.#loop?.stop();
    if (this.#ctx !== undefined) this.#scene?.exit(this.#ctx);
    for (const cleanup of this.#cleanup.splice(0)) cleanup();
    this.#input?.dispose();
    this.#state?.stop();
    this.#renderer?.dispose();
    this.#renderer = undefined;
    this.#input = undefined;
    this.#state = undefined;
    this.#scene = undefined;
    this.#ctx = undefined;
    this.#loop = undefined;
    this.#started = false;
  }
}

export function defineGame<TState extends Record<string, unknown>>(
  config: GameConfig<TState>,
): Game<TState> {
  return new GameImpl(config);
}
