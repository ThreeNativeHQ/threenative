// WebTransport JS-surface contract: constructing a WebTransport with a URL the
// native side cannot parse must reject `ready` with a WebTransportError, the
// low-level bridge must refuse malformed calls with 0, and a failed connect
// must leave no session behind. Drives the real runtime with its installed
// polyfill — no sockets are opened: malformed URLs fail `parseUrl`, and the
// close-before-ready probe substitutes session creation before driving dispatch.

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

  // A native TLS failure can report closed without a preceding error event.
  // Isolate that dispatcher branch without opening a socket in this surface test.
  const nativeConnect = globalThis.__wtConnect;
  globalThis.__wtConnect = () => 4242;
  const closing = new WebTransport('https://127.0.0.1:4433/echo');
  globalThis.__wtConnect = nativeConnect;
  pending.push(closing.ready.then(
    () => settled.push('early-close-ready=RESOLVED'),
    (e) => settled.push('early-close-ready=' + (e instanceof WebTransportError ? 'REJECTED' : 'REJECTED-OTHER')),
  ));
  pending.push(closing.closed.then(
    () => settled.push('early-close-closed=RESOLVED'),
    (e) => settled.push('early-close-closed=' + (e instanceof WebTransportError ? 'REJECTED' : 'REJECTED-OTHER')),
  ));
  __wtDispatch(4242, 'closed', 'TLS handshake failed');

  // --- datagram surface. Capacity is negotiated by the native side and arrives
  // with `ready`; a write then reports what actually happened to it. Session
  // 4343 is substituted the same way, so no socket is opened: the real
  // __wtSendDatagram finds no such session and answers with its closed-session
  // status, which is exactly the arm under test.
  globalThis.__wtConnect = () => 4343;
  const dgram = new WebTransport('https://127.0.0.1:4433/echo');
  globalThis.__wtConnect = nativeConnect;
  dgram.closed.catch(() => {});
  dgram.ready.catch(() => {});
  __wtDispatch(4343, 'ready', 64);

  // reports negotiated datagram capacity: the clamped 64 the dispatch carried,
  // not a compiled-in constant.
  const capacity = dgram.datagrams.maxDatagramSize;
  const verdicts = ['capacity=' + capacity];

  // Each check takes its own writable: a throwing sink errors the stream it
  // was written to, so one writer could not carry the next case.
  const write = (label, bytes) =>
    dgram.datagrams.createWritable().getWriter().write(bytes).then(
      () => verdicts.push(label + '=RESOLVED'),
      (e) => verdicts.push(label + '=' + (e instanceof WebTransportError ? 'REJECTED' : 'REJECTED-OTHER')),
    );

  // rejects oversized datagram: one byte past the negotiated capacity.
  pending.push(write('oversize', new Uint8Array(65)));
  // ...while a datagram exactly at the capacity is not refused for its size.
  // This one reaches the native bridge, which refuses the substituted session.
  pending.push(write('closed-session', new Uint8Array(64)));

  // distinguishes closed session from queue drop: same call, same size, and the
  // only difference is the status the native side returns. A local queue drop is
  // unreliable delivery working as designed, so the write must not throw.
  const nativeSendDatagram = globalThis.__wtSendDatagram;
  globalThis.__wtSendDatagram = () => -3;  // kDatagramDropped
  pending.push(write('queue-drop', new Uint8Array(8)).then(() => {
    // A hard transport failure is the other half of that distinction: same
    // call, same size, and it must NOT resolve the way a backlog trim does.
    globalThis.__wtSendDatagram = () => -4;  // kDatagramSendFailed
    return write('send-failed', new Uint8Array(8));
  }).then(() => {
    globalThis.__wtSendDatagram = nativeSendDatagram;
  }));

  Promise.all(pending).then(() => {
    setTimeout(() => {
      const allRejected = settled.every((m) => m.endsWith('REJECTED'));
      const datagramOk =
        verdicts.includes('capacity=64') &&
        verdicts.includes('oversize=REJECTED') &&
        verdicts.includes('closed-session=REJECTED') &&
        verdicts.includes('queue-drop=RESOLVED') &&
        verdicts.includes('send-failed=REJECTED');
      if (!datagramOk) console.log('datagram surface: ' + verdicts.join(' '));
      process.exit(ok.every(Boolean) && allRejected && datagramOk ? 42 : 1);
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
