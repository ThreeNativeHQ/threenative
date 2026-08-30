import { describe, expect, it } from "vitest";
import { FrameBudget, type IFrameBudgetWindow } from "../src/frame-budget.js";
import { RESOLUTION_SCALER, ResolutionScaler } from "../src/resolution-scaler.js";

/**
 * A few stalls shorter than `hitchMs` must not walk a game down the ladder.
 *
 * Measured on `sandbox/lumen-hall` (NVIDIA Turing, WebGPU, 1600x900, `--disable-gpu-vsync`,
 * resolution scale `auto`, target 60) on 2026-08-30. The scene's second 300-frame window is where
 * three finishes building WebGPU pipelines for a five-stage TSL post chain, and four of those 300
 * frames took roughly two seconds each. Each was under the 2 s hitch threshold, so each stayed in
 * the window and went into the mean. The window reported **22.6 fps** with a **presented p50 of
 * 9.8 ms** — 102 fps. The scaler read a 2.6x deficit, took its maximum four-rung jump, and the
 * game then held 145 fps at 832x468 for forty seconds: a third of the pixels surrendered to fix a
 * frame rate that was never missed, and the climb back is four windows a rung.
 *
 * The down-step is also the wrong medicine for this particular cause — the resize reallocates
 * every render target, which rebuilds pipelines, which is what stalled.
 */
describe("ResolutionScaler against a stalled window", () => {
  /**
   * One closed 300-frame window built out of real presented intervals, so the summaries the
   * controller reads are computed by the instrument rather than asserted into place.
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
      budget.addRender(delta * 0.9);
      budget.endFrame(clock + delta * 0.95, false);
    }
    if (reported === undefined) throw new Error("no window closed");
    return reported;
  }

  /** The measured window: 296 ordinary frames at 9.8 ms and four pipeline stalls at 1.94 s. */
  const stalledWindow = (): IFrameBudgetWindow =>
    windowOf((frame) => (frame > 0 && frame % 75 === 0 ? 1_940 : 9.8));
  const steadyWindow = (dtMs: number): IFrameBudgetWindow => windowOf(() => dtMs);

  it("reproduces the window that caused it: the mean says 22 fps, the median says 102", () => {
    const window = stalledWindow();
    // Not excluded. 1.94 s is under the 2 s hitch threshold, so these are frames like any other.
    expect(window.hitches).toBe(0);
    expect(window.presented.p50).toBeCloseTo(9.8, 1);
    expect(window.presented.p99).toBeGreaterThan(1_900);
    // The mean is telling a story less than half of the median's, and the median is the one the
    // 296 ordinary frames lived in. On the machine this came from the two read 22.6 and 102.
    expect(window.fps).toBeLessThan(1_000 / window.presented.p50 / 2);
    // The contradiction the controller has to notice, in one ratio.
    expect(window.presented.p99 / window.presented.p50).toBeGreaterThan(
      RESOLUTION_SCALER.stallP99Multiple,
    );
  });

  it("defers on it instead of surrendering four rungs of resolution", () => {
    const scaler = new ResolutionScaler({ targetFps: 60 });
    // Window 1 is discarded as startup by the controller's own warm-up rule.
    scaler.observe(steadyWindow(9.8));
    expect(scaler.observe(stalledWindow())).toBeUndefined();
    expect(scaler.scale).toBe(1.0);
  });

  it("does not treat a deferred window as evidence for climbing either", () => {
    const scaler = new ResolutionScaler({ targetFps: 60 });
    scaler.observe(steadyWindow(33.3));
    // Down to a lower rung on a genuinely slow window, then the cooldown window.
    expect(scaler.observe(steadyWindow(33.3))).toBeLessThan(1.0);
    const rung = scaler.scale;
    scaler.observe(steadyWindow(9.8));
    // Four windows that would otherwise be clean, with a stalled one in the middle of them.
    scaler.observe(steadyWindow(9.8));
    scaler.observe(steadyWindow(9.8));
    scaler.observe(stalledWindow());
    scaler.observe(steadyWindow(9.8));
    expect(scaler.scale).toBe(rung);
  });

  it("still steps down when the frames themselves are genuinely slow", () => {
    const scaler = new ResolutionScaler({ targetFps: 60 });
    scaler.observe(steadyWindow(9.8));
    // 33.3 ms every frame is 30 fps, and no outlier is doing the talking.
    expect(scaler.observe(steadyWindow(33.3))).toBeDefined();
    expect(scaler.scale).toBeLessThan(1.0);
  });

  it("still steps down on the vsync-capped panel this signal was chosen for", () => {
    const scaler = new ResolutionScaler({ targetFps: 60 });
    scaler.observe(steadyWindow(16.67));
    // 45 fps on a 60 Hz panel: three frames land on their vsync and the fourth misses it. The
    // median is one panel period and the p99 is two, so the tail is nowhere near the stall
    // multiple, and the mean is the signal — exactly as the device arm that chose it intended.
    const dropping = windowOf((frame) => (frame % 4 === 3 ? 33.34 : 16.67));
    expect(dropping.presented.p99 / dropping.presented.p50).toBeLessThan(
      RESOLUTION_SCALER.stallP99Multiple,
    );
    expect(scaler.observe(dropping)).toBeDefined();
    expect(scaler.scale).toBeLessThan(1.0);
  });
});
