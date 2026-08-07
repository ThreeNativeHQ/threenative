import { Texture, Vector2, Object3D, Camera, Scene as Scene$1 } from 'three';
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
    clear(): void;
}
declare function createAssetLoader(options?: AssetLoaderOptions): AssetLoader;

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

interface InputAction {
    readonly buttons?: readonly number[];
    readonly down?: readonly string[];
    readonly left?: readonly string[];
    readonly pointer?: boolean;
    readonly right?: readonly string[];
    readonly up?: readonly string[];
}
type InputBindings = Record<string, InputAction>;
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
    constructor(bindings?: InputBindings, target?: EventTarget, pointerTarget?: EventTarget);
    vector(name: string): Vector2;
    pressed(name: string): boolean;
    justPressed(name: string): boolean;
    justReleased(name: string): boolean;
    tick(): void;
    clear(): void;
    dispose(): void;
}
declare function input(bindings?: InputBindings, target?: EventTarget, pointerTarget?: EventTarget): InputMap;

type RendererKind = "webgpu" | "webgl2";
interface RendererLike {
    readonly domElement: HTMLCanvasElement;
    readonly kind: RendererKind;
    readonly raw: unknown;
    render(scene: Object3D, camera: Camera): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    dispose(): void;
}
interface RendererOptions {
    canvas?: HTMLCanvasElement;
    preferWebGPU?: boolean;
    webgpuFactory?: (canvas: HTMLCanvasElement) => Promise<unknown> | unknown;
    webgl2Factory?: (canvas: HTMLCanvasElement) => unknown;
}
declare function createRenderer(options?: RendererOptions): Promise<RendererLike>;

interface Random {
    (): number;
    pick<T>(items: readonly T[]): T;
    range(min: number, max: number): number;
}
declare function createRandom(seed?: number): Random;

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
}
type ViewportResizeHandler = (size: ViewportSize) => void;
declare class Viewport {
    #private;
    readonly camera: Camera;
    readonly renderer: RendererLike;
    constructor(options: ViewportOptions);
    get size(): ViewportSize;
    onResize(handler: ViewportResizeHandler): () => void;
    resize(): void;
    dispose(): void;
}

declare abstract class Scene<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> {
    load(_ctx: Ctx<TState, TPhysics>): void | Promise<void>;
    enter(_ctx: Ctx<TState, TPhysics>): void;
    exit(_ctx: Ctx<TState, TPhysics>): void;
    update(_ctx: Ctx<TState, TPhysics>, _dt: number): void;
    render(_ctx: Ctx<TState, TPhysics>): void;
}
type SceneConstructor<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> = new () => Scene<TState, TPhysics>;
interface Ctx<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> {
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
type GamePluginFunction<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> = (ctx: Ctx<TState, TPhysics>) => undefined | PluginCleanup;
interface GamePluginHooks<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> {
    setup?(ctx: Ctx<TState, TPhysics>, runtime?: GamePluginRuntime): undefined | PluginCleanup | Promise<undefined | PluginCleanup>;
    update?(ctx: Ctx<TState, TPhysics>, dt: number): void;
    dispose?(ctx: Ctx<TState, TPhysics>): void;
}
type GamePlugin<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> = GamePluginFunction<TState, TPhysics> | GamePluginHooks<TState, TPhysics>;
interface GameConfig<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> {
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
interface Game<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> {
    readonly ctx: Ctx<TState, TPhysics> | undefined;
    readonly scene: Scene<TState, TPhysics> | undefined;
    readonly state: GameStore<TState>;
    start(): Promise<void>;
    pause(): void;
    resume(): void;
    stop(): void;
}
declare function defineGame<TState extends Record<string, unknown>, TPhysics = undefined>(config: GameConfig<TState, TPhysics>): Game<TState, TPhysics>;

export { type AssetLoader as A, defineGame as B, type Ctx as C, type Debuggable as D, type EntitySnapshot as E, input as F, type Game as G, type InputAction as I, type PluginCleanup as P, type Random as R, Scene as S, Viewport as V, type AssetLoaderOptions as a, type GameConfig as b, type GamePlugin as c, type GamePluginFunction as d, type GamePluginHooks as e, type GamePluginRuntime as f, type GameStore as g, type InputBindings as h, InputMap as i, type RawInputState as j, Registry as k, type RendererKind as l, type RendererLike as m, type RendererOptions as n, type SceneConstructor as o, type ScheduleHandle as p, Scheduler as q, type StatePatch as r, type ViewportOptions as s, type ViewportResizeHandler as t, type ViewportSize as u, autoFields as v, createAssetLoader as w, createGameStore as x, createRandom as y, createRenderer as z };
