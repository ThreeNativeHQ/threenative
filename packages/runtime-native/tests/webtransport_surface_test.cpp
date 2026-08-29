// WebTransport JS-surface contract: constructing a WebTransport with a URL the
// native side cannot parse must reject `ready` with a WebTransportError, the
// low-level bridge must refuse malformed calls with 0, and a failed connect
// must leave no session behind. Drives the real runtime with its installed
// polyfill — no sockets are opened, because every probe URL fails `parseUrl`.

#include "mystral/runtime.h"
#include "mystral/webtransport/webtransport.h"

#include <chrono>
#include <iostream>
#include <thread>

namespace {

constexpr int kCompletionExitCode = 42;

constexpr const char* kScript = R"JS((() => {
  const ok = [];
  ok.push(typeof WebTransport === 'function');
  ok.push(typeof WebTransportError === 'function');
  ok.push(__wtConnect() === 0);
  ok.push(__wtConnect('') === 0);
  ok.push(__wtConnect('http://example.com:4433/') === 0);

  const bad = [
    'not-a-url',
    '',
    'http://example.com:4433/',
    'https://example.com/',
    'https://:4433/',
    'https://example.com:0/',
    'https://example.com:65536/',
  ];

  const settled = [];
  const pending = bad.map((url) => {
    const wt = new WebTransport(url);
    return wt.ready.then(
      () => settled.push(url + '=RESOLVED'),
      (e) => settled.push(url + '=' + (e instanceof WebTransportError ? 'REJECTED' : 'REJECTED-OTHER')),
    );
  });
  // closed must reject alongside ready for a failed initiate.
  pending.push(new WebTransport('not-a-url').closed.then(
    () => settled.push('closed=RESOLVED'),
    () => settled.push('closed=REJECTED'),
  ));

  Promise.all(pending).then(() => {
    setTimeout(() => {
      const allRejected = settled.every((m) => m.endsWith('REJECTED'));
      process.exit(ok.every(Boolean) && allRejected ? 42 : 1);
    }, 0);
  });
})())JS";

}  // namespace

int main() {
    mystral::RuntimeConfig config;
    config.width = 1;
    config.height = 1;
    config.noSdl = true;

    auto runtime = mystral::Runtime::create(config);
    if (!runtime) {
        std::cerr << "could not create headless native runtime\n";
        return 1;
    }

    if (!runtime->evalScript(kScript, "webtransport_surface_test.js")) {
        std::cerr << "could not schedule webtransport surface contract\n";
        return 1;
    }

    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    bool timedOut = false;
    while (runtime->pollEvents()) {
        if (runtime->getExitCode() == kCompletionExitCode) {
            break;
        }
        if (std::chrono::steady_clock::now() >= deadline) {
            timedOut = true;
            break;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }

    const int exitCode = runtime->getExitCode();
    if (exitCode != kCompletionExitCode) {
        if (timedOut || exitCode == 0) {
            std::cerr << "webtransport surface contract timed out before completion\n";
        } else {
            std::cerr << "webtransport surface contract failed with exit " << exitCode << '\n';
        }
        return 1;
    }

    // A refused initiate must not leave a session behind.
    if (mystral::webtransport::hasActiveSessions()) {
        std::cerr << "failed connects must not leave active sessions\n";
        return 1;
    }

    std::cout << "native webtransport surface contract passed\n";
    return 0;
}
