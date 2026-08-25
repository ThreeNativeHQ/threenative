import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const cmake = source("../CMakeLists.txt");
const gradle = source("../android/app/build.gradle.kts");
const androidMain = source("../src/platform/android_main.cpp");
const runtime = source("../src/runtime.cpp");
const context = source("../src/webgpu/context.cpp");
const bindings = source("../src/webgpu/bindings.cpp");
const nativeSmoke = source("../../../examples/native-smoke/src/game.ts");
const measurementRunner = source("../scripts/measure-android-js-engine.mjs");

test("Android measurement controls remain default-off and pass through Gradle", () => {
  assert.match(cmake, /option\(TN_ANDROID_VSYNC[^\n]+ ON\)/u);
  for (const flag of [
    "TN_ANDROID_JS_PROFILE",
    "TN_ANDROID_JS_PROFILE_BUSY_LOOP",
  ]) {
    assert.match(cmake, new RegExp(`option\\(${flag}[^\\n]+ OFF\\)`, "u"));
    assert.match(cmake, new RegExp(`${flag}=\\$<BOOL:\\$\\{${flag}\\}>`, "u"));
    assert.match(gradle, new RegExp(`-D${flag}=\\$\\{`, "u"));
  }
  assert.match(gradle, /gradleProperty\("threenativeVsync"\)\.orElse\("true"\)/u);
  assert.match(gradle, /gradleProperty\("threenativeJsProfile"\)\.orElse\("false"\)/u);
  assert.match(gradle, /gradleProperty\("threenativeJsProfileBusyLoop"\)\.orElse\("false"\)/u);
  for (const setting of [
    "EXTRA_DRAW_CONTROL",
    "FRAME_WINDOW",
    "MATERIALS",
    "MESHES",
    "PURE_JS_ITERATIONS",
    "PURE_JS_OBJECTS",
    "VISIBILITY",
    "WARMUP_FRAMES",
  ]) {
    assert.match(gradle, new RegExp(`THREENATIVE_JS_PROFILE_${setting}`, "u"));
  }
  assert.match(gradle, /inputs\.properties\(jsProfileEnvironment\)/u);
});

test("RuntimeConfig vsync selects and preserves a supported presentation mode", () => {
  assert.match(androidMain, /config\.vsync = (?:true|false)/u);
  assert.match(runtime, /configureSurface\(width_, height_, config_\.vsync\)/u);
  assert.match(runtime, /getPresentMode\(\)/u);
  assert.match(context, /capabilities\.presentModes\[i\] == WGPUPresentMode_Immediate/u);
  assert.match(context, /capabilities\.presentModes\[i\] == WGPUPresentMode_Mailbox/u);
  assert.match(context, /Uncapped presentation requested but unsupported; refusing FIFO fallback/u);
  assert.match(context, /configureSurface\(width, height, vsync_\)/u);
  assert.match(bindings, /config\.presentMode = state->presentMode/u);
});

test("native profiling reports direct and bundled render commands per submit", () => {
  const marker = bindings.match(
    /TN_ANDROID_JS_NATIVE:\{[\s\S]*?state->androidJsNativeProfile = \{\};/u,
  )?.[0] ?? "";
  for (const field of [
    "engine",
    "calls",
    "commands",
    "commandNs",
    "setPipeline",
    "setBindGroup",
    "draw",
    "drawIndexed",
    "bundleDrawIndexed",
    "executeBundles",
    "writeBuffer",
    "writeBufferBytes",
    "writeBufferDistinctTargets",
    "writeBufferSmallCalls",
    "writeBufferMediumCalls",
    "writeBufferLargeCalls",
    "endRenderPass",
    "bundlesExecuted",
    "setVertexBuffer",
    "setIndexBuffer",
    "bindingNs",
    "submitPollNs",
    "presentNs",
  ]) {
    assert.ok(marker.includes(`\\\"${field}\\\"`), `profile marker must contain ${field}`);
  }
  assert.match(bindings, /state->androidJsNativeProfile = \{\};/u);
  assert.equal(
    (bindings.match(/endProfiledBinding\(state, ProfiledRenderCommand::/gu) ?? []).length,
    10,
    "render commands, queue uploads, and render-pass finalization must be timed independently",
  );
  assert.ok(bindings.includes('\\"engine\\":\\"" << state->engine->getName()'));
});

test("busy-loop negative control stays inside timed bindings", () => {
  assert.match(bindings, /beginProfiledBinding\(\)[\s\S]*profilingBusyLoop\(\)/u);
});

test("frame window spans exactly the declared number of render intervals", () => {
  assert.match(
    nativeSmoke,
    /#profileFrames === profile\.warmupFrames \+ 1[\s\S]*#profileFrames !== profile\.warmupFrames \+ profile\.frameWindow \+ 1/u,
  );
});

test("measurement installs the immutable archived APK it reports", () => {
  const archiveAt = measurementRunner.indexOf("copyFileSync(builtApkPath, archivedApkPath)");
  const verifyAt = measurementRunner.indexOf("await verifyAndroidFirstProof(proofOptions)");
  assert.ok(archiveAt >= 0 && verifyAt > archiveAt);
  assert.match(
    measurementRunner.slice(archiveAt, verifyAt),
    /"--apk",\s+archivedApkPath,[\s\S]*"--skip-build"/u,
  );
  assert.match(measurementRunner, /TN_ANDROID_JS_SKIP_INSTALL_NOT_EVIDENCE_ELIGIBLE/u);
});
