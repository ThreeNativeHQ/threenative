#pragma once

// The ordering a screenshot run must hold: the frame it saves has to be one drawn *after* the
// game's startup gate opened, not merely "some frame, and the gate is open now".
//
// Those are different, and the difference is a whole class of red CI runs. `hasCapturedFrame()`
// is true from the first present, which on a slow host happens while the loading screen is still
// up. Waiting for `isStartupReady() && hasCapturedFrame()` therefore returns the instant readiness
// flips, with the capture buffer still holding the last frame from *before* it — the loading
// state. Run 33789430714 saved exactly that: 300 frames rendered, `TN_STARTUP_CAPTURE_READY:1`
// printed one line after the last `TN_SURFACE_FRAME` present, and a PNG of a progress bar at 92%
// with five distinct colours where a drawn starter frame carries about 17,000.
//
// It only bites when `StartupReadiness` resolves on its bounded window rather than on five
// in-budget frames — that is, on every software rasteriser, which is what CI has.
//
// The calls are injected rather than taken from a `Runtime&` so this ordering is provable without
// a display, a GPU or a game, which is the only way it gets a regression test at all.

#include <chrono>
#include <functional>

namespace mystral {

/** The runtime calls the gate drives, injectable so the ordering is testable off-device. */
struct ScreenshotGateHooks {
    /** Ask for the next presented frame to land in the capture buffer. */
    std::function<void()> requestFrameScreenshot;
    /** Pump one frame. False means the runtime quit and the gate must stop. */
    std::function<bool()> pollEvents;
    /** True once the game reported its startup gate open. */
    std::function<bool()> isStartupReady;
    /** True while the capture buffer holds a frame. */
    std::function<bool()> hasCapturedFrame;
    /** Drop whatever the capture buffer holds, so the next frame is the one that is saved. */
    std::function<void()> clearCapturedFrame;
    std::function<std::chrono::steady_clock::time_point()> now;
};

struct ScreenshotGateResult {
    /** The startup gate opened before the deadline. */
    bool ready = false;
    /** A frame is in the capture buffer. After a ready run it postdates readiness. */
    bool captured = false;
    /** The runtime quit while the gate was driving frames. */
    bool quit = false;
    /**
     * Frames the gate drove itself. Each is one present beyond the caller's requested frame
     * count, so a lane asserting one present per frame adds this to the request: the desktop
     * screenshot mode prints `TN_CAPTURE_REFRESH_PRESENTS` for exactly this purpose.
     */
    int presents = 0;
};

/**
 * Drive frames until the capture buffer holds a frame taken after the startup gate opened.
 *
 * Fails open, never closed: if the gate never opens, or the runtime quits, the buffer is left
 * exactly as it was so the caller can still save something and say plainly that it did.
 */
ScreenshotGateResult awaitStartupCapture(const ScreenshotGateHooks& hooks,
                                         std::chrono::steady_clock::time_point deadline);

}  // namespace mystral
