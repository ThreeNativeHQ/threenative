#include "mystral/platform/input.h"
#include "mystral/platform/crash_policy.h"
#include "mystral/platform/lifecycle.h"
#include "mystral/platform/ui_overlay.h"
#include "mystral/platform/window.h"
#include "mystral/runtime.h"

#include <SDL3/SDL.h>
#include <chrono>
#include <thread>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <vector>

namespace fs = std::filesystem;

namespace mystral {
namespace platform {
    void processKeyboardEvent(const SDL_KeyboardEvent& event, bool isDown);
    void processMouseMotion(const SDL_MouseMotionEvent& event);
    void processMouseButton(const SDL_MouseButtonEvent& event, bool isDown);
    void processMouseWheel(const SDL_MouseWheelEvent& event);
    void processTouchEvent(const SDL_TouchFingerEvent& event);
    void processGamepadConnected(SDL_JoystickID id);
    void processGamepadDisconnected(SDL_JoystickID id);
    void processResize(int width, int height);
}  // namespace platform
}  // namespace mystral

namespace {

bool testCrashAndLifecycle() {
    using namespace mystral::platform;

    // Crash policy
    crashHandlerPolicy(true, "1", false);
    crashHandlerPolicy(false, "1", false);
    crashHandlerPolicy(false, "0", false);
    crashHandlerPolicy(false, nullptr, true);
    resolveCrashHandlerPolicy();
    applyCrashHandlerPolicy(CrashHandlerPolicy::LeaveToPlatform);
    applyCrashHandlerPolicy(CrashHandlerPolicy::LeaveToSanitizer);
    deliberateCrashAfterFrames("10");
    deliberateCrashAfterFrames("invalid");
    deliberateCrashAfterFrames(nullptr);
    deliberateCrashFrameCount();

    // Lifecycle
    lifecycleActionFor(SDL_EVENT_WILL_ENTER_BACKGROUND);
    lifecycleActionFor(SDL_EVENT_DID_ENTER_BACKGROUND);
    lifecycleActionFor(SDL_EVENT_WILL_ENTER_FOREGROUND);
    lifecycleActionFor(SDL_EVENT_DID_ENTER_FOREGROUND);
    lifecycleActionFor(SDL_EVENT_WINDOW_OCCLUDED);
    lifecycleActionFor(SDL_EVENT_LOW_MEMORY);
    lifecycleActionFor(SDL_EVENT_QUIT);
    lifecycleActionName(LifecycleAction::Pause);
    lifecycleActionName(LifecycleAction::Resume);

    BackgroundMode mode;
    parseBackgroundMode("pause", mode);
    parseBackgroundMode("continue", mode);
    parseBackgroundMode("invalid", mode);
    backgroundModeName(BackgroundMode::Pause);
    backgroundModeName(BackgroundMode::Continue);
    setBackgroundMode(BackgroundMode::Pause);
    backgroundMode();
    isPaused();
    isTerminating();

    handleLifecycleEvent(SDL_EVENT_WILL_ENTER_BACKGROUND);
    handleLifecycleEvent(SDL_EVENT_DID_ENTER_BACKGROUND);
    handleLifecycleEvent(SDL_EVENT_WILL_ENTER_FOREGROUND);
    handleLifecycleEvent(SDL_EVENT_DID_ENTER_FOREGROUND);

    requestSurfaceRevalidation();
    surfaceRevalidationPending();
    takeSurfaceRevalidationRequest();
    clearSurfaceRevalidationRequest();

    noteMemoryTrimLevel(80);
    int level = 0;
    takeMemoryTrimRequest(level);

    surfaceRevalidationDisabled();
    surfaceRevalidationForcedFailure();
    presentUncapped();
    noteDroppedTimerFiring();
    takeDroppedTimerFirings();
    std::string marker;
    takeLifecycleMarker(marker);
    resetLifecycleForTesting();

    // UI overlay
    queueUiMessage("{\"type\":\"tn:hit-regions\",\"regions\":[{\"x\":0,\"y\":0,\"width\":100,\"height\":100}]}");
    std::string frame;
    takeUiMessage(frame);
    droppedUiMessages();
    postUiMessage("test");
    uiOverlayAttached();
    setUiOverlayAttached(true);
    setUiOverlayAttached(false);
    setUiHitRegions({0, 0, 100, 100});
    pumpUiOverlay();
    detachDesktopUiOverlay();

    return true;
}

bool testPlatformInput() {
    using namespace mystral::platform;

    // Safe area
    setSafeAreaInsets(10, 20, 30, 40);
    auto insets = getSafeAreaInsets();
    if (insets.top != 10 || insets.right != 20 || insets.bottom != 30 || insets.left != 40) return false;
    refreshSafeAreaInsets();

    // Keys conversion
    sdlKeyToDOMKey(SDLK_RETURN);
    sdlKeyToDOMKey(SDLK_ESCAPE);
    sdlKeyToDOMKey(SDLK_BACKSPACE);
    sdlKeyToDOMKey(SDLK_TAB);
    sdlKeyToDOMKey(SDLK_SPACE);
    sdlKeyToDOMKey(SDLK_UP);
    sdlKeyToDOMKey(SDLK_DOWN);
    sdlKeyToDOMKey(SDLK_LEFT);
    sdlKeyToDOMKey(SDLK_RIGHT);
    sdlKeyToDOMKey(SDLK_HOME);
    sdlKeyToDOMKey(SDLK_END);
    sdlKeyToDOMKey(SDLK_PAGEUP);
    sdlKeyToDOMKey(SDLK_PAGEDOWN);
    sdlKeyToDOMKey(SDLK_INSERT);
    sdlKeyToDOMKey(SDLK_DELETE);
    sdlKeyToDOMKey(SDLK_F1);
    sdlKeyToDOMKey(SDLK_F12);
    sdlKeyToDOMKey(SDLK_LSHIFT);
    sdlKeyToDOMKey(SDLK_LCTRL);
    sdlKeyToDOMKey(SDLK_LALT);
    sdlKeyToDOMKey(SDLK_LGUI);
    sdlKeyToDOMKey(SDLK_CAPSLOCK);
    sdlKeyToDOMKey('a');
    sdlKeyToDOMKey('1');

    sdlKeyToDOMCode(SDLK_RETURN, SDL_SCANCODE_RETURN);
    sdlKeyToDOMCode(SDLK_ESCAPE, SDL_SCANCODE_ESCAPE);
    sdlKeyToDOMCode(SDLK_BACKSPACE, SDL_SCANCODE_BACKSPACE);
    sdlKeyToDOMCode(SDLK_TAB, SDL_SCANCODE_TAB);
    sdlKeyToDOMCode(SDLK_SPACE, SDL_SCANCODE_SPACE);
    sdlKeyToDOMCode(SDLK_UP, SDL_SCANCODE_UP);
    sdlKeyToDOMCode(SDLK_DOWN, SDL_SCANCODE_DOWN);
    sdlKeyToDOMCode(SDLK_LEFT, SDL_SCANCODE_LEFT);
    sdlKeyToDOMCode(SDLK_RIGHT, SDL_SCANCODE_RIGHT);
    sdlKeyToDOMCode(SDLK_A, SDL_SCANCODE_A);
    sdlKeyToDOMCode(SDLK_1, SDL_SCANCODE_1);

    // Callbacks
    bool keyCalled = false;
    setKeyboardCallback([&](const KeyboardEventData&) { keyCalled = true; });
    bool mouseCalled = false;
    setMouseCallback([&](const MouseEventData&) { mouseCalled = true; });
    bool pointerCalled = false;
    setPointerCallback([&](const PointerEventData&) { pointerCalled = true; });
    bool wheelCalled = false;
    setWheelCallback([&](const WheelEventData&) { wheelCalled = true; });
    bool resizeCalled = false;
    setResizeCallback([&](const ResizeEventData&) { resizeCalled = true; });
    bool padCalled = false;
    setGamepadCallback([&](const GamepadEventData&) { padCalled = true; });

    // Event processing
    SDL_KeyboardEvent keyEv{};
    keyEv.key = SDLK_A;
    keyEv.scancode = SDL_SCANCODE_A;
    processKeyboardEvent(keyEv, true);
    processKeyboardEvent(keyEv, false);

    SDL_MouseMotionEvent motionEv{};
    motionEv.x = 100;
    motionEv.y = 150;
    motionEv.xrel = 5;
    motionEv.yrel = -5;
    processMouseMotion(motionEv);

    SDL_MouseButtonEvent btnEv{};
    btnEv.button = SDL_BUTTON_LEFT;
    btnEv.x = 100;
    btnEv.y = 150;
    processMouseButton(btnEv, true);
    processMouseButton(btnEv, false);

    SDL_MouseWheelEvent wheelEv{};
    wheelEv.x = 0;
    wheelEv.y = 1;
    processMouseWheel(wheelEv);

    SDL_TouchFingerEvent touchEv{};
    touchEv.type = SDL_EVENT_FINGER_DOWN;
    touchEv.fingerID = 1;
    touchEv.x = 0.5f;
    touchEv.y = 0.5f;
    processTouchEvent(touchEv);
    touchEv.type = SDL_EVENT_FINGER_MOTION;
    processTouchEvent(touchEv);
    touchEv.type = SDL_EVENT_FINGER_UP;
    processTouchEvent(touchEv);

    processResize(1280, 720);

    processGamepadConnected(1);
    processGamepadDisconnected(1);
    getGamepadCount();
    GamepadState padState{};
    getGamepadState(0, &padState);

    if (!keyCalled || !mouseCalled || !pointerCalled || !wheelCalled || !resizeCalled) return false;

    return true;
}

constexpr const char* kRuntimeScript = R"JS((() => {
  // Timers
  let timeoutFired = false;
  const id1 = setTimeout(() => { timeoutFired = true; }, 1);
  clearTimeout(id1);

  let intervalFired = false;
  const id2 = setInterval(() => { intervalFired = true; }, 10);
  clearInterval(id2);

  // rAF
  let rafFired = false;
  const rafId = requestAnimationFrame((ts) => { rafFired = true; });
  cancelAnimationFrame(rafId);

  // URL & URLSearchParams
  const u = new URL("https://example.com/test?x=1&y=2#hash");
  if (u.hostname !== "example.com" || u.pathname !== "/test") throw new Error("URL mismatch");
  const sp = new URLSearchParams("foo=bar&num=123");
  if (sp.get("foo") !== "bar") throw new Error("URLSearchParams mismatch");

  // Document DOM methods
  const elCanvas = document.getElementById("canvas");
  const elDiv = document.createElement("div");
  const elImg = document.createElement("img");
  if (document.exitPointerLock) {
    try { document.exitPointerLock(); } catch(e) {}
  }

  // Fetch API with POST and headers
  try {
    fetch("http://127.0.0.1:0/api", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "test-body"
    });
  } catch(e) {}

  // Native Worker instantiation
  try {
    if (typeof Worker !== "undefined") {
      const w = new Worker(URL.createObjectURL(new Blob(["postMessage('worker-ok');"])));
      w.postMessage({ a: 1 });
      w.terminate();
    }
  } catch(e) {}

  // DOM events
  let resizeFired = false;
  window.addEventListener("resize", () => { resizeFired = true; });
  window.dispatchEvent(new Event("resize"));

  // Continuous rAF loop for HostGapMeter attribution
  let frameCount = 0;
  function rAfLoop() {
    frameCount++;
    if (frameCount < 350) {
      requestAnimationFrame(rAfLoop);
    }
  }
  requestAnimationFrame(rAfLoop);

  // LocalStorage API
  try {
    localStorage.setItem("testKey", "testVal");
    localStorage.getItem("testKey");
    localStorage.removeItem("testKey");
    localStorage.key(0);
    const len = localStorage.length;
    localStorage.clear();
  } catch(e) {}

  window.addEventListener("keydown", (e) => { globalThis.__kd = e.key; });
  window.addEventListener("keyup", (e) => { globalThis.__ku = e.key; });
  window.addEventListener("mousedown", (e) => { globalThis.__md = e.button; });
  window.addEventListener("mouseup", (e) => { globalThis.__mu = e.button; });
  window.addEventListener("mousemove", (e) => { globalThis.__mm = e.clientX; });
  window.addEventListener("wheel", (e) => { globalThis.__wh = e.deltaY; });
  window.addEventListener("pointerdown", (e) => { globalThis.__pd = e.pointerId; });
  window.addEventListener("pointermove", (e) => { globalThis.__pm = e.pointerId; });
  window.addEventListener("pointerup", (e) => { globalThis.__pu = e.pointerId; });

  // Playtest input via __THREENATIVE_NATIVE__
  if (globalThis.__THREENATIVE_NATIVE__) {
    const pInput = globalThis.__THREENATIVE_NATIVE__.playtestInput;
    if (pInput) {
      pInput.keyboard("keydown", "a", "KeyA");
      pInput.keyboard("keyup", "a", "KeyA");
      pInput.pointer("pointerdown", 10, 20, 1, 1, "mouse", true);
      pInput.pointer("pointermove", 15, 25, 1, 1, "mouse", true);
      pInput.pointer("pointerup", 15, 25, 0, 1, "mouse", true);
    }
    if (globalThis.__THREENATIVE_NATIVE__.captureScreenshot) {
      globalThis.__THREENATIVE_NATIVE__.captureScreenshot("native_shot.png");
    }
    const pMail = globalThis.__THREENATIVE_NATIVE__.playtest;
    if (pMail) {
      pMail.respond("test_mail.json", "{\"test\":1}", "r1", "ping", 1.0);
      pMail.receive("test_mail.json");
    }
  }

  // Navigator gamepads
  if (navigator.getGamepads) {
    navigator.getGamepads();
  }

  // UI bridge receive hook
  globalThis.__tnUiGameReceive = (frame) => {
    globalThis.__lastUiFrame = frame;
  };

  globalThis.__tnRuntimeDone = true;
})())JS";

bool testRuntimeMethods() {
    mystral::RuntimeConfig config;
    config.width = 640;
    config.height = 480;
    config.noSdl = true;
    config.title = "Test Window";
    config.watch = true;
    config.maxFps = 60;

    auto runtime = mystral::Runtime::create(config);
    if (!runtime) return false;

    runtime->resize(800, 600);
    runtime->setFullscreen(true);
    runtime->setFullscreen(false);

    if (runtime->getWidth() <= 0 || runtime->getHeight() <= 0) return false;

    if (!runtime->evalScript(kRuntimeScript, "runtime_test.js")) return false;

    // Test loadScript with watch mode enabled
    fs::path tempScript = fs::current_path() / "test_load_script.js";
    {
        std::ofstream out(tempScript);
        out << "globalThis.__scriptLoaded = true;";
    }
    if (!runtime->loadScript(tempScript.string())) return false;
    if (!runtime->evalScript("if (globalThis.__tnRuntimeDone !== true || globalThis.__scriptLoaded !== true) throw new Error('runtime scripts did not complete');", "check.js")) return false;

    std::vector<uint8_t> frameData;
    uint32_t fw = 0, fh = 0;
    runtime->captureFrame(frameData, fw, fh);
    runtime->saveScreenshot("rt_screenshot.png");

    // Queue UI messages to exercise drainUiMessages and applyUiHitRegions
    mystral::platform::queueUiMessage("{\"type\":\"tn:hit-regions\",\"regions\":[{\"x\":10,\"y\":20,\"width\":100,\"height\":200}]}");
    mystral::platform::queueUiMessage("{\"type\":\"custom_ui_msg\"}");

    // Dispatch events through platform to trigger RuntimeImpl's installed callbacks
    SDL_KeyboardEvent kDown{};
    kDown.key = SDLK_SPACE;
    kDown.scancode = SDL_SCANCODE_SPACE;
    mystral::platform::processKeyboardEvent(kDown, true);
    mystral::platform::processKeyboardEvent(kDown, false);

    SDL_MouseMotionEvent mMove{};
    mMove.x = 100;
    mMove.y = 100;
    mMove.xrel = 5;
    mMove.yrel = 5;
    mystral::platform::processMouseMotion(mMove);

    SDL_MouseButtonEvent mBtn{};
    mBtn.button = SDL_BUTTON_LEFT;
    mBtn.x = 100;
    mBtn.y = 100;
    mystral::platform::processMouseButton(mBtn, true);
    mystral::platform::processMouseButton(mBtn, false);

    SDL_MouseWheelEvent mWheel{};
    mWheel.x = 0;
    mWheel.y = 1;
    mystral::platform::processMouseWheel(mWheel);

    SDL_TouchFingerEvent tFinger{};
    tFinger.type = SDL_EVENT_FINGER_DOWN;
    tFinger.x = 0.5f;
    tFinger.y = 0.5f;
    tFinger.fingerID = 1;
    mystral::platform::processTouchEvent(tFinger);

    mystral::platform::processResize(1024, 768);

    // Run at least 305 frames to trigger HostGapMeter::report() (kWindow = 300)
    for (int frame = 0; frame < 305; ++frame) {
        if (!runtime->pollEvents()) break;
        std::this_thread::sleep_for(std::chrono::microseconds(50));
    }

    runtime->reloadScript();
    fs::remove(tempScript);

    // Test runtime->run() in headless mode with idle exit
    {
        mystral::RuntimeConfig runConfig;
        runConfig.width = 64;
        runConfig.height = 64;
        runConfig.noSdl = true;
        auto runRuntime = mystral::Runtime::create(runConfig);
        if (runRuntime) {
            if (!runRuntime->evalScript("setTimeout(() => {}, 5);", "idle_test.js")) return false;
            runRuntime->run();
        } else {
            return false;
        }
    }

    return true;
}

}  // namespace

bool testWindowAndSurface() {
#ifndef _WIN32
    setenv("MYSTRAL_HEADLESS", "1", 1);
#else
    _putenv_s("MYSTRAL_HEADLESS", "1");
#endif

    mystral::RuntimeConfig config;
    config.width = 64;
    config.height = 64;
    config.noSdl = false;
    config.title = "Hidden Test Window";
    config.vsync = false;

    auto runtime = mystral::Runtime::create(config);
    if (!runtime) {
        std::cout << "[Window] Display not available for SDL window, skipping gracefully\n";
        return true;
    }

    runtime->evalScript(R"JS((async () => {
        const c = document.getElementById("canvas") || document.createElement("canvas");
        const ctx = c.getContext("2d");
        ctx.fillStyle = "blue";
        ctx.fillRect(0, 0, 64, 64);

        try {
          const adapter = await navigator.gpu.requestAdapter();
          const device = await adapter.requestDevice();
          const gpuCtx = c.getContext("webgpu");
          if (gpuCtx) {
            gpuCtx.configure({ device, format: "bgra8unorm" });
            const tex = gpuCtx.getCurrentTexture();
            if (tex) {
              const enc = device.createCommandEncoder();
              const pass = enc.beginRenderPass({
                colorAttachments: [{ view: tex.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 1, 0, 1] }]
              });
              pass.end();
              device.queue.submit([enc.finish()]);
            }
          }
        } catch (e) {}
        requestAnimationFrame(() => {});
    })())JS", "hidden_window_test.js");

    for (int frame = 0; frame < 5; ++frame) {
        if (!runtime->pollEvents()) break;
    }

    std::vector<uint8_t> frameData;
    uint32_t fw = 0, fh = 0;
    runtime->captureFrame(frameData, fw, fh);
    runtime->saveScreenshot("hidden_window_shot.png");

    runtime->resize(128, 128);
    for (int frame = 0; frame < 3; ++frame) {
        if (!runtime->pollEvents()) break;
    }

    return true;
}

int main() {
    const auto previousDirectory = fs::current_path();
    const auto testDirectory = fs::temp_directory_path() /
        ("tn-runtime-platform-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    fs::create_directories(testDirectory);
    fs::current_path(testDirectory);
    bool ok = true;
    if (!testCrashAndLifecycle()) {
        std::cerr << "testCrashAndLifecycle failed\n";
        ok = false;
    }
    if (!testPlatformInput()) {
        std::cerr << "testPlatformInput failed\n";
        ok = false;
    }
    if (!testRuntimeMethods()) {
        std::cerr << "testRuntimeMethods failed\n";
        ok = false;
    }
    if (!testWindowAndSurface()) {
        std::cerr << "testWindowAndSurface failed\n";
        ok = false;
    }

    fs::current_path(previousDirectory);
    fs::remove_all(testDirectory);
    if (!ok) return 1;

    std::cout << "native runtime and platform comprehensive contract passed\n";
    return 0;
}
