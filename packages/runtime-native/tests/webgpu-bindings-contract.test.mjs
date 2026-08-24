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
    '"createSampler",',
    "// device.createBindGroupLayout(descriptor)",
  );
  const bindGroup = blockBetween(
    candidate,
    '"createBindGroup",',
    "// device.createPipelineLayout(descriptor)",
  );

  assert.match(
    sampler,
    /WGPUSampler sampler = wgpuDeviceCreateSampler\(state->device, &samplerDesc\);[\s\S]*?if \(!sampler\) \{[\s\S]*?state->engine->throwException\("Failed to create sampler"\);[\s\S]*?return state->engine->newUndefined\(\);/u,
    "createSampler must throw immediately when the native handle is null",
  );
  assert.match(
    bindGroup,
    /WGPUBindGroup bindGroup = wgpuDeviceCreateBindGroup\(state->device, &bgDesc\);[\s\S]*?if \(!bindGroup\) \{[\s\S]*?state->engine->throwException\("Failed to create bind group"\);[\s\S]*?return state->engine->newUndefined\(\);/u,
    "createBindGroup must throw immediately when the native handle is null",
  );
}

function assertBindGroupViewOwnership(candidate) {
  const bindGroup = blockBetween(
    candidate,
    '"createBindGroup",',
    "// device.createPipelineLayout(descriptor)",
  );

  assert.match(
    bindGroup,
    /auto releaseAutoCreatedViews = \[&autoCreatedViews\]\(\) \{\s*for \(auto v : autoCreatedViews\) \{\s*wgpuTextureViewRelease\(v\);\s*\}\s*\};/u,
    "createBindGroup must own its automatically created views locally",
  );

  const failureStart = bindGroup.indexOf("if (!bindGroup) {");
  const failureRelease = bindGroup.indexOf("releaseAutoCreatedViews();", failureStart);
  const failureReturn = bindGroup.indexOf("return state->engine->newUndefined();", failureStart);
  const successRelease = bindGroup.indexOf("releaseAutoCreatedViews();", failureRelease + 1);
  const wrapperCreation = bindGroup.indexOf("auto jsBindGroup = state->engine->newObject();");

  assert.ok(failureStart >= 0, "createBindGroup must check the native handle");
  assert.ok(failureRelease > failureStart, "the failure path must release every created view");
  assert.ok(failureRelease < failureReturn, "view cleanup must precede the error return");
  assert.ok(successRelease > failureReturn, "the successful path must retain its view cleanup");
  assert.ok(
    successRelease < wrapperCreation,
    "successful ownership must be released before wrapping",
  );
}

function assertNullResourceValidation(candidate) {
  const bindGroup = blockBetween(
    candidate,
    '"createBindGroup",',
    "// device.createPipelineLayout(descriptor)",
  );

  assert.ok(
    bindGroup.includes(
      "if (state->engine->isUndefined(resource) || state->engine->isNull(resource)) {",
    ),
    "a valid layout must not accept a null or undefined resource",
  );
  assert.ok(
    bindGroup.includes(
      'return failResource("resource", "resource handle is null or undefined", bgEntry.binding);',
    ),
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
    bindGroup.includes(
      'return failResource("texture view", "native handle is null", bgEntry.binding);',
    ),
    "a null texture-view handle must fail at bind-group creation",
  );
  assert.ok(
    bindGroup.includes(
      'return failResource("resource", "native handle is null", bgEntry.binding);',
    ),
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
    '"createBindGroup",',
    "// device.createPipelineLayout(descriptor)",
  );

  assert.throws(
    () =>
      assert.ok(
        bindGroup.includes(
          'return failResource("sampler", "native handle is null", bgEntry.binding);',
        ),
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
    /(WGPUSampler sampler = wgpuDeviceCreateSampler\(state->device, &samplerDesc\);)\n\s*if \(!sampler\) \{[\s\S]*?state->engine->throwException\("Failed to create sampler"\);[\s\S]*?return state->engine->newUndefined\(\);\n\s*\}/u,
    "$1",
  );
  const withoutBindGroupCheck = source.replace(
    /(WGPUBindGroup bindGroup = wgpuDeviceCreateBindGroup\(state->device, &bgDesc\);)\n\s*if \(!bindGroup\) \{[\s\S]*?state->engine->throwException\("Failed to create bind group"\);[\s\S]*?return state->engine->newUndefined\(\);\n\s*\}/u,
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

function assertCanvasRegistrationTable(candidate) {
  assert.match(
    candidate,
    /bindingTable\(canvasContext, \{[\s\S]*\{"GPUCanvasContext", "configure"[\s\S]*\{"GPUCanvasContext", "unconfigure"[\s\S]*\{"GPUCanvasContext", "getCurrentTexture"/u,
    "canvas context API surface must be represented by one registration table",
  );
  assert.match(candidate, /installBindingTable\(\s*state->engine,\s*state,\s*bindingTable\(canvasContext/u);
}

function assertRowOwnedDestinations(header, implementation) {
  assert.match(header, /using BindingOwnerResolver = std::function<js::JSValueHandle\(/u);
  assert.match(header, /BindingOwnerResolver owner;/u);
  assert.doesNotMatch(
    header,
    /js::JSValueHandle owner,\s*const BindingRegistration\*/u,
  );
  assert.match(implementation, /const auto owner = registration\.owner\(state\);/u);
  assert.match(
    implementation,
    /if \(engine->isNull\(owner\) \|\| engine->isUndefined\(owner\)\)/u,
  );
  assert.match(implementation, /std::string_view\(registration\.surface\)/u);
  assert.match(implementation, /registration\.owner = \{\};/u);
  assert.match(implementation, /engine->setProperty\(\s*owner,/u);
}

test("each binding row owns its destination and mismatches fail closed", () => {
  const header = read("include/mystral/webgpu/registration_table.h");
  const implementation = read("src/webgpu/registration_table.cpp");
  assert.doesNotThrow(() => assertRowOwnedDestinations(header, implementation));

  const withoutRowResolver = implementation.replace(
    "registration.owner(state)",
    "engine->getGlobal()",
  );
  assert.throws(
    () => assertRowOwnedDestinations(header, withoutRowResolver),
  );
});

test("canvas context registration is table-driven and deletion is a red mutation", () => {
  const bindings = read("src/webgpu/bindings.cpp");
  const table = read("src/webgpu/registration_table.cpp");
  assert.match(table, /for \(const auto& registration : table\.registrations\)/u);
  assert.match(table, /\[engine, state, registration\]/u);
  assert.match(table, /bool requireArguments\(/u);
  assert.doesNotThrow(() => assertCanvasRegistrationTable(bindings));

  const withoutGetCurrentTexture = bindings.replace(
    /\s*\{"GPUCanvasContext", "getCurrentTexture", 0, nullptr,[\s\S]*?\n\s*\}\},/u,
    "",
  );
  assert.throws(() => assertCanvasRegistrationTable(withoutGetCurrentTexture));
});

const migratedRegistrationFamilies = {
  Document: ["querySelector", "createElement"],
  HTMLElement: [
    "appendChild",
    "removeChild",
    "remove",
    "addEventListener",
    "removeEventListener",
  ],
  HTMLCanvasElement: [
    "getContext",
    "addEventListener",
    "removeEventListener",
    "dispatchEvent",
    "requestPointerLock",
    "toDataURL",
    "getBoundingClientRect",
  ],
  GPU: ["requestAdapter", "getPreferredCanvasFormat"],
  GPUAdapter: ["requestDevice"],
  GPUSupportedFeatures: ["has"],
  GPUDevice: [
    "destroy",
    "createBuffer",
    "createShaderModule",
    "createRenderPipeline",
    "createComputePipeline",
    "createCommandEncoder",
    "createTexture",
    "createSampler",
    "createBindGroupLayout",
    "createBindGroup",
    "createPipelineLayout",
    "createTextureView",
    "createRenderBundleEncoder",
    "pushErrorScope",
    "popErrorScope",
  ],
  GPUQueue: [
    "submit",
    "writeBuffer",
    "writeTexture",
    "copyExternalImageToTexture",
    "onSubmittedWorkDone",
  ],
  GPUBuffer: ["mapAsync", "getMappedRange", "unmap", "destroy"],
  GPUCommandEncoder: [
    "beginRenderPass",
    "beginComputePass",
    "copyBufferToBuffer",
    "copyBufferToTexture",
    "copyTextureToBuffer",
    "copyTextureToTexture",
    "clearBuffer",
    "finish",
  ],
  GPURenderPassEncoder: [
    "setPipeline",
    "setBindGroup",
    "draw",
    "setVertexBuffer",
    "setIndexBuffer",
    "drawIndexed",
    "drawIndirect",
    "drawIndexedIndirect",
    "setViewport",
    "setScissorRect",
    "setBlendConstant",
    "setStencilReference",
    "executeBundles",
    "end",
  ],
  GPUComputePassEncoder: ["setPipeline", "setBindGroup", "dispatchWorkgroups", "end"],
  GPURenderBundleEncoder: [
    "setPipeline",
    "setVertexBuffer",
    "setIndexBuffer",
    "setBindGroup",
    "draw",
    "drawIndexed",
    "finish",
  ],
  GPUTexture: ["createView", "destroy"],
  WebGPU: ["__decodeImageData", "__nativeGetContext2D", "createOffscreenCanvas2D", "loadGLTF"],
};

function assertMigratedRegistrationRows(candidate) {
  const rowKeys = new Set(
    [
      ...candidate.matchAll(
        /\{"(Document|HTMLElement|HTMLCanvasElement|GPU|GPUAdapter|GPUSupportedFeatures|GPUDevice|GPUQueue|GPUBuffer|GPUCommandEncoder|GPUCanvasContext|GPURenderPassEncoder|GPUComputePassEncoder|GPURenderBundleEncoder|GPUTexture|WebGPU)",\s*"([^"]+)"/gu,
      ),
    ].map((match) => `${match[1]}.${match[2]}`),
  );
  for (const [surface, names] of Object.entries(migratedRegistrationFamilies)) {
    for (const name of names) {
      assert.ok(rowKeys.has(`${surface}.${name}`), `${surface}.${name} must be a table row`);
    }
  }
  assert.match(candidate, /installBindingTable\(\s*state->engine/u);
  assert.doesNotMatch(candidate, /installGlobalBindingTable\(/u);
}

function assertSurfaceInstallerDelegates(candidate) {
  const surfaceInstaller = blockBetween(
    candidate,
    "static bool installWebGPUBindingSurfaces",
    "/** Every migrated WebGPU method is a BindingRegistration row in this table unit. */",
  );
  assert.match(surfaceInstaller, /return installWebGPUBindingTables\(state, engine\);/u);
  assert.doesNotMatch(surfaceInstaller, /BindingRegistration|\[state|newFunction/u);
}

test("all migrated WebGPU registration families use the shared table dispatcher", () => {
  const bindings = read("src/webgpu/bindings.cpp");
  assert.doesNotMatch(bindings, /(?:state->engine|engine)->newFunction\(/u);
  assert.doesNotMatch(
    bindings,
    /(?:state->engine|engine)->setProperty\([\s\S]*?(?:state->engine|engine)->newFunction\(/u,
  );
  assert.doesNotMatch(bindings, /install(?:Global)?Binding\(/u);
  assertSurfaceInstallerDelegates(bindings);
  assertMigratedRegistrationRows(bindings);

  const withoutComputePipeline = bindings.replace(
    /\{"GPUComputePassEncoder", "setPipeline", 0, nullptr,[\s\S]*?wgpuComputePassEncoderSetPipeline[\s\S]*?\n\s*\}\}\)\);/u,
    "",
  );
  assert.throws(
    () => assertMigratedRegistrationRows(withoutComputePipeline),
    /GPUComputePassEncoder\.setPipeline/u,
  );
});

test("texture and pipeline wrapper factories use the shared table dispatcher", () => {
  const factories = read("src/webgpu/wrapper_factories.cpp");
  assert.match(factories, /#include "mystral\/webgpu\/registration_table\.h"/u);
  assert.match(factories, /installBindingTable\(/u);
  for (const key of [
    '"GPUTexture", "createView"',
    '"GPUTexture", "destroy"',
  ]) {
    assert.match(factories, new RegExp(`\\{${key}`, "u"));
  }
  assert.match(
    factories,
    /const char\* pipelineSurface = renderPipeline \? "GPURenderPipeline" : "GPUComputePipeline"/u,
  );
  assert.match(factories, /\{pipelineSurface, "getBindGroupLayout"/u);
  assert.doesNotMatch(factories, /newFunction\(/u);

  const directRegistration = factories.replaceAll("installBindingTable(", "directRegistration(");
  assert.throws(
    () => assert.match(directRegistration, /installBindingTable\(/u),
    /installBindingTable/u,
  );
});

test("windowed and offscreen wrappers share factories", () => {
  const bindings = read("src/webgpu/bindings.cpp");
  const factories = read("src/webgpu/wrapper_factories.cpp");
  assert.equal((bindings.match(/createTextureWrapper\(/gu) ?? []).length, 2);
  assert.match(bindings, /createPipelineWrapper\(state, pipeline, pipelineId, true\)/u);
  assert.match(bindings, /createPipelineWrapper\(state, pipeline, pipelineId, false\)/u);
  assert.match(factories, /createTextureWrapper\(/u);
  assert.match(factories, /createPipelineWrapper\(/u);

  const withoutFactory = bindings.replaceAll(
    "createTextureWrapper(",
    "createWindowTextureWrapper(",
  );
  assert.throws(() => assert.match(withoutFactory, /createTextureWrapper\(/u));
});

test("owned WebGPU binding state is wired to the executable reentrancy proof", () => {
  const cmake = read("CMakeLists.txt");
  const state = read("src/webgpu/bindings_state.h");
  const bindings = read("src/webgpu/bindings.cpp");
  const context = read("src/webgpu/context.cpp");
  const source = read("tests/webgpu_bindings_reentrancy_test.cpp");
  assert.match(
    cmake,
    /threenative-webgpu-bindings-reentrancy-test EXCLUDE_FROM_ALL[\s\S]*webgpu_bindings_reentrancy_test\.cpp/u,
  );
  assert.match(state, /struct BindingsState \{/u);
  assert.match(state, /std::vector<std::unique_ptr<WGPUBlendState>> blendStates;/u);
  assert.doesNotMatch(state, /static\s+std::vector<.*blendStates/u);
  assert.doesNotMatch(bindings, /static\s+std::vector<.*blendStates/u);
  assert.doesNotMatch(context, /static\s+WGPUFeatureName\s+requiredFeatures/u);
  assert.match(source, /Runtime::create\(config\)[\s\S]*Runtime::create\(config\)/u);
  assert.match(source, /getWebGPUBindingsState\(\)[\s\S]*getWebGPUBindingsState\(\)/u);
  assert.match(source, /evalScript\([\s\S]*first[\s\S]*evalScript\([\s\S]*second/u);
  assert.match(source, /native WebGPU bindings reentrancy passed/u);

  const sharedStateMutation = state.replace(
    "std::vector<std::unique_ptr<WGPUBlendState>> blendStates;",
    "static std::vector<std::unique_ptr<WGPUBlendState>> blendStates;",
  );
  assert.throws(
    () => assert.doesNotMatch(sharedStateMutation, /static\s+std::vector<.*blendStates/u),
    /static/u,
  );

  const sharedFeatureMutation = context.replace(
    "WGPUFeatureName requiredFeaturesAndroid[3];",
    "static WGPUFeatureName requiredFeaturesAndroid[3];",
  );
  assert.throws(
    () =>
      assert.doesNotMatch(sharedFeatureMutation, /static\s+WGPUFeatureName\s+requiredFeatures/u),
    /static/u,
  );
});

test("GPU video fallback rejects missing binding state before callback registration", () => {
  const publicHeader = read("include/mystral/video/video_recorder.h");
  const factory = read("src/video/video_recorder.cpp");
  const fallback = read("src/video/gpu_readback_recorder.cpp");
  const cli = read("src/cli/main.cpp");

  assert.match(publicHeader, /VideoRecorder::create\(device, queue, instance, bindingsState\)/u);
  assert.match(publicHeader, /void\* bindingsState\s*\)/u);
  assert.match(factory, /if \(!bindingsState\)[\s\S]*requires an owning WebGPU bindings state/u);
  assert.match(fallback, /if \(!bindingsState_\)[\s\S]*return false;/u);
  assert.match(fallback, /if \(!bindingsState\)[\s\S]*return nullptr;/u);
  assert.match(cli, /VideoRecorder::create\([\s\S]*getWebGPUBindingsState\(\)/u);

  const withoutFactoryGuard = factory.replace(/if \(!bindingsState\) \{[\s\S]*?\n\s*\}/u, "");
  assert.throws(
    () => assert.match(withoutFactoryGuard, /if \(!bindingsState\)/u),
    /bindingsState/u,
  );
});

test("the missing-state video guard is wired to a native executable", () => {
  assert.match(
    read("CMakeLists.txt"),
    /add_executable\(threenative-video-recorder-state-test EXCLUDE_FROM_ALL[\s\S]*video_recorder_state_test\.cpp\)/u,
  );
  assert.match(
    read("tests/video_recorder_state_test.cpp"),
    /native video recorder missing-state guard passed/u,
  );
});
