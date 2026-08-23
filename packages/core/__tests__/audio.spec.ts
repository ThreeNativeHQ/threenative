import { AudioContext, Object3D, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { AudioBus, audioRuntimeSnapshot } from "../src/audio.js";

interface IFakeAudioParam {
  value: number;
  linearRampToValueAtTime(value: number): void;
  setTargetAtTime(value: number): void;
  setValueAtTime(value: number): void;
}

function parameter(value = 1): IFakeAudioParam {
  return {
    value,
    linearRampToValueAtTime(next) {
      this.value = next;
    },
    setTargetAtTime(next) {
      this.value = next;
    },
    setValueAtTime(next) {
      this.value = next;
    },
  };
}

function audioContext(): globalThis.AudioContext {
  const context = {
    createBufferSource: () => ({
      connect: () => undefined,
      detune: parameter(0),
      disconnect: () => undefined,
      loop: false,
      loopEnd: 0,
      loopStart: 0,
      onended: null as (() => void) | null,
      playbackRate: parameter(1),
      start: () => undefined,
      stop: () => undefined,
    }),
    createGain: () => ({
      connect: () => undefined,
      disconnect: () => undefined,
      gain: parameter(),
    }),
    createPanner: () => ({
      connect: () => undefined,
      distanceModel: "inverse" as const,
      disconnect: () => undefined,
      maxDistance: 10_000,
      panningModel: "HRTF" as const,
      refDistance: 1,
      rolloffFactor: 1,
    }),
    currentTime: 0,
    destination: {},
    resume: async () => undefined,
  } as unknown as globalThis.AudioContext;
  AudioContext.setContext(context);
  return context;
}

const buffer = { duration: 1 } as AudioBuffer;

/** Run a voice out the way the browser does: the source node reports it finished. */
function endVoice(voice: { source: unknown }): void {
  (voice.source as { onended?: (() => void) | null } | null)?.onended?.();
}

describe("AudioBus", () => {
  it("should queue playback before the first user gesture and flush after", async () => {
    audioContext();
    const gestures = new EventTarget();
    const bus = new AudioBus({ camera: new PerspectiveCamera(), gestureTarget: gestures });

    bus.play(buffer);
    expect(bus.queued).toBe(1);
    expect(bus.voices).toBe(0);

    gestures.dispatchEvent(new Event("keydown"));
    await Promise.resolve();
    expect(bus.queued).toBe(0);
    expect(bus.voices).toBe(1);
    bus.dispose();
  });

  it("should stop every voice on scene exit", async () => {
    audioContext();
    const bus = new AudioBus({ camera: new PerspectiveCamera(), gestureTarget: new EventTarget() });
    await bus.unlock();
    bus.play(buffer);
    bus.play(buffer, { loop: true });

    expect(bus.voices).toBe(2);
    bus.stop();
    expect(bus.voices).toBe(0);
    expect(bus.queued).toBe(0);
    bus.dispose();
  });

  it("should return the bus to the snapshot baseline after dispose", async () => {
    audioContext();
    const baseline = audioRuntimeSnapshot();
    const bus = new AudioBus({ camera: new PerspectiveCamera(), gestureTarget: new EventTarget() });
    await bus.unlock();
    bus.play(buffer);

    expect(audioRuntimeSnapshot().voices).toBe(baseline.voices + 1);
    bus.dispose();
    expect(audioRuntimeSnapshot()).toEqual(baseline);
  });

  it("should re-parent the listener to the active camera", () => {
    audioContext();
    const first = new PerspectiveCamera();
    const second = new PerspectiveCamera();
    const bus = new AudioBus({ camera: first, gestureTarget: new EventTarget() });

    expect(bus.listener.parent).toBe(first);
    bus.setCamera(second);
    expect(bus.listener.parent).toBe(second);
    bus.dispose();
  });

  it("should throw on a null buffer", () => {
    audioContext();
    const bus = new AudioBus({ camera: new PerspectiveCamera(), gestureTarget: new EventTarget() });

    expect(() => bus.play(null as unknown as AudioBuffer)).toThrow(/non-null/u);
    bus.dispose();
  });

  it("keeps a rejected cue from consuming a pooled voice", async () => {
    audioContext();
    const bus = new AudioBus({ camera: new PerspectiveCamera() });
    await bus.unlock();

    try {
      const first = bus.play(buffer);
      endVoice(first);
      expect(bus.pooled).toBe(1);

      // The option contract throws — but only before a voice is claimed, never after one
      // has been taken out of the pool and dropped on the floor.
      expect(() => bus.play(buffer, { volume: Number.NaN })).toThrow(RangeError);

      // Documented reclaim rule: an ended voice may be handed to a later cue.
      const second = bus.play(buffer);
      expect(second).toBe(first);
    } finally {
      bus.dispose();
    }
  });

  it("should attach positional playback to its source", () => {
    audioContext();
    const bus = new AudioBus({ camera: new PerspectiveCamera(), gestureTarget: new EventTarget() });
    const source = new PerspectiveCamera();

    const voice = bus.playAt(buffer, source);

    expect(voice.parent).toBe(source);
    expect(bus.queued).toBe(1);
    bus.dispose();
  });

  it("should pass spatial tuning through to the positional panner", () => {
    audioContext();
    const bus = new AudioBus({ camera: new PerspectiveCamera(), gestureTarget: new EventTarget() });
    const source = new PerspectiveCamera();

    const tuned = bus.playAt(buffer, source, { refDistance: 12, rolloffFactor: 2.5 });

    expect(tuned.parent).toBe(source);
    expect(tuned.getRefDistance()).toBe(12);
    expect(tuned.getRolloffFactor()).toBe(2.5);
    const zeroRolloff = bus.playAt(buffer, source, { rolloffFactor: 0 });
    expect(zeroRolloff.getRolloffFactor()).toBe(0);
    bus.dispose();
  });

  it("should leave positional falloff at runtime defaults when untuned", () => {
    audioContext();
    const bus = new AudioBus({ camera: new PerspectiveCamera(), gestureTarget: new EventTarget() });

    const voice = bus.playAt(buffer, new PerspectiveCamera());

    expect(voice.getRefDistance()).toBe(1);
    expect(voice.getRolloffFactor()).toBe(1);
    bus.dispose();
  });

  it("should fail closed on invalid spatial tuning, naming the option", () => {
    audioContext();
    const bus = new AudioBus({ camera: new PerspectiveCamera(), gestureTarget: new EventTarget() });
    const source = new PerspectiveCamera();

    expect(() => bus.playAt(buffer, source, { refDistance: 0 })).toThrow(RangeError);
    expect(() => bus.playAt(buffer, source, { refDistance: 0 })).toThrow(/refDistance/u);
    expect(() => bus.playAt(buffer, source, { refDistance: -3 })).toThrow(RangeError);
    expect(() => bus.playAt(buffer, source, { refDistance: Number.NaN })).toThrow(RangeError);
    expect(() => bus.playAt(buffer, source, { refDistance: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
    expect(() => bus.playAt(buffer, source, { rolloffFactor: -0.5 })).toThrow(/rolloffFactor/u);
    expect(() => bus.playAt(buffer, source, { rolloffFactor: Number.NaN })).toThrow(RangeError);
    expect(() => bus.play(buffer, { refDistance: 0 })).toThrow(/refDistance/u);
    expect(() => bus.play(buffer, { rolloffFactor: -0.5 })).toThrow(/rolloffFactor/u);
    expect(bus.queued).toBe(0);
    bus.dispose();
  });

  it("should fail closed when the runtime has no positional audio", () => {
    const context = audioContext();
    Reflect.deleteProperty(context, "createPanner");
    const bus = new AudioBus({ camera: new PerspectiveCamera(), gestureTarget: new EventTarget() });

    expect(() => bus.playAt(buffer, new PerspectiveCamera())).toThrowError(
      "AudioBus.playAt needs createPanner(); this runtime has none.",
    );
    expect(bus.queued).toBe(0);
    expect(bus.voices).toBe(0);
    bus.dispose();
  });

  it("should use an injected optional gesture source without reading window", async () => {
    audioContext();
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Reflect.deleteProperty(globalThis, "window");
    const gestures = new EventTarget();
    const bus = new AudioBus({
      camera: new PerspectiveCamera(),
      source: () => gestures,
    });

    try {
      bus.play(buffer);
      expect(bus.queued).toBe(1);
      gestures.dispatchEvent(new Event("pointerdown"));
      await Promise.resolve();
      expect(bus.queued).toBe(0);
      expect(bus.voices).toBe(1);
    } finally {
      bus.dispose();
      if (windowDescriptor !== undefined)
        Object.defineProperty(globalThis, "window", windowDescriptor);
    }
  });

  it("should take an ended positional voice back out of the scene graph", async () => {
    audioContext();
    const camera = new PerspectiveCamera();
    const scene = new Object3D();
    scene.add(camera);
    const bus = new AudioBus({ camera });
    await bus.unlock();

    try {
      const voice = bus.playAt(buffer, new Vector3(1, 0, 2));
      expect(scene.children).toContain(voice);
      endVoice(voice);
      // The leak this replaces: the object stayed parented for the rest of the session, so a
      // game emitting hundreds of cues a minute grew its scene by hundreds of nodes a minute.
      expect(scene.children).not.toContain(voice);
      expect(bus.voices).toBe(0);
      expect(bus.pooled).toBe(1);
    } finally {
      bus.dispose();
    }
  });

  it("should reuse a retired voice rather than build another", async () => {
    audioContext();
    const bus = new AudioBus({ camera: new PerspectiveCamera() });
    await bus.unlock();

    try {
      const first = bus.play(buffer);
      endVoice(first);
      expect(bus.pooled).toBe(1);
      const second = bus.play(buffer);
      expect(second).toBe(first);
      expect(bus.pooled).toBe(0);
    } finally {
      bus.dispose();
    }
  });

  it("should hold the voice count flat across a long run of cues", async () => {
    audioContext();
    const camera = new PerspectiveCamera();
    const scene = new Object3D();
    scene.add(camera);
    const bus = new AudioBus({ camera });
    await bus.unlock();

    try {
      for (let index = 0; index < 500; index += 1) {
        endVoice(bus.playAt(buffer, new Vector3(index, 0, 0)));
      }
      // One voice, reused five hundred times. Session length must not be a growth term.
      expect(bus.pooled).toBe(1);
      expect(bus.voices).toBe(0);
      expect(scene.children).toHaveLength(1);
    } finally {
      bus.dispose();
    }
  });

  it("should steal the oldest one-shot once the ceiling is reached", async () => {
    audioContext();
    const bus = new AudioBus({ camera: new PerspectiveCamera(), maxVoices: 3 });
    await bus.unlock();

    try {
      const oldest = bus.play(buffer);
      bus.play(buffer);
      bus.play(buffer);
      expect(bus.voices).toBe(3);
      bus.play(buffer);
      expect(bus.voices).toBe(3);
      expect(oldest.isPlaying).toBe(false);
    } finally {
      bus.dispose();
    }
  });

  it("should never steal a looping voice to make room", async () => {
    audioContext();
    const bus = new AudioBus({ camera: new PerspectiveCamera(), maxVoices: 2 });
    await bus.unlock();

    try {
      const music = bus.music(buffer, { volume: 0.5 });
      bus.play(buffer);
      bus.play(buffer);
      bus.play(buffer);
      // Ambience cut off by gunfire is the failure this guards; one-shots yield, the bed does not.
      expect(music.isPlaying).toBe(true);
    } finally {
      bus.dispose();
    }
  });

  it("should fail closed on invalid cue shaping, naming the option", async () => {
    audioContext();
    const bus = new AudioBus({ camera: new PerspectiveCamera() });

    try {
      expect(() => bus.play(buffer, { cutoffSeconds: 0 })).toThrow(/cutoffSeconds/);
      expect(() => bus.play(buffer, { lowpassHz: -1 })).toThrow(/lowpassHz/);
      expect(() => bus.play(buffer, { detune: Number.NaN })).toThrow(/detune/);
      expect(() => new AudioBus({ camera: new PerspectiveCamera(), maxVoices: 0 })).toThrow(
        /maxVoices/,
      );
    } finally {
      bus.dispose();
    }
  });

  it("should restate positional falloff on a recycled voice", async () => {
    audioContext();
    const bus = new AudioBus({ camera: new PerspectiveCamera() });
    await bus.unlock();

    try {
      const tuned = bus.playAt(buffer, new Vector3(), { refDistance: 12, rolloffFactor: 0.3 });
      expect(tuned.getRefDistance()).toBe(12);
      endVoice(tuned);
      const plain = bus.playAt(buffer, new Vector3());
      // Same object, second cue. Carrying the previous cue's curve is how a footstep inherits a
      // gunshot's reach and every distance in the mix stops meaning anything.
      expect(plain).toBe(tuned);
      expect(plain.getRefDistance()).toBe(1);
      expect(plain.getRolloffFactor()).toBe(1);
    } finally {
      bus.dispose();
    }
  });
});
