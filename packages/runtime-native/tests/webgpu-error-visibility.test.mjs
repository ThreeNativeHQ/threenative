import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const contextSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'webgpu', 'context.cpp'),
  'utf8',
);

/**
 * On Android nothing written to std::cerr reaches logcat. A WebGPU validation error that is
 * only printed there is invisible, and the next wgpuQueueSubmit aborts the process with no
 * diagnostic at all — which is how a shader the backend rejects reads as a silent crash.
 *
 * Both backend callback shapes (Dawn/modern wgpu-native use WGPUStringView, older
 * wgpu-native uses char const*) must therefore also log through the platform logger.
 */
function callbackBodies(name) {
  const bodies = [];
  let index = contextSource.indexOf(`static void ${name}(`);
  while (index !== -1) {
    const open = contextSource.indexOf('{', index);
    let depth = 0;
    let cursor = open;
    do {
      if (contextSource[cursor] === '{') depth += 1;
      else if (contextSource[cursor] === '}') depth -= 1;
      cursor += 1;
    } while (depth > 0 && cursor < contextSource.length);
    bodies.push(contextSource.slice(open, cursor));
    index = contextSource.indexOf(`static void ${name}(`, cursor);
  }
  return bodies;
}

test('every WebGPU device error path reaches the platform log', () => {
  const bodies = callbackBodies('onDeviceError');
  assert.equal(bodies.length, 2, 'expected one onDeviceError per backend callback shape');
  for (const body of bodies) {
    assert.match(
      body,
      /TN_CONTEXT_LOGE\(/,
      'onDeviceError must log through TN_CONTEXT_LOGE; std::cerr alone is invisible on Android',
    );
  }
});

test('adapter and device request failures reach the platform log', () => {
  for (const name of ['onAdapterRequestEnded', 'onDeviceRequestEnded']) {
    const bodies = callbackBodies(name);
    assert.equal(bodies.length, 2, `expected one ${name} per backend callback shape`);
    for (const body of bodies) {
      assert.match(body, /TN_CONTEXT_LOGE\(/, `${name} must report its failure to the platform log`);
    }
  }
});
