import { AudioListener, Object3D, Audio, Vector3, PositionalAudio, AnimationMixer, AnimationClip } from 'three';
export { A as AssetLoader, a as AssetLoaderOptions, C as Ctx, D as Debuggable, E as EntitySnapshot, G as Game, b as GameConfig, c as GamePlugin, d as GamePluginFunction, e as GamePluginHooks, f as GamePluginRuntime, g as GameStore, I as InputAction, h as InputBindings, i as InputMap, P as PluginCleanup, R as Random, j as RawInputState, k as Registry, l as RendererKind, m as RendererLike, n as RendererOptions, S as Scene, o as SceneConstructor, p as ScheduleHandle, q as Scheduler, r as StatePatch, s as autoFields, t as createAssetLoader, u as createGameStore, v as createRandom, w as createRenderer, x as defineGame, y as input } from './game-doPK3kcC.js';
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
    start(now?: number): void;
    stop(): void;
    stepFrame(now: number): number;
    advance(ticks: number): number;
}

declare const version = "0.1.0";

export { type AnimationPlayOptions, AnimationPlayer, type AnimationPlayerOptions, AudioBus, type AudioBusOptions, type AudioPlayOptions, FixedStepLoop, type FixedStepLoopOptions, version };
