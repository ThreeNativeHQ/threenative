import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { stageDesktopFiles } from '../scripts/package-desktop.mjs';

test('desktop public assets are staged at web-root paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'threenative-desktop-assets-'));
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
  const root = mkdtempSync(join(tmpdir(), 'threenative-desktop-assets-'));
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
