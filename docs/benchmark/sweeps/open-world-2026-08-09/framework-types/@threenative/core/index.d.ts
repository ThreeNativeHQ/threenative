export { A as AudioBus, b as AudioBusOptions, c as AudioPlayOptions } from './audio-CEO_vRLV.js';
import { R as RendererLike, a as GamePluginRuntime, b as GamePluginHooks } from './game-B9Cj2KgI.js';
export { A as AssetLoader, c as AssetLoaderOptions, C as CameraConfig, d as Ctx, D as Debuggable, E as EntitySnapshot, G as Game, e as GameConfig, f as GamePlugin, g as GamePluginFunction, h as GameStore, I as InputAction, i as InputBindings, j as InputMap, O as OrthogonalCameraConfig, P as PerspectiveCameraConfig, k as PluginCleanup, l as Random, m as RawInputState, n as Registry, o as RendererKind, p as RendererOptions, S as Scene, q as SceneConstructor, r as SceneEnterResult, s as SceneFrame, t as ScheduleHandle, u as Scheduler, v as StatePatch, V as Viewport, w as ViewportOptions, x as ViewportResizeHandler, y as ViewportSize, z as autoFields, B as createAssetLoader, F as createGameStore, H as createRandom, J as createRenderer, K as defineGame, L as input } from './game-B9Cj2KgI.js';
import { AnimationMixer, AnimationClip, Object3D, Sprite } from 'three';
import { StorageBufferNode, SpriteNodeMaterial, ComputeNode } from 'three/webgpu';
import 'zustand/vanilla';

interface AnimationPlayerOptions {
    readonly clips: readonly AnimationClip[];
    readonly root: Object3D;
}
interface AnimationPlayOptions {
    readonly fade?: number;
}
declare class AnimationPlayer {
    #private;
    readonly mixer: AnimationMixer;
    constructor(options: AnimationPlayerOptions);
    get current(): string | undefined;
    get advancedFrames(): number;
    play(name: string, options?: AnimationPlayOptions): void;
    update(dt: number): void;
    stop(): void;
    dispose(): void;
}

interface FixedStepLoopOptions {
    readonly step?: number;
    readonly maxSteps?: number;
    readonly onUpdate: (dt: number) => void;
    readonly onRender?: () => void;
    readonly requestFrame?: (callback: (time: number) => void) => number;
    readonly cancelFrame?: (handle: number) => void;
}
declare class FixedStepLoop {
    #private;
    readonly step: number;
    readonly maxSteps: number;
    constructor(options: FixedStepLoopOptions);
    get running(): boolean;
    get fps(): number;
    start(now?: number): void;
    stop(): void;
    stepFrame(now: number): number;
    advance(ticks: number): number;
}

interface GPUParticles3DBuffers {
    readonly positions: StorageBufferNode<"vec3">;
    readonly velocities: StorageBufferNode<"vec3">;
}
interface GPUParticles3DOptions {
    readonly amount: number;
    readonly material: SpriteNodeMaterial;
    readonly start: (buffers: GPUParticles3DBuffers) => ComputeNode;
    readonly process: (buffers: GPUParticles3DBuffers) => ComputeNode;
}
declare class GPUParticles3D extends Sprite {
    #private;
    readonly amount: number;
    readonly buffers: GPUParticles3DBuffers;
    emitting: boolean;
    constructor(options: GPUParticles3DOptions);
    get released(): boolean;
    attachRenderer(renderer: RendererLike): void;
    process(renderer?: RendererLike | undefined): void;
    restart(): void;
    detach(): void;
}

type Pointer = readonly [number, number, number, number, number];
type RecordingSample = Readonly<{
    keys: readonly string[];
    pointer?: Pointer;
    tick: number;
}>;
interface Recording {
    readonly input: readonly RecordingSample[];
    readonly randomState: number;
    readonly runtime: {
        agent: string;
        core: string;
        rapier: string | null;
        step: number;
    };
    readonly seed: number;
    readonly ticks: number;
    readonly version: 1;
}
type ReplayPublic = {
    readonly recording: Recording | undefined;
    readonly runId: symbol;
};
declare function replay<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined>(): GamePluginHooks<TState, TPhysics> & ReplayPublic;
declare function createReplayDriver(recording: Recording, target: EventTarget, pointerTarget?: EventTarget): ((runtime: GamePluginRuntime) => number) & {
    prepare: (runtime: GamePluginRuntime) => void;
    runId: symbol;
};

declare const version = "0.1.0";

export { type AnimationPlayOptions, AnimationPlayer, type AnimationPlayerOptions, FixedStepLoop, type FixedStepLoopOptions, GPUParticles3D, type GPUParticles3DBuffers, type GPUParticles3DOptions, GamePluginHooks, GamePluginRuntime, type Recording, RendererLike, createReplayDriver, replay, version };
