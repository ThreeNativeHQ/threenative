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
 *   --lane cadence|state-age|pointer|react
 *                             `cadence` (default) measures how often a page that changes on its own
 *                             reaches the screen; `react` measures the same thing on a page whose
 *                             animation is React's own state rather than CSS; `state-age` measures
 *                             how long a state the game published takes to become a visible page
 *                             frame; `pointer` drives `POINTER_ACTIONS` real X clicks at the game's
 *                             window and measures how long each one takes to become the response the
 *                             player is owed
 *   --launch bundle|packaged
 *                             `bundle` (default) runs this repository's host against the
 *                             `examples/native-smoke` fixture; `packaged` runs a game's own packaged
 *                             executable, which brings its own bundle and page
 *   --cwd <dir>          working directory for the launched process, default the fixture example
 *   --out <dir>          evidence directory; default artifacts/native-ui-cadence-<time>
 *   --settle-ms <n>      steady-state wait after first_playable, default 8000
 *   --window-ms <n>      measurement window, default 30000
 *   --timeout-ms <n>     how long to wait for first_playable, default 120000
 *   --window-size <WxH>  the private display's geometry, default 1280x720
 *   --bundle <path>      prebuilt game bundle; default builds examples/native-smoke
 *   --ui <dir>           prebuilt UI page; default builds examples/native-smoke/ui
 *
 * The `state-age` lane judges the whole measured window rather than active segments: its page is
 * driven only by the bridge, so there is no burst to segment. Both lanes read the region
 * `first_playable + settle` for `windowMs`, and the record carries the bounds, because the startup
 * inside the same log is a different defect with its own PRD.
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
/** The React page the `react` lane bundles instead: React's own commit path, not CSS. */
const reactUiEntry = join(exampleRoot, "ui", "react.tsx");

/** The page's own burst: 10 s active, 1 s idle (`examples/native-smoke/ui/main.ts`). */
/** A gap between uploaded frames longer than this is the idle, not a slow frame. */
const IDLE_GAP_MS = 400;
/** The page's own frame time at 60 Hz; a segment shorter than this says nothing about a rate. */
const MIN_SEGMENT_FRAMES = 120;

/** The pointer lane: how many native actions, how far apart, and the pause before the last group. */
const POINTER_ACTIONS = 32;
const POINTER_GAP_MS = 600;
/** The idle the criterion asks for: the last eight actions follow a pause, not a rhythm. */
const POINTER_IDLE_MS = 2500;
const POINTER_TAIL = 8;
/** The criterion's floor, in milliseconds: three frames of slack would be less than a round trip. */
const POINTER_LATENCY_FLOOR_MS = 50;
/**
 * Where a press belongs to the game rather than to an interactive island: inside the HUD plate, which
 * `ui/index.html` deliberately marks as not interactive. The page's response is the game's own
 * `pointerDowns`, so the press has to fall through for there to be anything to see.
 */
const POINTER_AT = { x: 0.15, y: 0.2 };

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

/** The game's own top-level window on the private display: the largest viewable one its pid owns. */
function gameWindowId(display, pid) {
  // xdotool has no `-display` flag: it reads $DISPLAY, so the private display has to be in its env.
  const environment = { ...process.env, DISPLAY: display };
  const found = run("xdotool", ["search", "--pid", String(pid)], { env: environment });
  if (found.status !== 0) return undefined;
  let best;
  for (const id of found.stdout.split("\n").map((line) => line.trim()).filter(Boolean)) {
    const info = run("xwininfo", ["-id", id], { env: environment });
    if (info.status !== 0 || !/Map State: IsViewable/u.test(info.stdout)) continue;
    const width = Number(/Width: (\d+)/u.exec(info.stdout)?.[1] ?? 0);
    const height = Number(/Height: (\d+)/u.exec(info.stdout)?.[1] ?? 0);
    const x = Number(/Absolute upper-left X: (-?\d+)/u.exec(info.stdout)?.[1] ?? 0);
    const y = Number(/Absolute upper-left Y: (-?\d+)/u.exec(info.stdout)?.[1] ?? 0);
    if (width < 200 || height < 200) continue;
    if (best === undefined || width * height > best.area) best = { area: width * height, height, id, width, x, y };
  }
  return best;
}

/**
 * One native pointer action: move the X pointer over the game's window and click.
 *
 * XTest events are indistinguishable from a real mouse at the X protocol level, and both entry
 * points — the OS event loop and the playtest bridge — reach the host through the same
 * `uiOverlayRoutePointer`, so this is the same path a player's click takes. The action lands on the
 * HUD plate, which is deliberately not an interactive island: the press must reach the *game*, whose
 * `pointerDowns` the page then renders, so the response under measurement is the whole
 * input → game → bridge → page → screen trip rather than a page-local highlight.
 */
function clickWindow(display, window_, x, y) {
  const environment = { ...process.env, DISPLAY: display };
  const px = Math.round(window_.x + x * window_.width);
  const py = Math.round(window_.y + y * window_.height);
  const result = run("xdotool", ["mousemove", "--sync", String(px), String(py), "click", "1"], {
    env: environment,
  });
  if (result.status !== 0) throw new Error(`xdotool click failed at ${px},${py}: ${result.stderr}`);
}

/**
 * The pointer lane's own actions: `POINTER_ACTIONS` native clicks on the HUD plate, the last
 * `POINTER_TAIL` of them after the idle the criterion asks for.
 */
async function drivePointerActions(display, pid) {
  const window_ = gameWindowId(display, pid);
  if (window_ === undefined) {
    fail(`the pointer lane cannot measure: no viewable window belongs to pid ${pid} on ${display}`, 2);
  }
  for (let index = 0; index < POINTER_ACTIONS; index += 1) {
    if (index === POINTER_ACTIONS - POINTER_TAIL) {
      await new Promise((done) => setTimeout(done, POINTER_IDLE_MS));
    }
    clickWindow(display, window_, POINTER_AT.x, POINTER_AT.y);
    await new Promise((done) => setTimeout(done, POINTER_GAP_MS));
  }
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

/**
 * Build the page the web view loads: entry + page, exactly as the project's own build does.
 *
 * `flag` is the page behaviour this lane turns on — the page-local animation, or the bridged state
 * echo — and is undefined for the pointer lane, which wants the plain page: the game posts state
 * every frame there, so a page that renders anything per frame would make its own pixels move and
 * there would be no way to tell the response to a click from the bridge doing its normal work.
 */
async function buildUiPage(destination, flag, entry = defaultUiEntry) {
  for (const [label, path] of [
    ["UI page", defaultUiSource],
    ["UI entry", entry],
  ]) {
    if (!existsSync(path)) throw new Error(`the ${label} is missing: ${path}`);
  }
  rmSync(destination, { force: true, recursive: true });
  mkdirSync(destination, { recursive: true });
  await esbuild({
    bundle: true,
    entryPoints: [entry],
    format: "esm",
    // The React page is JSX, and esbuild's default (the classic runtime) emits `React.createElement`
    // for it while the entry imports only the hooks — the page then dies with `React is not defined`
    // before it renders anything, which reads from the outside as a page that never animates. The
    // project's own tsconfig asks for `react-jsx`; this is the same request.
    jsx: "automatic",
    logLevel: "silent",
    outfile: join(destination, "main.js"),
    target: "es2022",
  });
  copyFileSync(defaultUiSource, join(destination, "index.html"));
  if (flag === undefined) return destination;
  const page = join(destination, "index.html");
  writeFileSync(
    page,
    readFileSync(page, "utf8").replace("</body>", `<script>window.${flag}=true;</script></body>`),
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

/**
 * Pair each change the page made with the action that caused it.
 *
 * Sound in one direction on purpose, and that direction is the safe one. A post arrives, the page
 * renders it, the driver's next snapshot publishes the change — so the *k*-th change the page made in
 * this window carries a state that arrived *at or after* the *k*-th anchor in it, whether or not two
 * anchors were coalesced into one render. Subtracting the *k*-th anchor from the *k*-th change
 * therefore overstates the true age, never understates it, and an age that comes out negative is not
 * a small number but a page showing something older than what it was just handed. Neither assertion
 * needs another clock: the anchor (`TN_UI_LATENCY_TRACE`) and the frame (`TN_UI_COMPOSITE_TRACE`)
 * are both stamped by the game thread.
 *
 * A page that changes more often than it is acted on — an animation of its own, a timer, a
 * transition — breaks the pairing in the unsafe direction, which is why `extra` is a failure at both
 * call sites rather than a footnote. It is also what keeps each lane's page honest about its flag.
 */
function pairChangesWithAnchors(changes, anchors) {
  const early = changes.filter((change) => change.atMs < anchors[0].atMs).length;
  const paired = Math.min(changes.length - early, anchors.length);
  const ages = [];
  const negative = [];
  for (let index = 0; index < paired; index += 1) {
    const change = changes[early + index];
    const age = change.atMs - anchors[index].atMs;
    if (age < 0) negative.push({ ageMs: age, anchor: index + 1, atMs: change.atMs });
    ages.push(age);
  }
  return { ages, early, extra: changes.length - early - anchors.length, paired, negative };
}

/**
 * The state-age lane's judgement: how long a state the game published took to become a page frame.
 *
 * The window's present interval is what the criterion calls `T`, taken from this run rather than
 * assumed, and the bound is `3T`. Both halves of the window are judged against it separately as well:
 * an age that grows is the failure this criterion exists to catch, and a UI drifting behind at
 * 40 ms per second would still look acceptable in a single p95 computed over the whole window.
 */
export function judgeStateAge(frames, latency) {
  const failures = [];
  const posts = latency.filter((entry) => entry.event === "post");
  const changes = frames.filter((frame) => frame.uploaded === true);
  const frameTime = median(gapsOf(frames.map((frame) => frame.atMs)));
  if (posts.length === 0) {
    failures.push(
      "no state was posted to the page in the window: TN_UI_LATENCY_TRACE never reported a post, so there is no state age to measure",
    );
    return { failures, summary: null };
  }
  if (frameTime === null) {
    failures.push("no composited frames in the window: the game never presented, so nothing could be visible");
    return { failures, summary: null };
  }
  const { ages, early, extra, negative } = pairChangesWithAnchors(changes, posts);
  if (extra > 0) {
    failures.push(
      `the page changed ${extra} more time(s) than the game posted state: it is changing for a reason other than the state it was sent, so a frame cannot be attributed to a post`,
    );
  }
  if (negative.length > 0) {
    failures.push(
      `the page showed a state older than the one just posted, ${negative.length} time(s), first at ${Math.round(negative[0].atMs)} ms (${negative[0].ageMs.toFixed(1)} ms against post ${negative[0].anchor}): a frame is carrying a stale state`,
    );
  }
  const bound = 3 * frameTime;
  const p95 = percentile(ages, 0.95);
  const half = Math.floor(ages.length / 2);
  const firstHalf = percentile(ages.slice(0, half), 0.95);
  const secondHalf = percentile(ages.slice(half), 0.95);
  if (p95 !== null && p95 > bound) {
    failures.push(
      `the p95 state age is ${p95.toFixed(1)} ms, over the ${bound.toFixed(1)} ms (3T) this gate allows`,
    );
  }
  // "Age does not grow over 30 s" is judged against each half's *own* frame time, not the whole
  // window's: this host's pacing moves by a factor of two between halves, so a single T taken across
  // both would let a UI that started lagging hide inside the slower half's budget. A backlog shows
  // here as a ratio climbing past 3; a UI tracking the game shows a ratio that moves with the game.
  const halfFrameTime = (subset) => median(gapsOf(subset.map((frame) => frame.atMs))) ?? frameTime;
  const midpoint = frames[Math.floor(frames.length / 2)].atMs;
  const firstTime = halfFrameTime(frames.filter((frame) => frame.atMs < midpoint));
  const secondTime = halfFrameTime(frames.filter((frame) => frame.atMs >= midpoint));
  if (firstHalf !== null && firstHalf > 3 * firstTime) {
    failures.push(
      `the p95 state age in the window's first half is ${firstHalf.toFixed(1)} ms, over the ${(3 * firstTime).toFixed(1)} ms (3T) that half's own frame time allows`,
    );
  }
  if (secondHalf !== null && secondHalf > 3 * secondTime) {
    failures.push(
      `the p95 state age in the window's second half is ${secondHalf.toFixed(1)} ms, over the ${(3 * secondTime).toFixed(1)} ms (3T) that half's own frame time allows: the UI is falling behind the game rather than tracking it`,
    );
  }
  // Posts are expected one per presented frame while the state changes every frame; a rate far under
  // that is a publication path that has quietly gone back to a timer.
  const posted = posts.length / frames.length;
  if (posted < 0.9) {
    failures.push(
      `the game posted ${posts.length} state(s) across ${frames.length} presented frame(s) (${(posted * 100).toFixed(1)}%): the per-frame publication this PRD keeps in place is not happening`,
    );
  }
  return {
    failures,
    summary: {
      ages,
      boundMs: bound,
      changes: changes.length,
      earlyChanges: early,
      frameTimeMs: frameTime,
      frameTimeFirstHalfMs: firstTime,
      frameTimeSecondHalfMs: secondTime,
      maxMs: ages.length === 0 ? null : Math.max(...ages),
      medianMs: median(ages),
      p95FirstHalfMs: firstHalf,
      p95Ms: p95,
      p95SecondHalfMs: secondHalf,
      postedRatio: posted,
      posts: posts.length,
      samples: ages.length,
    },
  };
}

/**
 * The pointer lane's judgement: how long a native pointer action took to become a visible response.
 *
 * The fixture's response to a press is the game's own `pointerDowns`, which the page renders as a big
 * number, so one action is one changed picture and the whole trip — X event, host routing, game
 * counting it, state post, page render, snapshot, composite — is inside the age. The criterion is
 * `max(50 ms, 3T)`: at 60 Hz a 50 ms floor is about three frames and leaves room for the round trip
 * that a three-frame budget alone would not.
 */
export function judgePointerLatency(frames, latency) {
  const failures = [];
  const actions = latency.filter(
    (entry) => entry.event === "pointer" && entry.detail === "pointerdown",
  );
  const changes = frames.filter((frame) => frame.uploaded === true);
  const frameTime = median(gapsOf(frames.map((frame) => frame.atMs)));
  if (actions.length < POINTER_ACTIONS) {
    failures.push(
      `${actions.length} pointer action(s) reached the host in the window, fewer than the ${POINTER_ACTIONS} this lane drives: a lost action and a swallowed one are the same observation here`,
    );
  }
  if (frameTime === null) {
    failures.push("no composited frames in the window: the game never presented, so nothing could be visible");
    return { failures, summary: null };
  }
  const { ages, early, extra, negative } = pairChangesWithAnchors(changes, actions);
  if (extra > 0) {
    failures.push(
      `the page changed ${extra} more time(s) than the host routed pointer actions: something other than the response is moving the page's pixels`,
    );
  }
  if (negative.length > 0) {
    failures.push(
      `the page showed a response older than the action that caused it, ${negative.length} time(s), first at ${Math.round(negative[0].atMs)} ms (${negative[0].ageMs.toFixed(1)} ms against action ${negative[0].anchor})`,
    );
  }
  // Fail closed on an empty measurement. `pairChangesWithAnchors` returns nothing when the page
  // never changed, and every bound below is satisfied by having nothing to judge: the lane then
  // reported a pass for a page that never responded to a single press and crashed printing the
  // null median. A run that observed no round trip has not passed the criterion, it has not run it.
  if (ages.length === 0) {
    failures.push(
      `no native pointer action produced a paired visible response: ${actions.length} action(s) reached the host and the page changed ${changes.length} time(s) in the window, so not one round trip was observed`,
    );
  }
  const bound = Math.max(POINTER_LATENCY_FLOOR_MS, 3 * frameTime);
  const p95 = percentile(ages, 0.95);
  if (p95 !== null && p95 > bound) {
    failures.push(
      `the p95 pointer response age is ${p95.toFixed(1)} ms, over the ${bound.toFixed(1)} ms this gate allows`,
    );
  }
  return {
    failures,
    summary: {
      actions: actions.length,
      ages,
      boundMs: bound,
      changes: changes.length,
      earlyChanges: early,
      frameTimeMs: frameTime,
      maxMs: ages.length === 0 ? null : Math.max(...ages),
      medianMs: median(ages),
      p95Ms: p95,
      samples: ages.length,
    },
  };
}

function main() {
  const options = {
    bundle: undefined,
    cwd: exampleRoot,
    executable: undefined,
    lane: "cadence",
    launch: "bundle",
    out: undefined,
    settleMs: 8000,
    timeoutMs: 120_000,
    ui: undefined,
    windowMs: 30_000,
    windowSize: "1280x720",
  };
  const argv = process.argv.slice(2);
  const numbers = { "--settle-ms": "settleMs", "--timeout-ms": "timeoutMs", "--window-ms": "windowMs" };
  const strings = { "--bundle": "bundle", "--cwd": "cwd", "--executable": "executable", "--lane": "lane", "--launch": "launch", "--out": "out", "--ui": "ui", "--window-size": "windowSize" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${argument} needs a value.`);
    index += 1;
    if (numbers[argument] !== undefined) options[numbers[argument]] = Number(value);
    else if (strings[argument] !== undefined) options[strings[argument]] = value;
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (
    options.lane !== "cadence" &&
    options.lane !== "state-age" &&
    options.lane !== "pointer" &&
    options.lane !== "react"
  ) {
    throw new Error(`--lane accepts cadence, state-age, pointer or react, received '${options.lane}'.`);
  }
  if (options.launch !== "bundle" && options.launch !== "packaged") {
    throw new Error(`--launch accepts bundle or packaged, received '${options.launch}'.`);
  }
  options.out = resolve(
    options.out ?? join(runtimeRoot, "artifacts", `native-ui-cadence-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}`),
  );
  return options;
}

/**
 * What to launch, and what has to be built for it first.
 *
 * A packaged game brings its own bundle and page, so nothing here is built for it; the host binary
 * needs both, and they are built from this repository's fixture — the page variant this lane needs.
 */
async function launchSpec(options, artifactDirectory) {
  const binary = nativeBinary(options.executable);
  if (options.launch === "packaged") return `exec "${binary}"`;
  const bundle = options.bundle ?? buildBundle();
  const uiRoot =
    options.ui ??
    (await buildUiPage(
      join(artifactDirectory, "ui"),
      options.lane === "cadence"
        ? "__tnPageAnimation"
        : options.lane === "state-age"
          ? "__tnStateEcho"
          : undefined,
      options.lane === "react" ? reactUiEntry : defaultUiEntry,
    ));
  return `exec "${binary}" run "${bundle}" --ui "${uiRoot}" --width 1280 --height 720`;
}

async function measure(options, display, artifactDirectory) {
  const binary = nativeBinary(options.executable);
  if (!existsSync(binary)) fail(`the native runtime binary is missing: ${binary} — run \`pnpm native:build\``, 2);
  const command = await launchSpec(options, artifactDirectory);
  const logPath = join(artifactDirectory, "cadence-console.log");
  const log = spawn("sh", ["-c", `${command} > "${logPath}" 2>&1`], {
    cwd: resolve(options.cwd),
    detached: true,
    env: {
      ...process.env,
      DISPLAY: display,
      TN_UI_COMPOSITE_TRACE: "1",
      TN_UI_LATENCY_TRACE: "1",
    },
    stdio: "ignore",
  });
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
    const windowStartedAt = Date.now();
    if (options.lane === "pointer") await drivePointerActions(display, log.pid);
    const remaining = options.windowMs - (Date.now() - windowStartedAt);
    if (remaining > 0) await new Promise((done) => setTimeout(done, remaining));
    return readLog();
  } finally {
    try {
      process.kill(-log.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
}

/**
 * The region the run promised to measure, from the log it produced.
 *
 * `measure` waits for `first_playable`, settles, then measures for `windowMs` — but the log it reads
 * back also holds the startup, whose frame pacing is a different defect (PRD-393's loader/pump stall)
 * and whose 100–180 ms frames would be judged here as the UI failing to keep up. Frames and posts are
 * both cut to those bounds, and the record carries them.
 */
function measuredWindow(log, settleMs, windowMs) {
  const playable = markersIn(log, "TN_COLD_START:").find((marker) => marker.segment === "first_playable");
  if (playable === undefined) return undefined;
  const startMs = playable.atMs + settleMs;
  const endMs = startMs + windowMs;
  const inWindow = (entry) => entry.atMs >= startMs && entry.atMs <= endMs;
  const frames = markersIn(log, "TN_UI_COMPOSITE_TRACE:").filter(inWindow);
  const latency = markersIn(log, "TN_UI_LATENCY_TRACE:").filter(inWindow);
  return { endMs, frames, latency, playableMs: playable.atMs, startMs };
}

/** The lane's own judgement of those frames and anchors. */
function judgeLane(lane, frames, latency) {
  if (lane === "state-age") return judgeStateAge(frames, latency);
  if (lane === "pointer") return judgePointerLatency(frames, latency);
  return judgeCadence(frames);
}

/** The line a passing lane prints: the numbers, in the terms its own criterion is written in. */
function passLine(lane, verdict, measured) {
  const windowMs = Math.round(measured.endMs - measured.startMs);
  if (lane === "state-age") {
    const state = verdict.summary;
    return `native UI state-age gate passed: ${state.samples} sample(s) over ${windowMs} ms, posts ${state.posts}/${measured.frames.length} frames (${(state.postedRatio * 100).toFixed(1)}%), state age p50 ${state.medianMs.toFixed(1)} ms, p95 ${state.p95Ms.toFixed(1)} ms under ${state.boundMs.toFixed(1)} ms (3T), halves ${state.p95FirstHalfMs.toFixed(1)}/${state.p95SecondHalfMs.toFixed(1)} ms against frame times ${state.frameTimeFirstHalfMs.toFixed(1)}/${state.frameTimeSecondHalfMs.toFixed(1)} ms, max ${state.maxMs.toFixed(1)} ms`;
  }
  if (lane === "pointer") {
    const pointer = verdict.summary;
    return `native UI pointer gate passed: ${pointer.actions} native action(s), ${pointer.samples} paired, response age p50 ${pointer.medianMs.toFixed(1)} ms, p95 ${pointer.p95Ms.toFixed(1)} ms under ${pointer.boundMs.toFixed(1)} ms, max ${pointer.maxMs.toFixed(1)} ms`;
  }
  const worst = verdict.segments.reduce((low, segment) => Math.min(low, segment.ratio), 1);
  const slowest = verdict.segments.reduce((high, segment) => Math.max(high, segment.p95GapMs ?? 0), 0);
  return `native UI ${lane} gate passed: ${verdict.segments.length} active segment(s) in the ${windowMs} ms window, worst upload ratio ${(worst * 100).toFixed(1)}%, slowest p95 gap ${slowest.toFixed(1)} ms`;
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
  const window_ = measuredWindow(log, options.settleMs, options.windowMs);
  if (window_ === undefined) {
    fail(`native UI ${options.lane} gate could not measure: the host never reported first_playable, so the measured window cannot be located (${options.out})`, 2);
  }
  if (window_.frames.length === 0) {
    fail(`native UI ${options.lane} gate could not measure: no composited frame fell inside the measured window ${Math.round(window_.startMs)}–${Math.round(window_.endMs)} ms (${options.out})`, 2);
  }

  const measured = {
    endMs: window_.endMs,
    frames: window_.frames.length,
    playableMs: window_.playableMs,
    startMs: window_.startMs,
    windowMs: options.windowMs,
  };
  const verdict = judgeLane(options.lane, window_.frames, window_.latency);
  const attached = overlay?.attached === true;
  const evidence = {
    assertions: {
      attached,
      lane: options.lane,
      measured,
      ...(options.lane === "cadence" || options.lane === "react"
        ? { frames: window_.frames.length, segments: verdict.segments, resumes: verdict.resumes }
        : { ages: verdict.summary }),
    },
    display,
    executable: nativeBinary(options.executable),
    pass: attached && verdict.failures.length === 0,
    reasons: [
      ...(attached ? [] : [`the page never attached: ${JSON.stringify(overlay ?? null)}`]),
      ...verdict.failures,
    ],
    windowMs: options.windowMs,
  };
  const recordPath = join(options.out, "native-ui-cadence.json");
  writeFileSync(recordPath, `${JSON.stringify(evidence, null, 2)}\n`);
  if (!evidence.pass) {
    fail(`native UI ${options.lane} gate failed (${options.out}):\n  - ${evidence.reasons.join("\n  - ")}`);
  }
  process.stdout.write(`${passLine(options.lane, verdict, window_)}\n`);
  process.stdout.write(`native UI evidence: ${recordPath}\n`);
}

// Only when executed, so the judges above can be imported and tested on their own. Everything this
// file does to a display, a window or a game process belongs to `main_`.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main_();
}
