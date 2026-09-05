/**
 * WebTransport JavaScript polyfill.
 *
 * Defines the W3C WebTransport API surface on top of the low-level `__wt*` native bridge
 * functions registered by webtransport.cpp. Streams are backed by the runtime's WHATWG streams
 * polyfill, and native events enter through the single `globalThis.__wtDispatch` function.
 */
(() => {
  if (typeof globalThis.WebTransport !== 'undefined' && globalThis.__wtSessions) {
    return; // already installed
  }

  if (typeof globalThis.ReadableStream === 'undefined' ||
      typeof globalThis.WritableStream === 'undefined') {
    console.error('[WebTransport] Web Streams not available; WebTransport disabled.');
    return;
  }

  const sessions = new Map();
  globalThis.__wtSessions = sessions;

  // Statuses returned by __wtSendDatagram, mirroring the kDatagram* constants in
  // webtransport.cpp. Without them a write cannot tell a closed session from a
  // payload that does not fit from a local queue drop, which is what the old
  // "ignore the return value" write did.
  const dgramAccepted = 0;
  const dgramInvalidSession = -1;
  const dgramTooLarge = -2;
  const dgramDropped = -3;
  const dgramSendFailed = -4;

  class WebTransportError extends Error {
    constructor(message, options) {
      super(message || 'WebTransport error');
      this.name = 'WebTransportError';
      this.source = options?.source || 'session';
      this.streamErrorCode = options?.streamErrorCode ?? null;
    }
  }
  globalThis.WebTransportError = WebTransportError;

  function toBytes(chunk) {
    if (chunk instanceof Uint8Array) return chunk;
    if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
    if (ArrayBuffer.isView(chunk)) {
      return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    }
    return new Uint8Array(chunk);
  }

  function makeReadable() {
    const box = {};
    box.stream = new ReadableStream({ start(c) { box.controller = c; } });
    return box;
  }

  function makeSendStream(sessionId, streamId) {
    return new WritableStream({
      write(chunk) {
        const bytes = toBytes(chunk);
        const n = __wtStreamWrite(sessionId, streamId, bytes, false);
        if (n < 0) throw new WebTransportError('Failed to write to stream', { source: 'stream' });
      },
      close() {
        __wtStreamWrite(sessionId, streamId, new Uint8Array(0), true);
      },
      abort() {
        __wtStreamShutdown(sessionId, streamId, 0);
      },
    });
  }

  // `datagrams` is the live object whose maxDatagramSize the native side keeps
  // current, so the limit is read at write time rather than captured here.
  function makeDatagramWritable(sessionId, datagrams) {
    return new WritableStream({
      write(chunk) {
        const bytes = toBytes(chunk);
        // W3C WebTransport discards an oversized datagram silently and resolves.
        // This runtime reports it instead: PROTOCOL.md requires the write to be
        // validated against the real negotiated limit, and a game that writes
        // past it has a bug that silence would hide until the packets vanished.
        const limit = datagrams.maxDatagramSize;
        if (bytes.byteLength > limit) {
          throw new WebTransportError(
            `Datagram of ${bytes.byteLength} bytes exceeds the negotiated ${limit}-byte limit`,
          );
        }
        const status = __wtSendDatagram(sessionId, bytes);
        if (status === dgramInvalidSession) {
          throw new WebTransportError('Cannot send a datagram: the session is closed');
        }
        if (status === dgramTooLarge) {
          throw new WebTransportError(
            `Datagram of ${bytes.byteLength} bytes exceeds the transport's datagram limit`,
          );
        }
        // The path refused the frame outright. Unlike dgramDropped below this
        // is a transport failure, not this host trimming its own backlog, so
        // the write fails rather than being reported as sent.
        if (status === dgramSendFailed) {
          throw new WebTransportError('Datagram not sent: the transport refused it');
        }
        // dgramDropped: the local send queue was full and discarded its oldest
        // waiting datagram to admit this one. That is unreliable delivery doing
        // its job — local backlog, never network packet loss — so the write
        // succeeds, exactly as dgramAccepted does.
        if (status !== dgramAccepted && status !== dgramDropped) {
          throw new WebTransportError(`Datagram not sent (native status ${status})`);
        }
      },
    });
  }

  class WebTransport {
    constructor(url, options) {
      this._url = url;

      let readyResolve;
      let readyReject;
      let closedResolve;
      let closedReject;
      this.ready = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });
      this.closed = new Promise((res, rej) => { closedResolve = res; closedReject = rej; });
      this.closed.catch(() => {});

      const id = __wtConnect(String(url));
      if (!id || id <= 0) {
        const err = new WebTransportError(`Failed to initiate WebTransport connection to ${url}`);
        readyReject(err);
        closedReject(err);
        this._state = null;
        return;
      }

      const dgramReadable = makeReadable();
      const datagrams = {
        readable: dgramReadable.stream,
        // Zero until the native side reports what this connection actually
        // negotiated, which it does with `ready`. A write before then is
        // refused rather than sent against an invented limit.
        maxDatagramSize: 0,
        incomingMaxAge: null,
        outgoingMaxAge: null,
        incomingHighWaterMark: 1,
        outgoingHighWaterMark: 1,
      };
      datagrams.writable = makeDatagramWritable(id, datagrams);
      datagrams.createWritable = () => makeDatagramWritable(id, datagrams);
      this.datagrams = datagrams;

      const incomingUni = makeReadable();
      const incomingBidi = makeReadable();
      this.incomingUnidirectionalStreams = incomingUni.stream;
      this.incomingBidirectionalStreams = incomingBidi.stream;

      const state = {
        id,
        readyResolve, readyReject, closedResolve, closedReject,
        dgramReadable, incomingUni, incomingBidi, datagrams,
        streams: new Map(),
        ready: false,
        closedFlag: false,
        lastError: null,
      };
      this._state = state;
      sessions.set(id, state);
    }

    async createUnidirectionalStream() {
      const st = this._state;
      if (!st) throw new WebTransportError('Session is not connected');
      const sid = __wtCreateStream(st.id, false);
      if (sid < 0) throw new WebTransportError('Unable to create unidirectional stream', { source: 'stream' });
      return makeSendStream(st.id, sid);
    }

    async createBidirectionalStream() {
      const st = this._state;
      if (!st) throw new WebTransportError('Session is not connected');
      const sid = __wtCreateStream(st.id, true);
      if (sid < 0) throw new WebTransportError('Unable to create bidirectional stream', { source: 'stream' });
      const readable = makeReadable();
      const writable = makeSendStream(st.id, sid);
      st.streams.set(sid, { readable });
      return { readable: readable.stream, writable };
    }

    close(closeInfo) {
      const st = this._state;
      if (!st) return;
      const code = closeInfo?.closeCode || 0;
      const reason = closeInfo?.reason || '';
      __wtClose(st.id, code, reason);
    }
  }
  globalThis.WebTransport = WebTransport;

  globalThis.__wtDispatch = (sessionId, type, a, b, c) => {
    const st = sessions.get(sessionId);
    if (!st) return;

    switch (type) {
      // `a` is the datagram payload capacity the native side negotiated: quiche's
      // current writable datagram length minus this client's HTTP/3 session
      // framing. It arrives with ready and again whenever the path changes it.
      case 'ready':
        st.ready = true;
        st.datagrams.maxDatagramSize = Number(a) || 0;
        st.readyResolve();
        break;

      case 'datagramCapacity':
        st.datagrams.maxDatagramSize = Number(a) || 0;
        break;

      case 'error': {
        const err = new WebTransportError(a || 'WebTransport error');
        st.lastError = err;
        if (!st.ready) st.readyReject(err);
        break;
      }

      case 'closed': {
        if (st.closedFlag) break;
        st.closedFlag = true;
        const info = { closeCode: 0, reason: a || '' };
        if (!st.ready) {
          const err = st.lastError || new WebTransportError(a || 'WebTransport closed before ready');
          st.readyReject(err);
          st.closedReject(err);
        } else {
          st.closedResolve(info);
        }
        try { st.dgramReadable.controller.close(); } catch (e) {}
        try { st.incomingUni.controller.close(); } catch (e) {}
        try { st.incomingBidi.controller.close(); } catch (e) {}
        for (const s of st.streams.values()) {
          try { if (s.readable) s.readable.controller.close(); } catch (e) {}
        }
        sessions.delete(sessionId);
        break;
      }

      case 'datagram':
        try { st.dgramReadable.controller.enqueue(a); } catch (e) {}
        break;

      case 'incomingUni': {
        const readable = makeReadable();
        st.streams.set(a, { readable });
        try { st.incomingUni.controller.enqueue(readable.stream); } catch (e) {}
        break;
      }

      case 'incomingBidi': {
        const readable = makeReadable();
        const writable = makeSendStream(st.id, a);
        st.streams.set(a, { readable });
        try { st.incomingBidi.controller.enqueue({ readable: readable.stream, writable }); } catch (e) {}
        break;
      }

      case 'streamData': {
        const s = st.streams.get(a);
        if (s?.readable) {
          if (b?.length) { try { s.readable.controller.enqueue(b); } catch (e) {} }
          if (c) { try { s.readable.controller.close(); } catch (e) {} }
        }
        break;
      }

      case 'streamReset': {
        const s = st.streams.get(a);
        if (s?.readable) {
          try {
            s.readable.controller.error(new WebTransportError(`Stream reset (code ${b})`, { source: 'stream', streamErrorCode: b }));
          } catch (e) {}
        }
        st.streams.delete(a);
        break;
      }
    }
  };
})();
