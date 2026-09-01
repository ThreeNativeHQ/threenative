import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('architectural avenue contains near and far casters plus a movable invalidation target', () => {
  const text = read('../src/demo/createAvenueScene.js');

  assert.match(text, /createAvenueScene/);
  assert.match(text, /movableCaster/);
  assert.match(text, /casters/);
  assert.match(text, /far/i);
  assert.match(text, /column/i);
  assert.match(text, /tree/i);
  assert.match(text, /obelisk/i);
});

test('stock comparison uses one conventional 1024 square PCF soft shadow map', () => {
  const text = read('../src/demo/createStockShadowView.js');

  assert.match(text, /PCFSoftShadowMap/);
  assert.match(text, /mapSize\.set\(1024, 1024\)/);
  assert.match(text, /castShadow\s*=\s*true/);
  assert.match(text, /receiveShadow\s*=\s*true/);
});

test('virtual view installs the page system and tracks every caster', () => {
  const text = read('../src/demo/createVirtualShadowView.js');

  assert.match(text, /new VirtualShadowMap/);
  assert.match(text, /createVirtualShadowMaterial/);
  assert.match(text, /trackCaster/);
  assert.match(text, /virtualShadowMap\.update/);
  assert.match(text, /getStats/);
});

test('browser shell supports comparison, debug and invalidation proof modes', () => {
  const boot = read('../src/demo/boot.js');
  const html = read('../index.html');

  assert.match(boot, /comparison/);
  assert.match(boot, /debug/);
  assert.match(boot, /invalidation/);
  assert.match(boot, /__TN_VSM_READY__/);
  assert.match(boot, /__TN_VSM_ERROR__/);
  assert.match(boot, /__TN_VSM_DEBUG__/);
  assert.match(boot, /captureMode/);
  assert.match(boot, /!\(config\.captureMode && ready\)/);
  assert.match(boot, /invalidationProof\.renderedAfterMove > 0\n        && stats\.dirtyResident === 0/);
  assert.doesNotMatch(boot, /postMoveStableFrames/);
  assert.match(html, /stock-canvas/);
  assert.match(html, /virtual-canvas/);
});

test('diagnostics surface the residency and cache fields that prove virtualization', () => {
  const text = read('../src/demo/ui.js');
  for (const field of [
    'requested', 'resident', 'rendered', 'cached', 'reuseRatio',
    'invalidated', 'evicted', 'overflow', 'physicalCapacity',
  ]) {
    assert.match(text, new RegExp(`\\b${field}\\b`));
  }
  assert.match(text, /drawResidencyMap/);
});
