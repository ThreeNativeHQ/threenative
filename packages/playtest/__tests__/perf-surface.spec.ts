import { describe, expect, it } from "vitest";
import { formatPerfReport, parsePerformanceMarkers } from "../src/runner/perf.js";

/**
 * An fps number that cannot name the resolution and sampling that produced it is not a
 * measurement anybody can act on. `perf --text` is what an agent reads on the device lane, so
 * this is where the frame budget's `surface` block has to surface or it may as well not exist.
 */
const SURFACE =
  '"surface":{"resolutionScale":0.32,"scaleSource":"pinned","sampleCount":1,' +
  '"drawingBufferWidth":768,"drawingBufferHeight":346}';

function budgetLine(windowId: number, surface: string | undefined): string {
  return (
    `TN_FRAME_BUDGET:{"window":${windowId},"frames":300,"hitches":0,"fps":59.4,` +
    '"presented":{"samples":300,"mean":16.8,"p50":16.7,"p95":22.0,"p99":24.0,"max":30.0},' +
    '"frame":{"samples":300,"mean":11.0,"p50":10.0,"p95":16.8,"p99":19.0,"max":22.0},' +
    '"phases":{"render":{"samples":300,"mean":9.6,"p50":9.5,"p95":15.9,"p99":19.0,"max":22.0}}' +
    `${surface === undefined ? "" : `,${surface}`}}`
  );
}

describe("perf reports the surface each window was drawn at", () => {
  it("names the scale, its source, the sample count and the drawing buffer", () => {
    const parsed = parsePerformanceMarkers(
      [budgetLine(1, SURFACE), budgetLine(2, SURFACE), budgetLine(3, SURFACE)].join("\n"),
    );
    expect(parsed.budgets[2]?.surface).toEqual({
      drawingBufferHeight: 346,
      drawingBufferWidth: 768,
      resolutionScale: 0.32,
      sampleCount: 1,
      scaleSource: "pinned",
    });
    const text = formatPerfReport({
      budgets: parsed.budgets,
      discardedWindows: [1],
      hostGaps: parsed.hostGaps,
      pass: true,
      presentMode: undefined,
      source: "logcat",
      violations: [],
    });
    expect(text).toContain("surface: scale 0.32 pinned, 768x346, 1x samples");
  });

  it("says so rather than implying an unscaled full-sample frame when no window reported one", () => {
    const parsed = parsePerformanceMarkers([budgetLine(1, undefined), budgetLine(2, undefined)].join("\n"));
    expect(parsed.budgets[0]?.surface).toBeUndefined();
    const text = formatPerfReport({
      budgets: parsed.budgets,
      discardedWindows: [1],
      hostGaps: parsed.hostGaps,
      pass: true,
      presentMode: undefined,
      source: "logcat",
      violations: [],
    });
    expect(text).toContain("surface: unreported");
  });
});
