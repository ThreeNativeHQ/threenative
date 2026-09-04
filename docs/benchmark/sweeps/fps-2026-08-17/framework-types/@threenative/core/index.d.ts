import { AnimationMixer, AnimationClip, Object3D, Sprite, Vector3, CatmullRomCurve3 } from 'three';
export { A as AudioBus, I as IAudioBusOptions, b as IAudioPlayOptions } from './audio-CEAw0w5y.js';
import { a as IRendererLike, b as IGamePluginRuntime, c as IGamePluginHooks } from './game-DRt1Qhq3.js';
export { C as CanvasLayer, d as ICtx, I as IGame, e as IGameObservationContribution, f as IGameObservationSampleRequest, g as IGamePlatformSource, h as IRandom, i as IRawInputPointer, j as IRaycastOptions, k as IScenePickerOptions, S as Scene, l as SceneFrame, m as ScenePicker, n as ScheduleHandle, o as Scheduler, p as createRandom, q as defineGame } from './game-DRt1Qhq3.js';
import { StorageBufferNode, SpriteNodeMaterial, ComputeNode } from 'three/webgpu';
import { IReplayRecording } from '@threenative/playtest';
import 'zustand/vanilla';

interface IAnimationPlayerOptions {
    readonly clips: readonly AnimationClip[];
    readonly root: Object3D;
}
interface IAnimationPlayOptions {
    readonly fade?: number;
}
declare class AnimationPlayer {
    #private;
    readonly mixer: AnimationMixer;
    constructor(options: IAnimationPlayerOptions);
    get current(): string | undefined;
    get advancedFrames(): number;
    play(name: string, options?: IAnimationPlayOptions): void;
    update(dt: number): void;
    stop(): void;
    dispose(): void;
}

type ThreeNativeOrientation = "landscape" | "portrait" | "sensor";
interface IThreeNativeConfig {
    readonly app?: {
        readonly id?: string;
        readonly name?: string;
        readonly version?: string;
        readonly build?: number;
        readonly icon?: string;
    };
    readonly display?: {
        readonly orientation?: ThreeNativeOrientation;
        readonly fullscreen?: boolean;
        readonly keepScreenOn?: boolean;
    };
    readonly window?: {
        readonly title?: string;
        readonly width?: number;
        readonly height?: number;
        readonly resizable?: boolean;
    };
    /**
     * What the generated loading screen reads.
     *
     * These are declarations, not a renderer: `src/render/loading.ts` is your source and it is the
     * only thing that draws them, so a look this cannot express is a file you edit rather than an
     * option we add. Deleting that file still opts out of the screen entirely.
     */
    readonly loading?: {
        /** Image drawn centred above the bar, project-relative like `public/logo.png`. */
        readonly image?: string;
        readonly backdropColor?: string;
        readonly trackColor?: string;
        readonly progressColor?: string;
        /** False draws the backdrop and image with no bar. */
        readonly showProgressBar?: boolean;
    };
    readonly nativeEntry?: string;
    readonly renderer?: {
        readonly preferWebGPU?: boolean;
    };
}

interface IGPUParticles3DBuffers {
    readonly positions: StorageBufferNode<"vec3">;
    readonly velocities: StorageBufferNode<"vec3">;
}
interface IGPUParticles3DOptions {
    readonly amount: number;
    readonly material: SpriteNodeMaterial;
    readonly start: (buffers: IGPUParticles3DBuffers) => ComputeNode;
    readonly process: (buffers: IGPUParticles3DBuffers) => ComputeNode;
}
declare class GPUParticles3D extends Sprite {
    #private;
    readonly amount: number;
    readonly buffers: IGPUParticles3DBuffers;
    emitting: boolean;
    constructor(options: IGPUParticles3DOptions);
    get released(): boolean;
    attachRenderer(renderer: IRendererLike): void;
    process(renderer?: IRendererLike | undefined): void;
    restart(): void;
    detach(): void;
}

interface IPathFollow3DOptions {
    readonly loop?: boolean;
    readonly points: readonly Vector3[];
    readonly speed?: number;
}
interface IPathFollow3DSample {
    readonly point: Vector3;
    readonly progress: number;
    readonly tangent: Vector3;
}
interface IPathFollow3DProjection {
    readonly distanceFromStart: number;
    readonly lateralDistance: number;
    readonly tangent: Vector3;
    readonly point: Vector3;
    readonly segment: number;
}
/** A portable, distance-based follower for an authored Three.js route. */
declare class PathFollow3D {
    #private;
    readonly curve: CatmullRomCurve3;
    readonly loop: boolean;
    readonly totalLength: number;
    constructor(options: IPathFollow3DOptions);
    get completed(): boolean;
    get progress(): number;
    get speed(): number;
    set speed(value: number);
    advance(dt: number): IPathFollow3DSample;
    progressTo(distance: number): this;
    sample(distance?: number): IPathFollow3DSample;
    pointAt(distance: number): IPathFollow3DSample;
    project(position: Vector3): IPathFollow3DProjection;
}

type Recording = IReplayRecording;
type ReplayPublic = {
    readonly recording: Recording | undefined;
    readonly runId: symbol;
};
declare function replay<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined>(): IGamePluginHooks<TState, TPhysics> & ReplayPublic;
declare function createReplayDriver(recording: Recording, target: EventTarget, pointerTarget?: EventTarget): ((runtime: IGamePluginRuntime) => number) & {
    prepare: (runtime: IGamePluginRuntime) => void;
    runId: symbol;
};

/**
 * The version this library reports.
 *
 * It read `0.1.0` while the package published `0.2.0`, and `__tests__/build.spec.ts` asserted the
 * stale literal, so the test held the bug in place rather than catching it. A literal is
 * unavoidable here — core is bundled for browsers and cannot read `package.json` at runtime — so
 * the spec now asserts this equals the manifest instead of asserting a number somebody typed.
 */
declare const version = "0.2.0";

export { AnimationPlayer, GPUParticles3D, IGamePluginHooks, IGamePluginRuntime, type IPathFollow3DOptions, type IPathFollow3DProjection, type IPathFollow3DSample, type IThreeNativeConfig, PathFollow3D, type Recording, type ThreeNativeOrientation, createReplayDriver, replay, version };
