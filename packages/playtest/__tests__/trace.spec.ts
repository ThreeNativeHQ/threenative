import { describe, expect, it } from "vitest";

import { PlaytestCliUsageError } from "../src/runner/config.js";
import {
  createTraceAccumulator,
  formatTraceSummary,
  parseTraceArgs,
  traceExitCode,
  TRACE_CATEGORIES,
  type ITraceEvent,
  type ITraceRunContext,
} from "../src/runner/trace.js";

/**
 * `trace` exists because percentiles name a slow frame and a trace names the function inside it.
 * Every assertion here is one of the findings that paid for the command: the mean that hid the
 * complaint, the tail that was the complaint, the idle GPU that would have sent an agent
 * optimising triangles, the sampled functions that named shader compilation, and the virtual
 * display that reports all of it with a confidently wrong frame rate.
 */

const MICROSECONDS_PER_MS = 1_000;

function runContext(overrides: Partial<ITraceRunContext> = {}): ITraceRunContext {
  return {
    allowSoftware: false,
    allowVirtualDisplay: false,
    drivenInput: ["KeyW"],
    displayStrategy: "existing",
    output: "/tmp/trace.json",
    readiness: "observed",
    seconds: 20,
    url: "http://127.0.0.1:5173",
    virtualDisplay: false,
    ...overrides,
  };
}

/** rAF events every `intervalMs`, with long frames injected at the named indices. */
function frameEvents(count: number, intervalMs: number, stall?: { at: readonly number[]; ms: number }): ITraceEvent[] {
  const events: ITraceEvent[] = [];
  let ts = 1_000_000;
  for (let index = 0; index < count; index += 1) {
    events.push({ dur: 2_000, name: "FireAnimationFrame", ph: "X", pid: 1, tid: 7, ts });
    ts += (stall?.at.includes(index) === true ? stall.ms : intervalMs) * MICROSECONDS_PER_MS;
  }
  return events;
}

function profileChunk(tid: number, frames: ReadonlyArray<{ deltaUs: number; name: string }>): ITraceEvent {
  const nodes = frames.map((frame, index) => ({
    callFrame: { functionName: frame.name, lineNumber: 41, url: "https://host/build/engine.js" },
    id: index + 1,
  }));
  return {
    args: {
      data: {
        cpuProfile: { nodes, samples: frames.map((_, index) => index + 1) },
        timeDeltas: frames.map((frame) => frame.deltaUs),
      },
    },
    name: "ProfileChunk",
    ph: "P",
    pid: 1,
    tid,
    ts: 1_000_000,
  };
}

describe("parseTraceArgs", () => {
  it("requires a url", () => {
    expect(() => parseTraceArgs([])).toThrow(PlaytestCliUsageError);
  });

  it("reads the documented flags and their defaults", () => {
    const args = parseTraceArgs(["--url", "http://127.0.0.1:5173"]);
    expect(args.url).toBe("http://127.0.0.1:5173");
    expect(args.seconds).toBe(20);
    expect(args.stallThresholdMs).toBe(40);
    expect(args.keys).toEqual(["KeyW"]);
    expect(args.waitFor).toContain("__TN_STARTUP_READY__");
    expect(args.allowVirtualDisplay).toBe(false);
  });

  it("accepts repeated keys, browser args, and the acknowledgement flags", () => {
    const args = parseTraceArgs([
      "--url", "http://127.0.0.1:5173",
      "--seconds", "45",
      "--key", "KeyW",
      "--key", "KeyD",
      "--browser-arg", "--enable-logging",
      "--stall-ms", "50",
      "--allow-virtual-display",
      "--allow-software",
      "--text",
    ]);
    expect(args.keys).toEqual(["KeyW", "KeyD"]);
    expect(args.browserArgs).toEqual(["--enable-logging"]);
    expect(args.seconds).toBe(45);
    expect(args.stallThresholdMs).toBe(50);
    expect(args.allowVirtualDisplay).toBe(true);
    expect(args.allowSoftware).toBe(true);
    expect(args.text).toBe(true);
  });

  it("fails closed on an unknown flag and on a flag missing its value", () => {
    expect(() => parseTraceArgs(["--url", "u", "--nope"])).toThrow(PlaytestCliUsageError);
    expect(() => parseTraceArgs(["--url"])).toThrow(PlaytestCliUsageError);
    expect(() => parseTraceArgs(["--url", "u", "--seconds", "soon"])).toThrow(PlaytestCliUsageError);
  });

  it("--no-input clears the driven keys rather than leaving the default", () => {
    expect(parseTraceArgs(["--url", "u", "--no-input"]).keys).toEqual([]);
  });
});

describe("trace categories", () => {
  /**
   * The single category that separates this command from a slower `perf`. Without it the trace
   * has no ProfileChunk events, so it can say a task was slow and never which function ran.
   */
  it("requests the v8 cpu profiler", () => {
    expect(TRACE_CATEGORIES).toContain("disabled-by-default-v8.cpu_profiler");
  });
});

describe("summarising a trace", () => {
  it("reports the tail, not the mean", () => {
    const accumulator = createTraceAccumulator({ stallThresholdMs: 40, topFunctions: 5 });
    // 195 frames at 8 ms plus five 260 ms frames: a healthy mean hiding the actual complaint.
    for (const event of frameEvents(201, 8, { at: [40, 80, 100, 140, 180], ms: 260 })) accumulator.add(event);
    const summary = accumulator.summarise(runContext());

    expect(summary.frames?.p50).toBeCloseTo(8, 1);
    expect(summary.frames?.maxMs).toBeCloseTo(260, 1);
    expect(summary.frames?.p99).toBeCloseTo(260, 1);
    expect(summary.frames?.p90).toBeCloseTo(8, 1);
    // Mean-shaped fps stays healthy across a 260 ms stall; the point is that it is reported
    // alongside the tail rather than instead of it.
    expect(summary.frames?.fps).toBeGreaterThan(50);
  });

  it("names an idle GPU next to a busy one", () => {
    const accumulator = createTraceAccumulator({ stallThresholdMs: 40, topFunctions: 5 });
    for (const event of frameEvents(101, 10)) accumulator.add(event);
    // 1 s of trace span; 315 ms of GPU work.
    accumulator.add({ dur: 315_000, name: "GPUTask", ph: "X", pid: 1, tid: 9, ts: 1_000_000 });
    const summary = accumulator.summarise(runContext());
    expect(summary.gpuBusyPercent).toBeCloseTo(31.5, 1);
  });

  it("reports main-thread idle from the tasks on the frame thread", () => {
    const accumulator = createTraceAccumulator({ stallThresholdMs: 40, topFunctions: 5 });
    for (const event of frameEvents(101, 10)) accumulator.add(event);
    accumulator.add({ dur: 531_000, name: "RunTask", ph: "X", pid: 1, tid: 7, ts: 1_000_000 });
    // A worker's tasks must not be counted against the main thread's idle time.
    accumulator.add({ dur: 900_000, name: "RunTask", ph: "X", pid: 1, tid: 12, ts: 1_000_000 });
    const summary = accumulator.summarise(runContext());
    expect(summary.cpuIdlePercent).toBeCloseTo(46.9, 1);
  });

  it("counts and ranks the tasks over the stall threshold", () => {
    const accumulator = createTraceAccumulator({ stallThresholdMs: 40, topFunctions: 5 });
    for (const event of frameEvents(11, 10)) accumulator.add(event);
    accumulator.add({ dur: 39_000, name: "RunTask", ph: "X", pid: 1, tid: 7, ts: 1_000_000 });
    accumulator.add({ dur: 50_300, name: "RunTask", ph: "X", pid: 1, tid: 7, ts: 1_100_000 });
    accumulator.add({ dur: 267_900, name: "RunTask", ph: "X", pid: 1, tid: 7, ts: 1_200_000 });
    const summary = accumulator.summarise(runContext());
    expect(summary.stalls.count).toBe(2);
    expect(summary.stalls.worstMs[0]).toBeCloseTo(267.9, 1);
    expect(summary.stalls.thresholdMs).toBe(40);
  });

  it("names the functions from the sampled profile, largest self time first", () => {
    const accumulator = createTraceAccumulator({ stallThresholdMs: 40, topFunctions: 2 });
    for (const event of frameEvents(11, 10)) accumulator.add(event);
    accumulator.add(profileChunk(7, [
      { deltaUs: 1_000, name: "analyze" },
      { deltaUs: 7_000, name: "build" },
      { deltaUs: 2_000, name: "_getChildren" },
    ]));
    const summary = accumulator.summarise(runContext());
    expect(summary.functions.totalMs).toBeCloseTo(10, 3);
    expect(summary.functions.top).toHaveLength(2);
    expect(summary.functions.top[0]?.name).toBe("build");
    expect(summary.functions.top[0]?.selfMs).toBeCloseTo(7, 3);
    expect(summary.functions.top[0]?.percent).toBeCloseTo(70, 1);
    expect(summary.functions.top[1]?.name).toBe("_getChildren");
  });

  it("folds the frame thread's profile, not a worker's", () => {
    const accumulator = createTraceAccumulator({ stallThresholdMs: 40, topFunctions: 3 });
    for (const event of frameEvents(11, 10)) accumulator.add(event);
    accumulator.add(profileChunk(7, [{ deltaUs: 4_000, name: "build" }]));
    accumulator.add(profileChunk(99, [{ deltaUs: 90_000, name: "decodeInWorker" }]));
    const summary = accumulator.summarise(runContext());
    expect(summary.functions.top.map(({ name }) => name)).toEqual(["build"]);
  });
});

describe("the virtual-display trap", () => {
  /**
   * Under the private Xvfb there is no vsync and the present wait lands inside the engine's
   * update phase: one measured build reported 13.3 fps against the real display's 57.7, over a
   * window whose CPU profile was 84% idle. A frame rate from there is not missing, it is wrong,
   * so the command refuses to print one rather than printing it with a caveat.
   */
  it("suppresses the frame rate and says why", () => {
    const accumulator = createTraceAccumulator({ stallThresholdMs: 40, topFunctions: 5 });
    for (const event of frameEvents(101, 10)) accumulator.add(event);
    const summary = accumulator.summarise(runContext({ displayStrategy: "private-xvfb", virtualDisplay: true }));

    expect(summary.frames).toBeUndefined();
    expect(summary.blockers.map(({ code }) => code)).toContain("TN_TRACE_VIRTUAL_DISPLAY");
    expect(traceExitCode(summary)).toBe(1);
    const text = formatTraceSummary(summary);
    expect(text).toContain("TN_PLAYTEST_HOST_DISPLAY=1");
    expect(text).not.toMatch(/\bfps\b\s*[0-9]/u);
  });

  it("stays suppressed when the operator acknowledges it, but exits 0", () => {
    const accumulator = createTraceAccumulator({ stallThresholdMs: 40, topFunctions: 5 });
    for (const event of frameEvents(101, 10)) accumulator.add(event);
    accumulator.add(profileChunk(7, [{ deltaUs: 4_000, name: "build" }]));
    const summary = accumulator.summarise(
      runContext({ allowVirtualDisplay: true, displayStrategy: "private-xvfb", virtualDisplay: true }),
    );
    expect(summary.frames).toBeUndefined();
    expect(summary.warnings.some((warning) => warning.includes("virtual display"))).toBe(true);
    expect(traceExitCode(summary)).toBe(0);
  });
});

describe("exit codes", () => {
  it("exits 2 when the trace carried no events at all", () => {
    const summary = createTraceAccumulator({ stallThresholdMs: 40, topFunctions: 5 }).summarise(runContext());
    expect(summary.blockers.map(({ code }) => code)).toContain("TN_TRACE_EMPTY");
    expect(traceExitCode(summary)).toBe(2);
  });

  it("exits 1 when nothing sampled, because no function can be named", () => {
    const accumulator = createTraceAccumulator({ stallThresholdMs: 40, topFunctions: 5 });
    for (const event of frameEvents(101, 10)) accumulator.add(event);
    const summary = accumulator.summarise(runContext());
    expect(summary.blockers.map(({ code }) => code)).toContain("TN_TRACE_NO_SAMPLES");
    expect(traceExitCode(summary)).toBe(1);
  });

  it("exits 1 on a software adapter, because the trace describes a CPU rasteriser", () => {
    const accumulator = createTraceAccumulator({ stallThresholdMs: 40, topFunctions: 5 });
    for (const event of frameEvents(101, 10)) accumulator.add(event);
    accumulator.add(profileChunk(7, [{ deltaUs: 4_000, name: "build" }]));
    const summary = accumulator.summarise(runContext({ adapter: { architecture: "swiftshader", vendor: "google" } }));
    expect(summary.blockers.map(({ code }) => code)).toContain("TN_TRACE_SOFTWARE_ADAPTER");
    expect(traceExitCode(summary)).toBe(1);
    expect(traceExitCode({ ...summary, blockers: [] })).toBe(0);
  });

  it("exits 0 on a complete trace and says where the file is", () => {
    const accumulator = createTraceAccumulator({ stallThresholdMs: 40, topFunctions: 5 });
    for (const event of frameEvents(101, 10)) accumulator.add(event);
    accumulator.add(profileChunk(7, [{ deltaUs: 4_000, name: "build" }]));
    const summary = accumulator.summarise(runContext({ output: "/tmp/wildwood.trace.json" }));
    expect(summary.blockers).toEqual([]);
    expect(traceExitCode(summary)).toBe(0);
    expect(formatTraceSummary(summary)).toContain("/tmp/wildwood.trace.json");
  });
});

describe("warnings that keep a number honest", () => {
  it("says when the camera stood still, because a standing camera reuses last frame's work", () => {
    const accumulator = createTraceAccumulator({ stallThresholdMs: 40, topFunctions: 5 });
    for (const event of frameEvents(101, 10)) accumulator.add(event);
    accumulator.add(profileChunk(7, [{ deltaUs: 4_000, name: "build" }]));
    const summary = accumulator.summarise(runContext({ drivenInput: [] }));
    expect(summary.warnings.some((warning) => warning.includes("no input"))).toBe(true);
    expect(traceExitCode(summary)).toBe(0);
  });

  it("says when the readiness gate never fired, because the load was traced too", () => {
    const accumulator = createTraceAccumulator({ stallThresholdMs: 40, topFunctions: 5 });
    for (const event of frameEvents(101, 10)) accumulator.add(event);
    accumulator.add(profileChunk(7, [{ deltaUs: 4_000, name: "build" }]));
    const summary = accumulator.summarise(runContext({ readiness: "timed-out" }));
    expect(summary.warnings.some((warning) => warning.includes("readiness"))).toBe(true);
  });
});
