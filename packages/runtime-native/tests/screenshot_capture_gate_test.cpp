// A screenshot run must save a frame drawn *after* the game's startup gate opened.
//
// The gate used to wait on `isStartupReady() && hasCapturedFrame()` as two independent flags.
// `hasCapturedFrame()` is true from the first present, which on a slow host happens while the
// loading screen is still up, so the wait ended the instant readiness flipped and saved the frame
// from *before* it. CI run 33789430714 shipped that PNG: a progress bar at 92%, five distinct
// colours against the ~17,000 a drawn starter frame carries, under a log that printed
// `TN_STARTUP_CAPTURE_READY:1` and `Rendered 300 frames`.
//
// The fake below is that run's shape: a frame is already captured when the gate starts, and
// readiness arrives several frames later. The assertion is on *which* frame is in the buffer at
// the end, which is the only thing the saved PNG is.
//
// Needs no display, per the native-contract lane.

#include "mystral/screenshot_gate.h"

#include <iostream>
#include <string>
#include <vector>

namespace {

/**
 * A runtime whose capture buffer remembers which frame it holds.
 *
 * Every polled frame presents, and a present captures — that is what `presentPendingSurface` does
 * — so the buffer always names the last frame driven since the most recent clear.
 */
struct FakeRuntime {
    int frame = 0;
    int capturedFrame = -1;
    int readyAtFrame = 0;
    int quitAtFrame = -1;
    int clears = 0;
    bool everRequestedAfterReady = false;
    std::chrono::steady_clock::time_point clock = std::chrono::steady_clock::now();

    bool ready() const { return frame >= readyAtFrame; }

    mystral::ScreenshotGateHooks hooks() {
        mystral::ScreenshotGateHooks h;
        h.requestFrameScreenshot = [this] {
            if (ready()) everRequestedAfterReady = true;
        };
        h.pollEvents = [this] {
            if (quitAtFrame >= 0 && frame >= quitAtFrame) return false;
            frame += 1;
            capturedFrame = frame;
            clock += std::chrono::milliseconds(16);
            return true;
        };
        h.isStartupReady = [this] { return ready(); };
        h.hasCapturedFrame = [this] { return capturedFrame >= 0; };
        h.clearCapturedFrame = [this] {
            clears += 1;
            capturedFrame = -1;
        };
        h.now = [this] { return clock; };
        return h;
    }
};

std::vector<std::string> failures;

void check(bool condition, const std::string& what) {
    if (!condition) failures.push_back(what);
}

/** The CI shape: a loading frame is already in the buffer and readiness is four frames away. */
void savesAFrameDrawnAfterReadiness() {
    FakeRuntime runtime;
    runtime.readyAtFrame = 4;
    runtime.capturedFrame = 0;  // captured during loading, before the gate ran
    const auto result = mystral::awaitStartupCapture(runtime.hooks(),
                                                     runtime.clock + std::chrono::seconds(30));
    check(result.ready, "the gate should report the startup gate open");
    check(result.captured, "the gate should report a frame in the buffer");
    check(!result.quit, "nothing quit");
    check(runtime.clears == 1, "the pre-readiness capture should be dropped exactly once");
    check(runtime.capturedFrame >= runtime.readyAtFrame,
          "the saved frame must postdate readiness, got frame " +
              std::to_string(runtime.capturedFrame) + " against readiness at " +
              std::to_string(runtime.readyAtFrame));
    check(runtime.everRequestedAfterReady, "a capture must be requested after readiness");
    check(result.presents == 5,
          "the gate names the presents it drove (four to readiness, one to refresh), got " +
              std::to_string(result.presents));
}

/** A healthy GPU run, where readiness is already true when the requested frames are done. */
void refreshesTheCaptureEvenWhenReadyOnEntry() {
    FakeRuntime runtime;
    runtime.readyAtFrame = 0;
    runtime.capturedFrame = 7;
    const auto result = mystral::awaitStartupCapture(runtime.hooks(),
                                                     runtime.clock + std::chrono::seconds(30));
    check(result.ready && result.captured, "a ready runtime still leaves a captured frame");
    check(runtime.clears == 1, "the buffer is refreshed rather than trusted");
    check(runtime.capturedFrame > 0, "the refreshed frame is a real one");
    check(result.presents == 1,
          "a refresh on entry is one named present, got " + std::to_string(result.presents));
}

/** A gate that never opens still leaves the caller something to save, and says it timed out. */
void failsOpenWhenReadinessNeverArrives() {
    FakeRuntime runtime;
    runtime.readyAtFrame = 1'000'000;
    runtime.capturedFrame = 3;
    const auto result = mystral::awaitStartupCapture(runtime.hooks(),
                                                     runtime.clock + std::chrono::milliseconds(160));
    check(!result.ready, "an unopened gate is reported as unopened");
    check(result.captured, "the frame already captured is kept rather than discarded");
    check(runtime.clears == 0, "a timed-out run must not throw away the only frame it has");
}

/** A runtime that quits mid-wait must not hang and must not lose its frame. */
void stopsWhenTheRuntimeQuits() {
    FakeRuntime runtime;
    runtime.readyAtFrame = 1'000'000;
    runtime.quitAtFrame = 2;
    runtime.capturedFrame = 1;
    const auto result = mystral::awaitStartupCapture(runtime.hooks(),
                                                     runtime.clock + std::chrono::seconds(30));
    check(result.quit, "a quit is reported");
    check(!result.ready, "a quit before readiness is not readiness");
    check(runtime.clears == 0, "a quit run keeps whatever it captured");
}

}  // namespace

int main() {
    savesAFrameDrawnAfterReadiness();
    refreshesTheCaptureEvenWhenReadyOnEntry();
    failsOpenWhenReadinessNeverArrives();
    stopsWhenTheRuntimeQuits();

    if (!failures.empty()) {
        for (const auto& failure : failures) {
            std::cerr << "[screenshot-capture-gate] " << failure << std::endl;
        }
        return 1;
    }
    std::cout << "native screenshot capture gate contract passed" << std::endl;
    return 0;
}
