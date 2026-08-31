#!/usr/bin/env node

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";

import { inspectOverlay, inspectScreenshot } from "./verify-desktop-core.mjs";
import { run as sharedRun } from "./native-test-lane.mjs";

const runtimeRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const workspaceRoot = join(runtimeRoot, "..", "..");
const exampleRoot = join(workspaceRoot, "examples", "native-smoke");
const bundle = join(exampleRoot, "dist", "native-smoke.js");
const scenario = join(exampleRoot, "playtests", "loading-screen-desktop.playtest.json");
const FIXED_STEP_WALL_WAITS_MS = [0, 1_000, 3_000];
const LOADING_PROOF_BACKDROP_COLOR = 0x101820;

// The shared runner, not a second copy of it. This was the only script here carrying its own, and
// it was the only one that still died on `spawnSync pnpm ENOENT` once the Windows leg reached it:
// npm-published CLIs are `.cmd` shims there and `spawnSync` does not apply PATHEXT. The shared
// `run` already retries as a shim under a shell; the only thing local about this one was that its
// cwd defaults to the workspace rather than the package.
function run(command, args, options = {}) {
  return sharedRun(command, args, { ...options, cwd: options.cwd ?? workspaceRoot });
}

function nativeBinary() {
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

function buildLoadingBundle() {
  return run("pnpm", ["--dir", exampleRoot, "exec", "vite", "build", "--config", "vite.config.ts"], {
    env: {
      ...process.env,
      THREENATIVE_JS_PROFILE_FRUSTUM: "contain",
      THREENATIVE_JS_PROFILE_MATERIALS: "distinct",
      THREENATIVE_JS_PROFILE_MESHES: "400",
      THREENATIVE_JS_PROFILE_VISIBILITY: "1",
      THREENATIVE_LOADING_PROOF: "enabled",
      THREENATIVE_NATIVE_BACKEND: "enabled",
      THREENATIVE_PLAYTEST_BRIDGE: "enabled",
    },
  });
}

function buildSmokeBundle() {
  return run("pnpm", ["--filter", "threenative-native-smoke", "build"]);
}

function countColor(path, color = LOADING_PROOF_BACKDROP_COLOR) {
  const png = PNG.sync.read(readFileSync(path));
  const red = (color >> 16) & 0xff;
  const green = (color >> 8) & 0xff;
  const blue = color & 0xff;
  let matched = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    if (png.data[index] === red && png.data[index + 1] === green && png.data[index + 2] === blue) {
      matched += 1;
    }
  }
  return matched;
}

function inspectDismissedLoadingSurface(path) {
  const loadingPixels = countColor(path);
  if (loadingPixels >= 256) {
    throw new Error(
      `loading surface was still visible in settled screenshot ${path}: ${loadingPixels} backdrop pixels`,
    );
  }
  return { loadingPixels };
}

function requireMarkers(consolePath) {
  if (!existsSync(consolePath)) throw new Error(`native loading proof console artifact is missing: ${consolePath}`);
  const entries = JSON.parse(readFileSync(consolePath, "utf8"));
  const lines = entries.map((entry) => String(entry.text));
  const required = [
    "TN_LOADING_PROOF_OVERLAY_VISIBLE",
    "TN_LOADING_PROOF_COMPILE_START",
    "TN_LOADING_PROOF_COMPILE_END:",
    "TN_LOADING_PROOF_DISMISSED",
  ];
  for (const marker of required) {
    if (!lines.some((line) => line.includes(marker))) throw new Error(`native loading proof missed ${marker}`);
  }
  const compileStart = lines.findIndex((line) => line.includes("TN_LOADING_PROOF_COMPILE_START"));
  const compileEnd = lines.findIndex((line) => line.includes("TN_LOADING_PROOF_COMPILE_END:"));
  const presentedDuringStall = lines.slice(compileStart + 1, compileEnd).some((line) => {
    if (!line.startsWith("TN_PRESENTS_TICK:")) return false;
    try {
      return Number(JSON.parse(line.slice("TN_PRESENTS_TICK:".length)).frames) >= 60;
    } catch {
      return false;
    }
  });
  if (!presentedDuringStall) throw new Error("native loading proof observed no 60-frame present tick during compile stall");
  return lines.filter((line) =>
    line.includes("TN_LOADING_PROOF_")
    || line.includes("TN_STARTUP_WARMUP:")
    || line.startsWith("TN_PRESENTS_TICK:"));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function addNativeStallTiming(transport) {
  let advanceCount = 0;
  return {
    capabilities: transport.capabilities,
    async call(method, argument) {
      if (method === "advance") {
        const waitMs = FIXED_STEP_WALL_WAITS_MS[advanceCount];
        if (waitMs === undefined) {
          throw new Error(`loading proof advanced more than ${FIXED_STEP_WALL_WAITS_MS.length} fixed-step samples`);
        }
        advanceCount += 1;
        if (waitMs > 0) await delay(waitMs);
      }
      return transport.call(method, argument);
    },
    close: () => transport.close(),
    start: () => transport.start(),
    waitForBridge: (timeoutMs) => transport.waitForBridge(timeoutMs),
  };
}

async function runLoadingPlaytest() {
  const playtest = await import(
    pathToFileURL(join(workspaceRoot, "packages", "playtest", "dist", "runner", "index.js")).href,
  );
  const binary = nativeBinary();
  for (const [label, path] of [
    ["native runtime binary", binary],
    ["loading proof bundle", bundle],
    ["loading proof scenario", scenario],
  ]) {
    if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  }

  const artifactDirectory = join(
    runtimeRoot,
    "artifacts",
    `desktop-loading-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}`,
  );
  const mailboxRoot = mkdtempSync(join(runtimeRoot, "desktop-loading-mailbox-"));
  mkdirSync(artifactDirectory, { recursive: true });
  const paths = playtest.deviceMailboxPaths(mailboxRoot);
  const driver = new playtest.DesktopPlaytestDriver({
    args: ["run", bundle],
    cwd: exampleRoot,
    executable: binary,
    mailboxRoot,
  });
  const transport = new playtest.DeviceMailboxTransport(new playtest.LocalDeviceMailbox(), paths, 30_000);
  // The scenario stays fixed-tick by contract. This proof-only transport decorator inserts
  // real wall time between native advances so the screenshots cover the asynchronous compile
  // stall; it does not add a wall-clock step to the shared playtest runner.
  const timedTransport = addNativeStallTiming(transport);
  const config = {
    artifactDirectory,
    desktop: { executable: binary },
    endpoint: "http://127.0.0.1:41777/playtest",
    headless: true,
    mailboxRoot,
    projectPath: exampleRoot,
    scenarioPath: scenario,
    target: "desktop",
    timeoutMs: 30_000,
    trace: false,
    url: binary,
  };

  try {
    const report = await playtest.runDevicePlaytest(config, {
      driver,
      mailboxPaths: paths,
      name: "desktop",
      processName: binary,
      transport: timedTransport,
    });
    if (!report.pass) {
      throw new Error(`native loading playtest failed: ${JSON.stringify(report, null, 2)}`);
    }
    const startupScreenshot = join(artifactDirectory, "startup-stall.png");
    const midScreenshot = join(artifactDirectory, "startup-mid-stall.png");
    const settledScreenshot = join(artifactDirectory, "startup-settled.png");
    const consolePath = join(artifactDirectory, "console.json");
    inspectScreenshot(startupScreenshot);
    const startupSurface = inspectOverlay(startupScreenshot, {
      color: LOADING_PROOF_BACKDROP_COLOR,
    });
    inspectScreenshot(midScreenshot);
    const midSurface = inspectOverlay(midScreenshot, {
      color: LOADING_PROOF_BACKDROP_COLOR,
    });
    inspectScreenshot(settledScreenshot);
    const settledSurface = inspectDismissedLoadingSurface(settledScreenshot);
    const markers = requireMarkers(consolePath);
    const evidence = {
      artifactDirectory,
      host: process.platform,
      markers,
      pass: true,
      screenshots: {
        settled: { ...settledSurface, path: settledScreenshot },
        midStall: { loadingPixels: midSurface.overlayPixels, path: midScreenshot },
        startup: { loadingPixels: startupSurface.overlayPixels, path: startupScreenshot },
      },
    };
    writeFileSync(join(artifactDirectory, "loading-proof.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    return evidence;
  } finally {
    rmSync(mailboxRoot, { force: true, recursive: true });
  }
}

async function main() {
  if (process.platform === "linux" && process.env.DISPLAY === undefined) {
    throw new Error("desktop loading proof requires DISPLAY; run it through scripts/xvfb.sh");
  }
  buildLoadingBundle();
  let proofError;
  let restoreError;
  try {
    const evidence = await runLoadingPlaytest();
    console.info(
      `desktop loading playtest proof passed: ${evidence.screenshots.startup.loadingPixels} startup loading pixels, ${evidence.screenshots.settled.loadingPixels} settled loading pixels`,
    );
    console.info(`desktop loading proof artifacts: ${evidence.artifactDirectory}`);
  } catch (error) {
    proofError = error;
  } finally {
    try {
      buildSmokeBundle();
    } catch (error) {
      restoreError = error;
    }
  }
  if (restoreError !== undefined) throw new AggregateError([proofError, restoreError], "desktop loading proof cleanup failed");
  if (proofError !== undefined) throw proofError;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
