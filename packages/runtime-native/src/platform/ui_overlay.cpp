#include "mystral/platform/ui_overlay.h"

#include "mystral/cold_start.h"

#include <atomic>
#include <deque>
#include <iostream>
#include <mutex>

#include <cstdio>

#if defined(__APPLE__)
#include <TargetConditionals.h>
#endif

#if TN_ENABLE_UI_OVERLAY
extern "C" {
int tn_ui_overlay_attach(unsigned long parent, const char* url, uint32_t width, uint32_t height);
int tn_ui_overlay_pump();
int tn_ui_overlay_post(const char* frame);
char* tn_ui_overlay_take();
void tn_ui_overlay_free(char* frame);
int tn_ui_overlay_set_bounds(int32_t x, int32_t y, uint32_t width, uint32_t height);
int tn_ui_overlay_set_hit_regions(const float* regions, uint32_t count);
void tn_ui_overlay_detach();
}
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

/**
 * A HUD publishes its rectangles on layout change and its intents on a tap, so a healthy run
 * queues single-digit frames per tick. A backlog past this means the game stopped draining —
 * paused, or wedged — and the newest frames are the ones worth keeping.
 */
constexpr size_t kMaxQueuedUiMessages = 256;

}  // namespace

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

#if TN_ENABLE_UI_OVERLAY
namespace {

/** The reason an attach failed, in the words a reader can act on. */
const char* attachFailure(int code) {
    switch (code) {
        case -1: return "no display, or GTK could not start";
        case -2: return "no compositing manager is running, so nothing would blend the overlay";
        case -3: return "the transparent container could not be created";
        case -4: return "the web view could not be built";
        default: return "invalid argument";
    }
}

}  // namespace

bool attachDesktopUiOverlay(const std::string& uiRoot) {
    auto* window = mystral::platform::getSDLWindow();
    if (window == nullptr) return false;
    const auto properties = SDL_GetWindowProperties(window);
    // X11 only, and deliberately so: this is the surface `wry` accepts on Linux, and a Wayland
    // session reaches it through XWayland. Say which rather than failing as "unsupported".
    const auto parent = static_cast<unsigned long>(
        SDL_GetNumberProperty(properties, SDL_PROP_WINDOW_X11_WINDOW_NUMBER, 0));
    if (parent == 0) {
        std::cout << "TN_UI_OVERLAY:{\"attached\":false,\"reason\":\"the game window is not an X11 "
                     "window; run SDL under X11 (SDL_VIDEODRIVER=x11)\"}"
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
    // The overlay follows the game window from the X server's own events — move, resize, restack,
    // map, unmap — so nothing here pushes SDL's rectangle at it. A game window that has gone away
    // reports back once, and the overlay comes down with it rather than outliving its game.
    if (tn_ui_overlay_pump() != 0) {
        std::cout << "TN_UI_OVERLAY:{\"attached\":false,\"reason\":\"the game window went away\"}"
                  << std::endl;
        detachDesktopUiOverlay();
        return;
    }
    // The page's frames arrive on this thread through the pump, so draining here keeps the whole
    // desktop path single-threaded and the queue below is only ever touched from one side.
    while (char* frame = tn_ui_overlay_take()) {
        queueUiMessage(std::string(frame));
        tn_ui_overlay_free(frame);
    }
}

void setUiHitRegions(const std::vector<float>& regions) {
    if (!uiOverlayAttached()) return;
    tn_ui_overlay_set_hit_regions(regions.empty() ? nullptr : regions.data(),
                                  static_cast<uint32_t>(regions.size() / 4));
}

void detachDesktopUiOverlay() {
    if (!uiOverlayAttached()) return;
    tn_ui_overlay_detach();
    setUiOverlayAttached(false);
}
#else
bool attachDesktopUiOverlay(const std::string& uiRoot) {
    (void)uiRoot;
    return false;
}
void pumpUiOverlay() {}
void setUiHitRegions(const std::vector<float>& regions) { (void)regions; }
void detachDesktopUiOverlay() {}
#endif

bool postUiMessage(const std::string& frame) {
#if TN_ENABLE_UI_OVERLAY
    if (uiOverlayAttached()) return tn_ui_overlay_post(frame.c_str()) == 0;
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

}  // extern "C"
#endif
