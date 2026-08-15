import { AudioListener, Object3D, Audio, Vector3, PositionalAudio } from 'three';

interface IAudioBusOptions {
    readonly camera: Object3D;
    readonly gestureTarget?: EventTarget;
    readonly listener?: AudioListener;
    readonly source?: () => EventTarget | undefined;
}
interface IAudioPlayOptions {
    readonly fade?: number;
    readonly loop?: boolean;
    readonly volume?: number;
}
interface IAudioRuntimeSnapshot {
    readonly queued: number;
    readonly voices: number;
}
declare class AudioBus {
    #private;
    readonly listener: AudioListener;
    constructor(options: IAudioBusOptions);
    get queued(): number;
    get voices(): number;
    setCamera(camera: Object3D): void;
    reparent(camera: Object3D): void;
    unlock(): Promise<void>;
    play(buffer: AudioBuffer, options?: IAudioPlayOptions): Audio;
    playAt(buffer: AudioBuffer, source: Object3D | Vector3, options?: IAudioPlayOptions): PositionalAudio;
    music(buffer: AudioBuffer, options?: IAudioPlayOptions): Audio;
    stop(): void;
    dispose(): void;
}
declare function audioRuntimeSnapshot(): IAudioRuntimeSnapshot;

export { AudioBus as A, type IAudioBusOptions as I, audioRuntimeSnapshot as a, type IAudioPlayOptions as b };
