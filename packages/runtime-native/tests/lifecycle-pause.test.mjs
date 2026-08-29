// The render loop must stop when the app goes off-screen, and start again when it comes back.
//
// A physical Pixel 8 kept presenting for the full 60 s its screen was off on 2026-08-23, because
// the event pump handled QUIT, resize and input and no lifecycle event of any kind. SDL 3.2.8 on
// Android queues the background events and *then* blocks the pump inside
// `Android_WaitLifecycleEvent`, so a polled handler runs only after the app is already parked —
// `SDL_AddEventWatch` is the only hook that fires in time.
//
// The executable proof is `tests/lifecycle_policy_test.cpp`. These assertions keep the mechanism
// and the plumbing in place in the default gate.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

test("the pause hook is an SDL event watch, not a pump case", () => {
  const lifecycle = read("src/platform/lifecycle.cpp");
  assert.match(
    lifecycle,
    /SDL_AddEventWatch\(lifecycleEventWatch, nullptr\)/u,
    "polling cannot work: SDL blocks the pump after queueing the background events on Android",
  );
  assert.match(
    lifecycle,
    /case SDL_EVENT_WILL_ENTER_BACKGROUND:[\s\S]*?return LifecycleAction::Pause;/u,
  );
  assert.match(
    lifecycle,
    /case SDL_EVENT_DID_ENTER_FOREGROUND:[\s\S]*?return LifecycleAction::Resume;/u,
  );
  assert.match(
    lifecycle,
    /case SDL_EVENT_WINDOW_FOCUS_LOST:[\s\S]*?return LifecycleAction::RecordOnly;/u,
    "focus is not visibility; pausing on it would stop split-screen and server-shaped games",
  );
});

test("the paused loop runs no JavaScript and presents no frame", () => {
  const runtime = read("src/runtime.cpp");
  const gate = runtime.indexOf("if (!config_.noSdl && platform::isPaused())");
  assert.ok(gate > 0, "pollEvents must gate its body on the paused flag");
  const body = runtime.slice(gate, gate + 1200);
  assert.match(body, /countAndDropDueTimers\(\);/u);
  assert.match(body, /return running_;/u, "the paused branch must return before any frame work");
  // The gate has to sit ahead of the frame work, or a paused loop still presents.
  for (const call of [
    "beginFrame()",
    "executeAnimationFrameCallbacks()",
    "endDawnFrame(bindingsState_)",
  ])
    assert.ok(
      runtime.indexOf(call, gate) > gate + body.indexOf("return running_;"),
      `${call} must be downstream of the paused gate`,
    );
});

test("audio is suspended through a host-side registry, not left to JavaScript", () => {
  // `suspend()` and `resume()` existed and were reachable only from JS — which is exactly what
  // stops running when an app is backgrounded, so nothing ever called them.
  const audio = read("src/audio/audio_context.cpp");
  assert.match(audio, /void suspendAllContexts\(\)/u);
  assert.match(audio, /contextRegistry\(\)\.push_back\(this\);/u);
  assert.match(
    audio,
    /if \(context != nullptr && context->hostSuspended\(\)\) context->resumeForHost\(\);/u,
    "resuming must not un-suspend a context the game itself suspended",
  );
  assert.match(read("src/platform/lifecycle.cpp"), /audio::suspendAllContexts\(\);/u);
});

test("the markers report what happened, in both modes", () => {
  const lifecycle = read("src/platform/lifecycle.cpp");
  assert.match(lifecycle, /TN_LIFECYCLE:\{\\"event\\":/u);
  assert.match(lifecycle, /\\"mode\\":\\"/u, "the marker must name the mode that executed");
  assert.match(
    lifecycle,
    /queueMarker\(action, sdlEventType, applied\);/u,
    "turning the pause off must not turn the reporting off",
  );
  assert.match(read("src/runtime.cpp"), /drainLifecycleMarkers\(\);/u);
});

test("a terminal event is terminal whatever backgroundMode says", () => {
  assert.match(
    read("src/platform/lifecycle.cpp"),
    /case LifecycleAction::Terminate:[\s\S]*?g_terminating\.store\(true/u,
  );
  assert.match(read("src/runtime.cpp"), /if \(platform::isTerminating\(\)\)/u);
});

test("display.backgroundMode is plumbed from the config to both hosts", () => {
  assert.match(
    read("../core/src/config.ts"),
    /readonly backgroundMode\?: ThreeNativeBackgroundMode;/u,
  );
  assert.match(
    read("scripts/package-android.mjs"),
    /upsertApplicationMetadata\(\s*rendered,\s*'TN_BACKGROUND_MODE',/u,
  );
  assert.match(
    read("android/app/src/main/java/com/mystral/engine/MystralActivity.java"),
    /metadata\.getString\("TN_BACKGROUND_MODE", "pause"\)/u,
  );
  assert.match(read("src/platform/android_main.cpp"), /parseBackgroundMode\(argv\[6\], mode\)/u);
  assert.match(read("src/cli/main.cpp"), /THREENATIVE_BACKGROUND_MODE/u);
});

test("the lifecycle proof is built and run by a lane that needs no display", () => {
  assert.match(
    read("CMakeLists.txt"),
    /add_executable\(threenative-lifecycle-policy-test EXCLUDE_FROM_ALL\s*tests\/lifecycle_policy_test\.cpp\)/u,
  );
  assert.match(
    read("scripts/verify-desktop-stability.mjs"),
    /"threenative-lifecycle-policy-test"/u,
  );
});

test("resume rebuilds the surface Android destroyed, and republishes it", () => {
  // The defect this closes: PRD-210 specified "surface revalidated like startup does" and shipped
  // a resume that cleared the paused flag and nothing else. Android destroys the ANativeWindow
  // behind a backgrounded app, so every present after resume went to a dead window — measured on a
  // physical Pixel 8 on 2026-08-23 as `frames` running away at ~600/s against a frozen `presents`
  // and a uniformly black screencap.
  const lifecycle = read("src/platform/lifecycle.cpp");
  assert.match(
    lifecycle,
    /case LifecycleAction::Resume:[\s\S]*?requestSurfaceRevalidation\(\);/u,
    "resume must queue the rebuild, not just clear the paused flag",
  );
  // Requested outside the `applied` branch: Android destroys the window whatever this host decided
  // about pausing, so `continue` needs the same rebuild.
  const resume = lifecycle.slice(lifecycle.indexOf("case LifecycleAction::Resume:"));
  const request = resume.indexOf("requestSurfaceRevalidation();");
  const appliedBranch = resume.indexOf("if (applied) {");
  const appliedEnd = resume.indexOf("}", resume.indexOf("audio::resumeAllContexts();"));
  assert.ok(
    request > appliedEnd || appliedBranch < 0,
    "the rebuild must be requested in both modes, not only when the pause was applied",
  );

  const runtime = read("src/runtime.cpp");
  assert.match(runtime, /platform::takeSurfaceRevalidationRequest\(\)/u);
  assert.match(
    runtime,
    /webgpu_->rebuildSurface\(nativeWindow, webgpu::Context::PLATFORM_ANDROID\)/u,
    "the surface has to be rebuilt against the window Android handed back",
  );
  assert.match(
    runtime,
    /webgpu_->configureSurface\(width_, height_,\s*config_\.vsync && !platform::presentUncapped\(\)\)/u,
    "a rebuilt surface presents nothing until it is configured",
  );
  assert.match(
    runtime,
    /webgpu::republishSurface\(bindingsState_, webgpu_->getSurface\(\)/u,
    "the bindings read their own surface for every present; a host-only rebuild fixes nothing",
  );
  // Ahead of the frame work, or the first frame after resume draws to the dead surface.
  const revalidate = runtime.indexOf("platform::takeSurfaceRevalidationRequest()");
  for (const call of [
    "beginFrame()",
    "executeAnimationFrameCallbacks()",
    "endDawnFrame(bindingsState_)",
  ])
    assert.ok(
      runtime.indexOf(call, revalidate) > revalidate,
      `${call} must be downstream of the rebuild`,
    );

  assert.match(
    read("include/mystral/webgpu/context.h"),
    /bool rebuildSurface\(void\* nativeHandle, int platformType\);/u,
  );
});

test("a surface that cannot be revalidated fails loudly instead of going black", () => {
  const runtime = read("src/runtime.cpp");
  assert.match(runtime, /TN_LIFECYCLE_SURFACE_FAILED/u, "the failure must be nameable in a log");
  const failure = runtime.slice(runtime.indexOf("reportSurfaceRevalidationFailure();"));
  assert.match(
    failure.slice(0, 200),
    /running_ = false;/u,
    "a loop that keeps running without presenting is the same black screen with extra steps",
  );
});

test("the background default is `pause` again, on both sides of the JNI boundary", () => {
  // This default has moved twice and the second move is the one to read carefully.
  //
  //   1. PRD-210 shipped `pause`, which is what the feature is for.
  //   2. `c3ae3b26` retreated to `continue`, because resume presented nothing: Android destroys
  //      the ANativeWindow on background and the WGPUSurface still pointed at it, so `frames` ran
  //      away at ~600/s while `presents` stayed frozen and the screen went black after any phone
  //      call. The guard that shipped with that retreat named itself as the thing to change back.
  //   3. Restored to `pause` on 2026-08-23, deliberately, and only after a rung on the physical
  //      Pixel 8 proved resume presents again: same APK, the pre-fix resume behind
  //      `debug.threenative.skip_surface_revalidate=1`, `frames` 43920 -> 56340 against `presents`
  //      frozen at 1304 and a 0.00%-non-black capture in the red; `frames` == `presents` at 60 Hz,
  //      a `TN_LIFECYCLE_SURFACE` marker whose window pointer had genuinely changed, and the scene
  //      back on screen in the green. docs/verification/resume-presents-2026-08-23.md.
  //
  // Do not move it a third time without a device rung that says why.
  assert.match(
    read("src/platform/lifecycle.cpp"),
    /g_backgroundMode\{BackgroundMode::Pause\}/u,
    "pausing is what this feature is for, and resume now revalidates the surface",
  );
  assert.match(
    read("android/app/src/main/java/com/mystral/engine/MystralActivity.java"),
    /getString\("TN_BACKGROUND_MODE", "pause"\)/u,
    "the Android metadata default must match the native one, or the two disagree on Android",
  );
  // The packager has always shipped `pause` for a generated project, so these three are now one
  // answer rather than two: an APK with metadata and an APK without behave the same way.
  assert.match(read("scripts/package-android.mjs"), /backgroundMode: 'pause'/u);
  // The override and its reporting stay live under either default.
  assert.match(read("src/platform/lifecycle.cpp"), /SDL_AddEventWatch/u);
  assert.match(read("src/platform/lifecycle.cpp"), /TN_LIFECYCLE/u);
});
