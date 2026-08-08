import { AudioListener, Object3D, Audio, Vector3, PositionalAudio, AnimationMixer, AnimationClip, Sprite } from 'three';
import { R as RendererLike } from './game-1PR3hzYb.js';
export { A as AssetLoader, a as AssetLoaderOptions, C as CameraConfig, b as Ctx, D as Debuggable, E as EntitySnapshot, G as Game, c as GameConfig, d as GamePlugin, e as GamePluginFunction, f as GamePluginHooks, g as GamePluginRuntime, h as GameStore, I as InputAction, i as InputBindings, j as InputMap, O as OrthogonalCameraConfig, P as PerspectiveCameraConfig, k as PluginCleanup, l as Random, m as RawInputState, n as Registry, o as RendererKind, p as RendererOptions, S as Scene, q as SceneConstructor, r as SceneEnterResult, s as SceneFrame, t as ScheduleHandle, u as Scheduler, v as StatePatch, V as Viewport, w as ViewportOptions, x as ViewportResizeHandler, y as ViewportSize, z as autoFields, B as createAssetLoader, F as createGameStore, H as createRandom, J as createRenderer, K as defineGame, L as input } from './game-1PR3hzYb.js';
import { StorageBufferNode, SpriteNodeMaterial, ComputeNode } from 'three/webgpu';
import 'zustand/vanilla';

interface AudioBusOptions {
    readonly camera: Object3D;
    readonly gestureTarget?: EventTarget;
    readonly listener?: AudioListener;
}
interface AudioPlayOptions {
    readonly fade?: number;
    readonly loop?: boolean;
    readonly volume?: number;
}
declare class AudioBus {
    #private;
    readonly listener: AudioListener;
    constructor(options: AudioBusOptions);
    get queued(): number;
    get voices(): number;
    setCamera(camera: Object3D): void;
    reparent(camera: Object3D): void;
    unlock(): Promise<void>;
    play(buffer: AudioBuffer, options?: AudioPlayOptions): Audio;
    playAt(buffer: AudioBuffer, source: Object3D | Vector3, options?: AudioPlayOptions): PositionalAudio;
    music(buffer: AudioBuffer, options?: AudioPlayOptions): Audio;
    stop(): void;
    dispose(): void;
}

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

declare const version = "0.1.0";

export { type AnimationPlayOptions, AnimationPlayer, type AnimationPlayerOptions, AudioBus, type AudioBusOptions, type AudioPlayOptions, FixedStepLoop, type FixedStepLoopOptions, GPUParticles3D, type GPUParticles3DBuffers, type GPUParticles3DOptions, RendererLike, version };
