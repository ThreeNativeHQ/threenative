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

// A drawn frame carries thousands of distinct colours. Shade the non-proof half so the fixture is
// a rendered frame rather than a flat fill, which is the thing the floor below distinguishes.
function starterFrame({ cyanPixels }) {
  const png = new PNG({ height: 16, width: 16 });
  for (let index = 0; index < 256; index += 1) {
    const offset = index * 4;
    if (index < cyanPixels) {
      png.data[offset] = 20;
      png.data[offset + 1] = 220;
      png.data[offset + 2] = 240;
    } else {
      // Vary all three channels but keep blue under the cyan threshold, so the shading is scenery
      // and never counts itself as the proof asset.
      png.data[offset] = index;
      png.data[offset + 1] = (index * 3) % 256;
      png.data[offset + 2] = index % 120;
    }
    png.data[offset + 3] = 255;
  }
  return png;
}

test('a capture taken before the startup gate opened is not evidence', () => {
  // The bimodal starter red: 300 llvmpipe frames finished in 3.0s against a 10s readiness window
  // and captured five distinct colours, while a slower run of the same build took 16.8s, crossed
  // it, and captured 17,163. The host now holds the capture until the gate opens and reports which
  // happened; a 0 must fail the lane rather than reach the pixel checks.
  const base = [
    'TN_NATIVE_SMOKE_READY:webgpu',
    'TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb',
    'TN_NATIVE_SMOKE_300_FRAMES:300',
    'Rendered 300 frames in 3001ms',
  ].join('\n');
  assert.deepEqual(analyzeStarterLog(`${base}\nTN_STARTUP_CAPTURE_READY:1`), []);
  assert.deepEqual(analyzeStarterLog(`${base}\nTN_STARTUP_CAPTURE_READY:0`), [
    'startup gate never opened before capture (TN_STARTUP_CAPTURE_READY:0)',
  ]);
});

test('the unrendered-frame floor does not judge small synthetic fixtures', () => {
  // distribution.test.mjs feeds inspectStarterScreenshot a 16x16 frame of two colours to prove the
  // installed verifier resolves packaged display support. That frame is exactly what it claims to
  // be, and a diversity floor written for a 1280x720 capture must not reject it.
  const directory = makeTempDirSync('starter-fixture-test-');
  const path = join(directory, 'frame.png');
  const png = new PNG({ height: 16, width: 16 });
  for (let index = 0; index < 256; index += 1) {
    const offset = index * 4;
    png.data[offset] = 20;
    png.data[offset + 1] = 220;
    png.data[offset + 2] = 240;
    png.data[offset + 3] = 255;
  }
  png.data[0] = 21;
  writeFileSync(path, PNG.sync.write(png));
  assert.equal(inspectStarterScreenshot(path).cyanAssetPixels, 256);
});

test('starter desktop screenshot requires the rendered cyan proof asset', () => {
  const directory = makeTempDirSync('starter-desktop-test-');
  const path = join(directory, 'frame.png');
  const blank = new PNG({ height: 16, width: 16 });
  blank.data.fill(255);
  writeFileSync(path, PNG.sync.write(blank));
  assert.throws(() => inspectStarterScreenshot(path), /TN_NATIVE_STARTER_SCREENSHOT_BLANK/);

  writeFileSync(path, PNG.sync.write(starterFrame({ cyanPixels: 128 })));
  assert.equal(inspectStarterScreenshot(path).cyanAssetPixels, 128);
});

test('a frame that was never drawn is named as the capture, not a missing asset', () => {
  // The Linux starter lane failed intermittently with TN_NATIVE_STARTER_ASSET_NOT_VISIBLE while its
  // own log carried TN_NATIVE_STARTER_ASSETS_LOADED and "Rendered 300 frames". The capture held
  // five distinct colours against ~17,000 in the passing run: nothing had been drawn, so the asset
  // message pointed the reader at a texture that had loaded correctly.
  const directory = makeTempDirSync('starter-unrendered-test-');
  const path = join(directory, 'frame.png');
  // Capture-sized on purpose: the floor is deliberately not applied to small fixtures, because a
  // 16x16 synthetic frame is legitimately a handful of colours.
  const png = new PNG({ height: 128, width: 128 });
  for (let index = 0; index < 128 * 128; index += 1) {
    const offset = index * 4;
    const flat = index % 5;
    png.data[offset] = flat;
    png.data[offset + 1] = flat * 3;
    png.data[offset + 2] = flat * 6;
    png.data[offset + 3] = 255;
  }
  writeFileSync(path, PNG.sync.write(png));
  assert.throws(() => inspectStarterScreenshot(path), /TN_NATIVE_STARTER_FRAME_NOT_RENDERED/);

  // A drawn frame that genuinely lacks the proof asset still reports the asset.
  writeFileSync(path, PNG.sync.write(starterFrame({ cyanPixels: 0 })));
  assert.throws(() => inspectStarterScreenshot(path), /TN_NATIVE_STARTER_ASSET_NOT_VISIBLE/);
});

test('the native lane reports on pull requests, not only after a merge', () => {
  // It ran on push to main only, so the first report of a native break arrived after it had landed.
  // Reporting is not gating: this lane is deliberately not a required check while it is red.
  const workflow = readFileSync('../../.github/workflows/native-platforms.yml', 'utf8');
  const triggers = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('concurrency:'));
  assert.match(triggers, /pull_request:\s*\n\s*branches: \[main\]/u);
  assert.match(triggers, /push:\s*\n\s*branches: \[main\]/u);
});

test('native workflow verifies a freshly scaffolded starter on Linux', () => {
  const workflow = readFileSync('../../.github/workflows/native-platforms.yml', 'utf8');
  assert.match(
    workflow,
    /starter-linux:[\s\S]*uses: \.\/\.github\/actions\/scaffold-from-tarballs[\s\S]*template: starter[\s\S]*test:native/,
  );
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
