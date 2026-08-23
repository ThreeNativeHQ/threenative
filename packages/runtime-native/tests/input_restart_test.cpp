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

    std::cout << "[input-restart] two register-dispose cycles delivered each event exactly once"
              << std::endl;
    return 0;
}
