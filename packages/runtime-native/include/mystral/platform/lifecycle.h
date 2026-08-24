#pragma once

/**
 * Application lifecycle: what the host does when the player leaves and comes back.
 *
 * The event pump handled QUIT, resize, keys, pointers, fingers and gamepads, and no lifecycle
 * event of any kind. Confirmed on a physical Pixel 8 on 2026-08-23: the loop kept presenting for
 * the full 60 s the screen was off. Desktop minimize is equally exposed.
 *
 * SDL 3.2.8 on Android decides the mechanism. `WILL_ENTER_BACKGROUND` / `DID_ENTER_BACKGROUND`
 * are queued and the pump *then blocks* inside `Android_WaitLifecycleEvent`
 * (`SDL_androidevents.c`, BlockOnPause default true), so a poll-based pause can never run: by
 * the time `SDL_PollEvent` would return the event, the thread is already parked.
 * `SDL_AddEventWatch` is synchronous at send time, which is why it is the only correct hook.
 *
 * The watch therefore runs on SDL's sending thread. It does the smallest safe thing — flips an
 * atomic and queues a marker — and the main loop does the rest.
 */

#include <cstdint>
#include <string>

namespace mystral {
namespace platform {

/**
 * `display.backgroundMode`.
 *
 * **Default is `Continue` as of 2026-08-23, and that is a deliberate retreat.** `Pause` is what
 * this feature is for and it will be the default again, but pausing exposed a worse defect than
 * the one it fixed: Android destroys the `ANativeWindow` on background and the `WGPUSurface` still
 * points at it, so resume restarts the loop and presents nothing — `frames` run away at ~600/s
 * while `presents` stays frozen and the screen is uniformly black. Measured on a physical Pixel 8,
 * 2026-08-23; see `docs/bugs/resume-presents-nothing-2026-08-23.md`.
 *
 * Bug 9 — the loop drawing with the screen off — was a battery cost no player ever saw. A black
 * screen after any phone call, notification or screen timeout is one every player sees, in the
 * mode they did not choose. Between an unsurfaced cost and a visible break, ship the unsurfaced
 * one until the surface is revalidated on resume.
 *
 * Nothing else retreats: the watch, the markers and the paused flag are all still live and still
 * measured under `Continue`, so turning the convention off has not turned its measurement off.
 */
enum class BackgroundMode { Pause, Continue };

/** What a given SDL event means for the loop. */
enum class LifecycleAction {
    /** Not a lifecycle event. */
    None,
    /** Stop running frames: background, minimize, hide. */
    Pause,
    /** Revalidate the surface and run frames again. */
    Resume,
    /** Terminal and fail-closed: the window or the app is going away. */
    Terminate,
    /** Recorded in the marker stream, no behaviour change (occlusion, focus). */
    RecordOnly,
};

/**
 * The whole event mapping, as a pure function of the SDL event type, so it can be proven without
 * backgrounding an application.
 *
 * Focus is deliberately `RecordOnly`. A desktop game that loses focus to a split screen or a
 * second monitor is still on screen, and on Android focus loss accompanies a real pause rather
 * than being one — pausing on focus alone would stop games that should keep running.
 */
LifecycleAction lifecycleActionFor(uint32_t sdlEventType);

/** Name for a marker payload; stable, because gates match on it. */
const char* lifecycleActionName(LifecycleAction action);

/** Parses `display.backgroundMode`. Unrecognized input keeps the default and reports false. */
bool parseBackgroundMode(const char* name, BackgroundMode& out);
const char* backgroundModeName(BackgroundMode mode);

/**
 * Installs the SDL event watch. Idempotent — calling it twice installs one watch.
 * Returns false when SDL refuses, which is a startup failure, not something to paper over.
 */
bool installLifecycleWatch();

/** Removes the watch. Safe to call when none is installed. */
void removeLifecycleWatch();

/**
 * Sets the mode. Turning pausing off must not turn the reporting off, so the markers are emitted
 * either way and name the mode that executed.
 */
void setBackgroundMode(BackgroundMode mode);
BackgroundMode backgroundMode();

/** True while the host must not run frames. Always false under `BackgroundMode::Continue`. */
bool isPaused();

/** True once a terminal event arrived; the loop must exit rather than keep presenting. */
bool isTerminating();

/**
 * Feeds one event to the lifecycle state, exactly as the watch does. Exposed so the transition
 * table is provable without SDL sending anything.
 */
void handleLifecycleEvent(uint32_t sdlEventType);

/** Counts a timer firing dropped while paused, so the resume marker can report how many. */
void noteDroppedTimerFiring();

/** Takes the dropped-firing count and resets it. */
uint64_t takeDroppedTimerFirings();

/**
 * Takes the next queued marker payload, or returns false. Called from the main loop so the
 * marker is written by the thread that owns stdio, not by SDL's sending thread.
 */
bool takeLifecycleMarker(std::string& marker);

/** Resets every bit of lifecycle state. For tests, and for a runtime that restarts in-process. */
void resetLifecycleForTesting();

}  // namespace platform
}  // namespace mystral
