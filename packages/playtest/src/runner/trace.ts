import { PlaytestCliUsageError } from "./config.js";
import { softwareAdapterName } from "./browser.js";

/**
 * `threenative-playtest trace` — record a Chrome performance trace of a running game and say
 * which function the slow frames were in.
 *
 * `perf` reads the meters the engine already prints, and those meters answer "how slow"; they
 * cannot answer "slow doing what". The gap is not academic. A game reported as "performance is
 * not good" turned out to average 96 fps with a frame-interval p50 of 8.2 ms — every summary
 * statistic that reports a mean was hiding the complaint — while p99 sat at 50.3 ms, the worst
 * frame at 267.9 ms, and 28 main-thread tasks ran over 40 ms. GPUTask was 31.5% busy and the CPU
 * 46.9% idle, so it was neither triangle-bound nor CPU-saturated, and an hour of draw-call
 * reduction would have moved nothing. Sampling *inside* the worst tasks named them: TSL graph
 * `build`, `analyze`, `_getChildren`, plus two stalls at 86% and 97% idle where the main thread
 * sat waiting on GPU pipeline creation — shader compilation arriving during play. None of that is
 * derivable from a percentile.
 *
 * Three details in here each cost real time to learn and are not negotiable:
 *
 * 1. `disabled-by-default-v8.cpu_profiler` must be among the categories. Without it the trace
 *    carries no `ProfileChunk` events and the command degrades into a slower `perf`.
 * 2. The trace starts after the game reports startup readiness. Trace the load and the loading
 *    tier's compiles swamp exactly the stalls this is looking for.
 * 3. Input is driven while tracing. A standing camera re-uses everything it drew last frame; the
 *    first frame-rate measurement in this project came back nearly twice the truth for that.
 *
 * And one refusal: on a virtual display there is no vsync, the present wait lands inside the
 * engine's `update` phase, and the frame rate is not merely missing but *wrong* — 13.3 fps
 * measured against the real display's 57.7 on the same build, over a window that was 84% idle.
 * This command therefore never prints a frame rate from a private Xvfb, acknowledged or not.
 */

/**
 * The categories the trace requests. `disabled-by-default-v8.cpu_profiler` is the load-bearing
 * one; the rest supply frames, tasks and GPU work.
 */
export const TRACE_CATEGORIES: readonly string[] = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-v8.cpu_profiler",
  "v8.execute",
  "blink.user_timing",
  "gpu",
];

/** The framework's own "the world is up" signal, set by `defineGame` when startup resolves. */
export const DEFAULT_READY_EXPRESSION = "globalThis.__TN_STARTUP_READY__ === true";

const MICROSECONDS_PER_MS = 1_000;
const MICROSECONDS_PER_SECOND = 1_000_000;

/** One raw trace event, as Chrome emits it. Only the fields this summary reads are named. */
export interface ITraceEvent {
  readonly args?: unknown;
  readonly dur?: number;
  readonly name?: string;
  readonly ph?: string;
  readonly pid?: number;
  readonly tid?: number;
  readonly ts?: number;
}

export interface ITraceArgs {
  readonly allowSoftware: boolean;
  readonly allowVirtualDisplay: boolean;
  readonly browserArgs: readonly string[];
  readonly keys: readonly string[];
  readonly output: string | undefined;
  readonly seconds: number;
  readonly settleSeconds: number;
  readonly stallThresholdMs: number;
  readonly text: boolean;
  readonly topFunctions: number;
  readonly url: string;
  readonly viewport: { readonly height: number; readonly width: number };
  readonly waitFor: string | undefined;
  readonly waitTimeoutSeconds: number;
}

/** Did the readiness gate settle, never fire, or was it switched off? */
export type TraceReadiness = "observed" | "timed-out" | "skipped";

/** Everything about the run that the event stream itself cannot say. */
export interface ITraceRunContext {
  readonly adapter?: Readonly<Record<string, string>>;
  readonly allowSoftware: boolean;
  readonly allowVirtualDisplay: boolean;
  readonly displayStrategy: string;
  readonly drivenInput: readonly string[];
  readonly output: string;
  readonly readiness: TraceReadiness;
  readonly seconds: number;
  readonly url: string;
  readonly virtualDisplay: boolean;
}

export interface ITraceFrameStats {
  readonly count: number;
  readonly fps: number;
  readonly maxMs: number;
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
  readonly spanSeconds: number;
}

export interface ITraceFunctionSelfTime {
  readonly name: string;
  readonly percent: number;
  readonly selfMs: number;
  readonly site: string;
}

export type TraceBlockerCode =
  | "TN_TRACE_EMPTY"
  | "TN_TRACE_NO_SAMPLES"
  | "TN_TRACE_SOFTWARE_ADAPTER"
  | "TN_TRACE_VIRTUAL_DISPLAY";

export interface ITraceBlocker {
  readonly code: TraceBlockerCode;
  readonly message: string;
}

export interface ITraceSummary {
  readonly blockers: readonly ITraceBlocker[];
  /** Main thread idle across the traced span; an idle main thread means the CPU is not the wall. */
  readonly cpuIdlePercent: number | undefined;
  readonly display: { readonly strategy: string; readonly virtual: boolean };
  readonly events: number;
  /** Absent on a virtual display: a frame rate from there is wrong, not missing. */
  readonly frames: ITraceFrameStats | undefined;
  readonly functions: { readonly top: readonly ITraceFunctionSelfTime[]; readonly totalMs: number };
  readonly gpuBusyPercent: number | undefined;
  readonly output: string;
  readonly stalls: { readonly count: number; readonly thresholdMs: number; readonly worstMs: readonly number[] };
  readonly url: string;
  readonly warnings: readonly string[];
}

interface IThreadProfile {
  readonly nodes: Map<number, { functionName?: string; lineNumber?: number; url?: string }>;
  readonly self: Map<string, number>;
  totalUs: number;
}

export interface ITraceAccumulatorOptions {
  readonly stallThresholdMs: number;
  readonly topFunctions: number;
}

export interface ITraceAccumulator {
  add(event: ITraceEvent): void;
  summarise(run: ITraceRunContext): ITraceSummary;
}

/**
 * Folds a trace into its summary one event at a time.
 *
 * Streaming rather than collecting: 63 seconds of trace came to 266 MB and 1.18 M events, and
 * building an array of those and then serialising it holds the whole thing twice. Only the frame
 * gaps, the over-threshold tasks and a self-time map per thread survive an event here.
 */
export function createTraceAccumulator(options: ITraceAccumulatorOptions): ITraceAccumulator {
  const stallThresholdUs = options.stallThresholdMs * MICROSECONDS_PER_MS;
  const frameTimestamps: number[] = [];
  const stalls: number[] = [];
  const busyByThread = new Map<number, number>();
  const profiles = new Map<number, IThreadProfile>();
  let frameThread: number | undefined;
  let gpuBusyUs = 0;
  let events = 0;

  return {
    add(event: ITraceEvent): void {
      events += 1;
      const name = event.name;
      if (name === "FireAnimationFrame" && typeof event.ts === "number") {
        frameTimestamps.push(event.ts);
        if (frameThread === undefined && typeof event.tid === "number") frameThread = event.tid;
        return;
      }
      if (name === "GPUTask" && typeof event.dur === "number") {
        gpuBusyUs += event.dur;
        return;
      }
      if (name === "RunTask" && typeof event.dur === "number") {
        const thread = typeof event.tid === "number" ? event.tid : -1;
        busyByThread.set(thread, (busyByThread.get(thread) ?? 0) + event.dur);
        if (event.dur > stallThresholdUs) stalls.push(event.dur);
        return;
      }
      if (name === "ProfileChunk") foldProfileChunk(profiles, event);
    },
    summarise(run: ITraceRunContext): ITraceSummary {
      return summarise({
        events,
        frameThread,
        frameTimestamps,
        gpuBusyUs,
        busyByThread,
        options,
        profiles,
        run,
        stalls,
      });
    },
  };
}

/**
 * One `ProfileChunk`: its nodes join the thread's node table, then its samples are charged to
 * self time immediately. `timeDeltas[i]` is the gap in front of `samples[i]`, and both arrays are
 * chunk-local, so folding per chunk gives the same answer as concatenating every chunk first —
 * without holding a million sample ids to do it.
 */
function foldProfileChunk(profiles: Map<number, IThreadProfile>, event: ITraceEvent): void {
  const data = (event.args as { data?: { cpuProfile?: { nodes?: unknown; samples?: unknown }; timeDeltas?: unknown } } | undefined)?.data;
  if (data === undefined) return;
  const thread = typeof event.tid === "number" ? event.tid : -1;
  let profile = profiles.get(thread);
  if (profile === undefined) {
    profile = { nodes: new Map(), self: new Map(), totalUs: 0 };
    profiles.set(thread, profile);
  }
  const nodes = data.cpuProfile?.nodes;
  if (Array.isArray(nodes)) {
    for (const node of nodes as ReadonlyArray<{ callFrame?: IThreadProfile["nodes"] extends Map<number, infer V> ? V : never; id?: number }>) {
      if (typeof node.id === "number") profile.nodes.set(node.id, node.callFrame ?? {});
    }
  }
  const samples = data.cpuProfile?.samples;
  const deltas = data.timeDeltas;
  if (!Array.isArray(samples) || !Array.isArray(deltas)) return;
  for (const [index, sample] of (samples as readonly number[]).entries()) {
    // A negative delta happens when the profiler's clock corrects backwards; charging it would
    // subtract time from a function that did run.
    const delta = Math.max(0, (deltas as readonly number[])[index] ?? 0);
    profile.totalUs += delta;
    const key = callFrameKey(profile.nodes.get(sample));
    profile.self.set(key, (profile.self.get(key) ?? 0) + delta);
  }
}

function callFrameKey(frame: { functionName?: string; lineNumber?: number; url?: string } | undefined): string {
  const name = frame?.functionName === undefined || frame.functionName.length === 0 ? "(anonymous)" : frame.functionName;
  const file = (frame?.url ?? "").split("/").at(-1) ?? "";
  return `${name} ${file}:${(frame?.lineNumber ?? -1) + 1}`;
}

interface ISummariseInput {
  readonly busyByThread: ReadonlyMap<number, number>;
  readonly events: number;
  readonly frameThread: number | undefined;
  readonly frameTimestamps: readonly number[];
  readonly gpuBusyUs: number;
  readonly options: ITraceAccumulatorOptions;
  readonly profiles: ReadonlyMap<number, IThreadProfile>;
  readonly run: ITraceRunContext;
  readonly stalls: readonly number[];
}

function summarise(input: ISummariseInput): ITraceSummary {
  const { run } = input;
  const sorted = [...input.frameTimestamps].sort((left, right) => left - right);
  const spanUs = sorted.length > 1 ? (sorted.at(-1) as number) - (sorted[0] as number) : 0;
  const spanSeconds = spanUs / MICROSECONDS_PER_SECOND;
  const gaps: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    gaps.push(((sorted[index] as number) - (sorted[index - 1] as number)) / MICROSECONDS_PER_MS);
  }
  gaps.sort((left, right) => left - right);
  const frames: ITraceFrameStats | undefined =
    run.virtualDisplay || gaps.length === 0
      ? undefined
      : {
          count: sorted.length,
          fps: gaps.length / spanSeconds,
          maxMs: gaps.at(-1) as number,
          p50: quantile(gaps, 0.5),
          p90: quantile(gaps, 0.9),
          p99: quantile(gaps, 0.99),
          spanSeconds,
        };
  const profile = input.profiles.get(input.frameThread ?? -1) ?? busiestProfile(input.profiles, input.frameThread);
  const totalUs = profile?.totalUs ?? 0;
  const top = [...(profile?.self ?? new Map<string, number>())]
    .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1))
    .slice(0, input.options.topFunctions)
    .map(([key, selfUs]) => {
      const [name = "(anonymous)", site = ""] = key.split(" ");
      return { name, percent: totalUs === 0 ? 0 : (selfUs / totalUs) * 100, selfMs: selfUs / MICROSECONDS_PER_MS, site };
    });
  const mainBusyUs = input.frameThread === undefined ? undefined : input.busyByThread.get(input.frameThread);
  const summary: ITraceSummary = {
    blockers: blockersFor(input, totalUs),
    cpuIdlePercent:
      mainBusyUs === undefined || spanUs === 0 ? undefined : Math.max(0, 100 - (mainBusyUs / spanUs) * 100),
    display: { strategy: run.displayStrategy, virtual: run.virtualDisplay },
    events: input.events,
    frames,
    functions: { top, totalMs: totalUs / MICROSECONDS_PER_MS },
    gpuBusyPercent: spanUs === 0 ? undefined : (input.gpuBusyUs / spanUs) * 100,
    output: run.output,
    stalls: {
      count: input.stalls.length,
      thresholdMs: input.options.stallThresholdMs,
      worstMs: [...input.stalls].sort((left, right) => right - left).slice(0, 8).map((value) => value / MICROSECONDS_PER_MS),
    },
    url: run.url,
    warnings: warningsFor(run),
  };
  return summary;
}

/**
 * A profile from a thread that never rendered a frame is a worker's, and charging its self time
 * to the game's frame would name the wrong function. Only used when no frame thread was seen at
 * all — then the busiest profile is the best available guess and is reported as such.
 */
function busiestProfile(
  profiles: ReadonlyMap<number, IThreadProfile>,
  frameThread: number | undefined,
): IThreadProfile | undefined {
  if (frameThread !== undefined) return undefined;
  let busiest: IThreadProfile | undefined;
  for (const profile of profiles.values()) {
    if (busiest === undefined || profile.totalUs > busiest.totalUs) busiest = profile;
  }
  return busiest;
}

function blockersFor(input: ISummariseInput, sampledUs: number): readonly ITraceBlocker[] {
  const { run } = input;
  const blockers: ITraceBlocker[] = [];
  if (input.events === 0) {
    blockers.push({
      code: "TN_TRACE_EMPTY",
      message:
        "The trace carried no events. The page was reached but nothing was recorded — check that the URL renders and that the run was not torn down early.",
    });
    return blockers;
  }
  if (run.virtualDisplay && !run.allowVirtualDisplay) {
    blockers.push({
      code: "TN_TRACE_VIRTUAL_DISPLAY",
      message:
        `This ran on a ${run.displayStrategy} display, which has no vsync: the present wait lands inside the engine's update phase and the frame rate it reports is wrong, not missing (13.3 fps measured there against 57.7 on the real display, same build). Rerun with TN_PLAYTEST_HOST_DISPLAY=1 for a quotable frame rate, or pass --allow-virtual-display to accept the function attribution alone.`,
    });
  }
  const software = softwareAdapterName(run.adapter);
  if (software !== undefined && !run.allowSoftware) {
    blockers.push({
      code: "TN_TRACE_SOFTWARE_ADAPTER",
      message:
        `WebGPU came from '${software}', a CPU rasteriser, so this trace describes software rendering rather than the game's GPU. Rerun on a machine that reaches its Vulkan driver, or pass --allow-software to accept it.`,
    });
  }
  if (sampledUs === 0) {
    blockers.push({
      code: "TN_TRACE_NO_SAMPLES",
      message:
        "No ProfileChunk samples arrived, so no function can be named — which is the whole reason to take a trace rather than read the frame meters. Confirm 'disabled-by-default-v8.cpu_profiler' survived into the trace config.",
    });
  }
  return blockers;
}

function warningsFor(run: ITraceRunContext): readonly string[] {
  const warnings: string[] = [];
  if (run.virtualDisplay) {
    warnings.push(
      `Ran on a virtual display (${run.displayStrategy}); the frame rate is suppressed because a frame rate measured there is wrong rather than absent.`,
    );
  }
  if (run.drivenInput.length === 0) {
    warnings.push(
      "Traced with no input driven. A standing camera re-uses everything it drew last frame, so these numbers are optimistic.",
    );
  }
  if (run.readiness === "timed-out") {
    warnings.push(
      "The startup readiness gate never fired, so the loading tier was traced too and its compiles sit in the same sample as the stalls you are looking for.",
    );
  }
  if (run.readiness === "skipped") {
    warnings.push("Readiness wait skipped by request; the load is inside this trace.");
  }
  return warnings;
}

function quantile(sorted: readonly number[], probability: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * probability))] as number;
}

/**
 * 0 — traced, summarised and quotable; 1 — traced, but part of the answer is missing or not
 * trustworthy (named in `blockers`); 2 — no trace happened at all.
 */
export function traceExitCode(summary: Pick<ITraceSummary, "blockers">): 0 | 1 | 2 {
  if (summary.blockers.some(({ code }) => code === "TN_TRACE_EMPTY")) return 2;
  return summary.blockers.length > 0 ? 1 : 0;
}

export function parseTraceArgs(argv: readonly string[]): ITraceArgs {
  const keys: string[] = [];
  const browserArgs: string[] = [];
  let allowSoftware = false;
  let allowVirtualDisplay = false;
  let noInput = false;
  let output: string | undefined;
  let seconds = 20;
  let settleSeconds = 4;
  let stallThresholdMs = 40;
  let text = false;
  let topFunctions = 14;
  let url: string | undefined;
  let viewport = { height: 720, width: 1280 };
  let waitFor: string | undefined = DEFAULT_READY_EXPRESSION;
  let waitTimeoutSeconds = 180;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--text") text = true;
    else if (flag === "--no-input") noInput = true;
    else if (flag === "--no-wait") waitFor = undefined;
    else if (flag === "--allow-software") allowSoftware = true;
    else if (flag === "--allow-virtual-display") allowVirtualDisplay = true;
    else if (flag === "--url") { url = requireValue(flag, value); index += 1; }
    else if (flag === "--out") { output = requireValue(flag, value); index += 1; }
    else if (flag === "--wait-for") { waitFor = requireValue(flag, value); index += 1; }
    else if (flag === "--key") { keys.push(requireValue(flag, value)); index += 1; }
    else if (flag === "--viewport") { viewport = requireViewport(flag, value); index += 1; }
    else if (flag === "--browser-arg") {
      // A browser argument starts with '--' itself, so only a missing value is an error here.
      if (value === undefined) throw usage(`'--browser-arg' requires a value.`);
      browserArgs.push(value);
      index += 1;
    } else if (flag === "--seconds") { seconds = requireNumber(flag, value); index += 1; }
    else if (flag === "--settle") { settleSeconds = requireNumber(flag, value); index += 1; }
    else if (flag === "--stall-ms") { stallThresholdMs = requireNumber(flag, value); index += 1; }
    else if (flag === "--top") { topFunctions = requireNumber(flag, value); index += 1; }
    else if (flag === "--wait-timeout") { waitTimeoutSeconds = requireNumber(flag, value); index += 1; }
    else throw usage(`unknown option '${String(flag)}'.`);
  }
  if (url === undefined) throw usage("--url <url> is required; start the game's dev server first.");
  return {
    allowSoftware,
    allowVirtualDisplay,
    browserArgs,
    // Fail closed on the contradiction rather than silently preferring one: a run that asked for
    // both would otherwise report input-driven numbers under a --no-input flag, or the reverse.
    keys: noInput ? assertNoKeys(keys) : keys.length > 0 ? keys : ["KeyW"],
    output,
    seconds,
    settleSeconds,
    stallThresholdMs,
    text,
    topFunctions,
    url,
    viewport,
    waitFor,
    waitTimeoutSeconds,
  };
}

function assertNoKeys(keys: readonly string[]): readonly string[] {
  if (keys.length > 0) throw usage("--no-input and --key contradict each other; pass one.");
  return [];
}

function usage(detail: string): PlaytestCliUsageError {
  return new PlaytestCliUsageError(`threenative-playtest trace: ${detail} See threenative-playtest --help.`);
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith("--")) throw usage(`'${flag}' requires a value.`);
  return value;
}

function requireNumber(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (value === undefined || !Number.isFinite(parsed) || parsed <= 0) {
    throw usage(`'${flag}' needs a positive number, received '${value ?? ""}'.`);
  }
  return parsed;
}

function requireViewport(flag: string, value: string | undefined): { height: number; width: number } {
  const match = /^(\d+)x(\d+)$/u.exec(requireValue(flag, value));
  if (match === null) throw usage(`'${flag}' needs a WxH size, for example 1280x720.`);
  return { height: Number(match[2]), width: Number(match[1]) };
}

/**
 * The human-readable report. It leads with the tail, because the tail is the complaint: a mean
 * printed first is what hid a 267.9 ms frame behind 96 fps.
 */
export function formatTraceSummary(summary: ITraceSummary): string {
  const lines: string[] = [
    `trace — ${summary.events} events from ${summary.url}`,
    `raw trace: ${summary.output} (open it in Chrome DevTools' Performance panel when a line below points somewhere specific)`,
  ];
  if (summary.frames === undefined) {
    lines.push(
      summary.display.virtual
        ? `frame rate: NOT MEASURABLE on a ${summary.display.strategy} display — no vsync there, so the present wait lands inside the engine's update phase and the answer is wrong rather than missing. Rerun with TN_PLAYTEST_HOST_DISPLAY=1.`
        : "frame rate: no FireAnimationFrame events in the trace, so nothing presented during the window.",
    );
  } else {
    const { count, fps, maxMs, p50, p90, p99, spanSeconds } = summary.frames;
    lines.push(
      `frames: ${count} over ${spanSeconds.toFixed(1)}s`,
      `frame interval ms  p50 ${p50.toFixed(1)}  p90 ${p90.toFixed(1)}  p99 ${p99.toFixed(1)}  max ${maxMs.toFixed(1)}`,
      `average rate ${fps.toFixed(1)} per second — the mean is last on purpose; it is the statistic that hides the tail above`,
    );
  }
  lines.push(
    summary.gpuBusyPercent === undefined
      ? "gpu: unmeasured — no GPUTask events, so this trace cannot say whether the GPU was the wall"
      : `gpu busy ${summary.gpuBusyPercent.toFixed(1)}% of the traced span`,
    summary.cpuIdlePercent === undefined
      ? "main thread: unmeasured — no RunTask events on the frame thread"
      : `main thread idle ${summary.cpuIdlePercent.toFixed(1)}% — an idle main thread next to an idle GPU means the frame is waiting, not computing`,
    `main-thread tasks over ${summary.stalls.thresholdMs} ms: ${summary.stalls.count}${
      summary.stalls.worstMs.length === 0 ? "" : ` (worst ${summary.stalls.worstMs.map((value) => `${value.toFixed(0)}ms`).join(", ")})`
    }`,
  );
  if (summary.functions.top.length === 0) {
    lines.push(
      "sampled functions: none — without ProfileChunk events this is a slower `perf`, not a trace",
    );
  } else {
    lines.push(`sampled CPU ${summary.functions.totalMs.toFixed(0)}ms — top self time`);
    for (const entry of summary.functions.top) {
      lines.push(
        `  ${entry.percent.toFixed(1).padStart(5)}%  ${entry.selfMs.toFixed(0).padStart(6)}ms  ${entry.name} ${entry.site}`,
      );
    }
  }
  for (const warning of summary.warnings) lines.push(`WARN ${warning}`);
  for (const blocker of summary.blockers) lines.push(`FAIL ${blocker.code}: ${blocker.message}`);
  if (summary.blockers.length === 0) lines.push("PASS");
  return `${lines.join("\n")}\n`;
}
