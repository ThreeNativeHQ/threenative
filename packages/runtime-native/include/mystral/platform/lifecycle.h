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
 * The watch therefore runs on SDL's sending thread. It flips lifecycle atomics, trims host-owned
 * allocator memory when pressure warrants it, and queues markers/levels; the main loop does all
 * JavaScript and surface work on its owning thread.
 */

#include <cstdint>
#include <string>

namespace mystral {
namespace platform {

/**
 * `display.backgroundMode`.
 *
 * **Default is `Pause` again as of 2026-08-23**, restored from the `Continue` retreat once resume
 * revalidates the surface. The retreat existed because Android destroys the `ANativeWindow` on
 * background and the `WGPUSurface` kept pointing at the destroyed one, so resume restarted the
 * loop and presented nothing — `frames` ran away at ~600/s while `presents` stayed frozen and the
 * screen was uniformly black (physical Pixel 8, 2026-08-23,
 * `docs/bugs/resume-presents-nothing-2026-08-23.md`). Resume now rebuilds and reconfigures the
 * surface from the window Android hands back, and republishes it to the bindings, which is what
 * `LifecycleAction::Resume` always claimed to do.
 *
 * `Continue` remains the named override for a game that genuinely wants to keep rendering
 * off-screen — a server-shaped or split-screen game. Turning the pause off does not turn its
 * reporting off: the watch, the markers and the paused flag are live and measured in both modes.
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
    /** Answer a low-memory notification with host-owned trimming and a queued game callback. */
    MemoryTrim,
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

/**
 * Surface revalidation, the other half of resume.
 *
 * Android destroys the `ANativeWindow` behind a backgrounded app and hands back a **new** one when
 * the player returns. A `WGPUSurface` built at startup still points at the destroyed window, so
 * every present after resume goes nowhere: `wgpuSurfaceGetCurrentTexture` stops succeeding, the
 * frame never presents, and nothing paces the loop — measured at ~600 frames/s against a frozen
 * present count, with a uniformly black screen (physical Pixel 8, 2026-08-23).
 *
 * The lifecycle layer only records that a resume happened. The rebuild itself belongs to the
 * thread that owns the surface, so the loop takes the request and acts on it before it draws.
 * Requested in **both** modes: the window is destroyed by Android whatever this host decided about
 * pausing, so `Continue` needs the same rebuild.
 */
void requestSurfaceRevalidation();

/** True while a resume is waiting for its surface rebuild. */
bool surfaceRevalidationPending();

/** Takes the request, exactly once per resume. */
bool takeSurfaceRevalidationRequest();

/**
 * Records the Android `ComponentCallbacks2` level before SDL forwards its level-less
 * `SDL_EVENT_LOW_MEMORY` event to the lifecycle watch. The native activity calls this on Android's
 * UI thread; the watch consumes it synchronously and the runtime delivers the optional game hook
 * on the JavaScript thread.
 */
void noteMemoryTrimLevel(int level);

/** Takes the next memory-pressure notification for delivery to the JavaScript thread. */
bool takeMemoryTrimRequest(int& level);

/**
 * Drops a pending request without acting on it. Startup calls this after it has created and
 * configured the surface itself: the `WINDOW_SHOWN` that arrives while the host is still waiting
 * for its first valid window is not a resume, and rebuilding a surface that was built moments ago
 * would be one more thing that can fail on the first frame.
 */
void clearSurfaceRevalidationRequest();

/**
 * The negative control for the revalidation, in the same binary as the fix.
 *
 * True when `debug.threenative.skip_surface_revalidate` (Android) or
 * `THREENATIVE_SKIP_SURFACE_REVALIDATE` (everywhere) is `1`. It reinstates the defect exactly:
 * resume clears the paused flag and nothing else. Keeping the control here makes the device rung a
 * one-variable comparison instead of a build-to-build one, the same way
 * `debug.threenative.prefix_handlers` does for the crash handlers.
 */
bool surfaceRevalidationDisabled();

/** True only when the deterministic resume-failure harness asks every probe to fail. */
bool surfaceRevalidationForcedFailure();

/**
 * True when the host should configure its surface with an uncapped present mode.
 *
 * Reads `debug.threenative.present_uncapped` (Android) or `THREENATIVE_PRESENT_UNCAPPED`
 * (everywhere), `1` to enable, in the same shape as `surfaceRevalidationDisabled()`.
 *
 * The desktop CLI has carried `--no-vsync` since it existed; Android had no channel at all, so the
 * one question the device could not be asked was whether its frame rate is set by the work or by
 * the FIFO cadence. PRD-227 measured a frame pinned to exactly three 60 Hz vsyncs (50 ms) while
 * doing 25.27 ms of work, unmoved by a 40% work reduction and unmoved by 2.25× fewer pixels. This
 * is the one-variable comparison that separates those two, in one binary rather than two.
 *
 * Diagnostic only: it defaults off, and an uncapped present tears. Never enable it in a shipped
 * config, a preset, or a CI lane.
 */
bool presentUncapped();

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
