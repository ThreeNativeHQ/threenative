import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

function blockBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function assertCreationChecks(candidate) {
  const sampler = blockBetween(
    candidate,
    'g_engine->newFunction("createSampler"',
    '// device.createBindGroupLayout(descriptor)',
  );
  const bindGroup = blockBetween(
    candidate,
    'g_engine->newFunction("createBindGroup"',
    '// device.createPipelineLayout(descriptor)',
  );

  assert.match(
    sampler,
    /WGPUSampler sampler = wgpuDeviceCreateSampler\(g_device, &samplerDesc\);[\s\S]*?if \(!sampler\) \{[\s\S]*?g_engine->throwException\("Failed to create sampler"\);[\s\S]*?return g_engine->newUndefined\(\);/u,
    "createSampler must throw immediately when the native handle is null",
  );
  assert.match(
    bindGroup,
    /WGPUBindGroup bindGroup = wgpuDeviceCreateBindGroup\(g_device, &bgDesc\);[\s\S]*?if \(!bindGroup\) \{[\s\S]*?g_engine->throwException\("Failed to create bind group"\);[\s\S]*?return g_engine->newUndefined\(\);/u,
    "createBindGroup must throw immediately when the native handle is null",
  );
}

test("WebGPU creation bindings fail at creation for null native handles", () => {
  const source = read("src/webgpu/bindings.cpp");
  assert.doesNotThrow(() => assertCreationChecks(source));
});

test("creation contract rejects deletion of either null-handle check", () => {
  const source = read("src/webgpu/bindings.cpp");
  const withoutSamplerCheck = source.replace(
    /(WGPUSampler sampler = wgpuDeviceCreateSampler\(g_device, &samplerDesc\);)\n\s*if \(!sampler\) \{[\s\S]*?g_engine->throwException\("Failed to create sampler"\);[\s\S]*?return g_engine->newUndefined\(\);\n\s*\}/u,
    "$1",
  );
  const withoutBindGroupCheck = source.replace(
    /(WGPUBindGroup bindGroup = wgpuDeviceCreateBindGroup\(g_device, &bgDesc\);)\n\s*if \(!bindGroup\) \{[\s\S]*?g_engine->throwException\("Failed to create bind group"\);[\s\S]*?return g_engine->newUndefined\(\);\n\s*\}/u,
    "$1",
  );

  assert.throws(() => assertCreationChecks(withoutSamplerCheck), /createSampler/u);
  assert.throws(() => assertCreationChecks(withoutBindGroupCheck), /createBindGroup/u);
});

test("the native null-handle proof is wired as a display-free bindings executable", () => {
  assert.match(
    read("CMakeLists.txt"),
    /add_executable\(threenative-bindings-creation-test EXCLUDE_FROM_ALL\s*tests\/bindings_creation_test\.cpp\)/u,
  );
  assert.match(read("tests/bindings_creation_test.cpp"), /native WebGPU creation bindings passed/u);
});
