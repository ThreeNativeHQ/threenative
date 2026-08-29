import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { CameraShake } from "../src/camera-shake.js";

function options(curve: (phase: number) => number = () => 1) {
  return {
    amplitude: new Vector3(0.4, 0.2, 0.1),
    curve,
    decay: 2,
    frequency: 3,
    rotationAmplitude: new Vector3(0.03, 0.02, 0.01),
  };
}

describe("CameraShake", () => {
  it("returns game-supplied position and rotation offsets without touching a camera", () => {
    const camera = new PerspectiveCamera();
    camera.position.set(2, 3, 4);
    const before = camera.position.clone();
    const shake = new CameraShake(options());

    expect(shake.update(0).position.length()).toBe(0);
    shake.trigger();
    const offset = shake.update(0);

    expect(offset.position.toArray()).toEqual([0.4, 0.2, 0.1]);
    expect(offset.rotation.toArray()).toEqual([0.03, 0.02, 0.01]);
    expect(camera.position.toArray()).toEqual(before.toArray());
  });

  it("advances with fixed deltas, applies frequency to the curve, and decays", () => {
    const phases: number[] = [];
    const shake = new CameraShake(
      options((phase) => {
        phases.push(phase);
        return 1;
      }),
    );
    shake.trigger();
    shake.update(0.25);
    expect(phases[0]).toBeCloseTo(0);
    shake.update(0);
    expect(phases[1]).toBeCloseTo(Math.PI * 2 * 3 * 0.25);
    expect(shake.offset.position.x).toBeCloseTo(0.4 * Math.exp(-2 * 0.25));
  });

  it("stops and clears the offset, and rejects invalid deltas", () => {
    const shake = new CameraShake(options());
    shake.trigger().update(0);
    shake.stop();
    expect(shake.active).toBe(false);
    expect(shake.offset.position.length()).toBe(0);
    expect(() => shake.update(-1)).toThrow("CameraShake.update delta");
    expect(() => shake.update(Number.NaN)).toThrow("CameraShake.update delta");
  });

  it("requires amplitude, rotation amplitude, frequency, decay, and a curve", () => {
    expect(() => new CameraShake({} as never)).toThrow("CameraShake.amplitude");
    expect(() => new CameraShake({ ...options(), rotationAmplitude: undefined } as never)).toThrow(
      "CameraShake.rotationAmplitude",
    );
    expect(() => new CameraShake({ ...options(), frequency: 0 })).toThrow("CameraShake.frequency");
    expect(() => new CameraShake({ ...options(), decay: Number.NaN })).toThrow("CameraShake.decay");
    expect(() => new CameraShake({ ...options(), curve: undefined } as never)).toThrow(
      "CameraShake.curve",
    );
  });
});
