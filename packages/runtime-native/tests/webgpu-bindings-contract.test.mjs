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

function assertBindGroupViewOwnership(candidate) {
  const bindGroup = blockBetween(
    candidate,
    'g_engine->newFunction("createBindGroup"',
    '// device.createPipelineLayout(descriptor)',
  );

  assert.match(
    bindGroup,
    /auto releaseAutoCreatedViews = \[&autoCreatedViews\]\(\) \{\s*for \(auto v : autoCreatedViews\) \{\s*wgpuTextureViewRelease\(v\);\s*\}\s*\};/u,
    "createBindGroup must own its automatically created views locally",
  );

  const failureStart = bindGroup.indexOf("if (!bindGroup) {");
  const failureRelease = bindGroup.indexOf("releaseAutoCreatedViews();", failureStart);
  const failureReturn = bindGroup.indexOf("return g_engine->newUndefined();", failureStart);
  const successRelease = bindGroup.indexOf("releaseAutoCreatedViews();", failureRelease + 1);
  const wrapperCreation = bindGroup.indexOf("auto jsBindGroup = g_engine->newObject();");

  assert.ok(failureStart >= 0, "createBindGroup must check the native handle");
  assert.ok(failureRelease > failureStart, "the failure path must release every created view");
  assert.ok(failureRelease < failureReturn, "view cleanup must precede the error return");
  assert.ok(successRelease > failureReturn, "the successful path must retain its view cleanup");
  assert.ok(successRelease < wrapperCreation, "successful ownership must be released before wrapping");
}

function assertNullResourceValidation(candidate) {
  const bindGroup = blockBetween(
    candidate,
    'g_engine->newFunction("createBindGroup"',
    '// device.createPipelineLayout(descriptor)',
  );

  assert.ok(
    bindGroup.includes(
      'if (g_engine->isUndefined(resource) || g_engine->isNull(resource)) {',
    ),
    "a valid layout must not accept a null or undefined resource",
  );
  assert.ok(
    bindGroup.includes('return failResource("resource", "resource handle is null or undefined", bgEntry.binding);'),
    "a valid layout must reject a null or undefined resource",
  );
  assert.ok(
    bindGroup.includes('return failResource("buffer", "native handle is null", bgEntry.binding);'),
    "a null buffer handle must fail at bind-group creation",
  );
  assert.ok(
    bindGroup.includes('return failResource("sampler", "native handle is null", bgEntry.binding);'),
    "a null sampler handle must fail at bind-group creation",
  );
  assert.ok(
    bindGroup.includes('return failResource("texture view", "native handle is null", bgEntry.binding);'),
    "a null texture-view handle must fail at bind-group creation",
  );
  assert.ok(
    bindGroup.includes('return failResource("resource", "native handle is null", bgEntry.binding);'),
    "a generic null resource handle must fail at bind-group creation",
  );
  assert.doesNotMatch(bindGroup, /\[WebGPU\] Warning: (Sampler|TextureView|Resource at binding)/u);
}

test("WebGPU creation bindings fail at creation for null native handles", () => {
  const source = read("src/webgpu/bindings.cpp");
  assert.doesNotThrow(() => assertCreationChecks(source));
});

test("bind-group creation releases automatically created views on failure and success", () => {
  const source = read("src/webgpu/bindings.cpp");
  assert.doesNotThrow(() => assertBindGroupViewOwnership(source));
});

test("bind-group creation rejects null sampler, view, buffer, and generic resources", () => {
  const source = read("src/webgpu/bindings.cpp");
  assert.doesNotThrow(() => assertNullResourceValidation(source));
});

test("resource validation contract rejects restoring the warning path", () => {
  const source = read("src/webgpu/bindings.cpp");
  const warningPath = source.replace(
    'return failResource("sampler", "native handle is null", bgEntry.binding);',
    'std::cerr << "[WebGPU] Warning: Sampler at binding " << bgEntry.binding << " is null" << std::endl;',
  );
  const bindGroup = blockBetween(
    warningPath,
    'g_engine->newFunction("createBindGroup"',
    '// device.createPipelineLayout(descriptor)',
  );

  assert.throws(
    () => assert.ok(
      bindGroup.includes('return failResource("sampler", "native handle is null", bgEntry.binding);'),
      "sampler null-resource validation",
    ),
    /sampler null-resource validation/u,
  );
});

test("bind-group ownership contract rejects removing failure-path view cleanup", () => {
  const source = read("src/webgpu/bindings.cpp");
  const withoutFailureCleanup = source.replace(
    /if \(!bindGroup\) \{\n\s*releaseAutoCreatedViews\(\);/u,
    "if (!bindGroup) {",
  );

  assert.throws(() => assertBindGroupViewOwnership(withoutFailureCleanup));
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
