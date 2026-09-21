#!/usr/bin/env node

/**
 * The native UI cadence gate: how often a page that changes on its own reaches the screen.
 *
 * Why this exists. Every gate this repository had proved the page was *attached* and that the
 * loading screen *moved*; none of them measured how many distinct pictures the page produced per
 * game frame, which is what a player calls "the HUD is smooth". PRD-398's scheduler bug lived
 * exactly there: the snapshot loop asked for the next capture `interval` after each answer, so the
 * real period was the round trip *plus* the interval, and a page animating at 60 Hz reached the
 * screen at ~33 Hz. A screenshot cannot see that; the composite timeline can.
 *
 * The claim, as the assertion this makes: **for a page that changes every frame with no game post,
 * the uploaded frames are at least 90% of the game's composited frames, and the 95th-percentile gap
 * between uploaded frames is no more than two frame times.** A page whose pixels reach the screen
 * that often is a page the player sees move at the rate the page paints.
 *
 * What one run proves, in order:
 *
 * 1. the page attached (`TN_UI_OVERLAY`), so there is a page to measure at all;
 * 2. the run reached `first_playable` and then settled, so the window is steady state and not the
 *    startup, whose single-frame stall is a different defect (PRD-393's loader/pump work);
 * 3. at least two active segments, separated by an idle gap — the page's own 10 s / 1 s burst — so
 *    the resume from the idle backoff is measured and not assumed;
 * 4. each active segment meets the 90% / 2T bounds;
 * 5. the resume after idle is reported, whatever it is, so a slow wakeup cannot hide inside a p95.
 *
 * The data is the per-frame `TN_UI_COMPOSITE_TRACE` timeline (PRD-398's diagnostic), one line per
 * composited frame on the same launch clock as `TN_UI_COMPOSITE`, so gaps are differences of one
 * clock and not of two.
 *
 * Usage: node scripts/verify-native-ui-cadence.mjs [options]
 *
 *   --out <dir>          evidence directory; default artifacts/native-ui-cadence-<time>
 *   --settle-ms <n>      steady-state wait after first_playable, default 8000
 *   --window-ms <n>      measurement window, default 30000
 *   --timeout-ms <n>     how long to wait for first_playable, default 120000
 *   --window-size <WxH>  the private display's geometry, default 1280x720
 *   --bundle <path>      prebuilt game bundle; default builds examples/native-smoke
 *   --ui <dir>           prebuilt UI page; default builds examples/native-smoke/ui
 *
 * Exit codes: 0 all assertions passed; 1 an assertion failed (the reason is printed and written
 * beside the evidence); 2 the gate could not measure — no Xvfb, no compositor, no window.
 */

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";

const runtimeRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const workspaceRoot = join(runtimeRoot, "..", "..");
const exampleRoot = join(workspaceRoot, "examples", "native-smoke");
const defaultBundle = join(exampleRoot, "dist", "native-smoke.js");
const defaultUiSource = join(exampleRoot, "ui", "index.html");
const defaultUiEntry = join(exampleRoot, "ui", "main.ts");

/** The page's own burst: 10 s active, 1 s idle (`examples/native-smoke/ui/main.ts`). */
/** A gap between uploaded frames longer than this is the idle, not a slow frame. */
const IDLE_GAP_MS = 400;
/** The page's own frame time at 60 Hz; a segment shorter than this says nothing about a rate. */
const MIN_SEGMENT_FRAMES = 120;

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw new Error(`${command} failed to start: ${result.error.message}`);
  return result;
}

async function waitFor(predicate, { intervalMs = 250, timeoutMs = 30_000, what }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = predicate();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((done) => setTimeout(done, intervalMs));
  }
}

/** A private display with a compositor, the way `scripts/xvfb.sh` provisions one. */
async function startDisplay(windowSize) {
  const xvfb = spawn(
    "Xvfb",
    ["-displayfd", "3", "+extension", "COMPOSITE", "+extension", "SHAPE", "-screen", "0", `${windowSize}x24`, "-nolisten", "tcp"],
    { stdio: ["ignore", "ignore", "ignore", "pipe"] },
  );
  const display = await new Promise((done, fail_) => {
    let buffer = "";
    xvfb.stdio[3].on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.trim().length > 0) done(`:${buffer.trim()}`);
    });
    xvfb.on("exit", (code) => fail_(new Error(`Xvfb exited with code ${code} before it reported a display`)));
    setTimeout(() => fail_(new Error("Xvfb did not report a display within 15 s")), 15_000);
  });
  let compositor;
  for (const candidate of ["xcompmgr", "picom", "compton"]) {
    if (run("sh", ["-c", `command -v ${candidate}`]).status !== 0) continue;
    compositor = spawn(candidate, candidate === "xcompmgr" ? ["-n"] : [], {
      env: { ...process.env, DISPLAY: display },
      stdio: "ignore",
    });
    break;
  }
  await new Promise((done) => setTimeout(done, 400));
  return { compositor, display, xvfb };
}

/** Build the fixture bundle with the native backend and no playtest bridge: a bare launch. */
function buildBundle() {
  const result = run("pnpm", ["--dir", exampleRoot, "exec", "vite", "build"], {
    env: {
      ...process.env,
      THREENATIVE_NATIVE_BACKEND: "enabled",
      THREENATIVE_PLAYTEST_BRIDGE: "disabled",
    },
  });
  if (result.status !== 0) throw new Error(`building the fixture bundle failed:\n${result.stderr}`);
  if (!existsSync(defaultBundle)) throw new Error(`the fixture bundle is missing: ${defaultBundle}`);
  return defaultBundle;
}

/** Build the page the web view loads: entry + page, exactly as the project's own build does. */
async function buildUiPage(destination) {
  for (const [label, path] of [
    ["UI page", defaultUiSource],
    ["UI entry", defaultUiEntry],
  ]) {
    if (!existsSync(path)) throw new Error(`the ${label} is missing: ${path}`);
  }
  rmSync(destination, { force: true, recursive: true });
  mkdirSync(destination, { recursive: true });
  await esbuild({
    bundle: true,
    entryPoints: [defaultUiEntry],
    format: "esm",
    logLevel: "silent",
    outfile: join(destination, "main.js"),
    target: "es2022",
  });
  copyFileSync(defaultUiSource, join(destination, "index.html"));
  // The page-local animation is opt-in, so the UI-frame gate keeps its static page. This gate is the
  // one that wants the page moving, so it is the one that turns it on.
  const page = join(destination, "index.html");
  writeFileSync(
    page,
    readFileSync(page, "utf8").replace("</body>", "<script>window.__tnPageAnimation=true;</script></body>"),
  );
  return destination;
}

function nativeBinary(explicit) {
  if (explicit !== undefined) return resolve(explicit);
  const preset =
    process.platform === "darwin"
      ? "tn-macos"
      : process.platform === "win32"
        ? "tn-windows"
        : "tn-linux";
  return join(
    runtimeRoot,
    "build",
    preset,
    process.platform === "win32" ? "mystral.exe" : "mystral",
  );
}

function markersIn(log, prefix) {
  const out = [];
  for (const line of log.split("\n")) {
    const start = line.indexOf(prefix);
    if (start < 0) continue;
    try {
      out.push(JSON.parse(line.slice(start + prefix.length)));
    } catch {
      // A partial line at the tail of a live log is not a marker yet.
    }
  }
  return out;
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Split the composited frames into active segments at the idle gaps. */
function activeSegments(frames) {
  const uploaded = frames.filter((frame) => frame.uploaded === true);
  const segments = [];
  const boundaries = [];
  let start = 0;
  for (let index = 1; index <= uploaded.length; index += 1) {
    const gap = index < uploaded.length ? uploaded[index].atMs - uploaded[index - 1].atMs : null;
    if (gap !== null && gap > IDLE_GAP_MS) {
      boundaries.push({ atMs: uploaded[index].atMs, gapMs: gap });
      segments.push(uploaded.slice(start, index));
      start = index;
    }
  }
  segments.push(uploaded.slice(start));
  return { boundaries, uploaded, segments };
}

function gapsOf(times) {
  const gaps = [];
  for (let index = 1; index < times.length; index += 1) gaps.push(times[index] - times[index - 1]);
  return gaps;
}

/** Judge one active segment: are its uploads most of the frames, close enough together? */
function judgeSegment(segment, frames) {
  const spanStart = segment[0].atMs;
  const spanEnd = segment[segment.length - 1].atMs;
  const spanFrames = frames.filter((frame) => frame.atMs >= spanStart && frame.atMs <= spanEnd);
  const uploadGaps = gapsOf(segment.map((frame) => frame.atMs));
  const frameTime = median(gapsOf(spanFrames.map((frame) => frame.atMs)));
  const ratio = spanFrames.length === 0 ? 0 : segment.length / spanFrames.length;
  const p95Gap = percentile(uploadGaps, 0.95);
  const failures = [];
  if (ratio < 0.9) {
    failures.push(
      `only ${(ratio * 100).toFixed(1)}% of the game's ${spanFrames.length} composited frames carried a new page frame (${segment.length} uploads), under the 90% this gate requires`,
    );
  }
  if (p95Gap !== null && frameTime !== null && p95Gap > 2 * frameTime) {
    failures.push(
      `the p95 gap between new page frames is ${p95Gap.toFixed(1)} ms, over the ${(2 * frameTime).toFixed(1)} ms (2T) this gate allows`,
    );
  }
  return {
    failures: failures.map((failure) => `active segment at ${Math.round(spanStart)} ms: ${failure}`),
    summary: {
      atMs: spanStart,
      durationMs: spanEnd - spanStart,
      frameTimeMs: frameTime,
      frames: spanFrames.length,
      maxGapMs: uploadGaps.length === 0 ? null : Math.max(...uploadGaps),
      p95GapMs: p95Gap,
      ratio,
      uploads: segment.length,
    },
  };
}

/**
 * Judge the whole window: every long-enough active segment must meet the bounds, and there must be
 * at least two of them so the idle-and-resume is exercised rather than assumed.
 */
export function judgeCadence(frames) {
  const { boundaries, segments, uploaded } = activeSegments(frames);
  const failures = [];
  if (uploaded.length < MIN_SEGMENT_FRAMES) {
    failures.push(
      `only ${uploaded.length} uploaded frame(s) in the window: the page's pixels did not reach the game's frame enough to measure a rate`,
    );
    return { failures, resumes: boundaries, segments: [] };
  }

  const judged = [];
  for (const segment of segments) {
    if (segment.length < MIN_SEGMENT_FRAMES) continue;
    const verdict = judgeSegment(segment, frames);
    judged.push(verdict.summary);
    failures.push(...verdict.failures);
  }

  if (judged.length < 2) {
    failures.push(
      `only ${judged.length} active segment(s) of at least ${MIN_SEGMENT_FRAMES} frames were observed; the fixture's idle-and-resume could not be measured`,
    );
  }
  return { failures, resumes: boundaries, segments: judged };
}

function main() {
  const options = {
    bundle: undefined,
    executable: undefined,
    out: undefined,
    settleMs: 8000,
    timeoutMs: 120_000,
    ui: undefined,
    windowMs: 30_000,
    windowSize: "1280x720",
  };
  const argv = process.argv.slice(2);
  const numbers = { "--settle-ms": "settleMs", "--timeout-ms": "timeoutMs", "--window-ms": "windowMs" };
  const strings = { "--bundle": "bundle", "--executable": "executable", "--out": "out", "--ui": "ui", "--window-size": "windowSize" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${argument} needs a value.`);
    index += 1;
    if (numbers[argument] !== undefined) options[numbers[argument]] = Number(value);
    else if (strings[argument] !== undefined) options[strings[argument]] = value;
    else throw new Error(`unknown argument: ${argument}`);
  }
  options.out = resolve(
    options.out ?? join(runtimeRoot, "artifacts", `native-ui-cadence-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}`),
  );
  return options;
}

async function measure(options, display, artifactDirectory) {
  const binary = nativeBinary(options.executable);
  if (!existsSync(binary)) fail(`the native runtime binary is missing: ${binary} — run \`pnpm native:build\``, 2);
  const bundle = options.bundle ?? buildBundle();
  const uiRoot = options.ui ?? (await buildUiPage(join(artifactDirectory, "ui")));
  const logPath = join(artifactDirectory, "cadence-console.log");
  const log = spawn(
    "sh",
    ["-c", `exec "${binary}" run "${bundle}" --ui "${uiRoot}" --width 1280 --height 720 > "${logPath}" 2>&1`],
    {
      cwd: exampleRoot,
      detached: true,
      env: { ...process.env, DISPLAY: display, TN_UI_COMPOSITE_TRACE: "1" },
      stdio: "ignore",
    },
  );
  const readLog = () => (existsSync(logPath) ? readFileSync(logPath, "utf8") : "");
  try {
    await waitFor(
      () => {
        if (log.exitCode !== null) throw new Error(`the host exited with code ${log.exitCode} before first_playable`);
        return markersIn(readLog(), "TN_COLD_START:").some((marker) => marker.segment === "first_playable");
      },
      { timeoutMs: options.timeoutMs, what: "first_playable" },
    );
    await new Promise((done) => setTimeout(done, options.settleMs));
    await new Promise((done) => setTimeout(done, options.windowMs));
    return readLog();
  } finally {
    try {
      process.kill(-log.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
}

async function main_() {
  const options = main();
  mkdirSync(options.out, { recursive: true });
  const { compositor, display, xvfb } = await startDisplay(options.windowSize);
  if (compositor === undefined) {
    fail("no compositing manager is installed (xcompmgr, picom or compton); the runtime will not attach a UI overlay without one", 2);
  }
  let log;
  try {
    log = await measure(options, display, options.out);
  } finally {
    for (const process_ of [compositor, xvfb]) {
      try {
        process_.kill("SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }

  const overlay = markersIn(log, "TN_UI_OVERLAY:").at(-1);
  const frames = markersIn(log, "TN_UI_COMPOSITE_TRACE:");
  const verdict = judgeCadence(frames);
  const evidence = {
    assertions: {
      attached: overlay?.attached === true,
      frames: frames.length,
      segments: verdict.segments,
      resumes: verdict.resumes,
    },
    display,
    executable: nativeBinary(options.executable),
    pass: overlay?.attached === true && verdict.failures.length === 0,
    reasons: [
      ...(overlay?.attached === true ? [] : [`the page never attached: ${JSON.stringify(overlay ?? null)}`]),
      ...verdict.failures,
    ],
    windowMs: options.windowMs,
  };
  const recordPath = join(options.out, "native-ui-cadence.json");
  writeFileSync(recordPath, `${JSON.stringify(evidence, null, 2)}\n`);
  if (!evidence.pass) {
    fail(`native UI cadence gate failed (${options.out}):\n  - ${evidence.reasons.join("\n  - ")}`);
  }
  const worst = verdict.segments.reduce((low, segment) => Math.min(low, segment.ratio), 1);
  const slowest = verdict.segments.reduce((high, segment) => Math.max(high, segment.p95GapMs ?? 0), 0);
  process.stdout.write(
    `native UI cadence gate passed: ${verdict.segments.length} active segment(s), worst upload ratio ${(worst * 100).toFixed(1)}%, slowest p95 gap ${slowest.toFixed(1)} ms\n`,
  );
  process.stdout.write(`native UI cadence evidence: ${recordPath}\n`);
}

await main_();
