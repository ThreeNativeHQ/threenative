import { describe, expect, it } from "vitest";
import { FrameBudget } from "../src/frame-budget.js";
import { FixedStepLoop } from "../src/loop.js";
import { Scheduler } from "../src/schedule.js";

/**
 * A steady frame with metrics collection off must not allocate per frame — one dead object a frame
 * is one dead object a frame for every game, forever.
 *
 * This file used to assert that by counting GC events from a `PerformanceObserver` across 1.2M
 * steady frames and requiring the list to be empty. That assertion could not fail. V8 hands GC
 * entries to an observer through the event loop, never at the moment of collection, and the window
 * disconnected the observer without ever yielding — so `events` was `[]` whatever the frame did.
 * Measured on 2026-08-29: with the yield restored the same window reports ~130 GC events, and
 * deliberately pushing 1.2M escaping closures through the tween did not change the old green.
 *
 * The instrument does not survive repair either. Two windows in one process report ~135 for
 * whichever is measured first and ~70 for whichever is second, regardless of which configuration
 * each holds, so the count reads warm-up order rather than allocation. A bar tight enough to catch
 * a regression would flake on ordering; a bar loose enough to be stable would assert nothing.
 *
 * So the per-frame allocation properties are pinned deterministically instead, by what the frame
 * does rather than by what the collector noticed. The measured finding that the fixed-step frame is
 * not allocation-free is recorded in `docs/verification/runtime-perf-state.md` §1.4.1; it is a real
 * defect, it is larger than this file, and it is not this file's to hide.
 */
describe("frame budget steady-state allocation", () => {
  it("should evaluate a tween curve exactly once per tick", () => {
    const scheduler = new Scheduler();
    const target = { x: 0 };
    const seen: number[] = [];
    void scheduler.tween(target, { x: 10 }, 1, {
      ease: (t) => {
        seen.push(t);
        return t * t;
      },
    });

    scheduler.tick(0.25);
    expect(seen).toHaveLength(1);
    scheduler.tick(0.25);
    // A curve re-wrapped or re-evaluated per tick shows up here as a second call for one frame,
    // which is the shape a per-frame allocation in the tween takes.
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBeGreaterThan(seen[0] as number);
    expect(target.x).toBeCloseTo(10 * 0.5 ** 2, 10);
  });

  it("should evaluate the curve once on the frame that lands the tween, and not use it", () => {
    const scheduler = new Scheduler();
    const target = { x: 0 };
    const seen: number[] = [];
    void scheduler.tween(target, { x: 10 }, 1, {
      ease: (t) => {
        seen.push(t);
        // A curve is free to overshoot or to miss 1 at 1; the landing frame must not care.
        return t * 3;
      },
    });

    scheduler.tick(1);
    // t === 1 is delivered exactly once, and the end value is assigned rather than interpolated,
    // so a curve that returns 3 at 1 still lands on 10 and costs exactly one call.
    expect(seen).toEqual([1]);
    expect(target.x).toBe(10);
  });

  it("should build no phase sample per frame while a curved tween runs with metrics off", () => {
    const scheduler = new Scheduler();
    const target = { x: 0 };
    void scheduler.tween(target, { x: 1 }, 10, { ease: (t) => t * t });

    const built: unknown[] = [];
    const budget = new FrameBudget({ reportEvery: Number.MAX_SAFE_INTEGER, hitchMs: 1e12 });
    const realEndFrame = budget.endFrame.bind(budget);
    budget.endFrame = (nowMs: number, wantSample?: boolean) => {
      const sample = realEndFrame(nowMs, wantSample);
      if (sample !== undefined) built.push(sample);
      return sample;
    };

    const loop = new FixedStepLoop({
      budget,
      collectMetrics: false,
      onUpdate: (dt) => scheduler.tick(dt),
      onRender: () => undefined,
      onFrame: () => undefined,
      requestFrame: (callback) => {
        void callback;
        return 0;
      },
      cancelFrame: () => undefined,
    });

    for (let index = 0; index < 240; index += 1) loop.stepFrame(16.67 * (index + 1));

    expect(target.x).toBeGreaterThan(0);
    // The loop discards the split when metrics are off, so building one is a dead object a frame.
    expect(built).toEqual([]);
    // Turning the sample off must not turn the measurement off.
    expect(budget.window().frames).toBeGreaterThan(0);
    expect(budget.window().phases.update.samples).toBeGreaterThan(0);
  });
});
