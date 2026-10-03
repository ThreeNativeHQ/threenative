#!/usr/bin/env node
/**
 * The Core HUD corpus on an Android device or emulator, through the playtest runner.
 *
 * The desktop harness (`desktop.mjs`) packages one host per fixture. An Android package is a Gradle
 * build, and every fixture would recompile the same runtime, so this takes the runtime once — the
 * HUD's own APK, built from a runtime source checkout with the CSS UI linked — and swaps in each
 * subject's game bundle and `ui-css` directory (`assets/scripts/main.js`, `assets/ui/`), re-aligns
 * and re-signs it with the debug key, installs it, and runs a playtest `--target android`. Captures
 * are compared with the Chromium screenshot `shared.mjs` renders from the same fixture data, with the
 * oracle's own SSIM arithmetic and bars: this changes the subject, never the measure.
 *
 * Viewports. Android's WindowManager clamps a forced display size to at least 200 px per edge, and
 * the HUD APK is locked to landscape, so a subject with an edge under 200 px or a portrait or square
 * viewport (a square display stays at rotation 0, where the landscape app is inset below the status
 * bar) runs ENLARGED: at least 240 wide and 200 high, and wider than high. The Chromium reference (or, for
 * an interaction, the oracle's expected list, via `interaction-at-size.mjs`) is produced at that same
 * enlarged viewport, because layout depends on it. Every enlarged subject is named in the report.
 * dpr != 1 is skipped by name: the runner presents density 160 only.
 *
 * System bars. The game runs immersive, but Android may reveal transient bars over it after a display
 * change, and `screencap` photographs the whole display. The status bar's clock and icons and the
 * navigation handle are disabled for the run (`cmd statusbar send-disable-flag`), so a transient bar
 * paints nothing over the app; the flags are cleared at the end. The display is fixed to the user
 * rotation for the run too (`wm fixed-to-user-rotation`), so the rotation lock alone decides the
 * display's orientation and each run waits until the display is in its viewport (`settleDisplay`).
 *
 * Interactions. The runner's touch is a real touchscreen event on an emulator, so the scenarios made
 * of taps run, with each tap a finger. Hover moves (a finger has no hover), keys (the runner's key
 * channel never reaches the host's UI route), wheels and environment changes are not injectable; the
 * observations after the first such step are reported unreachable, by name, and a scenario with none
 * left is skipped by name.
 *
 * Each run asserts the identity from the app's own logcat lines: the native-css backend line, the
 * attach marker, no web view, no rejected mutation batch.
 *
 * Usage: node corpus/android.mjs --apk <hud.apk> [--device emulator-5554] [name ...]
 * Output: artifacts/corpus-android/ (gitignored) + report.json
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import { FIXTURES, FONT } from "./fixtures.mjs";
import {
  PIXEL_TOLERANCE,
  PIXEL_TOLERANCE_AA,
  pixelAt,
  resourceAt,
  scenarioBoxes,
} from "./interactions-desktop.mjs";
import { INTERACTIONS } from "./interactions.mjs";
import { writeProject } from "./project.mjs";
import {
  CHROMIUM_ARGS,
  IMAGE_FILES,
  bar,
  example,
  here,
  imageDir,
  luminance,
  renderChromiumFixture,
  ssim,
} from "./shared.mjs";

const repo = join(example, "..", "..");
const threenative = join(repo, "packages", "create-threenative", "dist", "threenative.js");
const playtestCli = join(repo, "packages", "playtest", "dist", "runner", "cli.js");
const sdk = process.env.ANDROID_HOME ?? join(homedir(), "Android", "Sdk");
const adb = join(sdk, "platform-tools", "adb");
const buildTools = join(sdk, "build-tools", "36.0.0");
const out = join(example, "artifacts", "corpus-android");
const args = process.argv.slice(2);
const take = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args.splice(index, 2)[1];
};
const apk = resolve(
  take("--apk") ?? join(example, "dist-native", "threenative-native-css-hud.apk"),
);
const device = take("--device") ?? "emulator-5554";
const only = args;
const packageName = "com.threenative.nativecsshud";
/** The font sheet `interaction.mjs` puts in front of a scenario's own CSS, as `desktop.mjs` uses. */
const INTERACTION_FONT =
  "@font-face{font-family:Noto;font-weight:400;src:url(NotoSans-Regular.ttf)}@font-face{font-family:Noto;font-weight:700;src:url(NotoSans-Bold.ttf)}";
/** Ticks a finger is held, and ticks to let the UI settle after an input: 500 ms at 60 Hz. */
const HOLD_TICKS = 6;
const SETTLE_TICKS = 30;

/** The viewport Android can present for `size`, and whether it had to be enlarged. */
function presented([width, height]) {
  if (Math.min(width, height) >= 200 && height < width) return { size: [width, height] };
  let w = Math.max(width, 240);
  const h = Math.max(height, 200);
  if (h >= w) w = h + 40;
  return { size: [w, h], enlarged: { from: [width, height], to: [w, h] } };
}

const skips = [];
const fixtures = FIXTURES.filter((fixture) => {
  if (only.length > 0 && !only.includes(fixture.name)) return false;
  if ((fixture.dpr ?? 1) === 1) return true;
  skips.push({ name: fixture.name, why: "dpr is not 1: the runner presents density 160 only" });
  return false;
});
const scenarios = INTERACTIONS.filter((s) => only.length === 0 || only.includes(s.name));
if (fixtures.length === 0 && scenarios.length === 0)
  throw new Error("TN_ANDROID_CORPUS_NO_SUBJECT: nothing matches");
if (!existsSync(apk)) throw new Error(`TN_ANDROID_CORPUS_APK_MISSING: ${apk}`);

// The runner reads the SDK from the environment and calls `adb` by name.
process.env.ANDROID_HOME = sdk;
process.env.PATH = `${join(sdk, "platform-tools")}:${process.env.PATH}`;

function run(command, argv, cwd = example, env = process.env) {
  const result = spawnSync(command, argv, {
    cwd,
    encoding: "utf8",
    env,
    maxBuffer: 256 * 1024 * 1024,
  });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** The HUD APK with this subject's bundle and stylesheets in place of the HUD's, aligned and signed. */
function swapApk(dir) {
  const build = join(dir, ".threenative", "build");
  const ui = join(build, "ui-css");
  for (const image of IMAGE_FILES) cpSync(join(imageDir, image), join(ui, image));
  const unsigned = join(dir, "unsigned.apk");
  const swapped = run("python3", [
    "-c",
    `import os,sys,zipfile
src,dst,bundle,ui=sys.argv[1:]
with zipfile.ZipFile(src) as z, zipfile.ZipFile(dst,'w') as o:
    for info in z.infolist():
        n=info.filename
        if n.startswith('META-INF/') or n=='assets/scripts/main.js' or n.startswith('assets/ui/'): continue
        o.writestr(info, z.read(n))
    o.write(bundle,'assets/scripts/main.js',zipfile.ZIP_DEFLATED)
    for f in sorted(os.listdir(ui)): o.write(os.path.join(ui,f),'assets/ui/'+f,zipfile.ZIP_DEFLATED)`,
    apk,
    unsigned,
    join(build, "game.js"),
    ui,
  ]);
  if (swapped.status !== 0) return { fail: `apk swap failed: ${swapped.output.slice(-400)}` };
  const signed = join(dir, "fixture.apk");
  const aligned = run(join(buildTools, "zipalign"), ["-f", "-p", "4", unsigned, signed]);
  if (aligned.status !== 0) return { fail: `zipalign failed: ${aligned.output.slice(-400)}` };
  const sign = run(join(buildTools, "apksigner"), [
    "sign",
    ...["--ks", join(homedir(), ".android", "debug.keystore"), "--ks-pass", "pass:android"],
    signed,
  ]);
  if (sign.status !== 0) return { fail: `apksigner failed: ${sign.output.slice(-400)}` };
  rmSync(unsigned, { force: true });
  return { signed };
}

/** The identity claim, from the app's own logcat lines (other processes log `chromium` too). */
function identity(lines) {
  const backend = lines.find((line) => line.includes("ui overlay: native-css backend=blitz-dom"));
  const pid = backend?.match(/\(\s*(\d+)\)/u)?.[1];
  const own = lines.filter(
    (line) => pid !== undefined && new RegExp(`\\(\\s*${pid}\\)`, "u").test(line),
  );
  const problems = [];
  if (backend === undefined) problems.push("no native-css backend line");
  if (!own.some((line) => line.includes('TN_UI_OVERLAY:{"attached":true,"renderer":"native-css"}')))
    problems.push("no attach marker");
  const webView = own.filter(
    (line) =>
      /webkit|webview|chromium|cr_|TN_UI_LOAD_FAILED/iu.test(line) && !line.includes("no WebView"),
  );
  if (webView.length > 0) problems.push(`web view mentioned: ${webView[0].slice(0, 120)}`);
  const rejected = own.filter((line) => line.includes("TN_CSS_UI_POST_REJECTED"));
  if (rejected.length > 0) problems.push(`${rejected.length} TN_CSS_UI_POST_REJECTED line(s)`);
  const touches = own.filter((line) => line.includes('TN_UI_POINTER_ROUTE:{"source":"touch"'));
  return {
    pid,
    ownLines: own.length,
    webView: webView.length,
    rejected: rejected.length,
    touches: touches.length,
    problems,
    ok: problems.length === 0,
  };
}

/**
 * Put the display into the subject's viewport and wait until it is really there, before the runner
 * launches the app. The runner applies the same `wm size` / density / rotation lock (identical
 * values, so its own step changes nothing), but it checks only the size override, and the display
 * followed whichever app was in front: the portrait launcher between runs, the landscape game once
 * it started, so a rotation still in flight at the capture left the first frames of a run portrait
 * (200x320 for a 320x200 subject). With the display fixed to the user rotation for the run (set
 * below), the rotation lock alone decides, and waiting on the window manager's own current size
 * closes the race instead of retrying until a run happens to win it.
 */
function settleDisplay([width, height]) {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const commands = [
    ["wm", "size", `${short}x${long}`],
    ["wm", "density", "160"],
    ["wm", "user-rotation", "lock", width > height ? "1" : "0"],
  ];
  for (const command of commands) run(adb, ["-s", device, "shell", ...command]);
  const want = `cur=${width}x${height}`;
  for (let attempt = 0; attempt < 40; attempt++) {
    const shown = run(adb, ["-s", device, "shell", "dumpsys", "window", "displays"]).output;
    if (shown.includes(want)) return undefined;
    spawnSync("sleep", ["0.5"]);
  }
  return `the display never reached ${width}x${height} (window manager: ${run(adb, ["-s", device, "shell", "dumpsys", "window", "displays"]).output.match(/cur=\d+x\d+/u)?.[0]})`;
}

/**
 * Build, swap, install and play one generated project. The consumer build writes the Android bundle
 * and `ui-css`, then stops at packaging (this run packages by swapping); a missing bundle afterwards
 * is a real build failure.
 */
function playOnDevice(root, subject, scenario, listen, fontCss) {
  // Under `dist/` for the reason `desktop.mjs` gives: Biome ignores the name, and generated fixture
  // markup is not application code.
  const dir = join(root, "dist");
  writeProject(dir, subject, { fontCss, listen, scenario });
  const build = run(process.execPath, [threenative, "build", "--target", "android"], dir);
  if (
    !existsSync(join(dir, ".threenative", "build", "game.js")) ||
    !existsSync(join(dir, ".threenative", "build", "ui-css"))
  )
    return { fail: `build produced no bundle: ${build.output.slice(-400)}` };
  const swapped = swapApk(dir);
  if (swapped.fail !== undefined) return swapped;
  const installed = run(adb, ["-s", device, "install", "-r", swapped.signed]);
  rmSync(swapped.signed, { force: true });
  if (installed.status !== 0) return { fail: `install failed: ${installed.output.slice(-300)}` };
  const unsettled = settleDisplay([scenario.viewport.width, scenario.viewport.height]);
  if (unsettled !== undefined) return { fail: unsettled };
  const artifacts = join(dir, "artifacts", "playtest");
  const played = run(
    process.execPath,
    [
      playtestCli,
      "playtest.json",
      ...["--target", "android", "--device", device, "--package", packageName],
      ...["--activity", "com.threenative.runtime.MystralActivity", "--artifacts", artifacts],
    ],
    dir,
  );
  // The device log itself rather than the runner's console.json: the runner clears logcat when it
  // starts, and a flat subject that trips its blank-capture guard aborts before writing the file.
  const lines = run(adb, ["-s", device, "logcat", "-d", "-v", "brief"]).output.split("\n");
  // The runner refuses a capture with fewer than 8 distinct colours, which a flat corpus subject
  // cannot have; the frame is written before the guard reads it, and the SSIM bar or the pixel
  // comparison is the stronger statement about the same pixels.
  const guard = played.status !== 0 && played.output.includes("TN_CAPTURE_BLANK");
  let report;
  try {
    report = JSON.parse(played.output.slice(played.output.indexOf("{")));
  } catch {
    report = undefined;
  }
  return { dir, artifacts, played, guard, report, id: identity(lines) };
}

/** Viewport and settling steps shared by every scenario this harness writes. */
function scenarioShell(name, [width, height], steps, resources, screenshots) {
  return {
    schemaVersion: 1,
    name: `corpus-${name}`,
    // The scenario schema names the native runner "desktop"; `--target android` picks the device.
    target: "desktop",
    viewport: { width, height },
    warmupFrames: 0,
    steps,
    artifacts: { console: true, screenshots },
    assert: {
      resources: [{ id: "GameState", path: "frames", changed: true, gte: 100 }, ...resources],
    },
  };
}

async function runFixture(fixture, browser) {
  const { size, enlarged } = presented(fixture.size);
  const [width, height] = size;
  const subject = { ...fixture, size };
  const root = join(out, fixture.name);
  rmSync(root, { force: true, recursive: true });
  const chromeDir = join(root, "chromium");
  mkdirSync(chromeDir, { recursive: true });
  const { chrome } = await renderChromiumFixture(browser, subject, chromeDir, FONT);
  const scenario = scenarioShell(
    fixture.name,
    size,
    [{ label: "ui-ready", waitTicks: 120, screenshot: "frame" }],
    [{ id: "GameState", path: "mounted", atSteps: [{ label: "ui-ready", equals: true }] }],
    true,
  );
  const entry = {
    kind: "fixture",
    name: fixture.name,
    size,
    ...(enlarged === undefined ? {} : { enlarged }),
    ssimMin: bar(fixture),
  };
  const played = playOnDevice(root, subject, scenario, [], FONT);
  if (played.fail !== undefined) return { ...entry, pass: false, why: played.fail };
  entry.playtestExit = played.played.status;
  entry.identity = played.id;
  const capturePath = join(played.artifacts, "frame.png");
  if (!existsSync(capturePath))
    return {
      ...entry,
      pass: false,
      why: `no capture (playtest exit ${played.played.status}): ${played.played.output.slice(-400)}`,
    };
  const capture = PNG.sync.read(readFileSync(capturePath));
  const expected = PNG.sync.read(readFileSync(chrome));
  entry.captureSize = [capture.width, capture.height];
  if (capture.width !== width || capture.height !== height)
    return {
      ...entry,
      pass: false,
      why: `the capture is ${capture.width}x${capture.height}, not ${width}x${height}`,
    };
  entry.ssim = Number(ssim(luminance(expected), luminance(capture), width, height).toFixed(4));
  if (played.guard) entry.obstruction = "the runner's blank-capture colour floor";
  entry.pass =
    entry.ssim >= entry.ssimMin && played.id.ok && (played.played.status === 0 || played.guard);
  if (!played.id.ok) entry.why = `identity: ${played.id.problems.join("; ")}`;
  else if (entry.ssim < entry.ssimMin)
    entry.why = `SSIM ${entry.ssim} is below the ${entry.ssimMin} bar`;
  else if (played.played.status !== 0 && !played.guard)
    entry.why = `the playtest exited ${played.played.status}`;
  return entry;
}

/**
 * Translate one interaction script for a finger. Observations stay positional with the oracle's list;
 * consecutive observations with no input between them read the same capture, because nothing can
 * have changed. A pixel is comparable only where its element has finished its transition, measured
 * in Chromium (`scenarioBoxes`), exactly as the desktop translation decides it.
 */
function translateTouch(scenario, size, samples) {
  const [width, height] = size;
  const steps = [{ label: "baseline", waitTicks: 60 }];
  const observations = [];
  let unreachable;
  let sinceInput = 0;
  let capture;
  let observed = 0;
  for (const step of scenario.script) {
    if (step.obs !== undefined) {
      const index = observed++;
      if (unreachable !== undefined) {
        observations.push({ index, obs: step.obs, why: unreachable });
        continue;
      }
      if (step.obs !== "pixel" && step.obs !== "clicks") {
        unreachable = `a ${step.obs} observation: the Android host reports no ${step.obs} to the runner`;
        observations.push({ index, obs: step.obs, why: unreachable });
        continue;
      }
      if (capture === undefined) {
        capture = `obs-${index}`;
        steps.push({
          label: capture,
          waitTicks: 1,
          ...(step.obs === "pixel" ? { screenshot: capture } : {}),
        });
      } else if (step.obs === "pixel" && !steps.some((s) => s.screenshot === capture)) {
        steps.find((s) => s.label === capture).screenshot = capture;
      }
      const settle = step.obs === "pixel" ? (samples[index]?.settleMs ?? 0) : 0;
      observations.push({
        index,
        obs: step.obs,
        label: capture,
        ...(step.obs === "pixel" ? { at: [step.x, step.y] } : {}),
        ...(sinceInput >= settle
          ? {}
          : { why: `mid-transition: ${sinceInput}ms elapsed of the ${settle}ms this pixel takes` }),
      });
      continue;
    }
    if (unreachable !== undefined) continue;
    capture = undefined;
    if (step.t === "pointer" && (step.type === "down" || step.type === "up")) {
      steps.push(
        step.type === "down"
          ? {
              pointers: [{ id: 1, x: step.x / width, y: step.y / height }],
              holdTicks: HOLD_TICKS,
              release: false,
            }
          : { pointers: [], release: true },
      );
      steps.push({ waitTicks: SETTLE_TICKS });
      sinceInput = 0;
    } else if (step.t === "advance") {
      sinceInput += step.ms;
    } else if (step.t === "pointer") {
      unreachable =
        "a hover move: a finger has no hover, and the runner injects no mouse on Android";
    } else if (step.t === "key") {
      unreachable = "a key: the Android runner's key channel never reaches the host's UI key route";
    } else if (step.t === "wheel") {
      unreachable = "a wheel step: the Android runner has no wheel injector";
    } else {
      unreachable =
        "prefers-color-scheme/reduced-motion: the host reads its environment once at attach and the runner injects neither";
    }
  }
  return { steps, observations };
}

/** The oracle's expected lists at the viewports this device presents. */
function chromiumExpectedAt(names, sizes) {
  const result = run(
    process.execPath,
    [join(here, "interaction-at-size.mjs"), ...names],
    here,
    // biome-ignore lint/style/useNamingConvention: environment variables keep their own names.
    { ...process.env, CHROMIUM_ONLY: "1", TN_INTERACTION_SIZES: JSON.stringify(sizes) },
  );
  if (result.status !== 0)
    throw new Error(`TN_ANDROID_INTERACTION_ORACLE_FAILED: ${result.output.slice(-600)}`);
  const expected = new Map();
  for (const line of result.output.split("\n")) {
    const at = line.indexOf(" [");
    if (at > 0) expected.set(line.slice(0, at), JSON.parse(line.slice(at + 1)));
  }
  return expected;
}

async function runInteraction(scenario, expected, browser) {
  const { size, enlarged } = presented(scenario.size);
  const sized = { ...scenario, size };
  const entry = {
    kind: "interaction",
    name: scenario.name,
    size,
    ...(enlarged === undefined ? {} : { enlarged }),
    mismatches: [],
    compared: [],
    unreachable: [],
  };
  const points = scenario.script.filter((s) => s.obs !== undefined);
  // `scenarioBoxes` reads the page the oracle leaves in `out-interaction/`, which the desktop corpus
  // rewrites too; re-run the oracle for this scenario right before reading it, so another lane's run
  // cannot leave it missing.
  chromiumExpectedAt([scenario.name], { [scenario.name]: size });
  const { samples } = await scenarioBoxes(
    browser,
    sized,
    points.map((s) => ({ x: s.x ?? 0, y: s.y ?? 0 })),
  );
  const translated = translateTouch(scenario, size, samples);
  if (translated.observations.length !== expected.length)
    throw new Error(
      `TN_ANDROID_INTERACTION_COUNT: ${scenario.name} translated ${translated.observations.length}, expected ${expected.length}`,
    );
  const reachable = translated.observations.filter((o) => o.why === undefined);
  entry.unreachable = translated.observations
    .filter((o) => o.why !== undefined)
    .map((o) => ({ index: o.index, why: o.why }));
  // An observation made before any input proves nothing about interaction (the page's own first
  // paint): a scenario whose only reachable observations are those is skipped, not passed.
  const firstInput = scenario.script.findIndex((s) => s.obs === undefined);
  const obsPositions = scenario.script.flatMap((s, position) =>
    s.obs === undefined ? [] : [position],
  );
  const afterInput = reachable.filter((o) => (obsPositions[o.index] ?? -1) > firstInput);
  if (afterInput.length === 0) {
    skips.push({
      name: scenario.name,
      why: entry.unreachable[0]?.why ?? "no reachable observation follows an input",
    });
    return undefined;
  }
  const clicks = reachable
    .filter((o) => o.obs === "clicks")
    .map((o) => ({ label: o.label, equals: expected[o.index].join(",") }));
  const labels = translated.steps.filter((s) => s.label !== undefined);
  const scenarioFile = scenarioShell(
    scenario.name,
    size,
    translated.steps,
    [
      { id: "GameState", path: "mounted", atSteps: [{ label: labels.at(-1).label, equals: true }] },
      ...(clicks.length === 0 ? [] : [{ id: "GameState", path: "clicks", atSteps: clicks }]),
    ],
    translated.steps.some((s) => s.screenshot !== undefined),
  );
  const root = join(out, scenario.name);
  rmSync(root, { force: true, recursive: true });
  const played = playOnDevice(root, sized, scenarioFile, scenario.listen ?? [], INTERACTION_FONT);
  if (played.fail !== undefined) return { ...entry, pass: false, why: played.fail };
  entry.playtestExit = played.played.status;
  entry.identity = played.id;
  if (played.guard) entry.obstruction = "the runner's blank-capture colour floor";
  for (const item of reachable) {
    const want = expected[item.index];
    let actual = null;
    if (item.obs === "pixel") {
      const file = join(played.artifacts, `${item.label}.png`);
      if (existsSync(file)) actual = pixelAt(PNG.sync.read(readFileSync(file)), ...item.at);
    } else {
      const ledger = resourceAt(played.report, item.label, "clicks");
      actual = ledger === undefined ? null : ledger.split(",").filter(Boolean).map(Number);
    }
    entry.compared.push({ index: item.index, obs: item.obs, expected: want, actual });
    const same =
      item.obs === "pixel"
        ? Array.isArray(actual) && actual.every((v, i) => Math.abs(v - want[i]) <= PIXEL_TOLERANCE)
        : JSON.stringify(actual) === JSON.stringify(want);
    if (same) continue;
    const wider =
      item.obs === "pixel" &&
      Array.isArray(actual) &&
      actual.every((v, i) => Math.abs(v - want[i]) <= PIXEL_TOLERANCE_AA);
    entry.mismatches.push({
      index: item.index,
      expected: want,
      actual,
      ...(wider ? { note: `within the ${PIXEL_TOLERANCE_AA} anti-aliased-edge tolerance` } : {}),
    });
  }
  const exitOk = played.played.status === 0 || played.guard;
  entry.pass = entry.mismatches.length === 0 && played.id.ok && exitOk;
  if (!played.id.ok) entry.why = `identity: ${played.id.problems.join("; ")}`;
  else if (entry.mismatches.length > 0)
    entry.why = `${entry.mismatches.length} observation(s) differ from Chromium`;
  else if (!exitOk)
    entry.why = `the playtest exited ${played.played.status}: ${played.played.output.slice(-300)}`;
  return entry;
}

const report = [];
mkdirSync(out, { recursive: true });
const disableBars = ["clock", "system-icons", "notification-icons", "home", "recents"];
const bars = run(adb, [
  "-s",
  device,
  "shell",
  "cmd",
  "statusbar",
  "send-disable-flag",
  ...disableBars,
]);
if (bars.status !== 0) throw new Error(`TN_ANDROID_CORPUS_BARS: ${bars.output}`);
// The display's rotation comes from the lock alone, not from whichever app is in front (above).
run(adb, ["-s", device, "shell", "wm", "fixed-to-user-rotation", "enabled"]);
const browser = await chromium.launch({ args: CHROMIUM_ARGS });
try {
  for (const fixture of fixtures) {
    const entry = await runFixture(fixture, browser);
    report.push(entry);
    console.log(
      `${entry.pass ? "PASS" : "FAIL"} ${entry.name} ${entry.size.join("x")}${entry.enlarged ? ` (enlarged from ${entry.enlarged.from.join("x")})` : ""} ssim=${entry.ssim ?? "-"} bar=${entry.ssimMin}${entry.why ? ` (${entry.why.slice(0, 160)})` : ""}`,
    );
  }
  const sizes = Object.fromEntries(scenarios.map((s) => [s.name, presented(s.size).size]));
  const expected =
    scenarios.length === 0 ? new Map() : chromiumExpectedAt(Object.keys(sizes), sizes);
  for (const scenario of scenarios) {
    const entry = await runInteraction(scenario, expected.get(scenario.name), browser);
    if (entry === undefined) continue;
    report.push(entry);
    console.log(
      `${entry.pass ? "PASS" : "FAIL"} ${entry.name} ${entry.size.join("x")}${entry.enlarged ? ` (enlarged from ${entry.enlarged.from.join("x")})` : ""} compared=${entry.compared.length} unreachable=${entry.unreachable.length}${entry.why ? ` (${entry.why.slice(0, 160)})` : ""}`,
    );
  }
} finally {
  await browser.close();
  run(adb, ["-s", device, "shell", "cmd", "statusbar", "send-disable-flag", "none"]);
  run(adb, ["-s", device, "shell", "wm", "fixed-to-user-rotation", "default"]);
}
const passed = report.filter((entry) => entry.pass).length;
writeFileSync(
  join(out, "report.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), device, apk, totals: `${passed}/${report.length}`, enlarged: report.filter((e) => e.enlarged).map((e) => ({ name: e.name, ...e.enlarged })), skips, report }, null, 2)}\n`,
);
console.log(`${passed}/${report.length} subjects match Chromium on ${device}`);
for (const skip of skips) console.log(`SKIP ${skip.name}: ${skip.why}`);
process.exit(passed === report.length ? 0 : 1);
