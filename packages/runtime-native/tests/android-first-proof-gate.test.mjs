import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  SUCCESS_MARKER,
  analyzeAppLog,
  filterAppLog,
  javaMajorFromRelease,
  parseAdbDevices,
  parseArgs,
  selectDevice,
} from '../scripts/verify-android-first-proof.mjs';

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

test('clean log requires the exact first-proof marker', () => {
  const log = `08-08 12:00:00.000 123 124 I Mystral: renderer initialized
08-08 12:00:00.100 123 124 I Mystral: ${SUCCESS_MARKER}
`;
  assert.deepEqual(analyzeAppLog(log), { markerFound: true, failures: [] });
  assert.equal(analyzeAppLog('first proof cube ready').markerFound, false);
});

test('fatal signals, RangeError, and WebGPU failures reject an otherwise ready log', () => {
  const cases = [
    ['fatal-signal', 'F libc: Fatal signal 11 (SIGSEGV), code 1'],
    ['range-error', 'E Mystral: RangeError: Maximum call stack size exceeded'],
    ['webgpu-error', 'E wgpu: Device validation error: invalid command buffer'],
    ['shader-error', 'E wgpu: Device::create_shader_module error: Shader parsing error'],
    ['first-proof-failure', '[ThreeNative Android] first proof failed: Error: adapter unavailable'],
  ];

  for (const [expectedKind, line] of cases) {
    const result = analyzeAppLog(`${SUCCESS_MARKER}\n${line}\n`);
    assert.equal(result.markerFound, true);
    assert.ok(result.failures.some(({ kind }) => kind === expectedKind), `${expectedKind} was not classified: ${line}`);
  }
});

test('log filtering keeps the target pid and drops unrelated RangeErrors', () => {
  const log = `08-08 12:00:00.000 999 999 E Other: RangeError: unrelated app
08-08 12:00:00.100 123 124 I Mystral: ${SUCCESS_MARKER}
08-08 12:00:00.200 123 124 E wgpu: validation error
`;
  const filtered = filterAppLog(log, '123');
  assert.doesNotMatch(filtered, /unrelated app/);
  assert.match(filtered, new RegExp(SUCCESS_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(filtered, /wgpu: validation error/);
});

test('JDK release parser reports Java 17 from the current fixture path when present', () => {
  const knownJdk = '/usr/lib/jvm/java-17-openjdk';
  const major = javaMajorFromRelease(knownJdk);
  if (major !== null) assert.equal(major, 17);
  assert.equal(javaMajorFromRelease('/path/that/does/not/exist'), null);
});
