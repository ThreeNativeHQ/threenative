export { A as AudioBus, b as AudioBusOptions, c as AudioPlayOptions } from './audio-3vkjtiuo.js';
import { R as RendererLike, a as GamePluginRuntime, b as GamePluginHooks } from './game-DRPs3M7r.js';
export { A as AssetLoader, c as AssetLoaderOptions, C as CameraConfig, d as Ctx, D as Debuggable, E as EntitySnapshot, G as Game, e as GameConfig, f as GamePlatformSource, g as GamePlugin, h as GamePluginFunction, i as GameStore, I as InputAction, j as InputBindings, k as InputMap, O as OrthogonalCameraConfig, P as PerspectiveCameraConfig, l as PluginCleanup, m as Random, n as RawInputState, o as Registry, p as RendererKind, q as RendererOptions, S as Scene, r as SceneConstructor, s as SceneEnterResult, t as SceneFrame, u as ScheduleHandle, v as Scheduler, w as StatePatch, V as Viewport, x as ViewportOptions, y as ViewportResizeHandler, z as ViewportSize, B as autoFields, F as createAssetLoader, H as createGameStore, J as createRandom, K as createRenderer, L as defineGame, M as input } from './game-DRPs3M7r.js';
import { AnimationMixer, AnimationClip, Object3D, Sprite } from 'three';
import { StorageBufferNode, SpriteNodeMaterial, ComputeNode } from 'three/webgpu';
import { IReplayRecording } from '@threenative/playtest';
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

type Recording = IReplayRecording;
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
