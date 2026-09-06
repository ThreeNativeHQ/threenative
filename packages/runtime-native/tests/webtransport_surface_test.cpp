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
  ok.push(__wtConnect('https://[localhost]:4433/') === 0);
  ok.push(__wtConnect('https://[127.0.0.1]:4433/') === 0);
  ok.push(__wtConnect('https://[::1]:4433junk/') === 0);

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

  // UTF-8 surface on the embedded/compiled path: the protocol rejects
  // malformed handshake text portably, so whatever TextDecoder is installed
  // (native on V8, fallback on QuickJS) must honor fatal, streaming splits,
  // view offsets and honest label rejection.
  pending.push((async () => {
    const malformed = new Uint8Array([0xff, 0xfe]);
    let fatalThrew = false;
    try { new TextDecoder('utf-8', { fatal: true }).decode(malformed); }
    catch (e) { fatalThrew = e instanceof TypeError; }
    const replaced = new TextDecoder().decode(malformed);
    const streaming = new TextDecoder();
    const first = streaming.decode(new Uint8Array([0xc3]), { stream: true });
    const second = streaming.decode(new Uint8Array([0xa9]));
    const backing = new Uint8Array([0x00, 0x68, 0x69, 0x00]);
    const offset = new TextDecoder().decode(new Uint8Array(backing.buffer, 1, 2));
    let badLabel = false;
    try { new TextDecoder('utf-16'); } catch (e) { badLabel = e instanceof RangeError; }
    const utf8 = new TextDecoderStream('utf-8', { fatal: true });
    const utf8Ok = utf8.encoding === 'utf-8' && utf8.fatal === true;
    const splitWriter = utf8.writable.getWriter();
    const splitReader = utf8.readable.getReader();
    const splitRead = splitReader.read();
    await splitWriter.write(new Uint8Array([0xe2, 0x82]));
    const pendingBefore = await Promise.race(
      [splitRead.then(() => 'settled'), Promise.resolve('pending')]);
    await splitWriter.write(new Uint8Array([0xac]));
    const splitValue = (await splitRead).value;
    await splitWriter.close();
    return fatalThrew && replaced === '��' && first === '' &&
      second === 'é' && offset === 'hi' && badLabel && utf8Ok &&
      pendingBefore === 'pending' && splitValue === '€';
  })().then((utf8Ok) => {
    ok.push(utf8Ok);
  }));

  Promise.all(pending).then(async () => {
    // Exercise the installed adapter and both embedded engines. Only transport I/O
    // is substituted; resource observations still come from the native bridge.
    const saved = {
      __wtConnect, __wtCreateStream, __wtStreamWrite,
      __wtStreamReadCredit, __wtStreamReleaseRead, __wtStreamShutdown,
    };
    const shutdowns = [];
    try {
      globalThis.__wtConnect = () => 5151;
      globalThis.__wtCreateStream = () => 4;
      globalThis.__wtStreamWrite = (_id, _sid, bytes) => bytes.byteLength;
      globalThis.__wtStreamReadCredit = () => 0;
      globalThis.__wtStreamReleaseRead = () => 0;
      globalThis.__wtStreamShutdown = (_id, sid, _code, direction) => {
        shutdowns.push(sid + ':' + direction);
        return 0;
      };
      const transport = new WebTransport('https://127.0.0.1:4433/echo');
      __wtDispatch(5151, 'ready', 1200);
      const stream = await transport.createBidirectionalStream();
      const writer = stream.writable.getWriter();
      writer.closed.catch(() => {});
      const close = writer.close().then(() => 'resolved', error => error);
      await Promise.resolve();
      await Promise.resolve();
      const abort = writer.abort('stop-fin').then(() => 'resolved', error => error);
      ok.push(await close === 'stop-fin');
      ok.push(await abort === 'stop-fin');
      ok.push(shutdowns.join(',') === '4:1');
      const incoming = transport.incomingBidirectionalStreams.getReader();
      __wtDispatch(5151, 'incomingBidi', 20);
      __wtDispatch(5151, 'incomingBidi', 24);
      const accepted = (await incoming.read()).value;
      await incoming.cancel('stop-accepting');
      ok.push(shutdowns.join(',') === '4:1,24:0,24:1');
      await accepted.writable.getWriter().write(new Uint8Array([7]));
      __wtDispatch(5151, 'closed', 'local', 9);
      ok.push((await transport.closed).closeCode === 9);
      ok.push(transport._state.streams.size === 0);
      const observed = __wtResourceStats();
      ok.push(observed.native.sessions === 0 && observed.native.streams === 0);
    } finally {
      for (const key of Object.keys(saved)) globalThis[key] = saved[key];
    }
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

    mystral::webtransport::setResolverDelayForTesting(500);
    const auto resolveStart = std::chrono::steady_clock::now();
    const bool scheduledDns = runtime->evalScript(R"JS((() => {
      globalThis.dnsProbe = { frames: 0, ready: 'pending', closed: 'pending', stop: false };
      const probe = globalThis.dnsProbe;
      probe.transport = new WebTransport('https://localhost:9/echo');
      probe.transport.ready.then(() => { probe.ready = 'resolved'; }, () => { probe.ready = 'rejected'; });
      probe.transport.closed.then(() => { probe.closed = 'resolved'; }, () => { probe.closed = 'rejected'; });
      requestAnimationFrame(function frame() {
        ++probe.frames;
        if (!probe.stop) requestAnimationFrame(frame);
      });
    })())JS", "webtransport_delayed_dns.js");
    const auto resolveElapsed = std::chrono::steady_clock::now() - resolveStart;
    mystral::webtransport::setResolverDelayForTesting(0);
    if (!scheduledDns || resolveElapsed >= std::chrono::milliseconds(200)) {
        std::cerr << "delayed DNS blocked connection setup on the game thread\n";
        return 1;
    }
    // Drive actual animation callbacks while the resolver worker is still delayed.
    const auto frameDeadline = resolveStart + std::chrono::milliseconds(100);
    do {
        if (!runtime->pollEvents()) return 1;
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    } while (std::chrono::steady_clock::now() < frameDeadline);
    if (mystral::webtransport::activeResolutionsForTesting() != 1 ||
        !runtime->evalScript(R"JS((() => {
          if (dnsProbe.frames < 3 || dnsProbe.ready !== 'pending' || dnsProbe.closed !== 'pending') {
            throw new Error('frames did not progress during pending DNS: ' + JSON.stringify(dnsProbe));
          }
          dnsProbe.transport.close();
        })())JS", "webtransport_dns_frames.js")) {
        std::cerr << "renders while DNS is delayed failed\n";
        return 1;
    }
    if (!runtime->pollEvents() || mystral::webtransport::hasActiveSessions()) {
        std::cerr << "close during DNS retained an active session\n";
        return 1;
    }
    // The worker owns its result after close; wait for that actual worker to finish.
    const auto completionDeadline = resolveStart + std::chrono::seconds(2);
    while (mystral::webtransport::activeResolutionsForTesting() != 0 &&
           std::chrono::steady_clock::now() < completionDeadline) {
        if (!runtime->pollEvents()) return 1;
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    if (!runtime->pollEvents() || mystral::webtransport::activeResolutionsForTesting() != 0 ||
        mystral::webtransport::hasActiveSessions() ||
        !runtime->evalScript(R"JS((() => {
          dnsProbe.stop = true;
          if (dnsProbe.ready !== 'rejected' || dnsProbe.closed !== 'rejected') {
            throw new Error('late DNS completion changed closed promises');
          }
        })())JS", "webtransport_dns_cancel.js")) {
        std::cerr << "ignores DNS result after close failed\n";
        return 1;
    }
    std::cout << "renders while DNS is delayed: passed; ignores DNS result after close: passed\n";

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
