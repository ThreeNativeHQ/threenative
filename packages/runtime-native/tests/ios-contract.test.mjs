import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

import { assertIosRuntime, selectIosSimulator } from '../scripts/select-ios-simulator.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * Shape of `xcrun simctl list devices available --json` on a GitHub `macos-15` runner. The
 * visionOS key sorts before the iOS key, which is how runs 31313092745 and 31434881982 both
 * captured a 2732x2048 "Apple Vision Pro" screenshot and reported no runtime at all.
 */
const RUNNER_LISTING = {
  devices: {
    'com.apple.CoreSimulator.SimRuntime.xrOS-2-5': [
      { isAvailable: true, name: 'Apple Vision Pro', state: 'Shutdown', udid: 'vision-udid' },
    ],
    'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [
      { isAvailable: true, name: 'iPad Pro 13-inch (M4)', state: 'Shutdown', udid: 'ipad-udid' },
      { isAvailable: true, name: 'iPhone 16 Pro', state: 'Shutdown', udid: 'iphone-udid' },
    ],
    'com.apple.CoreSimulator.SimRuntime.watchOS-11-5': [
      { isAvailable: true, name: 'Apple Watch Series 10', state: 'Shutdown', udid: 'watch-udid' },
    ],
  },
};

test('iOS simulator selection never substitutes a visionOS, watchOS, or tvOS device', () => {
  const selected = selectIosSimulator(RUNNER_LISTING);
  assert.equal(selected.udid, 'iphone-udid');
  assert.equal(selected.name, 'iPhone 16 Pro');
  assert.match(selected.runtime, /SimRuntime\.iOS-18-5$/u);

  // The pre-fix selector was `Object.values(devices).flat()[0]`; assert that shape is gone.
  const flattened = Object.values(RUNNER_LISTING.devices).flat()[0];
  assert.equal(flattened.name, 'Apple Vision Pro');
  assert.notEqual(selected.udid, flattened.udid);
});

test('iOS simulator selection prefers an already-booted iOS device', () => {
  const booted = {
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [
        { isAvailable: true, name: 'iPhone 16 Pro', state: 'Shutdown', udid: 'iphone-udid' },
        { isAvailable: true, name: 'iPad Pro 13-inch (M4)', state: 'Booted', udid: 'ipad-udid' },
      ],
    },
  };
  assert.equal(selectIosSimulator(booted).udid, 'ipad-udid');
});

test('iOS simulator selection fails closed when the host has no iOS runtime', () => {
  const visionOnly = { devices: { ...RUNNER_LISTING.devices } };
  delete visionOnly.devices['com.apple.CoreSimulator.SimRuntime.iOS-18-5'];
  assert.throws(() => selectIosSimulator(visionOnly), /TN_IOS_SIMULATOR_ABSENT/u);
  assert.throws(() => selectIosSimulator({}), /TN_IOS_SIMULATOR_ABSENT/u);
});

test('a non-iOS runtime cannot be recorded as iOS evidence', () => {
  assert.equal(
    assertIosRuntime('com.apple.CoreSimulator.SimRuntime.iOS-18-5'),
    'com.apple.CoreSimulator.SimRuntime.iOS-18-5',
  );
  assert.throws(
    () => assertIosRuntime('com.apple.CoreSimulator.SimRuntime.xrOS-2-5'),
    /TN_IOS_SIMULATOR_WRONG_RUNTIME/u,
  );
});

test('the verifier selects through the pinned iOS selector, not a flattened device list', () => {
  const verifier = readFileSync(join(root, 'scripts/verify-ios-simulator.mjs'), 'utf8');
  assert.match(verifier, /selectIosSimulator\(parsed\)/u);
  assert.match(verifier, /assertIosRuntime\(selected\.runtime\)/u);
  assert.doesNotMatch(verifier, /Object\.values\(parsed\.devices/u);
});

test('iOS scaffold is root-linked to the exact shared core proof', () => {
  const cmake = readFileSync(join(root, 'CMakeLists.txt'), 'utf8');
  const main = readFileSync(join(root, 'ios/main.mm'), 'utf8');
  assert.match(cmake, /add_executable\(threenative-ios MACOSX_BUNDLE/u);
  assert.match(cmake, /examples\/native-smoke\/dist\/native-smoke\.js/u);
  assert.match(main, /TN_PLAYTEST_MAILBOX/u);
  assert.doesNotMatch(main, /WebView|WKWebView|React Native/u);
  const verifier = readFileSync(join(root, 'scripts/verify-ios-simulator.mjs'), 'utf8');
  for (const scenario of [
    'device-smoke.playtest.json',
    'device-smoke-wrong-value.playtest.json',
    'device-smoke-misspelled.playtest.json',
    'device-smoke-network.playtest.json',
  ]) assert.match(verifier, new RegExp(scenario.replaceAll('.', '\\.')));
  for (const diagnostic of [
    'TN_PLAYTEST_VISIBILITY_FAILED',
    'TN_PLAYTEST_BRIDGE_MISSING',
    'TN_PLAYTEST_SCENARIO_INVALID',
    'TN_PLAYTEST_UNSUPPORTED_ON_TARGET',
  ]) assert.match(verifier, new RegExp(diagnostic));
  assert.match(verifier, /simctl', 'launch', '--terminate-running-process'/u);
  assert.doesNotMatch(verifier, /simctl', 'terminate'/u);
  assert.match(verifier, /toISOString\(\)\.slice\(0, 19\)\.replace\('T', ' '\)/u);
  const jsc = readFileSync(join(root, 'src/js/jsc_engine.mm'), 'utf8');
  assert.match(jsc, /NSLog\(@"%s", output\.c_str\(\)\)/u);
});

test('Linux can validate the iOS lane without claiming simulator execution', () => {
  const result = spawnSync(process.execPath, ['scripts/verify-ios-simulator.mjs', '--check'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.checked, true);
  assert.equal(report.execution, false);
  assert.equal(report.threeVersion, '0.185.1');
});

test('iOS executable verifier builds and exercises native physics fail closed', () => {
  const verifier = readFileSync(join(root, 'scripts/verify-ios-simulator.mjs'), 'utf8');
  assert.match(verifier, /download-deps\.mjs', '--only', 'stb'/u);
  assert.match(verifier, /download-deps\.mjs', '--only', 'cgltf'/u);
  assert.match(verifier, /build-native-physics\.mjs', '--ios-simulator'/u);
  assert.match(verifier, /TN_ENABLE_NATIVE_PHYSICS=ON/u);
  for (const scenario of [
    'physics.playtest.json',
    'physics-wrong-height.playtest.json',
    'physics-mask.playtest.json',
  ]) {
    assert.match(verifier, new RegExp(scenario.replaceAll('.', '\\.')));
  }
  assert.match(verifier, /rebuildProof\('masked', true\)/u);
  assert.match(verifier, /rebuildProof\('wrong-gravity', true\)/u);
  assert.match(verifier, /TN_PLAYTEST_POSITION_REACH_ASSERTION_FAILED/u);
  assert.match(verifier, /TN_PLAYTEST_MOVEMENT_ASSERTION_FAILED/u);
});
