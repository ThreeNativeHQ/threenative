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

  it("should clamp catch-up to 5 steps after a long stall", () => {
    let updates = 0;
    const loop = new FixedStepLoop({ onUpdate: () => updates++ });

    loop.stepFrame(0);
    const catchUp = loop.stepFrame(10_000);

    expect(catchUp).toBe(5);
    expect(updates).toBe(5);
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
});
