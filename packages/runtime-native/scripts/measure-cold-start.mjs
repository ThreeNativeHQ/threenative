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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  assertDeviceReady,
  MINIMUM_BATTERY_PERCENT,
  resolveAdbExecutable,
} from "./device-preflight.mjs";
import { readAndroidConfig } from "./package-android.mjs";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The identity a game declares in `threenative.config.ts`, which the packaging step already
// resolves. Measuring a launch means launching the app the game shipped, so the id is read from
// the same place rather than restated here — `--config` points at the resolved config, and the
// packaging default applies when a run does not pass one.
// The activity is the runtime host's and keeps its own package; only the application id is the
// game's to declare. Writing it relative to the app id resolved to a class that does not exist and
// the launch failed with "Activity class does not exist" — observed on a Pixel 8.
const ACTIVITY_CLASS = "com.threenative.runtime.MystralActivity";
const MARKER = "TN_COLD_START:";

function appIdentity(configPath) {
  const appId = readAndroidConfig(configPath).app.id;
  return { appId, activity: `${appId}/${ACTIVITY_CLASS}` };
}

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

/**
 * The same launch on desktop, minus the two markers that bracket reading the bundle out of an APK.
 *
 * A desktop host reads its entry from the filesystem inside `loadScript`, so `asset_begin` and
 * `asset_complete` have nothing to bracket and are absent by construction rather than missing.
 * Every other boundary is the same one, from the same clock, and `verify-desktop-core.mjs` asserts
 * exactly this list on every `pnpm native:verify:desktop` run.
 */
export const DESKTOP_SEGMENTS = [
  { from: "process", to: "runtime_created", name: "host bring-up" },
  { from: "runtime_created", to: "game_eval_begin", name: "pre-eval setup" },
  { from: "game_eval_begin", to: "compile_begin", name: "eval entry" },
  { from: "compile_begin", to: "compile_complete", name: "JavaScript parse and compile" },
  { from: "compile_complete", to: "execute_begin", name: "post-compile setup" },
  { from: "execute_begin", to: "execute_complete", name: "bundle top-level execution" },
  { from: "execute_complete", to: "first_frame", name: "first rendered frame" },
];

/** The markers a segment list needs, in the order they must arrive. */
export function requiredMarkers(segments) {
  const names = [];
  for (const segment of segments) {
    if (!names.includes(segment.from)) names.push(segment.from);
    if (!names.includes(segment.to)) names.push(segment.to);
  }
  return names;
}

export const REQUIRED_MARKERS = requiredMarkers(SEGMENTS);
export const DESKTOP_REQUIRED_MARKERS = requiredMarkers(DESKTOP_SEGMENTS);

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

export function adbPath(environment = process.env, dependencies = {}) {
  return resolveAdbExecutable(environment, {
    ...dependencies,
    onMissing: () => new ColdStartError("TN_COLD_START_ADB_MISSING", 2),
  });
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
export function breakdown(markers, segments_ = SEGMENTS) {
  for (const name of requiredMarkers(segments_)) {
    if (!markers.has(name)) throw new ColdStartError(`TN_COLD_START_MARKER_MISSING:${name}`);
  }
  const segments = segments_.map((segment) => {
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

export function summarise(samples, segments = SEGMENTS) {
  if (samples.length < 2) throw new ColdStartError("TN_COLD_START_TOO_FEW_LAUNCHES");
  const totals = samples.map((sample) => sample.totalMs).sort((a, b) => a - b);
  const bySegment = segments.map((segment, index) => {
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

/**
 * Every flag, as data: the option it sets and how it reads its value.
 *
 * A table rather than an if-chain because the chain is what a second lane turns into a complexity
 * warning, and because a flag that is not in this table cannot be silently accepted.
 */
const FLAGS = new Map([
  ["--device", { key: "device", read: "value" }],
  ["--desktop", { key: "desktop", read: "flag" }],
  ["--binary", { key: "binary", read: "value" }],
  ["--bundle", { key: "bundle", read: "value" }],
  ["--frames", { key: "frames", read: "number" }],
  ["--launches", { key: "launches", read: "number" }],
  ["--settle-ms", { key: "settleMs", read: "number" }],
  ["--report", { key: "report", read: "value" }],
  ["--optimization", { key: "optimization", read: "value" }],
  ["--config", { key: "config", read: "value" }],
  ["--allow-device-condition", { key: "allowDeviceCondition", read: "flag" }],
  ["--allow-low-battery", { key: "allowDeviceCondition", read: "flag" }],
]);

/** Each refusal, as a predicate over the parsed options. Order is the order they are reported. */
const REFUSALS = [
  // The two lanes measure the same launch on different hardware and must never be blended: a
  // desktop total quoted as a phone number is the mistake this whole instrument exists to stop.
  [(o) => o.desktop && o.device !== undefined, "TN_COLD_START_LANE_AMBIGUOUS"],
  [(o) => !o.desktop && o.device === undefined, "TN_COLD_START_DEVICE_REQUIRED"],
  [(o) => o.desktop && (!Number.isInteger(o.frames) || o.frames < 1), "TN_COLD_START_FRAMES_INVALID"],
  // One launch is a story, not a distribution. PRD-064 already asks desktop for five.
  [(o) => !Number.isInteger(o.launches) || o.launches < 2, "TN_COLD_START_LAUNCHES_INVALID"],
  [(o) => !Number.isFinite(o.settleMs) || o.settleMs < 1_000, "TN_COLD_START_SETTLE_INVALID"],
  // A launch time quoted without its build type is unusable: the two differ by roughly 4x.
  [(o) => o.optimization !== "-O0" && o.optimization !== "-O2", "TN_COLD_START_OPTIMIZATION_INVALID"],
];

export function parseArgs(argv) {
  const options = {
    allowDeviceCondition: false,
    device: undefined,
    desktop: false,
    binary: undefined,
    bundle: undefined,
    frames: 60,
    launches: 5,
    settleMs: 20_000,
    report: undefined,
    optimization: "-O2",
    config: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const flag = FLAGS.get(arg);
    if (flag === undefined) throw new ColdStartError(`TN_COLD_START_ARG_UNKNOWN:${arg}`, 2);
    if (flag.read === "flag") {
      options[flag.key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) throw new ColdStartError(`TN_COLD_START_ARG_MISSING:${arg}`, 2);
    index += 1;
    options[flag.key] = flag.read === "number" ? Number(value) : value;
  }
  for (const [refuses, code] of REFUSALS) {
    if (refuses(options)) throw new ColdStartError(code, 2);
  }
  return options;
}

export function assertPhysicalDevice(serial) {
  if (/^emulator-/u.test(serial)) throw new ColdStartError("TN_COLD_START_EMULATOR_BLOCKED", 2);
  return serial;
}

/**
 * The desktop lane's answer to `--optimization`, read from the build rather than asserted by hand.
 *
 * The Android lane takes the build type as a flag because the APK's is not readable from here. A
 * desktop binary sits beside the CMake cache that produced it, so the number can name its own
 * build — and refuse when that build is one whose launch time means nothing. -O0 and -O2 differ by
 * roughly 4x on this metric, which is more than any lever this PRD could find.
 */
export function desktopOptimization(cacheText) {
  const buildType = cacheText.match(/^CMAKE_BUILD_TYPE:\w+=(.*)$/mu)?.[1]?.trim() ?? "";
  if (buildType === "") throw new ColdStartError("TN_COLD_START_BUILD_TYPE_UNKNOWN", 2);
  if (!/^(?:Release|RelWithDebInfo|MinSizeRel)$/u.test(buildType)) {
    throw new ColdStartError(`TN_COLD_START_OPTIMIZATION_INVALID:${buildType}`, 2);
  }
  return { buildType, optimization: "-O2" };
}

/**
 * Where the desktop host and the bundle live when nothing names them.
 *
 * `native-smoke` is the bundle the desktop gate already drives, so `--desktop` with no arguments
 * measures the launch that `pnpm native:verify:desktop` just proved renders.
 */
export function desktopDefaults(platform = process.platform) {
  const preset = platform === "darwin" ? "tn-macos" : platform === "win32" ? "tn-windows" : "tn-linux";
  return {
    preset,
    binary: join(runtimeRoot, "build", preset, platform === "win32" ? "mystral.exe" : "mystral"),
    bundle: join(runtimeRoot, "..", "..", "examples", "native-smoke", "dist", "native-smoke.js"),
  };
}

/**
 * One desktop launch, cold in the only sense a desktop process can be: a new process every time.
 *
 * The run is a screenshot run because `--frames` bounds only that mode — `runNormalMode` calls
 * `runtime.run()` and never returns, so a plain `run` here times out rather than reporting. Taking
 * the screenshot path is not a workaround: it is the same path `verify-desktop-core.mjs` drives,
 * and it makes the launch prove it reached the display rather than merely reaching the loop.
 *
 * Not `xvfb-run` — its cleanup `kill` fails after Xvfb has already exited and that failing kill's
 * status replaces the command's, so a good run reports a red. `scripts/xvfb.sh` is the wrapper that
 * hands back the command's own status, and `SDL_VIDEODRIVER=x11` is what stops SDL choosing the
 * session's Wayland socket over the private display the wrapper just made.
 */
export function runDesktopLaunch({ binary, bundle, frames, screenshot }, dependencies = {}) {
  const spawn = dependencies.spawnSync ?? spawnSync;
  const workspace = resolve(runtimeRoot, "..", "..");
  const runtimeArgs = ["run", bundle, "--screenshot", screenshot, "--frames", String(frames)];
  const onLinux = process.platform === "linux";
  const result = spawn(
    onLinux ? "sh" : binary,
    onLinux ? [join(workspace, "scripts", "xvfb.sh"), binary, ...runtimeArgs] : runtimeArgs,
    {
      cwd: dirname(bundle),
      encoding: "utf8",
      env: onLinux ? { ...process.env, SDL_VIDEODRIVER: "x11" } : { ...process.env },
      maxBuffer: 64 * 1024 * 1024,
      timeout: 180_000,
    },
  );
  if (result.error) throw new ColdStartError(`TN_COLD_START_LAUNCH_FAILED:${result.error.message}`);
  const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new ColdStartError(`TN_COLD_START_LAUNCH_EXIT:${result.status}\n${log}`);
  }
  return log;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function reportBreakdown(report, headline) {
  const total = report.totalMs;
  console.log(headline);
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

async function mainDesktop(options) {
  const defaults = desktopDefaults();
  const binary = resolve(options.binary ?? defaults.binary);
  const bundle = resolve(options.bundle ?? defaults.bundle);
  for (const [label, path] of [["runtime binary", binary], ["bundle", bundle]]) {
    if (!existsSync(path)) throw new ColdStartError(`TN_COLD_START_MISSING:${label}:${path}`, 2);
  }
  const cachePath = join(dirname(binary), "CMakeCache.txt");
  if (!existsSync(cachePath)) throw new ColdStartError("TN_COLD_START_BUILD_TYPE_UNKNOWN", 2);
  const build = desktopOptimization(readFileSync(cachePath, "utf8"));

  const screenshot = join(runtimeRoot, "artifacts", "cold-start-desktop.png");
  mkdirSync(dirname(screenshot), { recursive: true });
  const samples = [];
  for (let launch = 0; launch < options.launches; launch += 1) {
    const log = runDesktopLaunch({ binary, bundle, frames: options.frames, screenshot });
    samples.push(breakdown(parseMarkers(log), DESKTOP_SEGMENTS));
  }

  const report = {
    schemaVersion: 1,
    lane: "desktop",
    host: { arch: process.arch, platform: process.platform },
    binary: { path: binary, sha256: createHash("sha256").update(readFileSync(binary)).digest("hex") },
    bundle: { path: bundle, sha256: createHash("sha256").update(readFileSync(bundle)).digest("hex") },
    nativeBuild: build,
    frames: options.frames,
    ...summarise(samples, DESKTOP_SEGMENTS),
  };
  if (options.report) {
    mkdirSync(dirname(resolve(options.report)), { recursive: true });
    writeFileSync(resolve(options.report), `${JSON.stringify(report, null, 2)}\n`);
  }
  reportBreakdown(
    report,
    `cold start on desktop ${process.platform}/${process.arch}, ${report.launches} launches, ` +
      `${build.buildType} (${build.optimization})`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.desktop) return mainDesktop(options);
  assertPhysicalDevice(options.device);
  const serial = options.device;
  const { appId, activity } = appIdentity(options.config);
  const deviceCondition = await assertDeviceReady(
    serial,
    {
      allowOverride: options.allowDeviceCondition,
      maxThermalStatus: "NONE",
      minBatteryPercent: MINIMUM_BATTERY_PERCENT,
      requireDischarging: true,
    },
    { adb: (args) => adb(serial, args) },
  );

  const listing = adb(serial, ["shell", "getprop", "ro.product.model"]).trim();
  const qemu = adb(serial, ["shell", "getprop", "ro.kernel.qemu"]).trim();
  if (qemu !== "") throw new ColdStartError("TN_COLD_START_EMULATOR_BLOCKED", 2);

  adb(serial, ["logcat", "-G", "64M"]);
  const samples = [];
  for (let launch = 0; launch < options.launches; launch += 1) {
    adb(serial, ["shell", "am", "force-stop", appId]);
    // A warm page cache is a different measurement. Killing the process and clearing the log is
    // the most this can do without root; the report says "cold start" meaning process cold.
    adb(serial, ["logcat", "-c"]);
    await sleep(1_500);
    adb(serial, ["shell", "am", "start", "-n", activity]);
    await sleep(options.settleMs);
    const logcat = adb(serial, ["logcat", "-d"]);
    samples.push(breakdown(parseMarkers(logcat)));
  }
  adb(serial, ["shell", "am", "force-stop", appId]);

  const apkPath = join(runtimeRoot, "android/app/build/outputs/apk/debug/app-debug.apk");
  const apkSha256 = existsSync(apkPath)
    ? createHash("sha256").update(readFileSync(apkPath)).digest("hex")
    : null;

  const report = {
    schemaVersion: 1,
    device: { serial, model: listing, kind: "physical" },
    deviceCondition,
    nativeBuild: { optimization: options.optimization },
    apkSha256,
    provisional: deviceCondition.provisional,
    ...summarise(samples),
  };

  if (options.report) {
    mkdirSync(dirname(resolve(options.report)), { recursive: true });
    writeFileSync(resolve(options.report), `${JSON.stringify(report, null, 2)}\n`);
  }
  reportBreakdown(
    report,
    `cold start on ${listing} (${serial}), ${report.launches} launches, ${options.optimization}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof ColdStartError ? error.message : error);
    process.exit(error?.exitCode ?? 1);
  });
}
