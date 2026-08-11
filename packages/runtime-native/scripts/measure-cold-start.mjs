#!/usr/bin/env node

/**
 * Cold-start measurement for the Android host — PRD-070 Phase 0.
 *
 * Nothing in this repository measured launch time before this script. That is the defect it
 * opens on rather than a slow number: PRD-066 watched a 50x frame-rate regression ship because
 * nothing measured frames, and the identical hole was still open for launch.
 *
 * It reports a **phase breakdown**, never one number, because "launch is slow" cannot choose
 * between precompiled bytecode, a faster engine, and first-frame cost. Every segment below is
 * bounded by two `TN_COLD_START` markers emitted from one monotonic clock inside the process, so
 * a reader subtracts two numbers rather than two logcat timestamps from two different clocks.
 *
 * Fail-closed, all of it:
 *
 *   - a missing segment marker exits non-zero naming the marker, never reports a partial total
 *   - an `emulator-*` serial is refused before any measurement; an emulator launch time is not a
 *     phone launch time and must not be quotable as one
 *   - one launch is malformed input, not a result; the distribution needs samples
 *   - the report names the build type, because -O0 and -O2 differ by roughly 4x on this metric
 *
 * This script sets no threshold. It produces the number PRD-058 would need to set one.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_ID = "com.mystral.engine";
const ACTIVITY = `${APP_ID}/.MystralActivity`;
const MARKER = "TN_COLD_START:";

/**
 * The launch, in order. `first_frame` comes from the present that actually reached the display,
 * so it means the player saw something rather than the loop merely ran.
 */
export const SEGMENTS = [
  { from: "process", to: "asset_begin", name: "host bring-up" },
  { from: "asset_begin", to: "asset_complete", name: "bundle read from APK" },
  { from: "asset_complete", to: "runtime_created", name: "runtime creation" },
  { from: "runtime_created", to: "game_eval_begin", name: "pre-eval setup" },
  { from: "game_eval_begin", to: "compile_begin", name: "eval entry" },
  { from: "compile_begin", to: "compile_complete", name: "JavaScript parse and compile" },
  { from: "compile_complete", to: "execute_begin", name: "post-compile setup" },
  { from: "execute_begin", to: "execute_complete", name: "bundle top-level execution" },
  { from: "execute_complete", to: "first_frame", name: "first rendered frame" },
];

export const REQUIRED_MARKERS = [
  "process",
  "asset_begin",
  "asset_complete",
  "runtime_created",
  "game_eval_begin",
  "compile_begin",
  "compile_complete",
  "execute_begin",
  "execute_complete",
  "first_frame",
];

/**
 * Compile and execute markers that must be read from the game's own eval, not the runtime's.
 *
 * The host evaluates two bootstrap scripts before the game bundle, so each of these fires three
 * times a launch, and taking the first occurrence measured a 0.1 ms bootstrap as though it were a
 * 4 MB game. `game_eval_begin` brackets the real one.
 */
const GAME_EVAL_MARKERS = new Set([
  "compile_begin",
  "compile_complete",
  "execute_begin",
  "execute_complete",
]);

export class ColdStartError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "ColdStartError";
    this.exitCode = exitCode;
  }
}

function adbPath(environment = process.env) {
  if (environment.THREENATIVE_ADB) return environment.THREENATIVE_ADB;
  const sdk = environment.THREENATIVE_ANDROID_SDK ?? join(homedir(), "Android", "Sdk");
  const candidate = join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
  if (!existsSync(candidate)) throw new ColdStartError("TN_COLD_START_ADB_MISSING", 2);
  return candidate;
}

function adb(serial, args, timeoutMs = 120_000) {
  const result = spawnSync(adbPath(), ["-s", serial, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
  });
  if (result.error) throw new ColdStartError(`TN_COLD_START_ADB_FAILED:${result.error.message}`);
  return String(result.stdout ?? "");
}

/**
 * Parses one launch's markers out of logcat.
 *
 * Markers outside the game's eval keep their first occurrence, so a relaunch captured in the same
 * buffer cannot silently blend two launches into one sample. The four compile and execute markers
 * instead take their first occurrence *after* `game_eval_begin`, because the host evaluates its
 * own bootstrap scripts through the same code path first.
 */
export function parseMarkers(logcat) {
  const found = new Map();
  let inGameEval = false;
  for (const line of logcat.split("\n")) {
    const at = line.indexOf(MARKER);
    if (at === -1) continue;
    let payload;
    try {
      payload = JSON.parse(line.slice(at + MARKER.length).trim());
    } catch {
      throw new ColdStartError(`TN_COLD_START_MARKER_MALFORMED:${line.trim()}`);
    }
    if (typeof payload?.segment !== "string" || typeof payload?.atMs !== "number") {
      throw new ColdStartError(`TN_COLD_START_MARKER_MALFORMED:${line.trim()}`);
    }
    if (!Number.isFinite(payload.atMs)) {
      throw new ColdStartError(`TN_COLD_START_MARKER_MALFORMED:${line.trim()}`);
    }
    if (payload.segment === "game_eval_begin") inGameEval = true;
    if (GAME_EVAL_MARKERS.has(payload.segment) && !inGameEval) continue;
    if (!found.has(payload.segment)) found.set(payload.segment, payload.atMs);
  }
  return found;
}

/** One launch's segment breakdown. Throws rather than reporting a partial total. */
export function breakdown(markers) {
  for (const name of REQUIRED_MARKERS) {
    if (!markers.has(name)) throw new ColdStartError(`TN_COLD_START_MARKER_MISSING:${name}`);
  }
  const segments = SEGMENTS.map((segment) => {
    const ms = markers.get(segment.to) - markers.get(segment.from);
    if (!(ms >= 0)) {
      // Time running backwards means two launches were blended, or the clock is not the one
      // this script thinks it is. Either way the sample is not a measurement.
      throw new ColdStartError(`TN_COLD_START_SEGMENT_NEGATIVE:${segment.from}->${segment.to}`);
    }
    return { ...segment, ms };
  });
  const totalMs = markers.get("first_frame") - markers.get("process");
  if (!(totalMs > 0)) throw new ColdStartError("TN_COLD_START_TOTAL_INVALID");
  return { segments, totalMs };
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) throw new ColdStartError("TN_COLD_START_NO_SAMPLES");
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export function summarise(samples) {
  if (samples.length < 2) throw new ColdStartError("TN_COLD_START_TOO_FEW_LAUNCHES");
  const totals = samples.map((sample) => sample.totalMs).sort((a, b) => a - b);
  const bySegment = SEGMENTS.map((segment, index) => {
    const values = samples.map((sample) => sample.segments[index].ms).sort((a, b) => a - b);
    return {
      from: segment.from,
      to: segment.to,
      name: segment.name,
      medianMs: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95),
      maxMs: values.at(-1),
      shareOfMedianTotal: percentile(values, 0.5) / percentile(totals, 0.5),
    };
  });
  return {
    launches: samples.length,
    totalMs: {
      medianMs: percentile(totals, 0.5),
      p95Ms: percentile(totals, 0.95),
      minMs: totals[0],
      maxMs: totals.at(-1),
      samplesMs: samples.map((sample) => sample.totalMs),
    },
    segments: bySegment,
  };
}

export function parseArgs(argv) {
  const options = {
    device: undefined,
    launches: 5,
    settleMs: 20_000,
    report: undefined,
    optimization: "-O2",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new ColdStartError(`TN_COLD_START_ARG_MISSING:${arg}`, 2);
      index += 1;
      return value;
    };
    if (arg === "--device") options.device = next();
    else if (arg === "--launches") options.launches = Number(next());
    else if (arg === "--settle-ms") options.settleMs = Number(next());
    else if (arg === "--report") options.report = next();
    else if (arg === "--optimization") options.optimization = next();
    else throw new ColdStartError(`TN_COLD_START_ARG_UNKNOWN:${arg}`, 2);
  }
  if (options.device === undefined) throw new ColdStartError("TN_COLD_START_DEVICE_REQUIRED", 2);
  // One launch is a story, not a distribution. PRD-064 already asks desktop for five.
  if (!Number.isInteger(options.launches) || options.launches < 2) {
    throw new ColdStartError("TN_COLD_START_LAUNCHES_INVALID", 2);
  }
  if (!Number.isFinite(options.settleMs) || options.settleMs < 1_000) {
    throw new ColdStartError("TN_COLD_START_SETTLE_INVALID", 2);
  }
  if (options.optimization !== "-O0" && options.optimization !== "-O2") {
    // A launch time quoted without its build type is unusable: the two differ by roughly 4x.
    throw new ColdStartError("TN_COLD_START_OPTIMIZATION_INVALID", 2);
  }
  return options;
}

export function assertPhysicalDevice(serial) {
  if (/^emulator-/u.test(serial)) throw new ColdStartError("TN_COLD_START_EMULATOR_BLOCKED", 2);
  return serial;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertPhysicalDevice(options.device);
  const serial = options.device;

  const listing = adb(serial, ["shell", "getprop", "ro.product.model"]).trim();
  const qemu = adb(serial, ["shell", "getprop", "ro.kernel.qemu"]).trim();
  if (qemu !== "") throw new ColdStartError("TN_COLD_START_EMULATOR_BLOCKED", 2);

  adb(serial, ["logcat", "-G", "64M"]);
  const samples = [];
  for (let launch = 0; launch < options.launches; launch += 1) {
    adb(serial, ["shell", "am", "force-stop", APP_ID]);
    // A warm page cache is a different measurement. Killing the process and clearing the log is
    // the most this can do without root; the report says "cold start" meaning process cold.
    adb(serial, ["logcat", "-c"]);
    await sleep(1_500);
    adb(serial, ["shell", "am", "start", "-n", ACTIVITY]);
    await sleep(options.settleMs);
    const logcat = adb(serial, ["logcat", "-d"]);
    samples.push(breakdown(parseMarkers(logcat)));
  }
  adb(serial, ["shell", "am", "force-stop", APP_ID]);

  const apkPath = join(runtimeRoot, "android/app/build/outputs/apk/debug/app-debug.apk");
  const apkSha256 = existsSync(apkPath)
    ? createHash("sha256").update(readFileSync(apkPath)).digest("hex")
    : null;

  const report = {
    schemaVersion: 1,
    device: { serial, model: listing, kind: "physical" },
    nativeBuild: { optimization: options.optimization },
    apkSha256,
    ...summarise(samples),
  };

  if (options.report) {
    mkdirSync(dirname(resolve(options.report)), { recursive: true });
    writeFileSync(resolve(options.report), `${JSON.stringify(report, null, 2)}\n`);
  }
  const total = report.totalMs;
  console.log(
    `cold start on ${listing} (${serial}), ${report.launches} launches, ${options.optimization}`,
  );
  console.log(
    `  total: median ${total.medianMs.toFixed(0)} ms, p95 ${total.p95Ms.toFixed(0)} ms, ` +
      `range ${total.minMs.toFixed(0)}-${total.maxMs.toFixed(0)} ms`,
  );
  for (const segment of report.segments) {
    console.log(
      `  ${segment.name.padEnd(30)} median ${segment.medianMs.toFixed(0).padStart(6)} ms  ` +
        `(${(segment.shareOfMedianTotal * 100).toFixed(1)}%)`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof ColdStartError ? error.message : error);
    process.exit(error?.exitCode ?? 1);
  });
}
