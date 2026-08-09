import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

function check(...targets) {
  return spawnSync(process.execPath, ['scripts/build-native-physics.mjs', ...targets, '--check'], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('native physics builder selects the iOS simulator artifact without an Android NDK', () => {
  const result = check('--ios-simulator');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /aarch64-apple-ios-sim\/release\/libthreenative_native_physics\.a/u);
  assert.doesNotMatch(result.stdout, /linux-android|aarch64-apple-ios\/release/u);
});

test('native physics builder selects both Apple release artifacts', () => {
  const result = check('--ios');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /aarch64-apple-ios-sim\/release\/libthreenative_native_physics\.a/u);
  assert.match(result.stdout, /aarch64-apple-ios\/release\/libthreenative_native_physics\.a/u);
  const builder = readFileSync(join(root, 'scripts/build-native-physics.mjs'), 'utf8');
  assert.match(builder, /spawnSync\('rustup', \['target', 'add', target\]/u);
});

test('native physics builder rejects unknown target options', () => {
  const result = check('--not-a-target');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown native physics target option: --not-a-target/u);
});
