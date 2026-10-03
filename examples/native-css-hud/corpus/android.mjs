#!/usr/bin/env node
/**
 * The Core HUD corpus on an Android device or emulator, through the playtest runner.
 *
 * The desktop harness (`desktop.mjs`) packages one host per fixture. An Android package is a Gradle
 * build, and every fixture would recompile the same runtime, so this takes the runtime once — the
 * HUD's own APK, built from a runtime source checkout with the CSS UI linked — and swaps in each
 * fixture's game bundle and `ui-css` directory (`assets/scripts/main.js`, `assets/ui/`), re-aligns
 * and re-signs it with the debug key, installs it, and runs a one-frame playtest
 * `--target android`. The capture is compared with the Chromium screenshot `shared.mjs` renders from
 * the same fixture data, with the oracle's own SSIM arithmetic and bars: this changes the subject,
 * never the measure.
 *
 * Each run also asserts the identity from the app's own logcat lines: the native-css backend line,
 * the attach marker, no web view, no rejected mutation batch.
 *
 * Fixtures only: interaction scenarios need keys, which the Android runner cannot inject. A fixture
 * whose dpr is not 1, whose viewport is portrait (the HUD APK is locked to landscape), or whose short
 * edge is under the 200 px Android allows a display override, is skipped by name.
 *
 * Usage: node corpus/android.mjs --apk <hud.apk> [--device emulator-5554] [fixture ...]
 * Output: artifacts/corpus-android/ (gitignored) + report.json
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import { FIXTURES, FONT } from "./fixtures.mjs";
import { writeProject } from "./project.mjs";
import {
  CHROMIUM_ARGS,
  IMAGE_FILES,
  bar,
  example,
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

const skips = [];
const fixtures = FIXTURES.filter((fixture) => {
  if (only.length > 0 && !only.includes(fixture.name)) return false;
  const [width, height] = fixture.size;
  if ((fixture.dpr ?? 1) !== 1)
    skips.push({ name: fixture.name, why: "dpr is not 1: the runner presents density 160 only" });
  else if (height > width)
    skips.push({
      name: fixture.name,
      why: "portrait viewport: the HUD APK is locked to landscape",
    });
  else if (Math.min(width, height) < 200)
    skips.push({
      name: fixture.name,
      why: "an edge under 200 px: Android's WindowManager clamps a forced display size to at least 200 px (asked 160x320, device reported 200x320)",
    });
  else return true;
  return false;
});
if (fixtures.length === 0) throw new Error("TN_ANDROID_CORPUS_NO_SUBJECT: no fixture matches");
if (!existsSync(apk)) throw new Error(`TN_ANDROID_CORPUS_APK_MISSING: ${apk}`);

// The runner reads the SDK from the environment and calls `adb` by name.
process.env.ANDROID_HOME = sdk;
process.env.PATH = `${join(sdk, "platform-tools")}:${process.env.PATH}`;

function run(command, argv, cwd = example) {
  const result = spawnSync(command, argv, {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** The HUD APK with this fixture's bundle and stylesheets in place of the HUD's, aligned and signed. */
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
  return {
    pid,
    ownLines: own.length,
    webView: webView.length,
    rejected: rejected.length,
    problems,
    ok: problems.length === 0,
  };
}

const report = [];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: CHROMIUM_ARGS });
try {
  for (const fixture of fixtures) {
    const [width, height] = fixture.size;
    const root = join(out, fixture.name);
    rmSync(root, { force: true, recursive: true });
    const chromeDir = join(root, "chromium");
    mkdirSync(chromeDir, { recursive: true });
    const { chrome } = await renderChromiumFixture(browser, fixture, chromeDir, FONT);
    // Under `dist/` for the reason `desktop.mjs` gives: Biome ignores the name, and generated fixture
    // markup is not application code.
    const dir = join(root, "dist");
    writeProject(dir, fixture, {
      fontCss: FONT,
      scenario: {
        schemaVersion: 1,
        name: `corpus-${fixture.name}`,
        // The scenario schema names the native runner "desktop"; `--target android` picks the device.
        target: "desktop",
        viewport: { width, height },
        warmupFrames: 0,
        steps: [{ label: "ui-ready", waitTicks: 120, screenshot: "frame" }],
        artifacts: { console: true, screenshots: true },
        assert: {
          resources: [
            { id: "GameState", path: "frames", changed: true, gte: 100 },
            { id: "GameState", path: "mounted", atSteps: [{ label: "ui-ready", equals: true }] },
          ],
        },
      },
    });
    // The consumer build writes the Android bundle and `ui-css`, then stops at packaging (this run
    // packages by swapping); a missing bundle afterwards is a real build failure.
    const build = run(process.execPath, [threenative, "build", "--target", "android"], dir);
    if (
      !existsSync(join(dir, ".threenative", "build", "game.js")) ||
      !existsSync(join(dir, ".threenative", "build", "ui-css"))
    ) {
      report.push({
        name: fixture.name,
        pass: false,
        why: `build produced no bundle: ${build.output.slice(-400)}`,
      });
      console.log(`FAIL ${fixture.name}: build`);
      continue;
    }
    const swapped = swapApk(dir);
    if (swapped.fail !== undefined) {
      report.push({ name: fixture.name, pass: false, why: swapped.fail });
      console.log(`FAIL ${fixture.name}: ${swapped.fail.slice(0, 200)}`);
      continue;
    }
    const installed = run(adb, ["-s", device, "install", "-r", swapped.signed]);
    if (installed.status !== 0) {
      report.push({
        name: fixture.name,
        pass: false,
        why: `install failed: ${installed.output.slice(-300)}`,
      });
      continue;
    }
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
    // starts, and a flat fixture that trips its blank-capture guard aborts before writing the file.
    const lines = run(adb, ["-s", device, "logcat", "-d", "-v", "brief"]).output.split("\n");
    const id = identity(lines);
    const capturePath = join(artifacts, "frame.png");
    const entry = {
      name: fixture.name,
      size: fixture.size,
      ssimMin: bar(fixture),
      playtestExit: played.status,
      identity: id,
    };
    if (!existsSync(capturePath)) {
      entry.pass = false;
      entry.why = `no capture (playtest exit ${played.status}): ${played.output.slice(-400)}`;
    } else {
      const capture = PNG.sync.read(readFileSync(capturePath));
      const expected = PNG.sync.read(readFileSync(chrome));
      entry.captureSize = [capture.width, capture.height];
      if (capture.width !== width || capture.height !== height) {
        entry.pass = false;
        entry.why = `the capture is ${capture.width}x${capture.height}, not ${width}x${height}`;
      } else {
        entry.ssim = Number(
          ssim(luminance(expected), luminance(capture), width, height).toFixed(4),
        );
        const crateRaster = join(example, "corpus", "out", fixture.name, "native.png");
        if (existsSync(crateRaster)) {
          const crate = PNG.sync.read(readFileSync(crateRaster));
          if (crate.width === width && crate.height === height)
            entry.engineCrossCheck = Number(
              ssim(luminance(capture), luminance(crate), width, height).toFixed(4),
            );
        }
        // The runner's blank-capture guard (fewer than 8 colours) can refuse a flat fixture whose
        // frame is correct; the SSIM bar is the stronger statement about the same pixels.
        const guard = played.status !== 0 && played.output.includes("TN_CAPTURE_BLANK");
        entry.pass = entry.ssim >= entry.ssimMin && id.ok && (played.status === 0 || guard);
        if (guard) entry.obstruction = "the runner's blank-capture colour floor";
        if (!id.ok) entry.why = `identity: ${id.problems.join("; ")}`;
        else if (entry.ssim < entry.ssimMin)
          entry.why = `SSIM ${entry.ssim} is below the ${entry.ssimMin} bar`;
        else if (played.status !== 0 && !guard) entry.why = `the playtest exited ${played.status}`;
      }
    }
    report.push(entry);
    console.log(
      `${entry.pass ? "PASS" : "FAIL"} ${fixture.name} ${fixture.size.join("x")} ssim=${entry.ssim ?? "-"} bar=${entry.ssimMin}${entry.why ? ` (${entry.why.slice(0, 160)})` : ""}`,
    );
  }
} finally {
  await browser.close();
}
const passed = report.filter((entry) => entry.pass).length;
writeFileSync(
  join(out, "report.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), device, apk, totals: `${passed}/${report.length}`, skips, report }, null, 2)}\n`,
);
console.log(`${passed}/${report.length} fixtures within the SSIM bars on ${device}`);
for (const skip of skips) console.log(`SKIP ${skip.name}: ${skip.why}`);
// Generated APKs are large; keep the captures and the report, drop the packages.
for (const { name } of fixtures)
  for (const file of ["unsigned.apk", "fixture.apk"])
    rmSync(join(out, name, "dist", file), { force: true });
process.exit(passed === report.length ? 0 : 1);
