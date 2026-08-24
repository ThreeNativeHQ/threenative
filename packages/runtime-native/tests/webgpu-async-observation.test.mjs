import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("../src/webgpu/bindings.cpp", import.meta.url)),
  "utf8",
);

function assertAsyncObservationContract(candidate) {
  assert.match(candidate, /wgpuDevicePushErrorScope\(state->device, filter\)/u);
  assert.match(candidate, /wgpuDevicePopErrorScope\(state->device, callbackInfo\)/u);
  assert.match(candidate, /wgpuDevicePopErrorScope\(state->device, onErrorScopePopped, data\)/u);
  assert.match(candidate, /wgpuQueueOnSubmittedWorkDone\(state->queue, callbackInfo\)/u);
  assert.match(candidate, /wgpuQueueOnSubmittedWorkDone\(state->queue, onQueueWorkDone, data\)/u);
  assert.match(candidate, /wgpuDevicePoll\(state->device, false, nullptr\)/u);
  assert.match(candidate, /wgpuInstanceProcessEvents\(state->instance\)[\s\S]*wgpuDeviceTick\(state->device\)/u);
  assert.match(candidate, /WGPUErrorType_NoError[\s\S]*resolvedPromise\(state, "null"/u);
  assert.match(candidate, /gpuErrorName\(errorType\)[\s\S]*jsStringLiteral\(errorMessage\)/u);
  assert.match(candidate, /status != WGPUQueueWorkDoneStatus_Success/u);
  assert.match(candidate, /callbackReferences\{2\}[\s\S]*releaseCallbackData/u);
  assert.match(candidate, /if \(!waitForWebGpuCallback\(state, data->completed\)\) \{[\s\S]*releaseCallbackData\(data\)/u);
  assert.ok(
    (candidate.match(/releaseCallbackData\(data\);/gu) ?? []).length >= 10,
    "caller and callback must each release ownership on every completion path",
  );
  assert.doesNotMatch(candidate, /onSubmittedWorkDone[\s\S]{0,500}evalWithResult\("Promise\.resolve/u);
}

test("WebGPU async bindings observe native scopes and submitted work on every API generation", () => {
  assert.doesNotThrow(() => assertAsyncObservationContract(source));
  assert.match(source, /#if defined\(MYSTRAL_WEBGPU_DAWN\)[\s\S]*WGPUStringView message/u);
  assert.match(source, /#elif defined\(MYSTRAL_WEBGPU_WGPU_MODERN\)/u);
  assert.match(source, /#if WGPU_USES_CALLBACK_INFO_PATTERN[\s\S]*#else/u);
  assert.match(source, /evalScriptWithResult\(source\.c_str\(\), filename\)/u);
});

test("WebGPU async contract tests fail when an observation path regresses to a no-op", () => {
  const noErrorScope = source.replace(
    "wgpuDevicePushErrorScope(state->device, filter);",
    "return state->engine->newUndefined();",
  );
  assert.throws(() => assertAsyncObservationContract(noErrorScope));

  const noQueueWait = source.replace(
    "wgpuQueueOnSubmittedWorkDone(state->queue, callbackInfo)",
    "wgpuQueueOnSubmittedWorkDone_REMOVED(state->queue, callbackInfo)",
  );
  assert.throws(() => assertAsyncObservationContract(noQueueWait));

  const fakePromise = source.replace(
    "return resolvedPromise(state, \"undefined\", \"onSubmittedWorkDone-success\");",
    "return state->engine->evalWithResult(\"Promise.resolve()\", \"fake\");",
  );
  assert.throws(() => assertAsyncObservationContract(fakePromise));

  const unsafeLateCallback = source.replace("    releaseCallbackData(data);", "");
  assert.throws(() => assertAsyncObservationContract(unsafeLateCallback));
});
