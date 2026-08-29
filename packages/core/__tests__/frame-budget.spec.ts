import { describe, expect, it } from "vitest";
import {
  FRAME_BUDGET_MARKER,
  FRAME_BUDGET_PHASES,
  FRAME_HITCH_MARKER,
  FrameBudget,
  type IFrameBudgetWindow,
  type IFramePhaseSample,
} from "../src/frame-budget.js";
import { FixedStepLoop } from "../src/loop.js";

/**
 * A scripted device frame. The numbers are the measured Pixel 8 shape from
 * `docs/bugs/mobile-stability-2026-08-23.md` bug 3: a 54.44 ms frame whose renderer.render()
 * owns 49.42 ms. The budget's job is to say that out loud without anybody wrapping
 * requestAnimationFrame by hand.
 */
const DEVICE_FRAME = {
  hostGap: 1.42,
  overlay: 0.3,
  presented: 56.01,
  render: 49.42,
  residual: 0.04,
  update: 3.26,
} as const;

/** Drives one presented frame with a fake clock, in the order the loop drives it. */
function driveFrame(
  budget: FrameBudget,
  clock: { now: number; timestamp: number },
  frame: {
    hostGap: number;
    update: number;
    render: number;
    overlay: number;
    residual: number;
    presented: number;
  },
): void {
  clock.now += frame.hostGap;
  clock.timestamp += frame.presented;
  budget.beginFrame(clock.timestamp, clock.now);
  clock.now += frame.update;
  budget.markSimulationEnd(clock.now, 3);
  budget.addRender(frame.render);
  clock.now += frame.render;
  budget.addOverlay(frame.overlay);
  clock.now += frame.overlay;
  clock.now += frame.residual;
  budget.endFrame(clock.now);
}

function driveFrameWithoutSample(
  budget: FrameBudget,
  clock: { now: number; timestamp: number },
  frame: typeof DEVICE_FRAME,
): IFramePhaseSample | undefined {
  clock.now += frame.hostGap;
  clock.timestamp += frame.presented;
  budget.beginFrame(clock.timestamp, clock.now);
  clock.now += frame.update;
  budget.markSimulationEnd(clock.now, 3);
  budget.addRender(frame.render);
  clock.now += frame.render;
  budget.addOverlay(frame.overlay);
  clock.now += frame.overlay;
  clock.now += frame.residual;
  return budget.endFrame(clock.now, false);
}

describe("frame budget phase sample", () => {
  it("should build no phase sample when the caller will discard it", () => {
    const budget = new FrameBudget({ reportEvery: Number.MAX_SAFE_INTEGER });
    const clock = { now: 0, timestamp: 0 };
    driveFrame(budget, clock, DEVICE_FRAME);
    const unwanted = driveFrameWithoutSample(budget, clock, DEVICE_FRAME);
    expect(unwanted).toBeUndefined();
  });

  it("should measure the same window whether or not the sample is built", () => {
    const withSample = new FrameBudget({ reportEvery: Number.MAX_SAFE_INTEGER });
    const withoutSample = new FrameBudget({ reportEvery: Number.MAX_SAFE_INTEGER });
    const clockA = { now: 0, timestamp: 0 };
    const clockB = { now: 0, timestamp: 0 };
    for (let index = 0; index < 8; index += 1) {
      driveFrame(withSample, clockA, DEVICE_FRAME);
      driveFrameWithoutSample(withoutSample, clockB, DEVICE_FRAME);
    }
    // Turning the sample off must not turn the measurement off.
    expect(withoutSample.window().phases).toEqual(withSample.window().phases);
    expect(withoutSample.window().frames).toBe(withSample.window().frames);
  });

  it("should still return a sample when the caller asks for one", () => {
    const budget = new FrameBudget({ reportEvery: Number.MAX_SAFE_INTEGER });
    const clock = { now: 0, timestamp: 0 };
    driveFrame(budget, clock, DEVICE_FRAME);
    clock.now += DEVICE_FRAME.hostGap;
    clock.timestamp += DEVICE_FRAME.presented;
    budget.beginFrame(clock.timestamp, clock.now);
    clock.now += DEVICE_FRAME.update;
    budget.markSimulationEnd(clock.now, 3);
    budget.addRender(DEVICE_FRAME.render);
    clock.now += DEVICE_FRAME.render;
    clock.now += DEVICE_FRAME.overlay;
    expect(budget.endFrame(clock.now, true)).toEqual(
      expect.objectContaining({ render: expect.any(Number), update: expect.any(Number) }),
    );
  });
});

function collectingBudget(reportEvery: number): { budget: FrameBudget; lines: string[] } {
  const lines: string[] = [];
  const budget = new FrameBudget({
    report: (line) => lines.push(line),
    reportEvery,
    wallClock: () => 1_700_000,
  });
  return { budget, lines };
}

function parseWindow(line: string): IFrameBudgetWindow {
  return JSON.parse(line.slice(`${FRAME_BUDGET_MARKER}:`.length)) as IFrameBudgetWindow;
}

describe("FrameBudget", () => {
  it("attributes the device frame to the phase that owns it", () => {
    const { budget, lines } = collectingBudget(10);
    const clock = { now: 0, timestamp: 0 };
    for (let index = 0; index < 10; index += 1) driveFrame(budget, clock, DEVICE_FRAME);

    expect(lines).toHaveLength(1);
    const window = parseWindow(lines[0] ?? "");
    expect(window.frames).toBe(10);
    expect(window.hitches).toBe(0);
    // 56.01 ms between presented frames is 17.85 fps, which is the number a player feels.
    expect(window.fps).toBeCloseTo(17.85, 1);
    expect(window.presented.p50).toBeCloseTo(DEVICE_FRAME.presented, 2);
    expect(window.phases.render.p50).toBeCloseTo(DEVICE_FRAME.render, 2);
    expect(window.phases.update.p50).toBeCloseTo(DEVICE_FRAME.update, 2);
    expect(window.phases.hostGap.p50).toBeCloseTo(DEVICE_FRAME.hostGap, 2);
    expect(window.phases.residual.p50).toBeCloseTo(DEVICE_FRAME.residual, 2);
    // The headline of PRD-214: render owns ~88% of the frame, and the budget says so.
    expect(window.shares.render).toBeGreaterThan(0.85);
    expect(window.shares.render).toBeLessThan(0.9);
    const total = FRAME_BUDGET_PHASES.reduce((sum, phase) => sum + window.shares[phase], 0);
    expect(total).toBeGreaterThan(0.95);
    expect(total).toBeLessThan(1.05);
  });

  it("moves the attribution when the cost moves, so a lever is visible", () => {
    const { budget, lines } = collectingBudget(10);
    const clock = { now: 0, timestamp: 0 };
    const cheapRender = { ...DEVICE_FRAME, presented: 12.0, render: 5.0 };
    for (let index = 0; index < 10; index += 1) driveFrame(budget, clock, cheapRender);
    const window = parseWindow(lines[0] ?? "");
    expect(window.phases.render.p50).toBeCloseTo(5, 2);
    expect(window.shares.render).toBeLessThan(0.5);
    expect(window.fps).toBeGreaterThan(80);
  });

  it("tags a hitch, keeps it out of the percentiles, and counts it", () => {
    const { budget, lines } = collectingBudget(4);
    const clock = { now: 0, timestamp: 0 };
    driveFrame(budget, clock, DEVICE_FRAME);
    // The 27.4-second startup stall from the device log: real, worth a marker, not a frame time.
    driveFrame(budget, clock, { ...DEVICE_FRAME, presented: 27_445 });
    for (let index = 0; index < 3; index += 1) driveFrame(budget, clock, DEVICE_FRAME);

    const hitchLines = lines.filter((line) => line.startsWith(`${FRAME_HITCH_MARKER}:`));
    expect(hitchLines).toHaveLength(1);
    expect(JSON.parse(hitchLines[0]?.slice(`${FRAME_HITCH_MARKER}:`.length) ?? "{}")).toMatchObject(
      {
        gapMs: 27_445,
        wallClock: 1_700_000,
      },
    );
    const window = parseWindow(
      lines.find((line) => line.startsWith(`${FRAME_BUDGET_MARKER}:`)) ?? "",
    );
    expect(window.frames).toBe(4);
    expect(window.hitches).toBe(1);
    expect(window.presented.max).toBeLessThan(100);
  });

  it("reports zero samples for a phase nothing measured, so a consumer fails instead of skipping", () => {
    const budget = new FrameBudget({ report: () => undefined });
    const window = budget.window();
    expect(window.frames).toBe(0);
    expect(window.fps).toBe(0);
    for (const phase of FRAME_BUDGET_PHASES) expect(window.phases[phase].samples).toBe(0);
  });

  it("resets the rings each window so a late line describes steady state", () => {
    const { budget, lines } = collectingBudget(3);
    const clock = { now: 0, timestamp: 0 };
    for (let index = 0; index < 3; index += 1) driveFrame(budget, clock, DEVICE_FRAME);
    for (let index = 0; index < 3; index += 1)
      driveFrame(budget, clock, { ...DEVICE_FRAME, presented: 16.7, render: 8 });
    const windows = lines.map(parseWindow);
    expect(windows).toHaveLength(2);
    expect(windows[0]?.window).toBe(1);
    expect(windows[1]?.window).toBe(2);
    expect(windows[0]?.phases.render.p50).toBeCloseTo(49.42, 2);
    expect(windows[1]?.phases.render.p50).toBeCloseTo(8, 2);
    expect(windows[1]?.presented.max).toBeLessThan(20);
  });

  it("hands each completed window to onWindow, after the rings have reset", () => {
    const seen: IFrameBudgetWindow[] = [];
    const budget = new FrameBudget({
      onWindow: (window) => seen.push(window),
      report: () => undefined,
      reportEvery: 2,
    });
    const clock = { now: 0, timestamp: 0 };
    for (let index = 0; index < 4; index += 1) driveFrame(budget, clock, DEVICE_FRAME);
    expect(seen.map(({ window }) => window)).toEqual([1, 2]);
    expect(seen[0]?.phases.render.p50).toBeCloseTo(DEVICE_FRAME.render, 2);
    // A consumer changing the scene from the callback affects the window that starts now.
    expect(budget.window().frames).toBe(0);
  });

  it("throws on malformed options rather than measuring nothing quietly", () => {
    expect(() => new FrameBudget({ reportEvery: 0 })).toThrow(/reportEvery/u);
    expect(() => new FrameBudget({ reportEvery: 2.5 })).toThrow(/reportEvery/u);
    expect(() => new FrameBudget({ hitchMs: 0 })).toThrow(/hitchMs/u);
    expect(() => new FrameBudget({ hitchMs: Number.NaN })).toThrow(/hitchMs/u);
    expect(() => new FrameBudget({ capacity: -1 })).toThrow(/capacity/u);
  });

  it("throws when the frame phases arrive out of order", () => {
    const budget = new FrameBudget({ report: () => undefined });
    expect(() => budget.endFrame(1)).toThrow(/outside a frame/u);
    expect(() => budget.addRender(1)).toThrow(/outside a frame/u);
    expect(() => budget.markSimulationEnd(1, 1)).toThrow(/outside a frame/u);
    budget.beginFrame(0, 0);
    expect(() => budget.beginFrame(1, 1)).toThrow(/before the previous frame ended/u);
  });

  it("throws on a non-finite sample instead of publishing a clean percentile", () => {
    const budget = new FrameBudget({ report: () => undefined });
    budget.beginFrame(0, 0);
    budget.markSimulationEnd(1, 1);
    budget.addRender(Number.NaN);
    expect(() => budget.endFrame(2)).toThrow(/non-finite/u);
  });
});

describe("FixedStepLoop with a frame budget", () => {
  it("splits simulation from render without the game wrapping anything", () => {
    const lines: string[] = [];
    const budget = new FrameBudget({ report: (line) => lines.push(line), reportEvery: 2 });
    let clock = 0;
    const loop = new FixedStepLoop({
      budget,
      collectMetrics: true,
      now: () => clock,
      // Each fixed step costs 2 ms of the fake clock; the render costs 40.
      onRender: () => {
        clock += 40;
        budget.addRender(40);
        return { drawCalls: 7 };
      },
      onUpdate: () => {
        clock += 2;
      },
      step: 1 / 60,
    });
    loop.start(0);
    loop.stepFrame(16.7);
    loop.stepFrame(33.4);
    loop.stepFrame(50.1);

    expect(loop.budget).toBe(budget);
    const samples = loop.runtimeDiagnosticsSeries();
    expect(samples.length).toBeGreaterThan(0);
    const last = samples[samples.length - 1];
    expect(last?.phases).toBeDefined();
    expect(last?.phases?.render).toBeCloseTo(40, 2);
    expect(last?.phases?.update).toBeCloseTo(2, 2);
    expect(last?.drawCalls).toBe(7);
    const window = parseWindow(
      lines.find((line) => line.startsWith(`${FRAME_BUDGET_MARKER}:`)) ?? "",
    );
    expect(window.phases.render.p50).toBeCloseTo(40, 2);
    expect(window.substeps.p50).toBe(1);
  });

  it("collects no phases and prints nothing when no budget is installed", () => {
    let clock = 0;
    const loop = new FixedStepLoop({
      collectMetrics: true,
      now: () => clock,
      onRender: () => {
        clock += 40;
        return undefined;
      },
      onUpdate: () => {
        clock += 2;
      },
      step: 1 / 60,
    });
    loop.start(0);
    loop.stepFrame(16.7);
    loop.stepFrame(33.4);
    expect(loop.budget).toBeUndefined();
    expect(loop.runtimeDiagnosticsSeries().every((sample) => sample.phases === undefined)).toBe(
      true,
    );
  });

  it("closes the budget when rendering throws", () => {
    const budget = new FrameBudget({ report: () => undefined });
    let renderCalls = 0;
    const loop = new FixedStepLoop({
      budget,
      onUpdate: () => undefined,
      onRender: () => {
        renderCalls += 1;
        if (renderCalls === 1) throw new Error("renderer failed");
        return undefined;
      },
    });

    expect(() => loop.stepFrame(0)).toThrow("renderer failed");
    expect(() => loop.stepFrame(16)).not.toThrow();
  });
});
