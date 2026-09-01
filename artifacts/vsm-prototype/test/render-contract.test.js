import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('virtual shadow renderer owns a bounded packed-depth physical atlas', () => {
  const text = source('../src/render/VirtualShadowMap.js');

  assert.match(text, /new THREE\.WebGLRenderTarget/);
  assert.match(text, /RGBADepthPacking/);
  assert.match(text, /new THREE\.DataTexture/);
  assert.match(text, /setViewport/);
  assert.match(text, /setScissor/);
  assert.match(text, /setScissorTest\( true \)/);
  assert.match(text, /renderBudget/);
  assert.match(text, /PhysicalPagePool/);
  assert.match(text, /ReceiverDemandPass/);
});

test('shader resolves a virtual page table and safely falls back through clip levels', () => {
  const text = source('../src/render/VirtualShadowMaterial.js');

  assert.match(text, /GLSL3/);
  assert.match(text, /texelFetch\s*\(/);
  assert.match(text, /unpackRGBAToDepth/);
  assert.match(text, /lookupVirtualPage/);
  assert.match(text, /for\s*\(\s*int fallback/);
  assert.match(text, /for\s*\(\s*int tapY/);
  assert.match(text, /for\s*\(\s*int tapX/);
  assert.match(text, /worldPosition\s*\+/);
});

test('does not confuse Three.js variance shadows or built-in maps with virtual pages', () => {
  const renderer = source('../src/render/VirtualShadowMap.js');
  const material = source('../src/render/VirtualShadowMaterial.js');
  const combined = `${renderer}\n${material}`;

  assert.doesNotMatch(combined, /VSMShadowMap/);
  assert.doesNotMatch(combined, /light\.shadow\.map/);
  assert.doesNotMatch(combined, /DirectionalLightShadow/);
});

test('renderer exposes stable diagnostics and selective invalidation hooks', () => {
  const text = source('../src/render/VirtualShadowMap.js');

  for (const field of [
    'requested', 'resident', 'rendered', 'cached', 'invalidated',
    'evicted', 'overflow', 'reuseRatio', 'pageSize', 'atlasPagesPerAxis',
  ]) {
    assert.match(text, new RegExp(`\\b${field}\\b`));
  }
  assert.match(text, /trackCaster\s*\(/);
  assert.match(text, /invalidateAll\s*\(/);
  assert.match(text, /getStats\s*\(/);
  assert.match(text, /dispose\s*\(/);
});

test('custom GLSL does not redeclare ShaderMaterial built-in attributes or matrices', () => {
  const text = source('../src/render/VirtualShadowMaterial.js');
  assert.doesNotMatch(text, /in vec3 position;/);
  assert.doesNotMatch(text, /in vec3 normal;/);
  assert.doesNotMatch(text, /uniform mat4 modelMatrix;/);
  assert.doesNotMatch(text, /uniform mat4 modelViewMatrix;/);
  assert.doesNotMatch(text, /uniform mat4 projectionMatrix;/);
});
