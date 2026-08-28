import { describe, expect, it } from "vitest";
import { RESOLUTION_SCALER, ResolutionScaler } from "../src/resolution-scaler.js";

/**
 * PRD-228 Phase 2. Every number here is pre-registered in the PRD before this code existed and
 * is read from one constant block — a controller tuned until it looked right in a playtest is a
 * controller nobody can argue with afterwards.
 */
const budget = (p95: number) => ({ presented: { p95 } });

function feed(scaler: ResolutionScaler, p95: number, windows: number): void {
  for (let index = 0; index < windows; index += 1) scaler.observe(budget(p95));
}

describe("ResolutionScaler", () => {
  it("carries the pre-registered rungs, triggers and guards", () => {
    expect(RESOLUTION_SCALER.rungs).toEqual([
      1.0, 0.85, 0.72, 0.61, 0.52, 0.44, 0.38, 0.32, 0.27, 0.23,
    ]);
    expect(RESOLUTION_SCALER.downWindows).toBe(1);
    expect(RESOLUTION_SCALER.upWindows).toBe(4);
    expect(RESOLUTION_SCALER.cooldownWindows).toBe(1);
    expect(RESOLUTION_SCALER.oscillationCycles).toBe(2);
    // Derived, not pre-registered: see the constant's own note. A down-then-up leg costs
    // cooldownWindows + upWindows = 5 windows, so the PRD's literal 3 could never fire.
    expect(RESOLUTION_SCALER.oscillationWindows).toBe(
      RESOLUTION_SCALER.cooldownWindows + RESOLUTION_SCALER.upWindows + 1,
    );
    // 14.0 ms and 11.5 ms of a 16.67 ms budget: the bar, and a level that survives one step up.
    expect(RESOLUTION_SCALER.downFraction * (1000 / 60)).toBeCloseTo(14.0, 1);
    expect(RESOLUTION_SCALER.upFraction * (1000 / 60)).toBeCloseTo(11.5, 1);
  });

  it("falls one rung on a single over-budget window and reports the step", () => {
    const scaler = new ResolutionScaler({ targetFps: 60 });
    expect(scaler.scale).toBe(1.0);
    expect(scaler.observe(budget(20))).toBe(0.85);
    expect(scaler.scale).toBe(0.85);
  });

  it("climbs only after four consecutive windows under the up trigger, and slowly", () => {
    const scaler = new ResolutionScaler({ start: 0.61, targetFps: 60 });
    feed(scaler, 8, 3);
    expect(scaler.scale).toBe(0.61);
    expect(scaler.observe(budget(8))).toBe(0.72);
    expect(scaler.scale).toBe(0.72);
  });

  it("discards the window after a step, because the resize frame is itself a hitch", () => {
    const scaler = new ResolutionScaler({ targetFps: 60 });
    scaler.observe(budget(20));
    // The cooldown window is over budget too, and must not be allowed to trigger a second fall.
    expect(scaler.observe(budget(40))).toBeUndefined();
    expect(scaler.scale).toBe(0.85);
    expect(scaler.observe(budget(40))).toBe(0.72);
  });

  it("stops at the floor and says so rather than pretending the budget was met", () => {
    const scaler = new ResolutionScaler({ start: 0.23, targetFps: 60 });
    expect(scaler.atFloor).toBe(false);
    feed(scaler, 40, 6);
    expect(scaler.scale).toBe(0.23);
    expect(scaler.atFloor).toBe(true);
  });

  it("never climbs above the ceiling", () => {
    const scaler = new ResolutionScaler({ targetFps: 60 });
    feed(scaler, 4, 20);
    expect(scaler.scale).toBe(1.0);
  });

  it("pins the lower rung after two down-up-down cycles across one boundary", () => {
    const scaler = new ResolutionScaler({ targetFps: 60 });
    expect(scaler.scaleSource).toBe("auto");
    // A real thermal edge: the frame sits just either side of the bar and the scaler pumps across
    // one boundary. down, up, down, up, down — five legs, two complete cycles.
    const fall = (): void => {
      expect(scaler.observe(budget(20))).toBeDefined();
      scaler.observe(budget(4)); // cooldown, discarded
    };
    const climb = (): void => {
      feed(scaler, 4, RESOLUTION_SCALER.upWindows);
      scaler.observe(budget(4)); // cooldown, discarded
    };
    fall();
    expect(scaler.scale).toBe(0.85);
    climb();
    expect(scaler.scale).toBe(1.0);
    fall();
    climb();
    expect(scaler.scale).toBe(1.0);
    expect(scaler.scaleSource).toBe("auto");
    scaler.observe(budget(20));
    expect(scaler.scale).toBe(0.85);
    expect(scaler.scaleSource).toBe("auto-pinned");
    // Pinned means pinned: nothing moves it again this session, in either direction.
    feed(scaler, 4, 20);
    expect(scaler.scale).toBe(0.85);
    feed(scaler, 60, 20);
    expect(scaler.scale).toBe(0.85);
  });

  it("scales its triggers to the configured target rather than assuming 60", () => {
    const scaler = new ResolutionScaler({ targetFps: 30 });
    // 28 ms is inside a 33.3 ms budget's 84 % bar; at 60 fps the same frame is far over it.
    expect(scaler.observe(budget(28))).toBeUndefined();
    expect(scaler.observe(budget(30))).toBe(0.85);
  });

  it("refuses a target it cannot hold a budget against", () => {
    for (const bad of [0, -60, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new ResolutionScaler({ targetFps: bad }), `targetFps ${String(bad)}`).toThrow(
        /targetFps/u,
      );
    }
    expect(() => new ResolutionScaler({ start: 0.5, targetFps: 60 })).toThrow(/rung/u);
  });
});
