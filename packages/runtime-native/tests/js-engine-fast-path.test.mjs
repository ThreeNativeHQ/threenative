import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const v8Engine = readFileSync(
  fileURLToPath(new URL("../src/js/v8_engine.cpp", import.meta.url)),
  "utf8",
);
const quickjsEngine = readFileSync(
  fileURLToPath(new URL("../src/js/quickjs_engine.cpp", import.meta.url)),
  "utf8",
);
const jscEngine = readFileSync(
  fileURLToPath(new URL("../src/js/jsc_engine.mm", import.meta.url)),
  "utf8",
);
const bindings = readFileSync(
  fileURLToPath(new URL("../src/webgpu/bindings.cpp", import.meta.url)),
  "utf8",
);
const wrapperFactories = readFileSync(
  fileURLToPath(new URL("../src/webgpu/wrapper_factories.cpp", import.meta.url)),
  "utf8",
);
const runtime = readFileSync(
  fileURLToPath(new URL("../src/runtime.cpp", import.meta.url)),
  "utf8",
);

test("all engine property writes create ordinary own data properties", () => {
  const v8SetProperty = v8Engine.match(
    /bool setProperty\(JSValueHandle obj,[\s\S]*?\n {4}\}\n\n {4}JSValueHandle getProperty/u,
  )?.[0] ?? "";
  assert.match(v8SetProperty, /CreateDataProperty/u);
  assert.doesNotMatch(v8SetProperty, /setPropertyWithReflect/u);

  const quickjsSetProperty = quickjsEngine.match(
    /bool setProperty\(JSValueHandle obj,[\s\S]*?\n {4}\}\n\n {4}JSValueHandle getProperty/u,
  )?.[0] ?? "";
  assert.match(quickjsSetProperty, /JS_DefinePropertyValueStr/u);
  assert.match(quickjsSetProperty, /JS_PROP_C_W_E/u);
  assert.doesNotMatch(quickjsSetProperty, /JS_SetPropertyStr/u);

  const jscSetProperty = jscEngine.match(
    /bool setProperty\(JSValueHandle obj,[\s\S]*?\n {4}\}\n\n {4}JSValueHandle getProperty/u,
  )?.[0] ?? "";
  assert.match(jscSetProperty, /defineOwnDataProperty/u);
  assert.doesNotMatch(jscSetProperty, /setPropertyWithReflect|JSObjectSetProperty/u);
  assert.match(jscEngine, /objectDefineProperty_[\s\S]*JSValueProtect/u);
  assert.match(jscEngine, /~JSCEngine\(\)[\s\S]*JSValueUnprotect\(context_, objectDefineProperty_\)/u);

  const v8Global = v8Engine.match(
    /bool setGlobalProperty\([\s\S]*?\n {4}\}\n\n {4}JSValueHandle getGlobalProperty/u,
  )?.[0] ?? "";
  const quickjsGlobal = quickjsEngine.match(
    /bool setGlobalProperty\([\s\S]*?\n {4}\}\n\n {4}JSValueHandle getGlobalProperty/u,
  )?.[0] ?? "";
  const jscGlobal = jscEngine.match(
    /bool setGlobalProperty\([\s\S]*?\n {4}\}\n\n {4}JSValueHandle getGlobalProperty/u,
  )?.[0] ?? "";
  assert.match(v8Global, /setPropertyWithReflect/u);
  assert.match(quickjsGlobal, /JS_SetPropertyStr/u);
  assert.match(jscGlobal, /setPropertyWithReflect/u);
});

test("host methods share conditional V8 isolate and context entry", () => {
  assert.match(v8Engine, /class V8EntryScope/u);
  assert.match(v8Engine, /v8::Isolate::GetCurrent\(\) != isolate/u);
  assert.match(v8Engine, /isolate_->GetCurrentContext\(\) != context/u);
  const entryScope = v8Engine.match(
    /class V8EntryScope[\s\S]*?\n\};\n\nclass V8Engine/u,
  )?.[0] ?? "";
  assert.match(entryScope, /v8::HandleScope/u);
  assert.equal(
    (v8Engine.match(/v8::Isolate::Scope isolate_scope/gu) ?? []).length,
    0,
    "host entry must use the conditional isolate scope",
  );
  assert.equal(
    (v8Engine.match(/v8::Context::Scope context_scope/gu) ?? []).length,
    1,
    "only engine construction may use a direct context scope",
  );
  const nativeCallback = v8Engine.match(
    /static void nativeCallback\([\s\S]*?\n {4}\}\n\n {4}\/\/ Weak reference data/u,
  )?.[0] ?? "";
  assert.match(nativeCallback, /V8EntryScope entry_scope\(isolate\)/u);
  assert.match(nativeCallback, /entry_scope\.enterContext\(context\)/u);
});

test("C++-only WebGPU metadata stays out of JavaScript property bags", () => {
  for (const name of [
    "_tnVertexEntryPoint",
    "_tnFragmentEntryPoint",
    "_formatEnum",
    "_createViewTextureId",
  ]) {
    assert.doesNotMatch(bindings, new RegExp(`"${name}"`, "u"));
    assert.doesNotMatch(wrapperFactories, new RegExp(`"${name}"`, "u"));
  }
  assert.match(bindings, /shaderModuleMetadata/u);
  assert.match(bindings, /findTextureInfoByHandle/u);
  assert.match(
    readFileSync(
      fileURLToPath(new URL("../src/runtime-scripts/frame-op-stream.js", import.meta.url)),
      "utf8",
    ),
    /_textureId/u,
  );
});

test("V8 native callbacks borrow local arguments until retention is requested", () => {
  const nativeCallback = v8Engine.match(
    /static void nativeCallback\([\s\S]*?static void nativeMethodCallback/u,
  )?.[0] ?? "";
  assert.doesNotMatch(nativeCallback, /acquirePersistent\(isolate, info\[i\]\)/u);
  assert.match(nativeCallback, /callbackLocalsPool_/u);
  assert.match(v8Engine, /retainHandle\(JSValueHandle value\) override/u);
  assert.doesNotMatch(runtime, /freezeHandle\(callback\)/u);
  assert.ok(
    (runtime.match(/retainHandle\((?:args\[[012]\]|callback)\)/gu) ?? []).length >= 9,
    "every callback stored beyond its native call must be retained",
  );
});

test("shader metadata follows wrapper release with a state-lifetime fallback", () => {
  assert.match(bindings, /registerRelease\(jsShader,[\s\S]*weak_ptr/u);
  assert.match(bindings, /shaderModuleMetadata->release\(\s*shaderModule/u);
  assert.match(bindings, /shaderModuleMetadata->releaseAll/u);
});
