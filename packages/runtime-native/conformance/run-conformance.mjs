#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { stageAndroidAssets } from "../scripts/package-android.mjs";
import { stageDesktopFiles } from "../scripts/package-desktop.mjs";
import {
  androidMultitouchScript,
  MULTITOUCH_PROOF_POINTS,
  parseAndroidTouchDevice,
  parseAndroidTouchViewport,
} from "./android-touch.mjs";
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
import {
  compareCaptures,
  compareScreenSpaceGlyphs,
  inspectCapture,
  inspectScreenSpaceGlyphs,
} from "./metrics.mjs";
import { runAndroidMultitouchProof, shouldRunAndroidMultitouch } from "./parity-extras.mjs";
import {
  createProjectRegistry,
  projectId,
  resolveParityProject,
  writeProjectScene,
} from "./project-mode.mjs";

const REPORT_SCHEMA_VERSION = "0.3.0";
const REGISTRY_SCHEMA_VERSION = "0.1.0";
const runtimeRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(runtimeRoot, "..", "..");
const runnerPath = fileURLToPath(import.meta.url);

/**
 * The environment a parity run reads. Values are hashed, never recorded, so a report can say
 * that two runs saw a different `ANDROID_SDK_ROOT` without publishing anyone's home directory.
 * A key that was unset is recorded with a null digest rather than omitted — "not set" is the
 * observation that separated the two 2026-08-10 Android ledgers, so it has to survive.
 */
export const PROVENANCE_ENV_KEYS = Object.freeze([
  "ANDROID_HOME",
  "ANDROID_SDK_ROOT",
  "DISPLAY",
  "MYSTRAL_BIN",
  "THREENATIVE_RUNTIME_BINARY",
  "THREENATIVE_TOUCH_DEVICE",
  "TN_ANDROID_ROTATION_TIMEOUT_MS",
  "TN_ANDROID_SETTLE_MS",
  "TN_ANDROID_TIMEOUT_MS",
  "TN_BROWSER_TIMEOUT_MS",
  "TN_MULTITOUCH_DROP_POINTER",
  "TN_MULTITOUCH_TIMEOUT_MS",
  "TN_RUNTIME",
]);

const PROVENANCE_FIELDS = Object.freeze([
  "commit",
  "dirty",
  "runtimeSha256",
  "referenceSetSha256",
  "device",
  "env",
]);

const REPORT_FIELDS = Object.freeze([
  "schemaVersion",
  "registrySchemaVersion",
  "generatedAt",
  "threeVersion",
  "mode",
  "target",
  "project",
  "host",
  "provenance",
  "summary",
  "results",
  "supplemental",
]);

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/u;

export function fileSha256(path) {
  return path && existsSync(path) ? sha256(readFileSync(path)) : null;
}

/**
 * One digest over the whole browser capture set a native lane compared against, so a later
 * reader can tell "the same rows against a different reference" from a real regression.
 */
export function captureSetSha256(directory) {
  if (!directory || !existsSync(directory)) return null;
  const names = readdirSync(directory)
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .sort();
  if (names.length === 0) return null;
  const manifest = names
    .map((name) => `${name}:${sha256(readFileSync(join(directory, name)))}`)
    .join("\n");
  return sha256(manifest);
}

export function gitProvenance(cwd = workspaceRoot) {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
  if (head.status !== 0 || status.status !== 0) {
    throw new Error(
      "TN_PARITY_PROVENANCE_UNAVAILABLE: git could not identify the tree this run was made " +
        "from, so the report would not be traceable to a commit.",
    );
  }
  return { commit: head.stdout.trim(), dirty: status.stdout.trim() !== "" };
}

export function provenanceEnv(env = process.env) {
  return PROVENANCE_ENV_KEYS.map((key) => ({
    key,
    valueSha256: env[key] === undefined ? null : sha256(String(env[key])),
  }));
}

export function buildProvenance(options = {}) {
  const { commit, dirty } = gitProvenance(options.cwd);
  return {
    commit,
    dirty,
    runtimeSha256: fileSha256(options.runtime ?? null),
    referenceSetSha256: captureSetSha256(options.referenceRoot ?? null),
    device: options.device ?? null,
    env: provenanceEnv(options.env),
  };
}

function usage() {
  return `Usage: node conformance/run-conformance.mjs [options]

  --target web|desktop|android|all
                                  Run one lane or the default web/desktop/emulator matrix
  --target android-hardware       Run only with an explicitly selected physical device
  --project PATH                  Run the configured native entry of a scaffolded project
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

export function validateRegistry(registry) {
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
  if (!Array.isArray(registry.exclusions) || registry.exclusions.length === 0) {
    errors.push("registry.exclusions must be a non-empty array");
  } else {
    for (const [index, entry] of registry.exclusions.entries()) {
      const label = entry?.id || `exclusion ${index}`;
      if (!entry?.id || !/^[a-z0-9][a-z0-9-]*$/u.test(entry.id)) {
        errors.push(`${label}: invalid exclusion id`);
      }
      if (ids.has(entry?.id)) errors.push(`${label}: duplicate id`);
      ids.add(entry?.id);
      if (entry?.status !== "excluded") errors.push(`${label}: status must be excluded`);
      for (const field of ["title", "category", "reason", "owner"]) {
        if (typeof entry?.[field] !== "string" || entry[field].trim() === "") {
          errors.push(`${label}: ${field} must be a non-empty string`);
        }
      }
    }
  }
  return errors;
}

function validateProvenanceEnv(entries) {
  const errors = [];
  if (!Array.isArray(entries) || entries.length === 0) {
    return ["report.provenance.env must be a non-empty array of hashed environment keys"];
  }
  const keys = entries.map((entry) => entry?.key);
  if (JSON.stringify(keys) !== JSON.stringify([...keys].sort())) {
    errors.push("report.provenance.env must be sorted by key");
  }
  if (new Set(keys).size !== keys.length) errors.push("report.provenance.env has duplicate keys");
  for (const entry of entries) {
    const label = typeof entry?.key === "string" ? entry.key : "an unnamed entry";
    if (typeof entry?.key !== "string" || entry.key.trim() === "") {
      errors.push("report.provenance.env entries must carry a non-empty key");
    }
    for (const field of Object.keys(entry ?? {})) {
      if (!["key", "valueSha256"].includes(field)) {
        errors.push(`report.provenance.env.${label}.${field} is not a recognised field`);
      }
    }
    const digest = entry?.valueSha256;
    if (digest !== null && (typeof digest !== "string" || !SHA256_PATTERN.test(digest))) {
      errors.push(`report.provenance.env.${label}.valueSha256 must be null or a sha256 digest`);
    }
  }
  return errors;
}

export function validateProvenance(provenance) {
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    return [
      "report.provenance must record the commit, runtime, reference set, device and environment " +
        "this run was made from",
    ];
  }
  const errors = [];
  for (const field of PROVENANCE_FIELDS) {
    if (!(field in provenance)) errors.push(`report.provenance.${field} is required`);
  }
  for (const field of Object.keys(provenance)) {
    if (!PROVENANCE_FIELDS.includes(field)) {
      errors.push(`report.provenance.${field} is not a recognised provenance field`);
    }
  }
  if (typeof provenance.commit !== "string" || !COMMIT_PATTERN.test(provenance.commit)) {
    errors.push("report.provenance.commit must be a git object id");
  }
  if (typeof provenance.dirty !== "boolean") {
    errors.push("report.provenance.dirty must be a boolean");
  }
  for (const field of ["runtimeSha256", "referenceSetSha256"]) {
    const digest = provenance[field];
    if (digest !== null && (typeof digest !== "string" || !SHA256_PATTERN.test(digest))) {
      errors.push(`report.provenance.${field} must be null or a sha256 digest`);
    }
  }
  if (
    provenance.device !== null &&
    (typeof provenance.device !== "string" || provenance.device.trim() === "")
  ) {
    errors.push("report.provenance.device must be null or a non-empty device serial");
  }
  return [...errors, ...validateProvenanceEnv(provenance.env)];
}

export function validateReport(report, registry) {
  const errors = [];
  for (const field of Object.keys(report)) {
    if (!REPORT_FIELDS.includes(field)) {
      errors.push(`report.${field} is not a recognised report field`);
    }
  }
  errors.push(...validateProvenance(report.provenance));
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
  for (const exclusion of registry.exclusions ?? []) {
    if (exclusion.target !== report.target || typeof exclusion.row !== "string") continue;
    const result = report.results.find((entry) => entry.id === exclusion.row);
    if (result?.status === "pass") {
      errors.push(`${exclusion.row}: ${exclusion.id} is excluded for target ${report.target}`);
    }
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
  if (report.mode === "execution" && report.target === "android" && report.project === null) {
    const multitouch = report.supplemental?.androidMultitouch;
    if (!multitouch || !["pass", "fail"].includes(multitouch.status)) {
      errors.push("Android report requires supplemental.androidMultitouch pass or fail evidence");
    } else if (
      (multitouch.status === "pass" && multitouch.exitCode !== 0) ||
      (multitouch.status === "fail" && multitouch.exitCode === 0)
    ) {
      errors.push("supplemental.androidMultitouch status must match its exitCode");
    }
  }
  return errors;
}

function makeEntry(test, target, port, entryRoot) {
  const sceneAbs = join(runtimeRoot, test.scene);
  const entryAbs = join(entryRoot, `${target}-${test.id}.js`);
  const sceneRelative = `./${relative(dirname(entryAbs), sceneAbs).replaceAll("\\", "/")}`;
  const canvasExpression =
    target === "browser" ? "document.getElementById('c')" : "globalThis.canvas";
  const proofImport =
    test.inputProof === "multitouch"
      ? `import { isMultitouchProofSatisfied } from './${relative(
          dirname(entryAbs),
          join(runtimeRoot, "conformance/multitouch-proof.mjs"),
        ).replaceAll("\\", "/")}';`
      : "";
  const proofWait = test.inputProof === "multitouch"
    ? `await new Promise((resolve, reject) => {
  const deadline = setTimeout(() => reject(new Error('multitouch proof timed out')), ${Number(process.env.TN_MULTITOUCH_TIMEOUT_MS || 60000)});
  const check = () => {
    const proof = globalThis.__TN_MULTITOUCH_PROOF__;
    if (isMultitouchProofSatisfied(proof)) {
      clearTimeout(deadline);
      resolve();
      return;
    }
    requestAnimationFrame(check);
  };
  check();
});
console.info(${JSON.stringify(`TN_MULTITOUCH_PROOF_PASS:${test.id}`)});`
    : "";
  const completion =
    target === "browser"
      ? `console.info(${JSON.stringify(`TN_CONFORMANCE_READY:${test.id}`)});
${proofWait}
for (let frame = 0; frame < ${test.captureFrames ?? 2}; frame += 1) await new Promise(requestAnimationFrame);
if (state?.renderer?.backend?.device?.queue?.onSubmittedWorkDone) await state.renderer.backend.device.queue.onSubmittedWorkDone();
const screenshot = await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null')), 'image/png'));
const response = await fetch('/__tn_conformance__/complete/${encodeURIComponent(test.id)}', { method: 'POST', headers: { 'content-type': 'image/png' }, body: screenshot });
if (!response.ok) throw new Error('completion upload failed: ' + response.status);`
      : `console.info(${JSON.stringify(`TN_CONFORMANCE_READY:${test.id}`)});
${proofWait}`;
  const error =
    target === "browser"
      ? `await fetch('/__tn_conformance__/error/${encodeURIComponent(test.id)}', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: globalThis.__TN_CONFORMANCE_ERROR__ }).catch(() => {});`
      : "console.error('[ThreeNative conformance] failed:', error && error.stack ? error.stack : error);";
  const asyncStart = target === "browser" ? "" : "void (async () => {";
  const asyncEnd = target === "browser" ? "" : "})();";
  writeFileSync(
    entryAbs,
    `import { startScene } from '${sceneRelative}';
${proofImport}
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

function bundle(entry, out, result, side, esbuildBin, dryRun, format = "esm", conditions = []) {
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
      ...(side === "native"
        ? [
            '--define:import.meta.env={"BASE_URL":"/","DEV":false,"MODE":"production","PROD":true,"SSR":false}',
          ]
        : []),
      ...conditions.map((condition) => `--conditions=${condition}`),
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

async function withServer(captureRoot, assetRoot, fn) {
  const broker = createCompletionBroker(captureRoot);
  const rootPrefix = runtimeRoot.endsWith(sep) ? runtimeRoot : `${runtimeRoot}${sep}`;
  const assetPrefix = assetRoot && (assetRoot.endsWith(sep) ? assetRoot : `${assetRoot}${sep}`);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (await broker.handle(req, res, url.pathname)) return;
    const pathname = `.${decodeURIComponent(url.pathname)}`;
    const runtimeFile = resolve(runtimeRoot, pathname);
    const assetFile = assetRoot ? resolve(assetRoot, pathname) : null;
    if (runtimeFile !== runtimeRoot && !runtimeFile.startsWith(rootPrefix)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    if (assetFile && assetFile !== assetRoot && !assetFile.startsWith(assetPrefix)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    try {
      const file = assetFile && existsSync(assetFile) ? assetFile : runtimeFile;
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
    `<!doctype html><meta charset="utf-8"><base href="/"><style>html,body{margin:0;width:1280px;height:720px;overflow:hidden}canvas{display:block}</style><canvas id="c" width="1280" height="720"></canvas><script type="module" src="${bundleRelative}"></script>`,
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
    if (test.inputProof === "multitouch") {
      await page.waitForFunction(() => globalThis.__TN_MULTITOUCH_INPUT_READY__ === true, null, {
        timeout: Number(process.env.TN_BROWSER_TIMEOUT_MS || 90_000),
      });
      const proofPoints =
        process.env.TN_MULTITOUCH_DROP_POINTER === "1"
          ? MULTITOUCH_PROOF_POINTS.slice(0, 1)
          : MULTITOUCH_PROOF_POINTS;
      await page.evaluate((points) => {
        const canvas = document.querySelector("canvas");
        if (!(canvas instanceof EventTarget)) throw new Error("multitouch proof canvas is missing");
        for (const point of points) {
          canvas.dispatchEvent(new PointerEvent("pointerdown", {
            bubbles: true,
            buttons: 1,
            clientX: point.x * 1280,
            clientY: point.y * 720,
            isPrimary: point.id === points[0].id,
            pointerId: point.id,
            pointerType: "touch",
          }));
        }
      }, proofPoints);
    }
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
      if (test.id === "30-screen-space-text") {
        result.browser.glyphRaster = inspectScreenSpaceGlyphs(readFileSync(outcome.screenshot));
      }
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

function runDesktop(test, bundlePath, result, runtime, captureRoot, assets, runtimeBlocker = null) {
  if (!runtime || !existsSync(runtime)) {
    result.status = "blocked";
    result.blockedReason =
      runtimeBlocker ||
      "TN_PARITY_DESKTOP_RUNTIME_MISSING: build the desktop runtime or set THREENATIVE_RUNTIME_BINARY/TN_RUNTIME. A clean build additionally requires CMake, a C++ compiler, and platform development libraries; Node 20, JDK 17, and an Android SDK are insufficient.";
    return;
  }
  const screenshot = join(captureRoot, `${test.id}.png`);
  const staging = assets ? mkdtempSync(join(tmpdir(), "threenative-parity-desktop-")) : null;
  const executableBundle = staging ? stageDesktopFiles(bundlePath, assets, staging) : bundlePath;
  const proc = spawnSync(
    runtime,
    [
      "run",
      executableBundle,
      "--screenshot",
      screenshot,
      "--frames",
      "300",
      "--width",
      "1280",
      "--height",
      "720",
    ],
    {
      cwd: staging || runtimeRoot,
      encoding: "utf8",
      env:
        process.platform === "linux"
          ? { ...process.env, SDL_VIDEODRIVER: "x11" }
          : process.env,
      timeout: 180_000,
    },
  );
  if (staging) rmSync(staging, { recursive: true, force: true });
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

export function androidSystemDialog(windowDump) {
  const match = String(windowDump).match(
    /(?:Application Not Responding|Application Error):\s*[^\r\n}]+/u,
  );
  return match?.[0]?.trim() || null;
}

/** The landscape size the Android lane pins so its captures compare against the web reference. */
export const ANDROID_CAPTURE_SIZE = "1280x720";

export function androidDisplaySize(sizeDump) {
  const dump = String(sizeDump);
  return /^Override size:\s*(\d+x\d+)$/mu.exec(dump)?.[1] ||
    /^Physical size:\s*(\d+x\d+)$/mu.exec(dump)?.[1] ||
    null;
}

async function waitForAndroidDisplaySize(common, expected) {
  const deadline = Date.now() + Number(process.env.TN_ANDROID_ROTATION_TIMEOUT_MS || 15_000);
  let observed = null;
  while (Date.now() <= deadline) {
    observed = androidDisplaySize(common("shell", "wm", "size").stdout);
    if (observed === expected) return;
    await wait(250);
  }
  throw new Error(
    `TN_ANDROID_DISPLAY_ORIENTATION: display reported ${observed ?? "no size"} instead of ${expected} before capture.`,
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

async function runAndroid(
  test,
  bundlePath,
  result,
  device,
  captureRoot,
  assets,
  requireEmulator = false,
) {
  let tools;
  try {
    tools = discoverTools();
  } catch (error) {
    result.status = "blocked";
    result.blockedReason = `TN_PARITY_ANDROID_TOOLS_BLOCKED: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  let devices;
  try {
    devices = parseAdbDevices(String(runCommand(tools.adb, ["devices", "-l"]).stdout));
  } catch (error) {
    result.status = "blocked";
    result.blockedReason = `TN_PARITY_ANDROID_ADB_BLOCKED: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  let serial;
  try {
    serial = selectDevice(devices, device);
  } catch (error) {
    result.status = "blocked";
    result.blockedReason = `TN_PARITY_ANDROID_DEVICE_BLOCKED: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  if (requireEmulator) {
    try {
      assertAndroidEmulator(androidDeviceProperties(tools.adb, serial), serial);
    } catch (error) {
      result.status = "blocked";
      result.blockedReason = error instanceof Error ? error.message : String(error);
      return;
    }
  }
  const androidBlockedReason = androidDependencyBlocker();
  if (androidBlockedReason !== null) {
    result.status = "blocked";
    result.blockedReason = androidBlockedReason;
    return;
  }
  const androidDir = join(runtimeRoot, "android");
  stageAndroidAssets(assets);
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
  let releaseMultitouch = null;
  try {
    runCommand(tools.adb, androidArgs(serial, "uninstall", APP_ID), {
      allowFailure: true,
      timeout: 120_000,
    });
    await wait(2_000);
    const install = common("install", "-r", "-t", apk);
    if (!/Success/iu.test(String(install.stdout)))
      throw new Error(`adb install did not report Success: ${install.stdout}`);
    common("shell", "settings", "put", "system", "accelerometer_rotation", "0");
    common("shell", "settings", "put", "system", "user_rotation", "1");
    const originalSize = String(common("shell", "wm", "size").stdout || "");
    displayRestore = /^Override size:\s*(\d+x\d+)$/mu.exec(originalSize)?.[1] || "reset";
    common("shell", "wm", "size", ANDROID_CAPTURE_SIZE);
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
    if (test.inputProof === "multitouch") {
      const touchDevice = parseAndroidTouchDevice(
        String(common("shell", "getevent", "-lp").stdout || ""),
        process.env.THREENATIVE_TOUCH_DEVICE,
      );
      const touchViewport = parseAndroidTouchViewport(
        String(common("shell", "dumpsys", "input").stdout || ""),
      );
      const releaseScript = androidMultitouchScript(
        touchDevice,
        MULTITOUCH_PROOF_POINTS,
        false,
        touchViewport,
      );
      // `adb shell` joins its arguments with spaces, so a script handed to `sh -c` loses its
      // grouping and the shell swallows the first line as the command. Pass the script as the
      // remote command line instead, which keeps `set -e` in force.
      common(
        "shell",
        androidMultitouchScript(touchDevice, MULTITOUCH_PROOF_POINTS, true, touchViewport),
      );
      releaseMultitouch = () => common("shell", releaseScript);
      const proofMarker = `TN_MULTITOUCH_PROOF_PASS:${test.id}`;
      const proofTimeoutAt = Date.now() + Number(process.env.TN_ANDROID_TIMEOUT_MS || 45_000);
      while (Date.now() <= proofTimeoutAt) {
        appLog = filterAppLog(androidLog(tools.adb, serial), pid);
        const analysis = analyzeAppLog(appLog);
        if (analysis.failures.length > 0) throw new Error(analysis.failures[0].excerpt);
        if (appLog.includes(proofMarker)) break;
        if (pid && !androidPid(tools.adb, serial))
          throw new Error("Android process exited before the multitouch proof marker.");
        await wait(100);
      }
      if (!appLog.includes(proofMarker)) throw new Error(`Android timed out waiting for ${proofMarker}.`);
      await releaseMultitouch();
      releaseMultitouch = null;
    }
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
    const beforeCaptureDialog = androidSystemDialog(
      common("shell", "dumpsys", "window", "windows").stdout,
    );
    if (beforeCaptureDialog) {
      throw new Error(`TN_ANDROID_SYSTEM_DIALOG: ${beforeCaptureDialog}`);
    }
    // The activity requests its own orientation as it starts, so the display can still be
    // rotating when the settle window ends. Capturing then yields a 720x1280 frame that is
    // reported as a pixel mismatch against the 1280x720 reference — a red row that names the
    // wrong cause. Wait for the override to read back, and name it if it never does.
    await waitForAndroidDisplaySize(common, ANDROID_CAPTURE_SIZE);
    const png = runCommand(tools.adb, androidArgs(serial, "exec-out", "screencap", "-p"), {
      binary: true,
      timeout: 30_000,
    }).stdout;
    inspectScreenshot(png);
    // Observe the capture instead of asserting it. A hard-coded `uniform: false` reports a
    // blank device frame as a pass, which is the fail-open this lane exists to prevent.
    const capture = inspectCapture(png);
    if (`${capture.width}x${capture.height}` !== ANDROID_CAPTURE_SIZE) {
      throw new Error(
        `TN_ANDROID_DISPLAY_ORIENTATION: captured ${capture.width}x${capture.height} but the lane requires ${ANDROID_CAPTURE_SIZE}; the display was still rotating.`,
      );
    }
    const afterCaptureDialog = androidSystemDialog(
      common("shell", "dumpsys", "window", "windows").stdout,
    );
    if (afterCaptureDialog) {
      throw new Error(`TN_ANDROID_SYSTEM_DIALOG: ${afterCaptureDialog}`);
    }
    const screenshot = join(captureRoot, `${test.id}.png`);
    writeFileSync(screenshot, png);
    if (!androidPid(tools.adb, serial))
      throw new Error("Android process died after screenshot capture.");
    result.native = {
      completed: true,
      screenshot,
      uniform: capture.uniform,
      width: capture.width,
      height: capture.height,
      device: serial,
      pid,
      bundleSha256: bundleHash,
      apkBundleVerified: true,
      freshInstall: true,
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
    if (releaseMultitouch !== null) {
      try {
        releaseMultitouch();
      } catch (error) {
        result.status = "fail";
        result.native = {
          completed: false,
          ...(result.native || {}),
          error: `Android multitouch release failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      releaseMultitouch = null;
    }
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

export function androidDependencyBlocker(root = runtimeRoot) {
  const sourceRoot = join(root, "third_party", "sdl3-android");
  const sourceAar = join(sourceRoot, "SDL3-3.2.8.aar");
  const prebuiltRoot = join(root, "android", "prebuilt");
  const prebuiltFiles = [
    join(prebuiltRoot, "SDL3-3.2.8.aar"),
    join(prebuiltRoot, "jniLibs", "arm64-v8a", "libSDL3.so"),
    join(prebuiltRoot, "jniLibs", "arm64-v8a", "libmystral-runtime.so"),
    join(prebuiltRoot, "jniLibs", "x86_64", "libSDL3.so"),
    join(prebuiltRoot, "jniLibs", "x86_64", "libmystral-runtime.so"),
  ];
  const sourceComplete = existsSync(sourceAar);
  const prebuiltMissing = prebuiltFiles.filter((file) => !existsSync(file));
  const prebuiltComplete = prebuiltMissing.length === 0;
  const prebuiltPresent = prebuiltMissing.length < prebuiltFiles.length;
  if (!prebuiltComplete && (!sourceComplete || prebuiltPresent)) {
    return (
      "TN_PARITY_ANDROID_DEPS_BLOCKED: checked source and packaged Android dependency layouts. " +
      `source (${sourceRoot}): ${sourceAar} ${sourceComplete ? "exists" : "does not exist"}; ` +
      `packaged (${prebuiltRoot}): missing ${prebuiltMissing.join(", ")}. ` +
      `Run "pnpm native:build" to download the Android third-party dependencies.`
    );
  }
  return null;
}

const RUNTIME_ENV_KEYS = Object.freeze([
  "THREENATIVE_RUNTIME_BINARY",
  "TN_RUNTIME",
  "MYSTRAL_BIN",
]);

export function configuredRuntime(env = process.env) {
  return RUNTIME_ENV_KEYS.map((key) => env[key]).find(Boolean) || null;
}

export function defaultDesktopRuntimePath(platform = process.platform) {
  const preset =
    platform === "darwin" ? "tn-macos" : platform === "win32" ? "tn-windows" : "tn-linux";
  const executable = platform === "win32" ? "mystral.exe" : "mystral";
  return join(runtimeRoot, "build", preset, executable);
}

/**
 * The one-command parity path provisions what the repository already declares — the pinned
 * `third_party` downloads and the CMake build — before it decides a desktop row failed.
 * A host that cannot run those steps reports every affected row as `blocked` with the exact
 * command output, never as an assertion failure.
 */
export function desktopRuntimeBuildCommands() {
  return [
    { command: process.execPath, args: [join(runtimeRoot, "scripts/download-deps.mjs")] },
    { command: process.execPath, args: [join(runtimeRoot, "scripts/native-build.mjs")] },
  ];
}

export function prepareDesktopRuntime(runtime, options = {}) {
  const env = options.env || process.env;
  const exists = options.exists || existsSync;
  if (runtime && exists(runtime)) return { runtime, blockedReason: null };
  if (configuredRuntime(env)) {
    return {
      runtime: null,
      blockedReason:
        "TN_PARITY_DESKTOP_RUNTIME_MISSING: the configured " +
        "THREENATIVE_RUNTIME_BINARY/TN_RUNTIME/MYSTRAL_BIN path does not exist.",
    };
  }
  const run = options.run || runCommand;
  try {
    for (const { command, args } of desktopRuntimeBuildCommands()) {
      run(command, args, { cwd: runtimeRoot, timeout: 1_800_000 });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      runtime: null,
      blockedReason: `TN_PARITY_DESKTOP_RUNTIME_BUILD_BLOCKED: automatic native provisioning failed: ${detail}`,
    };
  }
  if (!exists(runtime)) {
    return {
      runtime: null,
      blockedReason:
        "TN_PARITY_DESKTOP_RUNTIME_BUILD_BLOCKED: automatic native provisioning completed " +
        "without producing the expected runtime binary.",
    };
  }
  return { runtime, blockedReason: null };
}

export function androidDeviceKind(properties) {
  return /^1$/mu.test(properties.qemu || "") ||
    /^(goldfish|ranchu)$/mu.test(properties.hardware || "")
    ? "emulator"
    : "physical";
}

export function assertAndroidEmulator(properties, serial = "the selected device") {
  const kind = androidDeviceKind(properties);
  if (kind !== "emulator") {
    throw new Error(
      `TN_PARITY_ANDROID_EMULATOR_REQUIRED: ${serial} identifies as physical hardware, ` +
        "but --target android runs the emulator lane. Use --target android-hardware instead.",
    );
  }
  return kind;
}

/**
 * `--target android` must not silently depend on an emulator someone else started. When no
 * emulator is attached this boots the requested AVD; when the SDK cannot supply one the
 * caller gets a blocked precondition string, never a failed row.
 */
export function androidEmulatorBlocker(devices, avdNames, requested) {
  if (devices.length > 0) return null;
  if (requested && !avdNames.includes(requested)) {
    return (
      `TN_PARITY_ANDROID_AVD_MISSING: no emulator is attached and the requested AVD '${requested}' ` +
      `is not installed. Installed AVDs: ${avdNames.length > 0 ? avdNames.join(", ") : "none"}.`
    );
  }
  if (avdNames.length === 0) {
    return (
      "TN_PARITY_ANDROID_AVD_MISSING: no emulator is attached and the Android SDK has no AVD to " +
      "boot. Create one with avdmanager, or pass --device SERIAL for an already-running emulator."
    );
  }
  return null;
}

function androidDeviceProperties(adb, serial) {
  const getprop = (name) =>
    String(
      runCommand(adb, androidArgs(serial, "shell", "getprop", name), { timeout: 10_000 }).stdout ||
        "",
    ).trim();
  return { qemu: getprop("ro.kernel.qemu"), hardware: getprop("ro.hardware") };
}

function installedAvdNames(sdkRoot) {
  const binary = join(
    sdkRoot,
    "emulator",
    process.platform === "win32" ? "emulator.exe" : "emulator",
  );
  if (!existsSync(binary)) return [];
  try {
    return String(runCommand(binary, ["-list-avds"], { timeout: 30_000 }).stdout || "")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function emulatorPreconditionBlocker(device) {
  let tools;
  try {
    tools = discoverTools();
  } catch (error) {
    return `TN_PARITY_ANDROID_TOOLS_BLOCKED: ${error instanceof Error ? error.message : String(error)}`;
  }
  let devices;
  try {
    devices = parseAdbDevices(String(runCommand(tools.adb, ["devices", "-l"]).stdout));
  } catch (error) {
    return `TN_PARITY_ANDROID_ADB_BLOCKED: ${error instanceof Error ? error.message : String(error)}`;
  }
  return androidEmulatorBlocker(devices, installedAvdNames(tools.sdkRoot), device);
}

function physicalAndroidBlocker(device) {
  if (!device) {
    return "TN_PARITY_PHYSICAL_DEVICE_REQUIRED: pass --device SERIAL for an attached physical Android device.";
  }
  try {
    const tools = discoverTools();
    const devices = parseAdbDevices(String(runCommand(tools.adb, ["devices", "-l"]).stdout));
    const serial = selectDevice(devices, device);
    if (androidDeviceKind(androidDeviceProperties(tools.adb, serial)) === "emulator") {
      return `TN_PARITY_PHYSICAL_DEVICE_REQUIRED: ${serial} identifies as an emulator, not physical hardware.`;
    }
    return null;
  } catch (error) {
    return `TN_PARITY_PHYSICAL_DEVICE_BLOCKED: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function createReport(registry, mode, target, runtime, project, provenance) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    registrySchemaVersion: registry.schemaVersion,
    generatedAt: new Date().toISOString(),
    threeVersion: registry.threeVersion,
    mode,
    target,
    project: project ? { root: project.root, nativeEntry: project.nativeEntry } : null,
    provenance,
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

export function referenceRootPath(referenceArg) {
  if (!referenceArg) return join(runtimeRoot, "artifacts/conformance/web");
  return isAbsolute(referenceArg) ? referenceArg : resolve(runtimeRoot, referenceArg);
}

function referencePath(referenceArg, id) {
  return join(referenceRootPath(referenceArg), `${id}.png`);
}

function applyReferenceAndMetrics(test, result, reference) {
  if (result.status !== "pass") return;
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
    result.metrics = compareCaptures(
      readFileSync(reference),
      readFileSync(result.native.screenshot),
    );
    if (test.id === "30-screen-space-text") {
      result.glyphRaster = compareScreenSpaceGlyphs(
        readFileSync(reference),
        readFileSync(result.native.screenshot),
      );
    }
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

/**
 * The one rule that decides a lane's exit code. Exported so a ledger checker recomputes it
 * from a summary instead of trusting a number somebody typed into a markdown table.
 */
export function reportExitCode(report) {
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
  const project = valueAfter(argv, "--project");
  const targets = targetArg ? [targetArg] : ["web", "desktop", "android"];
  let exitCode = 0;
  for (const target of targets) {
    if (!["web", "desktop", "android", "android-hardware"].includes(target))
      throw new Error(`Unknown --lane target: ${target}`);
    const args = [runnerPath, "--target", target, "--out", join(base, target)];
    if (onlyTests) args.push("--only-tests", onlyTests);
    if (device) args.push("--device", device);
    if (project) args.push("--project", project);
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
  const baseRegistry = loadRegistry();
  const baseRegistryErrors = validateRegistry(baseRegistry);
  if (baseRegistryErrors.length > 0) {
    throw new Error(`Invalid conformance registry:\n- ${baseRegistryErrors.join("\n- ")}`);
  }
  const projectArgument = valueAfter(argv, "--project");
  const project = projectArgument ? resolveParityProject(projectArgument) : null;
  const projectScene = join(
    runtimeRoot,
    `artifacts/conformance/project-scene${project ? `-${projectId(project)}` : ""}.js`,
  );
  if (project) {
    mkdirSync(dirname(projectScene), { recursive: true });
    writeProjectScene(project, projectScene);
  }
  const registry = project
    ? createProjectRegistry(
        baseRegistry,
        relative(runtimeRoot, projectScene).replaceAll("\\", "/"),
        project,
      )
    : baseRegistry;
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
  if (!["web", "desktop", "android", "android-hardware"].includes(target)) {
    throw new Error(
      `--target must be web, desktop, android, android-hardware, or all; received ${target}`,
    );
  }
  const dryRun = argv.includes("--dry-run");
  const selectedIds = valueAfter(argv, "--only-tests")?.split(",").filter(Boolean) ?? null;
  if (selectedIds !== null) {
    const known = new Set(registry.tests.map(({ id }) => id));
    const unknown = selectedIds.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new Error(`Unknown --only-tests id(s): ${unknown.join(", ")}`);
  }
  const runtime = configuredRuntime() || defaultDesktopRuntimePath();
  const desktopPreparation =
    !dryRun && (target === "desktop" || target === "all")
      ? prepareDesktopRuntime(runtime)
      : { runtime, blockedReason: null };
  const desktopRuntimeBlocker = desktopPreparation.blockedReason;
  const outArg = valueAfter(argv, "--out");
  const { reportPath, captureRoot } = outputLayout(outArg, target);
  const artifactRoot = join(runtimeRoot, "artifacts/conformance");
  const entryRoot = join(artifactRoot, "entries");
  const bundleRoot = join(artifactRoot, `${target}-bundles`);
  for (const path of [entryRoot, bundleRoot, captureRoot]) mkdirSync(path, { recursive: true });
  const device = valueAfter(argv, "--device");
  const provenance = buildProvenance({
    runtime: !dryRun && target === "desktop" ? runtime : null,
    referenceRoot:
      !dryRun && target !== "web" ? referenceRootPath(valueAfter(argv, "--reference")) : null,
    device,
  });
  const report = createReport(
    registry,
    dryRun ? "dry-run" : "execution",
    target,
    runtime,
    project,
    provenance,
  );
  const targetBlocker = dryRun
    ? null
    : target === "android-hardware"
      ? physicalAndroidBlocker(valueAfter(argv, "--device"))
      : target === "android"
        ? emulatorPreconditionBlocker(valueAfter(argv, "--device"))
        : null;
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
      } else if (targetBlocker) {
        result.status = "blocked";
        result.blockedReason = targetBlocker;
      } else if (!dryRun && target === "desktop" && test.inputProof === "multitouch") {
        result.status = "blocked";
        result.blockedReason =
          "TN_PARITY_ROW_EXCLUDED: desktop-multitouch-input — the injector exists and reaches " +
          "the kernel, but nothing on this host reads the device it creates: /dev/input/event* " +
          "is root:input 0660 with this user outside the input group, and the lane runs under " +
          "Xvfb, which has no evdev backend. A host constraint, not a missing capability. See " +
          "docs/verification/desktop-multitouch-2026-08-15-r2.md.";
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
            "esm",
            project ? ["threenative-native"] : [],
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
            ["android", "android-hardware"].includes(target) ? "iife" : "esm",
            project && target !== "web" ? ["threenative-native"] : [],
          );
        }
        if (!dryRun && bundled && target === "web") {
          await runBrowser(test, bundlePath, result, port, broker, captureRoot);
        } else if (!dryRun && bundled && target === "desktop") {
          runDesktop(
            test,
            bundlePath,
            result,
            runtime,
            captureRoot,
            project?.publicDir,
            desktopRuntimeBlocker,
          );
          applyReferenceAndMetrics(
            test,
            result,
            referencePath(valueAfter(argv, "--reference"), test.id),
          );
        } else if (!dryRun && bundled && ["android", "android-hardware"].includes(target)) {
          await runAndroid(
            test,
            bundlePath,
            result,
            valueAfter(argv, "--device"),
            captureRoot,
            project?.publicDir,
            target === "android",
          );
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
  else
    await withServer(captureRoot, project?.publicDir, ({ port, broker }) =>
      executeRows(port, broker),
    );
  if (shouldRunAndroidMultitouch({ dryRun, project, target })) {
    report.supplemental = {
      androidMultitouch: runAndroidMultitouchProof({
        device: valueAfter(argv, "--device"),
        runtimeRoot,
      }),
    };
  }
  const reportErrors = validateReport(report, registry);
  if (reportErrors.length > 0) {
    throw new Error(`Generated an invalid conformance report:\n- ${reportErrors.join("\n- ")}`);
  }
  writeReport(report, reportPath);
  process.stdout.write(
    `${JSON.stringify({ wrote: reportPath, target, mode: report.mode, summary: report.summary }, null, 2)}\n`,
  );
  if (!dryRun || !argv.includes("--allow-blocked")) {
    process.exitCode =
      report.supplemental?.androidMultitouch?.status === "fail" ? 1 : reportExitCode(report);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === runnerPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
