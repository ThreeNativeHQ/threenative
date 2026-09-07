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

const PROOF_ASSET = new URL('../../create-threenative/templates/starter/assets/native-proof.png', import.meta.url);
// Real pixels from the scaffolded starter capture of Actions run 34076016432, not a synthetic
// stand-in. The first frame shows the proof pennant over the ocean world; the second is the same
// ocean with the pennant cropped away, so the pair pins both directions of the gate.
const REAL_CAPTURE = fileURLToPath(
  new URL('./fixtures/starter-desktop-real-capture.png', import.meta.url),
);
const OCEAN_WITHOUT_PENNANT = fileURLToPath(
  new URL('./fixtures/starter-desktop-ocean-only.png', import.meta.url),
);

test('accepts the real CI capture in which the proof pennant is visible', () => {
  // Matching the authored texture colour rejected this frame: the ocean sits 149 from the authored
  // cyan and the lit pennant only 103, so a threshold wide enough for the asset swallowed the sea
  // and the whole frame read as a wash.
  const result = inspectStarterScreenshot(REAL_CAPTURE);
  assert.equal(result.magentaAssetPixels, 521);
  assert.equal(result.cyanAssetPixels, 321);
});

test('rejects the same ocean with the proof pennant cropped away', () => {
  assert.throws(
    () => inspectStarterScreenshot(OCEAN_WITHOUT_PENNANT),
    /TN_NATIVE_STARTER_ASSET_NOT_VISIBLE/u,
  );
});

test('starter desktop log fails closed without asset and frame markers', () => {
  assert.deepEqual(analyzeStarterLog('TN_NATIVE_SMOKE_READY:webgpu'), [
    'missing TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb',
    'missing TN_NATIVE_SMOKE_300_FRAMES:300',
    'missing exact 300-frame completion',
  ]);
});

// A drawn frame carries thousands of distinct colours. Shade the non-proof half so the fixture is
// a rendered frame rather than a flat fill, which is the thing the floor below distinguishes.
function cyanObjectFrame({ cyanPixels }) {
  const png = new PNG({ height: 16, width: 16 });
  for (let index = 0; index < 256; index += 1) {
    const offset = index * 4;
    if (index < cyanPixels) {
      png.data[offset] = 20;
      png.data[offset + 1] = 220;
      png.data[offset + 2] = 240;
    } else {
      // Vary all three channels but keep the shading away from both packaged proof colours.
      png.data[offset] = index;
      png.data[offset + 1] = (index * 3) % 256;
      png.data[offset + 2] = index % 120;
    }
    png.data[offset + 3] = 255;
  }
  return png;
}

function checkerboardCapture() {
  const png = new PNG({ height: 128, width: 128 });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = (y * png.width + x) * 4;
      const index = y * png.width + x;
      // Red stays below green so this stand-in background cannot manufacture magenta. The old
      // `index % 80` reached 79 while green dipped to 20, so 680 scattered pixels of pure modulo
      // arithmetic satisfied the magenta test — an artifact of the fixture, not of any renderer.
      // The spread still carries 120 distinct colours, well past UNRENDERED_FRAME_COLOR_FLOOR.
      png.data[offset] = index % 20;
      png.data[offset + 1] = 20 + (index % 30);
      png.data[offset + 2] = 50 + (index % 40);
      png.data[offset + 3] = 255;
    }
  }
  return png;
}

function paintProof(png, proof, x = 56, y = 56, scale = 1, opacity = 1) {
  for (let proofY = 0; proofY < proof.height; proofY += 1) {
    for (let proofX = 0; proofX < proof.width; proofX += 1) {
      const source = (proofY * proof.width + proofX) * 4;
      for (let offsetY = 0; offsetY < scale; offsetY += 1) {
        for (let offsetX = 0; offsetX < scale; offsetX += 1) {
          const target =
            ((y + proofY * scale + offsetY) * png.width + x + proofX * scale + offsetX) * 4;
          for (let channel = 0; channel < 3; channel += 1) {
            png.data[target + channel] = Math.round(proof.data[source + channel] * opacity + 30 * (1 - opacity));
          }
          png.data[target + 3] = proof.data[source + 3];
        }
      }
    }
  }
}

function paintPennant(png, proof, x = 32, y = 32, scale = 4, opacity = 1) {
  const width = proof.width * scale;
  const height = proof.height * scale;
  for (let localY = 0; localY < height; localY += 1) {
    const v = (localY + 0.5) / height;
    const left = v / 2;
    const right = 1 - v / 2;
    for (let localX = 0; localX < width; localX += 1) {
      const horizontal = (localX + 0.5) / width;
      if (horizontal < left || horizontal >= right) continue;
      const u = (horizontal - left) / (right - left);
      const proofX = Math.min(proof.width - 1, Math.floor(u * proof.width));
      const proofY = Math.min(proof.height - 1, Math.floor(v * proof.height));
      const source = (proofY * proof.width + proofX) * 4;
      const target = ((y + localY) * png.width + x + localX) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        png.data[target + channel] = Math.round(proof.data[source + channel] * opacity + 30 * (1 - opacity));
      }
      png.data[target + 3] = proof.data[source + 3];
    }
  }
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
  const png = PNG.sync.read(readFileSync(PROOF_ASSET));
  writeFileSync(path, PNG.sync.write(png));
  assert.equal(inspectStarterScreenshot(path).cyanAssetPixels, 128);
});

test('starter desktop screenshot requires the checkerboard proof asset', () => {
  const directory = makeTempDirSync('starter-desktop-test-');
  const path = join(directory, 'frame.png');
  const blank = new PNG({ height: 16, width: 16 });
  blank.data.fill(255);
  writeFileSync(path, PNG.sync.write(blank));
  assert.throws(() => inspectStarterScreenshot(path), /TN_NATIVE_STARTER_SCREENSHOT_BLANK/);

  writeFileSync(path, PNG.sync.write(cyanObjectFrame({ cyanPixels: 128 })));
  assert.throws(() => inspectStarterScreenshot(path), /TN_NATIVE_STARTER_ASSET_NOT_VISIBLE/);
});

test('the packaged checkerboard proof remains accepted in a capture-sized frame', () => {
  const directory = makeTempDirSync('starter-checkerboard-test-');
  const path = join(directory, 'frame.png');
  const proof = PNG.sync.read(readFileSync(PROOF_ASSET));
  const png = checkerboardCapture();
  paintProof(png, proof);
  writeFileSync(path, PNG.sync.write(png));
  assert.equal(inspectStarterScreenshot(path).cyanAssetPixels, 128);
});

test('a scaled and softly antialiased checkerboard remains accepted', () => {
  const directory = makeTempDirSync('starter-scaled-checkerboard-test-');
  const path = join(directory, 'frame.png');
  const proof = PNG.sync.read(readFileSync(PROOF_ASSET));
  const png = checkerboardCapture();
  paintProof(png, proof, 32, 32, 4, 0.8);
  writeFileSync(path, PNG.sync.write(png));
  assert.ok(inspectStarterScreenshot(path).cyanAssetPixels >= 100);
});

test('the packaged checkerboard remains visible on its authored pennant shape', () => {
  const directory = makeTempDirSync('starter-pennant-checkerboard-test-');
  const path = join(directory, 'frame.png');
  const proof = PNG.sync.read(readFileSync(PROOF_ASSET));
  const png = checkerboardCapture();
  paintPennant(png, proof, 32, 32, 4, 0.8);
  writeFileSync(path, PNG.sync.write(png));
  assert.ok(inspectStarterScreenshot(path).cyanAssetPixels >= 100);
});

test('a localized cyan object without the checkerboard proof is rejected', () => {
  const directory = makeTempDirSync('starter-cyan-object-test-');
  const path = join(directory, 'frame.png');
  const png = checkerboardCapture();
  for (let y = 56; y < 72; y += 1) {
    for (let x = 56; x < 72; x += 1) {
      const offset = (y * png.width + x) * 4;
      png.data[offset] = 18;
      png.data[offset + 1] = 220;
      png.data[offset + 2] = 255;
      png.data[offset + 3] = 255;
    }
  }
  writeFileSync(path, PNG.sync.write(png));
  assert.throws(() => inspectStarterScreenshot(path), /TN_NATIVE_STARTER_ASSET_NOT_VISIBLE/);
});

test('a blue-grey background alone is not the cyan proof asset', () => {
  const directory = makeTempDirSync('starter-background-only-test-');
  const path = join(directory, 'frame.png');
  const png = new PNG({ height: 256, width: 256 });
  for (let index = 0; index < 256 * 256; index += 1) {
    const offset = index * 4;
    png.data[offset] = 40 + (index % 20);
    png.data[offset + 1] = 90 + (Math.floor(index / 20) % 10);
    png.data[offset + 2] = 110;
    png.data[offset + 3] = 255;
  }
  writeFileSync(path, PNG.sync.write(png));
  assert.throws(() => inspectStarterScreenshot(path), /TN_NATIVE_STARTER_ASSET_NOT_VISIBLE/);
});

test('a darker localized cyan object is not the proof asset', () => {
  const directory = makeTempDirSync('starter-dark-asset-test-');
  const path = join(directory, 'frame.png');
  const png = new PNG({ height: 128, width: 128 });
  for (let y = 0; y < 128; y += 1) {
    for (let x = 0; x < 128; x += 1) {
      const offset = (y * 128 + x) * 4;
      if (x < 16 && y < 16) {
        png.data[offset] = 11;
        png.data[offset + 1] = 118;
        png.data[offset + 2] = 128;
      } else {
        const index = y * 128 + x;
        png.data[offset] = index % 40;
        png.data[offset + 1] = 25 + (index % 12);
        png.data[offset + 2] = 50 + (index % 11);
      }
      png.data[offset + 3] = 255;
    }
  }
  writeFileSync(path, PNG.sync.write(png));
  assert.throws(() => inspectStarterScreenshot(path), /TN_NATIVE_STARTER_ASSET_NOT_VISIBLE/);
});

test('a fragmented near-edge cyan wash is not asset evidence', () => {
  const directory = makeTempDirSync('starter-wash-test-');
  const path = join(directory, 'frame.png');
  const png = new PNG({ height: 128, width: 128 });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = (y * png.width + x) * 4;
      const index = y * png.width + x;
      png.data[offset] = index % 40;
      png.data[offset + 1] = 20 + (index % 30);
      png.data[offset + 2] = 50 + (index % 40);
      png.data[offset + 3] = 255;
    }
  }
  for (let y = 1; y < png.height - 1; y += 3) {
    for (let x = 1; x < png.width - 1; x += 1) {
      const offset = (y * png.width + x) * 4;
      png.data[offset] = 20;
      png.data[offset + 1] = 220;
      png.data[offset + 2] = 240;
    }
  }
  writeFileSync(path, PNG.sync.write(png));
  assert.throws(() => inspectStarterScreenshot(path), /TN_NATIVE_STARTER_ASSET_NOT_VISIBLE/);
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
  writeFileSync(path, PNG.sync.write(cyanObjectFrame({ cyanPixels: 0 })));
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
