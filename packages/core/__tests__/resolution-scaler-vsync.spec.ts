import { describe, expect, it } from "vitest";
import { FrameBudget, type IFrameBudgetWindow } from "../src/frame-budget.js";
import { RESOLUTION_SCALER, ResolutionScaler } from "../src/resolution-scaler.js";

/**
 * A game that is meeting its budget on a vsync-capped panel must not be walked down the ladder.
 *
 * The owner's report on `sandbox/wildwood`, repeatedly, over several days: "the resolution starts
 * dropping out of nowhere, and things start getting blurred", and "blurriness worsening over
 * time". Two fixes aimed at the frame cost — startup frames reaching the controller, and `SSGINode`
 * gathering at full resolution — each removed a real cause and neither stopped it.
 *
 * The cause that survived is arithmetic in the controller, and it only appears in the one regime
 * every desktop and phone actually plays in: **`display.maxFps` equal to the panel's own refresh,
 * with vsync on.** There, `fps` is bounded *above* by the target. A game rendering every frame
 * inside the budget reports exactly 60 and cannot report more, so the whole of the controller's
 * "am I meeting the target" test lives in the 2% between 58.8 and 60 — and each present the
 * compositor drops spends a third of one percent of it. Seven dropped presents out of 300, in a
 * five-second window whose median frame is exactly one panel period, read as a pixel deficit.
 *
 * Dropping pixels does not bring a dropped present back, so the down-step gets no corrective
 * signal and the next window spends another rung. Replayed through the shipped controller, a
 * session that never falls below 57.9 fps and never renders a frame over budget walks 1.00 -> 0.23
 * in 140 seconds and then reports `atFloor`.
 *
 * The window's own record carries the contradiction: `presented.p50` and `presented.p95` both sit
 * at one panel period while the *mean* alone is over. That is the same lesson `stallP99Multiple`
 * records — "`fps` is `1000 / mean`, and a mean is not robust" — and it had only ever been applied
 * to outliers an order of magnitude out, not to the single missed vsync that is 2x.
 */
describe("ResolutionScaler on a vsync-capped panel", () => {
  /**
   * One closed 300-frame window built out of real presented intervals, so every summary the
   * controller reads is computed by the shipped instrument rather than asserted into place.
   */
  function windowOf(intervals: (frame: number) => number): IFrameBudgetWindow {
    let reported: IFrameBudgetWindow | undefined;
    const budget = new FrameBudget({
      reportEvery: 300,
      report: () => undefined,
      onWindow: (window) => {
        reported = window;
      },
    });
    let clock = 0;
    // 301 frames: the first has no predecessor and so contributes no presented interval.
    for (let frame = 0; frame < 301; frame += 1) {
      const delta = intervals(frame);
      clock += delta;
      budget.beginFrame(clock, clock);
      budget.markSimulationEnd(clock, 1);
      budget.addRender(delta * 0.5);
      budget.endFrame(clock + delta * 0.6, false);
    }
    if (reported === undefined) throw new Error("no window closed");
    return reported;
  }

  /** A 60 Hz panel's period. Under FIFO a present costs a whole number of these, never a fraction. */
  const PERIOD = 1_000 / 60;
  /** Every present lands on its vsync: the game has headroom and the panel is the only limit. */
  const perfect = (): IFrameBudgetWindow => windowOf(() => PERIOD);
  /**
   * `dropped` presents out of 300 miss their vsync and take two periods. Nothing else changes:
   * the median frame still costs one period, which is what makes this a jitter window rather than
   * a slow one. A compositor, a GC, an input burst and an audio callback all produce it, and none
   * of them gets cheaper when the drawing buffer shrinks.
   */
  const jitter = (dropped: number): IFrameBudgetWindow => {
    const spacing = Math.round(300 / dropped);
    return windowOf((frame) => (frame > 0 && frame % spacing === 0 ? 2 * PERIOD : PERIOD));
  };

  it("reproduces the window: the mean is under target while the median and the tail are not", () => {
    const window = jitter(12);
    expect(window.hitches).toBe(0);
    // 4% of presents doubled. The mean has crossed the bar; nothing else has.
    expect(window.fps).toBeLessThan(60 * RESOLUTION_SCALER.targetFpsFraction);
    expect(window.presented.p50).toBeCloseTo(PERIOD, 1);
    expect(window.presented.p95).toBeCloseTo(PERIOD, 1);
    // And it is not a stall either, so the existing guard has nothing to say about it: one missed
    // vsync is 2x the median, an order of magnitude short of `stallP99Multiple`.
    expect(window.presented.p99 / window.presented.p50).toBeLessThan(
      RESOLUTION_SCALER.stallP99Multiple,
    );
  });

  it("holds the rung when only the mean is under target", () => {
    const scaler = new ResolutionScaler({ targetFps: 60 });
    scaler.observe(perfect());
    expect(scaler.observe(jitter(12))).toBeUndefined();
    expect(scaler.scale).toBe(1.0);
  });

  it("does not walk a game that never rendered a frame over budget to the floor", () => {
    // Seventeen minutes of play on a panel that drops a handful of presents each window. Every
    // frame's own work is inside the budget for the whole run.
    const scaler = new ResolutionScaler({ targetFps: 60 });
    const windows = [jitter(7), jitter(9), jitter(12), perfect()];
    for (let index = 0; index < 200; index += 1)
      scaler.observe(windows[index % windows.length] as IFrameBudgetWindow);
    expect(scaler.scale).toBe(1.0);
    expect(scaler.atFloor).toBe(false);
    expect(scaler.scaleSource).toBe("auto");
  });

  it("still falls when the frames themselves are over budget, vsync or not", () => {
    // Unlocked, and steadily 3% past the budget: the median is over, so the deficit is real work.
    const steady = new ResolutionScaler({ targetFps: 60 });
    steady.observe(perfect());
    expect(steady.observe(windowOf(() => 17.24))).toBe(0.85);

    // Vsync-capped and genuinely missing: a quarter of the presents doubled puts the tail over,
    // which is the signal the device arm chose the mean for in the first place.
    const missing = new ResolutionScaler({ targetFps: 60 });
    missing.observe(perfect());
    expect(missing.observe(jitter(75))).toBeDefined();
    expect(missing.scale).toBeLessThan(1.0);
  });

  it("lets a game recover once the hitches that deferred its windows stop mattering", () => {
    // A forest streams: one frame an order of magnitude past the median — a late pipeline compile,
    // a decode, a GC — arrives every third window. The controller correctly declines to read those
    // windows. It must not also forget the clean ones between them, or a game that hitches more
    // often than once every four windows can never climb back, however fast it is.
    const scaler = new ResolutionScaler({ start: 0.44, targetFps: 60 });
    const stalled = windowOf((frame) => (frame === 150 ? 400 : PERIOD));
    expect(stalled.presented.max / stalled.presented.p50).toBeGreaterThan(
      RESOLUTION_SCALER.stallMaxMultiple,
    );
    for (let index = 0; index < 60; index += 1)
      scaler.observe(index % 3 === 2 ? stalled : perfect());
    expect(scaler.scale).toBe(1.0);
  });
});
