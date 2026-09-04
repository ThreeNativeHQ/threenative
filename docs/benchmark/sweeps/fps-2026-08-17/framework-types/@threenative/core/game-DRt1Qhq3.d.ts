import * as three from 'three';
import { Texture, Vector2, Object3D, Camera, Vector3, Scene as Scene$1, OrthographicCamera, Intersection } from 'three';
import { StoreApi } from 'zustand/vanilla';

interface IAssetLoaderOptions {
    readonly basePath?: string;
    readonly model?: (url: string) => Promise<unknown>;
    readonly texture?: (url: string) => Promise<Texture>;
    readonly audio?: (url: string) => Promise<AudioBuffer>;
}
interface IAssetLoader {
    model<T = unknown>(path: string): Promise<T>;
    texture(path: string): Promise<Texture>;
    audio(path: string): Promise<AudioBuffer>;
    release(kind: "audio" | "model" | "texture", path: string): boolean;
    clear(): void;
}

/**
 * One action, read either as a button through `pressed`/`justPressed` or as a 2D axis through
 * `vector`. Which one you get depends on the fields you fill in, and mixing the two is what
 * makes bindings confusing to read:
 *
 * ```ts
 * jump: { keys: ["Space"], buttons: [0] }                 // a button
 * move: { up: ["KeyW"], down: ["KeyS"], left: [...], right: [...] }  // an axis
 * ```
 *
 * `up`/`down`/`left`/`right` are **directions of an axis**, not "the keys that press this".
 * They are named after the vector they build, so `pressed("move")` is true whenever any
 * direction is held — including `ArrowDown`. For a button, use `keys`.
 */
interface IInputAction {
    /** Gamepad button indices that press this action. */
    readonly buttons?: readonly number[];
    /**
     * Keyboard codes that press this action. Use this for a button — `jump`, `restart`, `fire`.
     * A key listed here never contributes to `vector`.
     */
    readonly keys?: readonly string[];
    /** The **−y** direction of `vector(name)`. Not "the keys that press this action" — see `keys`. */
    readonly down?: readonly string[];
    /** The −x direction of `vector(name)`. */
    readonly left?: readonly string[];
    /** Any active pointer or touch presses this action. */
    readonly pointer?: boolean;
    /** The +x direction of `vector(name)`. */
    readonly right?: readonly string[];
    /** The +y direction of `vector(name)`. */
    readonly up?: readonly string[];
}
type InputBindings = Record<string, IInputAction>;
interface IInputGamepad {
    readonly axes: ArrayLike<number>;
    readonly buttons: readonly {
        readonly pressed: boolean;
    }[];
}
type InputPlatformSource = () => readonly (IInputGamepad | null)[];
interface IRawInputPointer {
    readonly id: number;
    buttons: number;
    readonly position: Vector2;
}
interface IRawInputState {
    readonly keys: ReadonlySet<string>;
    readonly pointer: {
        buttons: number;
        down: boolean;
        readonly position: Vector2;
    };
    readonly pointers: ReadonlyMap<number, IRawInputPointer>;
    readonly gamepad: {
        axes: readonly number[];
        buttons: readonly boolean[];
    };
}
declare class InputMap {
    #private;
    readonly raw: IRawInputState;
    constructor(bindings?: InputBindings, target?: EventTarget, pointerTarget?: EventTarget, source?: InputPlatformSource);
    /**
     * Returns a 2D action vector where +y is up. On a conventional XZ ground plane whose
     * forward direction is -z, map `vector.y` to `-z`. This differs from Godot's
     * `Input.get_vector`, where up is -y.
     */
    vector(name: string): Vector2;
    pressed(name: string): boolean;
    justPressed(name: string): boolean;
    justReleased(name: string): boolean;
    tick(): void;
    clear(): void;
    dispose(): void;
}

interface IRenderPerformanceMetrics {
    readonly drawCalls?: number;
    readonly triangles?: number;
}
interface IRenderPerformanceSample extends IRenderPerformanceMetrics {
    readonly frameMs: number;
}

interface IRandom {
    (): number;
    pick<T>(items: readonly T[]): T;
    range(min: number, max: number): number;
    state: number;
}
declare function createRandom(seed?: number): IRandom;

type RendererKind = "webgpu" | "webgl2";
interface IRendererLike {
    readonly domElement: HTMLCanvasElement;
    readonly kind: RendererKind;
    readonly raw: unknown;
    /**
     * Builds and compiles a scene's pipelines before anything draws it.
     *
     * On a phone each distinct shader is compiled the first time something using it is drawn, which
     * happens inside a frame the player is watching: 2,500 ms of a 2,882 ms Pixel 8 cold start sits
     * between the bundle finishing and the first frame reaching the display. Calling this during
     * load moves that cost somewhere the player is already waiting.
     *
     * It is on the wrapper for one reason: without it a game must cast through `.raw` to warm up,
     * and a game that cannot warm up without a cast will not warm up.
     */
    compileAsync(scene: Object3D, camera: Camera): Promise<void>;
    compute(node: unknown): void;
    render(scene: Object3D, camera: Camera): void;
    /** Draws after the world without clearing or passing through the world's output pipeline. */
    renderOverlay(scene: Object3D, camera: Camera): void;
    setOutputNode(node: unknown): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    dispose(): void;
}
interface IRendererPlatformSource {
    createCanvas(): HTMLCanvasElement;
    hasWebGPU(): boolean;
    observeResize(canvas: HTMLCanvasElement, resize: () => void): () => void;
    readSize(canvas: HTMLCanvasElement): readonly [width: number, height: number];
}
interface IRendererOptions {
    canvas?: HTMLCanvasElement;
    preferWebGPU?: boolean;
    /** CSS-pixel multiplier for the drawing buffer. The default is intentional DPR 1. */
    resolutionScale?: number;
    source?: IRendererPlatformSource;
    webgpuFactory?: (canvas: HTMLCanvasElement) => Promise<unknown> | unknown;
    webgl2Factory?: (canvas: HTMLCanvasElement) => unknown;
}

interface IViewportSize {
    readonly aspect: number;
    readonly height: number;
    readonly width: number;
}
interface IViewportOptions {
    readonly camera: Camera;
    readonly renderer: IRendererLike;
    readonly source?: IViewportPlatformSource;
}
type ViewportResizeHandler = (size: IViewportSize) => void;
interface IViewportPlatformSource {
    observeResize(canvas: HTMLCanvasElement, resize: () => void): () => void;
    readSize(canvas: HTMLCanvasElement): IViewportSize;
}
declare class Viewport {
    #private;
    readonly camera: Camera;
    readonly renderer: IRendererLike;
    constructor(options: IViewportOptions);
    get size(): IViewportSize;
    projectPosition(screen: Vector2, z?: number): Vector3;
    unprojectPosition(world: Vector3): Vector2;
    onResize(handler: ViewportResizeHandler): () => void;
    resize(): void;
    dispose(): void;
}

/** A Godot-shaped render surface that is independent of the world camera and post pipeline. */
declare class CanvasLayer {
    #private;
    readonly scene: Scene$1<three.Object3DEventMap>;
    readonly camera: OrthographicCamera;
    /** Declares that this layer covers the framebuffer, allowing the world pass to be skipped. */
    opaque: boolean;
    constructor(viewport: Pick<Viewport, "onResize" | "size">);
    dispose(): void;
}

type EntitySnapshot = Record<string, Record<string, unknown> & {
    tags?: string[];
}>;
declare class Registry {
    #private;
    add<T extends object>(name: string, entity: T): T;
    get<T extends object = object>(name: string): T | undefined;
    remove(name: string): void;
    queueFree(target: string | object): void;
    sweep(): void;
    clear(): void;
    snapshot(): EntitySnapshot;
}

interface IRaycastOptions {
    /** Screen point in canvas pixels. Defaults to the current pointer position. */
    readonly screen?: Vector2;
    /** What to test. Defaults to the whole scene. */
    readonly targets?: Object3D | readonly Object3D[];
}
interface IScenePickerOptions {
    readonly camera: Camera;
    readonly pointer: () => Vector2;
    readonly scene: Object3D;
    readonly viewport: Viewport;
}
/**
 * Ray queries against scene geometry, accelerated by a bounding volume hierarchy that is
 * built on first use and rebuilt when the geometry's positions change.
 *
 * The acceleration is an implementation detail: nothing about it reaches the caller, no
 * `three` prototype is patched, and a game that never calls `raycast` never builds a tree.
 * Skinned, instanced, batched and morphed meshes fall back to the stock `three` path,
 * because a hierarchy over their rest positions would report hits in the wrong place.
 */
declare class ScenePicker {
    #private;
    constructor(options: IScenePickerOptions);
    /** The closest hit under the screen point, or `undefined` when the ray hits nothing. */
    raycast(options?: IRaycastOptions): Intersection | undefined;
    /** Drops every cached hierarchy. The next `raycast` rebuilds what it needs. */
    dispose(): void;
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

declare abstract class Scene<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> {
    static readonly initialState: Record<string, unknown> | undefined;
    load(_ctx: ICtx<TState, TPhysics>): void | Promise<void>;
    enter(_ctx: ICtx<TState, TPhysics>): SceneEnterResult<TState, TPhysics>;
    exit(_ctx: ICtx<TState, TPhysics>): void;
    update(_ctx: ICtx<TState, TPhysics>, _dt: number): void;
    render(_ctx: ICtx<TState, TPhysics>): void;
}
type SceneConstructor<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> = new () => Scene<TState, TPhysics>;
type SceneFrame<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> = (ctx: ICtx<TState, TPhysics>, dt: number) => void;
type SceneEnterResult<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> = // biome-ignore lint/suspicious/noConfusingVoidType: void preserves existing Scene.enter overrides.
void | SceneFrame<TState, TPhysics>;
interface IStartupStatus {
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
interface ICtx<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> {
    readonly fps: number;
    readonly renderer: IRendererLike;
    readonly viewport: Viewport;
    readonly scene: Scene$1;
    readonly camera: Camera;
    readonly canvasLayer: CanvasLayer;
    readonly entities: Registry;
    readonly add: (object: Object3D) => Object3D;
    readonly input: InputMap;
    readonly assets: IAssetLoader;
    readonly after: (delay: number, callback: () => void) => ScheduleHandle;
    readonly every: (callback: (dt: number) => void) => ScheduleHandle;
    readonly state: GameStore<TState>;
    readonly tween: <T extends object>(target: T, properties: {
        [K in keyof T]?: number;
    }, duration: number) => Promise<void>;
    readonly random: IRandom;
    readonly raycast: (options?: IRaycastOptions) => Intersection | undefined;
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
    readonly startup: IStartupStatus;
    readonly goto: (name: string) => Promise<void>;
    physics: TPhysics;
}

type PluginCleanup = () => void;
interface IGameObservationSampleRequest {
    readonly entities?: readonly string[];
    readonly include?: readonly string[];
    readonly label?: string;
    readonly resources?: readonly string[];
}
interface IGameObservationContribution {
    readonly capabilities: readonly string[];
    readonly sample: (request: IGameObservationSampleRequest) => Readonly<Record<string, unknown>>;
}
interface IGameRuntimeObservations {
    contribute(contribution: IGameObservationContribution): PluginCleanup;
    contributions(): readonly IGameObservationContribution[];
}
interface IGamePluginRuntime {
    readonly fixedStep: (ticks: number) => number;
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
interface IGamePlatformSource {
    readonly devToolsHost?: Record<string, unknown>;
    readonly input: NonNullable<ConstructorParameters<typeof InputMap>[3]>;
    readonly inputTarget?: EventTarget;
    readonly renderer: NonNullable<IRendererOptions["source"]>;
    readonly viewport: NonNullable<IViewportOptions["source"]>;
    mountCanvas(canvas: HTMLCanvasElement, container?: HTMLElement): void;
    unmountCanvas(canvas: HTMLCanvasElement): void;
}
type GamePluginFunction<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> = (ctx: ICtx<TState, TPhysics>) => undefined | PluginCleanup;
interface IGamePluginHooks<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> {
    setup?(ctx: ICtx<TState, TPhysics>, runtime?: IGamePluginRuntime): undefined | PluginCleanup | Promise<undefined | PluginCleanup>;
    beforeUpdate?(ctx: ICtx<TState, TPhysics>, dt: number): void;
    update?(ctx: ICtx<TState, TPhysics>, dt: number): void;
    sceneExit?(ctx: ICtx<TState, TPhysics>): void;
    dispose?(ctx: ICtx<TState, TPhysics>): void;
}
type GamePlugin<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> = GamePluginFunction<TState, TPhysics> | IGamePluginHooks<TState, TPhysics>;
interface IGameConfig<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> {
    readonly assets?: IAssetLoaderOptions;
    readonly camera?: CameraConfig;
    readonly canvas?: HTMLCanvasElement;
    readonly container?: HTMLElement;
    readonly input?: InputBindings;
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
interface IPerspectiveCameraConfig {
    readonly projection: "perspective";
    readonly fov?: number;
    readonly near?: number;
    readonly far?: number;
}
interface IOrthogonalCameraConfig {
    readonly projection: "orthogonal";
    readonly size: number;
    readonly near?: number;
    readonly far?: number;
}
type CameraConfig = IPerspectiveCameraConfig | IOrthogonalCameraConfig;
interface IGame<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> {
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
declare function defineGame<TState extends Record<string, unknown>, TPhysics = undefined>(config: IGameConfig<TState, TPhysics>): IGame<TState, TPhysics>;

export { CanvasLayer as C, type IGame as I, Scene as S, type IRendererLike as a, type IGamePluginRuntime as b, type IGamePluginHooks as c, type ICtx as d, type IGameObservationContribution as e, type IGameObservationSampleRequest as f, type IGamePlatformSource as g, type IRandom as h, type IRawInputPointer as i, type IRaycastOptions as j, type IScenePickerOptions as k, type SceneFrame as l, ScenePicker as m, type ScheduleHandle as n, Scheduler as o, createRandom as p, defineGame as q };
