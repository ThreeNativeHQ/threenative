// Input listeners must survive neither a disposed registration nor a restart.
//
// A game that calls stop() disposes its InputMap, which removeEventListener()s every
// window/document closure it registered, then a fresh InputMap registers again. If native
// removal is a no-op, the disposed closures keep receiving SDL-routed events and the
// restarted game sees ghost input from the previous life (PRD-177 phase 1). This test runs
// two register->dispose cycles against window and document and requires each dispatch to be
// delivered exactly once per live registration.

#include "mystral/runtime.h"

#include <iostream>

using mystral::Runtime;
using mystral::RuntimeConfig;

int main() {
    RuntimeConfig config;
    config.noSdl = true;
    config.width = 64;
    config.height = 64;
    auto runtime = Runtime::create(config);
    if (!runtime) {
        std::cerr << "FAILED: runtime creation\n";
        return 1;
    }

    const char* cycles = R"JS(
        (() => {
            const failures = [];

            // Cycle 1: register, receive exactly one event, dispose.
            const seenWindow = [];
            const firstWindow = (event) => seenWindow.push(`first:${event.code}`);
            window.addEventListener('keydown', firstWindow);
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA' }));
            window.removeEventListener('keydown', firstWindow);

            // Restart: a second InputMap registers its own closures and listens again.
            const secondWindow = (event) => seenWindow.push(`second:${event.code}`);
            window.addEventListener('keydown', secondWindow);
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA' }));

            if (seenWindow.length !== 2) {
                failures.push(`window delivered ${seenWindow.length} events across two register-dispose cycles (want 2): ${seenWindow.join(',')}`);
            }
            if (seenWindow[0] !== 'first:KeyA') failures.push(`window first delivery was ${seenWindow[0]}`);
            if (seenWindow[1] !== 'second:KeyA') failures.push(`window second delivery was ${seenWindow[1]}, the disposed listener must not ghost`);

            // Same contract on document.
            const seenDocument = [];
            const firstDocument = () => seenDocument.push('first');
            document.addEventListener('ping', firstDocument);
            document.dispatchEvent(new Event('ping'));
            document.removeEventListener('ping', firstDocument);
            const secondDocument = () => seenDocument.push('second');
            document.addEventListener('ping', secondDocument);
            document.dispatchEvent(new Event('ping'));
            if (seenDocument.length !== 2) {
                failures.push(`document delivered ${seenDocument.length} events across two register-dispose cycles (want 2): ${seenDocument.join(',')}`);
            }
            if (seenDocument[0] !== 'first' || seenDocument[1] !== 'second') {
                failures.push(`document deliveries were ${seenDocument.join(',')}`);
            }

            // Removing an unknown callback stays a silent no-op and must not break the
            // surviving listener.
            document.removeEventListener('ping', () => {});
            const seenAfterNoop = [];
            document.addEventListener('ping', () => seenAfterNoop.push('x'));
            document.dispatchEvent(new Event('ping'));
            if (seenAfterNoop.length !== 1) {
                failures.push(`surviving document listener fired ${seenAfterNoop.length} times after an unknown-callback removal`);
            }

            const mainCanvas = globalThis.canvas;
            let mainRemovedCalls = 0;
            const mainRemoved = () => { mainRemovedCalls += 1; };
            mainCanvas.addEventListener('pointerdown', mainRemoved, false);
            mainCanvas.removeEventListener('pointerdown', mainRemoved, false);
            mainCanvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2 }));
            if (mainRemovedCalls !== 0) {
                failures.push(`main canvas dispatched a removed callback ${mainRemovedCalls} times`);
            }

            let mainCaptureCalls = 0;
            const mainCapture = () => { mainCaptureCalls += 1; };
            mainCanvas.addEventListener('pointerup', mainCapture, true);
            mainCanvas.addEventListener('pointerup', mainCapture, { capture: false });
            mainCanvas.removeEventListener('pointerup', mainCapture, { capture: false });
            mainCanvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3 }));
            if (mainCaptureCalls !== 1) {
                failures.push(`main canvas capture identity delivered ${mainCaptureCalls} callbacks (want 1)`);
            }
            mainCanvas.removeEventListener('pointerup', mainCapture, true);

            const rendererCanvas = document.createElement('canvas');
            let forwardedRemovedCalls = 0;
            const forwardedRemoved = () => { forwardedRemovedCalls += 1; };
            rendererCanvas.addEventListener('pointerdown', forwardedRemoved, true);
            rendererCanvas.removeEventListener('pointerdown', forwardedRemoved, true);
            rendererCanvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 4 }));
            if (forwardedRemovedCalls !== 0) {
                failures.push(`renderer canvas dispatched a removed callback ${forwardedRemovedCalls} times`);
            }

            let forwardedCaptureCalls = 0;
            const forwardedCapture = () => { forwardedCaptureCalls += 1; };
            rendererCanvas.addEventListener('pointerup', forwardedCapture, true);
            rendererCanvas.addEventListener('pointerup', forwardedCapture, { capture: false });
            rendererCanvas.removeEventListener('pointerup', forwardedCapture, { capture: false });
            rendererCanvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 5 }));
            if (forwardedCaptureCalls !== 1) {
                failures.push(`renderer canvas capture identity delivered ${forwardedCaptureCalls} callbacks (want 1)`);
            }
            rendererCanvas.removeEventListener('pointerup', forwardedCapture, true);

            if (failures.length > 0) {
                console.error('[input-restart] ' + failures.join('; '));
                process.exit(1);
            }
            return true;
        })()
    )JS";
    if (!runtime->evalScript(cycles, "input-restart-cycles")) {
        std::cerr << "FAILED: restart cycles threw\n";
        return 1;
    }
    if (runtime->getExitCode() != 0) {
        std::cerr << "FAILED: input delivered to disposed listeners after restart, exit "
                  << runtime->getExitCode() << "\n";
        return 1;
    }

    std::cout << "[input-restart] listener identity and capture survived restart, main canvas, and renderer canvas"
              << std::endl;
    return 0;
}
