import { AudioListener, Object3D, Audio, Vector3, PositionalAudio } from 'three';

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
interface AudioRuntimeSnapshot {
    readonly queued: number;
    readonly voices: number;
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
declare function audioRuntimeSnapshot(): AudioRuntimeSnapshot;

export { AudioBus as A, audioRuntimeSnapshot as a, type AudioBusOptions as b, type AudioPlayOptions as c };
