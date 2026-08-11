import { AnimationMixer, AnimationClip, Object3D, Sprite } from 'three';
export { A as AudioBus, b as AudioBusOptions, c as AudioPlayOptions } from './audio-3vkjtiuo.js';
import { R as RendererLike, a as GamePluginRuntime, b as GamePluginHooks } from './game-B__IjREg.js';
export { C as Ctx, G as Game, c as GamePlatformSource, d as Random, e as RawInputPointer, f as RaycastOptions, S as Scene, g as SceneFrame, h as ScenePicker, i as ScenePickerOptions, j as ScheduleHandle, k as Scheduler, l as createRandom, m as defineGame } from './game-B__IjREg.js';
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

export { AnimationPlayer, GPUParticles3D, GamePluginHooks, GamePluginRuntime, type Recording, createReplayDriver, replay, version };
