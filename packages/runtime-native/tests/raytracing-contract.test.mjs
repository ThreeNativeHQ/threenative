import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const bindingsPath = join(root, 'src/raytracing/bindings.cpp');
const scenePath = join(root, 'conformance/scenes/shared/raytracing-refusal.js');

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

export function assertBrowserRayTracingGate(source) {
  const capabilityStart = source.indexOf('async function assertBrowserRayTracingCapability()');
  const capabilityEnd = source.indexOf('\n\nfunction assertNativeRayTracingRefusal()', capabilityStart);
  if (capabilityStart < 0 || capabilityEnd <= capabilityStart) {
    throw new Error('RED observed: browser raytracing capability gate missing');
  }
  const capability = source.slice(capabilityStart, capabilityEnd);
  assert.match(capability, /navigator\.gpu/u);
  assert.match(capability, /requestAdapter\(\)/u);
  assert.match(capability, /adapter\.features\?\.has\(WEB_RAY_TRACING_FEATURE\)/u);
  assert.match(capability, /requestDevice\(\{ requiredFeatures: \[WEB_RAY_TRACING_FEATURE\] \}\)/u);
  assert.match(capability, /TN_WEB_RAYTRACING_UNAVAILABLE/u);

  const browserCall = source.indexOf('await assertBrowserRayTracingCapability()');
  const visualSurface = source.indexOf('return startVisualScene', browserCall);
  if (browserCall < 0 || visualSurface <= browserCall) {
    throw new Error('RED observed: browser raytracing capability is not checked before the surface');
  }
  assert.doesNotMatch(source, /target: "web", refused: false/u);
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

test('browser raytracing conformance checks the web capability before rendering', () => {
  const scene = readFileSync(scenePath, 'utf8');
  assertBrowserRayTracingGate(scene);
});

test('negative control: removing the browser capability check is red', () => {
  const scene = readFileSync(scenePath, 'utf8');
  const withoutBrowserCheck = scene.replace('await assertBrowserRayTracingCapability()', 'assertBrowserRayTracingCapability()');
  assert.notEqual(withoutBrowserCheck, scene, 'the mutation must remove the awaited browser capability check');
  assert.throws(
    () => assertBrowserRayTracingGate(withoutBrowserCheck),
    /RED observed: browser raytracing capability is not checked before the surface/u,
  );
});

test('default native builds register the refusal surface without compiling heavy backends', () => {
  const cmake = read('CMakeLists.txt');
  const runtime = read('src/runtime.cpp');
  const bindings = readFileSync(bindingsPath, 'utf8');
  const sourceStart = cmake.indexOf('# The public ray tracing surface');
  const sourceEnd = cmake.indexOf('\nif(ANDROID)', sourceStart);
  assert.ok(sourceStart >= 0, 'ray tracing source section is missing');
  assert.ok(sourceEnd > sourceStart, 'ray tracing source section has no end');

  const sourceSection = cmake.slice(sourceStart, sourceEnd);
  const heavyGate = sourceSection.indexOf('if(MYSTRAL_USE_RAYTRACING)');
  assert.ok(heavyGate >= 0, 'heavy ray tracing sources must retain an explicit feature gate');

  const alwaysSources = sourceSection.slice(0, heavyGate);
  assert.match(
    alwaysSources,
    /list\(APPEND MYSTRAL_SOURCES\s+src\/raytracing\/rt_common\.cpp\s+src\/raytracing\/bindings\.cpp\s+\)/u,
    'the no-RT build must compile the lightweight common backend and JS bindings',
  );
  assert.doesNotMatch(
    alwaysSources,
    /(?:vulkan_rt|dxr_rt|metal_rt)\./u,
    'heavy RT backend sources must not enter the default source list',
  );

  const heavySources = sourceSection.slice(heavyGate);
  for (const backend of ['vulkan_rt.cpp', 'dxr_rt.cpp', 'metal_rt.mm']) {
    assert.match(
      heavySources,
      new RegExp(`src/raytracing/${backend.replace('.', '\\.')}`),
      `${backend} must remain covered by the opt-in RT compile path`,
    );
  }

  assert.match(
    runtime,
    /#include "raytracing\/bindings\.h"/u,
    'the runtime must know the public raytracing surface in every build',
  );
  assert.doesNotMatch(
    runtime,
    /#ifdef MYSTRAL_HAS_RAYTRACING\s+#include "raytracing\/bindings\.h"/u,
    'binding declarations must not be hidden behind the heavy backend flag',
  );

  const setupStart = runtime.indexOf('void setupRayTracing()');
  const setupEnd = runtime.indexOf('\n    void processPendingDracoCallbacks()', setupStart);
  assert.ok(setupStart >= 0 && setupEnd > setupStart, 'ray tracing setup function is missing');
  const setup = runtime.slice(setupStart, setupEnd);
  assert.match(setup, /rt::initializeRTBindings\(jsEngine_\.get\(\)\)/u);
  assert.doesNotMatch(setup, /#ifdef MYSTRAL_HAS_RAYTRACING/u);

  const shutdownStart = runtime.indexOf('// Clean up ray tracing resources');
  const shutdownEnd = runtime.indexOf('// Shutdown async HTTP client', shutdownStart);
  assert.ok(shutdownStart >= 0 && shutdownEnd > shutdownStart, 'ray tracing cleanup is missing');
  const shutdown = runtime.slice(shutdownStart, shutdownEnd);
  assert.match(shutdown, /rt::cleanupRTBindings\(\)/u);
  assert.doesNotMatch(shutdown, /#ifdef MYSTRAL_HAS_RAYTRACING/u);

  assert.match(bindings, /setGlobalProperty\("mystralRT", mystralRT\)/u);
  assertNativeRayTracingGate(bindings);
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
  assert.match(scene, /navigator\.gpu/u);
  assert.match(scene, /WEB_RAY_TRACING_FEATURE/u);
  assert.match(scene, /globalThis\.mystralRT/u);
  assert.match(scene, /TN_NATIVE_RAYTRACING_UNAVAILABLE/u);
  assert.match(scene, /native raytracing refusal:/u);
});
