#!/usr/bin/env node
/**
 * The Core HUD corpus on the REAL desktop host, through the playtest runner.
 *
 * For every fixture in `fixtures.mjs` (dpr 1 only) this generates a tiny native-css game project,
 * builds it, packages it against the checkout-built host, runs it under
 * `packages/playtest --target desktop --executable`, and compares the host's own capture with the
 * Chromium screenshot `corpus/shared.mjs` renders from the same fixture data. The bars, the SSIM
 * arithmetic, the tree numbering and the asset staging are the oracle's own, imported from
 * `shared.mjs`: this changes the subject, never the measure.
 *
 * Per run it also asserts the backend identity from the host's log — the native-css backend line,
 * `TN_UI_OVERLAY:{"attached":true,"renderer":"native-css"}`, no web view, and no rejected mutation
 * batch — because a host that logged the backend and dropped every frame would otherwise pass.
 *
 * Interaction scenarios from `interactions.mjs` run the same way, as playtests over the grammar the
 * runner really has (keys, pointers, holds, screenshots); `interactions-desktop.mjs` translates the
 * scripts and says out loud which steps that grammar cannot express.
 *
 * Usage: node corpus/desktop.mjs [fixture ...]    Output: corpus/out-desktop/ (gitignored) + report.json
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join, relative } from "node:path";
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import { FIXTURES, FONT } from "./fixtures.mjs";
import {
  PIXEL_TOLERANCE,
  PIXEL_TOLERANCE_AA,
  chromiumExpected,
  focusCandidates,
  focusedFrom,
  pixelAt,
  resourceAt,
  scenarioBoxes,
  scenarioJson,
  translate,
} from "./interactions-desktop.mjs";
import { INTERACTIONS } from "./interactions.mjs";
import { writeProject } from "./project.mjs";
import {
  CHROMIUM_ARGS,
  EDGE_PX,
  FONT_FILES,
  IMAGE_FILES,
  SSIM_MIN,
  SSIM_MIN_GLYPHS,
  bar,
  example,
  fontDir,
  here,
  imageDir,
  luminance,
  renderChromiumFixture,
  ssim,
} from "./shared.mjs";

const repo = join(example, "..", "..");
const runtime = join(repo, "packages", "runtime-native", "build", "tn-linux", "mystral");
const packager = join(repo, "packages", "runtime-native", "scripts", "package-desktop.mjs");
const threenative = join(repo, "packages", "create-threenative", "dist", "threenative.js");
const playtestCli = join(repo, "packages", "playtest", "dist", "runner", "cli.js");
const out = join(here, "out-desktop");
/**
 * Where one generated project lives.
 *
 * Under a `dist/` directory on purpose: the repo's Biome config ignores that name, and a generated
 * project is a mirror of a browser page — a fixture's own CSS bytes, an `<img>` with no `alt`, a
 * click handler on a fixture control — none of which is application code and none of which may be
 * rewritten to satisfy a lint rule. `biome.json` itself is outside this corpus's remit, so the
 * generated tree is kept where the existing config already says build output goes.
 */
const projectDir = (name) => join(out, name, "dist");
/**
 * The font sheet `corpus/interaction.mjs` puts in front of a scenario's own CSS, byte for byte: the
 * interaction scenarios declare no @font-face of their own, so this is what their expected pixels
 * were rendered with.
 */
const INTERACTION_FONT =
  "@font-face{font-family:Noto;font-weight:400;src:url(NotoSans-Regular.ttf)}@font-face{font-family:Noto;font-weight:700;src:url(NotoSans-Bold.ttf)}";

const only = process.argv.slice(2);
/** Every fixture except the ones the desktop host cannot express, named in the report. */
const skips = [];
const fixtures = FIXTURES.filter((f) => {
  if (only.length > 0 && !only.includes(f.name)) return false;
  if ((f.dpr ?? 1) !== 1) {
    skips.push({
      name: f.name,
      why: "dpr is not 1: the desktop host attaches the overlay at scale 1.0 and offers no scale input",
    });
    return false;
  }
  return true;
});
const scenarios = INTERACTIONS.filter((s) => only.length === 0 || only.includes(s.name));
if (fixtures.length === 0 && scenarios.length === 0)
  throw new Error("TN_DESKTOP_NO_SUBJECT: no fixture or scenario matches the names given");

/** The playtest that photographs one frame once the UI has had the hud's own settling window. */
function frameScenario(name, [width, height]) {
  return {
    schemaVersion: 1,
    name: `corpus-${name}`,
    target: "desktop",
    viewport: { width, height },
    warmupFrames: 0,
    steps: [{ label: "ui-ready", waitTicks: 120, screenshot: "frame" }],
    artifacts: { console: true, screenshots: true },
    assert: {
      resources: [
        // The run reached its assertions and the loop ran: a host that never ticked has observed
        // nothing, which is not a fixture that painted nothing.
        { id: "GameState", path: "frames", changed: true, gte: 100 },
        { id: "GameState", path: "mounted", atSteps: [{ label: "ui-ready", equals: true }] },
      ],
    },
  };
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

/**
 * Build, package and run one generated project.
 *
 * Only a build that produced no bundle, or a packager that wrote no executable, is a `fail` here; the
 * playtest's own verdict travels back as `played` so each caller can weigh it against the pixels it
 * is about to compare.
 */
function runProject(subject, scenario, listen = [], fontCss = FONT) {
  const dir = projectDir(subject.name);
  writeProject(dir, subject, { fontCss, listen, scenario });
  const build = run(process.execPath, [threenative, "build", "--target", "desktop"], dir);
  // The consumer build installs the published prebuilt host, which has no CSS backend and refuses
  // this game by name (`TN_CSS_UI_HOST_MISSING`), or fails because no prebuilt release exists. Both
  // are the packaging step, not the build: the bundle, the config and the stylesheets are already
  // written, which is all `package-desktop.mjs` reads. Anything else missing below is a real build
  // failure and is reported as one.
  const built = ["game.js", "config.json"].every((file) =>
    existsSync(join(dir, ".threenative", "build", file)),
  );
  const sheets = join(dir, ".threenative", "build", "ui-css");
  if (!built || !existsSync(sheets))
    return { dir, fail: `the consumer build produced no bundle: ${build.output.slice(-600)}` };
  // An image a fixture's *tree* names travels the same way the oracle stages it (flat, by name,
  // beside the stylesheet), because the engine serves one packaged directory and only knows about
  // the assets a stylesheet `url()` declared. `extractUiStylesheets` cannot see an `<img src>`, so
  // without this the whole mutation batch is refused by name and the fixture paints nothing.
  for (const image of IMAGE_FILES) {
    copyFileSync(join(imageDir, image), join(sheets, image));
  }
  const executable = join(dir, "dist-native", `tn-corpus-${subject.name.replaceAll(/-/gu, "")}`);
  const packaged = run(
    process.execPath,
    [
      packager,
      "--bundle",
      ".threenative/build/game.js",
      "--ui",
      ".threenative/build/ui-css",
      "--config",
      ".threenative/build/config.json",
      "--runtime",
      runtime,
      "--output",
      executable,
    ],
    dir,
  );
  if (!existsSync(executable))
    return { dir, fail: `packaging failed: ${packaged.output.slice(-600)}` };
  const artifacts = join(dir, "artifacts", "playtest");
  const played = run(
    process.execPath,
    [
      playtestCli,
      "playtest.json",
      "--target",
      "desktop",
      "--executable",
      executable,
      "--artifacts",
      artifacts,
    ],
    dir,
  );
  const consolePath = join(artifacts, "console.json");
  const console_ = existsSync(consolePath) ? JSON.parse(readFileSync(consolePath, "utf8")) : [];
  const lines = console_.map((entry) => String(entry.text));
  const identity = hostIdentity(lines);
  return { dir, executable, lines, identity, artifacts, played };
}

/**
 * The backend identity, from the host's own log.
 *
 * Same assertions `scripts/verify-desktop.mjs` makes, because they are the whole claim that no web
 * view is involved: the backend line naming the rasteriser, the attach marker, and no line that
 * mentions a web view or a Chromium process. A rejected mutation batch is a silent half-tree, and
 * its absence is an assertion rather than an observation.
 */
function hostIdentity(lines) {
  const backend = lines.find((line) => line.startsWith("ui overlay: native-css backend=blitz-dom"));
  const attached = lines.some((line) =>
    line.startsWith('TN_UI_OVERLAY:{"attached":true,"renderer":"native-css"}'),
  );
  const webView = lines.filter(
    (line) =>
      /webkit|webview|wry|chromium process|TN_UI_LOAD_FAILED/iu.test(line) &&
      !line.includes("no WebView"),
  );
  const rejected = lines.filter((line) => line.includes("TN_CSS_UI_POST_REJECTED"));
  const adapter = lines.find((line) => line.startsWith("[WebGPU] Adapter:"))?.split(": ")[1];
  const vendor = lines.find((line) => line.startsWith("[WebGPU] Vendor:"))?.split(": ")[1];
  const backendName = lines.find((line) => line.startsWith("[WebGPU] Backend:"))?.split(": ")[1];
  const window = lines
    .find((line) => line.startsWith("[Window] Actual window size:"))
    ?.split(": ")[1];
  const version = lines.find((line) => line.startsWith("Version: "))?.slice("Version: ".length);
  const composites = lines.filter((line) => line.startsWith("TN_UI_COMPOSITE:"));
  const uploads =
    composites.length === 0
      ? 0
      : Math.max(...composites.map((line) => Number(JSON.parse(line.slice(16)).uploads)));
  const errors = lines.filter((line) => /^\[(?:error|Error)\]/u.test(line.trimStart()));
  const problems = [];
  if (backend === undefined) problems.push("no native-css backend line");
  if (!attached) problems.push('no TN_UI_OVERLAY:{"attached":true,"renderer":"native-css"}');
  if (webView.length > 0) problems.push(`web view mentioned: ${webView[0].slice(0, 120)}`);
  if (rejected.length > 0) problems.push(`${rejected.length} TN_CSS_UI_POST_REJECTED line(s)`);
  if (errors.length > 0) problems.push(`host error: ${errors[0].slice(0, 160)}`);
  return {
    backend,
    attached,
    webView: webView.length,
    rejected: rejected.length,
    uploads,
    composites: composites.length,
    adapter,
    vendor,
    gpuBackend: backendName,
    window,
    version,
    problems,
    tail: lines.slice(-8).join(" | ").slice(0, 600),
    ok: problems.length === 0,
  };
}

/**
 * The harness's blank-capture guard, re-applied here so a tripped guard is reported rather than
 * hidden.
 *
 * `assertCaptureNotBlank` refuses a capture with fewer than 8 distinct colours. That floor is written
 * for a game frame, where lighting and gradients always produce many; a CSS corpus fixture is flat
 * by construction (`breakpoints-narrow` is two colours: the page background and one box), so the
 * floor rejects correct captures and stops the run before its assertions. This driver re-applies the
 * guard's other two conditions in full — a frame with no luminance variance, or with no bright pixels
 * and no dark-frame variation, is blank here exactly as it is there — and reports the colour count
 * instead of enforcing it. The colour floor is the one condition that is not enforced, because the
 * SSIM comparison against Chromium is a stronger statement about the same pixels than any count of
 * them: a capture that lost its UI scores far below the bar rather than passing quietly.
 */
const GUARD_COLOUR_FLOOR = 8;
function captureStats(png) {
  const colors = new Set();
  let visible = 0;
  let bright = 0;
  let total = 0;
  let squared = 0;
  let max = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    colors.add(
      ((png.data[i] << 24) | (png.data[i + 1] << 16) | (png.data[i + 2] << 8) | png.data[i + 3]) >>>
        0,
    );
    if (png.data[i + 3] === 0) continue;
    const luminance =
      (0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]) / 255;
    visible += 1;
    if (luminance > 0.05) bright += 1;
    max = Math.max(max, luminance);
    total += luminance;
    squared += luminance * luminance;
  }
  const mean = visible === 0 ? 0 : total / visible;
  const stats = {
    distinctColors: colors.size,
    brightPixelRatio: png.data.length === 0 ? 0 : bright / (png.data.length / 4),
    luminanceStdDev: Math.sqrt(Math.max(0, squared / visible - mean * mean)),
    maxLuminance: max,
  };
  const darkFrameVariation =
    stats.distinctColors >= 32 && stats.luminanceStdDev >= 0.02 && stats.maxLuminance <= 0.5;
  return {
    ...stats,
    uniform: stats.luminanceStdDev < 0.01 || (stats.brightPixelRatio < 0.05 && !darkFrameVariation),
  };
}

/**
 * One interaction scenario: the oracle's expected observations, a playtest that walks the script over
 * the grammar the desktop runner has, and a comparison of every observation the host can be asked
 * for.
 *
 * A scenario whose every observation is unreachable is a failure, not a quiet skip: the run reached
 * nothing to compare, which is the empty-observation case the rules name.
 */
async function runInteraction(scenario, browser) {
  const entry = {
    name: scenario.name,
    kind: "interaction",
    size: scenario.size,
    mismatches: [],
    comparedObservations: [],
    skippedObservations: [],
  };
  const names = [scenario.name];
  const expected = chromiumExpected(names).get(scenario.name);
  const samplePoints = scenario.script
    .filter((step) => step.obs === "pixel")
    .map((step) => ({ x: step.x, y: step.y }));
  const { boxes, samples } = await scenarioBoxes(browser, scenario, samplePoints);
  const translated = translate(scenario, expected, { samples });
  entry.observations = translated.observations.length;
  entry.skipped = translated.observations.filter((item) => item.why !== undefined).length;
  if (translated.observations.every((item) => item.why !== undefined)) {
    skips.push({ name: scenario.name, why: translated.observations[0].why });
    return {
      ...entry,
      pass: false,
      compared: 0,
      why: `nothing comparable: ${translated.observations[0].why}`,
    };
  }
  const listen = scenario.listen ?? [];
  let run_ = runProject(
    scenario,
    scenarioJson(scenario, translated, expected),
    listen,
    INTERACTION_FONT,
  );
  entry.playtestExit = run_.played.status;
  if (run_.fail !== undefined) return { ...entry, pass: false, compared: 0, why: run_.fail };
  entry.identity = {
    backend: run_.identity.backend,
    attached: run_.identity.attached,
    webView: run_.identity.webView,
    rejected: run_.identity.rejected,
    problems: run_.identity.problems,
  };
  const artifacts = run_.artifacts;
  const read = (name) => {
    const file = join(artifacts, `${name}.png`);
    return existsSync(file) ? PNG.sync.read(readFileSync(file)) : undefined;
  };
  const baseline = read("baseline") ?? read("final");
  const candidates = focusCandidates(scenario.tree);
  const parses = (output) => {
    try {
      return JSON.parse(output.slice(output.indexOf("{")));
    } catch {
      return undefined;
    }
  };
  let runnerReport = parses(run_.played.output);
  // The runner refuses a capture with fewer than eight distinct colours, which a flat corpus scenario
  // cannot have, and the refusal aborts the whole run — including the report its observations would
  // have been in. The file is written before the guard reads it, so the frame survives; the state
  // observations need a second run of the same script with no screenshot at all.
  const tripped = run_.played.status !== 0 && run_.played.output.includes("TN_CAPTURE_BLANK");
  const stats = captureStats(read("final") ?? baseline ?? new PNG({ width: 1, height: 1 }));
  if (tripped) {
    if (stats.uniform)
      return {
        ...entry,
        pass: false,
        compared: 0,
        why: `the runner's blank-capture guard fired and the frame is uniform in luminance: nothing painted`,
      };
    entry.obstruction = `the runner's blank-capture guard (${stats.distinctColors} distinct colours, floor ${GUARD_COLOUR_FLOOR})`;
    const withoutShots = translate(scenario, expected, { screenshots: false });
    const second = runProject(
      scenario,
      scenarioJson(scenario, withoutShots, expected),
      listen,
      INTERACTION_FONT,
    );
    entry.rerunExit = second.played.status;
    if (second.played.status !== 0)
      return {
        ...entry,
        pass: false,
        compared: 0,
        why: `the rerun without screenshots exited ${second.played.status}: ${second.played.output.slice(-400)}`,
      };
    run_ = second;
    runnerReport = parses(second.played.output);
    entry.identity.problems = second.identity.problems;
  } else if (run_.played.status !== 0) {
    return { ...entry, pass: false, compared: 0, why: `the playtest exited ${run_.played.status}` };
  }
  let compared = 0;
  for (const item of translated.observations) {
    const want = expected[item.index];
    if (item.why !== undefined) {
      entry.skippedObservations.push({ index: item.index, why: item.why });
      continue;
    }
    let actual;
    let why;
    if (item.obs === "focus" || item.obs === "pixel") {
      const capture = read(item.label);
      if (capture === undefined) {
        entry.mismatches.push({
          index: item.index,
          obs: item.obs,
          expected: want,
          actual: null,
          why: `no capture at ${item.label}: ${
            tripped
              ? "the run stopped on the capture guard before this point"
              : "the host wrote no file"
          }`,
        });
        continue;
      }
      if (item.obs === "focus") {
        const decoded = focusedFrom(baseline, capture, boxes, candidates);
        actual = decoded.focused;
        why = decoded.why;
      } else actual = pixelAt(capture, item.at[0], item.at[1]);
    } else {
      const ledger = resourceAt(runnerReport, item.label, "clicks");
      if (ledger === undefined) why = `the runner recorded no GameState.clicks at ${item.label}`;
      actual = ledger === undefined ? null : ledger.split(",").filter(Boolean).map(Number);
    }
    compared += 1;
    entry.comparedObservations.push({ index: item.index, obs: item.obs, expected: want, actual });
    const same =
      item.obs === "pixel"
        ? Array.isArray(actual) &&
          actual.every((value, i) => Math.abs(value - want[i]) <= PIXEL_TOLERANCE)
        : actual !== null && JSON.stringify(actual) === JSON.stringify(want);
    if (same) continue;
    const wider =
      item.obs === "pixel" &&
      Array.isArray(actual) &&
      actual.every((value, i) => Math.abs(value - want[i]) <= PIXEL_TOLERANCE_AA);
    entry.mismatches.push({
      index: item.index,
      obs: item.obs,
      at: item.at,
      expected: want,
      actual,
      ...(wider
        ? {
            note: `within the ${PIXEL_TOLERANCE_AA} anti-aliased-edge tolerance, not the ${PIXEL_TOLERANCE} one`,
          }
        : {}),
      ...(why === undefined ? {} : { why }),
    });
  }
  entry.compared = compared;
  entry.pass = entry.mismatches.length === 0 && run_.identity.ok;
  if (!run_.identity.ok) entry.why = `host identity: ${run_.identity.problems.join("; ")}`;
  else if (entry.mismatches.length > 0)
    entry.why = `${entry.mismatches.length} observation(s) differ from Chromium`;
  return entry;
}

const report = [];
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

rmSync(out, { force: true, recursive: true });
mkdirSync(join(out, "chromium"), { recursive: true });
const browser = await chromium.launch({ args: CHROMIUM_ARGS });
const chromiumVersion = browser.version();
try {
  for (const fixture of fixtures) {
    const [width, height] = fixture.size;
    const dir = join(out, "chromium", fixture.name);
    mkdirSync(dir, { recursive: true });
    const { chrome } = await renderChromiumFixture(browser, fixture, dir, FONT);
    const run_ = runProject(fixture, frameScenario(fixture.name, fixture.size));
    if (run_.fail !== undefined) {
      report.push({ name: fixture.name, kind: "fixture", pass: false, why: run_.fail });
      console.log(`FAIL ${fixture.name}: ${run_.fail.split("\n")[0].slice(0, 200)}`);
      continue;
    }
    const capturePath = join(run_.artifacts, "frame.png");
    if (!existsSync(capturePath)) {
      const why = `the run left no capture (playtest exit ${run_.played.status}): ${run_.identity.tail}`;
      report.push({ name: fixture.name, kind: "fixture", pass: false, why });
      console.log(`FAIL ${fixture.name}: ${why.split(" | ")[0].slice(0, 200)}`);
      continue;
    }
    if (run_.played.status !== 0 && !run_.played.output.includes("TN_CAPTURE_BLANK")) {
      const why = `the playtest failed (exit ${run_.played.status}): ${run_.played.output.slice(-600)}`;
      report.push({ name: fixture.name, kind: "fixture", pass: false, why });
      console.log(`FAIL ${fixture.name}: ${why.split("\n")[0].slice(0, 200)}`);
      continue;
    }
    const capture = PNG.sync.read(readFileSync(capturePath));
    const expected = PNG.sync.read(readFileSync(chrome));
    const stats = captureStats(capture);
    const entry = {
      name: fixture.name,
      kind: "fixture",
      size: fixture.size,
      captureSize: [capture.width, capture.height],
      ssimMin: bar(fixture),
      playtestExit: run_.played.status,
      capture: { distinctColors: stats.distinctColors, uniform: stats.uniform },
      identity: {
        backend: run_.identity.backend,
        attached: run_.identity.attached,
        webView: run_.identity.webView,
        rejected: run_.identity.rejected,
        uploads: run_.identity.uploads,
        version: run_.identity.version,
        adapter: run_.identity.adapter,
        vendor: run_.identity.vendor,
        gpuBackend: run_.identity.gpuBackend,
        window: run_.identity.window,
        problems: run_.identity.problems,
      },
    };
    if (capture.width !== width || capture.height !== height) {
      entry.why = `the capture is ${capture.width}x${capture.height}, not the fixture's ${width}x${height}`;
      entry.pass = false;
    } else {
      const score = ssim(luminance(expected), luminance(capture), width, height);
      entry.ssim = Number(score.toFixed(4));
      // Where `corpus/oracle.mjs` has already rendered this fixture through the crate's own `oracle`
      // example, the same comparison against that raster separates "the desktop host integration" from
      // "the engine": a host frame identical to the crate's is a difference the engine already had.
      const crateRaster = join(here, "out", fixture.name, "native.png");
      if (existsSync(crateRaster)) {
        const crateImage = PNG.sync.read(readFileSync(crateRaster));
        if (crateImage.width === width && crateImage.height === height)
          entry.engineCrossCheck = {
            source: crateRaster,
            ssim: Number(ssim(luminance(capture), luminance(crateImage), width, height).toFixed(4)),
          };
      }
      // The runner refused the capture only when its own blank-capture guard tripped. The guard's
      // colour floor is the one condition this corpus cannot satisfy by construction; every other
      // condition is re-applied above, and a capture that really lost its UI is caught by them and
      // by the SSIM bar together.
      const obstruction =
        run_.played.status !== 0 && stats.distinctColors < GUARD_COLOUR_FLOOR && !stats.uniform
          ? `the runner's blank-capture guard (${stats.distinctColors} distinct colours, floor ${GUARD_COLOUR_FLOOR})`
          : undefined;
      if (obstruction !== undefined) entry.obstruction = obstruction;
      entry.pass =
        score >= bar(fixture) &&
        run_.identity.ok &&
        (run_.played.status === 0 || obstruction !== undefined);
      if (!run_.identity.ok) entry.why = `host identity: ${run_.identity.problems.join("; ")}`;
      else if (score < bar(fixture))
        entry.why = `SSIM ${entry.ssim} is below the ${bar(fixture)} bar`;
      else if (stats.uniform) entry.why = "the capture is uniform in luminance: nothing painted";
      else if (run_.played.status !== 0 && obstruction === undefined)
        entry.why = `the playtest exited ${run_.played.status}`;
    }
    report.push(entry);
    console.log(
      `${entry.pass ? "PASS " : "FAIL "} ${fixture.name}  ${fixture.size.join("x")}  ssim=${entry.ssim ?? "-"} bar=${entry.ssimMin} colours=${entry.capture.distinctColors}${entry.obstruction === undefined ? "" : "  (guard)"}`,
    );
  }

  for (const scenario of scenarios) {
    const entry = await runInteraction(scenario, browser);
    report.push(entry);
    console.log(
      `${entry.pass ? "PASS " : "FAIL "} ${entry.name}  ${entry.observations} observations, ${entry.compared} compared, ${entry.skipped} not expressible, ${entry.mismatches.length} mismatch(es)`,
    );
  }
} finally {
  await browser.close();
}

const failed = report.filter((entry) => !entry.pass);
const fixtureRows = report.filter((entry) => entry.kind === "fixture");
const interactionRows = report.filter((entry) => entry.kind === "interaction");
const first = report.find((entry) => entry.identity?.backend !== undefined);

const summary = {
  generatedAt: new Date().toISOString(),
  subject: "the desktop host through packages/playtest",
  totals: {
    fixtures: `${fixtureRows.filter((entry) => entry.pass).length}/${fixtureRows.length}`,
    interactions: `${interactionRows.filter((entry) => entry.pass).length}/${interactionRows.length}`,
    failed: failed.map((entry) => entry.name),
    skipped: skips,
  },
  report,
  skips,
};
writeFileSync(join(out, "report.json"), JSON.stringify(summary, null, 2));
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest(), null, 2)}\n`);
// The two report files are the only files under `out-desktop/` the repo's own tooling reads, so they
// are written in the shape it formats to.
// Relative, because this checkout lives under `.worktrees/`, which the repo's Biome config ignores:
// an absolute path matches that pattern and Biome then processes no files at all.
run("node_modules/.bin/biome", ["check", "--write", relative(repo, out)], repo);

/** What a reader has to be able to check the numbers against: the host, the adapter, the oracle, the bars. */
function manifest() {
  const identity = first?.identity ?? {};
  return {
    generatedAt: summary.generatedAt,
    host: {
      binary: runtime,
      sha256: sha(readFileSync(runtime)),
      version: identity.version,
      cssBackend: identity.backend,
      adapter: identity.adapter,
      vendor: identity.vendor,
      gpuBackend: identity.gpuBackend,
      firstWindow: identity.window,
    },
    os: { platform: process.platform, release: os.release(), pretty: osRelease() },
    chromium: { version: chromiumVersion, args: CHROMIUM_ARGS },
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    thresholds: {
      ssim: SSIM_MIN,
      ssimGlyphs: SSIM_MIN_GLYPHS,
      edgePx: EDGE_PX,
      pixelTolerance: PIXEL_TOLERANCE,
      pixelToleranceAA: PIXEL_TOLERANCE_AA,
      blankCaptureColourFloor: GUARD_COLOUR_FLOOR,
    },
    fonts: Object.fromEntries(FONT_FILES.map((f) => [f, sha(readFileSync(join(fontDir, f)))])),
    images: Object.fromEntries(IMAGE_FILES.map((f) => [f, sha(readFileSync(join(imageDir, f)))])),
    fixtures: Object.fromEntries(
      fixtures.map((f) => [
        f.name,
        { size: f.size, dpr: f.dpr ?? 1, source: sha(JSON.stringify([f.css, f.tree])) },
      ]),
    ),
  };
}

const pad = (text, width) => String(text).padEnd(width);
/** The distribution name a reader needs to know which machine produced these numbers. */
function osRelease() {
  const file = join("/etc", "os-release");
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((row) => row.startsWith("PRETTY_NAME="));
  return line?.slice("PRETTY_NAME=".length).replaceAll('"', "") ?? undefined;
}
console.log("");
console.log(
  `${pad("fixture", 30)} ${pad("size", 9)} ${pad("ssim", 7)} ${pad("bar", 5)} ${pad("colours", 8)} verdict`,
);
for (const entry of fixtureRows) {
  console.log(
    `${pad(entry.name, 30)} ${pad(entry.size.join("x"), 9)} ${pad(entry.ssim ?? "-", 7)} ${pad(entry.ssimMin, 5)} ${pad(entry.capture?.distinctColors ?? "-", 8)} ${entry.pass ? "pass" : `FAIL: ${entry.why ?? "obstruction only"}`}${entry.obstruction === undefined ? "" : " [capture-guard floor]"}`,
  );
}
console.log("");
console.log(`${pad("scenario", 34)} ${pad("obs", 4)} ${pad("cmp", 4)} ${pad("skip", 5)} verdict`);
for (const entry of interactionRows) {
  console.log(
    `${pad(entry.name, 34)} ${pad(entry.observations, 4)} ${pad(entry.compared, 4)} ${pad(entry.skipped, 5)} ${entry.pass ? "pass" : `FAIL: ${entry.why}`}`,
  );
}
console.log("");
console.log(
  `${summary.totals.fixtures} fixtures within the SSIM bars, ${summary.totals.interactions} interaction scenarios matching Chromium`,
);
for (const skip of skips) console.log(`SKIP ${skip.name}: ${skip.why}`);
process.exit(failed.length === 0 ? 0 : 1);
