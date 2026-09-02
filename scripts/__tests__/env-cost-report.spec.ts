import { describe, expect, it } from "vitest";
import {
  type IArmSample,
  noiseFloor,
  quantile,
  resolveDelta,
  steadyWindows,
  summarise,
} from "../env-cost-report.js";

const budget = (gpuMs: number, fps = 60): string =>
  `TN_FRAME_BUDGET:${JSON.stringify({ fps, gpuMs })}`;

describe("steadyWindows", () => {
  it("drops window 1, which is startup and always lies", () => {
    const windows = steadyWindows([budget(99), budget(2), budget(3)]);
    expect(windows.map((window) => window.gpuMs)).toEqual([2, 3]);
  });

  it("ignores console lines that are not frame budgets", () => {
    const windows = steadyWindows(["hello", budget(99), "TN_ENV_ARM:{}", budget(4)]);
    expect(windows.map((window) => window.gpuMs)).toEqual([4]);
  });

  it("fails closed when no window survives, rather than reporting an empty pass", () => {
    expect(() => steadyWindows([budget(99)])).toThrow(/no steady/i);
    expect(() => steadyWindows([])).toThrow(/no steady/i);
  });

  it("throws on a frame-budget line whose JSON cannot be parsed", () => {
    expect(() => steadyWindows([budget(1), "TN_FRAME_BUDGET:{not json"])).toThrow(
      /TN_FRAME_BUDGET/,
    );
  });

  it("refuses a window that reports no gpuMs instead of treating it as zero", () => {
    const line = `TN_FRAME_BUDGET:${JSON.stringify({ fps: 60 })}`;
    expect(() => steadyWindows([budget(1), line, budget(2)])).toThrow(/gpuMs/);
  });
});

describe("quantile", () => {
  it("reads the median of a sorted sample", () => {
    expect(quantile([1, 2, 3], 0.5)).toBe(2);
  });

  it("clamps to the last element rather than reading past the end", () => {
    expect(quantile([1, 2, 3], 1)).toBe(3);
  });

  it("throws on an empty sample", () => {
    expect(() => quantile([], 0.5)).toThrow(/empty/i);
  });
});

describe("noiseFloor", () => {
  it("does not infer a zero floor when a noisy negative control holds", () => {
    expect(noiseFloor(2.5, 2.0, 0.18)).toBeCloseTo(0.18, 5);
  });

  it("preserves an inverted control as a lower bound on the supplied resolution", () => {
    // The real 2026-09-01 run: static 2.18, none 2.55.
    expect(noiseFloor(2.18, 2.55, 0.12)).toBeCloseTo(0.37, 5);
  });

  it("fails closed when no resolution observation was supplied", () => {
    expect(() => noiseFloor(2.5, 2.0)).toThrow(/resolution/i);
  });
});

describe("resolveDelta", () => {
  it("reports a difference larger than the floor", () => {
    expect(resolveDelta(1.61, 0.37)).toBe(1.61);
  });

  it("withholds a difference smaller than the floor rather than printing a number", () => {
    expect(resolveDelta(0.2, 0.37)).toBeUndefined();
    expect(resolveDelta(-0.2, 0.37)).toBeUndefined();
  });

  it("withholds a difference exactly at the floor — the floor is not itself resolvable", () => {
    expect(resolveDelta(0.37, 0.37)).toBeUndefined();
  });

  it("withholds an impossible negative cost even when its magnitude clears the floor", () => {
    expect(resolveDelta(-1.61, 0.37)).toBeUndefined();
  });
});

describe("summarise", () => {
  const arms: readonly IArmSample[] = [
    { gpuMs: [2.1, 2.18, 4.07], label: "static", resolutionMs: 0.12 },
    { gpuMs: [0.41, 2.55, 5.64], label: "none", resolutionMs: 0.12 },
    { gpuMs: [3.65, 3.79, 6.48], label: "dirty/1", resolutionMs: 0.12 },
  ];

  it("names the prefilter cost and withholds the sampling cost under an inverted control", () => {
    const summary = summarise(arms);
    expect(summary.floor).toBeCloseTo(0.37, 5);
    expect(summary.controlHeld).toBe(false);
    expect(summary.prefilterPerFrame).toBeCloseTo(1.61, 5);
    expect(summary.samplingPerFrame).toBeUndefined();
  });

  it("carries a nonzero resolution floor through a correctly ordered noisy control", () => {
    const summary = summarise([
      { gpuMs: [2.4, 2.5, 2.7], label: "static", resolutionMs: 0.18 },
      { gpuMs: [2.0, 2.1, 2.3], label: "none", resolutionMs: 0.18 },
      { gpuMs: [2.6, 2.7, 2.9], label: "dirty/1", resolutionMs: 0.18 },
    ]);
    expect(summary.controlHeld).toBe(true);
    expect(summary.floor).toBeCloseTo(0.18, 5);
    expect(summary.samplingPerFrame).toBeCloseTo(0.4, 5);
  });

  it("fails closed when an arm the conclusion depends on never reported", () => {
    expect(() => summarise([{ gpuMs: [1], label: "static" }])).toThrow(/none/);
  });

  it("fails closed when the complete sample has no resolution observation", () => {
    expect(() =>
      summarise([
        { gpuMs: [2.1, 2.18, 4.07], label: "static" },
        { gpuMs: [0.41, 2.55, 5.64], label: "none" },
        { gpuMs: [3.65, 3.79, 6.48], label: "dirty/1" },
      ]),
    ).toThrow(/resolution/i);
  });
});
