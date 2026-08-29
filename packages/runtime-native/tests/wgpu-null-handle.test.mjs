// A NULL handle from wgpu must throw to JS naming the operation, never reach wgpu-native's FFI.
//
// The executable proof is `tests/wgpu_null_handle_test.cpp`: it forks a child that hands a NULL
// encoder to the real `wgpuCommandEncoderBeginRenderPass` and reports which signal killed it,
// then runs the same NULL through the checked path and asserts the JS exception. That lane needs
// a compiled runtime. These assertions keep the migrated sites migrated in the default gate,
// where a later edit is most likely to quietly re-open one.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import {
  nativeBindingDefinition,
  nativeDefinition,
} from "../../../test-support/native-definition.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

test("the checked-handle helper logs the operation and throws, and never silently continues", () => {
  const source = ["requireHandle", "nullHandleMessage", "reportNullHandle"]
    .map((symbol) => nativeDefinition(symbol).text)
    .join("\n");
  assert.match(
    source,
    /engine->throwException\(nullHandleMessage\(op, args\)\.c_str\(\)\)/u,
    "a NULL handle must throw to JS, matching the already-guarded create sites",
  );
  assert.match(
    source,
    /__android_log_print\(ANDROID_LOG_ERROR/u,
    "logcat is the only place a phone crash can be read from, so the op has to go there",
  );
});

test("every ranked create/begin/finish site is checked before its handle is used", () => {
  // The sites the 2026-08-24 investigation ranked as the plausible source of the six unnamed
  // SIGSEGV exits: the encoder chain, the shader/bind-group family, and the texture views.
  const operations = [
    ["GPUDevice", "createCommandEncoder", "device.createCommandEncoder"],
    ["GPUCommandEncoder", "beginRenderPass", "commandEncoder.beginRenderPass"],
    ["GPUCommandEncoder", "beginComputePass", "commandEncoder.beginComputePass"],
    ["GPUCommandEncoder", "finish", "commandEncoder.finish"],
    ["GPUQueue", "submit", "queue.submit"],
    ["GPUDevice", "createShaderModule", "device.createShaderModule"],
    ["GPUDevice", "createBindGroupLayout", "device.createBindGroupLayout"],
    ["GPUDevice", "createBindGroup", "device.createBindGroup"],
    ["GPUDevice", "createPipelineLayout", "device.createPipelineLayout"],
    ["GPUDevice", "createTextureView", "device.createTextureView"],
    // PRD-207 routes the offscreen-canvas texture through the same `createTextureWrapper`, so
    // `texture.createView` is now the single site that main guarded as two.
    ["GPUTexture", "createView", "texture.createView"],
  ];
  for (const [surface, method, operation] of operations) {
    const source = nativeBindingDefinition(surface, method).text;
    assert.match(
      source,
      new RegExp(`requireHandle\\(state->engine, [^;]*"${operation.replace(/\./gu, "\\.")}"`, "u"),
      `${operation} must check its handle before anything uses it`,
    );
  }
});

test("host-side paths with no JS frame skip the work instead of carrying the NULL", () => {
  const source = ["compositeCanvas2DToWebGPU", "captureFrameScreenshot"]
    .map((symbol) => nativeDefinition(symbol).text)
    .join("\n");
  for (const operation of [
    "canvas2D.createTexture",
    "canvas2DComposite.surfaceView",
    "canvas2DComposite.createCommandEncoder",
    "canvas2DComposite.beginRenderPass",
    "canvas2DComposite.finish",
    "screenshot.createCommandEncoder",
    "screenshot.finish",
  ])
    assert.match(
      source,
      new RegExp(`requireHandleHostSide\\([^;]*"${operation.replace(/\./gu, "\\.")}"`, "u"),
      `${operation} runs outside any JS callback, so it must log and skip rather than throw`,
    );
});

test("queue.submit no longer drops a NULL command buffer on the floor", () => {
  // Dropping it turned "the GPU never got this frame's work" into a rendering mystery and left
  // the caller believing it had submitted.
  assert.doesNotMatch(
    nativeBindingDefinition("GPUQueue", "submit").text,
    /WGPUCommandBuffer cmdBuffer = \(WGPUCommandBuffer\)g_engine->getPrivateData\(cmdBufferHandle\);\s*\n\s*if \(cmdBuffer\) \{/u,
  );
});

test("the NULL-handle proof is built and run by a lane that needs no display", () => {
  assert.match(
    read("CMakeLists.txt"),
    /add_executable\(threenative-wgpu-null-handle-test EXCLUDE_FROM_ALL\s*tests\/wgpu_null_handle_test\.cpp\)/u,
  );
  assert.match(
    read("scripts/verify-desktop-stability.mjs"),
    /"threenative-wgpu-null-handle-test"/u,
  );
});
