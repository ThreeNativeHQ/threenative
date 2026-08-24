#include "mystral/platform/ui_overlay.h"

#include <atomic>
#include <deque>
#include <mutex>

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
    g_attached.store(attached, std::memory_order_relaxed);
}

bool postUiMessage(const std::string& frame) {
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
