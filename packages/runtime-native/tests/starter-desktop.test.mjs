import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { test } from 'vitest';

import {
  analyzeStarterLog,
  inspectStarterScreenshot,
} from '../scripts/verify-starter-desktop.mjs';

test('starter desktop log fails closed without asset and frame markers', () => {
  assert.deepEqual(analyzeStarterLog('TN_NATIVE_SMOKE_READY:webgpu'), [
    'missing TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb',
    'missing TN_NATIVE_SMOKE_300_FRAMES:300',
    'missing exact 300-frame completion',
  ]);
});

test('starter desktop screenshot requires the rendered cyan proof asset', () => {
  const directory = makeTempDirSync('starter-desktop-test-');
  const path = join(directory, 'frame.png');
  const png = new PNG({ height: 16, width: 16 });
  png.data.fill(255);
  writeFileSync(path, PNG.sync.write(png));
  assert.throws(() => inspectStarterScreenshot(path), /TN_NATIVE_STARTER_SCREENSHOT_BLANK/);

  for (let index = 0; index < 128; index += 1) {
    const offset = index * 4;
    png.data[offset] = 20;
    png.data[offset + 1] = 220;
    png.data[offset + 2] = 240;
    png.data[offset + 3] = 255;
  }
  writeFileSync(path, PNG.sync.write(png));
  assert.equal(inspectStarterScreenshot(path).cyanAssetPixels, 128);
});

test('native workflow verifies a freshly scaffolded starter on Linux', () => {
  const workflow = readFileSync('../../.github/workflows/native-platforms.yml', 'utf8');
  assert.match(workflow, /starter-linux:[\s\S]*--template starter[\s\S]*test:native/);
  assert.match(workflow, /native-starter-linux/);
});

test('native workflow retains starter evidence when verification fails', () => {
  const workflow = readFileSync('../../.github/workflows/native-platforms.yml', 'utf8');
  const starter = workflow.match(/ {2}starter-linux:\n([\s\S]*?)\n {2}ios-simulator:/u)?.[1];
  assert.ok(starter);
  assert.match(starter, /- name: Collect starter evidence\n {8}if: always\(\)/u);
  assert.match(starter, /threenative-starter-native\/artifacts\/native/u);
});

test('starter verifier executes through a pnpm-style symlink', () => {
  const directory = makeTempDirSync('starter-desktop-cli-');
  const entrypoint = join(directory, 'verify-starter-desktop.mjs');
  symlinkSync(
    fileURLToPath(new URL('../scripts/verify-starter-desktop.mjs', import.meta.url)),
    entrypoint,
  );
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'starter' }));
  const result = spawnSync(process.execPath, [entrypoint], { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TN_NATIVE_STARTER_ARTIFACT_MISSING/u);
});
