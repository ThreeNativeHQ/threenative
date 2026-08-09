#!/usr/bin/env node
import { createServer } from 'node:http';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPORT_SCHEMA_VERSION = '0.2.0';
const REGISTRY_SCHEMA_VERSION = '0.1.0';
const root = fileURLToPath(new URL('..', import.meta.url));

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return process.argv[index + 1];
}

function loadRegistry() {
  return JSON.parse(readFileSync(join(root, 'conformance/registry.json'), 'utf8'));
}

function validateRegistry(registry) {
  const errors = [];
  if (registry.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    errors.push(`registry schemaVersion must be ${REGISTRY_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(registry.tests) || registry.tests.length === 0) {
    errors.push('registry.tests must be a non-empty array');
    return errors;
  }

  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const workspaceCatalog = readFileSync(join(root, '..', '..', 'pnpm-workspace.yaml'), 'utf8');
  const catalogThreeVersion = workspaceCatalog.match(/^\s*three:\s*['"]?([^\s'"]+)['"]?\s*$/m)?.[1];
  if (packageJson.devDependencies?.three !== 'catalog:') {
    errors.push('package.json must source Three.js from the workspace catalog');
  }
  if (!catalogThreeVersion || registry.threeVersion !== catalogThreeVersion) {
    errors.push(`registry threeVersion ${registry.threeVersion} does not match workspace catalog ${catalogThreeVersion ?? 'missing'}`);
  }

  const ids = new Set();
  for (const [index, entry] of registry.tests.entries()) {
    const label = entry?.id || `row ${index}`;
    if (!entry?.id || !/^[a-z0-9][a-z0-9-]*$/.test(entry.id)) errors.push(`${label}: invalid id`);
    if (ids.has(entry?.id)) errors.push(`${label}: duplicate id`);
    ids.add(entry?.id);
    if (!['implemented', 'planned'].includes(entry?.status)) errors.push(`${label}: status must be implemented or planned`);
    if (entry?.status === 'implemented' && (!entry.scene || !existsSync(join(root, entry.scene)))) {
      errors.push(`${label}: implemented row must reference an existing scene`);
    }
    for (const metric of ['pixelMismatchRatio', 'perceptualDeltaE']) {
      const value = entry?.tolerance?.[metric];
      if (!Number.isFinite(value) || value < 0) errors.push(`${label}: tolerance.${metric} must be a non-negative finite number`);
    }
  }
  return errors;
}

function validateReport(report, registry) {
  const errors = [];
  if (report.schemaVersion !== REPORT_SCHEMA_VERSION) errors.push(`report schemaVersion must be ${REPORT_SCHEMA_VERSION}`);
  if (report.registrySchemaVersion !== registry.schemaVersion) errors.push('report registrySchemaVersion must match registry.schemaVersion');
  if (report.threeVersion !== registry.threeVersion) errors.push('report threeVersion must match registry.threeVersion');
  if (!['dry-run', 'execution'].includes(report.mode)) errors.push('report mode must be dry-run or execution');
  if (!Array.isArray(report.results)) {
    errors.push('report.results must be an array');
    return errors;
  }

  const expectedIds = registry.tests.map((entry) => entry.id);
  const resultIds = report.results.map((entry) => entry.id);
  if (JSON.stringify(resultIds) !== JSON.stringify(expectedIds)) errors.push('report result IDs/order must exactly match the registry');

  const allowedStatuses = new Set(['pass', 'fail', 'blocked', 'planned', 'validated']);
  const actualSummary = { pass: 0, fail: 0, blocked: 0, planned: 0, validated: 0 };
  for (const result of report.results) {
    if (!allowedStatuses.has(result.status)) {
      errors.push(`${result.id}: unknown status ${result.status}`);
      continue;
    }
    actualSummary[result.status]++;
    if (report.mode === 'dry-run' && result.status === 'pass') errors.push(`${result.id}: dry-run may not claim an execution pass`);
    if (report.mode === 'execution' && result.status === 'validated') errors.push(`${result.id}: execution report may not use validated status`);
    if (result.status === 'pass') {
      if (result.browser?.completed !== true) errors.push(`${result.id}: pass requires completed browser execution`);
      if (result.native?.completed !== true) errors.push(`${result.id}: pass requires completed native execution`);
      if (!Number.isFinite(result.metrics?.pixelMismatchRatio)) errors.push(`${result.id}: pass requires finite pixelMismatchRatio`);
      if (!Number.isFinite(result.metrics?.perceptualDeltaE)) errors.push(`${result.id}: pass requires finite perceptualDeltaE`);
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

function findFirefox() {
  if (Object.hasOwn(process.env, 'FIREFOX_BIN')) return process.env.FIREFOX_BIN || '';
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Firefox.app/Contents/MacOS/firefox']
    : process.platform === 'win32'
      ? [
          join(process.env.PROGRAMFILES || '', 'Mozilla Firefox/firefox.exe'),
          join(process.env['PROGRAMFILES(X86)'] || '', 'Mozilla Firefox/firefox.exe'),
        ]
      : ['/usr/bin/firefox', '/usr/bin/firefox-esr'];
  const candidate = candidates.find((path) => path && existsSync(path));
  if (candidate) return candidate;
  const command = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(command, ['firefox'], { encoding: 'utf8' }).stdout?.split(/\r?\n/)[0]?.trim() || '';
}

function makeEntry(test, target, port, entryRoot) {
  const sceneAbs = join(root, test.scene);
  const entryAbs = join(entryRoot, `${target}-${test.id}.js`);
  const rel = './' + relative(dirname(entryAbs), sceneAbs).replaceAll('\\', '/');
  const canvasExpr = target === 'browser' ? "document.getElementById('c')" : 'globalThis.canvas';
  const browserSuccess = target === 'browser'
    ? `await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
if (state?.renderer?.backend?.device?.queue?.onSubmittedWorkDone) await state.renderer.backend.device.queue.onSubmittedWorkDone();
const screenshot = await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null')), 'image/png'));
const response = await fetch('/__tn_conformance__/complete/${encodeURIComponent(test.id)}', { method: 'POST', headers: { 'content-type': 'image/png' }, body: screenshot });
if (!response.ok) throw new Error('completion upload failed: ' + response.status);`
    : '';
  const errorExpr = target === 'browser'
    ? `document.body.dataset.conformanceError = globalThis.__TN_CONFORMANCE_ERROR__;
const pre = document.createElement('pre'); pre.id = 'conformance-error'; pre.textContent = globalThis.__TN_CONFORMANCE_ERROR__; document.body.append(pre);
await fetch('/__tn_conformance__/error/${encodeURIComponent(test.id)}', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: globalThis.__TN_CONFORMANCE_ERROR__ }).catch(() => {});`
    : "console.error('[ThreeNative conformance] failed:', error && error.stack ? error.stack : error);";
  writeFileSync(entryAbs, `import { startScene } from '${rel}';
globalThis.__TN_ASSET_BASE__ = 'http://127.0.0.1:${port}/';
const canvas = ${canvasExpr};
try {
  const state = await startScene(canvas, { width: canvas.width || 1280, height: canvas.height || 720 });
  ${browserSuccess}
  globalThis.__TN_CONFORMANCE_DONE__ = true;
} catch (error) {
  globalThis.__TN_CONFORMANCE_ERROR__ = String(error && error.stack ? error.stack : error);
  ${errorExpr}
}
`);
  return entryAbs;
}

function bundle(entry, out, result, side, esbuildBin, dryRun) {
  if (!existsSync(esbuildBin)) {
    result.status = dryRun ? 'fail' : 'blocked';
    result.blockedReason = 'Install JavaScript dependencies so esbuild can bundle bare three/webgpu and three/addons imports.';
    return false;
  }
  const proc = spawnSync(esbuildBin, [entry, '--bundle', '--outfile=' + out, '--format=esm', '--platform=browser', '--sourcemap'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (proc.status !== 0) {
    result.status = 'fail';
    result[side] = { phase: 'bundle', exitCode: proc.status, stdout: proc.stdout, stderr: proc.stderr };
    return false;
  }
  return true;
}

function contentType(path) {
  if (path.endsWith('.js')) return 'text/javascript';
  if (path.endsWith('.html')) return 'text/html';
  if (path.endsWith('.glb')) return 'model/gltf-binary';
  if (path.endsWith('.gltf')) return 'model/gltf+json';
  if (path.endsWith('.bin')) return 'application/octet-stream';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

function createCompletionBroker(screenshotRoot) {
  const waiters = new Map();
  return {
    wait(id, timeoutMs) {
      return new Promise((resolvePromise) => {
        const timer = setTimeout(() => {
          waiters.delete(id);
          resolvePromise({ kind: 'timeout', error: `browser did not report completion within ${timeoutMs}ms` });
        }, timeoutMs);
        waiters.set(id, {
          cancel() {
            clearTimeout(timer);
            waiters.delete(id);
          },
          settle(value) {
            clearTimeout(timer);
            waiters.delete(id);
            resolvePromise(value);
          },
        });
      });
    },
    cancel(id) {
      waiters.get(id)?.cancel();
    },
    async handle(req, res, pathname) {
      const match = pathname.match(/^\/__tn_conformance__\/(complete|error)\/([a-z0-9-]+)$/);
      if (!match || req.method !== 'POST') return false;
      const [, kind, id] = match;
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 20 * 1024 * 1024) {
          res.writeHead(413); res.end('payload too large'); return true;
        }
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);
      const waiter = waiters.get(id);
      if (kind === 'complete' && data.length > 0) {
        const screenshot = join(screenshotRoot, `browser-${id}.png`);
        writeFileSync(screenshot, data);
        res.writeHead(204); res.end(() => waiter?.settle({ kind: 'complete', screenshot }));
      } else {
        const error = data.toString('utf8') || 'browser reported an empty screenshot';
        res.writeHead(kind === 'error' ? 204 : 400); res.end(() => waiter?.settle({ kind: 'error', error }));
      }
      return true;
    },
  };
}

async function withServer(screenshotRoot, fn) {
  const broker = createCompletionBroker(screenshotRoot);
  const rootPrefix = root.endsWith(sep) ? root : root + sep;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (await broker.handle(req, res, url.pathname)) return;
    const file = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (file !== root && !file.startsWith(rootPrefix)) { res.writeHead(403); res.end('forbidden'); return; }
    try {
      const data = readFileSync(file);
      res.writeHead(200, { 'content-type': contentType(file), 'access-control-allow-origin': '*' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  try {
    return await fn({ port: server.address().port, broker });
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

function appendOutput(current, chunk) {
  return (current + chunk.toString()).slice(-4000);
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 2000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function runBrowser(test, bundlePath, result, port, browser, broker, artifactRoot) {
  if (!browser || !existsSync(browser)) {
    result.status = 'blocked';
    result.blockedReason = 'No Firefox binary found for browser reference execution.';
    return;
  }
  const htmlRel = `artifacts/conformance/browser-${test.id}.html`;
  const htmlAbs = join(root, htmlRel);
  const bundleRel = '/' + relative(root, bundlePath).replaceAll('\\', '/');
  writeFileSync(htmlAbs, `<!doctype html><meta charset="utf-8"><title>${test.id}</title><style>html,body{margin:0;width:1280px;height:720px;background:#111827;overflow:hidden}canvas{display:block;width:1280px;height:720px}</style><canvas id="c" width="1280" height="720"></canvas><script type="module" src="${bundleRel}"></script>`);
  const url = `http://127.0.0.1:${port}/${htmlRel}`;
  const profile = mkdtempSync(join(tmpdir(), 'threenative-firefox-'));
  writeFileSync(join(profile, 'user.js'), [
    'user_pref("dom.webgpu.enabled", true);',
    'user_pref("gfx.webrender.all", true);',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
  ].join('\n'));

  let stdout = '';
  let stderr = '';
  const child = spawn(browser, ['--headless', '--new-instance', '--profile', profile, url], {
    cwd: root,
    env: { ...process.env, MOZ_HEADLESS_WIDTH: '1280', MOZ_HEADLESS_HEIGHT: '720' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { stdout = appendOutput(stdout, chunk); });
  child.stderr.on('data', (chunk) => { stderr = appendOutput(stderr, chunk); });
  const exited = new Promise((resolvePromise) => child.once('exit', (exitCode, signal) => resolvePromise({ kind: 'exit', exitCode, signal })));
  const timeout = Number.parseInt(process.env.TN_BROWSER_TIMEOUT_MS || '90000', 10);
  let outcome;
  try {
    outcome = await Promise.race([broker.wait(test.id, timeout), exited]);
  } finally {
    broker.cancel(test.id);
    await stopProcess(child);
    rmSync(profile, { recursive: true, force: true });
  }

  result.browser = {
    phase: 'completion',
    completed: outcome.kind === 'complete',
    screenshot: outcome.screenshot || null,
    url,
    exitCode: child.exitCode,
    signal: child.signalCode,
    stdout,
    stderr,
  };
  if (outcome.kind !== 'complete' || !outcome.screenshot || !existsSync(outcome.screenshot)) {
    result.status = 'fail';
    result.browser.error = outcome.error || `Firefox exited before completion (${outcome.exitCode ?? outcome.signal ?? 'unknown'})`;
  }
}

function runNative(test, bundlePath, result, runtime, screenshotRoot) {
  if (!runtime || !existsSync(runtime)) {
    result.status = 'blocked';
    result.blockedReason = 'Set TN_RUNTIME or MYSTRAL_BIN to a built/prebuilt runtime to execute native screenshot comparison.';
    return;
  }
  const screenshot = join(screenshotRoot, `native-${test.id}.png`);
  const proc = spawnSync(runtime, ['run', bundlePath, '--screenshot', screenshot, '--frames', '45', '--width', '1280', '--height', '720'], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    timeout: 120_000,
  });
  const combined = `${proc.stdout || ''}\n${proc.stderr || ''}`;
  const hasScreenshot = existsSync(screenshot);
  result.native = {
    completed: proc.status === 0 && hasScreenshot,
    exitCode: proc.status,
    screenshot: hasScreenshot ? screenshot : null,
    stdout: (proc.stdout || '').slice(-4000),
    stderr: (proc.stderr || '').slice(-4000),
  };
  if (!result.native.completed || /TypeError|ReferenceError|SyntaxError|GPUValidationError|Validation Error|Unhandled|ThreeNative conformance\] failed/i.test(combined)) {
    result.status = 'fail';
    result.gpuValidationErrors.push(...(combined.match(/GPUValidationError|Validation Error[^\n]*/g) || []));
  }
}

function computeMetrics(result) {
  const browserScreenshot = result.browser?.screenshot;
  const nativeScreenshot = result.native?.screenshot;
  if (!browserScreenshot || !nativeScreenshot || !existsSync(browserScreenshot) || !existsSync(nativeScreenshot)) {
    result.metricError = 'both completed screenshots are required';
    return false;
  }
  const browserSize = spawnSync('identify', ['-format', '%w %h', browserScreenshot], { encoding: 'utf8', timeout: 10_000 });
  const nativeSize = spawnSync('identify', ['-format', '%w %h', nativeScreenshot], { encoding: 'utf8', timeout: 10_000 });
  if (browserSize.status !== 0 || nativeSize.status !== 0 || browserSize.stdout.trim() !== nativeSize.stdout.trim()) {
    result.metricError = `ImageMagick identify failed or dimensions differ: browser=${browserSize.stdout?.trim() || 'unknown'} native=${nativeSize.stdout?.trim() || 'unknown'}`;
    return false;
  }
  const dimensions = browserSize.stdout.trim().split(/\s+/).map(Number);
  if (dimensions.length !== 2 || dimensions.some((value) => !Number.isFinite(value) || value <= 0)) {
    result.metricError = 'ImageMagick returned invalid screenshot dimensions';
    return false;
  }
  const [width, height] = dimensions;
  const ae = spawnSync('compare', ['-metric', 'AE', browserScreenshot, nativeScreenshot, 'null:'], { encoding: 'utf8', timeout: 30_000 });
  const rmse = spawnSync('compare', ['-metric', 'RMSE', browserScreenshot, nativeScreenshot, 'null:'], { encoding: 'utf8', timeout: 30_000 });
  if (![0, 1].includes(ae.status) || ![0, 1].includes(rmse.status)) {
    result.metricError = `ImageMagick compare failed: AE=${ae.status} RMSE=${rmse.status}`;
    return false;
  }
  const aeValue = Number.parseFloat((ae.stderr || ae.stdout || '').trim());
  const normalizedMatch = (rmse.stderr || rmse.stdout || '').trim().match(/\(([^)]+)\)/);
  const normalized = normalizedMatch ? Number.parseFloat(normalizedMatch[1]) : Number.NaN;
  if (!Number.isFinite(aeValue) || !Number.isFinite(normalized)) {
    result.metricError = 'ImageMagick returned non-numeric comparison metrics';
    return false;
  }
  result.metrics = { pixelMismatchRatio: aeValue / (width * height), perceptualDeltaE: normalized * 100 };
  return true;
}

function createReport(registry, mode, browser, runtime) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    registrySchemaVersion: registry.schemaVersion,
    generatedAt: new Date().toISOString(),
    threeVersion: registry.threeVersion,
    mode,
    host: {
      platform: process.platform,
      arch: process.arch,
      browser: mode === 'execution' ? browser || null : null,
      runtime: mode === 'execution' ? runtime || null : null,
    },
    summary: { pass: 0, fail: 0, blocked: 0, planned: 0, validated: 0 },
    results: [],
  };
}

function createResult(test) {
  return {
    id: test.id,
    scene: test.scene,
    status: 'planned',
    tolerance: test.tolerance,
    browser: null,
    native: null,
    metrics: { pixelMismatchRatio: null, perceptualDeltaE: null },
    gpuValidationErrors: [],
  };
}

function writeReport(report, outPath) {
  const absolute = resolve(root, outPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, JSON.stringify(report, null, 2) + '\n');
}

async function main() {
  const registry = loadRegistry();
  const registryErrors = validateRegistry(registry);
  if (registryErrors.length) throw new Error(`Invalid conformance registry:\n- ${registryErrors.join('\n- ')}`);

  const validatePath = valueAfter('--validate-report');
  if (validatePath) {
    const report = JSON.parse(readFileSync(resolve(root, validatePath), 'utf8'));
    const errors = validateReport(report, registry);
    if (errors.length) throw new Error(`Invalid conformance report:\n- ${errors.join('\n- ')}`);
    console.log(JSON.stringify({ valid: validatePath, schemaVersion: report.schemaVersion }));
    return;
  }

  const outPath = valueAfter('--out') || 'artifacts/conformance/report.json';
  const dryRun = process.argv.includes('--dry-run');
  const allowBlocked = process.argv.includes('--allow-blocked');
  const runtime = process.env.TN_RUNTIME || process.env.MYSTRAL_BIN || '';
  const browser = findFirefox();
  const esbuildBin = process.platform === 'win32' ? join(root, 'node_modules/.bin/esbuild.cmd') : join(root, 'node_modules/.bin/esbuild');
  const artifactRoot = join(root, 'artifacts/conformance');
  const entryRoot = join(artifactRoot, 'entries');
  const browserBundleRoot = join(artifactRoot, 'browser-bundles');
  const nativeBundleRoot = join(artifactRoot, 'native-bundles');
  const screenshotRoot = join(artifactRoot, 'screenshots');
  for (const path of [entryRoot, browserBundleRoot, nativeBundleRoot, screenshotRoot]) mkdirSync(path, { recursive: true });
  const report = createReport(registry, dryRun ? 'dry-run' : 'execution', browser, runtime);

  const executeRows = async (port, broker = null) => {
    for (const test of registry.tests) {
      const result = createResult(test);
      if (test.status !== 'implemented') {
        report.summary.planned++;
        report.results.push(result);
        continue;
      }

      const browserEntry = makeEntry(test, 'browser', port, entryRoot);
      const nativeEntry = makeEntry(test, 'native', port, entryRoot);
      const browserBundle = join(browserBundleRoot, `${test.id}.js`);
      const nativeBundle = join(nativeBundleRoot, `${test.id}.js`);
      result.status = dryRun ? 'validated' : 'pass';
      const browserBundled = bundle(browserEntry, browserBundle, result, 'browser', esbuildBin, dryRun);
      const nativeBundled = bundle(nativeEntry, nativeBundle, result, 'native', esbuildBin, dryRun);

      if (dryRun) {
        if (browserBundled && nativeBundled) {
          result.browserBundle = relative(root, browserBundle).replaceAll('\\', '/');
          result.nativeBundle = relative(root, nativeBundle).replaceAll('\\', '/');
        }
      } else if (browserBundled && nativeBundled) {
        await runBrowser(test, browserBundle, result, port, browser, broker, artifactRoot);
        if (result.status === 'pass') runNative(test, nativeBundle, result, runtime, screenshotRoot);
        if (result.status === 'pass' && !computeMetrics(result)) result.status = 'fail';
        if (result.status === 'pass') {
          const tolerance = test.tolerance;
          if (result.metrics.pixelMismatchRatio > tolerance.pixelMismatchRatio) result.status = 'fail';
          if (result.metrics.perceptualDeltaE > tolerance.perceptualDeltaE) result.status = 'fail';
        }
      }

      report.summary[result.status]++;
      report.results.push(result);
    }
  };

  if (dryRun) await executeRows(0);
  else await withServer(screenshotRoot, ({ port, broker }) => executeRows(port, broker));

  const reportErrors = validateReport(report, registry);
  if (reportErrors.length) throw new Error(`Generated an invalid conformance report:\n- ${reportErrors.join('\n- ')}`);
  writeReport(report, outPath);
  console.log(JSON.stringify({ wrote: outPath, mode: report.mode, summary: report.summary }, null, 2));
  if (report.summary.fail || (!allowBlocked && report.summary.blocked)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
