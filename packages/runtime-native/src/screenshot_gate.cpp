#include "mystral/screenshot_gate.h"

namespace mystral {

ScreenshotGateResult awaitStartupCapture(const ScreenshotGateHooks& hooks,
                                         std::chrono::steady_clock::time_point deadline) {
    ScreenshotGateResult result;
    result.ready = hooks.isStartupReady();
    while (!result.ready && hooks.now() < deadline) {
        hooks.requestFrameScreenshot();
        if (!hooks.pollEvents()) {
            result.quit = true;
            break;
        }
        result.presents += 1;
        result.ready = hooks.isStartupReady();
    }

    // Anything captured up to here was drawn before the gate opened, which on a software
    // rasteriser is the loading screen. Drop it so the frame that gets saved is one the gate
    // has already vouched for. Only on a clean ready: a run that timed out or quit keeps
    // whatever it has, because a stale frame the caller reports honestly beats no frame at all.
    if (result.ready && !result.quit) {
        hooks.clearCapturedFrame();
    }

    result.captured = hooks.hasCapturedFrame();
    while (!result.captured && !result.quit && hooks.now() < deadline) {
        hooks.requestFrameScreenshot();
        if (!hooks.pollEvents()) {
            result.quit = true;
            break;
        }
        result.presents += 1;
        result.captured = hooks.hasCapturedFrame();
    }
    return result;
}

}  // namespace mystral
