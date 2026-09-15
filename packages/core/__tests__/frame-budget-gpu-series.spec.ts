import { describe, expect, it } from "vitest";
import { FRAME_BUDGET_MARKER, FrameBudget, type IFrameBudgetWindow } from "../src/frame-budget.js";

/**
 * The defect this pins, measured in `report-GPU1.md`: the frame budget reported one
 * instantaneous `info.render.timestamp` read per window. That read is lagged — `gpuAgeFrames`
 * reached 8 — and consecutive reads of the same steady frame spread 3.5x, so a real 17.6 ms
 * frame was reported as 2.98–10.40 ms. A single lagged sample is not the frame's GPU cost; the
 * resolved frames' distribution is. This feeds the budget a per-frame series and asserts it
 * summarises like the phase rings, counts a reading that has not advanced, and reports
 * unavailable — never a fabricated zero — when it has no reading at all.
 */

function gpuBudget(
  options: { reportEvery?: number; onWindow?: (window: IFrameBudgetWindow) => void } = {},
): FrameBudget {
  return new FrameBudget({ report: () => {}, reportEvery: 100, ...options });
}

/** Drives presented frames, one GPU observation per frame, through the open frame lifecycle. */
function driveGpu(
  budget: FrameBudget,
  frames: ReadonlyArray<readonly [number | undefined, number?]>,
): void {
  const clock = { now: 0, timestamp: 0 };
  for (const [ms, frame] of frames) {
    clock.now += 1;
    clock.timestamp += 16.7;
    budget.beginFrame(clock.timestamp, clock.now);
    clock.now += 2;
    budget.markSimulationEnd(clock.now, 1);
    budget.addRender(9);
    clock.now += 9;
    if (frame === undefined) budget.addGpuMs(ms);
    else budget.addGpuMs(ms, frame);
    budget.endFrame(clock.now);
  }
}

describe("frame-budget GPU series", () => {
  it("reports the resolved frames' mean/p50/p95/max, not the last value", () => {
    const budget = gpuBudget();
    driveGpu(budget, [
      [10, 1],
      [20, 2],
      [30, 3],
      [40, 4],
    ]);
    const window = budget.window();
    expect(window.gpu?.samples).toBe(4);
    expect(window.gpu?.mean).toBe(25);
    expect(window.gpu?.p50).toBe(20);
    expect(window.gpu?.p95).toBe(40);
    expect(window.gpu?.p99).toBe(40);
    expect(window.gpu?.max).toBe(40);
    // The scalar readers (resolution scaler, playtest perf) get the window mean, not the sample.
    expect(window.gpuMs).toBe(25);
  });

  it("counts a reading that has not advanced rather than measuring it twice", () => {
    const budget = gpuBudget();
    driveGpu(budget, [
      [10, 5],
      [99, 5],
      [undefined],
    ]);
    const window = budget.window();
    // Only frame 5's first read is a measurement; the repeat and the missing read are stale.
    expect(window.gpu?.samples).toBe(1);
    expect(window.gpu?.mean).toBe(10);
    expect(window.gpuStale).toBe(2);
  });

  it("reports unavailable, not zero, when no frame produced a reading", () => {
    const budget = gpuBudget();
    driveGpu(budget, [
      [undefined],
      [undefined],
      [undefined],
    ]);
    const window = budget.window();
    expect(window.gpu).toBeUndefined();
    expect(window.gpuMs).toBeUndefined();
    expect(window.gpuStale).toBe(3);
  });

  it("reports unavailable when nothing ever fed it a GPU reading", () => {
    const budget = gpuBudget();
    const clock = { now: 0, timestamp: 0 };
    for (let index = 0; index < 4; index += 1) {
      clock.now += 1;
      clock.timestamp += 16.7;
      budget.beginFrame(clock.timestamp, clock.now);
      clock.now += 2;
      budget.markSimulationEnd(clock.now, 1);
      budget.addRender(9);
      clock.now += 9;
      budget.endFrame(clock.now);
    }
    const window = budget.window();
    expect(window.gpu).toBeUndefined();
    expect(window.gpuMs).toBeUndefined();
    expect(window.gpuStale).toBe(0);
  });

  it("leaves the phase series untouched when GPU samples ride along", () => {
    const withGpu = gpuBudget();
    const withoutGpu = gpuBudget();
    driveGpu(withGpu, [
      [10, 1],
      [20, 2],
      [30, 3],
    ]);
    driveGpu(withoutGpu, [
      [undefined],
      [undefined],
      [undefined],
    ]);
    expect(withGpu.window().phases).toEqual(withoutGpu.window().phases);
    expect(withGpu.window().frames).toBe(withoutGpu.window().frames);
  });

  it("resets the GPU ring each window like the phase rings", () => {
    const lines: string[] = [];
    const budget = new FrameBudget({ report: (line) => lines.push(line), reportEvery: 2 });
    driveGpu(budget, [
      [10, 1],
      [20, 2],
    ]);
    driveGpu(budget, [
      [100, 3],
      [200, 4],
    ]);
    const windows = lines
      .filter((line) => line.startsWith(`${FRAME_BUDGET_MARKER}:`))
      .map((line) => JSON.parse(line.slice(`${FRAME_BUDGET_MARKER}:`.length)) as IFrameBudgetWindow);
    expect(windows).toHaveLength(2);
    expect(windows[0]?.gpu?.mean).toBe(15);
    expect(windows[1]?.gpu?.mean).toBe(150);
  });

  it("throws on a malformed reading rather than publishing it", () => {
    const budget = gpuBudget();
    budget.beginFrame(0, 0);
    expect(() => budget.addGpuMs(-1, 1)).toThrow(/gpuMs/u);
    expect(() => budget.addGpuMs(Number.NaN, 1)).toThrow(/gpuMs/u);
    expect(() => budget.addGpuMs(10, 1.5)).toThrow(/frame/u);
    expect(() => budget.addGpuMs(10, -1)).toThrow(/frame/u);
  });
});
