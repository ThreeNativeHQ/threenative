import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import { runNativeBehavior } from "../scripts/run-native-behavior.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const behaviorContract = process.env.TN_NATIVE_BEHAVIOR_CONTRACT;

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
  const wrapperCreation = bindGroup.indexOf("auto jsBindGroup = createNativeWrapper(");
  assert.ok(failureStart >= 0, "createBindGroup must check the native handle");
  assert.ok(failureRelease > failureStart, "the failure path must release every created view");
  assert.ok(failureRelease < failureReturn, "view cleanup must precede the error return");
  assert.ok(successRelease > failureReturn, "the successful path must retain its view cleanup");
  assert.ok(successRelease < wrapperCreation, "successful ownership must be released before wrapping");
}

function assertNullResourceValidation(candidate) {
  const bindGroup = handlerForRow(candidate, "GPUDevice", "createBindGroup");
  assert.ok(
    bindGroup.includes(
      "if (state->engine->isUndefined(resource) || state->engine->isNull(resource)) {",
    ),
    "a valid layout must not accept a null or undefined resource",
  );
  for (const failure of [
    'return failResource("resource", "resource handle is null or undefined", bgEntry.binding);',
    'return failResource("buffer", "native handle is null", bgEntry.binding);',
    'return failResource("sampler", "native handle is null", bgEntry.binding);',
    'return failResource("texture view", "native handle is null", bgEntry.binding);',
    'return failResource("resource", "native handle is null", bgEntry.binding);',
  ]) {
    assert.ok(bindGroup.includes(failure), `missing fail-closed resource path: ${failure}`);
  }
  assert.doesNotMatch(bindGroup, /\[WebGPU\] Warning: (Sampler|TextureView|Resource at binding)/u);
}

test("bind-group creation releases automatically created views on failure and success", () => {
  assert.doesNotThrow(() => assertBindGroupViewOwnership(read("src/webgpu/bindings.cpp")));
});

test("bind-group creation rejects null sampler, view, buffer, and generic resources", () => {
  assert.doesNotThrow(() => assertNullResourceValidation(read("src/webgpu/bindings.cpp")));
});

test("resource validation contract rejects restoring the warning path", () => {
  const warningPath = read("src/webgpu/bindings.cpp").replace(
    'return failResource("sampler", "native handle is null", bgEntry.binding);',
    'std::cerr << "[WebGPU] Warning: Sampler is null" << std::endl;',
  );
  assert.throws(() => assertNullResourceValidation(warningPath));
});

test("bind-group ownership contract rejects removing failure-path view cleanup", () => {
  const withoutFailureCleanup = read("src/webgpu/bindings.cpp").replace(
    /if \(!bindGroup\) \{\n\s*releaseAutoCreatedViews\(\);/u,
    "if (!bindGroup) {",
  );
  assert.throws(() => assertBindGroupViewOwnership(withoutFailureCleanup));
});

function assertBindGroupNativeResultCheck(candidate) {
  const bindGroup = handlerForRow(candidate, "GPUDevice", "createBindGroup");
  assert.match(
    bindGroup,
    /WGPUBindGroup bindGroup = wgpuDeviceCreateBindGroup\(state->device, &bgDesc\);[\s\S]*?if \(!bindGroup\) \{[\s\S]*?state->engine->throwException\("Failed to create bind group"\);[\s\S]*?return state->engine->newUndefined\(\);/u,
    "native bind-group creation failure must not escape as a wrapper",
  );
}

test("bind-group creation retains its post-call null native-handle guard", () => {
  assert.doesNotThrow(() => assertBindGroupNativeResultCheck(read("src/webgpu/bindings.cpp")));
});

test("bind-group native-result contract rejects deleting the post-call guard", () => {
  const withoutGuard = read("src/webgpu/bindings.cpp").replace(
    /(WGPUBindGroup bindGroup = wgpuDeviceCreateBindGroup\(state->device, &bgDesc\);)\n\s*if \(!bindGroup\) \{[\s\S]*?state->engine->throwException\("Failed to create bind group"\);[\s\S]*?return state->engine->newUndefined\(\);\n\s*\}/u,
    "$1",
  );
  assert.throws(() => assertBindGroupNativeResultCheck(withoutGuard));
});

test("all JS engines expose owned destination and descriptor controls", () => {
  const engine = read("include/mystral/js/engine.h");

  assert.match(engine, /bool enumerable = false;/u);
  assert.match(engine, /bool configurable = false;/u);
  assert.match(
    engine,
    /virtual bool getPropertyInfo\(JSValueHandle obj, const char\* name, JSPropertyInfo& info\) = 0;/u,
  );
  assert.match(engine, /virtual void releasePropertyInfo\(JSPropertyInfo& info\) = 0;/u);
  assert.match(engine, /virtual bool hasProperty\(JSValueHandle obj, const char\* name\) = 0;/u);
  assert.match(engine, /virtual bool deleteProperty\(JSValueHandle obj, const char\* name\) = 0;/u);
  assert.match(
    engine,
    /virtual bool isBindingDestination\(JSValueHandle value\) = 0;/u,
  );
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
    assert.match(source, /bool isBindingDestination\(JSValueHandle value\) override/u);
    assert.doesNotMatch(source, /JavaScript property assignment did not create a property/u);
    assert.doesNotMatch(source, /JSValueIsStrictEqual\(context_, stored/u);
  }
});

test("binding destination ownership is unforgeable from JavaScript", () => {
  const v8 = read("src/js/v8_engine.cpp");
  const quickjs = read("src/js/quickjs_engine.cpp");
  const jsc = read("src/js/jsc_engine.mm");

  assert.match(v8, /bindingDestinationKey_\.Reset\(isolate_, v8::Private::New/u);
  assert.match(v8, /local->IsProxy\(\)/u);
  assert.match(quickjs, /JS_NewClassID\(runtime_, &bindingDestinationClassId_\)/u);
  assert.match(quickjs, /JS_NewObjectProtoClass\(/u);
  assert.match(quickjs, /JS_GetClassID\(object\) != bindingDestinationClassId_/u);
  assert.doesNotMatch(quickjs, /bindingDestinationMarker_|JS_NewSymbol/u);
  assert.match(jsc, /JSValueIsObjectOfClass\(context_, object, ordinaryObjectClass_\)/u);
  assert.match(jsc, /JSObjectSetPrototype\(context_, object, objectPrototype_\)/u);

  const destinationBlocks = [
    blockBetween(v8, "bool isBindingDestination", "bool isSameValue"),
    blockBetween(quickjs, "bool isBindingDestination", "bool isSameValue"),
    blockBetween(jsc, "bool isBindingDestination", "bool isSameValue"),
  ];
  for (const destinationBlock of destinationBlocks) {
    assert.doesNotMatch(
      destinationBlock,
      /context->Global|JS_GetGlobalObject|JSContextGetGlobalObject/u,
      "an exotic global object must not be a binding destination",
    );
  }
});

test("binding destinations reject proxies before descriptor traversal", () => {
  const engine = read("include/mystral/js/engine.h");
  const v8 = read("src/js/v8_engine.cpp");
  const quickjs = read("src/js/quickjs_engine.cpp");
  const jsc = read("src/js/jsc_engine.mm");
  const nativeControl = read("tests/webgpu_bindings_reentrancy_test.cpp");

  assert.match(engine, /side-effect-free binding destination/u);
  assert.match(v8, /IsProxy\(\)/u);
  assert.match(quickjs, /JS_IsProxy/u);
  assert.match(jsc, /JSValueIsObjectOfClass/u);
  assert.match(nativeControl, /a rejected proxy descriptor trap ran/u);
  assert.match(nativeControl, /a rejected proxy set trap ran/u);
  assert.match(nativeControl, /getProperty\(revoked/u);
});

test("descriptor snapshot ownership is explicit for V8, QuickJS, and JSC", () => {
  const implementation = read("src/webgpu/registration_table.cpp");
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
  assert.match(
    implementation,
    /engine->freezeHandle\(function\)[\s\S]*protectedExpectedValues\.push_back\(function\)/u,
  );
  assert.match(
    implementation,
    /for \(auto it = protectedExpectedValues\.rbegin\(\)[\s\S]*engine->freeHandle\(\*it\)/u,
  );
  assert.doesNotMatch(
    blockBetween(jsc, "bool setProperty(JSValueHandle obj", "JSValueHandle getProperty"),
    /JSObjectSetProperty/u,
  );
  assert.match(
    nativeControl,
    /setProperty\(revoked[\s\S]*engine->gc\(\);[\s\S]*engine->getException\(\)/u,
  );
});

test("QuickJS teardown does not execute pending binding callbacks", () => {
  const quickjs = read("src/js/quickjs_engine.cpp");
  const nativeControl = read("tests/webgpu_bindings_reentrancy_test.cpp");
  const destructor = blockBetween(
    quickjs,
    "~QuickJSEngine() override",
    "EngineType getType() const override",
  );

  assert.doesNotMatch(destructor, /JS_ExecutePendingJob/u);
  assert.match(nativeControl, /queued QuickJS callback executed during runtime teardown/u);
});

function behaviorExecutable(body) {
  const directory = mkdtempSync(join(tmpdir(), "tn-native-behavior-"));
  const path = join(directory, "probe.mjs");
  writeFileSync(path, `${body}\n`);
  return path;
}

test.runIf(!behaviorContract || behaviorContract === "webgpu")(
  "native behavior preserves binding transactions and active wrapper state",
  () => {
  const productExecutable = process.env.TN_NATIVE_BEHAVIOR_EXECUTABLE;
  const fixture = behaviorExecutable(`
    console.log("proof: public-binding-surface");
    console.log("proof: whole-table-verification");
    console.log("proof: wrapper-rollback");
  `);
  const executable = productExecutable ?? process.execPath;
  const args = productExecutable ? [] : [fixture];
  const result = runNativeBehavior(
    executable,
    ["public-binding-surface", "whole-table-verification", "wrapper-rollback"],
    args,
  );
  assert.deepEqual(result.proofs, [
    "public-binding-surface",
    "whole-table-verification",
    "wrapper-rollback",
  ]);
  },
);

test.runIf(!behaviorContract || behaviorContract === "creation")(
  "WebGPU creation rejects invalid sampler and bind-group handles at the API call",
  () => {
    const productExecutable = process.env.TN_NATIVE_BEHAVIOR_EXECUTABLE;
    const fixture = behaviorExecutable('console.log("proof: creation-refusal");');
    const result = runNativeBehavior(
      productExecutable ?? process.execPath,
      ["creation-refusal"],
      productExecutable ? [] : [fixture],
    );
    assert.deepEqual(result.proofs, ["creation-refusal"]);
  },
);

test.runIf(!behaviorContract || behaviorContract === "command-encoder")(
  "GPUCommandEncoder installs its table once per class, not per call",
  () => {
    const productExecutable = process.env.TN_NATIVE_BEHAVIOR_EXECUTABLE;
    const fixture = behaviorExecutable('console.log("proof: command-encoder-class-table");');
    const result = runNativeBehavior(
      productExecutable ?? process.execPath,
      ["command-encoder-class-table"],
      productExecutable ? [] : [fixture],
    );
    assert.deepEqual(result.proofs, ["command-encoder-class-table"]);
  },
);

test.runIf(!behaviorContract || behaviorContract === "render-pass")(
  "GPURenderPassEncoder installs once per class and resolves its paired encoder",
  () => {
    const productExecutable = process.env.TN_NATIVE_BEHAVIOR_EXECUTABLE;
    const fixture = behaviorExecutable('console.log("proof: render-pass-class-table");');
    const result = runNativeBehavior(
      productExecutable ?? process.execPath,
      ["render-pass-class-table"],
      productExecutable ? [] : [fixture],
    );
    assert.deepEqual(result.proofs, ["render-pass-class-table"]);
  },
);

test("wrapper rollback behavior proof fails closed", () => {
  const missing = behaviorExecutable('console.log("native executable passed");');
  assert.throws(
    () => runNativeBehavior(process.execPath, ["wrapper-rollback"], [missing]),
    /native behavior proof is missing: wrapper-rollback/u,
  );

  const duplicate = behaviorExecutable(`
    console.log("proof: wrapper-rollback");
    console.log("proof: wrapper-rollback");
  `);
  assert.throws(
    () => runNativeBehavior(process.execPath, ["wrapper-rollback"], [duplicate]),
    /native behavior proof is duplicated: wrapper-rollback/u,
  );
});

test("QuickJS callback result tests cover transfer and protected duplication on both engines", () => {
  const nativeControl = read("tests/webgpu_bindings_reentrancy_test.cpp");

  assert.match(nativeControl, /unprotected-result/u);
  assert.match(nativeControl, /protected-result/u);
  assert.match(
    nativeControl,
    /checkQuickJSCallbackResultOwnership\(\*first\)[\s\S]*checkQuickJSCallbackResultOwnership\(\*second\)/u,
  );
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
  assert.match(
    quickjs,
    /JSValue takeNativeCallbackException\(\)[\s\S]*lastException_ = JS_UNDEFINED/u,
  );
  assert.equal(
    quickjs.match(/lastException_\s*=/gu)?.length,
    4,
    "only clear, replace, takeNativeCallbackException, and the member initializer may assign lastException_",
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

test("JSC native callbacks use callable private data with owner-qualified lifetime", () => {
  const jsc = read("src/js/jsc_engine.mm");
  const nativeControl = read("tests/webgpu_bindings_reentrancy_test.cpp");
  const newFunction = blockBetween(
    jsc,
    "JSValueHandle newFunction",
    "// ========================================================================\n    // Value Conversion",
  );

  assert.doesNotMatch(jsc, /g_nativeFunctions|nativeFunctionKeys_/u);
  assert.match(
    jsc,
    /struct NativeFunctionData[\s\S]*NativeFunction callback[\s\S]*JSGlobalContextRef owner/u,
  );
  assert.match(
    newFunction,
    /JSObjectMake\(\s*context_, nativeFunctionClass_,\s*new NativeFunctionData/u,
  );
  assert.match(jsc, /nativeFunctionDefinition\.finalize = &finalizeNativeFunction/u);
  assert.match(jsc, /nativeFunctionDefinition\.callAsFunction = &nativeCallback/u);
  assert.match(jsc, /JSObjectGetPrivate\(function\)/u);
  assert.match(
    jsc,
    /callbackData->owner != JSContextGetGlobalContext\(ctx\)/u,
  );
  assert.match(jsc, /delete static_cast<NativeFunctionData\*>\(JSObjectGetPrivate\(object\)\)/u);
  assert.match(jsc, /replaceLastException\([\s\S]*JSValueProtect/u);
  assert.match(jsc, /reflectSet_[\s\S]*JSObjectCallAsFunction/u);
  assert.match(
    nativeControl,
    /Runtime::create\(config\)[\s\S]*replacement\.reset\(\)[\s\S]*surviving engine callback changed after replacement teardown/u,
  );
});

test("all engines implement Object.is SameValue and QuickJS performance uses its callback context", () => {
  const v8 = read("src/js/v8_engine.cpp");
  const quickjs = read("src/js/quickjs_engine.cpp");
  const jsc = read("src/js/jsc_engine.mm");
  const nativeControl = read("tests/webgpu_bindings_reentrancy_test.cpp");

  assert.match(v8, /->SameValue\(/u);
  assert.doesNotMatch(
    blockBetween(v8, "bool isSameValue", "// ========================================================================\n    // Object Operations"),
    /StrictEquals/u,
  );
  assert.match(quickjs, /JS_IsSameValue\(context_/u);
  assert.doesNotMatch(quickjs, /engineInstance_/u);
  assert.match(
    quickjs,
    /js_performance_now[\s\S]*JS_GetContextOpaque\(ctx\)[\s\S]*engine->startTime_/u,
  );
  assert.match(jsc, /std::signbit/u);
  assert.match(jsc, /std::isnan/u);
  assert.match(nativeControl, /SameValue rollback verification/u);
  assert.match(
    nativeControl,
    /first\.reset\(\)[\s\S]*performance\.now\(\) > 0[\s\S]*lost its context owner/u,
  );
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
  WebGPU: ["__decodeImageData", "__nativeGetContext2D", "createOffscreenCanvas2D"],
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
  assert.equal(
    installer.match(/installBindingTable\(/gu)?.length,
    installer.match(/if \(!installBindingTable\(/gu)?.length,
    "production initialization must return false for every partial table install",
  );
}

function assertEveryTableInstallIsChecked(candidate) {
  const calls = candidate.match(/installBindingTable\(/gu) ?? [];
  const checked = candidate.match(/if \(!installBindingTable\(/gu) ?? [];
  assert.ok(calls.length > 0, "expected binding-table installation sites");
  assert.equal(
    checked.length,
    calls.length,
    "every dynamic table/factory installation must propagate failure",
  );
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
  assertEveryTableInstallIsChecked(bindings);
  assertMigratedRegistrationRows(bindings);

  const inlineHandlerMutation = bindings.replace(
    "&tnWebgpuHandler20",
    "[state](BindingsState*, BindingDestination, const std::vector<js::JSValueHandle>&) { return state->engine->newUndefined(); }",
  );
  assert.throws(
    () => assertDeclarativeInstaller(inlineHandlerMutation),
    /WebGPU table installer/u,
  );

  const ignoredStaticFailure = bindings.replace(
    "if (!installBindingTable(",
    "installBindingTable(",
  );
  assert.throws(
    () => assertEveryTableInstallIsChecked(ignoredStaticFailure),
    /propagate failure/u,
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
  assertEveryTableInstallIsChecked(factories);

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
  const state = read("src/webgpu/bindings_state.h");
  const bindings = read("src/webgpu/bindings.cpp");
  const context = read("src/webgpu/context.cpp");
  const source = read("tests/webgpu_bindings_reentrancy_test.cpp");
  assert.match(state, /struct BindingsState \{/u);
  assert.match(state, /std::vector<js::JSValueHandle> protectedHandles;/u);
  assert.match(state, /std::vector<std::unique_ptr<canvas::Canvas2DContext>> canvas2DContexts;/u);
  assert.match(bindings, /for \(auto it = state->protectedHandles\.rbegin\(\)/u);
  assert.match(bindings, /engine->freeHandle\(\*it\)/u);
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
    blockBetween(quickjs, "void freezeHandle(JSValueHandle value)", "size_t outstandingHandleCount() const override"),
    /JS_DupValue/u,
  );
  const canvas2d = read("src/canvas/canvas2d_bindings.cpp");
  assert.doesNotMatch(canvas2d, /g_canvas2dContexts|g_jsEngine/u);
  assert.doesNotMatch(canvas2d, /engine->freezeHandle\(jsCtx\)/u);
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

  // The array is sized to the features actually requested; it grew to four when PRD-228 added
  // timestamp-query. The literal is spelled out here on purpose — a stale one makes this
  // negative control a no-op that passes while proving nothing.
  const sharedFeatureMutation = context.replace(
    "WGPUFeatureName requiredFeaturesAndroid[6];",
    "static WGPUFeatureName requiredFeaturesAndroid[6];",
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
