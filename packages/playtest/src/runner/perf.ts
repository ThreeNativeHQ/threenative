import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { discoverAdb } from "./android.js";
import { PlaytestCliUsageError } from "./config.js";

/**
 * `threenative-playtest perf` — read the frame the host already reports, without opening a log by
 * hand. `TN_FRAME_BUDGET` (JS-side, every target) and `TN_HOST_GAP` (native host, between-callback
 * truth) carried every number in the Android-fps hunt, and not one line of either was read by
 * code — each number in `docs/verification/runtime-perf-state.md` was grepped by hand. This
 * command is that grep, with the hunt's paid-for protocol rules built in: window 1 is discarded
 * (it always lies — startup stall, shader compile), a run with fewer steady windows than required
 * fails instead of reporting, and a marker line whose JSON cannot be read throws rather than
 * being silently dropped.
 *
 * This command reports and optionally bounds; it never launches a browser (the browser lane
 * already owns `assert.performance`) and never tunes anything. A run whose markers never arrive
 * is a failure, never a healthy-looking empty report.
 */

export const FRAME_BUDGET_MARKER = "TN_FRAME_BUDGET:";
/**
 * The per-window scene-projection line. Read here rather than in the game so an agent can rank
 * what the optimizer is still leaving on its one-draw-each lane without owning the device it ran
 * on. The literal is duplicated from `@threenative/core` deliberately: this module parses a log,
 * it does not import the runtime that wrote it.
 */
export const PROJECTION_MARKER = "TN_PROJECTION:";
export const HOST_GAP_MARKER = "TN_HOST_GAP:";
export const HITCH_MARKER = "TN_FRAME_HITCH:";

export interface IPerfSummary {
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
}

/** What the window's frames were drawn at, when the loop reported it. */
export interface IFrameSurfaceJson {
  /** Present only when the runtime measured whether asynchronous pipeline compilation remained active. */
  readonly compiling?: boolean;
  readonly resolutionScale: number;
  readonly scaleSource: string;
  readonly sampleCount: number;
  readonly drawingBufferWidth: number;
  readonly drawingBufferHeight: number;
  readonly atFloor?: boolean;
}

export interface IFrameBudgetWindowJson {
  readonly fps: number;
  readonly frames: number;
  readonly frame?: IPerfSummary;
  readonly hitches: number;
  readonly phases?: Readonly<Record<string, IPerfSummary>>;
  readonly surface?: IFrameSurfaceJson;
  /** GPU milliseconds from `timestamp-query`, absent when the adapter has none. */
  readonly gpuMs?: number;
  readonly window: number;
}

export interface IHostGapSegmentJson {
  readonly meanMs: number;
  readonly p50Ms: number;
}

export interface IHostGapWindowJson {
  readonly frames: number;
  readonly periodP50Ms: number;
  readonly segments: Readonly<Record<string, IHostGapSegmentJson>>;
  readonly sumP50Ms?: number;
}

/**
 * One `TN_FRAME_HITCH` window from the native host: the first 300 presented frames after launch,
 * reported as a distribution. The `pipelineCompile` fields are PRD-327 Phase 4's late-sync-compile
 * attribution — absent on lines from hosts older than the field, which must still parse.
 */
export interface IHitchWindowJson {
  readonly window: number;
  readonly maxMs: number;
  readonly maxAtFrame: number;
  readonly p99Ms: number;
  readonly p50Ms: number;
  readonly pipelineCompileMs?: number;
  readonly pipelineCompileCalls?: number;
}

export type IPerfViolationCode =
  | "TN_PERF_BOUNDS_NOT_ASSESSABLE"
  | "TN_PERF_MAX_FRAME_P95"
  | "TN_PERF_MIN_FPS"
  | "TN_PERF_WINDOWS_MISSING";

export interface IPerfViolation {
  readonly bound: number;
  readonly code: IPerfViolationCode;
  readonly observed: number | undefined;
  readonly window: number;
}

export interface IProjectionWindowJson {
  readonly drawsActual?: number;
  readonly drawsPlanned: number;
  readonly exact: Readonly<Record<string, number>>;
  readonly exactObjects: number;
  readonly projecting: boolean;
  readonly reason?: string;
  readonly reasonCode: string;
  readonly sourceRenderables: number;
  readonly window: number;
}

export interface IPerfMarkerParse {
  readonly budgets: readonly IFrameBudgetWindowJson[];
  readonly hitches: readonly IHitchWindowJson[];
  readonly hostGaps: readonly IHostGapWindowJson[];
  readonly presentMode: string | undefined;
  readonly projections: readonly IProjectionWindowJson[];
}

export interface IPerfReport {
  readonly budgets: readonly IFrameBudgetWindowJson[];
  readonly discardedWindows: readonly number[];
  readonly hitches: readonly IHitchWindowJson[];
  readonly hostGaps: readonly IHostGapWindowJson[];
  readonly pass: boolean;
  readonly presentMode: string | undefined;
  readonly projections: readonly IProjectionWindowJson[];
  readonly source: string;
  readonly violations: readonly IPerfViolation[];
}

/**
 * Orders the exact lane by the draws each reason costs, largest first.
 *
 * The next population worth folding is whichever reason tops this list in a game that is actually
 * slow. Picking it any other way is picking it by intuition.
 */
export function rankExactReasons(
  exact: Readonly<Record<string, number>>,
): { count: number; reason: string }[] {
  return Object.entries(exact)
    .filter(([, count]) => typeof count === "number" && count > 0)
    .map(([reason, count]) => ({ count, reason }))
    .sort((left, right) => right.count - left.count || (left.reason < right.reason ? -1 : 1));
}

export interface IPerfBounds {
  readonly maxFrameMsP95?: number;
  readonly minFps?: number;
  readonly requireWindows: number;
}

export interface IPerfArgs extends IPerfBounds {
  readonly executable: string | undefined;
  readonly file: string | undefined;
  readonly hostArgs: readonly string[];
  readonly logcatSerial: string | undefined;
  readonly text: boolean;
  readonly timeoutSeconds: number;
}

const PRESENT_MODE_PATTERN = /Present mode: (\S+ \(vsync=(?:true|false)\))/u;

/**
 * Parse every marker line out of a captured stream, logcat prefixes and all. A line that names a
 * marker but carries unparsable JSON throws — a meter line that cannot be read must never be
 * counted as absent, because "absent" is itself a failure here and a silent drop would hide the
 * difference between the two.
 */
export function parsePerformanceMarkers(text: string): IPerfMarkerParse {
  const budgets: IFrameBudgetWindowJson[] = [];
  const budgetPayloads = new Set<string>();
  const hitches: IHitchWindowJson[] = [];
  const hitchPayloads = new Set<string>();
  const hostGaps: IHostGapWindowJson[] = [];
  const projections: IProjectionWindowJson[] = [];
  const projectionPayloads = new Set<string>();
  let presentMode: string | undefined;
  for (const line of text.split("\n")) {
    const budget = parseMarkerLine<IFrameBudgetWindowJson>(line, FRAME_BUDGET_MARKER);
    if (budget !== undefined) {
      // Android mirrors console output through MystralStdio and MystralJS. One measured window is
      // therefore present twice in logcat with the exact same payload; count that observation once
      // without hiding a second payload whose measurements differ.
      const payload = JSON.stringify(budget);
      if (!budgetPayloads.has(payload)) {
        budgetPayloads.add(payload);
        budgets.push(budget);
      }
    }
    const hitch = parseMarkerLine<IHitchWindowJson>(line, HITCH_MARKER);
    if (hitch !== undefined) {
      // Same reason the budget lines are de-duplicated: Android mirrors console output twice.
      const payload = JSON.stringify(hitch);
      if (!hitchPayloads.has(payload)) {
        hitchPayloads.add(payload);
        hitches.push(hitch);
      }
    }
    const hostGap = parseMarkerLine<IHostGapWindowJson>(line, HOST_GAP_MARKER);
    if (hostGap !== undefined) hostGaps.push(hostGap);
    const projection = parseMarkerLine<IProjectionWindowJson>(line, PROJECTION_MARKER);
    if (projection !== undefined) {
      // Same reason the budget lines are de-duplicated: Android mirrors console output twice.
      const payload = JSON.stringify(projection);
      if (!projectionPayloads.has(payload)) {
        projectionPayloads.add(payload);
        projections.push(projection);
      }
    }
    const mode = PRESENT_MODE_PATTERN.exec(line);
    if (mode?.[1] !== undefined) presentMode = mode[1];
  }
  return { budgets, hitches, hostGaps, presentMode, projections };
}

function parseMarkerLine<T>(line: string, marker: string): T | undefined {
  const start = line.indexOf(marker);
  if (start === -1) return undefined;
  const json = line.slice(start + marker.length).trim();
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    const name = marker.slice(0, -1);
    throw new Error(
      `TN_PERF_MARKER_MALFORMED: a ${name} line carried unparsable JSON (${json.slice(0, 80)}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Apply the one-window-always-lies rule and any requested bounds. The first window of a multi-
 * window run is discarded as startup; bounds are checked against every steady window, because a
 * bound that passes on the median and fails on the steady tail is a failed bound. Fewer steady
 * windows than `requireWindows` is a `TN_PERF_WINDOWS_MISSING` violation — the run did not
 * produce enough evidence to assess, which is a failure, not an empty pass.
 */
export function assessPerfMarkers(parse: IPerfMarkerParse, bounds: IPerfBounds, source: string): IPerfReport {
  const discardCount = parse.budgets.length > 1 ? 1 : 0;
  const discardedWindows = parse.budgets.slice(0, discardCount).map(({ window }) => window);
  const steady = parse.budgets.slice(discardCount);
  const violations: IPerfViolation[] = [];
  if (steady.length < bounds.requireWindows) {
    violations.push({ bound: bounds.requireWindows, code: "TN_PERF_WINDOWS_MISSING", observed: steady.length, window: -1 });
  }
  for (const window of steady) {
    if (bounds.maxFrameMsP95 !== undefined) {
      const frameP95 = window.frame?.p95;
      if (frameP95 === undefined) {
        violations.push({ bound: bounds.maxFrameMsP95, code: "TN_PERF_BOUNDS_NOT_ASSESSABLE", observed: undefined, window: window.window });
      } else if (frameP95 > bounds.maxFrameMsP95) {
        violations.push({ bound: bounds.maxFrameMsP95, code: "TN_PERF_MAX_FRAME_P95", observed: frameP95, window: window.window });
      }
    }
    if (bounds.minFps !== undefined && window.fps < bounds.minFps) {
      violations.push({ bound: bounds.minFps, code: "TN_PERF_MIN_FPS", observed: window.fps, window: window.window });
    }
  }
  return {
    budgets: parse.budgets,
    discardedWindows,
    hitches: parse.hitches,
    hostGaps: parse.hostGaps,
    pass: violations.length === 0 && parse.budgets.length > 0,
    presentMode: parse.presentMode,
    projections: parse.projections,
    source,
    violations,
  };
}

export interface IPerfSources {
  executable?: string;
  file?: string;
  hostArgs: string[];
  logcatSerial?: string;
}

export function parsePerfArgs(argv: readonly string[]): IPerfArgs {
  const sources: IPerfSources = { hostArgs: [] };
  const bounds: { maxFrameMsP95?: number; minFps?: number; requireWindows: number } = { requireWindows: 2 };
  let text = false;
  let timeoutSeconds = 180;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--text") text = true;
    else if (flag === "--file") { sources.file = requireValue(flag, value); index += 1; }
    else if (flag === "--executable") { sources.executable = requireValue(flag, value); index += 1; }
    else if (flag === "--host-arg") {
      if (value !== undefined) sources.hostArgs.push(value);
      index += 1;
    } else if (flag === "--logcat") { sources.logcatSerial = requireValue(flag, value); index += 1; }
    else if (flag === "--max-frame-p95") { bounds.maxFrameMsP95 = requireNumber(flag, value); index += 1; }
    else if (flag === "--min-fps") { bounds.minFps = requireNumber(flag, value); index += 1; }
    else if (flag === "--require-windows") { bounds.requireWindows = requireNumber(flag, value); index += 1; }
    else if (flag === "--timeout") { timeoutSeconds = requireNumber(flag, value); index += 1; }
    else throw new PlaytestCliUsageError(`threenative-playtest perf: unknown flag '${flag}'. See threenative-playtest --help.`);
  }
  const named = [sources.file !== undefined, sources.executable !== undefined, sources.logcatSerial !== undefined]
    .filter(Boolean).length;
  if (named === 0) {
    throw new PlaytestCliUsageError(
      "threenative-playtest perf: name one source — --file <log>, --executable <host binary> (+ repeatable --host-arg), or --logcat <serial>.",
    );
  }
  if (named > 1) {
    throw new PlaytestCliUsageError("threenative-playtest perf: --file, --executable and --logcat are mutually exclusive.");
  }
  return {
    executable: sources.executable,
    file: sources.file,
    hostArgs: sources.hostArgs,
    logcatSerial: sources.logcatSerial,
    maxFrameMsP95: bounds.maxFrameMsP95,
    minFps: bounds.minFps,
    requireWindows: bounds.requireWindows,
    text,
    timeoutSeconds,
  };
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined) throw new PlaytestCliUsageError(`threenative-playtest perf: ${flag} needs a value.`);
  return value;
}

function requireNumber(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (value === undefined || Number.isNaN(parsed)) {
    throw new PlaytestCliUsageError(`threenative-playtest perf: ${flag} needs a number, received '${value ?? ""}'.`);
  }
  return parsed;
}

export async function perfCommand(argv: readonly string[]): Promise<number> {
  const args = parsePerfArgs(argv);
  try {
    if (args.file !== undefined) {
      const path = resolve(args.file);
      return emit(parsePerformanceMarkers(await readFile(path, "utf8")), args, `file: ${path}`);
    }
    if (args.logcatSerial !== undefined) {
      return emit(parsePerformanceMarkers(await readLogcat(args.logcatSerial)), args, `logcat: ${args.logcatSerial}`);
    }
    if (args.executable !== undefined) {
      return await runExecutable(args, args.executable);
    }
  } catch (error) {
    if (error instanceof PlaytestCliUsageError) throw error;
    // A source that cannot be read, or a marker that cannot be parsed, is the finding. Report it
    // as the command's failure with its TN_PERF_ code — never as a stack trace, never as an
    // empty success.
    const message = error instanceof Error ? error.message : String(error);
    const code = message.startsWith("TN_PERF_") ? (message.split(":")[0] ?? "TN_PERF_SOURCE_UNREADABLE") : "TN_PERF_SOURCE_UNREADABLE";
    process.stderr.write(`${JSON.stringify({ diagnostics: [{ code, message, severity: "error" }], pass: false }, null, 2)}\n`);
    process.exitCode = 2;
    return 2;
  }
  throw new PlaytestCliUsageError("threenative-playtest perf: no source named.");
}

/** Spawn the host, collect its output, and stop once enough windows have closed. */
async function runExecutable(args: IPerfArgs, executable: string): Promise<number> {
  const source = `executable: ${[executable, ...args.hostArgs].join(" ")}`;
  const child = spawn(executable, args.hostArgs, { stdio: ["ignore", "pipe", "pipe"] });
  let collected = "";
  let stopped = false;
  // The first window is discarded as startup, so a complete run closes requireWindows + 1.
  const enoughWindows = (): boolean =>
    collected.split(FRAME_BUDGET_MARKER).length - 1 >= args.requireWindows + 1;
  const stop = (): void => {
    if (!stopped) {
      stopped = true;
      child.kill("SIGTERM");
    }
  };
  child.stdout.on("data", (chunk: Buffer) => {
    collected += chunk.toString("utf8");
    if (enoughWindows()) stop();
  });
  child.stderr.on("data", (chunk: Buffer) => { collected += chunk.toString("utf8"); });
  const timeout = setTimeout(stop, args.timeoutSeconds * 1000);
  return new Promise<number>((settleExit) => {
    child.on("error", (error) => {
      clearTimeout(timeout);
      const message = `TN_PERF_SOURCE_UNREADABLE: could not spawn ${executable}: ${error.message}`;
      process.stderr.write(`${JSON.stringify({ diagnostics: [{ code: "TN_PERF_SOURCE_UNREADABLE", message, severity: "error" }], pass: false }, null, 2)}\n`);
      process.exitCode = 2;
      settleExit(2);
    });
    child.on("exit", () => {
      clearTimeout(timeout);
      const code = emit(parsePerformanceMarkers(collected), args, source);
      process.exitCode = code;
      settleExit(code);
    });
  });
}

async function readLogcat(serial: string): Promise<string> {
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync(discoverAdb(), ["-s", serial, "logcat", "-d", "-v", "brief"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

function emit(parse: IPerfMarkerParse, args: IPerfArgs, source: string): number {
  const report = assessPerfMarkers(parse, args, source);
  const windowsMissing = report.violations.some(({ code }) => code === "TN_PERF_WINDOWS_MISSING");
  const exitCode: 0 | 1 | 2 = windowsMissing ? 2 : report.pass ? 0 : 1;
  process.stdout.write(args.text ? formatPerfReport(report) : `${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = exitCode;
  return exitCode;
}

export function formatPerfReport(report: IPerfReport): string {
  const lines: string[] = [`perf — ${report.budgets.length} window(s) from ${report.source}`];
  if (report.presentMode !== undefined) lines.push(`present mode: ${report.presentMode}`);
  // Reported once, from the last window, next to the fps it explains. Named as unreported when
  // absent rather than left off: a reader who sees no scale line must not assume a full-resolution
  // single-sample frame, which is exactly how a perf record and its tree came to disagree.
  const surface = report.budgets.at(-1)?.surface;
  lines.push(
    surface === undefined
      ? "surface: unreported — this fps does not say what resolution or sampling produced it"
      : `surface: scale ${surface.resolutionScale} ${surface.scaleSource}, ` +
        `${surface.drawingBufferWidth}x${surface.drawingBufferHeight}, ${surface.sampleCount}x samples` +
        (surface.compiling === undefined
          ? ""
          : surface.compiling
            ? ", compile pending"
            : ", compile idle") +
        // At the floor the scaler has no room left and the target is still missed. Saying only
        // the scale here would read as a budget met at a low resolution.
        (surface.atFloor === true ? " — AT FLOOR, budget not met" : ""),
  );
  const anyGpu = report.budgets.some((window) => window.gpuMs !== undefined);
  // The meter reports nothing rather than zero when it cannot measure, so a missing GPU column has
  // to say *why*. A blank one reads as "the GPU cost nothing", which is the opposite of the truth
  // and is how a phone's GPU time went unattributed for months.
  if (!anyGpu && report.budgets.length > 0) {
    lines.push(
      "gpu: not reported — the meter emits nothing rather than zero when the device did not grant " +
        "'timestamp-query'. Check the TN_WEBGPU_FEATURES line in the same log for what it did grant.",
    );
  }
  lines.push(
    `window  fps     frame p50/p95    render p50/p95   hostGap p50/p95${anyGpu ? "  gpu ms" : ""}`,
  );
  for (const window of report.budgets) {
    const label = report.discardedWindows.includes(window.window) ? `${window.window}*` : String(window.window);
    lines.push(
      [
        label.padEnd(7),
        window.fps.toFixed(2).padEnd(7),
        summary(window.frame).padEnd(16),
        summary(window.phases?.render).padEnd(16),
        summary(window.phases?.hostGap),
        // "unmeasured" rather than a dash: a dash in a column of numbers reads as a zero, and this
        // one window may be the only one the device refused.
        ...(anyGpu
          ? [` ${window.gpuMs === undefined ? "unmeasured" : window.gpuMs.toFixed(2)}`]
          : []),
      ].join(" "),
    );
  }
  if (report.discardedWindows.length > 0) lines.push("* discarded as startup (window 1 always lies)");
  lines.push(...formatProjection(report.projections));
  const lastGap = report.hostGaps.at(-1);
  if (lastGap !== undefined) {
    lines.push(`host gap segments (${lastGap.frames}-frame window, p50 ms):`);
    for (const [name, segment] of Object.entries(lastGap.segments).sort(([, a], [, b]) => b.p50Ms - a.p50Ms)) {
      lines.push(`  ${name.padEnd(16)}${segment.p50Ms.toFixed(3)}`);
    }
  }
  lines.push(...formatHitches(report.hitches));
  for (const violation of report.violations) {
    const observed = violation.observed === undefined ? "absent" : round(violation.observed).toString();
    lines.push(`FAIL ${violation.code}: window ${violation.window} observed ${observed} against bound ${violation.bound}`);
  }
  if (report.pass) lines.push("PASS");
  return `${lines.join("\n")}\n`;
}

/**
 * The scene projection, from the last window, ranked by what each exact-lane reason costs.
 *
 * Says "not reported" rather than printing an empty table when the marker is absent: a reader who
 * sees no projection section must not conclude the exact lane was empty, which is how an
 * unmeasured lane comes to be described as a measured zero.
 */
function formatProjection(windows: readonly IProjectionWindowJson[]): string[] {
  const last = windows.at(-1);
  if (last === undefined) {
    return ["scene projection: not reported — this run does not say what it drew one-at-a-time"];
  }
  const measured =
    last.drawsActual === undefined
      ? "unmeasured"
      : `${last.drawsActual}${last.drawsActual === last.drawsPlanned ? "" : " (all passes; the plan counts the colour pass only)"}`;
  const lines = [
    last.projecting
      ? `scene projection: on (${last.reasonCode}); ${last.sourceRenderables} authored renderables, ` +
        `${last.drawsPlanned} draws planned, ${measured} actual`
      : `scene projection: DECLINED (${last.reasonCode})${last.reason === undefined ? "" : ` — ${last.reason}`}; ` +
        `${last.sourceRenderables} authored renderables drawn one at a time`,
  ];
  const ranked = rankExactReasons(last.exact);
  if (last.exactObjects > 0 && ranked.length === 0) {
    lines.push(
      `  ${last.exactObjects} object(s) on the exact lane with no reason recorded — that is a bug in the reporter, not an empty lane`,
    );
    return lines;
  }
  if (ranked.length === 0) return lines;
  lines.push(`  exact lane, ${last.exactObjects} draw(s), by reason:`);
  for (const { count, reason } of ranked) lines.push(`    ${reason.padEnd(22)}${count}`);
  return lines;
}

function summary(summaryValue: IPerfSummary | undefined): string {
  return summaryValue === undefined ? "—" : `${summaryValue.p50.toFixed(1)}/${summaryValue.p95.toFixed(1)}`;
}

/**
 * The native host's post-launch hitch windows, with the late sync compile named when one happened.
 *
 * A window whose payload carries a nonzero `pipelineCompile` is a material that appeared mid-game
 * and compiled synchronously inside a frame — the anonymous 200 ms spike this section exists to
 * name. A host older than the field omits it and is named as such rather than read as a zero,
 * which is the same rule the gpu column follows.
 */
function formatHitches(hitches: readonly IHitchWindowJson[]): string[] {
  if (hitches.length === 0) return [];
  const lines = [
    `hitch windows (post-launch, ${hitches.length}): worst ${Math.max(...hitches.map((h) => h.maxMs)).toFixed(3)} ms`,
  ];
  const named = hitches.filter((hitch) => (hitch.pipelineCompileCalls ?? 0) > 0);
  if (named.length === 0) {
    // A missing field and a measured zero are different facts: the first means the host predates
    // the attribution, the second means no late compile happened. Never merge them into one line.
    const anyField = hitches.some((hitch) => hitch.pipelineCompileCalls !== undefined);
    lines.push(
      anyField
        ? "  late sync compile: none — every window reported pipelineCompileCalls 0"
        : "  late sync compile: unreported — this host predates the pipelineCompile fields (TN_FRAME_HITCH without them)",
    );
    return lines;
  }
  for (const hitch of named) {
    lines.push(
      `  late sync compile: ${hitch.pipelineCompileMs?.toFixed(3) ?? "unreported"} ms across ` +
        `${hitch.pipelineCompileCalls} call(s) in the window whose worst frame landed at ` +
        `frame ${hitch.maxAtFrame}`,
    );
  }
  return lines;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
