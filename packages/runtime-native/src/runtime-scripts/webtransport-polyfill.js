/**
 * WebTransport JavaScript polyfill.
 *
 * Defines the W3C WebTransport API surface on top of the low-level `__wt*` native bridge
 * functions registered by webtransport.cpp. Streams are backed by the runtime's WHATWG streams
 * polyfill, and native events enter through the single `globalThis.__wtDispatch` function.
 */
(() => {
  if (typeof globalThis.WebTransport !== 'undefined' && globalThis.__wtSessions) {
    return;
  }

  if (typeof globalThis.ReadableStream === 'undefined' ||
      typeof globalThis.WritableStream === 'undefined') {
    console.error('[WebTransport] Web Streams not available; WebTransport disabled.');
    return;
  }

  const sessions = new Map();
  globalThis.__wtSessions = sessions;

  const streamReadLimit = 16 * 1024;
  const streamLimit = 64;
  const writeByteLimit = 1024 * 1024;
  const writeOperationLimit = 256;
  const datagramQueueLimit = 256;

  const dgramAccepted = 0;
  const dgramInvalidSession = -1;
  const dgramTooLarge = -2;
  const dgramDropped = -3;
  const dgramSendFailed = -4;
  const streamWritePressure = -2;
  const streamWriteOversized = -3;

  class WebTransportError extends Error {
    constructor(message, options) {
      super(message || 'WebTransport error');
      this.name = 'WebTransportError';
      this.source = options?.source || 'session';
      this.streamErrorCode = options?.streamErrorCode ?? null;
    }
  }
  globalThis.WebTransportError = WebTransportError;

  function streamError(message, code) {
    return new WebTransportError(message, {
      source: 'stream',
      streamErrorCode: code ?? null,
    });
  }

  function copyBytes(chunk, limit = writeByteLimit) {
    let source;
    if (chunk instanceof ArrayBuffer) {
      source = new Uint8Array(chunk);
    } else if (ArrayBuffer.isView(chunk)) {
      source = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    } else if (Array.isArray(chunk)) {
      if (chunk.length > limit) {
        throw new WebTransportError(
          `Stream write of ${chunk.length} bytes exceeds the ${limit}-byte limit`,
          { source: 'stream' },
        );
      }
      source = new Uint8Array(chunk);
    } else {
      const length = Number(chunk?.byteLength ?? chunk?.length);
      if (!Number.isFinite(length) || length < 0 || Math.floor(length) !== length) {
        throw new TypeError('WebTransport stream chunks must be byte buffers');
      }
      if (length > limit) {
        throw new WebTransportError(
          `Stream write of ${length} bytes exceeds the ${limit}-byte limit`,
          { source: 'stream' },
        );
      }
      source = new Uint8Array(chunk);
    }
    if (source.byteLength > limit) {
      throw new WebTransportError(
        `Stream write of ${source.byteLength} bytes exceeds the ${limit}-byte limit`,
        { source: 'stream' },
      );
    }
    // Native may return -2 and ask the caller to retry later. Keep an owned copy so a caller can
    // reuse or mutate its input while that retry is waiting.
    return new Uint8Array(source);
  }

  function inputByteLength(chunk) {
    if (chunk instanceof ArrayBuffer) return chunk.byteLength;
    if (ArrayBuffer.isView(chunk)) return chunk.byteLength;
    if (Array.isArray(chunk)) return chunk.length;
    const length = Number(chunk?.byteLength ?? chunk?.length);
    return Number.isFinite(length) && length >= 0 && Math.floor(length) === length ? length : null;
  }

  function chunkSize(chunk) {
    const size = Number(chunk?.byteLength);
    return Number.isFinite(size) && size >= 0 ? size : 1;
  }

  function validateOptions(options) {
    if (options === undefined || options === null) return;
    if (typeof options !== 'object') throw new TypeError('WebTransport options must be an object');
    if (options.requireUnreliable === true) {
      throw new TypeError('WebTransport requireUnreliable is not supported by the native bridge');
    }
    if (options.allowPooling === true) {
      throw new TypeError('WebTransport allowPooling is not supported by the native bridge');
    }
    if (options.congestionControl !== undefined && options.congestionControl !== 'default') {
      throw new TypeError('Only the default WebTransport congestion control is supported');
    }
    if (options.serverCertificateHashes !== undefined) {
      const hashes = options.serverCertificateHashes;
      if (hashes === null || typeof hashes[Symbol.iterator] !== 'function') {
        throw new TypeError('WebTransport serverCertificateHashes must be iterable');
      }
      if (Array.from(hashes).length !== 0) {
        throw new TypeError('WebTransport serverCertificateHashes are not supported');
      }
    }
  }

  function removeWaiter(state, waiter) {
    const index = state.writableWaiters.indexOf(waiter);
    if (index !== -1) state.writableWaiters.splice(index, 1);
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
    }
  }

  function waitForWritable(state, signal, send) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (state.failed || state.closedFlag) {
      return Promise.reject(state.lastError || new WebTransportError('WebTransport session is closed'));
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, send, onAbort: null };
      waiter.onAbort = () => {
        removeWaiter(state, waiter);
        reject(signal.reason);
      };
      state.writableWaiters.push(waiter);
      if (signal) {
        if (signal.aborted) waiter.onAbort();
        else signal.addEventListener('abort', waiter.onAbort);
      }
    });
  }

  function wakeWritable(state) {
    const waiters = state.writableWaiters.splice(0);
    for (const waiter of waiters) {
      if (waiter.signal?.aborted) {
        waiter.reject(waiter.signal.reason);
      } else {
        if (waiter.signal && waiter.onAbort) {
          waiter.signal.removeEventListener('abort', waiter.onAbort);
        }
        waiter.resolve();
      }
    }
  }

  function rejectWaiters(state, error, send) {
    const keep = [];
    for (const waiter of state.writableWaiters) {
      if (send && waiter.send !== send) {
        keep.push(waiter);
        continue;
      }
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener('abort', waiter.onAbort);
      }
      waiter.reject(error);
    }
    state.writableWaiters = keep;
  }

  function releaseReliable(state, bytes) {
    state.jsQueuedReliableBytes = Math.max(0, state.jsQueuedReliableBytes - bytes);
    state.jsQueuedReliableOperations = Math.max(0, state.jsQueuedReliableOperations - 1);
    // A completed JS operation also frees admission space. This wakeup covers a waiter that was
    // admitted behind another stream even if the native Writable event was coalesced already.
    wakeWritable(state);
  }

  function reserveReliable(state, bytes) {
    if (state.jsQueuedReliableOperations >= writeOperationLimit) {
      throw new WebTransportError(
        `WebTransport stream operation limit ${writeOperationLimit} reached`,
        { source: 'stream' },
      );
    }
    state.jsQueuedReliableBytes += bytes;
    state.jsQueuedReliableOperations += 1;
  }

  function makeValueReadable(state, queueLimit, dropOldest) {
    const box = {
      queue: [],
      controller: null,
      inFlight: 0,
      pendingReads: 0,
      drops: 0,
      stream: null,
      cancelled: false,
      onCancel: null,
      onDeliver: null,
    };
    const pump = () => {
      if (box.cancelled || !box.controller || box.queue.length === 0) return;
      if (box.pendingReads === 0) return;
      const value = box.queue.shift();
      try {
        box.pendingReads -= 1;
        box.controller.enqueue(value);
        box.inFlight += 1;
        if (box.onDeliver) box.onDeliver(value);
      } catch (_) {
        return;
      }
    };
    box.offer = (value) => {
      if (box.cancelled) return false;
      if (box.queue.length + box.inFlight >= queueLimit) {
        if (!dropOldest) return false;
        if (box.queue.length === 0) return false;
        box.queue.shift();
        box.drops += 1;
      }
      box.queue.push(value);
      pump();
      return true;
    };
    box.stream = new ReadableStream({
      start(controller) { box.controller = controller; },
      pull() { pump(); },
      cancel(reason) {
        box.cancelled = true;
        box.queue.length = 0;
        box.inFlight = 0;
        box.pendingReads = 0;
        return box.onCancel ? box.onCancel(reason) : undefined;
      },
    }, { highWaterMark: 0 });
    const getReader = box.stream.getReader.bind(box.stream);
    box.stream.getReader = (...args) => {
      const reader = getReader(...args);
      const read = reader.read.bind(reader);
      reader.read = () => {
        box.pendingReads += 1;
        return Promise.resolve(read()).then((result) => {
          if (!result.done) box.inFlight = Math.max(0, box.inFlight - 1);
          else box.pendingReads = Math.max(0, box.pendingReads - 1);
          pump();
          return result;
        }, (error) => {
          box.pendingReads = Math.max(0, box.pendingReads - 1);
          throw error;
        });
      };
      return reader;
    };
    return box;
  }

  function maybeCleanup(state, entry) {
    if (!entry) return;
    const readDone = !entry.readable || entry.readable.readCancelled || entry.readable.readReleased ||
      entry.readable.readFailed;
    const writeDone = !entry.send || entry.send.writeDone;
    if (readDone && writeDone) state.streams.delete(entry.streamId);
  }

  function maybeReleaseRead(state, entry) {
    const box = entry?.readable;
    if (!box || box.readReleased || box.readCancelled || box.readFailed || !box.finReceived) return;
    if (box.queuedBytes !== 0 || box.pendingReads !== 0 || box.directDeliveries !== 0) return;
    const result = globalThis.__wtStreamReleaseRead(state.id, entry.streamId);
    if (typeof result === 'number' && result < 0) return;
    box.readReleased = true;
    maybeCleanup(state, entry);
  }

  function requestReadCredit(state, entry) {
    const box = entry?.readable;
    if (!box || box.finReceived || box.readCancelled || box.readFailed || state.failed || state.closedFlag) return;
    const desired = box.controller?.desiredSize;
    if (desired === null || desired === undefined || desired <= 0) return;
    const amount = Math.min(streamReadLimit, Math.max(0, Math.floor(Number(desired))));
    if (amount <= 0) return;
    const result = globalThis.__wtStreamReadCredit(state.id, entry.streamId, amount);
    if (typeof result === 'number' && result < 0) {
      failRead(state, entry, streamError('Unable to grant stream read credit'));
    }
  }

  function cancelRead(state, entry) {
    const box = entry?.readable;
    if (!box || box.readCancelled) return;
    box.readCancelled = true;
    box.pendingReads = 0;
    box.directDeliveries = 0;
    box.queuedBytes = 0;
    box.queueChunks = 0;
    const result = globalThis.__wtStreamShutdown(state.id, entry.streamId, 0, 0);
    if (typeof result === 'number' && result < 0) {
      throw streamError(`Unable to cancel stream read (${result})`);
    }
    maybeCleanup(state, entry);
  }

  function makeStreamReadable(state, streamId) {
    const box = {
      stream: null,
      controller: null,
      streamId,
      queuedBytes: 0,
      queuedSizes: [],
      queueChunks: 0,
      pendingReads: 0,
      directDeliveries: 0,
      finReceived: false,
      readReleased: false,
      readCancelled: false,
      readFailed: false,
    };
    box.stream = new ReadableStream({
      start(controller) { box.controller = controller; },
      pull() {
        const entry = state.streams.get(streamId);
        if (entry) requestReadCredit(state, entry);
      },
      cancel() {
        const entry = state.streams.get(streamId);
        if (entry) cancelRead(state, entry);
      },
    }, {
      highWaterMark: streamReadLimit,
      size: chunkSize,
    });
    const getReader = box.stream.getReader.bind(box.stream);
    box.stream.getReader = (...args) => {
      const reader = getReader(...args);
      const read = reader.read.bind(reader);
      reader.read = () => {
        const queuedAtCall = box.queuedBytes > 0;
        const waiting = !queuedAtCall && !box.finReceived && !box.readCancelled && !box.readFailed;
        if (waiting) box.pendingReads += 1;
        let consumedSynchronously = false;
        if (queuedAtCall) {
          const size = box.queuedSizes.shift() || 0;
          box.queuedBytes = Math.max(0, box.queuedBytes - size);
          box.queueChunks = Math.max(0, box.queueChunks - 1);
          consumedSynchronously = true;
        }
        return Promise.resolve(read()).then((result) => {
          if (waiting) {
            if (box.directDeliveries > 0) box.directDeliveries -= 1;
            else box.pendingReads = Math.max(0, box.pendingReads - 1);
          }
          if (!result.done && !waiting && !consumedSynchronously) {
            box.queuedBytes = Math.max(0, box.queuedBytes - chunkSize(result.value));
            box.queueChunks = Math.max(0, box.queueChunks - 1);
          }
          if (result.done) box.readEnded = true;
          const entry = state.streams.get(streamId);
          if (entry) maybeReleaseRead(state, entry);
          return result;
        }, (error) => {
          if (waiting) {
            if (box.directDeliveries > 0) box.directDeliveries -= 1;
            else box.pendingReads = Math.max(0, box.pendingReads - 1);
          }
          const entry = state.streams.get(streamId);
          if (entry) maybeReleaseRead(state, entry);
          throw error;
        });
      };
      return reader;
    };
    return box;
  }

  function enqueueStreamData(state, entry, data, fin) {
    const box = entry?.readable;
    if (!box || box.readCancelled || box.readFailed || box.readReleased) return;
    let bytes;
    try {
      bytes = copyBytes(data || new Uint8Array(0), streamReadLimit);
    } catch (error) {
      failRead(state, entry, error);
      return;
    }
    if (bytes.byteLength > 0) {
      const direct = box.pendingReads > 0;
      if (direct) box.pendingReads -= 1;
      if (direct) box.directDeliveries += 1;
      if (!direct) {
        if (box.queuedBytes + bytes.byteLength > streamReadLimit) {
          failRead(state, entry, streamError('Readable stream queue is full'));
          return;
        }
        box.queuedBytes += bytes.byteLength;
        box.queuedSizes.push(bytes.byteLength);
        box.queueChunks += 1;
      }
      try {
        box.controller.enqueue(bytes);
      } catch (error) {
        if (!direct) {
          box.queuedBytes = Math.max(0, box.queuedBytes - bytes.byteLength);
          box.queuedSizes.pop();
          box.queueChunks = Math.max(0, box.queueChunks - 1);
        }
        failRead(state, entry, error);
        return;
      }
    }
    if (fin) {
      box.finReceived = true;
      try { box.controller.close(); } catch (_) {}
      maybeReleaseRead(state, entry);
    }
  }

  function failRead(state, entry, error) {
    const box = entry?.readable;
    if (!box || box.readFailed || box.readCancelled) return;
    box.readFailed = true;
    box.pendingReads = 0;
    box.directDeliveries = 0;
    box.queuedBytes = 0;
    box.queuedSizes.length = 0;
    box.queueChunks = 0;
    try { box.controller.error(error); } catch (_) {}
    maybeCleanup(state, entry);
  }

  function cancelIncoming(state, kind, reason) {
    for (const entry of [...state.streams.values()]) {
      if (entry.incomingKind !== kind || entry.incomingAccepted) continue;
      cancelRead(state, entry, reason);
      if (entry.send) sendAbort(entry.send, reason || 'incoming stream was not accepted');
    }
  }

  function sendWriteAttempt(send, bytes, signal) {
    if (send.failed || send.aborted || send.state.failed || send.state.closedFlag) {
      return Promise.reject(send.error || send.state.lastError || streamError('Stream write is closed'));
    }
    let result;
    try {
      result = globalThis.__wtStreamWrite(send.state.id, send.streamId, bytes, false);
    } catch (error) {
      return Promise.reject(error);
    }
    if (result === bytes.byteLength) return Promise.resolve();
    if (result === streamWritePressure) {
      return waitForWritable(send.state, signal, send).then(
        () => sendWriteAttempt(send, bytes, signal),
      );
    }
    if (result === streamWriteOversized) {
      return Promise.reject(new WebTransportError(
        `Stream write exceeds the ${writeByteLimit}-byte native limit`,
        { source: 'stream' },
      ));
    }
    return Promise.reject(send.error || streamError(`Failed to write stream (${result})`));
  }

  function clearCloseAbortListener(send) {
    if (send.closeSignal && send.closeAbortHandler) {
      send.closeSignal.removeEventListener('abort', send.closeAbortHandler);
    }
    send.closeSignal = null;
    send.closeAbortHandler = null;
  }

  function resolveClose(send) {
    clearCloseAbortListener(send);
    if (send.closeResolve) send.closeResolve();
  }

  function rejectClose(send, error) {
    clearCloseAbortListener(send);
    if (send.closeReject) send.closeReject(error);
  }

  function sendClose(send) {
    if (send.closePromise) return send.closePromise;
    send.finRequested = true;
    send.closePromise = new Promise((resolve, reject) => {
      send.closeResolve = resolve;
      send.closeReject = reject;
    });
    const signal = send.controller?.signal;
    if (signal) {
      send.closeSignal = signal;
      send.closeAbortHandler = () => {
        if (send.closedByNative || send.failed || send.aborted) return;
        send.aborted = true;
        send.writeDone = true;
        rejectWaiters(send.state, signal.reason, send);
        let result;
        try {
          result = globalThis.__wtStreamShutdown(send.state.id, send.streamId, 0, 1);
        } catch (error) {
          rejectClose(send, error);
          return;
        }
        if (typeof result === 'number' && result < 0) {
          rejectClose(send, streamError(`Unable to abort stream write (${result})`));
        } else {
          rejectClose(send, signal.reason);
        }
        maybeCleanup(send.state, send.entry);
      };
      if (signal.aborted) send.closeAbortHandler();
      else signal.addEventListener('abort', send.closeAbortHandler);
    }
    const attempt = () => {
      if (send.failed || send.aborted || send.state.failed || send.state.closedFlag) {
        rejectClose(send, send.error || send.state.lastError || streamError('Stream close is closed'));
        return;
      }
      let result;
      try {
        result = globalThis.__wtStreamWrite(send.state.id, send.streamId, new Uint8Array(0), true);
      } catch (error) {
        rejectClose(send, error);
        return;
      }
      if (result === streamWritePressure) {
        waitForWritable(send.state, signal, send).then(attempt, (error) => rejectClose(send, error));
      } else if (result === 0) {
        send.finAdmitted = true;
        if (send.closedByNative) resolveClose(send);
      } else {
        rejectClose(send, send.error || streamError(`Failed to close stream (${result})`));
      }
    };
    attempt();
    send.closePromise.catch(() => {});
    return send.closePromise;
  }

  function sendAbort(send, reason) {
    if (send.aborted || send.failed) return Promise.resolve();
    send.aborted = true;
    send.writeDone = true;
    rejectWaiters(send.state, reason || streamError('Stream write aborted'), send);
    const result = globalThis.__wtStreamShutdown(send.state.id, send.streamId, 0, 1);
    if (typeof result === 'number' && result < 0) {
      return Promise.reject(streamError(`Unable to abort stream write (${result})`));
    }
    maybeCleanup(send.state, send.entry);
    return Promise.resolve();
  }

  function failSend(send, error) {
    if (!send || send.failed) return;
    send.failed = true;
    send.writeDone = true;
    send.error = error;
    rejectWaiters(send.state, error, send);
    if (send.closeReject) send.closeReject(error);
    try { send.controller?.error(error); } catch (_) {}
    maybeCleanup(send.state, send.entry);
  }

  function makeSendStream(state, streamId) {
    const send = {
      state,
      streamId,
      entry: null,
      controller: null,
      failed: false,
      aborted: false,
      writeDone: false,
      finRequested: false,
      finAdmitted: false,
      closedByNative: false,
      closePromise: null,
      closeResolve: null,
      closeReject: null,
      error: null,
      reservations: new WeakMap(),
    };
    const writable = new WritableStream({
      start(controller) { send.controller = controller; },
      write(chunk, controller) {
        const signal = controller?.signal || send.controller?.signal;
        const reserved = send.reservations.get(chunk);
        let bytes;
        if (reserved !== undefined) {
          send.reservations.delete(chunk);
          bytes = chunk;
        } else {
          const length = inputByteLength(chunk);
          if (length === null) return Promise.reject(new TypeError('WebTransport stream chunks must be byte buffers'));
          if (length > writeByteLimit) {
            return Promise.reject(new WebTransportError(
              `Stream write of ${length} bytes exceeds the ${writeByteLimit}-byte limit`,
              { source: 'stream' },
            ));
          }
          try {
            bytes = copyBytes(chunk);
          } catch (error) {
            return Promise.reject(error);
          }
        }
        if (reserved !== undefined) return sendWriteAttempt(send, bytes, signal);
        const begin = () => {
          try {
            reserveReliable(state, bytes.byteLength);
          } catch (error) {
            return Promise.reject(error);
          }
          return sendWriteAttempt(send, bytes, signal).then(
            (value) => {
              releaseReliable(state, bytes.byteLength);
              return value;
            },
            (error) => {
              releaseReliable(state, bytes.byteLength);
              throw error;
            },
          );
        };
        return begin();
      },
      close() {
        return sendClose(send).then(() => {
          send.writeDone = true;
          maybeCleanup(state, send.entry);
        });
      },
      abort(reason) {
        return sendAbort(send, reason);
      },
    }, {
      highWaterMark: writeByteLimit,
      size: chunkSize,
    });

    // The native stream sink receives a stable copy, but the WritableStream queue itself also
    // needs an operation bound: zero-byte writes otherwise cost no high-water-mark space.
    const getWriter = writable.getWriter.bind(writable);
    writable.getWriter = (...args) => {
      const writer = getWriter(...args);
      const write = writer.write.bind(writer);
      writer.write = (chunk) => {
        const length = inputByteLength(chunk);
        if (length === null) {
          return Promise.reject(new TypeError('WebTransport stream chunks must be byte buffers'));
        }
        if (length > writeByteLimit) {
          return Promise.reject(new WebTransportError(
            `Stream write of ${length} bytes exceeds the ${writeByteLimit}-byte limit`,
            { source: 'stream' },
          ));
        }
        if (state.jsQueuedReliableBytes + length > writeByteLimit) {
          return Promise.reject(new WebTransportError(
            `WebTransport reliable write queue is full at ${writeByteLimit} bytes`,
            { source: 'stream' },
          ));
        }
        if (state.jsQueuedReliableOperations >= writeOperationLimit) {
          return Promise.reject(new WebTransportError(
            `WebTransport stream operation limit ${writeOperationLimit} reached`,
            { source: 'stream' },
          ));
        }
        let bytes;
        try {
          bytes = copyBytes(chunk);
        } catch (error) {
          return Promise.reject(error);
        }
        try { reserveReliable(state, bytes.byteLength); } catch (error) { return Promise.reject(error); }
        send.reservations.set(bytes, bytes.byteLength);
        const begin = () => {
          let result;
          try { result = write(bytes); } catch (error) {
            send.reservations.delete(bytes);
            releaseReliable(state, bytes.byteLength);
            return Promise.reject(error);
          }
          return Promise.resolve(result).then(
            (value) => { releaseReliable(state, bytes.byteLength); return value; },
            (error) => { releaseReliable(state, bytes.byteLength); throw error; },
          );
        };
        return begin();
      };
      return writer;
    };
    send.writable = writable;
    return send;
  }

  function makeDatagramWritable(sessionId, datagrams, state) {
    const resource = {
      controllers: new Set(),
    };
    const writable = new WritableStream({
      start(controller) {
        resource.controllers.add(controller);
      },
      write(chunk) {
        const length = inputByteLength(chunk);
        const limit = datagrams.maxDatagramSize;
        if (length === null) return Promise.reject(new TypeError('Datagram chunks must be byte buffers'));
        if (length > limit) {
          throw new WebTransportError(
            `Datagram of ${length} bytes exceeds the negotiated ${limit}-byte limit`,
          );
        }
        let bytes;
        try { bytes = copyBytes(chunk, Math.min(writeByteLimit, limit)); } catch (error) { return Promise.reject(error); }
        const result = globalThis.__wtSendDatagram(sessionId, bytes);
        if (result === dgramInvalidSession) {
          throw new WebTransportError('Cannot send a datagram: the session is closed');
        }
        if (result === dgramTooLarge) {
          throw new WebTransportError(
            `Datagram of ${bytes.byteLength} bytes exceeds the transport's datagram limit`,
          );
        }
        if (result === dgramSendFailed) {
          throw new WebTransportError('Datagram not sent: the transport refused it');
        }
        if (result !== dgramAccepted && result !== dgramDropped) {
          throw new WebTransportError(`Datagram not sent (native status ${result})`);
        }
      },
    }, { highWaterMark: datagramQueueLimit, size: () => 1 });
    if (!state) return writable;
    resource.writable = writable;
    state.datagramResources.add(resource);
    const getWriter = writable.getWriter.bind(writable);
    writable.getWriter = (...args) => {
      const writer = getWriter(...args);
      const write = writer.write.bind(writer);
      writer.write = (chunk) => {
        const length = inputByteLength(chunk);
        if (length === null) return Promise.reject(new TypeError('Datagram chunks must be byte buffers'));
        const limit = datagrams.maxDatagramSize;
        if (length > limit) {
          return Promise.reject(new WebTransportError(
            `Datagram of ${length} bytes exceeds the negotiated ${limit}-byte limit`,
          ));
        }
        if (state.jsQueuedDatagramOperations >= datagramQueueLimit) {
          return Promise.reject(new WebTransportError('WebTransport datagram queue is full'));
        }
        let bytes;
        try { bytes = copyBytes(chunk, Math.min(writeByteLimit, limit)); } catch (error) { return Promise.reject(error); }
        state.jsQueuedDatagramOperations += 1;
        let result;
        try { result = write(bytes); } catch (error) {
          state.jsQueuedDatagramOperations -= 1;
          return Promise.reject(error);
        }
        return Promise.resolve(result).then(
          (value) => { state.jsQueuedDatagramOperations -= 1; return value; },
          (error) => { state.jsQueuedDatagramOperations -= 1; throw error; },
        );
      };
      return writer;
    };
    return writable;
  }

  function failDatagramResources(state, error) {
    for (const resource of state.datagramResources) {
      for (const controller of resource.controllers) {
        try { controller.error(error); } catch (_) {}
      }
    }
  }

  function createStreamEntry(state, streamId, bidi, send) {
    const entry = {
      streamId,
      readable: bidi ? makeStreamReadable(state, streamId) : null,
      send: send || null,
      incomingKind: null,
      incomingAccepted: false,
    };
    if (entry.send) entry.send.entry = entry;
    state.streams.set(streamId, entry);
    return entry;
  }

  function failSession(state, error) {
    if (state.failed) return;
    state.failed = true;
    state.lastError = error;
    if (!state.ready) state.readyReject(error);
    rejectWaiters(state, error);
    failDatagramResources(state, error);
    try { state.dgramReadable.controller.error(error); } catch (_) {}
    try { state.incomingUni.controller.error(error); } catch (_) {}
    try { state.incomingBidi.controller.error(error); } catch (_) {}
    for (const entry of state.streams.values()) {
      if (entry.send) failSend(entry.send, error);
      if (entry.readable) failRead(state, entry, error);
    }
  }

  function finishSession(state, reason, closeCode) {
    if (state.closedFlag) return;
    state.closedFlag = true;
    const message = String(reason || '');
    const info = { closeCode: Number(closeCode) || 0, reason: message };
    const failure = state.lastError || (state.failed ? new WebTransportError(message || 'WebTransport closed') : null);
    if (!state.ready) {
      const error = failure || new WebTransportError(message || 'WebTransport closed before ready');
      state.readyReject(error);
      state.closedReject(error);
    } else if (failure) {
      state.closedReject(failure);
    } else {
      state.closedResolve(info);
    }
    const closeError = failure || new WebTransportError('WebTransport session is closed');
    for (const entry of state.streams.values()) {
      if (entry.send) {
        entry.send.writeDone = true;
        if (entry.send.closeReject && !entry.send.closedByNative) rejectClose(entry.send, closeError);
        rejectWaiters(state, closeError, entry.send);
        try { entry.send.controller?.error(closeError); } catch (_) {}
      }
      if (entry.readable) {
        entry.readable.queuedBytes = 0;
        entry.readable.queueChunks = 0;
        entry.readable.pendingReads = 0;
        entry.readable.directDeliveries = 0;
        try { entry.readable.controller.error(closeError); } catch (_) {}
      }
    }
    rejectWaiters(state, closeError);
    failDatagramResources(state, closeError);
    state.dgramReadable.queue.length = 0;
    state.incomingUni.queue.length = 0;
    state.incomingBidi.queue.length = 0;
    try { state.dgramReadable.controller.error(closeError); } catch (_) {}
    try { state.incomingUni.controller.error(closeError); } catch (_) {}
    try { state.incomingBidi.controller.error(closeError); } catch (_) {}
    state.streams.clear();
    state.jsQueuedReliableBytes = 0;
    state.jsQueuedReliableOperations = 0;
    sessions.delete(state.id);
  }

  function jsResourceStats() {
    let streams = 0;
    let queuedReliableBytes = 0;
    let queuedReliableOperations = 0;
    let queuedDatagramOperations = 0;
    let queuedDatagrams = 0;
    let queuedEvents = 0;
    let queuedReceiveBytes = 0;
    let incomingDatagramDrops = 0;
    for (const state of sessions.values()) {
      streams += state.streams.size;
      queuedReliableBytes += state.jsQueuedReliableBytes;
      queuedReliableOperations += state.jsQueuedReliableOperations;
      queuedDatagramOperations += state.jsQueuedDatagramOperations;
      queuedDatagrams += state.dgramReadable.queue.length + state.dgramReadable.inFlight;
      incomingDatagramDrops += state.dgramReadable.drops;
      queuedEvents += state.dgramReadable.queue.length + state.dgramReadable.inFlight;
      queuedEvents += state.incomingUni.queue.length + state.incomingUni.inFlight;
      queuedEvents += state.incomingBidi.queue.length + state.incomingBidi.inFlight;
      for (const entry of state.streams.values()) {
        if (entry.readable) {
          queuedReceiveBytes += entry.readable.queuedBytes;
          queuedEvents += entry.readable.queueChunks;
        }
      }
    }
    return {
      sessions: sessions.size,
      streams,
      queuedReliableBytes,
      queuedReliableOperations,
      queuedDatagramOperations,
      queuedDatagrams,
      queuedEvents,
      queuedReceiveBytes,
      incomingDatagramDrops,
    };
  }

  globalThis.__wtResourceStats = () => {
    const native = globalThis.__wtNativeStats();
    if (!native || typeof native !== 'object') {
      throw new WebTransportError('Native WebTransport resource stats are unavailable');
    }
    for (const field of [
      'sessions', 'streams', 'queuedReliableBytes', 'queuedDatagrams', 'queuedEvents',
      'inFlightReceiveBytes', 'readCreditBytes', 'pendingHeaderBytes',
    ]) {
      if (!Number.isFinite(Number(native[field]))) {
        throw new WebTransportError(`Native WebTransport stats are missing ${field}`);
      }
    }
    const js = jsResourceStats();
    const n = native;
    const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    return {
      nativeAvailable: true,
      native,
      js,
      sessions: number(n.sessions) + js.sessions,
      streams: number(n.streams) + js.streams,
      queuedReliableBytes: number(n.queuedReliableBytes) + js.queuedReliableBytes,
      queuedDatagrams: number(n.queuedDatagrams) + js.queuedDatagrams,
      queuedEvents: number(n.queuedEvents) + js.queuedEvents,
      inFlightReceiveBytes: number(n.inFlightReceiveBytes) + js.queuedReceiveBytes,
      readCreditBytes: number(n.readCreditBytes),
      pendingHeaderBytes: number(n.pendingHeaderBytes),
    };
  };

  class WebTransport {
    constructor(url, options) {
      validateOptions(options);
      this._url = String(url);

      let readyResolve;
      let readyReject;
      let closedResolve;
      let closedReject;
      this.ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
      this.closed = new Promise((resolve, reject) => { closedResolve = resolve; closedReject = reject; });
      this.closed.catch(() => {});

      const id = globalThis.__wtConnect(String(url));
      if (!id || id <= 0) {
        const error = new WebTransportError(`Failed to initiate WebTransport connection to ${url}`);
        readyReject(error);
        closedReject(error);
        this._state = null;
        return;
      }

      const state = {
        id,
        readyResolve,
        readyReject,
        closedResolve,
        closedReject,
        streams: new Map(),
        datagramResources: new Set(),
        incomingUniValues: new WeakMap(),
        incomingBidiValues: new WeakMap(),
        writableWaiters: [],
        jsQueuedReliableBytes: 0,
        jsQueuedReliableOperations: 0,
        jsQueuedDatagramOperations: 0,
        ready: false,
        closedFlag: false,
        failed: false,
        lastError: null,
      };
      state.dgramReadable = makeValueReadable(state, datagramQueueLimit, true);
      state.datagrams = {
        readable: state.dgramReadable.stream,
        maxDatagramSize: 0,
        incomingMaxAge: null,
        outgoingMaxAge: null,
        incomingHighWaterMark: 1,
        outgoingHighWaterMark: 1,
      };
      state.datagrams.writable = makeDatagramWritable(id, state.datagrams, state);
      state.datagrams.createWritable = () => makeDatagramWritable(id, state.datagrams, state);
      this.datagrams = state.datagrams;
      state.incomingUni = makeValueReadable(state, streamLimit, false);
      state.incomingBidi = makeValueReadable(state, streamLimit, false);
      state.dgramReadable.onCancel = () => {};
      state.incomingUni.onDeliver = (value) => {
        const entry = state.incomingUniValues.get(value);
        if (entry) entry.incomingAccepted = true;
      };
      state.incomingBidi.onDeliver = (value) => {
        const entry = state.incomingBidiValues.get(value);
        if (entry) entry.incomingAccepted = true;
      };
      state.incomingUni.onCancel = (reason) => cancelIncoming(state, 'uni', reason);
      state.incomingBidi.onCancel = (reason) => cancelIncoming(state, 'bidi', reason);
      this.incomingUnidirectionalStreams = state.incomingUni.stream;
      this.incomingBidirectionalStreams = state.incomingBidi.stream;
      this._state = state;
      sessions.set(id, state);
    }

    async createUnidirectionalStream() {
      const state = this._state;
      if (!state || state.closedFlag || state.failed) throw new WebTransportError('Session is not connected');
      const streamId = globalThis.__wtCreateStream(state.id, false);
      if (streamId < 0) throw new WebTransportError('Unable to create unidirectional stream', { source: 'stream' });
      const send = makeSendStream(state, streamId);
      createStreamEntry(state, streamId, false, send);
      return send.writable;
    }

    async createBidirectionalStream() {
      const state = this._state;
      if (!state || state.closedFlag || state.failed) throw new WebTransportError('Session is not connected');
      const streamId = globalThis.__wtCreateStream(state.id, true);
      if (streamId < 0) throw new WebTransportError('Unable to create bidirectional stream', { source: 'stream' });
      const send = makeSendStream(state, streamId);
      const entry = createStreamEntry(state, streamId, true, send);
      return { readable: entry.readable.stream, writable: send.writable };
    }

    close(closeInfo) {
      const state = this._state;
      if (!state || state.closedFlag) return;
      const code = closeInfo?.closeCode ?? 0;
      const reason = closeInfo?.reason ?? '';
      globalThis.__wtClose(state.id, code, String(reason));
    }
  }
  globalThis.WebTransport = WebTransport;

  globalThis.__wtDispatch = (sessionId, type, a, b, c) => {
    const state = sessions.get(sessionId);
    if (!state) return;
    switch (type) {
      case 'ready':
        if (!state.ready) {
          state.ready = true;
          state.datagrams.maxDatagramSize = Number(a) || 0;
          state.readyResolve();
        } else {
          state.datagrams.maxDatagramSize = Number(a) || 0;
        }
        break;
      case 'datagramCapacity':
        state.datagrams.maxDatagramSize = Number(a) || 0;
        break;
      case 'error':
        failSession(state, new WebTransportError(a || 'WebTransport error'));
        break;
      case 'closed':
        finishSession(state, a, b);
        break;
      case 'datagram':
        try { state.dgramReadable.offer(copyBytes(a)); } catch (_) {}
        break;
      case 'incomingUni': {
        if (state.streams.has(a)) break;
        const entry = createStreamEntry(state, a, true, null);
        entry.incomingKind = 'uni';
        state.incomingUniValues.set(entry.readable.stream, entry);
        if (!state.incomingUni.offer(entry.readable.stream)) {
          cancelRead(state, entry);
        }
        break;
      }
      case 'incomingBidi': {
        if (state.streams.has(a)) break;
        const send = makeSendStream(state, a);
        const entry = createStreamEntry(state, a, true, send);
        entry.incomingKind = 'bidi';
        const value = { readable: entry.readable.stream, writable: send.writable };
        state.incomingBidiValues.set(value, entry);
        if (!state.incomingBidi.offer(value)) {
          cancelRead(state, entry);
          sendAbort(send, 'incoming stream was not accepted');
        }
        break;
      }
      case 'streamData': {
        const entry = state.streams.get(a);
        if (entry) enqueueStreamData(state, entry, b, c === true);
        break;
      }
      case 'streamReset': {
        const entry = state.streams.get(a);
        if (entry) failRead(state, entry, streamError(`Stream reset (code ${b})`, b));
        break;
      }
      case 'streamWriteError': {
        const entry = state.streams.get(a);
        if (entry?.send) failSend(entry.send, streamError(`Peer reset stream (code ${b})`, b));
        break;
      }
      case 'streamWriteClosed': {
        const entry = state.streams.get(a);
        const send = entry?.send;
        if (!send) break;
        send.closedByNative = true;
        send.writeDone = true;
        if (send.closeResolve && send.finAdmitted) resolveClose(send);
        maybeCleanup(state, entry);
        break;
      }
      case 'writable':
        wakeWritable(state);
        break;
      default:
        break;
    }
  };
})();
