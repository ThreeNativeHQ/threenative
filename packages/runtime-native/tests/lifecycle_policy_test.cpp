// Backgrounding must stop the loop, and coming back must start it again.
//
// The event pump handled QUIT, resize, keys, pointers, fingers and gamepads and no lifecycle
// event of any kind, so a physical Pixel 8 kept presenting for the full 60 s its screen was off
// (bug 9, 2026-08-23). SDL 3.2.8 decides the mechanism: on Android the background events are
// queued and the pump *then* blocks inside `Android_WaitLifecycleEvent`, so a polled handler runs
// only after the app is already parked. `SDL_AddEventWatch` is synchronous at send time.
//
// This drives the real transition table and the real audio registry with real SDL event
// constants. It needs no window and no GPU: SDL runs on its dummy video and audio drivers, and
// the events are fed the way the watch feeds them.

#include "mystral/audio/audio_context.h"
#include "mystral/platform/lifecycle.h"

#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

#include <SDL3/SDL.h>

namespace {

using mystral::platform::BackgroundMode;
using mystral::platform::LifecycleAction;

std::vector<std::string> failures;

void check(bool condition, const std::string& what) {
    if (condition) {
        std::cout << "PASS " << what << '\n';
        return;
    }
    failures.push_back(what);
    std::cerr << "FAIL " << what << '\n';
}

std::vector<std::string> drainMarkers() {
    std::vector<std::string> markers;
    std::string marker;
    while (mystral::platform::takeLifecycleMarker(marker)) markers.push_back(marker);
    return markers;
}

bool anyMarkerContains(const std::vector<std::string>& markers, const std::string& needle) {
    for (const std::string& marker : markers)
        if (marker.find(needle) != std::string::npos) return true;
    return false;
}

struct EventCase {
    uint32_t event;
    const char* label;
    LifecycleAction expected;
};

const EventCase kEvents[] = {
    {SDL_EVENT_WILL_ENTER_BACKGROUND, "WILL_ENTER_BACKGROUND", LifecycleAction::Pause},
    {SDL_EVENT_DID_ENTER_BACKGROUND, "DID_ENTER_BACKGROUND", LifecycleAction::Pause},
    {SDL_EVENT_WINDOW_MINIMIZED, "WINDOW_MINIMIZED", LifecycleAction::Pause},
    {SDL_EVENT_WINDOW_HIDDEN, "WINDOW_HIDDEN", LifecycleAction::Pause},
    {SDL_EVENT_WILL_ENTER_FOREGROUND, "WILL_ENTER_FOREGROUND", LifecycleAction::Resume},
    {SDL_EVENT_DID_ENTER_FOREGROUND, "DID_ENTER_FOREGROUND", LifecycleAction::Resume},
    {SDL_EVENT_WINDOW_RESTORED, "WINDOW_RESTORED", LifecycleAction::Resume},
    {SDL_EVENT_WINDOW_SHOWN, "WINDOW_SHOWN", LifecycleAction::Resume},
    {SDL_EVENT_TERMINATING, "TERMINATING", LifecycleAction::Terminate},
    {SDL_EVENT_WINDOW_DESTROYED, "WINDOW_DESTROYED", LifecycleAction::Terminate},
    // Never a pause on focus alone: a desktop game in split screen is still on screen, and on
    // Android focus loss accompanies a real pause rather than being one.
    {SDL_EVENT_WINDOW_FOCUS_LOST, "WINDOW_FOCUS_LOST", LifecycleAction::RecordOnly},
    {SDL_EVENT_WINDOW_OCCLUDED, "WINDOW_OCCLUDED", LifecycleAction::RecordOnly},
    {SDL_EVENT_KEY_DOWN, "KEY_DOWN", LifecycleAction::None},
    {SDL_EVENT_MOUSE_MOTION, "MOUSE_MOTION", LifecycleAction::None},
};

}  // namespace

int main() {
#if defined(_WIN32)
    _putenv_s("SDL_AUDIO_DRIVER", "dummy");
    _putenv_s("SDL_VIDEO_DRIVER", "dummy");
#else
    setenv("SDL_AUDIO_DRIVER", "dummy", 1);
    setenv("SDL_VIDEO_DRIVER", "dummy", 1);
#endif

    // 1. The transition table, event by event.
    for (const EventCase& testCase : kEvents)
        check(mystral::platform::lifecycleActionFor(testCase.event) == testCase.expected,
              std::string("SDL_EVENT_") + testCase.label + " maps to " +
                  mystral::platform::lifecycleActionName(testCase.expected));

    // 2. Pause and resume, in the default mode.
    mystral::platform::resetLifecycleForTesting();
    check(!mystral::platform::isPaused(), "the loop starts unpaused");

    mystral::platform::handleLifecycleEvent(SDL_EVENT_DID_ENTER_BACKGROUND);
    check(mystral::platform::isPaused(), "backgrounding pauses the loop");
    std::vector<std::string> markers = drainMarkers();
    check(anyMarkerContains(markers, "TN_LIFECYCLE:{\"event\":\"paused\""),
          "the pause is reported as a TN_LIFECYCLE marker");
    check(anyMarkerContains(markers, "\"applied\":true"),
          "the pause marker says the pause was applied");

    mystral::platform::handleLifecycleEvent(SDL_EVENT_DID_ENTER_FOREGROUND);
    check(!mystral::platform::isPaused(), "foregrounding resumes the loop");
    check(anyMarkerContains(drainMarkers(), "TN_LIFECYCLE:{\"event\":\"resumed\""),
          "the resume is reported as a TN_LIFECYCLE marker");

    // 2b. Resume is not just "unset the flag": the surface it presents to died with the window.
    mystral::platform::resetLifecycleForTesting();
    check(mystral::platform::backgroundMode() == BackgroundMode::Pause,
          "the default background mode is pause");
    check(!mystral::platform::surfaceRevalidationPending(),
          "a host that has not resumed has nothing to revalidate");
    mystral::platform::handleLifecycleEvent(SDL_EVENT_DID_ENTER_BACKGROUND);
    check(!mystral::platform::surfaceRevalidationPending(),
          "backgrounding alone does not queue a rebuild; the window is not back yet");
    mystral::platform::handleLifecycleEvent(SDL_EVENT_DID_ENTER_FOREGROUND);
    check(mystral::platform::surfaceRevalidationPending(),
          "resuming queues the surface rebuild that resume never did");
    check(mystral::platform::takeSurfaceRevalidationRequest(),
          "the loop takes the request");
    check(!mystral::platform::surfaceRevalidationPending(),
          "and it is taken exactly once, so one resume is not rebuilt on every later frame");
    drainMarkers();

    // 2c. Android destroys the window whatever this host decided about pausing, so `continue`
    //     needs the same rebuild. The retreat that shipped `continue` as the default was living on
    //     this being untrue.
    mystral::platform::resetLifecycleForTesting();
    mystral::platform::setBackgroundMode(BackgroundMode::Continue);
    mystral::platform::handleLifecycleEvent(SDL_EVENT_DID_ENTER_BACKGROUND);
    mystral::platform::handleLifecycleEvent(SDL_EVENT_DID_ENTER_FOREGROUND);
    check(mystral::platform::surfaceRevalidationPending(),
          "backgroundMode=continue still queues the surface rebuild");
    mystral::platform::clearSurfaceRevalidationRequest();
    check(!mystral::platform::surfaceRevalidationPending(),
          "startup can drop a request it raised against a surface it just built");
    drainMarkers();

    // 2d. The negative control that reproduces the defect from the same binary.
    check(!mystral::platform::surfaceRevalidationDisabled(),
          "revalidation is on unless something explicitly asks for the pre-fix behaviour");
#if !defined(_WIN32)
    setenv("THREENATIVE_SKIP_SURFACE_REVALIDATE", "1", 1);
    check(mystral::platform::surfaceRevalidationDisabled(),
          "the documented control switch reinstates the pre-fix resume");
    setenv("THREENATIVE_SKIP_SURFACE_REVALIDATE", "0", 1);
    check(!mystral::platform::surfaceRevalidationDisabled(),
          "and anything but 1 leaves the fix in place");
    unsetenv("THREENATIVE_SKIP_SURFACE_REVALIDATE");
#endif

    // 3. Focus loss alone must not pause anything.
    mystral::platform::resetLifecycleForTesting();
    mystral::platform::handleLifecycleEvent(SDL_EVENT_WINDOW_FOCUS_LOST);
    check(!mystral::platform::isPaused(), "losing focus does not pause the loop");
    check(anyMarkerContains(drainMarkers(), "\"event\":\"observed\""),
          "losing focus is still recorded");

    // 4. The named override. Turning the pause off must not turn the reporting off.
    mystral::platform::resetLifecycleForTesting();
    mystral::platform::setBackgroundMode(BackgroundMode::Continue);
    mystral::platform::handleLifecycleEvent(SDL_EVENT_DID_ENTER_BACKGROUND);
    check(!mystral::platform::isPaused(), "backgroundMode=continue keeps the loop running");
    markers = drainMarkers();
    check(anyMarkerContains(markers, "\"mode\":\"continue\""),
          "the marker names the mode that executed");
    check(anyMarkerContains(markers, "\"applied\":false"),
          "the marker says the pause was not applied");

    // 5. Terminal events are terminal whatever the mode says.
    mystral::platform::handleLifecycleEvent(SDL_EVENT_TERMINATING);
    check(mystral::platform::isTerminating(),
          "a terminal event stops the loop even under backgroundMode=continue");
    check(anyMarkerContains(drainMarkers(), "\"event\":\"terminating\""),
          "the terminal event is reported");

    // 6. Mode parsing fails closed on anything it does not recognize.
    BackgroundMode parsed = BackgroundMode::Continue;
    check(mystral::platform::parseBackgroundMode("pause", parsed) && parsed == BackgroundMode::Pause,
          "\"pause\" parses");
    check(mystral::platform::parseBackgroundMode("continue", parsed) &&
              parsed == BackgroundMode::Continue,
          "\"continue\" parses");
    check(!mystral::platform::parseBackgroundMode("maybe", parsed),
          "an unrecognized backgroundMode is rejected rather than guessed");
    check(!mystral::platform::parseBackgroundMode(nullptr, parsed),
          "a missing backgroundMode is rejected rather than guessed");

    // 7. The audio registry. `suspend()` and `resume()` existed but were reachable only from
    //    JavaScript, which is exactly what stops running when an app is backgrounded.
    mystral::platform::resetLifecycleForTesting();
    if (SDL_InitSubSystem(SDL_INIT_AUDIO)) {
        auto context = std::make_unique<mystral::audio::AudioContext>();
        context->resume();
        const bool running = context->state() == mystral::audio::AudioContext::State::Running;
        check(mystral::audio::liveContextCount() >= 1,
              "a constructed AudioContext registers itself with the host");
        mystral::platform::handleLifecycleEvent(SDL_EVENT_DID_ENTER_BACKGROUND);
        if (running) {
            check(context->state() == mystral::audio::AudioContext::State::Suspended,
                  "backgrounding suspends every live AudioContext");
            check(context->hostSuspended(), "the host records that it owns the suspension");
            mystral::platform::handleLifecycleEvent(SDL_EVENT_DID_ENTER_FOREGROUND);
            check(context->state() == mystral::audio::AudioContext::State::Running,
                  "foregrounding resumes the contexts the host suspended");
        } else {
            std::cout << "SKIP audio suspension: this build's dummy device never reached Running\n";
        }

        // A context the game suspended is the game's business; the host must not resume it.
        context->suspend();
        mystral::platform::handleLifecycleEvent(SDL_EVENT_DID_ENTER_BACKGROUND);
        mystral::platform::handleLifecycleEvent(SDL_EVENT_DID_ENTER_FOREGROUND);
        check(context->state() == mystral::audio::AudioContext::State::Suspended,
              "resuming does not un-suspend a context the game suspended itself");

        const size_t before = mystral::audio::liveContextCount();
        context.reset();
        check(mystral::audio::liveContextCount() + 1 == before,
              "a destroyed AudioContext leaves the registry");
        SDL_QuitSubSystem(SDL_INIT_AUDIO);
    } else {
        failures.push_back("SDL audio could not start, so the registry was not proven");
        std::cerr << "FAIL SDL_InitSubSystem(SDL_INIT_AUDIO): " << SDL_GetError() << '\n';
    }

    // 8. The watch itself installs, and installs once.
    mystral::platform::resetLifecycleForTesting();
    if (SDL_InitSubSystem(SDL_INIT_VIDEO)) {
        check(mystral::platform::installLifecycleWatch(), "the SDL event watch installs");
        check(mystral::platform::installLifecycleWatch(), "installing twice is idempotent");

        // Push a real event through SDL so the watch is exercised on SDL's own send path, which
        // is the whole reason this is a watch and not a pump case.
        SDL_Event event = {};
        event.type = SDL_EVENT_DID_ENTER_BACKGROUND;
        SDL_PushEvent(&event);
        check(mystral::platform::isPaused(),
              "an event pushed through SDL reaches the watch synchronously, before any poll");
        mystral::platform::removeLifecycleWatch();
        SDL_QuitSubSystem(SDL_INIT_VIDEO);
    } else {
        failures.push_back("SDL video could not start, so the watch install was not proven");
        std::cerr << "FAIL SDL_InitSubSystem(SDL_INIT_VIDEO): " << SDL_GetError() << '\n';
    }

    if (!failures.empty()) {
        std::cerr << "native lifecycle policy contract failed:\n";
        for (const std::string& failure : failures) std::cerr << "  - " << failure << '\n';
        return 1;
    }
    std::cout << "native lifecycle policy contract passed\n";
    return 0;
}
