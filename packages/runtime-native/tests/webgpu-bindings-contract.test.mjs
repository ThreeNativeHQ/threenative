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

function handlerBlock(source, handlerName) {
  const startMarker = `static js::JSValueHandle ${handlerName}`;
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing named handler: ${handlerName}`);
  const endMarkers = [
    "\n}\n\nstatic js::JSValueHandle",
    "\n}\n\n/** Every migrated WebGPU method",
  ]
    .map((marker) => source.indexOf(marker, start))
    .filter((index) => index >= 0);
  const end = Math.min(...endMarkers);
  assert.ok(end > start, `unterminated named handler: ${handlerName}`);
  return source.slice(start, end);
}

function handlerForRow(source, surface, name) {
  const row = source.match(
    new RegExp(`\\{"${surface}",\\s*"${name}"[\\s\\S]*?&([A-Za-z_][A-Za-z0-9_]*)`, "u"),
  );
  assert.ok(row, `missing registration row: ${surface}.${name}`);
  return handlerBlock(source, row[1]);
}

function assertCreationChecks(candidate) {
  const sampler = handlerForRow(candidate, "GPUDevice", "createSampler");
  const bindGroup = handlerForRow(candidate, "GPUDevice", "createBindGroup");

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
  const bindGroup = handlerForRow(candidate, "GPUDevice", "createBindGroup");

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
  const bindGroup = handlerForRow(candidate, "GPUDevice", "createBindGroup");

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
    "static js::JSValueHandle tnWebgpuHandler69",
    "\n}\n\nstatic js::JSValueHandle",
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
    /bindingTable\(\{[\s\S]*\{"GPUCanvasContext", "configure"[\s\S]*&configureCanvasContext, canvasContext[\s\S]*\{"GPUCanvasContext", "unconfigure"[\s\S]*canvasContext[\s\S]*\{"GPUCanvasContext", "getCurrentTexture"[\s\S]*canvasContext/u,
    "canvas context API surface must be represented by one registration table",
  );
  assert.match(candidate, /installBindingTable\(\s*state->engine,\s*state,\s*bindingTable\(\{/u);
  assert.doesNotMatch(candidate, /bindingTable\(canvasContext,/u);
}

function assertRowOwnedDestinations(header, implementation) {
  assert.match(header, /using BindingDestination = js::JSValueHandle;/u);
  assert.match(header, /BindingDestination destination;/u);
  assert.doesNotMatch(
    header,
    /js::JSValueHandle owner,\s*std::initializer_list<BindingRegistration>/u,
  );
  assert.match(
    header,
    /BindingTable bindingTable\(\s*std::initializer_list<BindingRegistration>/u,
  );
  assert.match(implementation, /bool validateTable\(/u);
  const invalidTableCheck = blockBetween(
    implementation,
    "if (!table.valid)",
    "if (table.registrations.empty())",
  );
  assert.match(invalidTableCheck, /return false;/u);
  assert.match(implementation, /destinations\.reserve\(/u);
  assert.match(
    implementation,
    /if \(engine->isNull\(destination\) \|\|[\s\S]*?!engine->isObject\(destination\)/u,
  );
  assert.match(implementation, /engine->setProperty\(\s*destination,/u);
  assert.doesNotMatch(implementation, /continue;/u);
  assert.match(implementation, /return false;/u);
}

test("each binding row owns its destination and mismatches fail closed", () => {
  const header = read("include/mystral/webgpu/registration_table.h");
  const implementation = read("src/webgpu/registration_table.cpp");
  assert.doesNotThrow(() => assertRowOwnedDestinations(header, implementation));

  const withoutAtomicPreflight = implementation.replace(
    /if \(!table\.valid\) \{[\s\S]*?return false;\s*\}/u,
    "if (!table.valid) { return true; }",
  );
  assert.throws(
    () => assertRowOwnedDestinations(header, withoutAtomicPreflight),
    /if \(!table\.valid\)/u,
  );
});

test("binding-table installation validates every row before the first property write", () => {
  const implementation = read("src/webgpu/registration_table.cpp");
  const preflight = implementation.slice(
    implementation.indexOf("bool installBindingTable"),
  );
  const writeLoop = preflight.indexOf("for (size_t index = 0;");
  const firstWrite = preflight.indexOf("engine->setProperty(", writeLoop);
  const firstDestinationCheck = preflight.indexOf("destinations.push_back");
  assert.ok(firstDestinationCheck >= 0, "destination preflight must exist");
  assert.ok(writeLoop > firstDestinationCheck, "writes must follow destination validation");
  assert.ok(firstWrite > writeLoop, "property writes must be in the second pass");
  assert.doesNotMatch(preflight.slice(0, writeLoop), /engine->setProperty\(/u);

  const partialInstallMutation = preflight.replace(
    "destinations.push_back(destination);",
    "engine->setProperty(destination, registration.name, engine->newUndefined());",
  );
  assert.throws(
    () => assert.doesNotMatch(partialInstallMutation.slice(0, writeLoop), /engine->setProperty\(/u),
    /engine->setProperty/u,
  );
});

test("binding-table installation is object-only and rolls back failed writes", () => {
  const engine = read("include/mystral/js/engine.h");
  const implementation = read("src/webgpu/registration_table.cpp");

  assert.match(engine, /bool enumerable = false;/u);
  assert.match(engine, /bool configurable = false;/u);
  assert.match(
    engine,
    /virtual bool getPropertyInfo\(JSValueHandle obj, const char\* name, JSPropertyInfo& info\) = 0;/u,
  );
  assert.match(engine, /virtual void releasePropertyInfo\(JSPropertyInfo& info\) = 0;/u);
  assert.match(engine, /virtual bool hasProperty\(JSValueHandle obj, const char\* name\) = 0;/u);
  assert.match(engine, /virtual bool deleteProperty\(JSValueHandle obj, const char\* name\) = 0;/u);
  assert.match(implementation, /!engine->isObject\(destination\)/u);
  assert.match(implementation, /expectedInstalled\.push_back[\s\S]*?engine->setProperty\(/u);
  assert.match(implementation, /getPropertyInfo\(/u);
  assert.match(implementation, /JSPropertyKind::Accessor/u);
  assert.match(implementation, /cannot replace a non-writable property/u);
  assert.match(implementation, /deleteProperty\(/u);
  assert.match(implementation, /rollback final snapshot/u);
  assert.match(implementation, /actual\.enumerable == expected\.enumerable/u);
  assert.match(implementation, /actual\.configurable == expected\.configurable/u);
  assert.match(implementation, /expectedInstalledProperty/u);
  assert.match(implementation, /releasePropertyInfo\(/u);
  assert.match(implementation, /getException\(\)/u);
  assert.doesNotMatch(implementation, /getProperty\(it->destination/u);

  for (const implementationPath of [
    "src/js/v8_engine.cpp",
    "src/js/quickjs_engine.cpp",
    "src/js/jsc_engine.mm",
  ]) {
    const source = read(implementationPath);
    assert.match(source, /bool getPropertyInfo\(JSValueHandle obj, const char\* name, JSPropertyInfo& info\) override/u);
    assert.match(source, /void releasePropertyInfo\(JSPropertyInfo& info\) override/u);
    assert.match(source, /bool hasProperty\(JSValueHandle obj, const char\* name\) override/u);
    assert.match(source, /bool deleteProperty\(JSValueHandle obj, const char\* name\) override/u);
    assert.doesNotMatch(source, /JavaScript property assignment did not create a property/u);
    assert.doesNotMatch(source, /JSValueIsStrictEqual\(context_, stored/u);
  }

});

test("binding-table verification covers the whole table after writes and rollback", () => {
  const implementation = read("src/webgpu/registration_table.cpp");
  const nativeControl = read("tests/webgpu_bindings_reentrancy_test.cpp");
  const writeLoop = blockBetween(
    implementation,
    "for (size_t index = 0; index < table.registrations.size(); ++index)",
    "releaseSnapshots();\n    return true;",
  );

  assert.match(implementation, /std::vector<ExpectedInstalledProperty> expectedInstalled/u);
  assert.match(implementation, /verifyInstalledTable/u);
  assert.match(implementation, /verifySnapshotTable/u);
  assert.match(implementation, /rollback[\s\S]*verifySnapshotTable/u);
  assert.doesNotMatch(writeLoop, /installedPropertyMatches/u);
  assert.match(
    nativeControl,
    /__tnCrossRowSecondProxy[\s\S]*delete __tnCrossRowFirst\.first[\s\S]*whole-table rollback state/u,
  );
  assert.match(
    nativeControl,
    /controlled cross-row rollback failure[\s\S]*binding-table rollback was incomplete[\s\S]*whole-table final rollback verification/u,
  );
});

test("descriptor traversal and ordinary reads preserve proxy exception semantics", () => {
  const engine = read("include/mystral/js/engine.h");
  const v8 = read("src/js/v8_engine.cpp");
  const quickjs = read("src/js/quickjs_engine.cpp");
  const jsc = read("src/js/jsc_engine.mm");
  const nativeControl = read("tests/webgpu_bindings_reentrancy_test.cpp");

  assert.match(engine, /Proxy descriptor and getPrototypeOf traps may run/u);
  assert.match(v8, /reflectGetPrototypeOf_/u);
  assert.doesNotMatch(v8, /current->GetPrototype\(\)/u);
  assert.match(jsc, /reflectGetPrototypeOf_/u);
  assert.doesNotMatch(jsc, /JSObjectGetPrototype\(context_, current\)/u);
  assert.match(quickjs, /JS_IsException\(result\)[\s\S]*capturePendingException\(\)/u);
  assert.match(
    nativeControl,
    /getPrototypeOf\(\)[\s\S]*controlled getPrototypeOf failure[\s\S]*getProperty\(revoked/u,
  );
  assert.match(nativeControl, /self prototype cycle was not detected/u);
  assert.match(nativeControl, /multi-proxy prototype cycle was not detected/u);
  for (const source of [v8, quickjs, jsc]) {
    assert.match(source, /property prototype traversal detected a cycle/u);
  }
});

test("descriptor snapshot ownership is explicit for V8, QuickJS, and JSC", () => {
  const v8 = read("src/js/v8_engine.cpp");
  const quickjs = read("src/js/quickjs_engine.cpp");
  const jsc = read("src/js/jsc_engine.mm");
  const nativeControl = read("tests/webgpu_bindings_reentrancy_test.cpp");

  assert.match(v8, /void releasePropertyInfo\([\s\S]*frameHandles_\.erase/u);
  assert.match(quickjs, /void releasePropertyInfo\([\s\S]*JS_FreeValue/u);
  assert.match(jsc, /info\.value\s*=\s*\{\(void\*\)value, context_\};[\s\S]*JSValueProtect/u);
  assert.match(jsc, /void releasePropertyInfo\([\s\S]*JSValueUnprotect/u);
  assert.match(jsc, /reflectSet_[\s\S]*JSValueProtect/u);
  assert.match(jsc, /replaceLastException\([\s\S]*JSValueProtect/u);
  assert.match(jsc, /getException\(\)[\s\S]*JSValueUnprotect/u);
  assert.match(jsc, /~JSCEngine\(\)[\s\S]*clearLastException/u);
  assert.doesNotMatch(
    blockBetween(jsc, "bool setProperty(JSValueHandle obj", "JSValueHandle getProperty"),
    /JSObjectSetProperty/u,
  );
  assert.match(
    nativeControl,
    /setProperty\(revoked[\s\S]*engine->gc\(\);[\s\S]*engine->getException\(\)/u,
  );
});

test("QuickJS teardown discards jobs that capture runtime-owned binding state", () => {
  const quickjs = read("src/js/quickjs_engine.cpp");
  const nativeControl = read("tests/webgpu_bindings_reentrancy_test.cpp");
  const destructor = blockBetween(
    quickjs,
    "~QuickJSEngine() override",
    "EngineType getType() const override",
  );

  assert.doesNotMatch(destructor, /JS_ExecutePendingJob/u);
  assert.match(nativeControl, /Promise\.resolve\(\)\.then\(\(\) => value\(\)\)/u);
  assert.match(nativeControl, /queued QuickJS callback executed during runtime teardown/u);
});

test("QuickJS centrally replaces and clears owned exception values", () => {
  const quickjs = read("src/js/quickjs_engine.cpp");
  const nativeControl = read("tests/webgpu_bindings_reentrancy_test.cpp");
  const destructor = blockBetween(
    quickjs,
    "~QuickJSEngine() override",
    "EngineType getType() const override",
  );

  assert.match(
    quickjs,
    /void clearLastException\(\)[\s\S]*JS_IsNull\(lastException_\)[\s\S]*JS_IsUndefined\(lastException_\)[\s\S]*JS_FreeValue/u,
  );
  assert.match(
    quickjs,
    /void replaceLastException\(JSValue exception\)[\s\S]*clearLastException\(\)[\s\S]*lastException_ = exception/u,
  );
  assert.equal(
    quickjs.match(/lastException_\s*=/gu)?.length,
    3,
    "only clear, replace, and the member initializer may assign lastException_",
  );
  assert.match(destructor, /clearLastException\(\)[\s\S]*JS_FreeContext/u);
  for (const directReplacement of [
    blockBetween(quickjs, "JSValueHandle evalWithResult", "bool evalScript("),
    blockBetween(quickjs, "JSValueHandle evalScriptWithResult", "// ========================================================================\n    // Global Object Access"),
    blockBetween(quickjs, "JSValueHandle call(", "// ========================================================================\n    // Memory Management"),
  ]) {
    assert.match(directReplacement, /replaceLastException\(exception\)/u);
    assert.doesNotMatch(directReplacement, /lastException_ = exception/u);
  }
  assert.match(
    nativeControl,
    /quickjs-first-unconsumed[\s\S]*quickjs-second-unconsumed[\s\S]*quickjs-call-unconsumed[\s\S]*quickjs-outstanding-at-teardown/u,
  );
});

test("JSC erases only callback keys owned by the engine being destroyed", () => {
  const jsc = read("src/js/jsc_engine.mm");
  const nativeControl = read("tests/webgpu_bindings_reentrancy_test.cpp");
  const destructor = blockBetween(
    jsc,
    "~JSCEngine() override",
    "EngineType getType() const override",
  );
  const newFunction = blockBetween(
    jsc,
    "JSValueHandle newFunction",
    "// ========================================================================\n    // Value Conversion",
  );

  assert.match(jsc, /std::unordered_set<void\*> nativeFunctionKeys_/u);
  assert.match(newFunction, /nativeFunctionKeys_\.insert\(callbackKey\)/u);
  assert.match(destructor, /for \(const auto callbackKey : nativeFunctionKeys_\)[\s\S]*g_nativeFunctions\.erase\(callbackKey\)/u);
  assert.doesNotMatch(destructor, /g_nativeFunctions\.clear/u);
  assert.ok(
    destructor.indexOf("g_nativeFunctions.erase(callbackKey)") <
      destructor.indexOf("JSGlobalContextRelease(context_)"),
    "JSC callback entries must be erased before context release",
  );
  assert.match(jsc, /replaceLastException\([\s\S]*JSValueProtect/u);
  assert.match(jsc, /reflectSet_[\s\S]*JSObjectCallAsFunction/u);
  assert.match(
    nativeControl,
    /Runtime::create\(config\)[\s\S]*replacement\.reset\(\)[\s\S]*surviving engine callback changed after replacement teardown/u,
  );
});

test("dynamic canvas getContext captures its native id instead of the mutable row", () => {
  const bindings = read("src/webgpu/bindings.cpp");
  const reentrancy = read("tests/webgpu_bindings_reentrancy_test.cpp");

  assert.match(bindings, /makeOffscreenCanvasGetContextHandler\(int canvasId\)/u);
  assert.match(bindings, /makeOffscreenCanvasGetContextHandler\(canvasId\)/u);
  const handler = blockBetween(
    bindings,
    "static js::JSValueHandle getOffscreenCanvasContext(",
    "static BindingHandler makeOffscreenCanvasGetContextHandler",
  );
  assert.doesNotMatch(handler, /bindingDestination/u);
  assert.doesNotMatch(handler, /getProperty\(bindingDestination/u);
  assert.match(
    reentrancy,
    /document\.createElement\("canvas"\)[\s\S]*first\.id\s*=\s*second\.id[\s\S]*getContext\("2d"\)/u,
  );

  const withoutDynamicCanvasRow = bindings.replace(
    /makeOffscreenCanvasGetContextHandler\(canvasId\)/u,
    "&tnWebgpuHandler15",
  );
  assert.throws(
    () => assert.match(withoutDynamicCanvasRow, /makeOffscreenCanvasGetContextHandler\(canvasId\)/u),
    /makeOffscreenCanvasGetContextHandler/u,
  );
});

test("canvas context registration is table-driven and deletion is a red mutation", () => {
  const bindings = read("src/webgpu/bindings.cpp");
  const table = read("src/webgpu/registration_table.cpp");
  assert.match(table, /for \(const auto& registration : table\.registrations\)/u);
  assert.match(table, /\[engine, state, registration, destination\]/u);
  assert.match(table, /bool requireArguments\(/u);
  assert.doesNotThrow(() => assertCanvasRegistrationTable(bindings));

  const withoutGetCurrentTexture = bindings.replace(
    /\s*\{"GPUCanvasContext", "getCurrentTexture",[\s\S]*?makeCurrentTextureCanvasContextHandler\(offscreen\), canvasContext\},/u,
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

function assertDeclarativeInstaller(candidate) {
  const start = candidate.indexOf(
    "static bool installWebGPUBindingTables(BindingsState* state, js::Engine* engine) {",
  );
  const end = candidate.indexOf("\n}\n#endif\n\n/** Initialize", start);
  assert.ok(start >= 0 && end > start, "WebGPU table installer must have a bounded source block");
  const installer = candidate.slice(start, end);
  assert.doesNotMatch(
    installer,
    /\[[^\]]*\]\(BindingsState/u,
    "WebGPU table installer must not contain inline handlers",
  );
  assert.match(installer, /installBindingTable\(\s*state->engine\s*,\s*state\s*,/u);
  assert.match(installer, /\{"HTMLElement",\s*"appendChild"[\s\S]*&[A-Za-z_][A-Za-z0-9_]*/u);
  assert.match(installer, /bindingTable\(\{/u);
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
  assertDeclarativeInstaller(bindings);
  assertMigratedRegistrationRows(bindings);

  const inlineHandlerMutation = bindings.replace(
    "&tnWebgpuHandler20",
    "[state](BindingsState*, BindingDestination, const std::vector<js::JSValueHandle>&) { return state->engine->newUndefined(); }",
  );
  assert.throws(
    () => assertDeclarativeInstaller(inlineHandlerMutation),
    /WebGPU table installer/u,
  );

  const withoutComputePipeline = bindings.replace(
    /\s*\{"GPUComputePassEncoder", "setPipeline",[\s\S]*?&[A-Za-z_][A-Za-z0-9_]*\s*,\s*jsComputePass\},/u,
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
  assert.match(state, /std::vector<js::JSValueHandle> protectedHandles;/u);
  assert.match(state, /std::vector<std::unique_ptr<canvas::Canvas2DContext>> canvas2DContexts;/u);
  assert.match(bindings, /for \(auto it = state->protectedHandles\.rbegin\(\)/u);
  assert.match(bindings, /engine->unprotect\(\*it\)/u);
  assert.match(bindings, /state->canvas2DContexts\.clear\(\)/u);
  assert.match(bindings, /createOwnedCanvas2DContext\(/u);
  assert.doesNotMatch(bindings, /canvas::createCanvas2DContext\(state->engine/u);
  assert.match(source, /protectedHandles\.size\(\)/u);
  assert.match(state, /std::vector<std::unique_ptr<WGPUBlendState>> blendStates;/u);
  assert.doesNotMatch(state, /static\s+std::vector<.*blendStates/u);
  assert.doesNotMatch(bindings, /static\s+std::vector<.*blendStates/u);
  assert.doesNotMatch(read("src/js/v8_engine.cpp"), /g_protectedHandles/u);
  const quickjs = read("src/js/quickjs_engine.cpp");
  assert.doesNotMatch(quickjs, /g_protectedHandles/u);
  assert.doesNotMatch(
    blockBetween(quickjs, "void protect(JSValueHandle value)", "void unprotect(JSValueHandle value)"),
    /JS_DupValue/u,
  );
  const canvas2d = read("src/canvas/canvas2d_bindings.cpp");
  assert.doesNotMatch(canvas2d, /g_canvas2dContexts|g_jsEngine/u);
  assert.doesNotMatch(canvas2d, /engine->protect\(jsCtx\)/u);
  assert.match(source, /__tnEngineLocalCanvasContext\.fillRect/u);
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
