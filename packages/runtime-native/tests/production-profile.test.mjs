import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';
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
  assembleEvidence,
  isSuccessfulStartupSample,
  nativeFrameInstrumentation,
  parseProductionArgs,
  profileConfigPath,
  postWarmupFrameSamples,
  runProductionProfile,
  setNativeProfileEntry,
  webFrameInstrumentation,
  writeRunScenarios,
} from '../scripts/profile-production.mjs';

const temporary = [];
const sourceSha = 'a'.repeat(64);
const artifactSha = sha256(Buffer.from('fixture-artifact'));

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
});

test('complete current evidence is the only PASS state', () => {
  const result = evaluateProductionEvidence(completeEvidence());
  assert.equal(result.status, 'PASS');
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.codes, []);
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
    '--warmup', '3',
    '--repetitions', '4',
  ]);
  assert.deepEqual(parsed.renderSize, { height: 1080, width: 1920 });
  assert.equal(parsed.coldStarts, 2);
  assert.equal(parsed.device, 'emulator-5554');
  assert.equal(parsed.warmup, 3);
  assert.equal(parsed.repetitions, 4);
  assert.equal(parseProductionArgs(['--target', 'desktop-web']).target, 'web');
  assert.throws(
    () => parseProductionArgs(['--target', 'web', '--device', 'emulator-5554']),
    (error) => error instanceof ProductionEvidenceError && error.code === 'TN_PROD_DEVICE_UNSUPPORTED',
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

test('generated production workload runs through the playtest validator and keeps source bounds out of band', async () => {
  const project = makeTempDirSync('tn-prd064-scenario-');
  temporary.push(project);
  mkdirSync(join(project, 'playtests'));
  const assertion = { performance: { maxDrawCalls: 180, maxFrameMsP95: 15, maxTriangles: 100_000 } };
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
  assert.deepEqual(nativeWorkload.assert, workload.assert);
  assert.equal(workload.assert.performance, undefined);
  assert.deepEqual(paths.performanceBounds, assertion.performance);
  assert.equal(nativeWorkload.artifacts.screenshots, 'after');

  const playtest = await import(new URL('../../playtest/dist/index.js', import.meta.url).href);
  const runner = await import(new URL('../../playtest/dist/runner/index.js', import.meta.url).href);
  const scenario = await playtest.loadPlaytestScenario(project, paths.workloadPath);
  const report = runner.buildReport({
    config: {
      artifactDirectory: project,
      headless: true,
      projectPath: project,
      scenarioPath: paths.workloadPath,
      timeoutMs: 1_000,
      trace: false,
      url: 'http://127.0.0.1:41777',
    },
    consoleEntries: [],
    networkEntries: [],
    scenario,
  });
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
  assert.deepEqual(nativeSamples.samples[0], { drawCalls: 180, frameIndex: 1, frameMs: 14, triangles: 100_000 });
  assert.deepEqual(webSamples.samples[0], { drawCalls: 180, frameIndex: 1, frameMs: 14, triangles: 100_000 });
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

test('desktop screenshot evidence is associated with the timed native process', () => {
  const profile = readFileSync(new URL('../scripts/profile-production.mjs', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../src/runtime.cpp', import.meta.url), 'utf8');
  assert.doesNotMatch(profile, /runNativeScreenshot/u);
  assert.doesNotMatch(profile, /spawnNative\([^\n]+,\s*true\)/u);
  assert.match(profile, /screenshotRequestPath/u);
  assert.match(profile, /screenshot: async \(path\)/u);
  assert.match(runtime, /captureScreenshot/u);
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
