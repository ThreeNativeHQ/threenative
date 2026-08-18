import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'vitest';
import { PNG } from 'pngjs';

import {
  EXPECTED_THREE_VERSION,
  assertNativeSmokeSource,
  catalogThreeVersion,
} from '../scripts/build-android-first-proof.mjs';

import {
  FIRST_FRAME_MARKER,
  FRAME_MARKER,
  READY_MARKER,
  REQUIRED_MARKERS,
  SUCCESS_MARKER,
  THREE_VERSION_MARKER,
  analyzeAppLog,
  assertEngine,
  assertPackagedAndroidBundle,
  engineFromLog,
  filterAppLog,
  inspectScreenshot,
  javaMajorFromRelease,
  parseAdbDevices,
  parseArgs,
  selectDevice,
} from '../scripts/verify-android-first-proof.mjs';

test('screenshot inspection rejects blank PNGs and accepts visible output', () => {
  const image = new PNG({ height: 1, width: 2 });
  image.data.set([0, 0, 0, 255, 68, 136, 255, 255]);
  assert.deepEqual(inspectScreenshot(PNG.sync.write(image)), { height: 1, width: 2 });
  image.data.set([0, 0, 0, 255, 0, 0, 0, 255]);
  assert.throws(() => inspectScreenshot(PNG.sync.write(image)), /screenshot is blank/);
});

test('asset builder fails closed on catalog drift and non-core smoke input', () => {
  assert.equal(catalogThreeVersion(`catalog:\n  three: ${EXPECTED_THREE_VERSION}\n`), '0.185.1');
  assert.throws(() => catalogThreeVersion('catalog:\n  vite: 8.2.0\n'), /no catalog Three/);
  assert.doesNotThrow(() =>
    assertNativeSmokeSource(
      `import { Scene, defineGame } from "@threenative/core";\n${FRAME_MARKER}\n`,
    ),
  );
  assert.throws(
    () => assertNativeSmokeSource(`const Scene = true; const defineGame = true; ${FRAME_MARKER}`),
    /public @threenative\/core/,
  );
});

test('packaged Android asset must match the generated bundle metadata', () => {
  const bundle = Buffer.from('current bundle');
  const outputSha256 = createHash('sha256').update(bundle).digest('hex');
  assert.doesNotThrow(() => assertPackagedAndroidBundle(bundle, { outputSha256 }));
  assert.throws(
    () => assertPackagedAndroidBundle(Buffer.from('stale bundle'), { outputSha256 }),
    /APK asset does not match/u,
  );
});

test('argument parser resolves paths and validates timing values', () => {
  const options = parseArgs([
    '--device', 'emulator-5554',
    '--timeout-ms', '12000',
    '--settle-ms', '2500',
    '--screenshot', 'artifacts/android/cube.png',
    '--skip-build',
  ]);

  assert.equal(options.device, 'emulator-5554');
  assert.equal(options.timeoutMs, 12000);
  assert.equal(options.settleMs, 2500);
  assert.equal(options.skipBuild, true);
  assert.match(options.screenshotPath, /artifacts\/android\/cube\.png$/);
  assert.ok(options.screenshotPath);
  assert.throws(() => parseArgs(['--timeout-ms', '999']), /at least 1000/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown option/);
});

test('adb device parsing selects one online target and explains ambiguous states', () => {
  const devices = parseAdbDevices(`List of devices attached
emulator-5554 device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64
R5CT offline transport_id:2
AUTH unauthorized transport_id:3
`);

  assert.deepEqual(devices, [
    { serial: 'emulator-5554', state: 'device' },
    { serial: 'R5CT', state: 'offline' },
    { serial: 'AUTH', state: 'unauthorized' },
  ]);
  assert.equal(selectDevice(devices), 'emulator-5554');
  assert.throws(() => selectDevice(devices, 'AUTH'), /unauthorized/);
  assert.throws(
    () => selectDevice([...devices, { serial: 'phone-2', state: 'device' }]),
    /Multiple Android devices.*--device SERIAL/,
  );
});

test('clean log requires ordered catalog, ready, first-frame, and 300-frame markers', () => {
  const log = `08-08 12:00:00.000 123 124 I Mystral: renderer initialized
08-08 12:00:00.100 123 124 I Mystral: ${THREE_VERSION_MARKER}
08-08 12:00:00.200 123 124 I Mystral: ${READY_MARKER}
08-08 12:00:00.300 123 124 I Mystral: ${FIRST_FRAME_MARKER}
08-08 12:00:01.000 123 124 I MystralRuntime: TN_PRESENTS_TICK:{"frames":60,"presents":60}
08-08 12:00:05.300 123 124 I Mystral: ${FRAME_MARKER}
`;
  assert.deepEqual(analyzeAppLog(log), { markerFound: true, missingMarkers: [], failures: [] });
  assert.deepEqual(analyzeAppLog(SUCCESS_MARKER).missingMarkers, REQUIRED_MARKERS.slice(0, 3));
  assert.equal(analyzeAppLog([...REQUIRED_MARKERS].reverse().join('\n')).failures[0]?.kind, 'marker-order');
});

test('the device lane rejects a log whose presents outrun its frames, and one with no tick', () => {
  const base = REQUIRED_MARKERS.join('\n');
  // The defect: the world pass and the overlay pass each acquiring and presenting an image of
  // their own, so only one of the two reached the display.
  const doubled = analyzeAppLog(`${base}\nTN_PRESENTS_TICK:{"frames":60,"presents":120}`);
  assert.equal(doubled.failures[0]?.kind, 'present-invariant');
  assert.match(doubled.failures[0].excerpt, /presented 120 times in 60 frames/u);
  // A device log carrying no tick at all is a failure, not a pass. Before this the device lane
  // asserted nothing about presents and reported green through the entire defect.
  const silent = analyzeAppLog(base, { requireTicks: true });
  assert.equal(silent.failures[0]?.kind, 'present-invariant');
  assert.match(silent.failures[0].excerpt, /expected at least 1 TN_PRESENTS_TICK/u);
  // While the gate is still waiting for markers the app may not have reached frame 60 yet, so a
  // log with no tick is not yet evidence of anything. Failing there rejects every healthy run.
  assert.deepEqual(analyzeAppLog(base).failures, []);
});

test('fatal signals, RangeError, and WebGPU failures reject an otherwise ready log', () => {
  const cases = [
    ['fatal-signal', 'F libc: Fatal signal 11 (SIGSEGV), code 1'],
    ['range-error', 'E Mystral: RangeError: Maximum call stack size exceeded'],
    ['javascript-error', 'E Mystral: Uncaught TypeError: canvas is undefined'],
    ['native-smoke-failure', 'E Mystral: TN_NATIVE_SMOKE_FAILED:adapter unavailable'],
    ['webgpu-error', 'E wgpu: Device validation error: invalid command buffer'],
    ['shader-error', 'E wgpu: Device::create_shader_module error: Shader parsing error'],
    ['first-proof-failure', '[ThreeNative Android] first proof failed: Error: adapter unavailable'],
  ];

  for (const [expectedKind, line] of cases) {
    const result = analyzeAppLog(`${REQUIRED_MARKERS.join('\n')}\n${line}\n`);
    assert.equal(result.markerFound, true);
    assert.ok(result.failures.some(({ kind }) => kind === expectedKind), `${expectedKind} was not classified: ${line}`);
  }
});

test('log filtering keeps the target pid and drops unrelated RangeErrors', () => {
  const log = `08-08 12:00:00.000 999 999 E Other: RangeError: unrelated app
08-08 12:00:00.100 123 124 I Mystral: ${READY_MARKER}
08-08 12:00:00.200 123 124 E wgpu: validation error
`;
  const filtered = filterAppLog(log, '123');
  assert.doesNotMatch(filtered, /unrelated app/);
  assert.match(filtered, new RegExp(READY_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(filtered, /wgpu: validation error/);
});

test('JDK release parser reports Java 17 from the current fixture path when present', () => {
  const knownJdk = '/usr/lib/jvm/java-17-openjdk';
  const major = javaMajorFromRelease(knownJdk);
  if (major !== null) assert.equal(major, 17);
  assert.equal(javaMajorFromRelease('/path/that/does/not/exist'), null);
});


const V8_LOG = 'I MystralRuntime: Loading asset: v8/arm64-v8a/snapshot_blob.bin\nI MystralRuntime: JS engine created: V8\n';
const QUICKJS_LOG = 'I MystralRuntime: JS engine created: QuickJS\n';

test('the engine comes from what the process reported, not from what was asked for', () => {
  assert.equal(engineFromLog(V8_LOG), 'V8');
  assert.equal(engineFromLog(QUICKJS_LOG), 'QuickJS');
  assert.equal(engineFromLog('I MystralRuntime: Script path: asset://scripts/main.js\n'), null);

  assert.deepEqual(assertEngine(V8_LOG, 'v8'), { engine: 'V8', expected: 'v8', matched: true });
  assert.deepEqual(assertEngine(QUICKJS_LOG, 'quickjs'), {
    engine: 'QuickJS', expected: 'quickjs', matched: true,
  });
});

test('a QuickJS build fails a run that asked for V8', () => {
  // The control the whole assertion exists for. PRD-118 section 2 records -DMYSTRAL_USE_V8=ON being
  // accepted, silently ignored and reported back as V8=OFF, so every measurement in between
  // described QuickJS. A parity gate whose two sides can be the same build measures nothing.
  assert.throws(() => assertEngine(QUICKJS_LOG, 'v8'), /asked for v8, the running process reported QuickJS/u);
  assert.throws(() => assertEngine(V8_LOG, 'quickjs'), /asked for quickjs, the running process reported V8/u);
});

test('a process that never reported an engine is distinct from one that reported the wrong one', () => {
  // Different causes: a crash before engine creation, against a build that shipped the wrong engine.
  assert.throws(() => assertEngine('I MystralRuntime: Script path: x\n', 'v8'), /never reported one/u);
});

test('asking for nothing still reads the engine, so every report can name it', () => {
  assert.deepEqual(assertEngine(V8_LOG, null), { engine: 'V8', expected: null, matched: true });
});

test('--expect-engine only accepts the two engines that exist', () => {
  assert.equal(parseArgs(['--expect-engine', 'V8']).expectEngine, 'v8');
  assert.equal(parseArgs(['--expect-engine', 'quickjs']).expectEngine, 'quickjs');
  assert.equal(parseArgs([]).expectEngine, null);
  assert.throws(() => parseArgs(['--expect-engine', 'jsc']), /must be v8 or quickjs/u);
});
