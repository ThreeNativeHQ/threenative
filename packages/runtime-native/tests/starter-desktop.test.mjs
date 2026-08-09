import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const directory = mkdtempSync(join(tmpdir(), 'starter-desktop-test-'));
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
