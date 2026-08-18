import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';
import { test } from 'vitest';
import { stageDesktopFiles } from '../scripts/package-desktop.mjs';

test('desktop public assets are staged at web-root paths', () => {
  const root = makeTempDirSync('threenative-desktop-assets-');
  try {
    const bundle = join(root, 'bundle.js');
    const assets = join(root, 'public');
    const staging = join(root, 'staging');
    mkdirSync(join(assets, 'models'), { recursive: true });
    writeFileSync(bundle, 'export default 1;');
    writeFileSync(join(assets, 'native-proof.png'), 'png');
    writeFileSync(join(assets, 'models', 'native-proof.glb'), 'glb');

    const entry = stageDesktopFiles(bundle, assets, staging);

    assert.equal(entry, join(staging, '.threenative', 'game.js'));
    assert.equal(readFileSync(join(staging, 'native-proof.png'), 'utf8'), 'png');
    assert.equal(readFileSync(join(staging, 'models', 'native-proof.glb'), 'utf8'), 'glb');
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

    assert.deepEqual(
      JSON.parse(readFileSync(join(staging, '.threenative', 'config.json'), 'utf8')),
      config,
    );
    const host = readFileSync(new URL('../src/cli/main.cpp', import.meta.url), 'utf8');
    assert.match(host, /readEmbeddedFile\("\.threenative\/config\.json"/u);
    assert.match(host, /extractJsonString\(config, "title"\)/u);
    assert.match(host, /extractJsonNumber\(config, "width"/u);
    assert.match(host, /extractJsonNumber\(config, "height"/u);
    assert.match(host, /extractJsonBool\(config, "resizable"/u);
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
