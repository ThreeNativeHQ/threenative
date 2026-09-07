import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, test } from 'vitest';
import { PNG } from 'pngjs';

import {
  PRODUCTION_EVIDENCE_VERSION,
  ProductionEvidenceError,
  evaluateFrameBudget,
  evaluateProductionEvidence,
  nearestRank,
  sha256,
  writeProductionEvidence,
} from '../scripts/production-evidence.mjs';
import {
  aggregateMetrics,
  desktopFailureRun,
  assembleEvidence,
  isSuccessfulStartupSample,
  installNativeProfileEntry,
  nativeFrameInstrumentation,
  parseProductionArgs,
  prepareNativeWorkload,
  collectionLaunchPlan,
  profileConfigPath,
  postWarmupFrameSamples,
  runProductionProfile,
  safeReport,
  setNativeProfileEntry,
  webFrameInstrumentation,
  writeRunScenarios,
} from '../scripts/profile-production.mjs';

const temporary = [];
const sourceSha = 'a'.repeat(64);
const artifactSha = sha256(Buffer.from('fixture-artifact'));

test('desktop runner exceptions retain failed evidence rather than disappearing', () => {
  const error = new Error('TN_PLAYTEST_OPERATION_TIMEOUT: advance');
  const output = [{ text: 'native bridge connected', type: 'log' }];
  const run = desktopFailureRun(error, output, 123);
  assert.equal(run.status, 2);
  assert.equal(run.report.pass, false);
  assert.equal(run.report.diagnostics[0].message, error.message);
  assert.deepEqual(run.report.observations.console, output);
  assert.equal(run.series, undefined);
  const unsafe = desktopFailureRun(error, [{ text: '/home/operator/private/build', type: 'log' }], 123);
  assert.equal(JSON.stringify(unsafe.report).includes('/home/'), false);
  assert.match(unsafe.report.observations.console[0].text, /TN_PROD_REDACTION/u);
  const source = readFileSync(new URL('../scripts/profile-production.mjs', import.meta.url), 'utf8');
  assert.match(source, /return desktopFailureRun\(error, await driver.captureConsole\(\),/u);
});

test('desktop cleanup tolerates a child process group that already exited', async () => {
  const source = readFileSync(new URL('../scripts/profile-production.mjs', import.meta.url), 'utf8');
  const driverSource = source.slice(source.indexOf('function createDesktopDriver('), source.indexOf('export async function installNativeProfileEntry('));
  const context = {
    join,
    process: {
      env: { DISPLAY: ':fixture' },
      kill: () => {
        const error = new Error('process group already exited');
        error.code = 'ESRCH';
        throw error;
      },
      platform: 'linux',
    },
    spawn: () => {
      const child = new EventEmitter();
      child.exitCode = null;
      child.signalCode = null;
      child.pid = 123;
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    writeFile: async () => undefined,
    rename: async () => undefined,
    nonBlankPng: async () => true,
    DESKTOP_SCREENSHOT_TIMEOUT_MS: 100,
    clearTimeout,
    setTimeout,
  };
  runInNewContext(driverSource, context);
  const driver = context.createDesktopDriver('/fixture/mystral', '/fixture/scaffold', { renderSize: { height: 900, width: 1600 } }, '/fixture/mailbox');
  await driver.launch();
  await assert.doesNotReject(() => driver.stop());
});

test('desktop cleanup observes a Windows child that exits synchronously when killed', async () => {
  const source = readFileSync(new URL('../scripts/profile-production.mjs', import.meta.url), 'utf8');
  const driverSource = source.slice(source.indexOf('function createDesktopDriver('), source.indexOf('export async function installNativeProfileEntry('));
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.pid = 123;
  child.kill = () => {
    child.exitCode = 0;
    child.emit('exit', 0, null);
  };
  const context = {
    join,
    process: { env: {}, platform: 'win32' },
    spawn: () => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    writeFile: async () => undefined,
    rename: async () => undefined,
    nonBlankPng: async () => true,
    DESKTOP_SCREENSHOT_TIMEOUT_MS: 100,
    clearTimeout,
    setTimeout,
  };
  runInNewContext(driverSource, context);
  const driver = context.createDesktopDriver('/fixture/mystral.exe', '/fixture/scaffold', { renderSize: { height: 900, width: 1600 } }, '/fixture/mailbox');
  await driver.launch();
  await assert.doesNotReject(() => Promise.race([
    driver.stop(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('desktop stop timed out')), 100)),
  ]));
});

test('desktop cleanup does not wait forever when a Windows kill emits no exit event', async () => {
  const source = readFileSync(new URL('../scripts/profile-production.mjs', import.meta.url), 'utf8');
  const driverSource = source.slice(source.indexOf('function createDesktopDriver('), source.indexOf('export async function installNativeProfileEntry('));
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.pid = 123;
  child.kill = () => undefined;
  const context = {
    join,
    process: { env: {}, platform: 'win32' },
    spawn: () => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    writeFile: async () => undefined,
    rename: async () => undefined,
    nonBlankPng: async () => true,
    DESKTOP_SCREENSHOT_TIMEOUT_MS: 100,
    clearTimeout,
    setTimeout,
  };
  runInNewContext(driverSource, context);
  const driver = context.createDesktopDriver('/fixture/mystral.exe', '/fixture/scaffold', {
    desktopCleanupTimeoutMs: 25,
    renderSize: { height: 900, width: 1600 },
  }, '/fixture/mailbox');
  await driver.launch();
  await assert.rejects(driver.stop(), (error) => {
    assert.equal(error.diagnostic.code, 'TN_PROD_DESKTOP_CLEANUP_TIMEOUT');
    assert.equal(error.diagnostic.phase, 'desktop-stop');
    assert.equal(error.diagnostic.processState, 'alive');
    assert.equal(error.diagnostic.observedAlive, true);
    assert.equal(error.diagnostic.observedExited, false);
    return true;
  });
});

test('desktop cleanup diagnostics survive conversion to a failed production run', () => {
  const cleanupDiagnostic = {
    code: 'TN_PROD_DESKTOP_CLEANUP_TIMEOUT',
    message: 'Desktop cleanup phase stopped observing an alive process.',
    observedAlive: true,
    observedExited: false,
    phase: 'desktop-stop',
    processState: 'alive',
    severity: 'error',
  };
  const cleanupError = Object.assign(new Error(cleanupDiagnostic.message), { diagnostic: cleanupDiagnostic });
  const run = desktopFailureRun(new Error('playtest failed'), [], 123, cleanupError);
  assert.deepEqual(run.report.diagnostics, [cleanupDiagnostic]);
  assert.equal(run.status, 2);
  assert.equal(run.report.pass, false);
});

test('native report retention redacts unsafe host console paths without dropping safe evidence', () => {
  const report = safeReport({
    assertionResults: [{ id: 'diagnostics', pass: false }],
    diagnostics: [],
    observations: {
      console: [
        { text: '/home/operator/.local/share/mystral/storage/platformer.json', type: 'log' },
        { text: 'TN_NATIVE_SMOKE_READY:webgpu', type: 'log' },
      ],
      network: [],
    },
    pass: false,
    scenario: 'production-startup',
    target: 'desktop',
  });
  assert.match(report.observations.console[0].text, /TN_PROD_REDACTION/u);
  assert.equal(report.observations.console[1].text, 'TN_NATIVE_SMOKE_READY:webgpu');
});

test('desktop child receives the transport mailbox root and writes a raw post-present screenshot request', async () => {
  const source = readFileSync(new URL('../scripts/profile-production.mjs', import.meta.url), 'utf8');
  const driverSource = source.slice(source.indexOf('function createDesktopDriver('), source.indexOf('export async function installNativeProfileEntry('));
  const project = '/fixture/scaffold';
  const mailboxRoot = join(project, '.runtime-mailbox');
  const screenshotRequestPath = join(mailboxRoot, 'tn-playtest-screenshot-request.txt');
  let childOptions;
  const writes = [];
  const context = {
    join,
    process: { platform: 'linux', env: { DISPLAY: ':fixture', TN_PLAYTEST_MAILBOX_ROOT: '/wrong/inherited/root' } },
    spawn: (_command, _args, options) => {
      childOptions = options;
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    writeFile: async (path, contents) => writes.push({ contents, path }),
    rename: async (from, to) => writes.push({ from, to }),
    nonBlankPng: async () => true,
    DESKTOP_SCREENSHOT_TIMEOUT_MS: 100,
  };
  runInNewContext(driverSource, context);
  const driver = context.createDesktopDriver('/fixture/mystral', project, { renderSize: { width: 1920, height: 1080 } }, mailboxRoot);
  await driver.launch();
  assert.equal(childOptions.env.TN_PLAYTEST_MAILBOX_ROOT, mailboxRoot);
  assert.equal(childOptions.cwd, project);
  await driver.screenshot('/fixture/capture.png');
  assert.deepEqual(writes, [
    { contents: '/fixture/capture.png', path: `${screenshotRequestPath}.tmp` },
    { from: `${screenshotRequestPath}.tmp`, to: screenshotRequestPath },
  ]);
  assert.match(source, /const driver = createDesktopDriver\(artifactPath, project, options, mailboxRoot\)/u);
});

test('production desktop mailbox uses atomic request writes', () => {
  const source = readFileSync(new URL('../scripts/profile-production.mjs', import.meta.url), 'utf8');
  assert.match(source, /const mailbox = new runner\.LocalDeviceMailbox\(\);/u);
});

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { force: true, recursive: true });
});

function injectedFrameSamples(source, performanceObservation, frameMs = 14) {
  let scheduledCallback;
  let now = 0;
  let rendered = false;
  let sampledBeforeRender = false;
  const samples = [];
  const sampleLines = [];
  const record = (payload) => {
    if (payload?.kind === 'samples' && Array.isArray(payload.samples)) samples.push(...payload.samples);
  };
  const context = {
    __THREENATIVE_PLAYTEST_BRIDGE__: {
      sample: () => {
        if (!rendered) sampledBeforeRender = true;
        return performanceObservation === undefined ? {} : { performance: performanceObservation };
      },
    },
    cancelAnimationFrame: () => undefined,
    console: {
      log: (line) => {
        const prefix = 'TN_PROD_FRAME_SAMPLES:';
        if (typeof line === 'string' && line.startsWith(prefix)) {
          sampleLines.push(line);
          record({ kind: 'samples', samples: JSON.parse(line.slice(prefix.length)) });
        }
      },
    },
    fetch: async (_url, request) => {
      record(JSON.parse(request.body));
      return {};
    },
    performance: { now: () => now },
    requestAnimationFrame: (callback) => {
      scheduledCallback = callback;
      return 1;
    },
  };
  runInNewContext(source, context);
  const schedule = context.requestAnimationFrame;
  for (let frame = 0; frame <= 30; frame += 1) {
    rendered = false;
    scheduledCallback = undefined;
    schedule(() => { rendered = true; });
    assert.equal(typeof scheduledCallback, 'function');
    now = frame * frameMs;
    scheduledCallback(now);
  }
  return { sampledBeforeRender, sampleLines, samples };
}

function completeEvidence(overrides = {}) {
  const intervals = [
    { frameMs: 16, sequence: 1, timestampMs: 1_000 },
    { frameMs: 17, sequence: 2, timestampMs: 1_016 },
  ];
  return {
    artifact: { applicationClass: 'fixture', sha256: artifactSha, signed: false },
    artifacts: [],
    budget: { maxP99FrameMs: 33, maxStartupMs: 5_000, minMeanFps: 60 },
    command: 'fixture',
    identity: { driverClass: 'driver', gpuClass: 'gpu', hostClass: 'host', osClass: 'os' },
    markers: ['run-start', 'first-workload-frame', 'clean-end'],
    metrics: {
      battery: { complete: true, samples: 1 },
      durationSeconds: 1,
      frameIntervalsMs: intervals.map(({ frameMs }) => frameMs),
      intervals,
      memory: { complete: true, growthBytes: 0, highWaterBytes: 1, slopeBytesPerMinute: 0 },
      startupMs: 100,
      thermal: { complete: true, samples: 1 },
    },
    runId: 'fixture-run',
    source: { dirty: false, sha: sourceSha },
    target: 'fixture',
    timestamps: { endedAt: '2026-08-09T00:01:00.000Z', startedAt: '2026-08-09T00:00:00.000Z' },
    version: PRODUCTION_EVIDENCE_VERSION,
    ...overrides,
  };
}

test('production evidence uses nearest-rank pacing and arithmetic mean fps', () => {
  assert.equal(nearestRank([16, 17, 2_000], 0.99), 2_000);
  const budget = evaluateFrameBudget(
    { frameIntervalsMs: [16, 16, 17], intervals: [] },
    { maxP99FrameMs: 33, minMeanFps: 60 },
  );
  assert.equal(budget.failures.length, 0);
  assert.ok(budget.mean > 60);
  assert.deepEqual(evaluateFrameBudget({ frameIntervalsMs: [40, 40, 40] }, { minFps: 30 }).failures, ['TN_PROD_PERFORMANCE_BUDGET']);
});

test('complete current evidence is the only PASS state', () => {
  const result = evaluateProductionEvidence(completeEvidence());
  assert.equal(result.status, 'PASS');
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.codes, []);
});

test('hosted software keeps timing failures advisory while preserving measured budgets', () => {
  const result = evaluateProductionEvidence(completeEvidence({
    execution: { performanceEvaluation: 'advisory' },
    metrics: {
      ...completeEvidence().metrics,
      frameIntervalsMs: [40, 40, 40],
      intervals: [
        { frameMs: 40, sequence: 1, timestampMs: 1_000 },
        { frameMs: 40, sequence: 2, timestampMs: 1_040 },
        { frameMs: 40, sequence: 3, timestampMs: 1_080 },
      ],
    },
  }));
  assert.equal(result.status, 'PASS');
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.codes, []);
  assert.deepEqual(result.advisoryCodes, ['TN_PROD_PERFORMANCE_BUDGET']);
});

test('hosted native collection allows software-adapter startup settlement', () => {
  const source = readFileSync(new URL('../scripts/profile-production.mjs', import.meta.url), 'utf8');
  assert.equal((source.match(/allowSoftwareAdapter: options\.hostedSoftware/gu) ?? []).length, 2);
});

function regressionEvidence(overrides = {}) {
  const count = 1_800;
  const frameMs = 1_000 / 60;
  const intervals = Array.from({ length: count }, (_, index) => ({
    clockMs: index * frameMs,
    frameMs,
    sequence: index + 1,
    timestampMs: index * frameMs,
  }));
  return completeEvidence({
    budget: {
      maxP99FrameMs: 33,
      maxStartupMs: 5_000,
      minMeanFps: 60,
      minDurationSeconds: 30,
      minFrameSamples: 1_000,
    },
    execution: {
      coldStarts: 5,
      profile: 'regression',
      readiness: { ready: true, sampleReset: true },
      warmupReset: true,
    },
    markers: ['run-start', 'first-workload-frame', 'clean-end'],
    metrics: {
      battery: { complete: true, samples: 1 },
      clockSamplesMs: intervals.map(({ clockMs }) => clockMs),
      clockSource: 'monotonic-performance',
      durationSeconds: 30,
      frameIntervalsMs: intervals.map(({ frameMs: value }) => value),
      intervals,
      meanFps: 60,
      memory: { complete: true, growthBytes: 0, highWaterBytes: 1, slopeBytesPerMinute: 0 },
      motion: { moved: true, movingObjects: 256 },
      pixels: { changed: true, nonBlank: true },
      presentationClockSource: 'raf-presentation',
      presentationSamplesMs: intervals.map(({ clockMs }) => clockMs),
      runWindows: [{ durationSeconds: 30, sampleCount: count }],
      startupSamplesMs: [100, 100, 100, 100, 100],
      startupMs: 100,
      thermal: { complete: true, samples: 1 },
    },
    ...overrides,
  });
}

test('regression evidence accepts a bounded real-clock, ready, moving, pixel-backed window', () => {
  const result = evaluateProductionEvidence(regressionEvidence());
  assert.equal(result.status, 'PASS');
  assert.equal(result.exitCode, 0);
});

test('regression readiness requires the explicit runtimeReady observation', () => {
  const frame = new PNG({ height: 2, width: 2 });
  frame.data.fill(255);
  frame.data[0] = 0;
  const makeEvidence = (runtimeReady) => assembleEvidence({
    context: { audioEvidence: {}, physicalEvidence: {}, sourceSha, sourceState: { dirty: false } },
    native: undefined,
    options: {
      coldStarts: 1,
      control: undefined,
      device: undefined,
      profile: 'regression',
      renderSize: { height: 1080, width: 1920 },
      repetitions: 1,
      target: 'web',
      warmup: 0,
    },
    performanceBounds: undefined,
    project: 'fixture-project',
    runId: `readiness-${runtimeReady ? 'present' : 'missing'}`,
    startedAt: new Date().toISOString(),
    web: {
      applicationClass: 'fixture',
      artifactSha,
      driverClass: 'fixture',
      kind: 'web',
      runs: [{
        report: {
          assertionResults: [{
            details: { policy: runtimeReady ? { runtimeReady: true } : {} },
            id: 'diagnostics',
            pass: true,
          }],
          diagnostics: [],
          pass: true,
        },
        screenshot: PNG.sync.write(frame),
        series: [{ frameIndex: 1, frameMs: 16 }],
        status: 0,
      }],
      startups: [],
    },
  });
  assert.equal(makeEvidence(false).execution.readiness.ready, false);
  assert.equal(makeEvidence(true).execution.readiness.ready, true);
  const blocked = evaluateProductionEvidence(regressionEvidence({
    execution: { ...regressionEvidence().execution, readiness: { ready: false, sampleReset: true } },
  }));
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.exitCode, 2);
  assert.ok(blocked.codes.includes('TN_PROD_READINESS_MISSING'));
});

test('regression evidence requires every launch to meet the full steady-state window', () => {
  const result = evaluateProductionEvidence(regressionEvidence({
    metrics: {
      ...regressionEvidence().metrics,
      runWindows: [
        { durationSeconds: 30, sampleCount: 1_800 },
        { durationSeconds: 2, sampleCount: 120 },
      ],
    },
  }));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.exitCode, 2);
  assert.ok(result.codes.includes('TN_PROD_REGRESSION_WINDOW'));
});

test('regression rejects pooling two individually valid steady launches', () => {
  const base = regressionEvidence();
  const result = evaluateProductionEvidence({ ...base, metrics: { ...base.metrics, runWindows: [
    { durationSeconds: 30, sampleCount: 1800 }, { durationSeconds: 30, sampleCount: 1800 },
  ] } });
  assert.equal(result.status, 'BLOCKED');
});

test('generated native mailbox declaration is executable and independent of scaffold directory', async () => {
  const project = makeTempDirSync('tn-profile-mailbox-');
  temporary.push(project);
  mkdirSync(join(project, 'src'));
  writeFileSync(join(project, 'package.json'), '{}');
  writeFileSync(join(project, 'threenative.config.ts'), 'export default { nativeEntry: "src/game.ts" };');
  await installNativeProfileEntry(project, 'desktop', { warmup: 1 });
  const source = readFileSync(join(project, 'src/profile-native-entry.ts'), 'utf8');
  const declaration = source.split('\n').find((line) => line.startsWith('globalThis.TN_PLAYTEST_MAILBOX'));
  const context = {};
  runInNewContext(declaration, context);
  assert.equal(context.TN_PLAYTEST_MAILBOX.request, '.runtime-mailbox/tn-playtest-request.json');
  assert.doesNotMatch(source, /tn-production-screenshot-request\.json|tnProductionScreenshotRequestPath|captureScreenshot|playtest\?\.receive/u);
});

test('generated native profile exposes hosted software only to the profile entry', async () => {
  const hostedProject = makeTempDirSync('tn-profile-hosted-software-');
  const normalProject = makeTempDirSync('tn-profile-normal-software-');
  temporary.push(hostedProject, normalProject);
  for (const project of [hostedProject, normalProject]) {
    mkdirSync(join(project, 'src'));
    writeFileSync(join(project, 'package.json'), '{}');
    writeFileSync(join(project, 'threenative.config.ts'), 'export default { nativeEntry: "src/game.ts" };');
  }

  await installNativeProfileEntry(hostedProject, 'desktop', { hostedSoftware: true, warmup: 1 });
  await installNativeProfileEntry(normalProject, 'desktop', { hostedSoftware: false, warmup: 1 });

  const hostedEntry = readFileSync(join(hostedProject, 'src/profile-native-entry.ts'), 'utf8');
  const hostedMarker = readFileSync(join(hostedProject, 'src/profile-native-profile.ts'), 'utf8');
  const normalMarker = readFileSync(join(normalProject, 'src/profile-native-profile.ts'), 'utf8');
  assert.match(hostedEntry, /import "\.\/profile-native-profile\.js";/u);
  const hostedContext = {};
  const normalContext = {};
  runInNewContext(hostedMarker, hostedContext);
  runInNewContext(normalMarker, normalContext);
  assert.equal(hostedContext.__THREENATIVE_PROFILE__.hostedSoftware, true);
  assert.equal(normalContext.__THREENATIVE_PROFILE__.hostedSoftware, false);
});

test('desktop profiling switches web UI to native while mobile profiling preserves web UI', async () => {
  const desktopProject = makeTempDirSync('tn-profile-desktop-ui-');
  const mobileProject = makeTempDirSync('tn-profile-mobile-ui-');
  temporary.push(desktopProject, mobileProject);
  for (const project of [desktopProject, mobileProject]) {
    mkdirSync(join(project, 'src'));
    writeFileSync(join(project, 'package.json'), '{}');
    writeFileSync(
      join(project, 'threenative.config.ts'),
      'export default { nativeEntry: "src/game.ts", ui: { renderer: "web" } };\n',
    );
  }

  await installNativeProfileEntry(desktopProject, 'desktop', { warmup: 1 });
  await installNativeProfileEntry(mobileProject, 'android', { warmup: 1 });

  assert.match(readFileSync(join(desktopProject, 'threenative.config.ts'), 'utf8'), /ui: \{ renderer: "native" \}/u);
  assert.match(readFileSync(join(mobileProject, 'threenative.config.ts'), 'utf8'), /ui: \{ renderer: "web" \}/u);
});

test('physical regression evidence blocks a thermally confounded device result', () => {
  const base = regressionEvidence();
  const result = evaluateProductionEvidence({
    ...base,
    metrics: {
      ...base.metrics,
      thermal: { complete: true, samples: 2, thermallyConfounded: true },
    },
    physical: { provenance: 'physical-hardware' },
    target: 'android-physical',
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.exitCode, 2);
  assert.ok(result.codes.includes('TN_PROD_THERMAL_STATE_INVALID'));
});

test('regression evidence blocks short windows, fixed clocks, contaminated startup, frozen work, and changed-pixel gaps', () => {
  const cases = [
    ['short window', { metrics: { ...regressionEvidence().metrics, durationSeconds: 29, frameIntervalsMs: Array(999).fill(16.666) } }, 'TN_PROD_REGRESSION_WINDOW'],
    ['fixed tick', { metrics: { ...regressionEvidence().metrics, clockSource: 'fixed-tick' } }, 'TN_PROD_CLOCK_INVALID'],
    ['startup contamination', { execution: { ...regressionEvidence().execution, warmupReset: false } }, 'TN_PROD_STARTUP_CONTAMINATION'],
    ['frozen motion', { metrics: { ...regressionEvidence().metrics, motion: { moved: false, movingObjects: 0 } } }, 'TN_PROD_MOTION_MISSING'],
    ['changed pixels missing', { metrics: { ...regressionEvidence().metrics, pixels: { changed: false, nonBlank: true } } }, 'TN_PROD_PIXEL_EVIDENCE_MISSING'],
  ];
  for (const [name, override, code] of cases) {
    const result = evaluateProductionEvidence(regressionEvidence(override));
    assert.equal(result.status, 'BLOCKED', name);
    assert.equal(result.exitCode, 2, name);
    assert.ok(result.codes.includes(code), `${name}: ${result.codes.join(', ')}`);
  }
});

test('missing lifecycle marker is BLOCKED with exit 2', () => {
  const result = evaluateProductionEvidence(completeEvidence({ markers: ['run-start', 'clean-end'] }));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.exitCode, 2);
  assert.ok(result.codes.includes('TN_PROD_MARKER_MISSING'));
});

test('executed pacing, startup, and memory breaches are FAIL with distinct codes', () => {
  const result = evaluateProductionEvidence(completeEvidence({
    budget: { maxMemoryGrowthBytes: 64, maxP99FrameMs: 33, maxStartupMs: 5_000, minMeanFps: 60 },
    metrics: {
      ...completeEvidence().metrics,
      frameIntervalsMs: [16, 16, 2_000],
      intervals: [
        { frameMs: 16, sequence: 1, timestampMs: 1_000 },
        { frameMs: 16, sequence: 2, timestampMs: 1_016 },
        { frameMs: 2_000, sequence: 3, timestampMs: 1_032 },
      ],
      memory: { complete: true, first15MedianBytes: 100, growthBytes: 128, highWaterBytes: 200, last15MedianBytes: 200, slopeBytesPerMinute: 1 },
      startupSamplesMs: [100, 100, 100, 100, 6_000],
    },
  }));
  assert.equal(result.status, 'FAIL');
  assert.equal(result.exitCode, 1);
  assert.ok(result.codes.includes('TN_PROD_PERFORMANCE_BUDGET'));
  assert.ok(result.codes.includes('TN_PROD_STARTUP_BUDGET'));
  assert.ok(result.codes.includes('TN_PROD_MEMORY_GROWTH'));
});

test('desktop parity requires distinct identities and no slower native statistics', () => {
  const pass = evaluateProductionEvidence(completeEvidence({
    target: 'desktop-pair',
    identity: { nativeArtifactSha256: 'b'.repeat(64), nativeProcess: 'native', webArtifactSha256: 'c'.repeat(64), webProcess: 'browser' },
    metrics: { ...completeEvidence().metrics, native: { meanFps: 60, p50FrameMs: 16, p95FrameMs: 18, p99FrameMs: 20 }, web: { meanFps: 60, p50FrameMs: 16, p95FrameMs: 18, p99FrameMs: 20 } },
  }));
  assert.equal(pass.status, 'PASS');
  const self = evaluateProductionEvidence(completeEvidence({
    target: 'desktop-pair',
    identity: { nativeArtifactSha256: 'b'.repeat(64), nativeProcess: 'same', webArtifactSha256: 'b'.repeat(64), webProcess: 'same' },
    metrics: { ...completeEvidence().metrics, native: { meanFps: 60, p50FrameMs: 16, p95FrameMs: 18, p99FrameMs: 20 }, web: { meanFps: 60, p50FrameMs: 16, p95FrameMs: 18, p99FrameMs: 20 } },
  }));
  assert.equal(self.status, 'BLOCKED');
  assert.ok(self.codes.includes('TN_PROD_SELF_COMPARISON'));
});

test('desktop parity blocks before comparing incomplete or non-finite arm metrics', () => {
  const result = evaluateProductionEvidence(completeEvidence({
    target: 'desktop-pair',
    identity: { nativeArtifactSha256: 'b'.repeat(64), nativeProcess: 'native', webArtifactSha256: 'c'.repeat(64), webProcess: 'browser' },
    metrics: {
      ...completeEvidence().metrics,
      native: { meanFps: 60, p50FrameMs: 16, p95FrameMs: Number.NaN, p99FrameMs: 20 },
      web: { meanFps: 60, p50FrameMs: 16, p95FrameMs: 18, p99FrameMs: 20 },
    },
  }));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.exitCode, 2);
  assert.ok(result.codes.includes('TN_PROD_COMPARISON_METRICS_INCOMPLETE'));
  assert.equal(result.codes.includes('TN_PROD_PERFORMANCE_BUDGET'), false);
});

test('accepted profile controls are parsed and execution receives every value', async () => {
  const parsed = parseProductionArgs([
    '--target', 'android',
    '--render-size', '1920x1080',
    '--cold-starts', '2',
    '--device', 'emulator-5554',
    '--prebuilt-artifact', '/tmp/already-built-runtime.apk',
    '--warmup', '3',
    '--repetitions', '4',
  ]);
  assert.deepEqual(parsed.renderSize, { height: 1080, width: 1920 });
  assert.equal(parsed.coldStarts, 2);
  assert.equal(parsed.device, 'emulator-5554');
  assert.equal(parsed.prebuiltArtifact, '/tmp/already-built-runtime.apk');
  assert.equal(parsed.warmup, 3);
  assert.equal(parsed.repetitions, 4);
  assert.equal(parsed.profile, 'production');
  const hosted = parseProductionArgs(['--target', 'desktop', '--hosted-software']);
  assert.equal(hosted.hostedSoftware, true);
  assert.deepEqual(hosted.renderSize, { height: 720, width: 1280 });
  const hostedExplicit = parseProductionArgs([
    '--target', 'desktop', '--hosted-software', '--render-size', '1920x1080',
  ]);
  assert.deepEqual(hostedExplicit.renderSize, { height: 1080, width: 1920 });
  const hostedAndroid = parseProductionArgs([
    '--target', 'android', '--device', 'emulator-5554', '--hosted-software',
  ]);
  assert.deepEqual(hostedAndroid.renderSize, { height: 1080, width: 1920 });
  const relativeArtifact = parseProductionArgs([
    '--target', 'desktop',
    '--prebuilt-artifact', 'build/tn-macos/mystral',
  ]);
  assert.equal(
    relativeArtifact.prebuiltArtifact,
    resolve('build/tn-macos/mystral'),
  );
  const regression = parseProductionArgs(['--target', 'desktop', '--profile', 'regression']);
  assert.equal(regression.profile, 'regression');
  assert.equal(regression.duration, 30);
  assert.equal(regression.warmup, 5);
  assert.equal(regression.coldStarts, 5);
  assert.equal(regression.repetitions, 1);
  assert.equal(parseProductionArgs(['--target', 'desktop-web']).target, 'web');
  assert.throws(
    () => parseProductionArgs(['--target', 'web', '--device', 'emulator-5554']),
    (error) => error instanceof ProductionEvidenceError && error.code === 'TN_PROD_DEVICE_UNSUPPORTED',
  );
  assert.throws(
    () => parseProductionArgs(['--target', 'android-physical', '--device', 'pixel', '--hosted-software']),
    (error) => error instanceof ProductionEvidenceError && error.code === 'TN_PROD_HOSTED_SOFTWARE_UNSUPPORTED',
  );
});

test('native profile entry replaces a config entry without creating a package conflict', async () => {
  const project = makeTempDirSync('tn-profile-entry-');
  temporary.push(project);
  mkdirSync(join(project, 'src'));
  writeFileSync(join(project, 'package.json'), JSON.stringify({
    name: 'fixture',
    threenative: { nativeEntry: 'src/game.ts' },
  }));
  writeFileSync(join(project, 'threenative.config.ts'), 'export default {\n  nativeEntry: "src/game.ts",\n};\n');

  await setNativeProfileEntry(project, 'src/profile-native-entry.ts');

  assert.match(
    readFileSync(join(project, 'threenative.config.ts'), 'utf8'),
    /nativeEntry: "src\/profile-native-entry\.ts"/u,
  );
  assert.equal(JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')).threenative, undefined);
});

test('native profile reads the generated app identity when no config override is supplied', () => {
  assert.equal(
    profileConfigPath('/tmp/platformer'),
    '/tmp/platformer/.threenative/build/config.json',
  );
  assert.equal(
    profileConfigPath('/tmp/platformer', '/tmp/custom-config.json'),
    '/tmp/custom-config.json',
  );
});

test('regression collects one steady launch and five startup launches per paired arm', () => {
  const options = parseProductionArgs(['--target', 'desktop', '--profile', 'regression']);
  const plan = collectionLaunchPlan(options);
  assert.equal(plan.filter((entry) => entry === 'startup').length, 5);
  assert.equal(plan.filter((entry) => entry === 'steady').length, 1);
  assert.ok(6 * (options.duration + options.warmup + options.coldStarts * 8) < 900);
  assert.throws(() => parseProductionArgs(['--target', 'desktop', '--profile', 'regression', '--repetitions', '3']), { code: 'TN_PROD_PAIR_UNIT' });
});

test('prebuilt desktop still builds its instrumented scaffold with the supplied runtime', async () => {
  const calls = [];
  await prepareNativeWorkload('/project', 'desktop', { prebuiltArtifact: '/runtime/mystral' }, async (...args) => {
    calls.push(args);
    return { status: 0 };
  });
  assert.deepEqual(calls[0].slice(0, 3), ['pnpm', ['run', 'build:desktop'], '/project']);
  assert.equal(calls[0][3].THREENATIVE_RUNTIME_BINARY, '/runtime/mystral');
});

test('prebuilt mobile refuses an app without a bound instrumented workload receipt', async () => {
  await assert.rejects(prepareNativeWorkload('/project', 'android', { prebuiltArtifact: '/missing.apk' }), { code: 'TN_PROD_PREBUILT_WORKLOAD' });
});

test('startup aggregation rejects failed reports and blank first frames', () => {
  const blank = new PNG({ height: 2, width: 2 });
  blank.data.fill(255);
  const frame = new PNG({ height: 2, width: 2 });
  frame.data.fill(255);
  frame.data[0] = 0;
  frame.data[1] = 64;
  frame.data[2] = 128;
  const valid = {
    firstFrameMs: 100,
    report: { pass: true },
    screenshot: PNG.sync.write(frame),
    status: 0,
  };
  assert.equal(isSuccessfulStartupSample(valid), true);
  assert.equal(isSuccessfulStartupSample({ ...valid, report: undefined }), false);
  assert.equal(isSuccessfulStartupSample({ ...valid, screenshot: PNG.sync.write(blank) }), false);
  const metrics = aggregateMetrics(
    [{ series: [{ frameMs: 16.5 }], status: 0 }],
    [{ ...valid, report: undefined }, { ...valid, screenshot: undefined }],
  );
  assert.equal(metrics.startupSamplesMs, undefined);
  assert.equal(metrics.startupP95Ms, undefined);
});

test('native scenarios explicitly waive browser network observation while browser startup retains it', async () => {
  const project = makeTempDirSync('tn-native-diagnostics-');
  temporary.push(project);
  mkdirSync(join(project, 'playtests'));
  writeFileSync(join(project, 'playtests/performance.playtest.json'), JSON.stringify({
    name: 'production-performance', schemaVersion: 1, steps: [{ kind: 'wait', waitFrames: 10 }],
    assert: { diagnostics: { noConsoleErrors: true, noNetworkErrors: true, noRuntimeDiagnostics: true, runtimeReady: true } },
  }));
  const playtest = await import(new URL('../../playtest/dist/index.js', import.meta.url).href);
  for (const target of ['desktop', 'android', 'ios']) {
    const paths = await writeRunScenarios(project, { duration: 1, warmup: 1, target, renderSize: { width: 1920, height: 1080 } });
    for (const path of [paths.startupPath, paths.workloadPath]) {
      const scenario = await playtest.loadPlaytestScenario(project, path);
      assert.notEqual(scenario.assert.diagnostics.noNetworkErrors, false);
      assert.equal(playtest.requiredPlaytestCapabilities(scenario).includes('browser.network'), true);
      assert.equal(scenario.assert.diagnostics.networkErrorsOptOutReason, undefined);
    }
    for (const path of [paths.nativeStartupPath, paths.nativeWorkloadPath]) {
      const scenario = await playtest.loadPlaytestScenario(project, path);
      const policy = scenario.assert.diagnostics;
      assert.equal(policy.noNetworkErrors, false);
      assert.equal(playtest.requiredPlaytestCapabilities(scenario).includes('browser.network'), false);
      assert.match(policy.networkErrorsOptOutReason, /native.*network/i);
      assert.equal(policy.noConsoleErrors, true);
      assert.equal(policy.noRuntimeDiagnostics, true);
      assert.equal(policy.runtimeReady, true);
    }
  }
});

test('generated production workload runs through the playtest validator and keeps source bounds out of band', async () => {
  const project = makeTempDirSync('tn-prd064-scenario-');
  temporary.push(project);
  mkdirSync(join(project, 'playtests'));
  const assertion = { performance: { maxDrawCalls: 180, maxFrameMsP95: 15, maxTriangles: 100_000, minFps: 30 } };
  writeFileSync(join(project, 'playtests/performance.playtest.json'), JSON.stringify({
    assert: assertion,
    artifacts: { screenshots: 'after' },
    name: 'production-performance',
    schemaVersion: 1,
    steps: [{ kind: 'wait', waitFrames: 10 }],
  }));

  const paths = await writeRunScenarios(project, {
    duration: 1,
    renderSize: { height: 1080, width: 1920 },
    target: 'desktop',
    warmup: 1,
  });
  const workload = JSON.parse(readFileSync(paths.workloadPath, 'utf8'));
  const nativeWorkload = JSON.parse(readFileSync(paths.nativeWorkloadPath, 'utf8'));
  assert.deepEqual(workload.assert, { diagnostics: { noConsoleErrors: true, runtimeReady: true } });
  assert.equal(nativeWorkload.assert.diagnostics.noNetworkErrors, false);
  assert.equal(nativeWorkload.assert.diagnostics.noConsoleErrors, true);
  assert.equal(workload.assert.performance, undefined);
  assert.deepEqual(paths.performanceBounds, assertion.performance);
  assert.equal(nativeWorkload.artifacts.screenshots, 'after');

  const playtest = await import(new URL('../../playtest/dist/index.js', import.meta.url).href);
  const runner = await import(new URL('../../playtest/dist/runner/index.js', import.meta.url).href);
  const scenario = await playtest.loadPlaytestScenario(project, paths.workloadPath);
  const report = runner.buildReport(
    {
      artifactDirectory: project,
      headless: true,
      projectPath: project,
      scenarioPath: paths.workloadPath,
      timeoutMs: 1_000,
      trace: false,
      url: 'http://127.0.0.1:41777',
    },
    scenario,
    undefined,
    undefined,
    [],
    [],
    undefined,
    {},
    true,
  );
  assert.equal(report.diagnostics.some(({ code }) => code === 'TN_PLAYTEST_SCENARIO_INVALID'), false);
  assert.equal(report.pass, true);

  const androidPaths = await writeRunScenarios(project, {
    duration: 2,
    renderSize: { height: 1080, width: 1920 },
    target: 'android',
    warmup: 1,
  });
  const androidWorkload = JSON.parse(readFileSync(androidPaths.nativeWorkloadPath, 'utf8'));
  assert.equal(androidWorkload.steps.length, 61);
  assert.deepEqual(androidWorkload.steps[0], {
    holdFrames: 60,
    kind: 'input',
    press: 'ArrowRight',
    release: true,
  });
  assert.deepEqual(androidWorkload.steps.at(-1), { kind: 'wait', release: true, waitFrames: 1 });

  const regressionPaths = await writeRunScenarios(project, {
    duration: 30,
    profile: 'regression',
    renderSize: { height: 1080, width: 1920 },
    target: 'android-physical',
    warmup: 5,
  });
  const regressionWorkload = JSON.parse(readFileSync(regressionPaths.workloadPath, 'utf8'));
  const regressionNativeWorkload = JSON.parse(readFileSync(regressionPaths.nativeWorkloadPath, 'utf8'));
  assert.deepEqual(regressionWorkload.assert.movement, { entity: 'player', minDistance: 0.1 });
  assert.equal(regressionNativeWorkload.artifacts.screenshots, 'after');
  assert.equal(regressionNativeWorkload.steps.length, 1_741);
  assert.equal(regressionNativeWorkload.steps.at(-1).waitFrames, 1);

  const rendererPerformance = { drawCalls: 180, triangles: 100_000 };
  const nativeSamples = injectedFrameSamples(
    nativeFrameInstrumentation(undefined, 0),
    rendererPerformance,
  );
  const webSamples = injectedFrameSamples(
    webFrameInstrumentation('http://127.0.0.1:41777', undefined, 0),
    rendererPerformance,
  );
  assert.equal(nativeSamples.sampledBeforeRender, false);
  assert.equal(webSamples.sampledBeforeRender, false);
  assert.equal(nativeSamples.samples.length, 30);
  assert.equal(webSamples.samples.length, 30);
  assert.ok(nativeSamples.sampleLines.every((line) => line.length < 1_000));
  assert.deepEqual(nativeSamples.samples[0], { clockMs: 14, drawCalls: 180, frameIndex: 1, frameMs: 14, presentationMs: 14, triangles: 100_000 });
  assert.deepEqual(webSamples.samples[0], { clockMs: 14, drawCalls: 180, frameIndex: 1, frameMs: 14, presentationMs: 14, triangles: 100_000 });
  const missingSamples = injectedFrameSamples(
    webFrameInstrumentation('http://127.0.0.1:41777', undefined, 0),
    undefined,
  );
  assert.equal(Object.hasOwn(missingSamples.samples[0], 'drawCalls'), false);
  assert.equal(Object.hasOwn(missingSamples.samples[0], 'triangles'), false);

  const frame = new PNG({ height: 2, width: 2 });
  frame.data.fill(255);
  frame.data[0] = 0;
  const screenshot = PNG.sync.write(frame);
  const evidence = assembleEvidence({
    context: { audioEvidence: {}, physicalEvidence: {}, sourceSha, sourceState: { dirty: false } },
    native: undefined,
    options: {
      coldStarts: 1,
      control: undefined,
      device: undefined,
      renderSize: { height: 1080, width: 1920 },
      repetitions: 1,
      target: 'web',
      warmup: 0,
    },
    performanceBounds: paths.performanceBounds,
    project,
    runId: 'source-bounds',
    startedAt: new Date().toISOString(),
    web: {
      applicationClass: 'fixture',
      artifactSha,
      driverClass: 'fixture',
      kind: 'web',
      runs: [{ report: { pass: true }, screenshot, series: webSamples.samples, status: 0 }],
      startups: [{ firstFrameMs: 100, report: { pass: true }, screenshot, status: 0 }],
    },
  });
  assert.deepEqual(evidence.budget, {
    maxDrawCalls: 180,
    maxFrameMsP95: 15,
    maxP99FrameMs: 33,
    maxStartupMs: 5_000,
    maxTriangles: 100_000,
    minMeanFps: 60,
    minFps: 30,
  });
  assert.equal(evaluateProductionEvidence(evidence).status, 'PASS');
  assert.equal(evidence.metrics.drawCalls, 180);
  assert.equal(evidence.metrics.triangles, 100_000);

  const missingCounterResult = evaluateProductionEvidence({
    ...evidence,
    metrics: {
      ...evidence.metrics,
      ...aggregateMetrics(
        [{ series: missingSamples.samples }],
        [{ firstFrameMs: 100, report: { pass: true }, screenshot, status: 0 }],
      ),
    },
  });
  assert.equal(missingCounterResult.status, 'FAIL');
  assert.ok(missingCounterResult.codes.includes('TN_PROD_PERFORMANCE_BUDGET'));

  const p95Failure = evaluateProductionEvidence({
    ...evidence,
    metrics: {
      ...evidence.metrics,
      frameIntervalsMs: [16],
      intervals: [{ drawCalls: 180, frameMs: 16, timestampMs: 0, triangles: 100_000 }],
      meanFps: 62.5,
      p95FrameMs: undefined,
      p99FrameMs: 16,
    },
  });
  assert.equal(p95Failure.status, 'FAIL');
  assert.ok(p95Failure.codes.includes('TN_PROD_PERFORMANCE_BUDGET'));

  const drawCallFailure = evaluateProductionEvidence({
    ...evidence,
    metrics: {
      ...evidence.metrics,
      drawCalls: 181,
      intervals: [{ drawCalls: 181, frameMs: 14, timestampMs: 0, triangles: 100_000 }],
    },
  });
  assert.equal(drawCallFailure.status, 'FAIL');
  assert.ok(drawCallFailure.codes.includes('TN_PROD_PERFORMANCE_BUDGET'));

  const triangleFailure = evaluateProductionEvidence({
    ...evidence,
    metrics: {
      ...evidence.metrics,
      intervals: [{ drawCalls: 180, frameMs: 14, timestampMs: 0, triangles: 100_001 }],
      triangles: 100_001,
    },
  });
  assert.equal(triangleFailure.status, 'FAIL');
  assert.ok(triangleFailure.codes.includes('TN_PROD_PERFORMANCE_BUDGET'));
});

test('post-warmup frame metrics exclude warmup samples from mean and percentiles', () => {
  const samples = [
    { frameIndex: 1, frameMs: 500 },
    { frameIndex: 2, frameMs: 400 },
    { frameIndex: 61, frameMs: 16 },
    { frameIndex: 62, frameMs: 17 },
  ];
  assert.deepEqual(postWarmupFrameSamples(samples, 60), samples.slice(2));
  assert.deepEqual(postWarmupFrameSamples([{ frameMs: 500 }, { frameMs: 400 }, { frameMs: 16 }], 2), [{ frameMs: 16 }]);
  const metrics = aggregateMetrics([{ series: samples }], [], 60);
  const expected = aggregateMetrics([{ series: samples.slice(2) }], [], 0);
  assert.deepEqual(metrics.frameIntervalsMs, expected.frameIntervalsMs);
  assert.equal(metrics.meanFps, expected.meanFps);
  assert.equal(metrics.p99FrameMs, expected.p99FrameMs);
});

test('slow-path control is bounded and returns the intended exit-1 budget failure', async () => {
  const output = makeTempDirSync('tn-prd064-slow-path-');
  temporary.push(output);
  assert.match(nativeFrameInstrumentation('slow-native', 3_600), /tnProductionSlowFramesRemaining = 60/u);
  assert.match(nativeFrameInstrumentation('slow-native', 3_600), /tnProductionSlowFramesRemaining -= 1/u);
  const started = performance.now();
  const result = await runProductionProfile({
    control: 'slow-path',
    duration: 60,
    out: join(output, 'run'),
    repetitions: 1,
    target: 'fixture',
    warmup: 60,
  });
  assert.ok(performance.now() - started < 2_000);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.codes, ['TN_PROD_PERFORMANCE_BUDGET']);
});

test('desktop screenshot evidence uses the host post-present mailbox protocol', () => {
  const profile = readFileSync(new URL('../scripts/profile-production.mjs', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../src/runtime.cpp', import.meta.url), 'utf8');
  assert.doesNotMatch(profile, /runNativeScreenshot/u);
  assert.doesNotMatch(profile, /spawnNative\([^\n]+,\s*true\)/u);
  assert.match(profile, /tn-playtest-screenshot-request\.txt/u);
  assert.match(profile, /writeFile\(temporary, path, 'utf8'\)/u);
  assert.match(profile, /rm\(join\(root, 'tn-playtest-screenshot-request\.txt'\), \{ force: true \}\)/u);
  assert.match(profile, /screenshot: async \(path\)/u);
  assert.doesNotMatch(profile, /tn-production-screenshot-request\.json|nativeHost\?\.playtest\?\.receive|captureScreenshot/u);
  assert.match(runtime, /tn-playtest-screenshot-request\.txt/u);
});

test('native screenshot mapping keeps asynchronous callback state alive after a timeout', () => {
  const context = readFileSync(new URL('../src/webgpu/context.cpp', import.meta.url), 'utf8');
  assert.match(context, /using BufferMapDataPtr = std::shared_ptr<BufferMapData>/u);
  assert.match(context, /new BufferMapDataPtr\(mapData\)/u);
  assert.match(context, /WGPUCallbackMode_AllowSpontaneous/u);
  assert.doesNotMatch(context, /userdata1 = &mapData/u);
});

test('desktop production profiling forwards its 30-second operation timeout to the mailbox transport', () => {
  const profile = readFileSync(new URL('../scripts/profile-production.mjs', import.meta.url), 'utf8');
  assert.match(profile, /new runner\.DeviceMailboxTransport\(mailbox, \{ request: requestPath, response: responsePath \}, timeoutMs\)/u);
  assert.match(profile, /const timeoutMs = 30_000;/u);
  assert.match(profile, /target: 'android',\n {4}timeoutMs,/u);
});

test('playtest assertion failure cannot become a clean production run', () => {
  const frame = new PNG({ height: 2, width: 2 });
  frame.data.fill(255);
  frame.data[0] = 0;
  const evidence = assembleEvidence({
    context: { audioEvidence: {}, physicalEvidence: {}, sourceSha, sourceState: { dirty: false } },
    native: undefined,
    options: {
      coldStarts: 1,
      control: undefined,
      device: undefined,
      renderSize: { height: 1080, width: 1920 },
      repetitions: 1,
      target: 'web',
      warmup: 0,
    },
    project: 'fixture-project',
    runId: 'assertion-failure',
    startedAt: new Date().toISOString(),
    web: {
      applicationClass: 'fixture',
      artifactSha,
      driverClass: 'fixture',
      kind: 'web',
      runs: [{ report: { pass: false }, screenshot: PNG.sync.write(frame), series: [{ frameMs: 16 }], status: 1 }],
      startups: [{ firstFrameMs: 100, report: { pass: true }, screenshot: PNG.sync.write(frame), status: 0 }],
    },
  });
  const result = evaluateProductionEvidence(evidence);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.exitCode, 2);
  assert.ok(result.codes.includes('TN_PROD_PLAYTEST_FAILED'));
  assert.equal(evidence.markers.includes('clean-end'), false);
});

test('redaction rejects secrets before creating an output directory', async () => {
  const output = makeTempDirSync('tn-prd058-redaction-');
  temporary.push(output);
  const target = join(output, 'report');
  await assert.rejects(
    writeProductionEvidence(completeEvidence({ identity: { serial: 'emulator-5554', path: '/home/joao/private', authorization: 'Bearer secret' } }), target),
    (error) => error instanceof ProductionEvidenceError && error.code === 'TN_PROD_REDACTION',
  );
  assert.throws(() => readFileSync(join(target, 'production-evidence.json')), /ENOENT/);
});

test('profile control retains an immutable fixture artifact and returns FAIL', async () => {
  const output = makeTempDirSync('tn-prd058-profile-');
  temporary.push(output);
  const result = await runProductionProfile({ control: 'slow-path', duration: 60, out: join(output, 'run'), repetitions: 1, target: 'fixture', warmup: 1 });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.exitCode, 1);
  assert.ok(result.codes.includes('TN_PROD_PERFORMANCE_BUDGET'));
  assert.ok(result.metrics.p99FrameMs > 33);
  assert.equal(result.control, 'slow-path');
  assert.deepEqual(result.evidenceClasses, ['negative-control']);
  assert.match(readFileSync(result.manifestPath, 'utf8'), /productionEvidenceV1/u);
});

test('slow-startup delays the live fixture launch beyond the five-second budget', async () => {
  const output = makeTempDirSync('tn-prd064-startup-');
  temporary.push(output);
  const result = await runProductionProfile({
    control: 'slow-startup',
    out: join(output, 'run'),
    target: 'fixture',
  });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.exitCode, 1);
  assert.ok(result.codes.includes('TN_PROD_STARTUP_BUDGET'));
  assert.ok(result.metrics.startupP95Ms > 5_000);
  assert.ok(result.markers.includes('clean-end'));
});

test('repository collection sentinel is red only when explicitly enabled', () => {
  if (process.env.TN_PRD058_CONTROL === 'collection-sentinel') {
    assert.fail('production-profile collection sentinel failed as requested');
  }
});
