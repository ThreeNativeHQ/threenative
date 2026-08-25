(() => {
  const asIter = Symbol.asyncIterator;

  if (typeof globalThis.ReadableStream === "undefined") {
    class ReadableStreamDefaultController {
      constructor(stream) {
        this._stream = stream;
      }
      enqueue(chunk) {
        this._stream._enqueue(chunk);
      }
      close() {
        this._stream._close();
      }
      error(e) {
        this._stream._error(e);
      }
      get desiredSize() {
        const s = this._stream;
        if (s._state === "errored") return null;
        if (s._state === "closed") return 0;
        return 1;
      }
    }

    class ReadableStreamDefaultReader {
      constructor(stream) {
        this._stream = stream;
        let res;
        let rej;
        this._closedPromise = new Promise((a, b) => {
          res = a;
          rej = b;
        });
        this._closedResolve = res;
        this._closedReject = rej;
        this._closedPromise.catch(() => {});
        if (stream._state === "closed") res();
        else if (stream._state === "errored") rej(stream._storedError);
      }
      read() {
        const s = this._stream;
        if (!s) return Promise.reject(new TypeError("Reader has been released"));
        if (s._queue.length) return Promise.resolve({ value: s._queue.shift(), done: false });
        if (s._state === "errored") return Promise.reject(s._storedError);
        if (s._state === "closed") return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => s._readRequests.push({ resolve, reject }));
      }
      cancel(reason) {
        return this._stream ? this._stream.cancel(reason) : Promise.resolve();
      }
      releaseLock() {
        if (!this._stream) return;
        this._stream._reader = null;
        this._stream = null;
      }
      get closed() {
        return this._closedPromise;
      }
    }

    class ReadableStream {
      constructor(underlyingSource = {}, strategy = {}) {
        this._queue = [];
        this._readRequests = [];
        this._state = "readable";
        this._storedError = undefined;
        this._reader = null;
        this._source = underlyingSource || {};
        this._controller = new ReadableStreamDefaultController(this);
        if (typeof this._source.start === "function") {
          try {
            Promise.resolve(this._source.start(this._controller)).catch((e) => this._error(e));
          } catch (e) {
            this._error(e);
          }
        }
      }
      _enqueue(chunk) {
        if (this._state !== "readable") return;
        if (this._readRequests.length)
          this._readRequests.shift().resolve({ value: chunk, done: false });
        else this._queue.push(chunk);
      }
      _close() {
        if (this._state !== "readable") return;
        this._state = "closed";
        while (this._readRequests.length)
          this._readRequests.shift().resolve({ value: undefined, done: true });
        if (this._reader?._closedResolve) this._reader._closedResolve();
      }
      _error(e) {
        if (this._state !== "readable") return;
        this._state = "errored";
        this._storedError = e;
        while (this._readRequests.length) this._readRequests.shift().reject(e);
        if (this._reader?._closedReject) this._reader._closedReject(e);
      }
      get locked() {
        return this._reader !== null;
      }
      getReader(opts) {
        if (opts && opts.mode === "byob") throw new TypeError("BYOB readers are not supported");
        if (this._reader) throw new TypeError("ReadableStream is locked to a reader");
        this._reader = new ReadableStreamDefaultReader(this);
        return this._reader;
      }
      cancel(reason) {
        if (this._state === "readable") {
          this._queue = [];
          try {
            if (typeof this._source.cancel === "function") this._source.cancel(reason);
          } catch (e) {}
          this._close();
        }
        return Promise.resolve();
      }
      async pipeTo(dest, options = {}) {
        const pipeOptions = options || {};
        const reader = this.getReader();
        const writer = dest.getWriter();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (writer.ready) {
              try {
                await writer.ready;
              } catch (e) {}
            }
            await writer.write(value);
          }
          if (!pipeOptions.preventClose) await writer.close();
        } catch (e) {
          if (!pipeOptions.preventAbort) {
            try {
              await writer.abort(e);
            } catch (_) {}
          }
          reader.releaseLock();
          writer.releaseLock();
          throw e;
        }
        reader.releaseLock();
        writer.releaseLock();
      }
      pipeThrough(transform, options) {
        if (!transform || !transform.writable || !transform.readable)
          throw new TypeError("pipeThrough requires an object with { writable, readable }");
        this.pipeTo(transform.writable, options).catch(() => {});
        return transform.readable;
      }
      tee() {
        const reader = this.getReader();
        const boxA = {};
        boxA.stream = new globalThis.ReadableStream({
          start(c) {
            boxA.c = c;
          },
        });
        const boxB = {};
        boxB.stream = new globalThis.ReadableStream({
          start(c) {
            boxB.c = c;
          },
        });
        (async () => {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) {
                boxA.c.close();
                boxB.c.close();
                break;
              }
              boxA.c.enqueue(value);
              boxB.c.enqueue(value);
            }
          } catch (e) {
            boxA.c.error(e);
            boxB.c.error(e);
          }
        })();
        return [boxA.stream, boxB.stream];
      }
      [asIter]() {
        const reader = this.getReader();
        return {
          next() {
            return reader.read();
          },
          return(v) {
            reader.releaseLock();
            return Promise.resolve({ value: v, done: true });
          },
          [asIter]() {
            return this;
          },
        };
      }
    }
    globalThis.ReadableStream = ReadableStream;
  }

  if (typeof globalThis.WritableStream === "undefined") {
    class WritableStreamDefaultWriter {
      constructor(stream) {
        this._stream = stream;
        this.ready = Promise.resolve();
        let r;
        this.closed = new Promise((res) => {
          r = res;
        });
        this._closedResolve = r;
        this.closed.catch(() => {});
      }
      write(chunk) {
        const s = this._stream;
        if (!s) return Promise.reject(new TypeError("Writer has been released"));
        if (s._state === "errored") return Promise.reject(s._storedError);
        try {
          return Promise.resolve(s._sink.write ? s._sink.write(chunk, s._controller) : undefined);
        } catch (e) {
          s._error(e);
          return Promise.reject(e);
        }
      }
      close() {
        const s = this._stream;
        if (!s) return Promise.resolve();
        if (s._state === "writable") s._state = "closed";
        if (this._closedResolve) this._closedResolve();
        try {
          return Promise.resolve(s._sink.close ? s._sink.close() : undefined);
        } catch (e) {
          return Promise.reject(e);
        }
      }
      abort(reason) {
        const s = this._stream;
        if (!s) return Promise.resolve();
        s._state = "errored";
        s._storedError = reason;
        try {
          return Promise.resolve(s._sink.abort ? s._sink.abort(reason) : undefined);
        } catch (e) {
          return Promise.reject(e);
        }
      }
      get desiredSize() {
        return 1;
      }
      releaseLock() {
        if (this._stream) {
          this._stream._writer = null;
          this._stream = null;
        }
      }
    }

    class WritableStreamDefaultController {
      constructor(stream) {
        this._stream = stream;
      }
      error(e) {
        this._stream._error(e);
      }
    }

    class WritableStream {
      constructor(underlyingSink = {}, strategy = {}) {
        this._sink = underlyingSink || {};
        this._state = "writable";
        this._storedError = undefined;
        this._writer = null;
        this._controller = new WritableStreamDefaultController(this);
        if (typeof this._sink.start === "function") {
          try {
            this._sink.start(this._controller);
          } catch (e) {
            this._error(e);
          }
        }
      }
      _error(e) {
        if (this._state === "writable") {
          this._state = "errored";
          this._storedError = e;
        }
      }
      get locked() {
        return this._writer !== null;
      }
      getWriter() {
        if (this._writer) throw new TypeError("WritableStream is locked to a writer");
        this._writer = new WritableStreamDefaultWriter(this);
        return this._writer;
      }
      abort(reason) {
        if (this._state === "writable") {
          this._state = "errored";
          this._storedError = reason;
          try {
            if (this._sink.abort) this._sink.abort(reason);
          } catch (e) {}
        }
        return Promise.resolve();
      }
      close() {
        if (this._state === "writable") {
          this._state = "closed";
          try {
            if (this._sink.close) return Promise.resolve(this._sink.close());
          } catch (e) {
            return Promise.reject(e);
          }
        }
        return Promise.resolve();
      }
    }
    globalThis.WritableStream = WritableStream;
  }

  if (typeof globalThis.TransformStream === "undefined") {
    class TransformStream {
      constructor(transformer = {}, writableStrategy = {}, readableStrategy = {}) {
        const transformOptions = transformer || {};
        const box = {};
        this.readable = new globalThis.ReadableStream({
          start(c) {
            box.c = c;
          },
        });
        const transform =
          typeof transformOptions.transform === "function"
            ? transformOptions.transform
            : (chunk, controller) => controller.enqueue(chunk);
        const tc = {
          enqueue: (chunk) => box.c.enqueue(chunk),
          terminate: () => box.c.close(),
          error: (e) => box.c.error(e),
        };
        this.writable = new globalThis.WritableStream({
          start() {
            if (typeof transformOptions.start === "function") return transformOptions.start(tc);
          },
          write(chunk) {
            return transform(chunk, tc);
          },
          close() {
            const done =
              typeof transformOptions.flush === "function" ? transformOptions.flush(tc) : undefined;
            return Promise.resolve(done).then(() => box.c.close());
          },
          abort(reason) {
            box.c.error(reason);
          },
        });
      }
    }
    globalThis.TransformStream = TransformStream;
  }

  if (typeof globalThis.TextEncoderStream === "undefined") {
    class TextEncoderStream {
      constructor() {
        this.encoding = "utf-8";
        const encoder = new TextEncoder();
        const ts = new globalThis.TransformStream({
          transform(chunk, c) {
            c.enqueue(encoder.encode(chunk == null ? "" : String(chunk)));
          },
        });
        this.readable = ts.readable;
        this.writable = ts.writable;
      }
    }
    globalThis.TextEncoderStream = TextEncoderStream;
  }

  if (typeof globalThis.TextDecoderStream === "undefined") {
    class TextDecoderStream {
      constructor(label = "utf-8", options = {}) {
        this.encoding = label || "utf-8";
        const decoder = new TextDecoder(this.encoding);
        const ts = new globalThis.TransformStream({
          transform(chunk, c) {
            let bytes;
            if (chunk instanceof Uint8Array) bytes = chunk;
            else if (chunk instanceof ArrayBuffer) bytes = new Uint8Array(chunk);
            else if (ArrayBuffer.isView(chunk))
              bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
            else bytes = chunk;
            const text = decoder.decode(bytes);
            if (text) c.enqueue(text);
          },
        });
        this.readable = ts.readable;
        this.writable = ts.writable;
      }
    }
    globalThis.TextDecoderStream = TextDecoderStream;
  }
})();
