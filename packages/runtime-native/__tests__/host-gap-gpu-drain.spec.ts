import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const cmake = source("../CMakeLists.txt");
const gradle = source("../android/app/build.gradle.kts");
const runtime = source("../src/runtime.cpp");
const bindings = source("../src/webgpu/bindings.cpp");
const bindingsState = source("../src/webgpu/bindings_state.h");

test("GPU drain profiling is default-off and wired through Android builds", () => {
  assert.match(cmake, /option\(TN_WEBGPU_GPU_DRAIN_PROFILE[^\n]+ OFF\)/u);
  assert.match(cmake, /TN_WEBGPU_GPU_DRAIN_PROFILE=\$<BOOL:\$\{TN_WEBGPU_GPU_DRAIN_PROFILE\}>/u);
  assert.match(gradle, /gradleProperty\("threenativeGpuDrainProfile"\)\.orElse\("false"\)/u);
  assert.match(gradle, /-DTN_WEBGPU_GPU_DRAIN_PROFILE=\$\{/u);
});

test("GPU drain profiling names the blocking post-present device poll", () => {
  assert.match(bindingsState, /uint64_t framePhaseGpuDrainNs = 0;/u);
  assert.match(
    bindings,
    /#if TN_WEBGPU_GPU_DRAIN_PROFILE[\s\S]*wgpuDevicePoll\(state->device, true, nullptr\)[\s\S]*framePhaseGpuDrainNs/u,
  );
  assert.match(runtime, /kGpuDrain[\s\S]*"gpuDrain"/u);
  assert.match(runtime, /framePhaseGpuDrainNs/u);
});
