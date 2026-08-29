#!/usr/bin/env node

/**
 * Launch inspector — what the player sees between tapping the icon and playing.
 *
 * `measure-cold-start.mjs` answers how long the launch takes. This answers what it looks like,
 * which is the half no timing number can see: a one-frame flash of the wrong colour, scene
 * geometry leaking through the loading backdrop, or a progress bar laid out for the wrong
 * orientation are all invisible to a stopwatch and to `pnpm test`.
 *
 * It records at display frame rate rather than sampling. `adb exec-out screencap` costs roughly
 * 200 ms a shot, so a defect that lasts one frame at 120 Hz — 8 ms — is missed by it about
 * twenty-four times out of twenty-five. Every frame of the recording is classified instead.
 *
 * Fail-closed, all of it:
 *
 *   - no frames extracted is a failure, never a clean report
 *   - a launch that never reaches the loading screen is a failure naming that
 *   - an unreadable palette argument is rejected before the device is touched
 *   - anomaly frames are written to disk, because a count nobody can look at is not evidence
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { createResolvedAdbClient } from "./lib/adb.mjs";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export class InspectError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "InspectError";
    this.exitCode = exitCode;
  }
}

/** The generated loading screen's palette. Override when a game recolours its own screen. */
export const DEFAULT_PALETTE = {
  backdrop: "#0d1b2a",
  track: "#274060",
  progress: "#8fd694",
};

export function parseColor(value, label) {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/iu.test(value)) {
    throw new InspectError(`TN_INSPECT_COLOR_INVALID:${label}=${String(value)}`, 2);
  }
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

const near = (r, g, b, [R, G, B], tolerance) =>
  Math.abs(r - R) <= tolerance && Math.abs(g - G) <= tolerance && Math.abs(b - B) <= tolerance;

/**
 * The bars `screenrecord` adds, found and removed before anything is judged.
 *
 * `screenrecord` captures the display in its natural orientation, so a landscape app on a portrait
 * phone arrives as a band inside a portrait video with black above and below. Measuring that
 * directly reports a loading screen covering 20% of the screen and a game that is letterboxed,
 * and both conclusions are about the recorder rather than the game — a mistake this harness made
 * before it did this.
 *
 * Only rows and columns that are black in *every* frame are treated as bars, so a game that is
 * legitimately dark in one frame keeps its pixels.
 */
export function findContentBox(allFrames) {
  if (allFrames.length === 0) throw new InspectError("TN_INSPECT_NO_FRAMES", 2);
  // Only the frames the app owns. The launcher fills the whole portrait screen before the game
  // takes over, and including it makes every row look lit, which finds no bars at all.
  const frames = allFrames.slice(Math.floor(allFrames.length / 2));
  const { width, height } = frames[0];
  const rowLit = new Uint8Array(height);
  const colLit = new Uint8Array(width);
  for (const png of frames) {
    if (png.width !== width || png.height !== height) {
      throw new InspectError("TN_INSPECT_FRAME_SIZE_CHANGED", 1);
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        if (png.data[i] > 12 || png.data[i + 1] > 12 || png.data[i + 2] > 12) {
          rowLit[y] = 1;
          colLit[x] = 1;
        }
      }
    }
  }
  const firstRow = rowLit.indexOf(1);
  const firstCol = colLit.indexOf(1);
  if (firstRow === -1 || firstCol === -1) throw new InspectError("TN_INSPECT_ALL_FRAMES_BLACK", 1);
  let lastRow = height - 1;
  while (lastRow > firstRow && rowLit[lastRow] === 0) lastRow -= 1;
  let lastCol = width - 1;
  while (lastCol > firstCol && colLit[lastCol] === 0) lastCol -= 1;
  return { x: firstCol, y: firstRow, width: lastCol - firstCol + 1, height: lastRow - firstRow + 1 };
}

/**
 * One frame, reduced to the fractions that distinguish the launch phases.
 *
 * `foreign` is the important one: anything that is neither the loading palette nor near-black
 * while the backdrop is on screen is either the world showing through or a rendering fault.
 */
export function classifyFrame(png, palette, tolerance = 14, box) {
  const region = box ?? { x: 0, y: 0, width: png.width, height: png.height };
  const total = region.width * region.height;
  let backdrop = 0;
  let track = 0;
  let progress = 0;
  let dark = 0;
  let foreign = 0;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
    const i = (y * png.width + x) * 4;
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    if (near(r, g, b, palette.backdrop, tolerance)) backdrop += 1;
    else if (near(r, g, b, palette.track, tolerance)) track += 1;
    else if (near(r, g, b, palette.progress, tolerance + 8)) progress += 1;
    else if (r < 16 && g < 16 && b < 16) dark += 1;
    else foreign += 1;
    }
  }
  // A coarse grid of the frame, kept so consecutive frames can be compared. Thresholds cannot
  // tell a small leak from a status bar, but a leak is a *change* against the frame before it and
  // the loading screen is otherwise still except for the bar.
  const cols = 48;
  const rows = 96;
  const grid = new Float32Array(cols * rows);
  const counts = new Uint32Array(cols * rows);
  for (let y = region.y; y < region.y + region.height; y += 1) {
    const cell = Math.min(rows - 1, Math.floor(((y - region.y) / region.height) * rows)) * cols;
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const i = (y * png.width + x) * 4;
      const at = cell + Math.min(cols - 1, Math.floor(((x - region.x) / region.width) * cols));
      grid[at] += (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
      counts[at] += 1;
    }
  }
  for (let cell = 0; cell < grid.length; cell += 1) grid[cell] /= counts[cell] || 1;

  return {
    grid,
    gridCols: cols,
    gridRows: rows,
    width: region.width,
    height: region.height,
    backdrop: backdrop / total,
    track: track / total,
    progress: progress / total,
    dark: dark / total,
    foreign: foreign / total,
  };
}

/**
 * The launch, as phases.
 *
 * The loading screen is any frame the backdrop dominates. Everything before the first such frame
 * is the launcher and the splash; everything after the last is the game.
 */
export function summarise(frames) {
  if (frames.length === 0) throw new InspectError("TN_INSPECT_NO_FRAMES", 2);
  const loadingIndexes = frames
    .map((frame, index) => ({ frame, index }))
    .filter(({ frame }) => frame.backdrop > 0.5)
    .map(({ index }) => index);
  if (loadingIndexes.length === 0) throw new InspectError("TN_INSPECT_NO_LOADING_SCREEN", 1);
  const first = loadingIndexes[0];
  const last = loadingIndexes[loadingIndexes.length - 1];

  // The reveal is the defect's home, and it is one frame wide, so the window has to include the
  // frames on either side of the screen coming down. Ending at the last backdrop-dominant frame
  // missed it entirely: the leak *is* the frame where the backdrop stopped dominating.
  const from = Math.max(0, first - 2);
  const to = Math.min(frames.length - 1, last + 6);

  // A phone draws its own status bar and notifications over the game, which is foreign content
  // that is not a defect. Those cover a few percent; scene geometry breaking through covers much
  // more. The threshold sits above the one and far below the other, and the frames are kept so
  // the claim can be checked by eye rather than trusted.
  const leak = 0.05;
  const leaks = [];
  for (let index = from; index <= to; index += 1) {
    const frame = frames[index];
    if (frame.backdrop > 0.2 && frame.foreign > leak) {
      leaks.push({ index, foreign: frame.foreign, backdrop: frame.backdrop, kind: "area" });
    }
  }

  // While the screen is up the picture is still but for the bar, so any cell that changes by more
  // than a shade is something appearing that should not. This is what finds a leak too small for
  // any area threshold to separate from a status bar.
  for (let index = first + 1; index <= last; index += 1) {
    const previous = frames[index - 1];
    const frame = frames[index];
    if (previous?.grid === undefined || frame.grid === undefined) continue;
    let changed = 0;
    let worst = 0;
    for (let cell = 0; cell < frame.grid.length; cell += 1) {
      // The bar lives in a band across the middle; ignore the rows it occupies so filling it is
      // not reported as a leak.
      const row = Math.floor(cell / frame.gridCols) / frame.gridRows;
      if (row > 0.44 && row < 0.56) continue;
      const delta = Math.abs(frame.grid[cell] - previous.grid[cell]);
      if (delta > 12) changed += 1;
      if (delta > worst) worst = delta;
    }
    if (changed > 4) {
      leaks.push({ index, changedCells: changed, worstDelta: Math.round(worst), kind: "flicker" });
    }
  }

  const progressWash = frames
    .map((frame, index) => ({ index, progress: frame.progress }))
    .filter(({ progress }) => progress > 0.2);

  return {
    frames: frames.length,
    resolution: `${frames[0].width}x${frames[0].height}`,
    orientation: frames[0].width >= frames[0].height ? "landscape" : "portrait",
    loadingFirstFrame: first,
    loadingLastFrame: last,
    loadingFrames: last - first + 1,
    revealWindow: { from, to },
    maxProgressArea: frames.reduce((worst, frame) => Math.max(worst, frame.progress), 0),
    // Reported always, so a run that finds nothing still says how close it came.
    worstForeignInReveal: frames
      .slice(from, to + 1)
      .reduce((worst, frame) => Math.max(worst, frame.foreign), 0),
    leaks,
    progressWash,
  };
}

/**
 * Check the handoff as an ordered sequence, rather than trusting one screenshot from each phase.
 * Callers may provide an explicit phase (used by device bridges) or the pixel-classified fields
 * returned by classifyFrame. Every frame must be platform splash, live loading, or playable game;
 * no generic/default frame is accepted between those states.
 */
export function assertLaunchFrameSequence(frames) {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new InspectError("TN_LAUNCH_SEQUENCE_NO_FRAMES", 1);
  }
  const phaseNames = new Set(["platform-splash", "loading", "playable"]);
  let firstLoading = -1;
  let lastLoading = -1;
  let previousRank = 0;
  const phases = frames.map((frame, index) => {
    if (frame === null || typeof frame !== "object") {
      throw new InspectError(`TN_LAUNCH_SEQUENCE_INVALID_FRAME:index=${index}`, 1);
    }
    const brand = String(frame.brand ?? "").toLowerCase();
    if (
      frame.offBrand === true ||
      frame.foreign === true ||
      brand === "default" ||
      brand === "generic" ||
      brand === "magenta"
    ) {
      throw new InspectError(`TN_LAUNCH_SEQUENCE_OFF_BRAND:index=${index}`, 1);
    }
    let phase = frame.phase;
    if (phase === undefined) {
      phase = frame.backdrop > 0.5 ? "loading" : firstLoading < 0 ? "platform-splash" : "playable";
    }
    if (!phaseNames.has(phase)) {
      throw new InspectError(
        `TN_LAUNCH_SEQUENCE_PHASE_INVALID:index=${index}:${String(phase)}`,
        1,
      );
    }
    const rank = phase === "platform-splash" ? 0 : phase === "loading" ? 1 : 2;
    if (rank < previousRank) {
      throw new InspectError(`TN_LAUNCH_SEQUENCE_ORDER:index=${index}:phase=${phase}`, 1);
    }
    previousRank = rank;
    if (phase === "loading") {
      if (firstLoading === -1) firstLoading = index;
      lastLoading = index;
    }
    return phase;
  });
  if (firstLoading === -1) throw new InspectError("TN_LAUNCH_SEQUENCE_NO_LOADING", 1);
  if (lastLoading === phases.length - 1) {
    throw new InspectError("TN_LAUNCH_SEQUENCE_NO_PLAYABLE", 1);
  }
  return {
    firstLoading,
    lastLoading,
    phases,
  };
}

export function createInspectDevice(serial, environment = process.env, dependencies = {}) {
  return createResolvedAdbClient(serial, environment, {
    allowPathFallback: false,
    defaultSdkRoot: dependencies.defaultSdkRoot,
    existsSyncImpl: dependencies.existsSyncImpl,
    mapSpawnError: (error) => new InspectError(`TN_INSPECT_ADB_FAILED:${error.message}`),
    maxBuffer: 256 * 1024 * 1024,
    missingError: () => new InspectError("TN_INSPECT_ADB_MISSING", 2),
    sdkEnvironmentKeys: ["THREENATIVE_ANDROID_SDK"],
    spawnSyncImpl: dependencies.spawnSyncImpl,
    timeoutMs: 180_000,
  });
}

export function record(serial, target, outDir, seconds, dependencies = {}) {
  const device = dependencies.device ?? createInspectDevice(serial);
  const pkg = target.split("/")[0];
  mkdirSync(outDir, { recursive: true });
  for (const stale of readdirSync(outDir).filter((name) => name.startsWith("frame-"))) {
    rmSync(join(outDir, stale), { force: true });
  }
  device.command(["shell", "am", "force-stop", pkg]);
  device.command(["shell", "rm", "-f", "/sdcard/tn-launch.mp4"]);

  const recorder = device.result(
    [
      "shell",
      `screenrecord --time-limit ${seconds} --bit-rate 20000000 /sdcard/tn-launch.mp4 & sleep 1; am start -n ${target} >/dev/null; wait`,
    ],
    (seconds + 30) * 1000,
  );
  if (recorder.error) throw new InspectError(`TN_INSPECT_RECORD_FAILED:${recorder.error.message}`);

  const video = join(outDir, "launch.mp4");
  device.command(["pull", "/sdcard/tn-launch.mp4", video]);
  device.command(["shell", "am", "force-stop", pkg]);
  if (!existsSync(video)) throw new InspectError("TN_INSPECT_RECORDING_MISSING", 1);

  try {
    (dependencies.execFileSync ?? execFileSync)("ffmpeg", ["-loglevel", "error", "-i", video, "-vsync", "0", join(outDir, "frame-%04d.png")]);
  } catch (error) {
    throw new InspectError(`TN_INSPECT_FFMPEG_FAILED:${error instanceof Error ? error.message : String(error)}`, 2);
  }
  rmSync(video, { force: true });
  return readdirSync(outDir)
    .filter((name) => name.startsWith("frame-") && name.endsWith(".png"))
    .sort();
}

export function parseArgs(argv) {
  const options = {
    device: undefined,
    package: "com.threenative.game",
    activity: "com.threenative.runtime.MystralActivity",
    seconds: 8,
    out: join(runtimeRoot, ".runtime/launch-inspection"),
    palette: { ...DEFAULT_PALETTE },
    keepFrames: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new InspectError(`TN_INSPECT_ARG_MISSING:${arg}`, 2);
      index += 1;
      return value;
    };
    if (arg === "--device") options.device = next();
    else if (arg === "--package") options.package = next();
    else if (arg === "--activity") options.activity = next();
    else if (arg === "--seconds") options.seconds = Number(next());
    else if (arg === "--out") options.out = next();
    else if (arg === "--backdrop") options.palette.backdrop = next();
    else if (arg === "--track") options.palette.track = next();
    else if (arg === "--progress") options.palette.progress = next();
    else if (arg === "--keep-frames") options.keepFrames = true;
    else throw new InspectError(`TN_INSPECT_ARG_UNKNOWN:${arg}`, 2);
  }
  if (options.device === undefined) throw new InspectError("TN_INSPECT_DEVICE_REQUIRED", 2);
  if (!Number.isFinite(options.seconds) || options.seconds < 3) {
    throw new InspectError("TN_INSPECT_SECONDS_INVALID", 2);
  }
  return options;
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const palette = {
    backdrop: parseColor(options.palette.backdrop, "backdrop"),
    track: parseColor(options.palette.track, "track"),
    progress: parseColor(options.palette.progress, "progress"),
  };
  const target = `${options.package}/${options.activity}`;
  const files = record(options.device, target, options.out, options.seconds);
  if (files.length === 0) throw new InspectError("TN_INSPECT_NO_FRAMES", 2);

  const images = files.map((name) => PNG.sync.read(readFileSync(join(options.out, name))));
  const box = findContentBox(images);
  const frames = images.map((png) => classifyFrame(png, palette, 14, box));
  const report = summarise(frames);
  const sequence = assertLaunchFrameSequence(
    frames.map((frame, index) => ({
      ...frame,
      phase:
        index < report.loadingFirstFrame
          ? "platform-splash"
          : index <= report.loadingLastFrame
            ? "loading"
            : "playable",
    })),
  );

  console.log(`launch inspection — ${options.device}, ${target}`);
  console.log(
    `  launch sequence: ${sequence.phases.join(" → ")}`,
  );
  console.log(`  ${report.frames} frames, ${report.resolution} (${report.orientation})`);
  console.log(`  recorder letterbox cropped: ${box.width}x${box.height} at ${box.x},${box.y}`);
  console.log(`  loading screen: frames ${report.loadingFirstFrame}–${report.loadingLastFrame} (${report.loadingFrames})`);
  console.log(`  largest progress-colour area in any frame: ${percent(report.maxProgressArea)}`);
  console.log(
    `  reveal window: frames ${report.revealWindow.from}-${report.revealWindow.to}, worst foreign ${percent(report.worstForeignInReveal)}`,
  );

  // Keep the frames that prove a finding; drop the rest so a run does not leave 200 PNGs behind.
  const keep = new Set(report.leaks.map((leak) => leak.index).concat(report.progressWash.map((w) => w.index)));
  if (!options.keepFrames) {
    files.forEach((name, index) => {
      if (!keep.has(index)) rmSync(join(options.out, name), { force: true });
    });
  }

  if (report.progressWash.length > 0) {
    console.log(`  ✗ ${report.progressWash.length} frame(s) washed by the progress colour — the bar is not sized`);
    for (const wash of report.progressWash.slice(0, 5)) {
      console.log(`      ${files[wash.index]} ${percent(wash.progress)}`);
    }
  }
  if (report.leaks.length > 0) {
    console.log(`  ✗ ${report.leaks.length} frame(s) leak content through the loading screen`);
    for (const leak of report.leaks.slice(0, 8)) {
      console.log(`      ${files[leak.index]} foreign=${percent(leak.foreign)} backdrop=${percent(leak.backdrop)}`);
    }
  }
  if (report.leaks.length === 0 && report.progressWash.length === 0) {
    console.log("  ✓ loading screen stayed opaque and the bar stayed inside the viewport");
  }

  writeFileSync(
    join(options.out, "report.json"),
    `${JSON.stringify({ target, device: options.device, ...report, files }, undefined, 2)}\n`,
  );
  console.log(`  report: ${join(options.out, "report.json")}`);
  return report.leaks.length === 0 && report.progressWash.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof InspectError ? error.message : error);
      process.exit(error instanceof InspectError ? error.exitCode : 1);
    });
}
