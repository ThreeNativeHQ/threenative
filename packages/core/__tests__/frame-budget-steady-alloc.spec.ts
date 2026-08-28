import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { FrameBudget } from "../src/frame-budget.js";
import { FixedStepLoop } from "../src/loop.js";

/**
 * A steady frame with metrics collection off must not allocate.
 *
 * `FrameBudget.endFrame` returns a fresh phase-sample object every presented frame even when the
 * loop's `collectMetrics` is false — the default — and the loop discards it. Measured with a
 * GC-observer over 1.2M steady frames, that object never reaches the heap today: V8 scalar-replaces
 * it because it does not escape `stepFrame`. This pins that property — an edit that makes the
 * sample escape (a captured field, a closure, a wider return path) turns it red, and a red here is
 * one dead object per frame for every game, forever.
 */
describe("frame budget steady-state allocation", () => {
  it("runs a steady window with metrics off and collects zero garbage", () => {
    const budget = new FrameBudget({ reportEvery: Number.MAX_SAFE_INTEGER, hitchMs: 1e12 });
    const loop = new FixedStepLoop({
      budget,
      collectMetrics: false,
      onUpdate: () => undefined,
      onRender: () => undefined,
      onFrame: () => undefined,
      requestFrame: (callback) => {
        void callback;
        return 0;
      },
      cancelFrame: () => undefined,
    });

    // Warm every path once so lazy setup does not land in the counted window.
    for (let index = 0; index < 100; index += 1) loop.stepFrame(16.67 * (index + 1));

    const events: string[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) events.push(entry.entryType);
    });
    observer.observe({ entryTypes: ["gc"] });

    const frames = 1_200_000;
    const startedAt = performance.now();
    for (let index = 0; index < frames; index += 1) loop.stepFrame(16.67 * (index + 1));
    const elapsedMs = performance.now() - startedAt;
    observer.disconnect();

    // The window runs no simulation steps and renders nothing, so the only allocation pressure is
    // the budget itself; any GC inside it is the defect announcing itself.
    expect(
      events,
      `${events.length} GC events across ${frames} frames in ${Math.round(elapsedMs)}ms`,
    ).toEqual([]);
  });
});
