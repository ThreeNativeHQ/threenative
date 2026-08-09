import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

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
