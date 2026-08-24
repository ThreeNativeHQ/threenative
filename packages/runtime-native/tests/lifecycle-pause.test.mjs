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
  for (const call of ["beginFrame()", "executeAnimationFrameCallbacks()", "endDawnFrame()"])
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
  assert.match(read("../core/src/config.ts"), /readonly backgroundMode\?: ThreeNativeBackgroundMode;/u);
  assert.match(
    read("scripts/package-android.mjs"),
    /upsertApplicationMetadata\(\s*rendered,\s*'TN_BACKGROUND_MODE',/u,
  );
  assert.match(
    read("android/app/src/main/java/com/mystral/engine/MystralActivity.java"),
    /metadata\.getString\("TN_BACKGROUND_MODE", "continue"\)/u,
  );
  assert.match(read("src/platform/android_main.cpp"), /parseBackgroundMode\(argv\[6\], mode\)/u);
  assert.match(read("src/cli/main.cpp"), /THREENATIVE_BACKGROUND_MODE/u);
});

test("the lifecycle proof is built and run by a lane that needs no display", () => {
  assert.match(
    read("CMakeLists.txt"),
    /add_executable\(threenative-lifecycle-policy-test EXCLUDE_FROM_ALL\s*tests\/lifecycle_policy_test\.cpp\)/u,
  );
  assert.match(read("scripts/verify-desktop-stability.mjs"), /"threenative-lifecycle-policy-test"/u);
});

test("the background default is `continue` until resume revalidates the surface", () => {
  // A deliberate retreat, pinned so it cannot drift back before the defect that forced it is
  // fixed. Pausing is what this feature is for, but on a physical Pixel 8 on 2026-08-23 resume
  // restarted the loop and presented nothing — Android destroys the ANativeWindow on background
  // and the WGPUSurface still points at it, so `frames` ran away at ~600/s while `presents` stayed
  // frozen and the screen was uniformly black. Bug 9 was a battery cost no player saw; this is a
  // black screen after every phone call, in the mode nobody chose.
  //
  // When docs/bugs/resume-presents-nothing-2026-08-23.md is fixed, THIS TEST is the thing that
  // must be changed back, deliberately, with a device rung proving resume presents again.
  assert.match(
    read("src/platform/lifecycle.cpp"),
    /g_backgroundMode\{BackgroundMode::Continue\}/u,
    "the native default must stay `continue` while resume presents nothing",
  );
  assert.match(
    read("android/app/src/main/java/com/mystral/engine/MystralActivity.java"),
    /getString\("TN_BACKGROUND_MODE", "continue"\)/u,
    "the Android metadata default must match the native one, or Android pauses regardless",
  );
  // The retreat is the default only. The mechanism must stay live and measured under it.
  assert.match(read("src/platform/lifecycle.cpp"), /SDL_AddEventWatch/u);
  assert.match(read("src/platform/lifecycle.cpp"), /TN_LIFECYCLE/u);
});
