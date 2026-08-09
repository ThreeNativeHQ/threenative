import { AudioListener, Object3D, PositionalAudio, Audio as ThreeAudio, type Vector3 } from "three";

export interface AudioBusOptions {
  readonly camera: Object3D;
  readonly gestureTarget?: EventTarget;
  readonly listener?: AudioListener;
  readonly source?: () => EventTarget | undefined;
}

export interface AudioPlayOptions {
  readonly fade?: number;
  readonly loop?: boolean;
  readonly volume?: number;
}

export interface AudioRuntimeSnapshot {
  readonly queued: number;
  readonly voices: number;
}

const buses = new Set<AudioBus>();

export class AudioBus {
  readonly listener: AudioListener;
  #camera: Object3D;
  #gestureTarget: EventTarget | undefined;
  #gesture: (() => void) | undefined;
  #queue: Array<{ start: () => void; voice: ThreeAudio<AudioNode> }> = [];
  #voices = new Set<ThreeAudio<AudioNode>>();
  #unlocked = false;
  #disposed = false;

  constructor(options: AudioBusOptions) {
    this.#camera = options.camera;
    this.listener = options.listener ?? new AudioListener();
    const source = options.source ?? (() => (typeof window === "undefined" ? undefined : window));
    this.#gestureTarget = options.gestureTarget ?? source();
    this.setCamera(options.camera);
    this.#gesture = () => {
      void this.unlock().catch(() => undefined);
    };
    for (const event of ["keydown", "pointerdown", "touchstart"] as const) {
      this.#gestureTarget?.addEventListener(event, this.#gesture);
    }
    buses.add(this);
  }

  get queued(): number {
    return this.#queue.length;
  }

  get voices(): number {
    return this.#voices.size;
  }

  setCamera(camera: Object3D): void {
    this.#camera = camera;
    camera.add(this.listener);
  }

  reparent(camera: Object3D): void {
    this.setCamera(camera);
  }

  async unlock(): Promise<void> {
    if (this.#disposed || this.#unlocked) return;
    const context = this.listener.context as AudioContext & { resume?: () => Promise<void> };
    if (context.resume !== undefined) await context.resume();
    this.#unlocked = true;
    const queued = this.#queue.splice(0);
    for (const { start } of queued) start();
  }

  play(buffer: AudioBuffer, options: AudioPlayOptions = {}): ThreeAudio {
    assertBuffer(buffer);
    const voice = new ThreeAudio(this.listener);
    configureVoice(voice, options);
    voice.setBuffer(buffer);
    this.#queueOrStart(voice, options.fade, options.volume ?? 1);
    return voice;
  }

  playAt(
    buffer: AudioBuffer,
    source: Object3D | Vector3,
    options: AudioPlayOptions = {},
  ): PositionalAudio {
    assertBuffer(buffer);
    const voice = new PositionalAudio(this.listener);
    configureVoice(voice, options);
    voice.setBuffer(buffer);
    if (source instanceof Object3D) source.add(voice);
    else {
      voice.position.copy(source);
      (this.#camera.parent ?? this.#camera).add(voice);
    }
    this.#queueOrStart(voice, options.fade, options.volume ?? 1);
    return voice;
  }

  music(buffer: AudioBuffer, options: AudioPlayOptions = {}): ThreeAudio {
    return this.play(buffer, { ...options, loop: options.loop ?? true });
  }

  stop(): void {
    for (const { voice } of this.#queue) voice.removeFromParent();
    this.#queue = [];
    for (const voice of this.#voices) {
      try {
        voice.stop();
      } catch {
        // A voice that already ended is still safe to remove from the bus.
      }
      voice.removeFromParent();
    }
    this.#voices.clear();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.stop();
    this.listener.removeFromParent();
    for (const event of ["keydown", "pointerdown", "touchstart"] as const) {
      if (this.#gesture !== undefined)
        this.#gestureTarget?.removeEventListener(event, this.#gesture);
    }
    buses.delete(this);
  }

  #queueOrStart(voice: ThreeAudio<AudioNode>, fade: number | undefined, volume: number): void {
    const start = () => this.#start(voice, fade, volume);
    if (this.#unlocked) start();
    else this.#queue.push({ start, voice });
  }

  #start(voice: ThreeAudio<AudioNode>, fade: number | undefined, volume: number): void {
    if (this.#disposed) return;
    if (fade !== undefined && fade > 0) {
      const now = this.listener.context.currentTime;
      voice.gain.gain.setValueAtTime(0, now);
      voice.gain.gain.linearRampToValueAtTime(volume, now + fade);
    }
    voice.play();
    this.#voices.add(voice);
    const source = voice.source as (AudioNode & { onended?: () => void }) | null;
    if (source !== null && "onended" in source) {
      const onended = source.onended;
      source.onended = () => {
        onended?.();
        this.#voices.delete(voice);
      };
    }
  }
}

export function audioRuntimeSnapshot(): AudioRuntimeSnapshot {
  let queued = 0;
  let voices = 0;
  for (const bus of buses) {
    queued += bus.queued;
    voices += bus.voices;
  }
  return { queued, voices };
}

function configureVoice(voice: ThreeAudio<AudioNode>, options: AudioPlayOptions): void {
  const volume = options.volume ?? 1;
  if (!Number.isFinite(volume) || volume < 0)
    throw new RangeError("volume must be finite and non-negative.");
  if (options.fade !== undefined && (!Number.isFinite(options.fade) || options.fade < 0)) {
    throw new RangeError("fade must be finite and non-negative.");
  }
  voice.setLoop(options.loop ?? false);
  voice.setVolume(options.fade === undefined || options.fade === 0 ? volume : 0);
}

function assertBuffer(buffer: AudioBuffer): void {
  if (buffer === null || buffer === undefined)
    throw new TypeError("AudioBus requires a non-null AudioBuffer.");
}
