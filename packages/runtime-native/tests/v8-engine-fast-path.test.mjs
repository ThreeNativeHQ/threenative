import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const v8Engine = readFileSync(
  fileURLToPath(new URL("../src/js/v8_engine.cpp", import.meta.url)),
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

test("bridge-owned writes bypass Reflect and inherited setters", () => {
  const setProperty = v8Engine.match(
    /bool setProperty\(JSValueHandle obj,[\s\S]*?\n    \}\n\n    JSValueHandle getProperty/u,
  )?.[0] ?? "";
  assert.match(setProperty, /CreateDataProperty/u);
  assert.doesNotMatch(setProperty, /setPropertyWithReflect/u);
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
    /static void nativeCallback\([\s\S]*?\n    \}\n\n    \/\/ Weak reference data/u,
  )?.[0] ?? "";
  assert.match(nativeCallback, /V8EntryScope entry_scope\(isolate\)/u);
  assert.match(nativeCallback, /entry_scope\.enterContext\(context\)/u);
});

test("C++-only WebGPU metadata stays out of JavaScript property bags", () => {
  for (const name of [
    "_tnVertexEntryPoint",
    "_tnFragmentEntryPoint",
    "_textureId",
    "_formatEnum",
    "_createViewTextureId",
  ]) {
    assert.doesNotMatch(bindings, new RegExp(`"${name}"`, "u"));
    assert.doesNotMatch(wrapperFactories, new RegExp(`"${name}"`, "u"));
  }
  assert.match(bindings, /shaderModuleMetadata/u);
  assert.match(bindings, /findTextureInfoByHandle/u);
});
