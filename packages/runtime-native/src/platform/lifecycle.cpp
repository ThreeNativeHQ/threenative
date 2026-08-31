#include "mystral/platform/lifecycle.h"

#include "mystral/audio/audio_context.h"

#include <atomic>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <fstream>
#include <mutex>
#include <sstream>

#include <SDL3/SDL.h>

#if defined(__ANDROID__)
#include <jni.h>
#include <malloc.h>
#include <sys/system_properties.h>
#if !defined(__ANDROID_API__) || __ANDROID_API__ < 26
// mallopt() was added to the NDK surface in API 26. Keep the minimum API 24 build loadable on
// older devices: the weak reference resolves to null there, and the trim remains best effort.
extern "C" int mallopt(int, int) __attribute__((weak));
#endif
#elif defined(__GLIBC__)
#include <malloc.h>
#endif

#if defined(__ANDROID__) || defined(__linux__)
#include <unistd.h>
#endif

namespace mystral {
namespace platform {

namespace {

std::atomic<bool> g_paused{false};
std::atomic<bool> g_terminating{false};
std::atomic<bool> g_watchInstalled{false};
std::atomic<uint64_t> g_droppedTimerFirings{0};
std::atomic<bool> g_surfaceRevalidationPending{false};
std::atomic<BackgroundMode> g_backgroundMode{BackgroundMode::Pause};
constexpr int kUnknownMemoryTrimLevel = -1;
// Android ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN. This is the pause-time trim signal; the
// Android level that warrants a pressure response is ComponentCallbacks2.TRIM_MEMORY_MODERATE.
constexpr int kTrimMemoryUiHidden = 20;
constexpr int kTrimMemoryModerate = 60;
std::atomic<int> g_pendingMemoryTrimLevel{kUnknownMemoryTrimLevel};

std::mutex g_markerMutex;
std::deque<std::string> g_markers;
std::mutex g_memoryTrimMutex;
std::deque<int> g_memoryTrimRequests;

struct MemoryTrimStats {
    uint64_t rssBeforeKb = 0;
    uint64_t rssAfterKb = 0;
    bool allocatorTrimmed = false;
};

constexpr size_t kMaxMemoryTrimRequests = 32;

uint64_t residentSetKb() {
#if defined(__ANDROID__) || defined(__linux__)
    std::ifstream statm("/proc/self/statm");
    uint64_t totalPages = 0;
    uint64_t residentPages = 0;
    const long pageSize = sysconf(_SC_PAGESIZE);
    if (pageSize <= 0 || !(statm >> totalPages >> residentPages)) return 0;
    (void)totalPages;
    return residentPages * static_cast<uint64_t>(pageSize) / 1024;
#else
    return 0;
#endif
}

void queueMemoryTrimRequest(int level) {
    std::lock_guard<std::mutex> lock(g_memoryTrimMutex);
    if (g_memoryTrimRequests.size() >= kMaxMemoryTrimRequests) g_memoryTrimRequests.pop_front();
    g_memoryTrimRequests.push_back(level);
}

MemoryTrimStats trimHostMemory() {
    MemoryTrimStats stats;
    stats.rssBeforeKb = residentSetKb();
#if defined(__ANDROID__)
    // bionic has no malloc_trim(). M_PURGE is the public Android allocator hook and is available
    // from API 28; mallopt itself is weak on the API-24/25 build so those devices simply report a
    // no-op instead of failing to load the runtime.
    stats.allocatorTrimmed = ::mallopt != nullptr && ::mallopt(M_PURGE, 0) != 0;
#elif defined(__GLIBC__)
    stats.allocatorTrimmed = malloc_trim(0) != 0;
#endif
    stats.rssAfterKb = residentSetKb();
    return stats;
}

void queueMemoryTrimMarker(int level, const char* source, const char* action,
                           const MemoryTrimStats& stats) {
    std::ostringstream out;
    out << "TN_LIFECYCLE_MEMORY_TRIM:{\"level\":" << level << ",\"source\":\"" << source
        << "\",\"action\":\"" << action << "\",\"allocatorTrimmed\":"
        << (stats.allocatorTrimmed ? "true" : "false") << ",\"rssBeforeKb\":"
        << stats.rssBeforeKb << ",\"rssAfterKb\":" << stats.rssAfterKb
        << ",\"rssDeltaKb\":"
        << static_cast<int64_t>(stats.rssAfterKb) - static_cast<int64_t>(stats.rssBeforeKb)
        << "}";
    std::lock_guard<std::mutex> lock(g_markerMutex);
    if (g_markers.size() < 256) g_markers.push_back(out.str());
}

bool processMemoryTrim(int level, const char* source, bool force) {
    const bool shouldTrim = force || level == kUnknownMemoryTrimLevel || level >= kTrimMemoryModerate;
    MemoryTrimStats stats;
    if (shouldTrim) {
        stats = trimHostMemory();
    } else {
        stats.rssBeforeKb = residentSetKb();
        stats.rssAfterKb = stats.rssBeforeKb;
    }
    queueMemoryTrimRequest(level);
    queueMemoryTrimMarker(level, source, shouldTrim ? "trim" : "observed", stats);
    return shouldTrim;
}

void queueMarker(LifecycleAction action, uint32_t sdlEventType, bool applied) {
    std::ostringstream out;
    out << "TN_LIFECYCLE:{\"event\":\"" << lifecycleActionName(action) << "\",\"sdlEvent\":"
        << sdlEventType << ",\"mode\":\"" << backgroundModeName(g_backgroundMode.load())
        << "\",\"applied\":" << (applied ? "true" : "false")
        << ",\"droppedTimerFirings\":" << g_droppedTimerFirings.load() << "}";
    std::lock_guard<std::mutex> lock(g_markerMutex);
    // A backgrounded app can queue several of these before the loop runs again; keep them all but
    // do not let a pathological sender grow this without bound.
    if (g_markers.size() < 256) g_markers.push_back(out.str());
}

bool SDLCALL lifecycleEventWatch(void* /*userdata*/, SDL_Event* event) {
    if (event != nullptr) handleLifecycleEvent(event->type);
    // Never consume the event: the ordinary pump still wants QUIT and the resize events.
    return true;
}

}  // namespace

LifecycleAction lifecycleActionFor(uint32_t sdlEventType) {
    switch (sdlEventType) {
        // Mobile. WILL_ENTER_BACKGROUND is the last event delivered before SDL parks the pump on
        // Android, so the pause has to be applied here rather than one event later.
        case SDL_EVENT_WILL_ENTER_BACKGROUND:
        case SDL_EVENT_DID_ENTER_BACKGROUND:
        // Desktop.
        case SDL_EVENT_WINDOW_MINIMIZED:
        case SDL_EVENT_WINDOW_HIDDEN:
            return LifecycleAction::Pause;

        case SDL_EVENT_WILL_ENTER_FOREGROUND:
        case SDL_EVENT_DID_ENTER_FOREGROUND:
        case SDL_EVENT_WINDOW_RESTORED:
        case SDL_EVENT_WINDOW_SHOWN:
            return LifecycleAction::Resume;

        case SDL_EVENT_TERMINATING:
        case SDL_EVENT_WINDOW_DESTROYED:
        case SDL_EVENT_WINDOW_CLOSE_REQUESTED:
            return LifecycleAction::Terminate;

        case SDL_EVENT_LOW_MEMORY:
            return LifecycleAction::MemoryTrim;

        // Recorded only, deliberately. Focus is not visibility, and occlusion has not yet been
        // shown to fire usefully on any target here.
        case SDL_EVENT_WINDOW_FOCUS_LOST:
        case SDL_EVENT_WINDOW_FOCUS_GAINED:
        case SDL_EVENT_WINDOW_OCCLUDED:
        case SDL_EVENT_WINDOW_EXPOSED:
            return LifecycleAction::RecordOnly;

        default:
            return LifecycleAction::None;
    }
}

const char* lifecycleActionName(LifecycleAction action) {
    switch (action) {
        case LifecycleAction::None: return "none";
        case LifecycleAction::Pause: return "paused";
        case LifecycleAction::Resume: return "resumed";
        case LifecycleAction::Terminate: return "terminating";
        case LifecycleAction::MemoryTrim: return "memoryTrim";
        case LifecycleAction::RecordOnly: return "observed";
    }
    return "none";
}

bool parseBackgroundMode(const char* name, BackgroundMode& out) {
    if (name == nullptr || name[0] == '\0') return false;
    if (std::strcmp(name, "pause") == 0) {
        out = BackgroundMode::Pause;
        return true;
    }
    if (std::strcmp(name, "continue") == 0) {
        out = BackgroundMode::Continue;
        return true;
    }
    return false;
}

const char* backgroundModeName(BackgroundMode mode) {
    return mode == BackgroundMode::Continue ? "continue" : "pause";
}

void setBackgroundMode(BackgroundMode mode) { g_backgroundMode.store(mode); }

BackgroundMode backgroundMode() { return g_backgroundMode.load(); }

bool isPaused() { return g_paused.load(std::memory_order_acquire); }

bool isTerminating() { return g_terminating.load(std::memory_order_acquire); }

void handleLifecycleEvent(uint32_t sdlEventType) {
    const LifecycleAction action = lifecycleActionFor(sdlEventType);
    if (action == LifecycleAction::None) return;

    // `Continue` overrides the pause, never the reporting: a game that opted out still says so in
    // its marker stream, and a run that claims to have paused can be checked against it.
    const bool continueMode = g_backgroundMode.load() == BackgroundMode::Continue;

    switch (action) {
        case LifecycleAction::Pause: {
            const bool applied = !continueMode;
            if (applied) {
                const bool wasPaused = g_paused.exchange(true, std::memory_order_acq_rel);
                // Audio outlives the render loop — SDL keeps feeding its own thread — so the
                // registry is suspended here rather than left to the parked main loop.
                audio::suspendAllContexts();
                if (!wasPaused) processMemoryTrim(kTrimMemoryUiHidden, "pause", true);
            }
            queueMarker(action, sdlEventType, applied);
            break;
        }
        case LifecycleAction::Resume: {
            const bool applied = !continueMode;
            if (applied) {
                g_paused.store(false, std::memory_order_release);
                audio::resumeAllContexts();
            }
            // In both modes, and before the marker: Android destroyed the window while the app was
            // away whatever this host decided about pausing, so the surface the loop presents to is
            // stale either way. Clearing the paused flag alone is exactly the defect this fixes.
            requestSurfaceRevalidation();
            queueMarker(action, sdlEventType, applied);
            break;
        }
        case LifecycleAction::MemoryTrim: {
            const int level = g_pendingMemoryTrimLevel.exchange(
                kUnknownMemoryTrimLevel, std::memory_order_acq_rel);
            const char* source = level == kUnknownMemoryTrimLevel ? "sdl" : "android";
            const bool applied = processMemoryTrim(level, source, false);
            queueMarker(action, sdlEventType, applied);
            break;
        }
        case LifecycleAction::Terminate:
            // Fail closed: terminal whatever the mode says. `Continue` opts out of pausing, not
            // out of the window going away.
            g_terminating.store(true, std::memory_order_release);
            g_paused.store(true, std::memory_order_release);
            audio::suspendAllContexts();
            queueMarker(action, sdlEventType, true);
            break;
        case LifecycleAction::RecordOnly:
            queueMarker(action, sdlEventType, false);
            break;
        case LifecycleAction::None:
            break;
    }
}

bool installLifecycleWatch() {
    if (g_watchInstalled.load()) return true;
    if (!SDL_AddEventWatch(lifecycleEventWatch, nullptr)) return false;
    g_watchInstalled.store(true);
    return true;
}

void removeLifecycleWatch() {
    if (!g_watchInstalled.exchange(false)) return;
    SDL_RemoveEventWatch(lifecycleEventWatch, nullptr);
}

void requestSurfaceRevalidation() {
    g_surfaceRevalidationPending.store(true, std::memory_order_release);
}

bool surfaceRevalidationPending() {
    return g_surfaceRevalidationPending.load(std::memory_order_acquire);
}

bool takeSurfaceRevalidationRequest() {
    return g_surfaceRevalidationPending.exchange(false, std::memory_order_acq_rel);
}

void clearSurfaceRevalidationRequest() {
    g_surfaceRevalidationPending.store(false, std::memory_order_release);
}

void noteMemoryTrimLevel(int level) {
    g_pendingMemoryTrimLevel.store(level, std::memory_order_release);
}

bool takeMemoryTrimRequest(int& level) {
    std::lock_guard<std::mutex> lock(g_memoryTrimMutex);
    if (g_memoryTrimRequests.empty()) return false;
    level = g_memoryTrimRequests.front();
    g_memoryTrimRequests.pop_front();
    return true;
}

bool surfaceRevalidationDisabled() {
#if defined(__ANDROID__)
    char property[PROP_VALUE_MAX] = {};
    if (__system_property_get("debug.threenative.skip_surface_revalidate", property) > 0)
        return property[0] == '1';
#endif
    const char* configured = std::getenv("THREENATIVE_SKIP_SURFACE_REVALIDATE");
    return configured != nullptr && configured[0] == '1';
}

bool surfaceRevalidationForcedFailure() {
#if defined(__ANDROID__)
    char property[PROP_VALUE_MAX] = {};
    if (__system_property_get("debug.threenative.force_surface_revalidate_failure", property) > 0)
        return property[0] == '1';
#endif
    const char* configured = std::getenv("THREENATIVE_FORCE_SURFACE_REVALIDATE_FAILURE");
    return configured != nullptr && configured[0] == '1';
}

bool presentUncapped() {
#if defined(__ANDROID__)
    char property[PROP_VALUE_MAX] = {};
    if (__system_property_get("debug.threenative.present_uncapped", property) > 0)
        return property[0] == '1';
#endif
    const char* configured = std::getenv("THREENATIVE_PRESENT_UNCAPPED");
    return configured != nullptr && configured[0] == '1';
}

void noteDroppedTimerFiring() { g_droppedTimerFirings.fetch_add(1, std::memory_order_relaxed); }

uint64_t takeDroppedTimerFirings() {
    return g_droppedTimerFirings.exchange(0, std::memory_order_relaxed);
}

bool takeLifecycleMarker(std::string& marker) {
    std::lock_guard<std::mutex> lock(g_markerMutex);
    if (g_markers.empty()) return false;
    marker = g_markers.front();
    g_markers.pop_front();
    return true;
}

void resetLifecycleForTesting() {
    g_paused.store(false);
    g_terminating.store(false);
    g_droppedTimerFirings.store(0);
    g_surfaceRevalidationPending.store(false);
    g_pendingMemoryTrimLevel.store(kUnknownMemoryTrimLevel);
    g_backgroundMode.store(BackgroundMode::Pause);
    {
        std::lock_guard<std::mutex> lock(g_markerMutex);
        g_markers.clear();
    }
    {
        std::lock_guard<std::mutex> lock(g_memoryTrimMutex);
        g_memoryTrimRequests.clear();
    }
}

}  // namespace platform
}  // namespace mystral

#if defined(__ANDROID__)
extern "C" JNIEXPORT void JNICALL
Java_com_threenative_runtime_MystralActivity_nativeOnTrimMemory(JNIEnv*, jclass, jint level) {
    mystral::platform::noteMemoryTrimLevel(static_cast<int>(level));
}
#endif
