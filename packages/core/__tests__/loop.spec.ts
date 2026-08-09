import { describe, expect, it } from "vitest";
import { FixedStepLoop } from "../src/loop.js";

describe("FixedStepLoop", () => {
  it("should call update exactly 60 times per simulated second", () => {
    let updates = 0;
    const loop = new FixedStepLoop({ onUpdate: () => updates++ });

    loop.stepFrame(0);
    for (let frame = 1; frame <= 60; frame++) loop.stepFrame((frame * 1_000) / 60);

    expect(updates).toBe(60);
  });

  it("should honor a configured step", () => {
    let updates = 0;
    const loop = new FixedStepLoop({ onUpdate: () => updates++, step: 1 / 30 });

    loop.stepFrame(0);
    for (let frame = 1; frame <= 60; frame++) loop.stepFrame((frame * 1_000) / 60);

    expect(updates).toBe(30);
  });

  it("should clamp catch-up to 5 steps after a long stall", () => {
    let updates = 0;
    const loop = new FixedStepLoop({ onUpdate: () => updates++ });

    loop.stepFrame(0);
    const catchUp = loop.stepFrame(10_000);

    expect(catchUp).toBe(5);
    expect(updates).toBe(5);
  });

  it("should expose a finite render FPS that decays after a stall", () => {
    const loop = new FixedStepLoop({ onUpdate: () => undefined });
    loop.stepFrame(0);
    expect(Number.isFinite(loop.fps)).toBe(true);
    for (let frame = 1; frame <= 60; frame++) loop.stepFrame((frame * 1_000) / 60);
    const steady = loop.fps;
    loop.stepFrame(10_000);

    expect(steady).toBeGreaterThan(0);
    expect(loop.fps).toBeGreaterThanOrEqual(0);
    expect(loop.fps).toBeLessThan(steady);
  });

  it("should schedule the next frame when rendering throws", () => {
    const callbacks: Array<(time: number) => void> = [];
    const loop = new FixedStepLoop({
      onRender: () => {
        throw new Error("renderer failed");
      },
      onUpdate: () => undefined,
      requestFrame: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
    });

    loop.start(0);
    expect(() => callbacks.shift()?.(16)).toThrow("renderer failed");
    expect(loop.running).toBe(true);
    expect(callbacks).toHaveLength(1);
  });

  it("should advance fixed ticks only while the loop is running", () => {
    let updates = 0;
    const loop = new FixedStepLoop({ onUpdate: () => updates++ });

    expect(() => loop.advance(1)).toThrow("Cannot advance a stopped loop.");
    loop.start(0);

    expect(loop.advance(3)).toBe(3);
    expect(updates).toBe(3);
  });

  it("should ignore live frames after switching to the advanced clock", () => {
    let updates = 0;
    const loop = new FixedStepLoop({ onUpdate: () => updates++ });
    loop.start(0);

    loop.advance(10);
    expect(loop.stepFrame(20)).toBe(0);
    expect(loop.stepFrame(37)).toBe(0);
    expect(loop.stepFrame(10_000)).toBe(0);

    expect(updates).toBe(10);
  });
});
