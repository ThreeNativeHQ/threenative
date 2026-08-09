import { Texture, Vector2, Object3D, Camera, Vector3, Scene as Scene$1 } from 'three';
import { StoreApi } from 'zustand/vanilla';

interface AssetLoaderOptions {
    readonly basePath?: string;
    readonly model?: (url: string) => Promise<unknown>;
    readonly texture?: (url: string) => Promise<Texture>;
    readonly audio?: (url: string) => Promise<AudioBuffer>;
}
interface AssetLoader {
    model<T = unknown>(path: string): Promise<T>;
    texture(path: string): Promise<Texture>;
    audio(path: string): Promise<AudioBuffer>;
    release(kind: "audio" | "model" | "texture", path: string): boolean;
    clear(): void;
}
declare function createAssetLoader(options?: AssetLoaderOptions): AssetLoader;

interface InputAction {
    readonly buttons?: readonly number[];
    readonly down?: readonly string[];
    readonly left?: readonly string[];
    readonly pointer?: boolean;
    readonly right?: readonly string[];
    readonly up?: readonly string[];
}
type InputBindings = Record<string, InputAction>;
interface InputGamepad {
    readonly axes: ArrayLike<number>;
    readonly buttons: readonly {
        readonly pressed: boolean;
    }[];
}
type InputPlatformSource = () => readonly (InputGamepad | null)[];
interface RawInputState {
    readonly keys: ReadonlySet<string>;
    readonly pointer: {
        buttons: number;
        down: boolean;
        readonly position: Vector2;
    };
    readonly gamepad: {
        axes: readonly number[];
        buttons: readonly boolean[];
    };
}
declare class InputMap {
    #private;
    readonly raw: RawInputState;
    constructor(bindings?: InputBindings, target?: EventTarget, pointerTarget?: EventTarget, source?: InputPlatformSource);
    vector(name: string): Vector2;
    pressed(name: string): boolean;
    justPressed(name: string): boolean;
    justReleased(name: string): boolean;
    tick(): void;
    clear(): void;
    dispose(): void;
}
declare function input(bindings?: InputBindings, target?: EventTarget, pointerTarget?: EventTarget, source?: InputPlatformSource): InputMap;

interface Random {
    (): number;
    pick<T>(items: readonly T[]): T;
    range(min: number, max: number): number;
    state: number;
}
declare function createRandom(seed?: number): Random;

type RendererKind = "webgpu" | "webgl2";
interface RendererLike {
    readonly domElement: HTMLCanvasElement;
    readonly kind: RendererKind;
    readonly raw: unknown;
    compute(node: unknown): void;
    render(scene: Object3D, camera: Camera): void;
    setOutputNode(node: unknown): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    dispose(): void;
}
interface RendererPlatformSource {
    createCanvas(): HTMLCanvasElement;
    hasWebGPU(): boolean;
    observeResize(canvas: HTMLCanvasElement, resize: () => void): () => void;
    readSize(canvas: HTMLCanvasElement): readonly [width: number, height: number];
}
interface RendererOptions {
    canvas?: HTMLCanvasElement;
    preferWebGPU?: boolean;
    source?: RendererPlatformSource;
    webgpuFactory?: (canvas: HTMLCanvasElement) => Promise<unknown> | unknown;
    webgl2Factory?: (canvas: HTMLCanvasElement) => unknown;
}
declare function createRenderer(options?: RendererOptions): Promise<RendererLike>;

type EntitySnapshot = Record<string, Record<string, unknown> & {
    tags?: string[];
}>;
interface Debuggable {
    debug(): Record<string, unknown>;
}
declare function autoFields(entity: object): Record<string, unknown>;
declare class Registry {
    #private;
    add<T extends object>(name: string, entity: T): T;
    get<T extends object = object>(name: string): T | undefined;
    remove(name: string): void;
    clear(): void;
    snapshot(): EntitySnapshot;
}

type ScheduleHandle = (() => void) & {
    cancel(): void;
    readonly active: boolean;
};
type TweenProperties<T extends object> = {
    [K in keyof T]?: number;
};
declare class Scheduler {
    #private;
    get size(): number;
    after(delay: number, callback: () => void): ScheduleHandle;
    every(callback: (dt: number) => void): ScheduleHandle;
    tween<T extends object>(target: T, properties: TweenProperties<T>, duration: number): Promise<void>;
    tick(dt: number): void;
    clear(): void;
}

type StatePatch<T extends Record<string, unknown>> = Partial<T> | ((state: T) => Partial<T>);
type GameStore<T extends Record<string, unknown>> = StoreApi<T> & {
    set(patch: StatePatch<T>): void;
    flush(): void;
    start(): void;
    stop(): void;
};
declare function createGameStore<T extends Record<string, unknown>>(initial: T, intervalMs?: number): GameStore<T>;

interface ViewportSize {
    readonly aspect: number;
    readonly height: number;
    readonly width: number;
}
interface ViewportOptions {
    readonly camera: Camera;
    readonly renderer: RendererLike;
    readonly source?: ViewportPlatformSource;
}
type ViewportResizeHandler = (size: ViewportSize) => void;
interface ViewportPlatformSource {
    observeResize(canvas: HTMLCanvasElement, resize: () => void): () => void;
    readSize(canvas: HTMLCanvasElement): ViewportSize;
}
declare class Viewport {
    #private;
    readonly camera: Camera;
    readonly renderer: RendererLike;
    constructor(options: ViewportOptions);
    get size(): ViewportSize;
    projectPosition(screen: Vector2, z?: number): Vector3;
    unprojectPosition(world: Vector3): Vector2;
    onResize(handler: ViewportResizeHandler): () => void;
    resize(): void;
    dispose(): void;
}

declare abstract class Scene<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> {
    static readonly initialState: Record<string, unknown> | undefined;
    load(_ctx: Ctx<TState, TPhysics>): void | Promise<void>;
    enter(_ctx: Ctx<TState, TPhysics>): SceneEnterResult<TState, TPhysics>;
    exit(_ctx: Ctx<TState, TPhysics>): void;
    update(_ctx: Ctx<TState, TPhysics>, _dt: number): void;
    render(_ctx: Ctx<TState, TPhysics>): void;
}
type SceneConstructor<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> = new () => Scene<TState, TPhysics>;
type SceneFrame<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> = (ctx: Ctx<TState, TPhysics>, dt: number) => void;
type SceneEnterResult<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> = // biome-ignore lint/suspicious/noConfusingVoidType: void preserves existing Scene.enter overrides.
void | SceneFrame<TState, TPhysics>;
interface Ctx<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> {
    readonly fps: number;
    readonly renderer: RendererLike;
    readonly viewport: Viewport;
    readonly scene: Scene$1;
    readonly camera: Camera;
    readonly entities: Registry;
    readonly add: (object: Object3D) => Object3D;
    readonly input: InputMap;
    readonly assets: AssetLoader;
    readonly after: (delay: number, callback: () => void) => ScheduleHandle;
    readonly every: (callback: (dt: number) => void) => ScheduleHandle;
    readonly state: GameStore<TState>;
    readonly tween: <T extends object>(target: T, properties: {
        [K in keyof T]?: number;
    }, duration: number) => Promise<void>;
    readonly random: Random;
    readonly goto: (name: string) => Promise<void>;
    physics: TPhysics;
}

type PluginCleanup = () => void;
interface GamePluginRuntime {
    fixedStep(ticks: number): number;
    readonly random?: Pick<Random, "state">;
    rapier?: string | null;
    readonly seed: number | null;
    readonly step: number;
}
interface GamePlatformSource {
    readonly devToolsHost?: Record<string, unknown>;
    readonly input: NonNullable<ConstructorParameters<typeof InputMap>[3]>;
    readonly inputTarget?: EventTarget;
    readonly renderer: NonNullable<RendererOptions["source"]>;
    readonly viewport: NonNullable<ViewportOptions["source"]>;
    mountCanvas(canvas: HTMLCanvasElement, container?: HTMLElement): void;
    unmountCanvas(canvas: HTMLCanvasElement): void;
}
type GamePluginFunction<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> = (ctx: Ctx<TState, TPhysics>) => undefined | PluginCleanup;
interface GamePluginHooks<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> {
    setup?(ctx: Ctx<TState, TPhysics>, runtime?: GamePluginRuntime): undefined | PluginCleanup | Promise<undefined | PluginCleanup>;
    beforeUpdate?(ctx: Ctx<TState, TPhysics>, dt: number): void;
    update?(ctx: Ctx<TState, TPhysics>, dt: number): void;
    sceneExit?(ctx: Ctx<TState, TPhysics>): void;
    dispose?(ctx: Ctx<TState, TPhysics>): void;
}
type GamePlugin<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> = GamePluginFunction<TState, TPhysics> | GamePluginHooks<TState, TPhysics>;
interface GameConfig<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> {
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
interface PerspectiveCameraConfig {
    readonly projection: "perspective";
    readonly fov?: number;
    readonly near?: number;
    readonly far?: number;
}
interface OrthogonalCameraConfig {
    readonly projection: "orthogonal";
    readonly size: number;
    readonly near?: number;
    readonly far?: number;
}
type CameraConfig = PerspectiveCameraConfig | OrthogonalCameraConfig;
interface Game<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> {
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
declare function defineGame<TState extends Record<string, unknown>, TPhysics = undefined>(config: GameConfig<TState, TPhysics>): Game<TState, TPhysics>;

export { type AssetLoader as A, autoFields as B, type CameraConfig as C, type Debuggable as D, type EntitySnapshot as E, createAssetLoader as F, type Game as G, createGameStore as H, type InputAction as I, createRandom as J, createRenderer as K, defineGame as L, input as M, type OrthogonalCameraConfig as O, type PerspectiveCameraConfig as P, type RendererLike as R, Scene as S, Viewport as V, type GamePluginRuntime as a, type GamePluginHooks as b, type AssetLoaderOptions as c, type Ctx as d, type GameConfig as e, type GamePlatformSource as f, type GamePlugin as g, type GamePluginFunction as h, type GameStore as i, type InputBindings as j, InputMap as k, type PluginCleanup as l, type Random as m, type RawInputState as n, Registry as o, type RendererKind as p, type RendererOptions as q, type SceneConstructor as r, type SceneEnterResult as s, type SceneFrame as t, type ScheduleHandle as u, Scheduler as v, type StatePatch as w, type ViewportOptions as x, type ViewportResizeHandler as y, type ViewportSize as z };
