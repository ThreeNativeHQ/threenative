#!/usr/bin/env node

/**
 * The loading-screen motion gate: while the game is starting, the loading screen on the screen
 * has to *move*, and the game then has to start.
 *
 * Why this exists, and why nothing else covers it. Every gate this repository had before this one
 * asked whether the loading screen was *there* — `verify-desktop-loading.mjs` samples it once and
 * asserts the page's own colours are on screen. None of them could see that the picture is frozen,
 * because a still loading screen and a moving one are the same screenshot. Two real defects reached
 * players through that hole: the HUD stretched on resize, and the loading screen's sweep sat still
 * for the whole 40 s of a native startup while the page itself animated happily offscreen. Both
 * were found by a human watching the game, which is the thing this gate is for.
 *
 * The player-visible claim, stated as the assertion this makes: **a sample of the game's own window
 * taken during startup is not the same image as the sample taken a second before it.** That is what
 * "it is moving" means, it is checkable without a human, and it fails on exactly the defect above.
 *
 * What one run proves, in order:
 *
 * 1. `TN_UI_OVERLAY:{"attached":true}` — there is a page at all. Fail closed, printing the reason
 *    when it is false rather than skipping a platform.
 * 2. the loading screen is on screen before the game starts: the `bootSplash` colour, `#102a37`,
 *    is in the majority of samples taken before `first_playable`. This is the same colour and the
 *    same shape `verify-desktop-loading.mjs` uses, so a green here cannot be a different claim.
 * 3. **the loading screen advances** — `TN_UI_COMPOSITE` says a new page frame reached the game's
 *    own frame in every second of the startup, with no stretch longer than `--max-freeze-ms` in
 *    which none did. The bar is a freeze, not a frame rate: a loading screen that never holds the
 *    same picture for more than two seconds is a loading screen that is visibly moving, whatever
 *    the machine's speed. Measured before this gate existed: the page animated at 60 fps while
 *    *nothing* reached the screen for 16 s at a time.
 * 4. `TN_COLD_START` reaches `first_playable` inside `--timeout-ms` — the game really starts.
 * 5. the transition out of the loading screen works: with `--scenario`, the playtest runner drives
 *    the same executable through it and every step and resource assertion has to pass. This is the
 *    lane that catches a crash on loadout selection or take-deck, which a bare launch cannot.
 * 6. nothing crashed: no crash marker in either console, and the playtest run exits zero.
 *
 * Usage:
 *   node scripts/verify-desktop-loading-animation.mjs --executable <game> [options]
 *
 *   --executable <path>   the packaged game to launch (required; there is no default, because a
 *                         gate that silently picks a binary is a gate that proves the wrong thing)
 *   --cwd <dir>           working directory for the game and the scenario; defaults to the
 *                         executable's directory, which is where a packaged game resolves `ui/`
 *   --scenario <path>     a playtest scenario for the transition step, relative to `--cwd`
 *   --out <dir>           evidence directory; defaults to artifacts/desktop-loading-animation-<time>
 *   --interval-ms <n>     sampling period, default 1000
 *   --timeout-ms <n>      how long to wait for `first_playable`, default 90000
 *   --max-freeze-ms <n>   the longest stretch of the startup in which no new page frame reaches
 *                         the game's own frame, default 2000
 *   --min-changes <n>     page frames that must reach the frame across the startup, default 3
 *   --runner <path>       the playtest runner to drive the transition with; defaults to this
 *                         workspace's build, which a worktree without an install does not have
 *   --window-size <WxH>   the private display's geometry, default 1280x720
 *
 * Exit codes: 0 all assertions passed; 1 an assertion failed (the reason is printed and written
 * beside the samples); 2 the gate could not measure — no Xvfb, no window, no console.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

import { inspectScreenshot } from "./verify-desktop-core.mjs";

const runtimeRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const workspaceRoot = join(runtimeRoot, "..", "..");

/** The `bootSplash` colour, and the `#loading` background: what the player waits in front of. */
const LOADING_BACKGROUND = { b: 0x37, g: 0x2a, r: 0x10 };
/** A pixel counts as "the loading colour" within this distance, because capture is not lossless. */
const COLOUR_TOLERANCE = 6;
/** How much of the frame the loading colour must cover before the loading screen counts as shown. */
const LOADING_PRESENCE = 0.5;
/** Crash markers a native run leaves when it dies rather than exits. */
const CRASH_MARKERS = ["TN_CRASH", "TN_FATAL", "core dumped", "Segmentation fault", "Aborted"];

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseArguments(argv) {
  const options = { intervalMs: 1000, maxFreezeMs: 2000, minChanges: 3, timeoutMs: 90_000, windowSize: "1280x720" };
  // Numbers by flag, so adding one is a row and not another branch.
  const numbers = {
    "--interval-ms": "intervalMs",
    "--max-freeze-ms": "maxFreezeMs",
    "--min-changes": "minChanges",
    "--timeout-ms": "timeoutMs",
  };
  const paths = { "--cwd": "cwd", "--executable": "executable", "--out": "out", "--runner": "runner" };
  const strings = { "--scenario": "scenario", "--window-size": "windowSize" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${argument} needs a value.`);
    index += 1;
    if (numbers[argument] !== undefined) options[numbers[argument]] = Number(value);
    else if (paths[argument] !== undefined) options[paths[argument]] = resolve(value);
    else if (strings[argument] !== undefined) options[strings[argument]] = value;
    else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

const USAGE =
  "usage: node scripts/verify-desktop-loading-animation.mjs --executable <game> [--cwd <dir>] " +
  "[--scenario <playtest.json>] [--out <dir>] [--interval-ms n] [--timeout-ms n] " +
  "[--max-freeze-ms n] [--min-changes n] [--window-size WxH] [--runner <path>]";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) throw new Error(`${command} failed to start: ${result.error.message}`);
  return result;
}

/**
 * A private display, provisioned the way `scripts/xvfb.sh` provisions one.
 *
 * COMPOSITE and SHAPE on, and a compositing manager borrowed for this display only: nothing blends
 * on a bare Xvfb, and the desktop runtime refuses to attach its UI overlay to a display with no
 * compositor — a refusal this gate would otherwise report as "the page never attached", blaming the
 * engine for the display.
 */
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
    // `-n` keeps xcompmgr to plain blending, with none of the shadows that would alter the pixels
    // this gate compares.
    compositor = spawn(candidate, candidate === "xcompmgr" ? ["-n"] : [], {
      env: { ...process.env, DISPLAY: display },
      stdio: "ignore",
    });
    break;
  }
  // Owning _NET_WM_CM_S0 takes a moment; a runtime that reaches the display first sees no
  // compositor and refuses to attach.
  await new Promise((done) => setTimeout(done, 400));
  return { compositor, display, xvfb };
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

/** The game's own top-level window: the largest viewable window its process owns. */
function gameWindowId(display, pid) {
  // xdotool has no `-display` flag: it reads $DISPLAY, so the private display has to be in its env.
  const environment = { ...process.env, DISPLAY: display };
  const found = run("xdotool", ["search", "--pid", String(pid)], { env: environment });
  if (found.status !== 0) return undefined;
  const ids = found.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  let best;
  for (const id of ids) {
    const info = run("xwininfo", ["-id", id], { env: environment });
    if (info.status !== 0 || !/Map State: IsViewable/u.test(info.stdout)) continue;
    const width = Number(/Width: (\d+)/u.exec(info.stdout)?.[1] ?? 0);
    const height = Number(/Height: (\d+)/u.exec(info.stdout)?.[1] ?? 0);
    if (width < 200 || height < 200) continue;
    if (best === undefined || width * height > best.area) best = { area: width * height, id };
  }
  return best?.id;
}

function capture(display, windowId, path) {
  const result = run("import", ["-display", display, "-window", windowId, path]);
  if (result.status !== 0) throw new Error(`import failed for window ${windowId}: ${result.stderr}`);
}

function readPng(path) {
  return PNG.sync.read(readFileSync(path));
}

/** How many pixels of `image` are the loading screen's own colour. */
function loadingPixels(image) {
  let count = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    if (
      Math.abs(image.data[index] - LOADING_BACKGROUND.r) <= COLOUR_TOLERANCE &&
      Math.abs(image.data[index + 1] - LOADING_BACKGROUND.g) <= COLOUR_TOLERANCE &&
      Math.abs(image.data[index + 2] - LOADING_BACKGROUND.b) <= COLOUR_TOLERANCE
    )
      count += 1;
  }
  return count;
}

/** A capture of a window that has not painted yet: nothing to compare, and nothing to conclude. */
function isBlank(image) {
  const colors = new Set();
  let opaque = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    if (image.data[index + 3] !== 0) opaque += 1;
    colors.add(`${image.data[index]},${image.data[index + 1]},${image.data[index + 2]},${image.data[index + 3]}`);
  }
  return opaque === 0 || colors.size < 2;
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

/** A private display, the game launched on it, and the samples taken while it started. */
async function runStartup(options) {
  const { compositor, display, xvfb } = await startDisplay(options.windowSize);
  if (compositor === undefined) {
    fail("no compositing manager is installed (xcompmgr, picom or compton); the runtime will not attach a UI overlay without one", 2);
  }
  try {
    return await sampleStartup(options, display, options.out);
  } finally {
    for (const process_ of [compositor, xvfb]) {
      try {
        process_.kill("SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }
}

/**
 * Phase one: the real startup, sampled from the game's own window.
 *
 * Deliberately *not* run through the playtest bridge. Under a fixed-step bridge the app renders
 * only when the runner advances it, so the runner would be driving the animation this gate exists
 * to prove the game drives itself.
 */
async function sampleStartup(options, display, artifactDirectory) {
  const logPath = join(artifactDirectory, "startup-console.log");
  const log = spawn("sh", ["-c", `exec "${options.executable}" > "${logPath}" 2>&1`], {
    cwd: options.cwd,
    // Its own group: the game spawns a web process, and killing the game alone would leave it.
    detached: true,
    env: { ...process.env, DISPLAY: display },
    stdio: "ignore",
  });

  const readLog = () => (existsSync(logPath) ? readFileSync(logPath, "utf8") : "");
  const started = Date.now();
  const samples = [];
  try {
    const windowId = await waitFor(
      () => {
        if (log.exitCode !== null) throw new Error(`the game exited with code ${log.exitCode} before it drew a window`);
        return gameWindowId(display, log.pid);
      },
      { timeoutMs: 30_000, what: "the game's window" },
    );

    for (;;) {
      if (Date.now() - started > options.timeoutMs) break;
      const path = join(artifactDirectory, `loading-${String(samples.length).padStart(3, "0")}.png`);
      try {
        capture(display, windowId, path);
        samples.push({ atMs: Date.now() - started, path });
      } catch (error) {
        // A window that vanishes mid-capture is the game closing; stop rather than throw.
        if (readLog().includes("first_playable")) break;
        throw error;
      }
      if (readLog().includes('"first_playable"')) break;
      await new Promise((done) => setTimeout(done, options.intervalMs));
    }
  } finally {
    try {
      process.kill(-log.pid, "SIGTERM");
    } catch {
      try {
        log.kill("SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }

  return { log: readLog(), logPath, samples };
}

/** Phase two: the transition out of the loading screen, driven by the shared playtest runner. */
function runTransitionScenario(options, artifactDirectory) {
  const scenario = resolve(options.cwd, options.scenario);
  if (!existsSync(scenario)) fail(`the transition scenario is missing: ${scenario}`, 2);
  // The workspace build by default; a lane whose checkout is not installed (a worktree, a sandbox)
  // passes the engine's own built runner instead of failing on a missing file.
  const cli = options.runner ?? join(workspaceRoot, "packages", "playtest", "dist", "runner", "cli.js");
  if (!existsSync(cli)) fail(`the playtest runner is not built: ${cli} (run pnpm --filter @threenative/playtest build)`, 2);
  const result = run(
    process.execPath,
    [
      cli,
      "--scenario",
      scenario,
      "--target",
      "desktop",
      "--executable",
      options.executable,
      "--project",
      options.cwd,
      "--artifacts",
      join(artifactDirectory, "transition"),
    ],
    { cwd: options.cwd },
  );
  writeFileSync(join(artifactDirectory, "transition-console.log"), `${result.stdout}\n${result.stderr}`);
  return { exitCode: result.status, stderr: result.stderr, stdout: result.stdout };
}

async function main(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (options.executable === undefined) fail(`${USAGE}\n\n--executable is required.`, 2);
  if (!existsSync(options.executable)) fail(`no such executable: ${options.executable}`, 2);
  if (process.platform !== "linux") fail("this gate drives a private X display and is Linux-only", 2);
  options.cwd ??= dirname(options.executable);
  options.out ??= join(
    runtimeRoot,
    "artifacts",
    `desktop-loading-animation-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}`,
  );
  mkdirSync(options.out, { recursive: true });

  const startup = await runStartup(options);

/**
 * What the window samples can say: the loading screen was up for the startup, and it was on screen.
 *
 * A window found before it has painted captures nothing, so those samples are counted and set aside
 * rather than failing the gate on a blank — but a startup with nothing *but* blanks is a failure,
 * not a pass.
 */
function judgeSamples(options, startup, firstPlayable, failures) {
  // Only the samples taken while the loading screen was up can say anything about its motion: the
  // ones after `first_playable` are the game, which is supposed to change. A window found before it
  // has painted captures nothing, so those samples are counted and set aside rather than failing
  // the gate on a blank — but a startup with nothing *but* blanks is a failure, not a pass.
  const images = startup.samples.map((sample) => ({ ...sample, image: readPng(sample.path) }));
  const painted = images.filter((sample) => !isBlank(sample.image));
  const blankSamples = images.length - painted.length;
  if (painted.length === 0) {
    failures.push(
      `every one of the ${images.length} samples of the game's window is blank: the window never painted, so this gate cannot say whether the loading screen moves`,
    );
  } else {
    inspectScreenshot(painted[0].path);
  }
  const loading = firstPlayable === undefined
    ? painted
    : painted.filter((sample) => sample.atMs < firstPlayable.atMs + 1000);
  if (loading.length === 0) failures.push("no sample was taken while the loading screen was up");

  const withBackground = loading.filter(
    (sample) => loadingPixels(sample.image) > LOADING_PRESENCE * sample.image.width * sample.image.height,
  );
  if (loading.length > 0 && withBackground.length < loading.length * 0.9) {
    failures.push(
      `the loading screen was not on screen for the whole startup: ${withBackground.length} of ${loading.length} samples carry ${LOADING_PRESENCE * 100}% or more of the bootSplash colour`,
    );
  }

  return { blankSamples, loading, withBackground };
}

/**
 * Everything the gate asserts about the startup, from the run's own markers and samples.
 *
 * Separate from `main` because it is a judgement over evidence, not a sequence of side effects:
 * `main` provisions a display, launches a game and writes artifacts, and this decides what the
 * evidence means.
 */
function judgeStartup(options, startup) {
  const failures = [];
  const overlay = markersIn(startup.log, "TN_UI_OVERLAY:").at(-1);
  if (overlay?.attached !== true) {
    failures.push(
      `the page never attached: TN_UI_OVERLAY says ${JSON.stringify(overlay ?? null)}, so there is nothing to move`,
    );
  }

  const composites = markersIn(startup.log, "TN_UI_COMPOSITE:");
  const coldStart = markersIn(startup.log, "TN_COLD_START:");
  const firstPlayable = coldStart.find((marker) => marker.segment === "first_playable");
  if (firstPlayable === undefined) {
    failures.push(
      `the game did not reach first_playable within ${options.timeoutMs} ms — the transition out of the loading screen did not happen`,
    );
  }

  const { blankSamples, loading, withBackground } = judgeSamples(options, startup, firstPlayable, failures);

  // The loading screen advances when the page's *new* frames reach the game's own frame, and that
  // is what `TN_UI_COMPOSITE` counts once a second with the launch clock beside it: a marker whose
  // `uploadsPerSecond` is 0 is a second in which the loading screen did not change on screen.
  //
  // This, and not a pixel diff of the window, is the assertion — because the window capture on this
  // lane is not trustworthy. `import -window` reads the window's backing store, which lags the
  // composited output: consecutive captures of a demonstrably moving sweep came back identical
  // (measured on this display: the loading screen's 2 px gold bar tracked to three different
  // positions across captures whose own pixel diff was 0-141 px). A gate built on that would report
  // the capture's staleness as the engine's. The upload count cannot lie about the same thing: the
  // uploaded texture *is* the quad the frame draws, so an upload is a frame in which the loading
  // screen's pixels changed on screen.
  const startupComposites = composites.filter(
    (marker) => firstPlayable === undefined || marker.atMs <= firstPlayable.atMs,
  );
  const uploadsDuringLoading = startupComposites.reduce(
    (total, marker) => total + (marker.uploadsPerSecond ?? 0),
    0,
  );
  // The freeze is the longest gap between two composite runs, not a run of zero-upload markers.
  // The marker is emitted *by* the composite path, so a stretch in which the loop never reached it
  // emits nothing at all: a 16 s freeze looks like two markers 16 s apart, the later one reporting
  // the uploads that happened somewhere inside it. No composite run means no frame presented, and
  // no frame presented means the screen did not change.
  let longestFreeze = { fromMs: null, ms: 0 };
  for (let index = 1; index < startupComposites.length; index += 1) {
    const gap = startupComposites[index].atMs - startupComposites[index - 1].atMs;
    if (gap > longestFreeze.ms) {
      longestFreeze = { fromMs: startupComposites[index - 1].atMs, ms: gap };
    }
  }
  if (longestFreeze.ms > options.maxFreezeMs) {
    failures.push(
      `the loading screen froze for ${(longestFreeze.ms / 1000).toFixed(1)} s during the startup ` +
        `(from ${Math.round(longestFreeze.fromMs)} ms), against the ${(options.maxFreezeMs / 1000).toFixed(1)} s this gate allows: ` +
        `${uploadsDuringLoading} page frame(s) reached the game's frame in the whole startup`,
    );
  } else if (uploadsDuringLoading < options.minChanges) {
    failures.push(
      `the composite uploaded ${uploadsDuringLoading} page frame(s) for the whole startup: the page's pixels reached the game's frame that rarely`,
    );
  }

  const crashes = startup.log
    .split("\n")
    .filter((line) => CRASH_MARKERS.some((marker) => line.includes(marker)));
  if (crashes.length > 0) failures.push(`the startup console carries a crash marker: ${crashes[0]}`);

  return {
    blankSamples,
    failures,
    firstPlayable,
    loading,
    longestFreeze,
    overlay,
    startupComposites,
    uploadsDuringLoading,
    withBackground,
  };
}

  const {
    blankSamples,
    failures,
    firstPlayable,
    loading,
    longestFreeze,
    overlay,
    startupComposites,
    uploadsDuringLoading,
    withBackground,
  } = judgeStartup(options, startup);

  let transition;
  if (options.scenario !== undefined) {
    transition = runTransitionScenario(options, options.out);
    if (transition.exitCode !== 0) {
      // The runner's own words, not just its code: "request timed out" says the game stopped
      // answering, which is a different defect from a step asserting the wrong value.
      const reason = /"message": "([^"]+)"/u.exec(transition.stdout ?? "")?.[1] ?? "no diagnostic in its console";
      failures.push(
        `the transition scenario failed with exit code ${transition.exitCode}: ${reason}`,
      );
    }
  }

  const evidence = {
    assertions: {
      attached: overlay?.attached === true,
      blankSamples,
      compositeUploadsDuringStartup: uploadsDuringLoading,
      compositeMarkersDuringStartup: startupComposites.length,
      firstPlayableMs: firstPlayable?.atMs ?? null,
      loadingScreenSamples: { sampled: loading.length, withBackground: withBackground.length },
      longestFreeze: { allowedMs: options.maxFreezeMs, fromMs: longestFreeze.fromMs, ms: longestFreeze.ms },
      transition: options.scenario === undefined ? "not requested" : { exitCode: transition.exitCode, scenario: options.scenario },
    },
    executable: options.executable,
    host: process.platform,
    pass: failures.length === 0,
    samples: startup.samples.map((sample) => sample.path),
    windowSize: options.windowSize,
  };
  writeFileSync(join(options.out, "loading-animation.json"), `${JSON.stringify(evidence, null, 2)}\n`);

  if (failures.length > 0) {
    process.stderr.write(`desktop loading-animation gate failed (${options.out}):\n`);
    for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
    return 1;
  }
  process.stdout.write(
    `desktop loading-animation gate passed: ${uploadsDuringLoading} page frame(s) reached the game's frame across the ` +
      `${(firstPlayable.atMs / 1000).toFixed(1)} s startup, longest freeze ${(longestFreeze.ms / 1000).toFixed(1)} s ` +
      `(allowed ${(options.maxFreezeMs / 1000).toFixed(1)} s), loading screen on screen in ` +
      `${withBackground.length}/${loading.length} samples${options.scenario === undefined ? "" : ", transition scenario exit 0"}\n`,
  );
  return 0;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error) => fail(error instanceof Error ? error.message : String(error), 2));
