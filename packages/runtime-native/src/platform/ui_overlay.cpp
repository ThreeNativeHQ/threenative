#include "mystral/platform/ui_overlay.h"

#include "mystral/cold_start.h"

#include <atomic>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <iostream>
#include <memory>
#include <mutex>

#include <cstdio>

#if defined(__APPLE__)
#include <TargetConditionals.h>
#endif

#if TN_ENABLE_UI_OVERLAY
extern "C" {
int tn_ui_overlay_attach(unsigned long parent, const char* url, uint32_t width, uint32_t height);
int tn_ui_overlay_post(const char* frame);
char* tn_ui_overlay_take();
void tn_ui_overlay_free(char* frame);
int tn_ui_overlay_set_bounds(int32_t x, int32_t y, uint32_t width, uint32_t height);
int tn_ui_overlay_set_hit_regions(const float* regions, uint32_t count);
int tn_ui_overlay_hit_test(float nx, float ny);
int tn_ui_overlay_inject_pointer(const char* type, float nx, float ny, int buttons,
                                 int pointer_id);
#if defined(__linux__) && !defined(__ANDROID__)
int tn_ui_overlay_inject_key(uint32_t keycode, uint32_t modifiers, uint32_t group,
                             uint32_t time, int down);
int tn_ui_overlay_keyboard_captured();
#endif
void tn_ui_overlay_detach();
#if defined(_WIN32) || defined(__APPLE__)
int tn_ui_overlay_pump();
#endif
}

#if defined(__linux__) && !defined(__ANDROID__)
/**
 * The frame mailbox, on the Linux backend only.
 *
 * Windows and macOS composite a child web view themselves and have no frame to hand over, so the
 * declarations and the implementations below are gated rather than stubbed: a stub returning a
 * frame would be a lie the compositor could act on.
 */
extern "C" {
struct TnUiFrameLayout {
    const uint8_t* pixels;
    size_t length;
    uint32_t width;
    uint32_t height;
    uint32_t stride;
    uint64_t counter;
};
int tn_ui_overlay_frame(TnUiFrameLayout* out);
uint64_t tn_ui_overlay_frames_published();
}
#endif
#include "mystral/platform/window.h"
#include <SDL3/SDL.h>
#endif

#if defined(__ANDROID__)
#include <SDL3/SDL.h>
#include <SDL3/SDL_system.h>
#include <android/log.h>
#include <jni.h>
#endif

namespace mystral {
namespace platform {
namespace {

std::mutex g_mutex;
std::deque<std::string> g_inbound;
std::atomic<uint64_t> g_dropped{0};
std::atomic<bool> g_attached{false};

/** How many interactive rectangles the page last published, for the OS press verdict line. */
std::atomic<size_t> g_hitRegionCount{0};

/**
 * A HUD publishes its rectangles on layout change and its intents on a tap, so a healthy run
 * queues single-digit frames per tick. A backlog past this means the game stopped draining —
 * paused, or wedged — and the newest frames are the ones worth keeping.
 */
constexpr size_t kMaxQueuedUiMessages = 256;

#if defined(__ANDROID__)
/**
 * The latest page frame, published by the in-frame producer in `TnUiOverlay`.
 *
 * Android's default lane is wgpu-native, which has no external-texture import, so the producer's
 * buffer is read back to CPU pixels here and uploaded by the existing compose path
 * (`compositeUiOverlayToWebGPU` -> `uploadUiFrame`). Latest-wins: a frame that arrives while the
 * game is not looking replaces the one before it, so the composite never shows a stale page.
 *
 * A `shared_ptr` rather than a plain vector because the compositor holds the pointer across the
 * upload while the UI thread may publish the next frame. `uiOverlayFrame` retains the current
 * buffer until the following call, so a publish can never free a buffer mid-read.
 */
std::mutex g_androidFrameMutex;
std::shared_ptr<const std::vector<uint8_t>> g_androidFrame;
std::shared_ptr<const std::vector<uint8_t>> g_androidFrameRetained;
uint32_t g_androidFrameWidth = 0;
uint32_t g_androidFrameHeight = 0;
uint32_t g_androidFrameStride = 0;
uint64_t g_androidFrameCounter = 0;
std::atomic<uint64_t> g_androidFramesPublished{0};
std::atomic<bool> g_androidFrameRgba{false};
#endif

}  // namespace

#if defined(__ANDROID__)
/**
 * Publish one produced page frame, copied out of the producer's direct buffer.
 *
 * Called on Android's UI thread from the `TnUiOverlay` JNI callback; the copy is the CPU-readback
 * cost the wgpu lane pays instead of an external-texture import. Measured by the on-device probe
 * at ~1.1 ms for a full 1080x2400 `RGBA_8888` plane.
 */
void publishAndroidUiFrame(const void* pixels, size_t length, uint32_t width, uint32_t height,
                           uint32_t stride) {
    if (pixels == nullptr || length == 0 || width == 0 || height == 0 || stride == 0) return;
    auto owned = std::make_shared<std::vector<uint8_t>>(length);
    std::memcpy(owned->data(), pixels, length);
    std::lock_guard<std::mutex> lock(g_androidFrameMutex);
    g_androidFrame = std::move(owned);
    g_androidFrameWidth = width;
    g_androidFrameHeight = height;
    g_androidFrameStride = stride;
    g_androidFrameCounter += 1;
    g_androidFrameRgba.store(true, std::memory_order_relaxed);
    g_androidFramesPublished.store(g_androidFrameCounter, std::memory_order_relaxed);
}

/**
 * Hand back the latest produced page frame, retaining it until the following call.
 *
 * Defined outside `TN_ENABLE_UI_OVERLAY` because Android ships that flag off — its overlay is the
 * child WebView's own compositor, not the desktop offscreen host — so the frame seam must be
 * reachable on the disabled-overlay path too.
 */
bool takeAndroidUiOverlayFrame(UiOverlayFrame& frame) {
    std::lock_guard<std::mutex> lock(g_androidFrameMutex);
    if (!g_androidFrame || g_androidFrame->empty()) return false;
    g_androidFrameRetained = g_androidFrame;
    frame.pixels = g_androidFrameRetained->data();
    frame.length = g_androidFrameRetained->size();
    frame.width = g_androidFrameWidth;
    frame.height = g_androidFrameHeight;
    frame.stride = g_androidFrameStride;
    frame.counter = g_androidFrameCounter;
    frame.isRgba = g_androidFrameRgba.load(std::memory_order_relaxed);
    return true;
}
#endif

void queueUiMessage(std::string frame) {
    std::lock_guard<std::mutex> lock(g_mutex);
    while (g_inbound.size() >= kMaxQueuedUiMessages) {
        g_inbound.pop_front();
        g_dropped.fetch_add(1, std::memory_order_relaxed);
    }
    g_inbound.push_back(std::move(frame));
}

bool takeUiMessage(std::string& frame) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (g_inbound.empty()) return false;
    frame = std::move(g_inbound.front());
    g_inbound.pop_front();
    return true;
}

uint64_t droppedUiMessages() { return g_dropped.load(std::memory_order_relaxed); }

bool uiOverlayAttached() { return g_attached.load(std::memory_order_relaxed); }

void setUiOverlayAttached(bool attached) {
    const bool was = g_attached.exchange(attached, std::memory_order_relaxed);
    // Stamped on the cold-start clock, on every platform, because "the overlay never came up" and
    // "the overlay came up and the game could not talk to it" look identical in a screenshot and
    // are different bugs. PRD-218 needed to tell a 12-second HUD freeze caused by a late WebView
    // apart from one caused by a main loop too busy to drain its messages; only this timestamp,
    // against the frame markers on the same clock, separates them.
    if (was == attached) return;
    if (attached) mystral::coldStartMark("ui_overlay_attached");
    else mystral::coldStartMark("ui_overlay_detached");
}

size_t uiOverlayHitRegionCount() { return g_hitRegionCount.load(std::memory_order_relaxed); }

#if TN_ENABLE_UI_OVERLAY
namespace {

/** The reason an attach failed, in the words a reader can act on. */
const char* attachFailure(int code) {
    switch (code) {
        case -5: return "invalid argument";
#if defined(__linux__) && !defined(__ANDROID__)
        // The offscreen backend has no window and no compositor to need, so the only failures left
        // are "the web engine never came up" and "the game window is not an X11 window" (reported
        // above, before the call, because SDL is what knows it).
        case -1: return "no display, or GTK could not start";
        case -4: return "the web view could not be built";
#else
        case -1: return "the overlay is not attached";
        case -2: return "the web view could not be built";
        case -3: return "the game window's native view could not be reached";
#endif
        default: return "invalid argument";
    }
}

}  // namespace

bool attachDesktopUiOverlay(const std::string& uiRoot) {
    auto* window = mystral::platform::getSDLWindow();
    if (window == nullptr) return false;
    const auto properties = SDL_GetWindowProperties(window);
    // Each desktop hands `wry` the window it already owns, in that window system's own type: an
    // HWND on Windows, an NSWindow on macOS. Linux cannot attach to its X11 client the same way —
    // a child window occludes rather than blends — so there the overlay is an input-shaped
    // top-level, and a session without an X11 window says exactly that rather than "unsupported".
#if defined(_WIN32)
    const auto parent = reinterpret_cast<unsigned long>(
        SDL_GetPointerProperty(properties, SDL_PROP_WINDOW_WIN32_HWND_POINTER, nullptr));
    const char* missing = "the game window is not a Win32 window";
#elif defined(__APPLE__)
    const auto parent = reinterpret_cast<unsigned long>(
        SDL_GetPointerProperty(properties, SDL_PROP_WINDOW_COCOA_WINDOW_POINTER, nullptr));
    const char* missing = "the game window is not a Cocoa window";
#else
    const auto parent = static_cast<unsigned long>(
        SDL_GetNumberProperty(properties, SDL_PROP_WINDOW_X11_WINDOW_NUMBER, 0));
    const char* missing =
        "the game window is not an X11 window; run SDL under X11 (SDL_VIDEODRIVER=x11)";
#endif
    if (parent == 0) {
        std::cout << "TN_UI_OVERLAY:{\"attached\":false,\"reason\":\"" << missing << "\"}"
                  << std::endl;
        return false;
    }
    int width = 0;
    int height = 0;
    SDL_GetWindowSizeInPixels(window, &width, &height);
    const int code = tn_ui_overlay_attach(parent, uiRoot.c_str(), static_cast<uint32_t>(width),
                                          static_cast<uint32_t>(height));
    const bool attached = code == 0;
    setUiOverlayAttached(attached);
    if (attached) {
        std::cout << "TN_UI_OVERLAY:{\"attached\":true}" << std::endl;
    } else {
        std::cout << "TN_UI_OVERLAY:{\"attached\":false,\"reason\":\"" << attachFailure(code)
                  << "\"}" << std::endl;
    }
    return attached;
}

void pumpUiOverlay() {
    if (!uiOverlayAttached()) return;
#if defined(_WIN32) || defined(__APPLE__)
    // Windows and macOS still attach a child web view to the window SDL owns, and both still need
    // their service point here. Windows re-cuts its container's input region when a resize changes
    // its pixels; both notice through this that the game window has gone away. Linux has neither a
    // window to follow nor work to do: the offscreen web view runs on its own thread and the only
    // thing left on this one is the queue below.
    if (tn_ui_overlay_pump() != 0) {
        std::cout << "TN_UI_OVERLAY:{\"attached\":false,\"reason\":\"the game window went away\"}"
                  << std::endl;
        detachDesktopUiOverlay();
        return;
    }
#endif
    // Handing the page's frames to the game's own message queue. JavaScript may only be touched
    // from this thread, so this is the one crossing and the queue is the only thing it needs.
    while (char* frame = tn_ui_overlay_take()) {
        queueUiMessage(std::string(frame));
        tn_ui_overlay_free(frame);
    }
}

bool uiOverlayFrame(UiOverlayFrame& frame) {
#if defined(__linux__) && !defined(__ANDROID__)
    if (!uiOverlayAttached()) return false;
    TnUiFrameLayout layout{};
    if (tn_ui_overlay_frame(&layout) != 1) return false;
    frame.pixels = layout.pixels;
    frame.length = layout.length;
    frame.width = layout.width;
    frame.height = layout.height;
    frame.stride = layout.stride;
    frame.counter = layout.counter;
    return frame.pixels != nullptr && frame.length > 0;
#elif defined(__ANDROID__)
    return takeAndroidUiOverlayFrame(frame);
#else
    (void)frame;
    return false;
#endif
}

uint64_t uiOverlayFramesPublished() {
#if defined(__linux__) && !defined(__ANDROID__)
    if (!uiOverlayAttached()) return 0;
    return tn_ui_overlay_frames_published();
#elif defined(__ANDROID__)
    return g_androidFramesPublished.load(std::memory_order_relaxed);
#else
    return 0;
#endif
}

void uiOverlaySetSize(int width, int height) {
    if (!uiOverlayAttached() || width <= 0 || height <= 0) return;
    // The offscreen view is placed by its own size, not by a position: there is no window, so x and
    // y have nothing to move.
    tn_ui_overlay_set_bounds(0, 0, static_cast<uint32_t>(width), static_cast<uint32_t>(height));
}

void setUiHitRegions(const std::vector<float>& regions) {
    g_hitRegionCount.store(regions.size() / 4, std::memory_order_relaxed);
    if (!uiOverlayAttached()) return;
    tn_ui_overlay_set_hit_regions(regions.empty() ? nullptr : regions.data(),
                                  static_cast<uint32_t>(regions.size() / 4));
}

void detachDesktopUiOverlay() {
    if (!uiOverlayAttached()) return;
    uiOverlayRoutePointer("pointercancel", 0, 0, 0, 1);
    resetUiOverlayKeyboard();
    tn_ui_overlay_detach();
    setUiOverlayAttached(false);
}

bool uiOverlayHitTest(float nx, float ny) {
    if (!uiOverlayAttached()) return false;
    return tn_ui_overlay_hit_test(nx, ny) == 1;
}

/**
 * One line per state posted to the page and per pointer action routed to it, on the launch clock.
 *
 * PRD-398 asks for two ages that no screenshot can see: how long a state the game published takes to
 * reach the screen, and how long a pointer action takes to produce the response the player is owed.
 * Both start on this side of the bridge — the game thread posts state here, and every pointer action,
 * real or synthetic, enters at `uiOverlayRoutePointer` — and both end at a composited frame the game
 * thread also stamps (`TN_UI_COMPOSITE_TRACE`). One clock, one ordinal each, so a reader subtracts
 * two numbers from the same origin and pairs the *n*-th post with the *n*-th new page frame instead
 * of guessing from wall-clock timestamps.
 *
 * Off unless `TN_UI_LATENCY_TRACE` is set: a line per posted frame is noise in every other run.
 */
void traceUiLatency(const char* event, unsigned long long ordinal, const char* detail) {
    static const bool enabled = std::getenv("TN_UI_LATENCY_TRACE") != nullptr;
    if (!enabled) return;
    std::printf("TN_UI_LATENCY_TRACE:{\"event\":\"%s\",\"n\":%llu,\"detail\":\"%s\",\"atMs\":%.3f}\n",
                event, ordinal, detail, mystral::coldStartNowMs());
    std::fflush(stdout);
}

bool uiOverlayInjectPointer(const char* type, float nx, float ny, int buttons, int pointerId) {
    if (!uiOverlayAttached()) return false;
    return tn_ui_overlay_inject_pointer(type, nx, ny, buttons, pointerId) == 0;
}

bool uiOverlayInjectKey(uint32_t keycode, uint32_t modifiers, uint32_t group,
                        uint32_t time, bool down) {
#if TN_ENABLE_UI_OVERLAY && defined(__linux__) && !defined(__ANDROID__)
    if (!uiOverlayAttached()) return false;
    return tn_ui_overlay_inject_key(keycode, modifiers, group, time, down ? 1 : 0) == 0;
#else
    (void)keycode; (void)modifiers; (void)group; (void)time; (void)down;
    return false;
#endif
}

/**
 * Which side owns the pointer gesture in progress, and where it last was.
 *
 * Lives here rather than in either caller because there are two callers — the OS event loop on
 * Linux and the playtest bridge's synthetic input — and they must not be able to disagree. Nothing
 * else in this file is stateful.
 */
struct UiPointerGesture {
    bool uiOwned = false;
    bool gameOwned = false;
    float lastX = 0.0f;
    float lastY = 0.0f;

    bool route(const char* type, float nx, float ny, int buttons, int pointerId) {
        const std::string kind(type);
        if (kind == "pointercancel") {
            const bool owned = uiOwned;
            uiOverlayInjectPointer(type, lastX, lastY, 0, pointerId);
            uiOwned = false;
            gameOwned = false;
            return owned;
        }
        if (kind == "pointerdown" && !uiOwned && !gameOwned) {
            if (!uiOverlayHitTest(nx, ny)) {
                uiOverlayInjectPointer("pointercancel", nx, ny, 0, pointerId);
                gameOwned = true;
                return false;
            }
            uiOwned = true;
            lastX = nx;
            lastY = ny;
            uiOverlayInjectPointer(type, nx, ny, buttons, pointerId);
            return true;
        }
        if (kind == "pointerup") {
            if (!uiOwned) {
                if (buttons == 0) gameOwned = false;
                return false;
            }
            // Where the press landed, not where the release was reported. A synthetic release can
            // arrive with no position at all, and gating it on a hit test dropped the press the
            // page was already holding — measured as a loadout button that never activated.
            uiOverlayInjectPointer(nx < 0 || nx > 1 || ny < 0 || ny > 1 ? "pointercancel" : type,
                                   lastX, lastY, buttons, pointerId);
            if (buttons == 0) uiOwned = false;
            return true;
        }
        if (kind == "pointermove") {
            // The page observes every move, inside a UI island or not: an offscreen view has no
            // cursor, so hover is only ever what the host forwards. This is a side effect, not a
            // claim — the ownership rules below still decide whether the game also sees the move,
            // so motion is never stolen from it.
            uiOverlayInjectPointer(type, nx, ny, buttons, pointerId);
            if (uiOwned) {
                lastX = nx;
                lastY = ny;
                return true;
            }
            if (gameOwned) return false;
            if (!uiOverlayHitTest(nx, ny)) return false;
            lastX = nx;
            lastY = ny;
            return true;
        }
        if (uiOwned) {
            lastX = nx;
            lastY = ny;
            uiOverlayInjectPointer(type, nx, ny, buttons, pointerId);
            return true;
        }
        if (gameOwned) return false;
        if (!uiOverlayHitTest(nx, ny)) return false;
        lastX = nx;
        lastY = ny;
        uiOverlayInjectPointer(type, nx, ny, buttons, pointerId);
        return true;
    }
};
UiPointerGesture g_uiGesture;

bool uiOverlayKeyboardCaptured() {
#if defined(__linux__) && !defined(__ANDROID__)
    if (!uiOverlayAttached()) return false;
    return tn_ui_overlay_keyboard_captured() == 1;
#else
    return false;
#endif
}

bool uiOverlayRoutePointer(const char* type, float nx, float ny, int buttons, int pointerId) {
    if (!uiOverlayAttached() || type == nullptr) return false;
    // The arrival of a pointer action, before ownership is decided: this is the one function both
    // the OS event loop and the playtest bridge's synthetic input come through, so an action's age
    // is measured from here rather than from whichever side later claimed it.
    static unsigned long long routed = 0;
    traceUiLatency("pointer", ++routed, type);
    return g_uiGesture.route(type, nx, ny, buttons, pointerId);
}
#else
bool attachDesktopUiOverlay(const std::string& uiRoot) {
    (void)uiRoot;
    return false;
}
void pumpUiOverlay() {}
bool uiOverlayFrame(UiOverlayFrame& frame) {
#if defined(__ANDROID__)
    // The in-frame producer publishes here even though `TN_ENABLE_UI_OVERLAY` is off on Android:
    // this is the CPU-readback seam, not the desktop offscreen host.
    return takeAndroidUiOverlayFrame(frame);
#else
    (void)frame;
    return false;
#endif
}
uint64_t uiOverlayFramesPublished() {
#if defined(__ANDROID__)
    return g_androidFramesPublished.load(std::memory_order_relaxed);
#else
    return 0;
#endif
}
void uiOverlaySetSize(int width, int height) {
    (void)width;
    (void)height;
}
void setUiHitRegions(const std::vector<float>& regions) { (void)regions; }
void detachDesktopUiOverlay() {}
bool uiOverlayHitTest(float nx, float ny) {
    (void)nx;
    (void)ny;
    return false;
}
bool uiOverlayInjectPointer(const char* type, float nx, float ny, int buttons, int pointerId) {
    (void)type;
    (void)nx;
    (void)ny;
    (void)buttons;
    (void)pointerId;
    return false;
}
bool uiOverlayInjectKey(uint32_t keycode, uint32_t modifiers, uint32_t group,
                        uint32_t time, bool down) {
#if TN_ENABLE_UI_OVERLAY && defined(__linux__) && !defined(__ANDROID__)
    if (!uiOverlayAttached()) return false;
    return tn_ui_overlay_inject_key(keycode, modifiers, group, time, down ? 1 : 0) == 0;
#else
    (void)keycode; (void)modifiers; (void)group; (void)time; (void)down;
    return false;
#endif
}
bool uiOverlayKeyboardCaptured() { return false; }
bool uiOverlayRoutePointer(const char* type, float nx, float ny, int buttons, int pointerId) {
    (void)type;
    (void)nx;
    (void)ny;
    (void)buttons;
    (void)pointerId;
    return false;
}
#endif

bool postUiMessage(const std::string& frame) {
#if TN_ENABLE_UI_OVERLAY
    if (uiOverlayAttached()) {
        static unsigned long long posted = 0;
        traceUiLatency("post", ++posted, "");
        return tn_ui_overlay_post(frame.c_str()) == 0;
    }
#endif
#if defined(__APPLE__) && TARGET_OS_IPHONE
    if (uiOverlayAttached()) return postIosUiMessage(frame);
#endif
#if defined(__ANDROID__)
    if (!uiOverlayAttached()) return false;
    auto* environment = static_cast<JNIEnv*>(SDL_GetAndroidJNIEnv());
    auto activity = static_cast<jobject>(SDL_GetAndroidActivity());
    if (environment == nullptr || activity == nullptr) return false;
    jclass activityClass = environment->GetObjectClass(activity);
    if (activityClass == nullptr) {
        environment->DeleteLocalRef(activity);
        return false;
    }
    jmethodID method =
        environment->GetMethodID(activityClass, "postUiOverlayMessage", "(Ljava/lang/String;)V");
    bool sent = false;
    if (method != nullptr) {
        jstring value = environment->NewStringUTF(frame.c_str());
        if (value != nullptr) {
            environment->CallVoidMethod(activity, method, value);
            sent = environment->ExceptionCheck() == JNI_FALSE;
            environment->DeleteLocalRef(value);
        }
    }
    if (environment->ExceptionCheck() != JNI_FALSE) environment->ExceptionClear();
    environment->DeleteLocalRef(activityClass);
    environment->DeleteLocalRef(activity);
    return sent;
#else
    (void)frame;
    return false;
#endif
}

}  // namespace platform
}  // namespace mystral

#if defined(__ANDROID__)
extern "C" {

/**
 * The page posted a message. Called on Android's UI thread from the `androidx.webkit` message
 * listener, so it may only enqueue — the runtime drains on the thread that owns JavaScript.
 */
JNIEXPORT void JNICALL Java_com_threenative_runtime_TnUiOverlay_nativeUiMessage(
    JNIEnv* environment, jclass, jstring frame) {
    if (frame == nullptr) return;
    const char* text = environment->GetStringUTFChars(frame, nullptr);
    if (text == nullptr) return;
    mystral::platform::queueUiMessage(std::string(text));
    environment->ReleaseStringUTFChars(frame, text);
}

/** The overlay reports whether it came up. A failure to attach is never inferred from silence. */
JNIEXPORT void JNICALL Java_com_threenative_runtime_TnUiOverlay_nativeUiOverlayAttached(
    JNIEnv*, jclass, jboolean attached) {
    mystral::platform::setUiOverlayAttached(attached == JNI_TRUE);
    __android_log_print(ANDROID_LOG_INFO, "Mystral", "TN_UI_OVERLAY:{\"attached\":%s}",
                        attached == JNI_TRUE ? "true" : "false");
}

/**
 * The in-frame producer published one page frame.
 *
 * `pixels` is the producer's direct `ImageReader` plane buffer, valid only for this call; the
 * copy into the latest-wins mailbox happens here, on Android's UI thread.
 */
JNIEXPORT void JNICALL Java_com_threenative_runtime_TnUiOverlay_nativeUiFrame(
    JNIEnv* environment, jclass, jobject pixels, jint width, jint height, jint stride) {
    if (pixels == nullptr) return;
    void* data = environment->GetDirectBufferAddress(pixels);
    const jlong capacity = environment->GetDirectBufferCapacity(pixels);
    if (data == nullptr || capacity <= 0) return;
    mystral::platform::publishAndroidUiFrame(data, static_cast<size_t>(capacity),
                                             static_cast<uint32_t>(width),
                                             static_cast<uint32_t>(height),
                                             static_cast<uint32_t>(stride));
}

/**
 * The host names which composite path it took, so a run reports it rather than inferring it.
 *
 * `in-frame-cpu` is the wgpu Android lane (no external-texture import, CPU readback upload);
 * `child-window` is today's transparent child WebView. Never silently downgrade.
 */
JNIEXPORT void JNICALL Java_com_threenative_runtime_TnUiOverlay_nativeUiCompositePath(
    JNIEnv* environment, jclass, jstring path) {
    if (path == nullptr) return;
    const char* text = environment->GetStringUTFChars(path, nullptr);
    if (text == nullptr) return;
    __android_log_print(ANDROID_LOG_INFO, "Mystral", "TN_UI_COMPOSITE_PATH:{\"path\":\"%s\"}",
                        text);
    environment->ReleaseStringUTFChars(path, text);
}

}  // extern "C"
#endif
