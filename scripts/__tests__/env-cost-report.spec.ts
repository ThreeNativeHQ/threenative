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
  it("is zero when the negative control holds — none does less work than static", () => {
    expect(noiseFloor(2.5, 2.0)).toBe(0);
  });

  it("is the size of the inversion when none reads above static", () => {
    // The real 2026-09-01 run: static 2.18, none 2.55.
    expect(noiseFloor(2.18, 2.55)).toBeCloseTo(0.37, 5);
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
});

describe("summarise", () => {
  const arms: readonly IArmSample[] = [
    { gpuMs: [2.1, 2.18, 4.07], label: "static" },
    { gpuMs: [0.41, 2.55, 5.64], label: "none" },
    { gpuMs: [3.65, 3.79, 6.48], label: "dirty/1" },
  ];

  it("names the prefilter cost and withholds the sampling cost under an inverted control", () => {
    const summary = summarise(arms);
    expect(summary.floor).toBeCloseTo(0.37, 5);
    expect(summary.controlHeld).toBe(false);
    expect(summary.prefilterPerFrame).toBeCloseTo(1.61, 5);
    expect(summary.samplingPerFrame).toBeUndefined();
  });

  it("fails closed when an arm the conclusion depends on never reported", () => {
    expect(() => summarise([{ gpuMs: [1], label: "static" }])).toThrow(/none/);
  });
});
