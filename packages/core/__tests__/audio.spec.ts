import { AudioContext, PerspectiveCamera } from "three";
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
});
