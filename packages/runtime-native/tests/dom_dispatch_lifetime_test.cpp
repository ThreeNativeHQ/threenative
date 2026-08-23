// DOM dispatch must survive the frame boundary that clears frame handles.
//
// setupDOMEvents() captures the document and window handles by value inside the
// dispatchEvent lambdas. clearFrameHandles() deletes every unprotected persistent at
// the end of each frame, so an unprotected capture dangles and the next dispatch
// re-enters V8 through freed memory — the PRD-167 SIGSEGV inside
// UpdateDescriptorForValue. This test crosses one frame boundary and then dispatches
// on both targets, asserting each listener ran with its target identity intact.

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

    const char* setup = R"JS(
        globalThis.__windowBlur = [];
        globalThis.__documentPing = [];
        window.addEventListener('blur', (event) => {
            __windowBlur.push({
                targetIsWindow: event.target === window,
                currentTargetIsWindow: event.currentTarget === window,
            });
        });
        document.addEventListener('ping', (event) => {
            __documentPing.push({
                targetIsDocument: event.target === document,
                currentTargetIsDocument: event.currentTarget === document,
            });
        });
    )JS";
    if (!runtime->evalScript(setup, "dom-dispatch-lifetime-setup")) {
        std::cerr << "FAILED: setup eval\n";
        return 1;
    }

    // One frame: ends with clearFrameHandles(), which before the fix deleted the
    // backing persistents of the window and document handles captured above.
    runtime->pollEvents();

    // The checks run inside the script; any failed identity lands in process.exit(1)
    // with a console line naming it, because a wrong `target` here is exactly how the
    // host corrupts game state without crashing.
    const char* checkedDispatch = R"JS(
        (() => {
            const prevented = window.dispatchEvent(new Event('blur'));
            document.dispatchEvent(new Event('ping'));
            const w = __windowBlur[0] ?? {};
            const d = __documentPing[0] ?? {};
            const failures = [];
            if (__windowBlur.length !== 1) failures.push('window listener calls: ' + __windowBlur.length);
            if (w.targetIsWindow !== true) failures.push('event.target is not window');
            if (w.currentTargetIsWindow !== true) failures.push('event.currentTarget is not window');
            if (__documentPing.length !== 1) failures.push('document listener calls: ' + __documentPing.length);
            if (d.targetIsDocument !== true) failures.push('event.target is not document');
            if (d.currentTargetIsDocument !== true) failures.push('event.currentTarget is not document');
            if (prevented !== true) failures.push('dispatchEvent did not report default not prevented');
            if (failures.length > 0) {
                console.error('[dom-dispatch-lifetime] ' + failures.join('; '));
                process.exit(1);
            }
            return true;
        })()
    )JS";
    if (!runtime->evalScript(checkedDispatch, "dom-dispatch-lifetime-dispatch")) {
        std::cerr << "FAILED: dispatch eval threw\n";
        return 1;
    }
    if (runtime->getExitCode() != 0) {
        std::cerr << "FAILED: identity checks after the frame boundary, exit "
                  << runtime->getExitCode() << "\n";
        return 1;
    }

    std::cout << "[dom-dispatch-lifetime] window and document dispatch survived clearFrameHandles"
              << std::endl;
    return 0;
}
