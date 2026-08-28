import { describe, expect, it } from "vitest";
import { FRAME_BUDGET_MARKER, FrameBudget } from "../src/frame-budget.js";

/**
 * PRD-228 Phase 2's floor contract. At the lowest rung with the tail still over budget the
 * scaler stops — and the window has to say so. A run that reports 0.23 and nothing else reads as
 * a met budget at a low resolution, which is the opposite of what happened: the engine ran out of
 * room and the game is still missing its target. Measured on a physical Pixel 8 the same day,
 * where Bayview walked all ten rungs to 0.23 and stayed under 60 fps.
 */
const AT_FLOOR = {
  atFloor: true,
  drawingBufferHeight: 248,
  drawingBufferWidth: 552,
  resolutionScale: 0.23,
  sampleCount: 1,
  scaleSource: "auto",
} as const;

function driveWindow(budget: FrameBudget, frames: number): void {
  const clock = { now: 0, timestamp: 0 };
  for (let index = 0; index < frames; index += 1) {
    clock.now += 1;
    clock.timestamp += 16.7;
    budget.beginFrame(clock.timestamp, clock.now);
    clock.now += 2;
    budget.markSimulationEnd(clock.now, 1);
    budget.endFrame(clock.now);
  }
}

describe("the frame budget reports a scaler that ran out of room", () => {
  it("carries atFloor beside the true scale", () => {
    const lines: string[] = [];
    const budget = new FrameBudget({
      readSurface: () => AT_FLOOR,
      report: (line) => lines.push(line),
      reportEvery: 2,
    });
    driveWindow(budget, 2);
    const reported = JSON.parse(lines[0]?.slice(FRAME_BUDGET_MARKER.length + 1) ?? "{}") as {
      surface?: typeof AT_FLOOR;
    };
    expect(reported.surface).toEqual(AT_FLOOR);
  });

  it("refuses a surface that omits whether the scaler had room left", () => {
    const budget = new FrameBudget({
      readSurface: () => ({ ...AT_FLOOR, atFloor: undefined }) as unknown as typeof AT_FLOOR,
      report: () => {},
      reportEvery: 2,
    });
    expect(() => driveWindow(budget, 2)).toThrow(/atFloor/u);
  });
});
