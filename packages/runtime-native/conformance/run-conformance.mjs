#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVITY,
  APP_ID,
  analyzeAppLog,
  assertPackagedAndroidBundle,
  discoverTools,
  filterAppLog,
  inspectScreenshot,
  parseAdbDevices,
  selectDevice,
} from "../scripts/verify-android-first-proof.mjs";
import { compareCaptures, inspectCapture } from "./metrics.mjs";

const REPORT_SCHEMA_VERSION = "0.2.0";
const REGISTRY_SCHEMA_VERSION = "0.1.0";
const runtimeRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(runtimeRoot, "..", "..");
const runnerPath = fileURLToPath(import.meta.url);

function usage() {
  return `Usage: node conformance/run-conformance.mjs [options]

  --target web|desktop|android|all  Run one lane or the full matrix (default: all)
  --only-tests id,id               Run selected rows; every other row is blocked
  --reference DIR                  Browser capture directory for native comparison
  --device SERIAL                  Android emulator/device serial
  --out PATH                       Report file or artifact directory
  --dry-run                        Validate and bundle without target execution
  --validate-report PATH           Validate an existing report
  --help                           Show this help without executing a lane
`;
}

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  if (!argv[index + 1] || argv[index + 1].startsWith("--"))
    throw new Error(`${flag} requires a value`);
  return argv[index + 1];
}

function loadRegistry() {
  return JSON.parse(readFileSync(join(runtimeRoot, "conformance/registry.json"), "utf8"));
}

function validateRegistry(registry) {
  const errors = [];
  if (registry.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    errors.push(`registry schemaVersion must be ${REGISTRY_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(registry.tests) || registry.tests.length === 0) {
    errors.push("registry.tests must be a non-empty array");
    return errors;
  }
  const packageJson = JSON.parse(readFileSync(join(runtimeRoot, "package.json"), "utf8"));
  const workspaceCatalog = readFileSync(join(workspaceRoot, "pnpm-workspace.yaml"), "utf8");
  const catalogThreeVersion = workspaceCatalog.match(/^\s*three:\s*['"]?([^\s'"]+)['"]?\s*$/m)?.[1];
  if (packageJson.devDependencies?.three !== "catalog:") {
    errors.push("package.json must source Three.js from the workspace catalog");
  }
  if (!catalogThreeVersion || registry.threeVersion !== catalogThreeVersion) {
    errors.push(
      `registry threeVersion ${registry.threeVersion} does not match workspace catalog ${catalogThreeVersion ?? "missing"}`,
    );
  }
  const ids = new Set();
  for (const [index, entry] of registry.tests.entries()) {
    const label = entry?.id || `row ${index}`;
    if (!entry?.id || !/^[a-z0-9][a-z0-9-]*$/u.test(entry.id)) errors.push(`${label}: invalid id`);
    if (ids.has(entry?.id)) errors.push(`${label}: duplicate id`);
    ids.add(entry?.id);
    if (!["implemented", "planned"].includes(entry?.status)) {
      errors.push(`${label}: status must be implemented or planned`);
    }
    if (
      entry?.status === "implemented" &&
      (!entry.scene || !existsSync(join(runtimeRoot, entry.scene)))
    ) {
      errors.push(`${label}: implemented row must reference an existing scene`);
    }
    for (const metric of ["pixelMismatchRatio", "perceptualDeltaE"]) {
      const value = entry?.tolerance?.[metric];
      if (!Number.isFinite(value) || value < 0) {
        errors.push(`${label}: tolerance.${metric} must be a non-negative finite number`);
      }
    }
  }
  return errors;
}

function validateReport(report, registry) {
  const errors = [];
  if (report.schemaVersion !== REPORT_SCHEMA_VERSION) {
    errors.push(`report schemaVersion must be ${REPORT_SCHEMA_VERSION}`);
  }
  if (report.registrySchemaVersion !== registry.schemaVersion) {
    errors.push("report registrySchemaVersion must match registry.schemaVersion");
  }
  if (report.threeVersion !== registry.threeVersion) {
    errors.push("report threeVersion must match registry.threeVersion");
  }
  if (!["dry-run", "execution"].includes(report.mode))
    errors.push("report mode must be dry-run or execution");
  if (!Array.isArray(report.results)) {
    errors.push("report.results must be an array");
    return errors;
  }
  const expectedIds = registry.tests.map((entry) => entry.id);
  const resultIds = report.results.map((entry) => entry.id);
  if (JSON.stringify(resultIds) !== JSON.stringify(expectedIds)) {
    errors.push("report result IDs/order must exactly match the registry");
  }
  const executionStatuses = new Set(["pass", "fail", "blocked"]);
  const dryStatuses = new Set(["fail", "blocked", "planned", "validated"]);
  const actualSummary = { pass: 0, fail: 0, blocked: 0, planned: 0, validated: 0 };
  for (const result of report.results) {
    const allowed = report.mode === "execution" ? executionStatuses : dryStatuses;
    if (!allowed.has(result.status)) {
      errors.push(`${result.id}: ${report.mode} report may not use status ${result.status}`);
      continue;
    }
    actualSummary[result.status] += 1;
    if (result.status !== "pass") continue;
    const target = report.target || "desktop";
    if (target === "web") {
      if (result.browser?.completed !== true) {
        errors.push(`${result.id}: pass requires completed browser execution`);
      }
      if (result.browser?.uniform !== false)
        errors.push(`${result.id}: pass requires a non-uniform browser capture`);
    } else {
      if (result.browser?.completed !== true) {
        errors.push(`${result.id}: pass requires completed browser execution`);
      }
      if (result.native?.completed !== true)
        errors.push(`${result.id}: pass requires completed native execution`);
      if (result.browser?.uniform !== false || result.native?.uniform !== false) {
        errors.push(`${result.id}: pass requires non-uniform reference and candidate captures`);
      }
      if (!Number.isFinite(result.metrics?.pixelMismatchRatio)) {
        errors.push(`${result.id}: pass requires finite pixelMismatchRatio`);
      }
      if (!Number.isFinite(result.metrics?.perceptualDeltaE)) {
        errors.push(`${result.id}: pass requires finite perceptualDeltaE`);
      }
      if (!Array.isArray(result.gpuValidationErrors) || result.gpuValidationErrors.length > 0) {
        errors.push(`${result.id}: pass requires zero GPU validation errors`);
      }
    }
  }
  for (const [status, count] of Object.entries(actualSummary)) {
    if (report.summary?.[status] !== count) errors.push(`summary.${status} must equal ${count}`);
  }
  return errors;
}

function makeEntry(test, target, port, entryRoot) {
  const sceneAbs = join(runtimeRoot, test.scene);
  const entryAbs = join(entryRoot, `${target}-${test.id}.js`);
  const sceneRelative = `./${relative(dirname(entryAbs), sceneAbs).replaceAll("\\", "/")}`;
  const canvasExpression =
    target === "browser" ? "document.getElementById('c')" : "globalThis.canvas";
  const completion =
    target === "browser"
      ? `await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
if (state?.renderer?.backend?.device?.queue?.onSubmittedWorkDone) await state.renderer.backend.device.queue.onSubmittedWorkDone();
const screenshot = await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null')), 'image/png'));
const response = await fetch('/__tn_conformance__/complete/${encodeURIComponent(test.id)}', { method: 'POST', headers: { 'content-type': 'image/png' }, body: screenshot });
if (!response.ok) throw new Error('completion upload failed: ' + response.status);`
      : `console.info(${JSON.stringify(`TN_CONFORMANCE_READY:${test.id}`)});`;
  const error =
    target === "browser"
      ? `await fetch('/__tn_conformance__/error/${encodeURIComponent(test.id)}', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: globalThis.__TN_CONFORMANCE_ERROR__ }).catch(() => {});`
      : "console.error('[ThreeNative conformance] failed:', error && error.stack ? error.stack : error);";
  const asyncStart = target === "browser" ? "" : "void (async () => {";
  const asyncEnd = target === "browser" ? "" : "})();";
  writeFileSync(
    entryAbs,
    `import { startScene } from '${sceneRelative}';
${asyncStart}
globalThis.__TN_ASSET_BASE__ = 'http://127.0.0.1:${port}/';
const canvas = ${canvasExpression};
try {
  const state = await startScene(canvas, { width: canvas.width || 1280, height: canvas.height || 720 });
  ${completion}
  globalThis.__TN_CONFORMANCE_DONE__ = true;
} catch (error) {
  globalThis.__TN_CONFORMANCE_ERROR__ = String(error && error.stack ? error.stack : error);
  ${error}
}
${asyncEnd}
`,
  );
  return entryAbs;
}

function bundle(entry, out, result, side, esbuildBin, dryRun, format = "esm") {
  if (!existsSync(esbuildBin)) {
    result.status = dryRun ? "fail" : "blocked";
    result.blockedReason =
      "Install JavaScript dependencies so esbuild can bundle the conformance scene.";
    return false;
  }
  const proc = spawnSync(
    esbuildBin,
    [
      entry,
      "--bundle",
      `--outfile=${out}`,
      `--format=${format}`,
      "--platform=browser",
      "--sourcemap",
    ],
    { cwd: runtimeRoot, encoding: "utf8", timeout: 120_000 },
  );
  if (proc.status !== 0) {
    result.status = "fail";
    result[side] = {
      phase: "bundle",
      exitCode: proc.status,
      stdout: proc.stdout,
      stderr: proc.stderr,
    };
    return false;
  }
  return true;
}

function contentType(path) {
  if (path.endsWith(".js")) return "text/javascript";
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".glb")) return "model/gltf-binary";
  if (path.endsWith(".gltf")) return "model/gltf+json";
  if (path.endsWith(".bin")) return "application/octet-stream";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function createCompletionBroker(captureRoot) {
  const waiters = new Map();
  return {
    wait(id, timeoutMs) {
      return new Promise((resolvePromise) => {
        const timer = setTimeout(() => {
          waiters.delete(id);
          resolvePromise({
            kind: "timeout",
            error: `browser did not report completion within ${timeoutMs}ms`,
          });
        }, timeoutMs);
        waiters.set(id, {
          settle(value) {
            clearTimeout(timer);
            waiters.delete(id);
            resolvePromise(value);
          },
        });
      });
    },
    cancel(id) {
      waiters.delete(id);
    },
    async handle(req, res, pathname) {
      const match = pathname.match(/^\/__tn_conformance__\/(complete|error)\/([a-z0-9-]+)$/u);
      if (!match || req.method !== "POST") return false;
      const [, kind, id] = match;
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 20 * 1024 * 1024) {
          res.writeHead(413);
          res.end("payload too large");
          return true;
        }
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);
      const waiter = waiters.get(id);
      if (kind === "complete" && data.length > 0) {
        const screenshot = join(captureRoot, `${id}.png`);
        writeFileSync(screenshot, data);
        res.writeHead(204);
        res.end(() => waiter?.settle({ kind: "complete", screenshot }));
      } else {
        const error = data.toString("utf8") || "browser reported an empty screenshot";
        res.writeHead(kind === "error" ? 204 : 400);
        res.end(() => waiter?.settle({ kind: "error", error }));
      }
      return true;
    },
  };
}

async function withServer(captureRoot, fn) {
  const broker = createCompletionBroker(captureRoot);
  const rootPrefix = runtimeRoot.endsWith(sep) ? runtimeRoot : `${runtimeRoot}${sep}`;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (await broker.handle(req, res, url.pathname)) return;
    const file = resolve(runtimeRoot, `.${decodeURIComponent(url.pathname)}`);
    if (file !== runtimeRoot && !file.startsWith(rootPrefix)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    try {
      const data = readFileSync(file);
      res.writeHead(200, { "content-type": contentType(file), "access-control-allow-origin": "*" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  try {
    return await fn({ port: server.address().port, broker });
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

async function runBrowser(test, bundlePath, result, port, broker, captureRoot) {
  if (process.platform === "linux" && !process.env.DISPLAY) {
    result.status = "blocked";
    result.blockedReason =
      "Browser WebGPU capture requires Xvfb; run with xvfb-run -a -s '-screen 0 1600x900x24'.";
    return;
  }
  let chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch {
    result.status = "blocked";
    result.blockedReason = "Install @playwright/test and its Chromium browser before web capture.";
    return;
  }
  const htmlRelative = `artifacts/conformance/browser-${test.id}.html`;
  const html = join(runtimeRoot, htmlRelative);
  const bundleRelative = `/${relative(runtimeRoot, bundlePath).replaceAll("\\", "/")}`;
  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:1280px;height:720px;overflow:hidden}canvas{display:block}</style><canvas id="c" width="1280" height="720"></canvas><script type="module" src="${bundleRelative}"></script>`,
  );
  const url = `http://127.0.0.1:${port}/${htmlRelative}`;
  let browser;
  const pageErrors = [];
  try {
    browser = await chromium.launch({
      headless: false,
      timeout: 30_000,
      args: [
        "--ozone-platform=x11",
        "--enable-unsafe-webgpu",
        "--disable-gpu-sandbox",
        "--ignore-gpu-blocklist",
      ],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const completion = broker.wait(test.id, Number(process.env.TN_BROWSER_TIMEOUT_MS || 90_000));
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const outcome = await completion;
    broker.cancel(test.id);
    result.browser = {
      completed: outcome.kind === "complete",
      screenshot: outcome.screenshot || null,
      url,
      pageErrors,
      uniform: null,
    };
    if (outcome.kind !== "complete" || !outcome.screenshot || !existsSync(outcome.screenshot)) {
      result.status = "fail";
      result.browser.error = outcome.error || "Chromium exited before capture completion.";
      return;
    }
    try {
      const inspection = inspectCapture(readFileSync(outcome.screenshot));
      result.browser.uniform = inspection.uniform;
      result.browser.width = inspection.width;
      result.browser.height = inspection.height;
    } catch (error) {
      result.status = "fail";
      result.browser.error = error instanceof Error ? error.message : String(error);
    }
    if (pageErrors.length > 0) result.status = "fail";
  } catch (error) {
    result.status = "fail";
    result.browser = {
      completed: false,
      screenshot: null,
      uniform: null,
      url,
      error: error instanceof Error ? error.message : String(error),
      pageErrors,
    };
  } finally {
    await browser?.close();
  }
  mkdirSync(captureRoot, { recursive: true });
}

function validationErrors(output) {
  const pattern =
    /GPUValidationError|Validation Error|Device error \(Validation\)|Unhandled|ThreeNative conformance\] failed/giu;
  return output.match(pattern) || [];
}

function runDesktop(test, bundlePath, result, runtime, captureRoot) {
  if (!runtime || !existsSync(runtime)) {
    result.status = "blocked";
    result.blockedReason =
      "Build the desktop runtime or set THREENATIVE_RUNTIME_BINARY/TN_RUNTIME.";
    return;
  }
  const screenshot = join(captureRoot, `${test.id}.png`);
  const proc = spawnSync(
    runtime,
    [
      "run",
      bundlePath,
      "--screenshot",
      screenshot,
      "--frames",
      "300",
      "--width",
      "1280",
      "--height",
      "720",
    ],
    { cwd: runtimeRoot, encoding: "utf8", env: process.env, timeout: 180_000 },
  );
  const combined = `${proc.stdout || ""}\n${proc.stderr || ""}`;
  const hasScreenshot = existsSync(screenshot);
  result.native = {
    completed: proc.status === 0 && hasScreenshot,
    exitCode: proc.status,
    screenshot: hasScreenshot ? screenshot : null,
    stdout: (proc.stdout || "").slice(-4000),
    stderr: (proc.stderr || "").slice(-4000),
    uniform: null,
  };
  const gpuErrors = validationErrors(combined);
  result.gpuValidationErrors.push(...gpuErrors);
  if (
    !result.native.completed ||
    /TypeError|ReferenceError|SyntaxError/iu.test(combined) ||
    gpuErrors.length > 0
  ) {
    result.status = "fail";
    return;
  }
  try {
    const inspection = inspectCapture(readFileSync(screenshot));
    result.native.uniform = inspection.uniform;
  } catch (error) {
    result.status = "fail";
    result.native.error = error instanceof Error ? error.message : String(error);
  }
}

function runCommand(command, args, options = {}) {
  const proc = spawnSync(command, args, {
    cwd: options.cwd || runtimeRoot,
    env: options.env || process.env,
    encoding: options.binary ? null : "utf8",
    timeout: options.timeout || 180_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (proc.error) throw proc.error;
  if (proc.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${proc.status}): ${proc.stderr || proc.stdout || ""}`,
    );
  }
  return proc;
}

function androidArgs(serial, ...args) {
  return ["-s", serial, ...args];
}

function androidPid(adb, serial) {
  const result = runCommand(adb, androidArgs(serial, "shell", "pidof", APP_ID), {
    allowFailure: true,
    timeout: 10_000,
  });
  return result.status === 0
    ? String(result.stdout).trim().split(/\s+/u).find(Boolean) || null
    : null;
}

function androidLog(adb, serial) {
  return String(
    runCommand(adb, androidArgs(serial, "logcat", "-d", "-v", "threadtime"), {
      timeout: 15_000,
    }).stdout || "",
  );
}

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function verifyApkBundle(apk, bundle, javaHome) {
  const temporary = mkdtempSync(join(tmpdir(), "threenative-conformance-apk-"));
  try {
    runCommand(
      join(javaHome, "bin", process.platform === "win32" ? "jar.exe" : "jar"),
      ["--extract", "--file", apk, "assets/scripts/main.js"],
      { cwd: temporary },
    );
    const packaged = join(temporary, "assets/scripts/main.js");
    if (!existsSync(packaged)) throw new Error("Android APK is missing assets/scripts/main.js.");
    assertPackagedAndroidBundle(readFileSync(packaged), {
      outputSha256: sha256(readFileSync(bundle)),
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

async function runAndroid(test, bundlePath, result, device, captureRoot) {
  let tools;
  try {
    tools = discoverTools();
  } catch (error) {
    result.status = "blocked";
    result.blockedReason = error instanceof Error ? error.message : String(error);
    return;
  }
  const devices = parseAdbDevices(String(runCommand(tools.adb, ["devices", "-l"]).stdout));
  let serial;
  try {
    serial = selectDevice(devices, device);
  } catch (error) {
    result.status = "blocked";
    result.blockedReason = error instanceof Error ? error.message : String(error);
    return;
  }
  const androidDir = join(runtimeRoot, "android");
  const gradlew = process.platform === "win32" ? join(androidDir, "gradlew.bat") : "bash";
  const bundleHash = sha256(readFileSync(bundlePath));
  const gradleEnv = {
    ...process.env,
    JAVA_HOME: tools.javaHome,
    ANDROID_HOME: tools.sdkRoot,
    ANDROID_SDK_ROOT: tools.sdkRoot,
  };
  try {
    const gradleArgs = [
      ...(process.platform === "win32" ? [] : [join(androidDir, "gradlew")]),
      ":app:assembleDebug",
      "--console=plain",
      `-PthreenativeConformanceBundle=${bundlePath}`,
      `-PthreenativeConformanceBundleSha256=${bundleHash}`,
    ];
    runCommand(gradlew, gradleArgs, { cwd: androidDir, env: gradleEnv, timeout: 900_000 });
  } catch (error) {
    result.status = "fail";
    result.native = {
      completed: false,
      phase: "build",
      error: error instanceof Error ? error.message : String(error),
    };
    return;
  }
  const apk = join(androidDir, "app/build/outputs/apk/debug/app-debug.apk");
  try {
    verifyApkBundle(apk, bundlePath, tools.javaHome);
  } catch (error) {
    result.status = "fail";
    result.native = {
      completed: false,
      phase: "apk-bundle-verification",
      error: error instanceof Error ? error.message : String(error),
    };
    return;
  }
  const common = (...args) =>
    runCommand(tools.adb, androidArgs(serial, ...args), { timeout: 120_000 });
  let displayRestore = null;
  try {
    const install = common("install", "-r", "-t", apk);
    if (!/Success/iu.test(String(install.stdout)))
      throw new Error(`adb install did not report Success: ${install.stdout}`);
    common("shell", "settings", "put", "system", "accelerometer_rotation", "0");
    common("shell", "settings", "put", "system", "user_rotation", "1");
    const originalSize = String(common("shell", "wm", "size").stdout || "");
    displayRestore = /^Override size:\s*(\d+x\d+)$/mu.exec(originalSize)?.[1] || "reset";
    common("shell", "wm", "size", "1280x720");
    common("shell", "am", "force-stop", APP_ID);
    common("logcat", "-c");
    const launch = common("shell", "am", "start", "-W", "-n", ACTIVITY);
    if (!/Status:\s*ok/iu.test(String(launch.stdout)))
      throw new Error(`Android activity failed to start: ${launch.stdout}`);
    const marker = `TN_CONFORMANCE_READY:${test.id}`;
    const timeoutAt = Date.now() + Number(process.env.TN_ANDROID_TIMEOUT_MS || 45_000);
    let pid = null;
    let appLog = "";
    while (Date.now() <= timeoutAt) {
      pid ||= androidPid(tools.adb, serial);
      appLog = filterAppLog(androidLog(tools.adb, serial), pid);
      const analysis = analyzeAppLog(appLog);
      if (analysis.failures.length > 0) throw new Error(analysis.failures[0].excerpt);
      if (appLog.includes(marker)) break;
      if (pid && !androidPid(tools.adb, serial))
        throw new Error("Android process exited before the conformance marker.");
      await wait(500);
    }
    if (!appLog.includes(marker)) throw new Error(`Android timed out waiting for ${marker}.`);
    if (!/ThreeNativeWGPU/u.test(appLog)) {
      throw new Error(
        "Android WebGPU log channel was silent; expected a ThreeNativeWGPU startup line.",
      );
    }
    if (!pid || !androidPid(tools.adb, serial))
      throw new Error("Android process died after its conformance marker.");
    const settleMs = Number(process.env.TN_ANDROID_SETTLE_MS || 3_000);
    await wait(settleMs);
    appLog = filterAppLog(androidLog(tools.adb, serial), pid);
    const analysis = analyzeAppLog(appLog);
    if (analysis.failures.length > 0) throw new Error(analysis.failures[0].excerpt);
    if (!androidPid(tools.adb, serial))
      throw new Error(`Android process died during the ${settleMs} ms settle window.`);
    const png = runCommand(
      tools.adb,
      androidArgs(serial, "exec-out", "screencap", "-p"),
      { binary: true, timeout: 30_000 },
    ).stdout;
    inspectScreenshot(png);
    const screenshot = join(captureRoot, `${test.id}.png`);
    writeFileSync(screenshot, png);
    if (!androidPid(tools.adb, serial))
      throw new Error("Android process died after screenshot capture.");
    result.native = {
      completed: true,
      screenshot,
      uniform: false,
      device: serial,
      pid,
      bundleSha256: bundleHash,
      apkBundleVerified: true,
      webgpuLogChannel: true,
      settleMs,
      log: appLog.slice(-4000),
    };
  } catch (error) {
    result.status = "fail";
    result.native = {
      completed: false,
      ...(result.native || {}),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (displayRestore !== null) {
      const restored = runCommand(
        tools.adb,
        androidArgs(serial, "shell", "wm", "size", displayRestore),
        { allowFailure: true, timeout: 10_000 },
      );
      if (restored.status !== 0) {
        result.status = "fail";
        result.native = {
          completed: false,
          ...(result.native || {}),
          error: `Android display-size restore failed: ${restored.stderr || restored.stdout || "unknown error"}`,
        };
      }
    }
  }
}

function createReport(registry, mode, target, runtime) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    registrySchemaVersion: registry.schemaVersion,
    generatedAt: new Date().toISOString(),
    threeVersion: registry.threeVersion,
    mode,
    target,
    host: {
      platform: process.platform,
      arch: process.arch,
      browser: mode === "execution" && target === "web" ? "chromium-webgpu" : null,
      runtime: mode === "execution" && target === "desktop" ? runtime || null : null,
    },
    summary: { pass: 0, fail: 0, blocked: 0, planned: 0, validated: 0 },
    results: [],
  };
}

function createResult(test) {
  return {
    id: test.id,
    scene: test.scene,
    status: "blocked",
    tolerance: test.tolerance,
    browser: null,
    native: null,
    metrics: { pixelMismatchRatio: null, perceptualDeltaE: null },
    gpuValidationErrors: [],
  };
}

function outputLayout(outArg, target) {
  const fallback = join(runtimeRoot, `artifacts/conformance/${target}`);
  const absolute = outArg ? (isAbsolute(outArg) ? outArg : resolve(runtimeRoot, outArg)) : fallback;
  if (extname(absolute).toLowerCase() === ".json") {
    return { reportPath: absolute, captureRoot: dirname(absolute) };
  }
  return { reportPath: join(absolute, "report.json"), captureRoot: absolute };
}

function referencePath(referenceArg, id) {
  const referenceRoot = referenceArg
    ? isAbsolute(referenceArg)
      ? referenceArg
      : resolve(runtimeRoot, referenceArg)
    : join(runtimeRoot, "artifacts/conformance/web");
  return join(referenceRoot, `${id}.png`);
}

function applyReferenceAndMetrics(test, result, reference) {
  if (!existsSync(reference)) {
    result.status = "blocked";
    result.blockedReason = `Missing browser reference capture: ${reference}`;
    return;
  }
  try {
    const inspection = inspectCapture(readFileSync(reference));
    result.browser = {
      completed: true,
      screenshot: reference,
      uniform: inspection.uniform,
      width: inspection.width,
      height: inspection.height,
    };
    if (result.status !== "pass") return;
    result.metrics = compareCaptures(
      readFileSync(reference),
      readFileSync(result.native.screenshot),
    );
    if (
      result.metrics.pixelMismatchRatio > test.tolerance.pixelMismatchRatio ||
      result.metrics.perceptualDeltaE > test.tolerance.perceptualDeltaE
    ) {
      result.status = "fail";
      result.failureReason = "Capture metrics exceeded the registry tolerance.";
    }
  } catch (error) {
    result.status = "fail";
    result.failureReason = error instanceof Error ? error.message : String(error);
  }
}

function writeReport(report, path) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}

function reportExitCode(report) {
  if (report.summary.fail > 0) return 1;
  if (report.summary.blocked > 0) return 2;
  return 0;
}

function runAll(argv) {
  const outArg = valueAfter(argv, "--out") || "artifacts/conformance";
  const base = isAbsolute(outArg) ? outArg : resolve(runtimeRoot, outArg);
  const onlyTests = valueAfter(argv, "--only-tests");
  const device = valueAfter(argv, "--device");
  const targetArg = valueAfter(argv, "--lane");
  const targets = targetArg ? [targetArg] : ["web", "desktop", "android"];
  let exitCode = 0;
  for (const target of targets) {
    if (!["web", "desktop", "android"].includes(target))
      throw new Error(`Unknown --lane target: ${target}`);
    const args = [runnerPath, "--target", target, "--out", join(base, target)];
    if (onlyTests) args.push("--only-tests", onlyTests);
    if (device) args.push("--device", device);
    if (target !== "web") args.push("--reference", join(base, "web"));
    const proc = spawnSync(process.execPath, args, {
      cwd: runtimeRoot,
      encoding: "utf8",
      stdio: "inherit",
    });
    const laneExit = proc.status ?? 1;
    if (laneExit === 1) exitCode = 1;
    else if (laneExit === 2 && exitCode === 0) exitCode = 2;
  }
  process.exitCode = exitCode;
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help")) {
    process.stdout.write(usage());
    return;
  }
  const registry = loadRegistry();
  const registryErrors = validateRegistry(registry);
  if (registryErrors.length > 0) {
    throw new Error(`Invalid conformance registry:\n- ${registryErrors.join("\n- ")}`);
  }
  const validatePath = valueAfter(argv, "--validate-report");
  if (validatePath) {
    const report = JSON.parse(readFileSync(resolve(runtimeRoot, validatePath), "utf8"));
    const errors = validateReport(report, registry);
    if (errors.length > 0) throw new Error(`Invalid conformance report:\n- ${errors.join("\n- ")}`);
    process.stdout.write(
      `${JSON.stringify({ valid: validatePath, schemaVersion: report.schemaVersion })}\n`,
    );
    return;
  }
  const target = valueAfter(argv, "--target") || (argv.includes("--dry-run") ? "desktop" : "all");
  if (target === "all") {
    runAll(argv);
    return;
  }
  if (!["web", "desktop", "android"].includes(target)) {
    throw new Error(`--target must be web, desktop, android, or all; received ${target}`);
  }
  const dryRun = argv.includes("--dry-run");
  const selectedIds = valueAfter(argv, "--only-tests")?.split(",").filter(Boolean) ?? null;
  if (selectedIds !== null) {
    const known = new Set(registry.tests.map(({ id }) => id));
    const unknown = selectedIds.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new Error(`Unknown --only-tests id(s): ${unknown.join(", ")}`);
  }
  const runtime =
    process.env.THREENATIVE_RUNTIME_BINARY ||
    process.env.TN_RUNTIME ||
    process.env.MYSTRAL_BIN ||
    join(runtimeRoot, "build/tn-linux/mystral");
  const outArg = valueAfter(argv, "--out");
  const { reportPath, captureRoot } = outputLayout(outArg, target);
  const artifactRoot = join(runtimeRoot, "artifacts/conformance");
  const entryRoot = join(artifactRoot, "entries");
  const bundleRoot = join(artifactRoot, `${target}-bundles`);
  for (const path of [entryRoot, bundleRoot, captureRoot]) mkdirSync(path, { recursive: true });
  const report = createReport(registry, dryRun ? "dry-run" : "execution", target, runtime);
  const esbuildBin =
    process.platform === "win32"
      ? join(runtimeRoot, "node_modules/.bin/esbuild.cmd")
      : join(runtimeRoot, "node_modules/.bin/esbuild");
  const executeRows = async (port, broker = null) => {
    for (const test of registry.tests) {
      const result = createResult(test);
      if (test.status !== "implemented") {
        result.status = dryRun ? "planned" : "blocked";
        if (!dryRun) result.blockedReason = "Registry row is not implemented.";
      } else if (selectedIds !== null && !selectedIds.includes(test.id)) {
        result.status = "blocked";
        result.blockedReason = "Not selected by this bounded execution run.";
      } else {
        result.status = dryRun ? "validated" : "pass";
        let bundled;
        let bundlePath;
        if (dryRun) {
          const browserEntry = makeEntry(test, "browser", port, entryRoot);
          const nativeEntry = makeEntry(test, "native", port, entryRoot);
          const browserBundle = join(bundleRoot, `${test.id}-browser.js`);
          const nativeBundle = join(bundleRoot, `${test.id}-native.js`);
          const browserBundled = bundle(
            browserEntry,
            browserBundle,
            result,
            "browser",
            esbuildBin,
            true,
          );
          const nativeBundled = bundle(
            nativeEntry,
            nativeBundle,
            result,
            "native",
            esbuildBin,
            true,
          );
          if (browserBundled && nativeBundled) {
            result.browserBundle = relative(runtimeRoot, browserBundle).replaceAll("\\", "/");
            result.nativeBundle = relative(runtimeRoot, nativeBundle).replaceAll("\\", "/");
          }
          bundled = browserBundled && nativeBundled;
        } else {
          const entryTarget = target === "web" ? "browser" : "native";
          const entry = makeEntry(test, entryTarget, port, entryRoot);
          bundlePath = join(bundleRoot, `${test.id}.js`);
          bundled = bundle(
            entry,
            bundlePath,
            result,
            entryTarget,
            esbuildBin,
            false,
            target === "android" ? "iife" : "esm",
          );
        }
        if (!dryRun && bundled && target === "web") {
          await runBrowser(test, bundlePath, result, port, broker, captureRoot);
        } else if (!dryRun && bundled && target === "desktop") {
          runDesktop(test, bundlePath, result, runtime, captureRoot);
          applyReferenceAndMetrics(
            test,
            result,
            referencePath(valueAfter(argv, "--reference"), test.id),
          );
        } else if (!dryRun && bundled && target === "android") {
          await runAndroid(test, bundlePath, result, valueAfter(argv, "--device"), captureRoot);
          applyReferenceAndMetrics(
            test,
            result,
            referencePath(valueAfter(argv, "--reference"), test.id),
          );
        }
      }
      report.summary[result.status] += 1;
      report.results.push(result);
    }
  };
  if (dryRun || target !== "web") await executeRows(0);
  else await withServer(captureRoot, ({ port, broker }) => executeRows(port, broker));
  const reportErrors = validateReport(report, registry);
  if (reportErrors.length > 0) {
    throw new Error(`Generated an invalid conformance report:\n- ${reportErrors.join("\n- ")}`);
  }
  writeReport(report, reportPath);
  process.stdout.write(
    `${JSON.stringify({ wrote: reportPath, target, mode: report.mode, summary: report.summary }, null, 2)}\n`,
  );
  if (!dryRun || !argv.includes("--allow-blocked")) process.exitCode = reportExitCode(report);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
