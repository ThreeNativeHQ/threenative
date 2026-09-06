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

  const nativeSendDatagram = globalThis.__wtSendDatagram;
  // Run each bridge status after the preceding write has reached its sink. The
  // stream sink is async, so swapping the bridge while a write is queued would
  // test scheduling instead of the native status it is meant to classify.
  pending.push((async () => {
    // rejects oversized datagram: one byte past the negotiated capacity.
    await write('oversize', new Uint8Array(65));
    // ...while a datagram exactly at the capacity reaches the real bridge,
    // which refuses the substituted session.
    await write('closed-session', new Uint8Array(64));
    try {
      // A local queue drop is unreliable delivery working as designed, so the
      // write must not throw.
      globalThis.__wtSendDatagram = () => -3;  // kDatagramDropped
      await write('queue-drop', new Uint8Array(8));
      // A hard transport failure is the other half of that distinction: same
      // call, same size, and it must NOT resolve the way a backlog trim does.
      globalThis.__wtSendDatagram = () => -4;  // kDatagramSendFailed
      await write('send-failed', new Uint8Array(8));
    } finally {
      globalThis.__wtSendDatagram = nativeSendDatagram;
    }
  })());

  // Streams surface: run the installed native globals through a strategy-sized
  // readable and a held writable. This observes pressure and promise
  // transitions without substituting Node's stream implementation.
  const streamVerdicts = [];
  const settlesByCheckpoint = async (promise) => {
    let settled = false;
    promise.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    return settled;
  };
  pending.push((async () => {
    let readableController;
    const readable = new ReadableStream({
      start(controller) { readableController = controller; },
    }, { highWaterMark: 2, size: (chunk) => chunk.byteLength });
    const reader = readable.getReader();
    streamVerdicts.push('read-initial=' + readableController.desiredSize);
    readableController.enqueue(new Uint8Array(2));
    streamVerdicts.push('read-pressure=' + readableController.desiredSize);
    await reader.read();
    const pendingRead = reader.read();
    const readPending = !(await settlesByCheckpoint(pendingRead));
    readableController.enqueue(new Uint8Array(1));
    const readResult = await pendingRead;
    readableController.close();
    const readDone = await reader.read();
    streamVerdicts.push('read-pending=' + readPending);
    streamVerdicts.push('read-value=' + readResult.value.byteLength);
    streamVerdicts.push('read-done=' + readDone.done);

    let releaseWrite;
    const writable = new WritableStream({
      write() {
        return new Promise((resolve) => { releaseWrite = resolve; });
      },
    }, { highWaterMark: 1, size: () => 1 });
    const writer = writable.getWriter();
    const write = writer.write(new Uint8Array(1));
    const readyWasPending = !(await settlesByCheckpoint(writer.ready));
    releaseWrite();
    await write;
    const readyRecovered = await settlesByCheckpoint(writer.ready);
    await writer.ready;
    await writer.close();
    streamVerdicts.push('write-pending=' + readyWasPending);
    streamVerdicts.push('write-ready=' + readyRecovered);

    // The transport sink uses this lifecycle signal to cancel a capacity wait.
    // Hold a real write, abort it, and observe the signal before releasing the
    // fallback resolver so this remains an asynchronous native-surface check.
    let signalController;
    let releaseSignalWrite = () => {};
    const signalEvents = [];
    const signalReason = { tag: 'surface-abort' };
    const signalWritable = new WritableStream({
      start(controller) { signalController = controller; },
      write(_chunk, controller) {
        return new Promise((resolve, reject) => {
          releaseSignalWrite = resolve;
          if (!controller.signal) return;
          controller.signal.addEventListener('abort', () => {
            signalEvents.push('signal');
            reject(controller.signal.reason);
          });
        });
      },
      abort() { signalEvents.push('abort'); },
    });
    const signalWriter = signalWritable.getWriter();
    signalWriter.closed.catch(() => {});
    const signalWritePromise = signalWriter.write(new Uint8Array(1)).then(
      () => 'resolved',
      (error) => error === signalReason ? 'reason' : 'other',
    );
    await Promise.resolve();
    await Promise.resolve();
    const signalAbortPromise = signalWriter.abort(signalReason).then(() => 'resolved', () => 'rejected');
    const signalEventsAtAbortCall = signalEvents.slice();
    const signalSync = !!signalController.signal &&
      signalController.signal.aborted &&
      signalController.signal.reason === signalReason &&
      signalEventsAtAbortCall.includes('signal');
    releaseSignalWrite();
    const signalWriteResult = await signalWritePromise;
    const signalAbortResult = await signalAbortPromise;
    const signalClosedResult = await signalWriter.closed.then(
      () => 'resolved',
      (error) => error === signalReason ? 'reason' : 'other',
    );
    streamVerdicts.push('signal-sync=' + signalSync);
    streamVerdicts.push('signal-write=' + signalWriteResult);
    streamVerdicts.push('signal-abort=' + signalAbortResult);
    streamVerdicts.push('signal-closed=' + signalClosedResult);
    streamVerdicts.push('signal-events=' + signalEvents.join('|'));
    return streamVerdicts.every((value) =>
      ['read-initial=2', 'read-pressure=0', 'read-pending=true',
       'read-value=1', 'read-done=true', 'write-pending=true',
       'write-ready=true', 'signal-sync=true', 'signal-write=reason',
       'signal-abort=resolved', 'signal-closed=reason',
       'signal-events=signal|abort'].includes(value));
  })().then((passed) => {
    if (!passed) console.log('stream surface: ' + streamVerdicts.join(' '));
    return passed;
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
      const streamOk = streamVerdicts.length === 12 &&
        streamVerdicts.includes('read-initial=2') &&
        streamVerdicts.includes('read-pressure=0') &&
        streamVerdicts.includes('read-pending=true') &&
        streamVerdicts.includes('read-value=1') &&
        streamVerdicts.includes('read-done=true') &&
        streamVerdicts.includes('write-pending=true') &&
        streamVerdicts.includes('write-ready=true') &&
        streamVerdicts.includes('signal-sync=true') &&
        streamVerdicts.includes('signal-write=reason') &&
        streamVerdicts.includes('signal-abort=resolved') &&
        streamVerdicts.includes('signal-closed=reason') &&
        streamVerdicts.includes('signal-events=signal|abort');
      if (!datagramOk) console.log('datagram surface: ' + verdicts.join(' '));
      if (!streamOk) console.log('stream surface: ' + streamVerdicts.join(' '));
      process.exit(ok.every(Boolean) && allRejected && datagramOk && streamOk ? 42 : 1);
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
