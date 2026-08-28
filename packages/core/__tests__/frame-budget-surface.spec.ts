import { describe, expect, it } from "vitest";
import { FRAME_BUDGET_MARKER, FrameBudget, type IFrameSurfaceState } from "../src/frame-budget.js";

/**
 * The defect this pins: the perf record said `resolutionScale: 0.36` while the tree said 0.32,
 * and nothing in the marker could contradict either. A frame-budget window that cannot name the
 * resolution and sample count that produced it is not a measurement of anything in particular.
 */
const PINNED: IFrameSurfaceState = {
  atFloor: false,
  drawingBufferHeight: 346,
  drawingBufferWidth: 768,
  resolutionScale: 0.32,
  sampleCount: 1,
  scaleSource: "pinned",
};

function driveWindow(budget: FrameBudget, frames: number): void {
  const clock = { now: 0, timestamp: 0 };
  for (let index = 0; index < frames; index += 1) {
    clock.now += 1;
    clock.timestamp += 16.7;
    budget.beginFrame(clock.timestamp, clock.now);
    clock.now += 2;
    budget.markSimulationEnd(clock.now, 1);
    budget.addRender(9);
    clock.now += 9;
    budget.endFrame(clock.now);
  }
}

describe("frame-budget surface reporting", () => {
  it("names the scale, its source, the sample count and the drawing buffer in every window", () => {
    const lines: string[] = [];
    const budget = new FrameBudget({
      readSurface: () => PINNED,
      report: (line) => lines.push(line),
      reportEvery: 4,
    });
    driveWindow(budget, 4);
    const line = lines.find((entry) => entry.startsWith(`${FRAME_BUDGET_MARKER}:`));
    expect(line).toBeDefined();
    const reported = JSON.parse(line?.slice(FRAME_BUDGET_MARKER.length + 1) ?? "{}");
    expect(reported.surface).toEqual(PINNED);
  });

  it("reports the surface when the scale is pinned, not only when the scaler owns it", () => {
    // Turning the convention off must not turn its measurement off.
    for (const scaleSource of ["pinned", "auto"] as const) {
      const budget = new FrameBudget({
        readSurface: () => ({ ...PINNED, scaleSource }),
        report: () => {},
        reportEvery: 4,
      });
      driveWindow(budget, 4);
      expect(budget.window().surface?.scaleSource).toBe(scaleSource);
    }
  });

  it("fails closed on a surface reading that cannot describe an image", () => {
    const cases: Array<[string, IFrameSurfaceState]> = [
      ["a scale above one", { ...PINNED, resolutionScale: 1.5 }],
      ["a zero scale", { ...PINNED, resolutionScale: 0 }],
      ["a non-finite scale", { ...PINNED, resolutionScale: Number.NaN }],
      ["a zero-width buffer", { ...PINNED, drawingBufferWidth: 0 }],
      ["a sample count below one", { ...PINNED, sampleCount: 0 }],
      [
        "an unnamed scale source",
        { ...PINNED, scaleSource: "guessed" as IFrameSurfaceState["scaleSource"] },
      ],
    ];
    for (const [why, surface] of cases) {
      const budget = new FrameBudget({
        readSurface: () => surface,
        report: () => {},
        reportEvery: 4,
      });
      expect(() => driveWindow(budget, 4), why).toThrow(/surface/iu);
    }
  });

  it("omits the surface entirely when nothing reported one", () => {
    // Never a fabricated 1.0: a consumer asserting on the field must fail, not read a default.
    const budget = new FrameBudget({ report: () => {}, reportEvery: 4 });
    driveWindow(budget, 4);
    expect(budget.window().surface).toBeUndefined();
  });
});
