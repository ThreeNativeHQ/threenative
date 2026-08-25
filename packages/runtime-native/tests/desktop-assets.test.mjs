import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { stageDesktopFiles } from '../scripts/package-desktop.mjs';
import { minimalGlb } from './fixtures/minimal-glb.mjs';

const runtimeRoot = fileURLToPath(new URL('../', import.meta.url));
/** An Ogg page carrying Opus: the magic number of a container the runtime reads, the codec of one it does not. */
function opusBytes() {
  const bytes = Buffer.alloc(64);
  bytes.write('OggS', 0, 'ascii');
  bytes.write('OpusHead', 28, 'ascii');
  return bytes;
}

test('desktop public assets are staged at web-root paths', () => {
  const root = makeTempDirSync('threenative-desktop-assets-');
  try {
    const bundle = join(root, 'bundle.js');
    const assets = join(root, 'public');
    const staging = join(root, 'staging');
    const model = minimalGlb();
    mkdirSync(join(assets, 'models'), { recursive: true });
    writeFileSync(bundle, 'export default 1;');
    writeFileSync(join(assets, 'native-proof.png'), 'png');
    writeFileSync(join(assets, 'models', 'native-proof.glb'), model);

    const entry = stageDesktopFiles(bundle, assets, staging);

    assert.equal(entry, join(staging, '.threenative', 'game.js'));
    assert.equal(readFileSync(join(staging, 'native-proof.png'), 'utf8'), 'png');
    assert.deepEqual(readFileSync(join(staging, 'models', 'native-proof.glb')), model);
    assert.equal(readFileSync(entry, 'utf8'), 'export default 1;');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('desktop staging rejects the reserved internal asset path', () => {
  const root = makeTempDirSync('threenative-desktop-assets-');
  try {
    const bundle = join(root, 'bundle.js');
    const assets = join(root, 'public');
    mkdirSync(join(assets, '.threenative'), { recursive: true });
    writeFileSync(bundle, 'export default 1;');
    assert.throws(
      () => stageDesktopFiles(bundle, assets, join(root, 'staging')),
      /TN_NATIVE_ASSET_RESERVED_PATH/,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('desktop staging embeds the resolved window contract for the native host', () => {
  const root = makeTempDirSync('threenative-desktop-config-');
  try {
    const bundle = join(root, 'bundle.js');
    const staging = join(root, 'staging');
    const config = {
      app: { id: 'com.studio.foxgame', name: 'Fox', version: '1.2.3', build: 7 },
      display: { orientation: 'landscape', fullscreen: true, keepScreenOn: false },
      window: { title: 'Fox Desktop', width: 1024, height: 576, resizable: false },
    };
    writeFileSync(bundle, 'export default 1;');

    stageDesktopFiles(bundle, undefined, staging, config);

    // `uiRenderer` is flattened out of `ui.renderer` by the packager because `renderer` already
    // means the WebGPU preference at the top level, and the host reads this file with a scanner
    // that would find the wrong one. A game that states nothing gets the native renderer.
    assert.deepEqual(
      JSON.parse(readFileSync(join(staging, '.threenative', 'config.json'), 'utf8')),
      { ...config, uiRenderer: 'native' },
    );
    const web = join(root, 'staging-web');
    stageDesktopFiles(bundle, undefined, web, { ...config, ui: { renderer: 'web' } });
    assert.equal(
      JSON.parse(readFileSync(join(web, '.threenative', 'config.json'), 'utf8')).uiRenderer,
      'web',
    );
    const host = readFileSync(new URL('../src/cli/main.cpp', import.meta.url), 'utf8');
    assert.match(host, /readEmbeddedFile\("\.threenative\/config\.json"/u);
    assert.match(host, /extractJsonString\(config, "title"\)/u);
    assert.match(host, /extractJsonString\(config, "uiRenderer"\)/u);
    assert.match(host, /extractJsonNumber\(config, "width"/u);
    assert.match(host, /extractJsonNumber\(config, "height"/u);
    assert.match(host, /extractJsonBool\(config, "resizable"/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('desktop staging carries the resolved brand icon into the embedded bundle', () => {
  const root = makeTempDirSync('threenative-desktop-brand-');
  try {
    const bundle = join(root, 'bundle.js');
    const icon = join(root, 'icon.png');
    const staging = join(root, 'staging');
    const config = {
      app: {
        id: 'com.studio.foxgame',
        name: 'Fox',
        version: '1.2.3',
        build: 7,
        icon,
      },
    };
    writeFileSync(bundle, 'export default 1;');
    writeFileSync(icon, 'brand-icon');

    stageDesktopFiles(bundle, undefined, staging, config);

    assert.equal(readFileSync(join(staging, '.threenative', 'app-icon.png'), 'utf8'), 'brand-icon');
    assert.deepEqual(
      JSON.parse(readFileSync(join(staging, '.threenative', 'config.json'), 'utf8')).app,
      { id: 'com.studio.foxgame', name: 'Fox', version: '1.2.3', build: 7, icon: '.threenative/app-icon.png' },
    );
    const windowSource = readFileSync(new URL('../src/platform/window.cpp', import.meta.url), 'utf8');
    assert.match(windowSource, /SDL_SetWindowIcon\(/u);
    assert.match(windowSource, /readEmbeddedFile\(path/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('desktop native config parser preserves escaped JSON window titles', () => {
  const root = makeTempDirSync('threenative-desktop-json-');
  try {
    const host = readFileSync(new URL('../src/cli/main.cpp', import.meta.url), 'utf8');
    const parserStart = host.indexOf('static std::string extractJsonString');
    const parserEnd = host.indexOf(
      '\n}\n\n/**\n * Parse JSON to extract a number',
      parserStart,
    );
    assert.ok(parserStart >= 0 && parserEnd > parserStart, 'JSON string parser must be present');

    const source = join(root, 'json-parser.cpp');
    const binary = join(root, 'json-parser');
    const parser = host.slice(parserStart, parserEnd + 2);
    const encoded = JSON.stringify({ title: 'Fox "Deluxe"' });
    const expected = JSON.stringify('Fox "Deluxe"');
    writeFileSync(
      source,
      `#include <cstddef>
#include <string>

${parser}

int main() {
  const std::string config = R"TNJSON(${encoded})TNJSON";
  return extractJsonString(config, "title") == ${expected} ? 0 : 1;
}
`,
    );
    execFileSync('g++', ['-std=c++17', source, '-o', binary], { stdio: 'pipe' });
    execFileSync(binary, { stdio: 'pipe' });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('desktop staging refuses audio no native target decodes, at package time', () => {
  // Desktop ran no preflight at all: only `package-android.mjs` did. So the same file that failed
  // an APK shipped in a desktop binary and failed at `decodeAudioData` after launch instead — the
  // packager having already opened and copied the bytes on its way past.
  const root = makeTempDirSync('threenative-desktop-audio-gate-');
  try {
    const bundle = join(root, 'bundle.js');
    const assets = join(root, 'public');
    mkdirSync(join(assets, 'audio'), { recursive: true });
    writeFileSync(bundle, 'export default 1;');
    writeFileSync(join(assets, 'audio', 'voice.ogg'), opusBytes());
    assert.throws(
      () => stageDesktopFiles(bundle, assets, join(root, 'staging'), undefined, runtimeRoot),
      (error) => {
        assert.match(error.message, /cannot be decoded by the desktop target/u);
        assert.match(error.message, /is Ogg Opus; no native target decodes this container/u);
        return true;
      },
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('desktop staging packages a genuine Ogg Vorbis file, because the runtime decodes it', () => {
  const root = makeTempDirSync('threenative-desktop-audio-pass-');
  try {
    const bundle = join(root, 'bundle.js');
    const assets = join(root, 'public');
    mkdirSync(join(assets, 'audio'), { recursive: true });
    writeFileSync(bundle, 'export default 1;');
    const fixture = readFileSync(join(runtimeRoot, 'tests', 'fixtures', 'pickup.ogg'));
    writeFileSync(join(assets, 'audio', 'pickup.ogg'), fixture);
    const staging = join(root, 'staging');
    stageDesktopFiles(bundle, assets, staging, undefined, runtimeRoot);
    assert.deepEqual(readFileSync(join(staging, 'audio', 'pickup.ogg')), fixture);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
