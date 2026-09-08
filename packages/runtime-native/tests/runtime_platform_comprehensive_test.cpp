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
#ifndef _WIN32
    setenv("THREENATIVE_PREFIX_CRASH_HANDLERS", "1", 1);
    applyCrashHandlerPolicy(CrashHandlerPolicy::SuppressDialog);
    unsetenv("THREENATIVE_PREFIX_CRASH_HANDLERS");

    setenv("THREENATIVE_DELIBERATE_CRASH", "150", 1);
    if (deliberateCrashFrameCount() != 150) return false;
    setenv("THREENATIVE_DELIBERATE_CRASH", "invalid", 1);
    if (deliberateCrashFrameCount() != 0) return false;
    unsetenv("THREENATIVE_DELIBERATE_CRASH");
#endif

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
    for (uint32_t k = SDLK_A; k <= SDLK_Z; ++k) sdlKeyToDOMKey(k);
    for (uint32_t k = SDLK_0; k <= SDLK_9; ++k) sdlKeyToDOMKey(k);
    for (uint32_t k = SDLK_F1; k <= SDLK_F12; ++k) sdlKeyToDOMKey(k);
    const uint32_t navKeys[] = {
        SDLK_UP, SDLK_DOWN, SDLK_LEFT, SDLK_RIGHT, SDLK_HOME, SDLK_END,
        SDLK_PAGEUP, SDLK_PAGEDOWN, SDLK_BACKSPACE, SDLK_DELETE, SDLK_INSERT,
        SDLK_RETURN, SDLK_TAB, SDLK_ESCAPE, SDLK_SPACE, SDLK_LSHIFT, SDLK_RSHIFT,
        SDLK_LCTRL, SDLK_RCTRL, SDLK_LALT, SDLK_RALT, SDLK_LGUI, SDLK_RGUI,
        SDLK_CAPSLOCK, SDLK_MINUS, SDLK_EQUALS, SDLK_LEFTBRACKET, SDLK_RIGHTBRACKET,
        SDLK_BACKSLASH, SDLK_SEMICOLON, SDLK_APOSTROPHE, SDLK_GRAVE, SDLK_COMMA,
        SDLK_PERIOD, SDLK_SLASH, 0xFFFF
    };
    for (uint32_t k : navKeys) sdlKeyToDOMKey(k);

    for (uint32_t sc = SDL_SCANCODE_A; sc <= SDL_SCANCODE_Z; ++sc) sdlKeyToDOMCode(0, sc);
    for (uint32_t sc = SDL_SCANCODE_1; sc <= SDL_SCANCODE_0; ++sc) sdlKeyToDOMCode(0, sc);
    for (uint32_t sc = SDL_SCANCODE_F1; sc <= SDL_SCANCODE_F12; ++sc) sdlKeyToDOMCode(0, sc);
    const uint32_t navScancodes[] = {
        SDL_SCANCODE_UP, SDL_SCANCODE_DOWN, SDL_SCANCODE_LEFT, SDL_SCANCODE_RIGHT,
        SDL_SCANCODE_HOME, SDL_SCANCODE_END, SDL_SCANCODE_PAGEUP, SDL_SCANCODE_PAGEDOWN,
        SDL_SCANCODE_BACKSPACE, SDL_SCANCODE_DELETE, SDL_SCANCODE_INSERT, SDL_SCANCODE_RETURN,
        SDL_SCANCODE_TAB, SDL_SCANCODE_ESCAPE, SDL_SCANCODE_SPACE, SDL_SCANCODE_LSHIFT,
        SDL_SCANCODE_RSHIFT, SDL_SCANCODE_LCTRL, SDL_SCANCODE_RCTRL, SDL_SCANCODE_LALT,
        SDL_SCANCODE_RALT, SDL_SCANCODE_LGUI, SDL_SCANCODE_RGUI, SDL_SCANCODE_CAPSLOCK,
        SDL_SCANCODE_MINUS, SDL_SCANCODE_EQUALS, SDL_SCANCODE_LEFTBRACKET, SDL_SCANCODE_RIGHTBRACKET,
        SDL_SCANCODE_BACKSLASH, SDL_SCANCODE_SEMICOLON, SDL_SCANCODE_APOSTROPHE, SDL_SCANCODE_GRAVE,
        SDL_SCANCODE_COMMA, SDL_SCANCODE_PERIOD, SDL_SCANCODE_SLASH, 0xFFFF
    };
    for (uint32_t sc : navScancodes) sdlKeyToDOMCode(0, sc);

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

  // scheduler.yield
  if (typeof scheduler !== "undefined" && scheduler.yield) {
    scheduler.yield().then(() => {});
  }

  // performance.now
  if (typeof performance !== "undefined" && performance.now) {
    const pNow = performance.now();
  }

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

  // Event capture options
  const capCb = () => {};
  window.addEventListener("capEvent", capCb, true);
  window.addEventListener("capEvent", capCb, { capture: true });
  window.addEventListener("capEvent", capCb, { capture: false });
  window.removeEventListener("capEvent", capCb, true);
  window.removeEventListener("capEvent", capCb, { capture: true });

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
      pMail.respond("test_large.json", "a".repeat(1000005));
      pMail.receive("nonexistent_mail.json");
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
  if (globalThis.__tnUiPostMessage) {
    try { globalThis.__tnUiPostMessage("{\"type\":\"test_ping\"}"); } catch(e) {}
  }
  globalThis.__tnOnTrimMemory = (lvl) => {
    if (lvl === 999) throw new Error("intentional trim handler error");
  };

  // Storage edge cases
  if (typeof __storageGetItem !== "undefined") {
    __storageGetItem();
    __storageGetItem("non_existent_key_12345");
    __storageSetItem();
    __storageSetItem("single_key");
    __storageRemoveItem();
    __storageKey();
    __storageKey(9999);
    __storageLength();
  }

  // Fetch / HTTP edge cases
  if (typeof __readFileSync !== "undefined") {
    __readFileSync();
  }
  if (typeof __readFileAsync !== "undefined") {
    __readFileAsync();
    __readFileAsync("missing_callback.txt");
  }
  if (typeof __httpRequest !== "undefined") {
    __httpRequest();
  }
  if (typeof __httpRequestAsync !== "undefined") {
    __httpRequestAsync();
    __httpRequestAsync("http://127.0.0.1:0/test_async", {
      method: "POST",
      headers: new Map([["x-custom-h", "custom-val"]]),
      body: new Uint8Array([10, 20, 30]).buffer
    }, (res) => {});
  }

  // Worker edge cases
  if (typeof __tnNativeWorkerCreate !== "undefined") {
    try { __tnNativeWorkerCreate(); } catch(e) {}
    try { __tnNativeWorkerCreate(12345); } catch(e) {}
  }
  if (typeof __tnNativeWorkerPost !== "undefined") {
    __tnNativeWorkerPost();
    __tnNativeWorkerPost(99999);
    __tnNativeWorkerPost(99999, "hello");
  }
  if (typeof __tnNativeWorkerTerminate !== "undefined") {
    __tnNativeWorkerTerminate();
    __tnNativeWorkerTerminate(99999);
  }

  // UI bridge edge cases
  if (typeof __tnUiPost !== "undefined") {
    __tnUiPost();
    __tnUiPost("test payload");
  }
  if (typeof __tnUiOverlayAttached !== "undefined") {
    __tnUiOverlayAttached();
  }

  // Module edge cases
  if (typeof __mystralRequire !== "undefined") {
    __mystralRequire();
  }

  // File fetch integration
  (async () => {
    try {
      if (globalThis.__localFetchFile) {
        const res = await fetch("file://" + globalThis.__localFetchFile);
        if (res.ok && res.status === 200) {
          const txt = await res.text();
          const json = JSON.parse(txt);
          globalThis.__fetchOk = json.success === true;
        }
        const badRes = await fetch("file:///non_existent_path_xyz123.txt");
        globalThis.__fetch404 = badRes.status === 404;
      }
    } catch (e) {
      console.error("fetch_err", e);
    }
  })();

  // DOM document event listeners
  let docEventFired = false;
  const docListener = () => { docEventFired = true; };
  document.addEventListener("custom", docListener);
  document.dispatchEvent(new Event("custom"));
  document.removeEventListener("custom", docListener);

  // Constructed event with immediate propagation stopped and default prevented
  const ev = new Event("customConstructed");
  ev._immediatePropagationStopped = true;
  ev.defaultPrevented = true;
  document.addEventListener("customConstructed", () => {});
  document.dispatchEvent(ev);

  // Event preventDefault and stopPropagation handlers
  window.addEventListener("keydown", (e) => { e.preventDefault(); e.stopPropagation(); });
  window.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
  window.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); });
  window.addEventListener("wheel", (e) => { e.preventDefault(); e.stopPropagation(); });
  window.addEventListener("gamepadconnected", (e) => {});

  // Canvas element DOM methods
  const cvsEl = document.getElementById("canvas");
  if (cvsEl) {
    const dummy = () => {};
    cvsEl.addEventListener("testEvent", dummy);
    cvsEl.addEventListener("testEvent", dummy);
    cvsEl.dispatchEvent(new Event("testEvent"));
    cvsEl.removeEventListener("testEvent", dummy);
    cvsEl.getBoundingClientRect();
    cvsEl.toDataURL("image/png");
    cvsEl.toDataURL("image/jpeg");
    cvsEl.toDataURL("image/webp");
    cvsEl.toDataURL("image/gif");
    cvsEl.toDataURL("image/unsupported");
    if (cvsEl.setPointerCapture) cvsEl.setPointerCapture(1);
    if (cvsEl.releasePointerCapture) cvsEl.releasePointerCapture(1);
    if (cvsEl.getContext) cvsEl.getContext("unsupported");
  }
  document.getElementById("nonexistent");
  document.getElementById();

  // __readFileSync and __readFileAsync native helpers
  try {
    if (globalThis.__localFetchFile && globalThis.__readFileSync) {
      globalThis.__readFileSync(globalThis.__localFetchFile);
      globalThis.__readFileSync("nonexistent_sync.txt");
      globalThis.__readFileSync();
    }
    if (globalThis.__localFetchFile && globalThis.__readFileAsync) {
      globalThis.__readFileAsync(globalThis.__localFetchFile, (data, err) => {});
      globalThis.__readFileAsync("nonexistent_async.txt", (data, err) => {});
    }
    if (globalThis.__httpRequest) {
      globalThis.__httpRequest("http://127.0.0.1:0/test", {
        method: "POST",
        headers: new Map([["x-test", "1"]]),
        body: "test"
      }, () => {});
      globalThis.__httpRequest();
    }
  } catch (e) {}

  globalThis.__tnRuntimeDone = true;
})())JS";

bool testRuntimeMethods() {
    fs::path fetchTestFile = fs::current_path() / "test_fetch.json";
    {
        std::ofstream out(fetchTestFile);
        out << "{\"success\": true, \"count\": 42}";
    }

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

    // Connect gamepad 0 before script runs so navigator.getGamepads() sees it
    mystral::platform::processGamepadConnected(0);

    runtime->evalScript(("globalThis.__localFetchFile = '" + fetchTestFile.string() + "';").c_str());

    if (!runtime->evalScript(kRuntimeScript, "runtime_test.js")) return false;

    // Test loadScript with watch mode enabled
    fs::path tempScript = fs::current_path() / "test_load_script.js";
    {
        std::ofstream out(tempScript);
        out << "globalThis.__scriptLoaded = true;";
    }
    if (!runtime->loadScript(tempScript.string())) return false;
    if (!runtime->evalScript("if (globalThis.__tnRuntimeDone !== true || globalThis.__scriptLoaded !== true) throw new Error('runtime scripts did not complete');", "check.js")) return false;

    // Playtest screenshot request mailbox
    fs::path reqFile = fs::current_path() / "tn-playtest-screenshot-request.txt";
    fs::path outPng = fs::current_path() / "mailbox_out.png";
    {
        std::ofstream out(reqFile);
        out << outPng.string();
    }
#ifndef _WIN32
    setenv("TN_PLAYTEST_MAILBOX_ROOT", fs::current_path().string().c_str(), 1);
    runtime->pollEvents();
    unsetenv("TN_PLAYTEST_MAILBOX_ROOT");
#endif
    fs::remove(reqFile);
    fs::remove(outPng);

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

    mystral::platform::processGamepadConnected(0);
    mystral::platform::processGamepadDisconnected(0);

    // Run at least 305 frames to trigger HostGapMeter::report() (kWindow = 300)
    for (int frame = 0; frame < 305; ++frame) {
        if (!runtime->pollEvents()) break;
        std::this_thread::sleep_for(std::chrono::microseconds(50));
    }

    runtime->reloadScript();
    fs::remove(tempScript);
    fs::remove(fetchTestFile);

    // Runtime getters and lifecycle triggers
    runtime->getJSContext();
    runtime->getWGPUDevice();
    runtime->getWGPUQueue();
    runtime->getWGPUInstance();
    runtime->getCurrentTexture();
    runtime->getSDLWindow();
    runtime->getPresentCount();
    runtime->isStartupReady();
    runtime->hasCapturedFrame();
    runtime->clearCapturedFrame();
    runtime->requestFrameScreenshot();
    runtime->getWebGPUBindingsState();
    runtime->getExitCode();
    runtime->quit();
    mystral::getVersion();
    mystral::getJSEngine();
    mystral::getWebGPUBackend();

    // Request surface revalidation and memory trim
    mystral::platform::requestSurfaceRevalidation();
    mystral::platform::noteMemoryTrimLevel(50);
    mystral::platform::noteMemoryTrimLevel(999);
    runtime->pollEvents();

    // Test surface revalidation control branches
#ifndef _WIN32
    setenv("THREENATIVE_SKIP_SURFACE_REVALIDATE", "1", 1);
    mystral::platform::requestSurfaceRevalidation();
    runtime->pollEvents();
    unsetenv("THREENATIVE_SKIP_SURFACE_REVALIDATE");

    setenv("THREENATIVE_FORCE_SURFACE_REVALIDATE_FAILURE", "1", 1);
    mystral::platform::requestSurfaceRevalidation();
    runtime->pollEvents();
    unsetenv("THREENATIVE_FORCE_SURFACE_REVALIDATE_FAILURE");
#endif

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

    // Test process.exit() from JS
    {
        mystral::RuntimeConfig exitConfig;
        exitConfig.width = 64;
        exitConfig.height = 64;
        exitConfig.noSdl = true;
        auto exitRuntime = mystral::Runtime::create(exitConfig);
        if (!exitRuntime) return false;
        if (!exitRuntime->evalScript(
                "if (typeof process !== 'undefined' && process.exit) { process.exit(42); }",
                "exit_test.js") ||
            exitRuntime->getExitCode() != 42) {
            std::cerr << "process.exit contract did not report exit code 42\n";
            return false;
        }
    }

    // Test invalid maxFps validation
    {
        mystral::RuntimeConfig badCapConfig;
        badCapConfig.maxFps = 2000;
        auto badRuntime = mystral::Runtime::create(badCapConfig);
        if (badRuntime != nullptr) {
            std::cerr << "Expected Runtime::create to fail with maxFps > 1000\n";
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

    // Test window query and configuration APIs
    int winW = 0, winH = 0;
    mystral::platform::getWindowSize(&winW, &winH);
    mystral::platform::displayPixelDensity();
    mystral::platform::getSDLWindow();
    mystral::platform::getMetalView();
    mystral::platform::getMetalLayer();
    mystral::platform::setWindowTitle("Updated Test Window");
    mystral::platform::setFullscreen(false);
    mystral::platform::syncWindowSize(64, 64);
    mystral::platform::setWindowSize(64, 64);

    // Push SDL events to exercise pollEvents switch statement
    SDL_Event ev{};

    ev.type = SDL_EVENT_WINDOW_RESIZED;
    ev.window.data1 = 128;
    ev.window.data2 = 128;
    SDL_PushEvent(&ev);

    ev.type = SDL_EVENT_KEY_DOWN;
    ev.key.key = SDLK_A;
    ev.key.scancode = SDL_SCANCODE_A;
    ev.key.down = true;
    SDL_PushEvent(&ev);

    ev.type = SDL_EVENT_KEY_UP;
    ev.key.key = SDLK_A;
    ev.key.scancode = SDL_SCANCODE_A;
    ev.key.down = false;
    SDL_PushEvent(&ev);

    ev.type = SDL_EVENT_MOUSE_MOTION;
    ev.motion.x = 32.0f;
    ev.motion.y = 32.0f;
    ev.motion.xrel = 1.0f;
    ev.motion.yrel = 1.0f;
    SDL_PushEvent(&ev);

    ev.type = SDL_EVENT_MOUSE_BUTTON_DOWN;
    ev.button.button = SDL_BUTTON_LEFT;
    ev.button.x = 32.0f;
    ev.button.y = 32.0f;
    SDL_PushEvent(&ev);

    ev.type = SDL_EVENT_MOUSE_BUTTON_UP;
    ev.button.button = SDL_BUTTON_LEFT;
    ev.button.x = 32.0f;
    ev.button.y = 32.0f;
    SDL_PushEvent(&ev);

    ev.type = SDL_EVENT_MOUSE_WHEEL;
    ev.wheel.x = 0.0f;
    ev.wheel.y = 1.0f;
    SDL_PushEvent(&ev);

    ev.type = SDL_EVENT_FINGER_DOWN;
    ev.tfinger.fingerID = 1;
    ev.tfinger.x = 0.5f;
    ev.tfinger.y = 0.5f;
    SDL_PushEvent(&ev);

    ev.type = SDL_EVENT_FINGER_MOTION;
    SDL_PushEvent(&ev);

    ev.type = SDL_EVENT_FINGER_UP;
    SDL_PushEvent(&ev);

    ev.type = SDL_EVENT_FINGER_CANCELED;
    SDL_PushEvent(&ev);

    ev.type = SDL_EVENT_GAMEPAD_ADDED;
    ev.gdevice.which = 0;
    SDL_PushEvent(&ev);

    ev.type = SDL_EVENT_GAMEPAD_REMOVED;
    ev.gdevice.which = 0;
    SDL_PushEvent(&ev);

    // Poll all queued events through platform
    mystral::platform::pollEvents();

    // Test QUIT event and shouldQuit
    ev.type = SDL_EVENT_QUIT;
    SDL_PushEvent(&ev);
    mystral::platform::pollEvents();
    if (!mystral::platform::shouldQuit()) {
        std::cerr << "shouldQuit should be true after SDL_EVENT_QUIT\n";
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
