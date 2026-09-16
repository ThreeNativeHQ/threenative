import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { test } from 'vitest';

import {
  analyzeStarterLog,
  inspectContainerBrand,
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

// The proof asset is graded down until it sits well below the brightness the pre-#126 predicate
// demanded — `blue > 150 && green > 140` was an exposure threshold wearing a colour's name, so a
// kit that grades its world darker failed a gate about whether an asset is *present*. Channel
// margins are ratios between channels, so they survive the grade the same way hue did. This is
// #126's property, kept, but on a fixture carrying the packaged asset's two colours rather than
// cyan alone: the real proof is a cyan/magenta checkerboard, and a cyan-only stand-in is not it.
function gradedProofFrame() {
  const png = new PNG({ height: 16, width: 16 });
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const offset = (y * 16 + x) * 4;
      png.data[offset + 3] = 255;
      if (y === 15) {
        // One row of world behind the asset, so the frame is not the proof alone.
        png.data[offset] = x % 12;
        png.data[offset + 1] = 25 + (x % 9);
        png.data[offset + 2] = 50 + (x % 11);
      } else if ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0) {
        // Authored magenta [255,40,180], graded down.
        png.data[offset] = 128;
        png.data[offset + 1] = 20;
        png.data[offset + 2] = 90;
      } else {
        // Authored cyan [18,220,255], graded down: 128 is the lit frame's blue and 118 its green,
        // both under the pre-#126 predicate's 150/140 thresholds.
        png.data[offset] = 11;
        png.data[offset + 1] = 118;
        png.data[offset + 2] = 128;
      }
    }
  }
  return png;
}

test('the proof asset survives a grade that leaves it darker than the old floor', () => {
  const directory = makeTempDirSync('starter-graded-test-');
  const path = join(directory, 'frame.png');
  const png = gradedProofFrame();
  writeFileSync(path, PNG.sync.write(png));
  // Every proof pixel here is below the old brightness floor, so the pre-#126 predicate saw none.
  let brightEnoughForTheOldPredicate = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    if (png.data[index + 2] > 150 && png.data[index + 1] > 140) brightEnoughForTheOldPredicate += 1;
  }
  assert.equal(brightEnoughForTheOldPredicate, 0);
  const result = inspectStarterScreenshot(path);
  assert.ok(result.magentaAssetPixels >= 100);
  assert.ok(result.cyanAssetPixels >= 50);
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
  // message pointed the reader at a texture that loaded correctly.
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

test('primary CI invokes the native lane on pull requests and pushes', () => {
  const ci = readFileSync('../../.github/workflows/ci.yml', 'utf8');
  const ciTriggers = ci.slice(ci.indexOf('\non:'), ci.indexOf('concurrency:'));
  assert.match(ciTriggers, /pull_request:\s*\n\s*branches:\s*\n\s*-\s*main/u);
  assert.match(ciTriggers, /push:\s*\n\s*branches:\s*\n\s*-\s*main/u);

  const native = readFileSync('../../.github/workflows/native-platforms.yml', 'utf8');
  const nativeTriggers = native.slice(native.indexOf('\non:'), native.indexOf('concurrency:'));
  assert.match(nativeTriggers, /workflow_call:/u);
  assert.doesNotMatch(nativeTriggers, /(?:pull_request|push|schedule):/u);
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

// PRD-375 phase 2: the distributed desktop container must carry the game's brand, not the
// engine's. These fixtures stage the directory PRD-365 produces (manifest, platform metadata,
// embedded icon); they make no claim of a real packaged launch or OS launcher inspection, which
// stays blocked until PRD-365's containers are on `develop`.
function sha256Of(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function writeContainerFile(root, relative, contents) {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return { path, sha256: sha256Of(contents) };
}

function authoredIcon(contents = 'authored game icon') {
  const directory = makeTempDirSync('starter-brand-icon-');
  const path = join(directory, 'icon.png');
  writeFileSync(path, contents);
  return path;
}

function brandConfig(iconPath) {
  return {
    app: { id: 'com.example.orbit', name: 'Orbit Game', version: '1.2.3', build: 7, icon: iconPath },
    ui: { renderer: 'web' },
    bootSplash: { backgroundColor: '#0d1b2a' },
  };
}

function stageIcon(root, platform, embeddedIcon, app, resources) {
  if (embeddedIcon === null) return;
  const iconRelative = platform === 'darwin'
    ? 'Contents/Resources/orbit.icns'
    : 'share/icons/hicolor/256x256/apps/com.example.orbit.png';
  const icon = writeContainerFile(root, iconRelative, embeddedIcon);
  resources[iconRelative] = { sha256: icon.sha256 };
  app.icon = iconRelative;
  app.iconSha256 = icon.sha256;
}

function stagePlatformMetadata(root, platform, app, resources, { dropPlistName, dropDesktopName }) {
  if (platform === 'linux') {
    const relative = 'share/applications/com.example.orbit.desktop';
    const entry = dropDesktopName
      ? '[Desktop Entry]\nType=Application\n'
      : `[Desktop Entry]\nType=Application\nName=${app.name}\nExec=orbit\nIcon=com.example.orbit\n`;
    resources[relative] = { sha256: writeContainerFile(root, relative, entry).sha256 };
  }
  if (platform === 'darwin') {
    const plist = dropPlistName
      ? '<plist version="1.0"><dict></dict></plist>'
      : `<plist version="1.0"><dict><key>CFBundleName</key><string>${app.name}</string><key>CFBundleIconFile</key><string>orbit</string></dict></plist>`;
    resources['Contents/Info.plist'] = { sha256: writeContainerFile(root, 'Contents/Info.plist', plist).sha256 };
  }
}

function brandedContainer({
  platform = 'linux',
  config,
  embeddedIcon = Buffer.from('authored game icon'),
  manifestName,
  dropIconResource = false,
  dropPlistName = false,
  dropDesktopName = false,
  loading,
  ui = true,
} = {}) {
  const directory = makeTempDirSync('starter-brand-container-');
  const root = join(directory, 'game');
  mkdirSync(root, { recursive: true });
  const executableRelative = platform === 'darwin'
    ? 'Contents/MacOS/orbit'
    : platform === 'win32'
      ? 'orbit.exe'
      : 'orbit';
  const executable = writeContainerFile(root, executableRelative, Buffer.from('game executable'));
  const resources = { [executableRelative]: { sha256: executable.sha256 } };
  const app = {
    id: config.app.id,
    name: manifestName ?? config.app.name,
    version: config.app.version,
    build: config.app.build,
  };
  stageIcon(root, platform, dropIconResource ? null : embeddedIcon, app, resources);
  stagePlatformMetadata(root, platform, app, resources, { dropPlistName, dropDesktopName });
  if (ui) {
    resources['ui/index.html'] = { sha256: writeContainerFile(root, 'ui/index.html', '<main>HUD</main>').sha256 };
  }
  const manifestRelative = platform === 'darwin'
    ? 'Contents/Resources/threenative-container.json'
    : 'threenative-container.json';
  writeContainerFile(
    root,
    manifestRelative,
    JSON.stringify(
      {
        app,
        dependencies: [],
        executable: executableRelative,
        format: platform === 'linux' ? 'tar.gz' : 'zip',
        platform: `${platform}-x64`,
        prerequisites: [],
        resources,
        schemaVersion: 1,
        ui: ui ? { directory: 'ui', entry: 'ui/index.html' } : null,
        ...(loading === undefined ? {} : { loading }),
      },
      null,
      2,
    ),
  );
  return root;
}

const ENGINE_ICON = authoredIcon('the engine default icon');

test('a branded container matches its consumer config', () => {
  const icon = authoredIcon();
  const config = brandConfig(icon);
  // This forward-looking loading record is explicit; today's PRD-365 writer omits it.
  const root = brandedContainer({ config, loading: { bootSplash: config.bootSplash } });
  const report = inspectContainerBrand(root, config, { engineIcon: ENGINE_ICON });
  assert.equal(report.name.name, 'Orbit Game');
  assert.equal(report.icon.sha256, sha256Of(readFileSync(icon)));
});

test('should reject a distributed starter when the embedded application icon or runtime brand differs from its consumer config', () => {
  const icon = authoredIcon();
  const config = brandConfig(icon);
  // A different game's icon, not the engine default: only the config comparison can catch this.
  const wrongIcon = brandedContainer({ config, embeddedIcon: Buffer.from('another game icon') });
  assert.throws(
    () => inspectContainerBrand(wrongIcon, config, { engineIcon: ENGINE_ICON }),
    /TN_NATIVE_STARTER_CONTAINER_ICON_MISMATCH/u,
  );
  const wrongName = brandedContainer({ config, manifestName: 'Engine Default' });
  assert.throws(
    () => inspectContainerBrand(wrongName, config, { engineIcon: ENGINE_ICON }),
    /TN_NATIVE_STARTER_CONTAINER_NAME_MISMATCH/u,
  );
});

test('an embedded engine-default icon is rejected even when the config declares custom art', () => {
  const icon = authoredIcon();
  const config = brandConfig(icon);
  const root = brandedContainer({ config, embeddedIcon: readFileSync(ENGINE_ICON) });
  assert.throws(
    () => inspectContainerBrand(root, config, { engineIcon: ENGINE_ICON }),
    /TN_NATIVE_STARTER_CONTAINER_ICON_ENGINE_DEFAULT/u,
  );
});

test('a container that dropped its icon resource fails closed', () => {
  const icon = authoredIcon();
  const config = brandConfig(icon);
  const root = brandedContainer({ config, dropIconResource: true });
  assert.throws(
    () => inspectContainerBrand(root, config, { engineIcon: ENGINE_ICON }),
    /TN_NATIVE_STARTER_CONTAINER_ICON_MISSING/u,
  );
});

test('a macOS bundle without a CFBundleName entry fails closed', () => {
  const icon = authoredIcon();
  const config = brandConfig(icon);
  const root = brandedContainer({ config, platform: 'darwin', dropPlistName: true });
  assert.throws(
    () => inspectContainerBrand(root, config, { engineIcon: ENGINE_ICON }),
    /TN_NATIVE_STARTER_CONTAINER_PLIST_ENTRY_MISSING/u,
  );
});

test('a Linux container without .desktop metadata fails closed', () => {
  const icon = authoredIcon();
  const config = brandConfig(icon);
  const root = brandedContainer({ config, dropDesktopName: true });
  assert.throws(
    () => inspectContainerBrand(root, config, { engineIcon: ENGINE_ICON }),
    /TN_NATIVE_STARTER_CONTAINER_DESKTOP_ENTRY_MISSING/u,
  );
});

test('a missing container or malformed manifest is a hard failure', () => {
  const icon = authoredIcon();
  const config = brandConfig(icon);
  assert.throws(
    () => inspectContainerBrand(join(makeTempDirSync('starter-brand-empty-'), 'absent'), config),
    /TN_NATIVE_STARTER_CONTAINER_MISSING/u,
  );
  const malformed = brandedContainer({ config });
  writeFileSync(join(malformed, 'threenative-container.json'), '{ not json');
  assert.throws(
    () => inspectContainerBrand(malformed, config),
    /TN_NATIVE_STARTER_CONTAINER_MANIFEST_INVALID/u,
  );
});

test('the declared loading sequence must match the consumer config', () => {
  const icon = authoredIcon();
  const config = brandConfig(icon);
  const matching = brandedContainer({
    config,
    loading: { bootSplash: { backgroundColor: '#0d1b2a', imageSha256: null } },
  });
  assert.deepEqual(
    inspectContainerBrand(matching, config, { engineIcon: ENGINE_ICON }).loading.bootSplash,
    { backgroundColor: '#0d1b2a', imageSha256: null },
  );
  const wrong = brandedContainer({
    config,
    loading: { bootSplash: { backgroundColor: '#ffffff', imageSha256: null } },
  });
  assert.throws(
    () => inspectContainerBrand(wrong, config, { engineIcon: ENGINE_ICON }),
    /TN_NATIVE_STARTER_CONTAINER_LOADING_MISMATCH/u,
  );
});

test('a container with no inspectable brand is a failure, not a pass', () => {
  const bare = { app: { id: 'com.example.orbit', version: '1.2.3', build: 7 } };
  const root = brandedContainer({ config: bare, dropIconResource: true, ui: false });
  assert.throws(
    () => inspectContainerBrand(root, bare),
    /TN_NATIVE_STARTER_CONTAINER_BRAND_UNVERIFIED/u,
  );
});

test('a malformed consumer config throws instead of reporting a pass', () => {
  assert.throws(
    () => inspectContainerBrand(makeTempDirSync('starter-brand-config-'), null),
    /TN_NATIVE_STARTER_BRAND_CONFIG_INVALID/u,
  );
});

// Review controls use producer-shaped integrity records; metadata fixtures are not OS captures.
function reviewBrandFixture(platform = 'linux') {
  const directory = makeTempDirSync('prd375-review-');
  const root = join(directory, 'game');
  mkdirSync(root);
  const icon = join(directory, 'authored.png');
  const engine = join(directory, 'engine.png');
  writeFileSync(icon, 'authored icon');
  writeFileSync(engine, 'engine icon');
  const config = { app: { id: 'com.example.orbit', name: 'Orbit Game', icon }, ui: { renderer: 'web' } };
  const iconPath = platform === 'darwin' ? 'Contents/Resources/Orbit-Game.icns' : 'share/icons/hicolor/256x256/apps/com.example.orbit.png';
  const manifest = { schemaVersion: 1, platform: `${platform}-x64`, app: { ...config.app, icon: iconPath, iconSha256: sha256Of('authored icon') }, resources: {}, dependencies: [], executable: 'orbit', ui: { entry: 'ui/index.html' } };
  const manifestPath = join(root, platform === 'darwin' ? 'Contents/Resources/threenative-container.json' : 'threenative-container.json');
  function file(path, contents) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
    manifest.resources[path] = { sha256: sha256Of(contents) };
    return target;
  }
  file('orbit', 'executable');
  file(iconPath, 'authored icon');
  file('ui/index.html', '<main>Orbit</main>');
  if (platform === 'linux') file('share/applications/com.example.orbit.desktop', '[Desktop Entry]\nType=Application\nName=Orbit Game\nIcon=com.example.orbit\n');
  if (platform === 'darwin') file('Contents/Info.plist', '<plist><dict><key>CFBundleName</key><string>Orbit Game</string><key>CFBundleDisplayName</key><string>Orbit Game</string><key>CFBundleIconFile</key><string>Orbit-Game</string></dict></plist>');
  function save() { mkdirSync(dirname(manifestPath), { recursive: true }); writeFileSync(manifestPath, JSON.stringify(manifest)); }
  function inspect(options = {}) { save(); return inspectContainerBrand(root, config, { engineIcon: engine, ...options }); }
  return { directory, root, icon, engine, config, manifest, file, save, inspect, manifestPath };
}

test('matching Linux artifact stays accepted', () => { const f = reviewBrandFixture(); assert.equal(f.inspect().name.name, 'Orbit Game'); });
test('matching macOS artifact stays accepted', () => { const f = reviewBrandFixture('darwin'); assert.equal(f.inspect().name.name, 'Orbit Game'); });
for (const renderer of ['web', 'native']) test(`a declared splash cannot be replaced with ${renderer} launch metadata`, () => {
  const f = reviewBrandFixture(); f.config.bootSplash = { backgroundColor: '#010203' }; f.config.ui.renderer = renderer;
  if (renderer === 'native') f.manifest.ui = null;
  assert.throws(() => f.inspect(), /CONTAINER_LOADING_MISSING/);
});
test('a loading declaration cannot bypass a missing web entry', () => {
  const f = reviewBrandFixture(); f.config.bootSplash = { backgroundColor: '#010203' }; f.manifest.loading = { bootSplash: { backgroundColor: '#010203' } }; f.manifest.ui = null;
  assert.throws(() => f.inspect(), /CONTAINER_LOADING_MISSING/);
});
test('a directory is not a web entry', () => { const f = reviewBrandFixture(); f.manifest.ui.entry = 'ui'; assert.throws(() => f.inspect(), /CONTAINER_(LOADING_MISSING|MANIFEST_INVALID)/); });
for (const [key, value] of [['ui', 'web'], ['bootSplash', 42], ['app', []]]) test(`malformed config.${key} fails before inspection`, () => {
  const f = reviewBrandFixture(); f.config[key] = value; assert.throws(() => f.inspect(), /BRAND_CONFIG_INVALID/);
});
for (const platform of [undefined, 'other-x64', 'linux-riscv64']) test(`unsupported or missing platform ${platform} cannot select a fallback`, () => {
  const f = reviewBrandFixture(); f.manifest.platform = platform; assert.throws(() => f.inspect(), /CONTAINER_MANIFEST_INVALID/);
});
test('icon traversal outside the container fails', () => { const f = reviewBrandFixture(); f.manifest.app.icon = '../authored.png'; f.manifest.resources['../authored.png'] = { sha256: sha256Of('authored icon') }; assert.throws(() => f.inspect(), /CONTAINER_MANIFEST_INVALID/); });
test('a resource symlink cannot borrow an icon from outside the container', () => {
  const f = reviewBrandFixture(); const path = join(f.root, f.manifest.app.icon); rmSync(path); symlinkSync(f.icon, path); assert.throws(() => f.inspect(), /CONTAINER_MANIFEST_INVALID/);
});
test('a symlinked manifest cannot borrow an external manifest', () => {
  const f = reviewBrandFixture(); f.save(); const outside = join(f.directory, 'manifest.json'); writeFileSync(outside, readFileSync(f.manifestPath)); rmSync(f.manifestPath); symlinkSync(outside, f.manifestPath);
  assert.throws(() => inspectContainerBrand(f.root, f.config, { engineIcon: f.engine }), /CONTAINER_MANIFEST_INVALID/);
});
test('a desktop action name is not the launcher name', () => { const f = reviewBrandFixture(); f.file('share/applications/com.example.orbit.desktop', '[Desktop Action Play]\nName=Orbit Game\n[Desktop Entry]\nType=Application\nName=Wrong Game\nIcon=com.example.orbit\n'); assert.throws(() => f.inspect(), /CONTAINER_NAME_MISMATCH/); });
test('a wrong desktop icon reference fails despite correct sidecar bytes', () => { const f = reviewBrandFixture(); f.file('share/applications/com.example.orbit.desktop', '[Desktop Entry]\nType=Application\nName=Orbit Game\nIcon=engine-default\n'); assert.throws(() => f.inspect(), /CONTAINER_ICON_(MISSING|MISMATCH)/); });
test('a stale macOS display name is not hidden by a correct bundle name', () => { const f = reviewBrandFixture('darwin'); f.file('Contents/Info.plist', '<plist><dict><key>CFBundleName</key><string>Orbit Game</string><key>CFBundleDisplayName</key><string>Engine</string><key>CFBundleIconFile</key><string>Orbit-Game</string></dict></plist>'); assert.throws(() => f.inspect(), /CONTAINER_NAME_MISMATCH/); });
test('a wrong macOS icon reference fails despite a matching source hash', () => { const f = reviewBrandFixture('darwin'); f.file('Contents/Info.plist', '<plist><dict><key>CFBundleName</key><string>Orbit Game</string><key>CFBundleIconFile</key><string>Missing</string></dict></plist>'); assert.throws(() => f.inspect(), /CONTAINER_ICON_(MISSING|MISMATCH)/); });
test('converted macOS bytes have their own payload hash, not the source PNG hash', () => { const f = reviewBrandFixture('darwin'); f.file(f.manifest.app.icon, 'converted ICNS payload'); const report = f.inspect(); assert.equal(report.icon.sha256, sha256Of('converted ICNS payload')); assert.equal(report.icon.sourceSha256, sha256Of('authored icon')); });
test('Windows manifest and sidecar are not PE-resource verification', () => { const f = reviewBrandFixture('win32'); assert.throws(() => f.inspect(), /CONTAINER_BRAND_UNVERIFIED/); });
test('missing icon source hash fails closed', () => { const f = reviewBrandFixture(); delete f.manifest.app.iconSha256; assert.throws(() => f.inspect(), /CONTAINER_MANIFEST_INVALID/); });
test('an incorrect payload integrity hash fails', () => { const f = reviewBrandFixture(); f.manifest.resources[f.manifest.app.icon].sha256 = '0'.repeat(64); assert.throws(() => f.inspect(), /CONTAINER_TAMPERED/); });
test('relative authored paths resolve against the supplied project, not process cwd', () => { const f = reviewBrandFixture(); f.config.app.icon = 'authored.png'; assert.equal(f.inspect({ project: f.directory }).icon.sha256, sha256Of('authored icon')); });
test('UI metadata alone cannot satisfy a brand inspection', () => { const f = reviewBrandFixture(); f.config.app = {}; assert.throws(() => f.inspect(), /CONTAINER_BRAND_UNVERIFIED/); });
test('null loading metadata is a named malformed-manifest error', () => { const f = reviewBrandFixture(); f.manifest.loading = null; assert.throws(() => f.inspect(), /CONTAINER_MANIFEST_INVALID/); });
test('a valid loading declaration and UI launch both remain inspectable', () => {
  const f = reviewBrandFixture(); f.config.bootSplash = { backgroundColor: '#010203' }; f.manifest.loading = { bootSplash: { backgroundColor: '#010203' } };
  const report = f.inspect(); assert.equal(report.loading.bootSplash.backgroundColor, '#010203'); assert.equal(report.loading.uiEntry, 'ui/index.html');
});
test('an empty splash object is not a brand assertion', () => { const f = reviewBrandFixture(); f.config.app = {}; f.config.bootSplash = {}; f.manifest.loading = { bootSplash: {} }; assert.throws(() => f.inspect(), /CONTAINER_BRAND_UNVERIFIED/); });
test('a missing authored splash image has an actionable config error', () => { const f = reviewBrandFixture(); f.config.bootSplash = { image: join(f.directory, 'missing.png') }; f.manifest.loading = { bootSplash: { imageSha256: '0'.repeat(64) } }; assert.throws(() => f.inspect(), /BRAND_CONFIG_IMAGE_MISSING/); });
test('duplicate macOS name keys are ambiguous, not matching evidence', () => { const f = reviewBrandFixture('darwin'); f.file('Contents/Info.plist', '<plist><dict><key>CFBundleName</key><string>Orbit Game</string><key>CFBundleName</key><string>Wrong Game</string><key>CFBundleIconFile</key><string>Orbit-Game</string></dict></plist>'); assert.throws(() => f.inspect(), /CONTAINER_MANIFEST_INVALID/); });
