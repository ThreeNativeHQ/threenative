import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const bindingsPath = join(root, 'src/raytracing/bindings.cpp');

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function traceRaysBody(source) {
  const start = source.indexOf('static js::JSValueHandle js_traceRays(');
  const end = source.indexOf('static js::JSValueHandle js_destroyBLAS(', start);
  assert.ok(start >= 0, 'native traceRays binding is missing');
  assert.ok(end > start, 'native traceRays binding has no end');
  return source.slice(start, end);
}

export function assertNativeRayTracingGate(source) {
  const body = traceRaysBody(source);
  const refusal = body.indexOf('engine->throwException(kNativeRayTracingUnavailableMessage);');
  const backendCall = body.indexOf('g_rtBackend->traceRays(traceOptions);');
  if (refusal < 0) {
    throw new Error('RED observed: native traceRays refusal gate missing');
  }
  if (backendCall < 0 || refusal > backendCall) {
    throw new Error('RED observed: native traceRays backend call is not behind the refusal gate');
  }
  assert.match(body, /return engine->newUndefined\(\);/u);
  assert.match(
    source,
    /kNativeRayTracingUnavailableMessage[\s\S]*buffer-to-texture copy-out interop exists/u,
    'the native refusal must name the missing buffer-to-texture copy-out interop',
  );
}

test('native traceRays refuses before any backend can report success', () => {
  const bindings = readFileSync(bindingsPath, 'utf8');
  assertNativeRayTracingGate(bindings);
  assert.match(
    bindings,
    /kNativeRayTracingResultInteropAvailable = false/u,
    'native ray tracing support must remain unavailable until result interop exists',
  );
});

test('negative control: restoring the old accept path makes the refusal contract red', () => {
  const bindings = readFileSync(bindingsPath, 'utf8');
  const gate = `if (!kNativeRayTracingResultInteropAvailable) {
        engine->throwException(kNativeRayTracingUnavailableMessage);
        return engine->newUndefined();
    }
`;
  const mutated = bindings.replace(gate, '');
  assert.notEqual(mutated, bindings, 'the mutation must remove the live refusal gate');
  assert.throws(() => assertNativeRayTracingGate(mutated), /RED observed: native traceRays refusal gate missing/u);
});

test('raytracing backends retain their copy-out TODOs for the future un-gate', () => {
  assert.match(
    read('src/raytracing/vulkan_rt.cpp'),
    /TODO: Copy staging buffer data to WebGPU texture/u,
  );
  assert.match(
    read('src/raytracing/dxr_rt.cpp'),
    /TODO: Copy readback buffer data to WebGPU texture/u,
  );
  assert.match(read('src/raytracing/metal_rt.mm'), /TODO: Implement WebGPU texture interop/u);
});

test('registry marks the refusal scene as native-unavailable until readback exists', () => {
  const registry = JSON.parse(read('conformance/registry.json'));
  const row = registry.tests.find((entry) => entry.id === '98-native-raytracing-refusal');
  assert.deepEqual(
    {
      availability: row?.availability,
      desktopGate: row?.desktopGate,
      required: row?.required,
      status: row?.status,
    },
    {
      availability: 'unavailable-until-readback',
      desktopGate: true,
      required: true,
      status: 'implemented',
    },
  );
  const scene = read('conformance/scenes/shared/raytracing-refusal.js');
  assert.match(scene, /globalThis\.mystralRT/u);
  assert.match(scene, /TN_NATIVE_RAYTRACING_UNAVAILABLE/u);
  assert.match(scene, /native raytracing refusal:/u);
});
