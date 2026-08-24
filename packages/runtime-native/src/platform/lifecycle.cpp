#include "mystral/platform/lifecycle.h"

#include "mystral/audio/audio_context.h"

#include <atomic>
#include <cstring>
#include <deque>
#include <mutex>
#include <sstream>

#include <SDL3/SDL.h>

namespace mystral {
namespace platform {

namespace {

std::atomic<bool> g_paused{false};
std::atomic<bool> g_terminating{false};
std::atomic<bool> g_watchInstalled{false};
std::atomic<uint64_t> g_droppedTimerFirings{0};
// See lifecycle.h: Continue until resume revalidates the surface.
std::atomic<BackgroundMode> g_backgroundMode{BackgroundMode::Continue};

std::mutex g_markerMutex;
std::deque<std::string> g_markers;

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

        // Recorded only, deliberately. Focus is not visibility, and occlusion has not yet been
        // shown to fire usefully on any target here.
        case SDL_EVENT_WINDOW_FOCUS_LOST:
        case SDL_EVENT_WINDOW_FOCUS_GAINED:
        case SDL_EVENT_WINDOW_OCCLUDED:
        case SDL_EVENT_WINDOW_EXPOSED:
        case SDL_EVENT_LOW_MEMORY:
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
                g_paused.store(true, std::memory_order_release);
                // Audio outlives the render loop — SDL keeps feeding its own thread — so the
                // registry is suspended here rather than left to the parked main loop.
                audio::suspendAllContexts();
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
    g_backgroundMode.store(BackgroundMode::Continue);
    std::lock_guard<std::mutex> lock(g_markerMutex);
    g_markers.clear();
}

}  // namespace platform
}  // namespace mystral
