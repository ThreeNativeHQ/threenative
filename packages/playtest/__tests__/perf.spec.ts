import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { makeTempDir } from "../../../test-support/temp-dir.js";
import {
  assessPerfMarkers,
  formatPerfReport,
  parsePerformanceMarkers,
  parsePerfArgs,
  perfCommand,
  rankExactReasons,
  type IFrameBudgetWindowJson,
} from "../src/runner/perf.js";
import { PlaytestCliUsageError } from "../src/runner/config.js";

/**
 * Marker fixtures follow the live shapes: TN_FRAME_BUDGET is emitted by
 * packages/core/src/frame-budget.ts; TN_HOST_GAP by packages/runtime-native/src/runtime.cpp.
 * Both were only ever read by hand before this command existed — these lines mirror the ones in
 * docs/verification/runtime-perf-state.md.
 */

function budgetLine(windowId: number, fps: number, frameP95: number, renderP50: number): string {
  return `TN_FRAME_BUDGET:{"window":${windowId},"frames":300,"hitches":0,"fps":${fps},` +
    `"presented":{"samples":300,"mean":49.4,"p50":49.4,"p95":51.0,"p99":53.0,"max":66.0},` +
    `"frame":{"samples":300,"mean":30.0,"p50":28.0,"p95":${frameP95},"p99":44.0,"max":52.0},` +
    `"phases":{"hostGap":{"samples":300,"mean":22.0,"p50":22.0,"p95":29.1,"p99":33.0,"max":40.0},` +
    `"update":{"samples":300,"mean":2.5,"p50":2.4,"p95":3.0,"p99":4.0,"max":9.0},` +
    `"render":{"samples":300,"mean":${renderP50.toFixed(2)},"p50":${renderP50.toFixed(2)},"p95":33.5,"p99":38.0,"max":45.0},` +
    `"overlay":{"samples":300,"mean":0.01,"p50":0.01,"p95":0.02,"p99":0.03,"max":0.05},` +
    `"residual":{"samples":300,"mean":0.4,"p50":0.4,"p95":0.8,"p99":1.0,"max":2.0}},` +
    `"shares":{"render":0.55}}`;
}

const hostGapLine = "TN_HOST_GAP:{\"frames\":300,\"periodP50Ms\":48.75,\"periodMeanMs\":49.1," +
  "\"segments\":{\"present\":{\"p50Ms\":14.57,\"meanMs\":14.6},\"frameReplay\":{\"p50Ms\":7.95,\"meanMs\":8.0}," +
  "\"devicePoll\":{\"p50Ms\":0.28,\"meanMs\":0.3},\"timers\":{\"p50Ms\":0.001,\"meanMs\":0.002}}," +
  "\"sumP50Ms\":23.02}";

/** TN_FRAME_HITCH is emitted by packages/runtime-native/include/mystral/cold_start.h. */
const hitchLine =
  "TN_FRAME_HITCH:{\"window\":300,\"maxMs\":203.114,\"maxAtFrame\":41,\"p99Ms\":8.221," +
  "\"p50Ms\":7.940,\"pipelineCompileMs\":198.400,\"pipelineCompileCalls\":1}";

/** The pre-PRD-327 shape: no pipelineCompile fields. Must keep parsing. */
const legacyHitchLine =
  "TN_FRAME_HITCH:{\"window\":300,\"maxMs\":12.002,\"maxAtFrame\":3,\"p99Ms\":9.1,\"p50Ms\":7.8}";

afterEach(() => {
  vi.restoreAllMocks();
});

function sampleStream(): string {
  return [
    "08-27 20:15:56.123  4321  5678 I MystralStdio: LaunchState: COLD",
    "08-27 20:15:56.124  4321  5678 I MystralStdio: Present mode: mailbox (vsync=false)",
    budgetLine(1, 12.5, 55.0, 25.0),
    hostGapLine,
    "some other console noise",
    budgetLine(2, 20.55, 45.7, 16.61),
    hostGapLine,
    budgetLine(3, 20.9, 45.7, 16.8),
  ].join("\n");
}

describe("parsePerformanceMarkers", () => {
  it("reads budget, host-gap and present-mode lines out of a mixed logcat stream", () => {
    const parsed = parsePerformanceMarkers(sampleStream());
    expect(parsed.budgets).toHaveLength(3);
    expect(parsed.budgets[1]?.fps).toBeCloseTo(20.55);
    expect(parsed.budgets[1]?.frame?.p95).toBeCloseTo(45.7);
    expect(parsed.budgets[1]?.phases?.render?.p50).toBeCloseTo(16.61);
    expect(parsed.hostGaps).toHaveLength(2);
    expect(parsed.hostGaps[0]?.segments.present?.p50Ms).toBeCloseTo(14.57);
    expect(parsed.hostGaps[0]?.periodP50Ms).toBeCloseTo(48.75);
    expect(parsed.presentMode).toBe("mailbox (vsync=false)");
  });

  it("counts a frame-budget window once when Android mirrors it to both runtime log tags", () => {
    const mirrored = [
      budgetLine(1, 59.99, 17.3, 7.0),
      budgetLine(2, 66.93, 13.1, 6.7),
      budgetLine(3, 68.35, 12.7, 6.7),
    ].flatMap((line) => [
      `I MystralStdio: [log] ${line}`,
      `I MystralJS: [log] ${line}`,
    ]).join("\n");

    const parsed = parsePerformanceMarkers(mirrored);
    const report = assessPerfMarkers(parsed, { minFps: 60, requireWindows: 2 }, "logcat: pixel");

    expect(parsed.budgets.map(({ window }) => window)).toEqual([1, 2, 3]);
    expect(report.discardedWindows).toEqual([1]);
    expect(report.pass).toBe(true);
  });

  it("throws, naming the marker, when a marker line carries unparsable JSON", () => {
    // The package rule: a meter line that cannot be read must fail, never silently vanish —
    // an absent window and an unreadable window are different defects and both are failures.
    expect(() => parsePerformanceMarkers(`ok\nTN_FRAME_BUDGET:{"window":1,`)).toThrow(/TN_PERF_MARKER_MALFORMED/);
    expect(() => parsePerformanceMarkers("ok\nTN_HOST_GAP:{not json")).toThrow(/TN_PERF_MARKER_MALFORMED/);
  });

  it("finds nothing in a stream without markers, and that nothing is a failure downstream", () => {
    const parsed = parsePerformanceMarkers("no markers here\njust a log\n");
    expect(parsed.budgets).toHaveLength(0);
    expect(assessPerfMarkers(parsed, { requireWindows: 2 }, "test").pass).toBe(false);
  });

  it("reads a hitch window with its late-sync-compile fields, and a pre-PRD-327 line without them", () => {
    const parsed = parsePerformanceMarkers(`noise\n${hitchLine}\n${legacyHitchLine}\n`);
    expect(parsed.hitches).toHaveLength(2);
    expect(parsed.hitches[0]?.maxMs).toBeCloseTo(203.114);
    expect(parsed.hitches[0]?.pipelineCompileMs).toBeCloseTo(198.4);
    expect(parsed.hitches[0]?.pipelineCompileCalls).toBe(1);
    // Old hosts omit the fields; absence parses as absence, never as a measured zero.
    expect(parsed.hitches[1]?.pipelineCompileMs).toBeUndefined();
    expect(parsed.hitches[1]?.pipelineCompileCalls).toBeUndefined();
  });

  it("counts a mirrored hitch line once", () => {
    const parsed = parsePerformanceMarkers(
      `I MystralStdio: [log] ${hitchLine}\nI MystralJS: [log] ${hitchLine}\n`,
    );
    expect(parsed.hitches).toHaveLength(1);
  });
});

describe("assessPerfMarkers", () => {
  it("discards window 1 as startup and bounds the steady windows", () => {
    const parsed = parsePerformanceMarkers(sampleStream());
    const report = assessPerfMarkers(parsed, { requireWindows: 2 }, "test");
    expect(report.discardedWindows).toEqual([1]);
    expect(report.pass).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it("fails on the steady window that violates a bound, not on the median", () => {
    const parsed = parsePerformanceMarkers(sampleStream());
    const report = assessPerfMarkers(parsed, { maxFrameMsP95: 45.0, minFps: 25, requireWindows: 2 }, "test");
    const codes = report.violations.map(({ code }) => code);
    expect(codes).toContain("TN_PERF_MAX_FRAME_P95");
    expect(codes).toContain("TN_PERF_MIN_FPS");
    expect(report.pass).toBe(false);
    // Window 1 (12.5 fps, 55.0 ms p95) is discarded; the violation comes from steady windows only.
    expect(report.violations.every(({ window }) => window !== 1)).toBe(true);
  });

  it("refuses to assess when fewer steady windows arrived than required", () => {
    // A single window is reported but never counted as steady evidence: with one window there
    // is nothing to compare it against, so the startup rule cannot even discard it.
    const parsed = parsePerformanceMarkers(budgetLine(1, 20.0, 40.0, 16.0));
    const report = assessPerfMarkers(parsed, { requireWindows: 2 }, "test");
    expect(report.discardedWindows).toEqual([]);
    expect(report.violations).toEqual([
      expect.objectContaining({ code: "TN_PERF_WINDOWS_MISSING", observed: 1, bound: 2 }),
    ]);
    expect(report.pass).toBe(false);
  });

  it("fails closed when a frame-p95 bound is requested but the window carries no frame summary", () => {
    // A meter line without the frame summary cannot prove a frame bound; that is a named
    // failure, never a silent pass-through of an unmeasured window.
    const both = parsePerformanceMarkers(
      'TN_FRAME_BUDGET:{"window":1,"frames":300,"hitches":0,"fps":20.0}\n' +
      'TN_FRAME_BUDGET:{"window":2,"frames":300,"hitches":0,"fps":20.0}\n' +
      'TN_FRAME_BUDGET:{"window":3,"frames":300,"hitches":0,"fps":20.0}',
    );
    const report = assessPerfMarkers(both, { maxFrameMsP95: 33, requireWindows: 2 }, "test");
    expect(report.violations.every(({ code }) => code === "TN_PERF_BOUNDS_NOT_ASSESSABLE")).toBe(true);
    expect(report.pass).toBe(false);
  });
});

describe("parsePerfArgs", () => {
  it("requires exactly one source", () => {
    expect(() => parsePerfArgs(["--text"])).toThrow(PlaytestCliUsageError);
    expect(() => parsePerfArgs(["--file", "a.log", "--logcat", "X"])).toThrow(/mutually exclusive/u);
    expect(() => parsePerfArgs(["--frobnicate"])).toThrow(/unknown flag/u);
    expect(() => parsePerfArgs(["--min-fps", "fast"])).toThrow(/needs a number/u);
  });

  it("keeps defaults where the protocol rules live", () => {
    const args = parsePerfArgs(["--file", "a.log"]);
    // Two steady windows by default: window 1 is discarded, so a complete run closes three.
    expect(args.requireWindows).toBe(2);
    expect(args.timeoutSeconds).toBe(180);
    expect(args.hostArgs).toEqual([]);
  });
});

describe("perfCommand", () => {
  it("exits 0 on a passing file source and prints the report as JSON", async () => {
    const dir = await makeTempDir("tn-perf-");
    const path = join(dir, "host.log");
    await writeFile(path, sampleStream(), "utf8");
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    const code = await perfCommand(["--file", path]);
    spy.mockRestore();
    expect(code).toBe(0);
    const report = JSON.parse(written.join("")) as { pass: boolean; presentMode?: string };
    expect(report.pass).toBe(true);
    expect(report.presentMode).toBe("mailbox (vsync=false)");
  });

  it("exits 1 when a bound fails and 2 when no markers arrived", async () => {
    const dir = await makeTempDir("tn-perf-");
    const failing = join(dir, "failing.log");
    await writeFile(failing, sampleStream(), "utf8");
    const boundSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const failedCode = await perfCommand(["--file", failing, "--min-fps", "30"]);
    boundSpy.mockRestore();
    expect(failedCode).toBe(1);

    const empty = join(dir, "empty.log");
    await writeFile(empty, "nothing here\n", "utf8");
    const emptySpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const emptyCode = await perfCommand(["--file", empty]);
    emptySpy.mockRestore();
    expect(emptyCode).toBe(2);
  });

  it("exits 2, naming the defect, when a marker line is malformed", async () => {
    const dir = await makeTempDir("tn-perf-");
    const path = join(dir, "broken.log");
    await writeFile(path, `TN_FRAME_BUDGET:{"window":1,`, "utf8");
    const errors: string[] = [];
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      errors.push(String(chunk));
      return true;
    });
    const code = await perfCommand(["--file", path]);
    errSpy.mockRestore();
    expect(code).toBe(2);
    expect(errors.join("")).toContain("TN_PERF_MARKER_MALFORMED");
  });
});

describe("budget fixture sanity", () => {
  it("keeps the fixture windows typeable as IFrameBudgetWindowJson", () => {
    const parsed = parsePerformanceMarkers(budgetLine(9, 60, 16.7, 5.0));
    const window: IFrameBudgetWindowJson = parsed.budgets[0] as IFrameBudgetWindowJson;
    expect(window.window).toBe(9);
    expect(window.frames).toBe(300);
  });
});

describe("formatPerfReport", () => {
  it("renders windows, the startup discard, host-gap segments and the verdict as text", () => {
    const parsed = parsePerformanceMarkers(sampleStream());
    const report = assessPerfMarkers(parsed, { requireWindows: 2 }, "executable: mystral run game.js");
    const text = formatPerfReport(report);
    expect(text).toContain("perf — 3 window(s)");
    expect(text).toContain("present mode: mailbox (vsync=false)");
    expect(text).toContain("1*");
    expect(text).toContain("window 1 always lies");
    expect(text).toContain("frameReplay");
    expect(text).toContain("PASS");
  });

  it("renders a failed bound with its observed value and bound", () => {
    const parsed = parsePerformanceMarkers(sampleStream());
    const report = assessPerfMarkers(parsed, { minFps: 30, requireWindows: 2 }, "test");
    const text = formatPerfReport(report);
    expect(text).toMatch(/FAIL TN_PERF_MIN_FPS: window [23] observed 20\.\d+ against bound 30/u);
  });

  it("names the late sync compile a hitch window covered, and says nothing when there was none", () => {
    const parsed = parsePerformanceMarkers(
      `${budgetLine(1, 30, 40, 20)}\n${hitchLine}\n${budgetLine(2, 53, 20, 10)}\n${legacyHitchLine}\n`,
    );
    const text = formatPerfReport(assessPerfMarkers(parsed, { requireWindows: 1 }, "log"));
    expect(text).toContain("hitch windows (post-launch, 2): worst 203.114 ms");
    expect(text).toContain(
      "late sync compile: 198.400 ms across 1 call(s) in the window whose worst frame landed at frame 41",
    );
    expect(text).not.toContain("none reported");
  });

  it("names the absence rather than reading an old host's missing field as a zero", () => {
    const parsed = parsePerformanceMarkers(
      `${budgetLine(1, 30, 40, 20)}\n${legacyHitchLine}\n${budgetLine(2, 53, 20, 10)}\n`,
    );
    const text = formatPerfReport(assessPerfMarkers(parsed, { requireWindows: 1 }, "log"));
    expect(text).toContain(
      "late sync compile: unreported — this host predates the pipelineCompile fields (TN_FRAME_HITCH without them)",
    );
  });

  it("reports a measured zero as a zero when a new host names the field with no late compile", () => {
    const zeroHitchLine =
      "TN_FRAME_HITCH:{\"window\":300,\"maxMs\":9.9,\"maxAtFrame\":7,\"p99Ms\":9.1,\"p50Ms\":7.8," +
      "\"pipelineCompileMs\":0.000,\"pipelineCompileCalls\":0}";
    const parsed = parsePerformanceMarkers(
      `${budgetLine(1, 30, 40, 20)}\n${zeroHitchLine}\n${budgetLine(2, 53, 20, 10)}\n`,
    );
    const text = formatPerfReport(assessPerfMarkers(parsed, { requireWindows: 1 }, "log"));
    expect(text).toContain("late sync compile: none — every window reported pipelineCompileCalls 0");
  });

  it("prints no hitch section for a stream without hitch lines", () => {
    const parsed = parsePerformanceMarkers(sampleStream());
    const text = formatPerfReport(assessPerfMarkers(parsed, { requireWindows: 2 }, "test"));
    expect(text).not.toContain("hitch windows");
  });
});

const projectionLine =
  'TN_PROJECTION:{"drawsActual":315,"drawsPlanned":118,' +
  '"exact":{"skinned":96,"multiMaterial":12,"lod":4,"instanced":6},' +
  '"exactObjects":118,"projecting":true,"reasonCode":"projected","sourceRenderables":780,"window":2}';

const declinedProjectionLine =
  'TN_PROJECTION:{"drawsActual":40,"drawsPlanned":40,"exact":{},"exactObjects":0,' +
  '"projecting":false,"reason":"fewer than 200 batchable meshes; the mirror would cost more ' +
  'than it saves","reasonCode":"belowMeshFloor","sourceRenderables":40,"window":2}';

describe("projection markers in the perf report", () => {
  it("should rank reasons by draw count", () => {
    expect(rankExactReasons({ instanced: 6, lod: 4, multiMaterial: 12, skinned: 96 })).toEqual([
      { count: 96, reason: "skinned" },
      { count: 12, reason: "multiMaterial" },
      { count: 6, reason: "instanced" },
      { count: 4, reason: "lod" },
    ]);
  });

  it("should print the exact lane ranked, largest reason first", () => {
    const parsed = parsePerformanceMarkers(
      `${budgetLine(1, 30, 40, 20)}\n${budgetLine(2, 53, 20, 10)}\n${projectionLine}\n`,
    );
    const text = formatPerfReport(assessPerfMarkers(parsed, { requireWindows: 1 }, "log"));

    expect(text).toContain("780 authored renderables, 118 draws planned");
    expect(text).toContain("all passes; the plan counts the colour pass only");
    const skinned = text.indexOf("skinned");
    const lod = text.indexOf("lod ");
    expect(skinned).toBeGreaterThan(0);
    expect(skinned).toBeLessThan(lod);
  });

  it("should print the decline and its reason rather than an empty table", () => {
    const parsed = parsePerformanceMarkers(
      `${budgetLine(1, 30, 40, 20)}\n${declinedProjectionLine}\n`,
    );
    const text = formatPerfReport(assessPerfMarkers(parsed, { requireWindows: 0 }, "log"));

    expect(text).toContain("scene projection: DECLINED (belowMeshFloor)");
    expect(text).toContain("fewer than 200 batchable meshes");
  });

  it("should say the projection was not reported rather than imply an empty lane", () => {
    const parsed = parsePerformanceMarkers(`${budgetLine(1, 30, 40, 20)}\n`);
    const text = formatPerfReport(assessPerfMarkers(parsed, { requireWindows: 0 }, "log"));

    expect(text).toContain("scene projection: not reported");
    expect(text).not.toContain("exact lane");
  });

  it("should count a mirrored Android projection line once", () => {
    const parsed = parsePerformanceMarkers(`${projectionLine}\n${projectionLine}\n`);
    expect(parsed.projections).toHaveLength(1);
  });

  it("should throw on a malformed projection line rather than skip it", () => {
    expect(() => parsePerformanceMarkers('ok\nTN_PROJECTION:{"window":1,')).toThrow(
      /TN_PERF_MARKER_MALFORMED/u,
    );
  });
});

describe("the GPU column never reads as a measured zero", () => {
  it("should name the reason when no window carries gpuMs", () => {
    const parsed = parsePerformanceMarkers(`${budgetLine(1, 30, 40, 20)}\n`);
    const text = formatPerfReport(assessPerfMarkers(parsed, { requireWindows: 0 }, "log"));

    expect(text).toContain("gpu: not reported");
    expect(text).toContain("timestamp-query");
    expect(text).toContain("TN_WEBGPU_FEATURES");
    // No column at all rather than a column of dashes a reader would total.
    expect(text).not.toContain("gpu ms");
  });

  it("should say unmeasured for a single window the device refused", () => {
    const withGpu = budgetLine(1, 30, 40, 20).replace('"window":1', '"window":1,"gpuMs":4.5');
    const parsed = parsePerformanceMarkers(`${withGpu}\n${budgetLine(2, 30, 40, 20)}\n`);
    const text = formatPerfReport(assessPerfMarkers(parsed, { requireWindows: 0 }, "log"));

    expect(text).toContain("gpu ms");
    expect(text).toContain("4.50");
    expect(text).toContain("unmeasured");
    expect(text).not.toContain("gpu: not reported");
  });
});
