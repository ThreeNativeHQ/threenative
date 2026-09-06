(() => {
  const asIter = Symbol.asyncIterator;
  const noop = () => {};

  function highWaterMark(strategy, fallback) {
    const value = strategy?.highWaterMark;
    const result = value === undefined ? fallback : Number(value);
    if (Number.isNaN(result) || result < 0) {
      throw new RangeError("The property 'strategy.highWaterMark' is invalid");
    }
    return result;
  }

  function sizeAlgorithm(strategy) {
    const size = strategy?.size;
    if (size === undefined) return () => 1;
    if (typeof size !== "function") throw new TypeError("strategy.size must be a function");
    return (chunk) => {
      const result = Number(size(chunk));
      if (!Number.isFinite(result) || result < 0) {
        throw new RangeError("The argument 'size' is invalid");
      }
      return result;
    };
  }

  function validateSource(source) {
    const value = source == null ? {} : Object(source);
    if (value.type !== undefined) throw new TypeError("Byte streams are not supported");
    if (value.autoAllocateChunkSize !== undefined) {
      throw new TypeError("autoAllocateChunkSize is only supported for byte streams");
    }
    for (const key of ["start", "pull", "cancel"]) {
      if (value[key] !== undefined && typeof value[key] !== "function") {
        throw new TypeError(`underlyingSource.${key} must be a function`);
      }
    }
    return value;
  }

  if (typeof globalThis.ReadableStream === "undefined") {
    class ReadableStreamDefaultController {
      constructor(stream) {
        this._stream = stream;
      }
      enqueue(chunk) {
        return this._stream._enqueue(chunk);
      }
      close() {
        return this._stream._close();
      }
      error(reason) {
        this._stream._error(reason);
      }
      get desiredSize() {
        const stream = this._stream;
        if (stream._state === "errored") return null;
        if (stream._state === "closed") return 0;
        return stream._highWaterMark - stream._queueTotalSize;
      }
    }

    class ReadableStreamDefaultReader {
      constructor(stream) {
        this._stream = stream;
        let resolveClosed;
        let rejectClosed;
        this._closedSettled = false;
        this._closedPromise = new Promise((resolve, reject) => {
          resolveClosed = resolve;
          rejectClosed = reject;
        });
        this._closedResolve = (value) => {
          if (this._closedSettled) return;
          this._closedSettled = true;
          resolveClosed(value);
        };
        this._closedReject = (reason) => {
          if (this._closedSettled) return;
          this._closedSettled = true;
          rejectClosed(reason);
        };
        this._closedPromise.catch(noop);
        if (stream._state === "closed") this._closedResolve();
        else if (stream._state === "errored") this._closedReject(stream._storedError);
      }
      read() {
        const stream = this._stream;
        if (!stream) return Promise.reject(new TypeError("Reader has been released"));
        if (stream._queue.length) {
          const record = stream._queue.shift();
          stream._queueTotalSize -= record.size;
          if (stream._closeRequested && stream._queue.length === 0) stream._finishClose();
          stream._callPullIfNeeded();
          return Promise.resolve({ value: record.value, done: false });
        }
        if (stream._state === "errored") return Promise.reject(stream._storedError);
        if (stream._state === "closed") return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => {
          stream._readRequests.push({ resolve, reject });
          stream._callPullIfNeeded();
        });
      }
      cancel(reason) {
        if (!this._stream) return Promise.reject(new TypeError("Reader has been released"));
        return this._stream._cancel(reason);
      }
      releaseLock() {
        const stream = this._stream;
        if (!stream) return;
        this._stream = null;
        if (stream._reader === this) stream._reader = null;
        const reason = new TypeError("Reader has been released");
        while (stream._readRequests.length) stream._readRequests.shift().reject(reason);
        this._closedReject(reason);
        this._closedPromise = Promise.reject(reason);
        this._closedPromise.catch(noop);
      }
      get closed() {
        return this._closedPromise;
      }
    }

    class ReadableStream {
      constructor(underlyingSource = {}, strategy = {}) {
        const source = validateSource(underlyingSource);
        this._source = source;
        this._highWaterMark = highWaterMark(strategy, 1);
        this._sizeAlgorithm = sizeAlgorithm(strategy);
        this._queue = [];
        this._queueTotalSize = 0;
        this._readRequests = [];
        this._state = "readable";
        this._storedError = undefined;
        this._reader = null;
        this._closeRequested = false;
        this._pulling = false;
        this._pullAgain = false;
        this._cancelPromise = null;
        this._controller = new ReadableStreamDefaultController(this);

        let started;
        try {
          started = typeof source.start === "function" ? source.start(this._controller) : undefined;
        } catch (error) {
          started = Promise.reject(error);
        }
        this._startPromise = Promise.resolve(started);
        this._started = false;
        this._startPromise.then(
          () => {
            this._started = true;
            this._callPullIfNeeded();
          },
          (error) => this._error(error),
        );
      }
      _shouldCallPull() {
        return (
          this._state === "readable" &&
          !this._closeRequested &&
          typeof this._source.pull === "function" &&
          (this._readRequests.length > 0 || this._queueTotalSize < this._highWaterMark)
        );
      }
      _callPullIfNeeded() {
        if (!this._shouldCallPull()) return;
        if (!this._started) {
          this._pullAgain = true;
          return;
        }
        if (this._pulling) {
          this._pullAgain = true;
          return;
        }
        this._pulling = true;
        let result;
        try {
          result = this._source.pull(this._controller);
        } catch (error) {
          this._pulling = false;
          this._error(error);
          return;
        }
        Promise.resolve(result).then(
          () => {
            this._pulling = false;
            const pullAgain = this._pullAgain;
            this._pullAgain = false;
            if (pullAgain) this._callPullIfNeeded();
          },
          (error) => {
            this._pulling = false;
            this._error(error);
          },
        );
      }
      _enqueue(chunk) {
        if (this._state !== "readable" || this._closeRequested) {
          throw new TypeError("ReadableStream is not readable");
        }
        if (this._readRequests.length) {
          this._readRequests.shift().resolve({ value: chunk, done: false });
          this._callPullIfNeeded();
          return;
        }
        let size;
        try {
          size = this._sizeAlgorithm(chunk);
        } catch (error) {
          this._error(error);
          throw error;
        }
        this._queue.push({ value: chunk, size });
        this._queueTotalSize += size;
        this._callPullIfNeeded();
      }
      _close() {
        if (this._state !== "readable") throw new TypeError("ReadableStream is not readable");
        if (this._closeRequested) throw new TypeError("ReadableStream is already closing");
        this._closeRequested = true;
        if (this._queue.length === 0) this._finishClose();
      }
      _finishClose() {
        if (this._state !== "readable") return;
        this._state = "closed";
        while (this._readRequests.length) {
          this._readRequests.shift().resolve({ value: undefined, done: true });
        }
        if (this._reader) this._reader._closedResolve();
      }
      _error(reason) {
        if (this._state === "closed" || this._state === "errored") return;
        this._state = "errored";
        this._storedError = reason;
        this._closeRequested = false;
        this._pullAgain = false;
        this._queue = [];
        this._queueTotalSize = 0;
        while (this._readRequests.length) this._readRequests.shift().reject(reason);
        if (this._reader) this._reader._closedReject(reason);
      }
      _cancel(reason) {
        if (this._cancelPromise) return this._cancelPromise;
        if (this._state === "closed") return Promise.resolve();
        if (this._state === "errored") return Promise.reject(this._storedError);
        this._state = "closed";
        this._closeRequested = true;
        this._queue = [];
        this._queueTotalSize = 0;
        while (this._readRequests.length) this._readRequests.shift().resolve({ value: undefined, done: true });
        if (this._reader) this._reader._closedResolve();
        let result;
        try {
          result = typeof this._source.cancel === "function" ? this._source.cancel(reason) : undefined;
        } catch (error) {
          result = Promise.reject(error);
        }
        this._cancelPromise = Promise.resolve(result);
        this._cancelPromise.catch(noop);
        return this._cancelPromise;
      }
      get locked() {
        return this._reader !== null;
      }
      getReader(options) {
        if (options && options.mode === "byob") throw new TypeError("BYOB readers are not supported");
        if (options && options.mode !== undefined && options.mode !== "default") {
          throw new TypeError("Unsupported reader mode");
        }
        if (this._reader) throw new TypeError("ReadableStream is locked to a reader");
        this._reader = new ReadableStreamDefaultReader(this);
        return this._reader;
      }
      cancel(reason) {
        if (this._reader) return Promise.reject(new TypeError("ReadableStream is locked to a reader"));
        return this._cancel(reason);
      }
      async pipeTo(destination, options = {}) {
        const reader = this.getReader();
        const writer = destination.getWriter();
        const pipeOptions = options || {};
        try {
          while (true) {
            const result = await reader.read();
            if (result.done) break;
            await writer.ready;
            await writer.write(result.value);
          }
          if (!pipeOptions.preventClose) await writer.close();
        } catch (error) {
          if (!pipeOptions.preventAbort) {
            try { await writer.abort(error); } catch (_) {}
          }
          if (!pipeOptions.preventCancel) {
            try { await reader.cancel(error); } catch (_) {}
          }
          throw error;
        } finally {
          reader.releaseLock();
          writer.releaseLock();
        }
      }
      pipeThrough(transform, options) {
        if (!transform || !transform.writable || !transform.readable) {
          throw new TypeError("pipeThrough requires an object with { writable, readable }");
        }
        this.pipeTo(transform.writable, options).catch(noop);
        return transform.readable;
      }
      tee() {
        const reader = this.getReader();
        const branch = () => {
          const box = {};
          box.stream = new globalThis.ReadableStream({ start(controller) { box.controller = controller; } });
          return box;
        };
        const first = branch();
        const second = branch();
        (async () => {
          try {
            while (true) {
              const result = await reader.read();
              if (result.done) {
                first.controller.close();
                second.controller.close();
                break;
              }
              first.controller.enqueue(result.value);
              second.controller.enqueue(result.value);
            }
          } catch (error) {
            first.controller.error(error);
            second.controller.error(error);
          }
        })().catch(noop);
        return [first.stream, second.stream];
      }
      [asIter]() {
        const reader = this.getReader();
        return {
          next: () => reader.read(),
          return: (value) => {
            reader.releaseLock();
            return Promise.resolve({ value, done: true });
          },
          [asIter]() { return this; },
        };
      }
    }
    globalThis.ReadableStream = ReadableStream;
  }

  if (typeof globalThis.WritableStream === "undefined") {
    class WritableStreamDefaultController {
      constructor(stream) {
        this._stream = stream;
        this._abortController = new AbortController();
      }
      get signal() {
        return this._abortController.signal;
      }
      error(reason) {
        this._stream._error(reason);
      }
    }

    class WritableStreamDefaultWriter {
      constructor(stream) {
        this._stream = stream;
        this._readySettled = false;
        let resolveReady;
        let rejectReady;
        this.ready = new Promise((resolve, reject) => {
          resolveReady = resolve;
          rejectReady = reject;
        });
        this._readyResolve = (value) => {
          if (this._readySettled) return;
          this._readySettled = true;
          resolveReady(value);
        };
        this._readyReject = (reason) => {
          if (this._readySettled) return;
          this._readySettled = true;
          rejectReady(reason);
        };
        this._readyPromisePending = stream._state === "writable" && stream._backpressure;
        if (stream._state === "errored" || stream._state === "erroring") this._readyReject(stream._storedError);
        else if (!this._readyPromisePending) this._readyResolve();
        this.ready.catch(noop);

        this._closedSettled = false;
        let resolveClosed;
        let rejectClosed;
        this.closed = new Promise((resolve, reject) => {
          resolveClosed = resolve;
          rejectClosed = reject;
        });
        this._closedResolve = (value) => {
          if (this._closedSettled) return;
          this._closedSettled = true;
          resolveClosed(value);
        };
        this._closedReject = (reason) => {
          if (this._closedSettled) return;
          this._closedSettled = true;
          rejectClosed(reason);
        };
        this.closed.catch(noop);
        if (stream._state === "closed") this._closedResolve();
        else if (stream._state === "errored") this._closedReject(stream._storedError);
      }
      _makeReadyPending() {
        if (!this._readySettled) return;
        this._readySettled = false;
        this._readyPromisePending = true;
        let resolveReady;
        let rejectReady;
        this.ready = new Promise((resolve, reject) => {
          resolveReady = resolve;
          rejectReady = reject;
        });
        this._readyResolve = (value) => {
          if (this._readySettled) return;
          this._readySettled = true;
          this._readyPromisePending = false;
          resolveReady(value);
        };
        this._readyReject = (reason) => {
          if (this._readySettled) return;
          this._readySettled = true;
          rejectReady(reason);
        };
        this.ready.catch(noop);
      }
      _ensureReadyRejected(reason) {
        this._makeReadyPending();
        this._readyReject(reason);
      }
      write(chunk) {
        if (!this._stream) return Promise.reject(new TypeError("Writer has been released"));
        return this._stream._write(chunk);
      }
      close() {
        if (!this._stream) return Promise.reject(new TypeError("Writer has been released"));
        return this._stream._closeWriter();
      }
      abort(reason) {
        if (!this._stream) return Promise.reject(new TypeError("Writer has been released"));
        return this._stream._abort(reason);
      }
      get desiredSize() {
        return this._stream ? this._stream._desiredSize() : null;
      }
      releaseLock() {
        if (!this._stream) return;
        const stream = this._stream;
        this._stream = null;
        if (stream._writer === this) stream._writer = null;
        const reason = new TypeError("Writer has been released");
        this._readyReject(reason);
        this._closedReject(reason);
        this.ready = Promise.reject(reason);
        this.ready.catch(noop);
        this.closed = Promise.reject(reason);
        this.closed.catch(noop);
      }
    }

    class WritableStream {
      constructor(underlyingSink = {}, strategy = {}) {
        const sink = underlyingSink == null ? {} : Object(underlyingSink);
        for (const key of ["start", "write", "close", "abort"]) {
          if (sink[key] !== undefined && typeof sink[key] !== "function") {
            throw new TypeError(`underlyingSink.${key} must be a function`);
          }
        }
        this._sink = sink;
        this._highWaterMark = highWaterMark(strategy, 1);
        this._sizeAlgorithm = sizeAlgorithm(strategy);
        this._queue = [];
        this._queueTotalSize = 0;
        this._state = "writable";
        this._storedError = undefined;
        this._writer = null;
        this._writing = false;
        this._started = false;
        this._closePromise = null;
        this._abortPromise = null;
        this._pendingAbort = null;
        this._backpressure = this._queueTotalSize >= this._highWaterMark;
        this._controller = new WritableStreamDefaultController(this);

        let started;
        try {
          started = typeof sink.start === "function" ? sink.start(this._controller) : undefined;
        } catch (error) {
          started = Promise.reject(error);
        }
        this._startPromise = Promise.resolve(started);
        this._startPromise.then(
          () => {
            this._started = true;
            this._process();
          },
          (error) => {
            this._started = true;
            this._error(error);
            this._process();
          },
        );
      }
      _desiredSize() {
        if (this._state === "errored" || this._state === "erroring") return null;
        if (this._state === "closed") return 0;
        return this._highWaterMark - this._queueTotalSize;
      }
      _updateBackpressure() {
        if (this._state === "erroring" || this._state === "errored") return;
        const pressure = this._state === "writable" && this._queueTotalSize >= this._highWaterMark;
        if (pressure === this._backpressure) return;
        this._backpressure = pressure;
        if (!this._writer) return;
        if (pressure) this._writer._makeReadyPending();
        else this._writer._readyResolve();
      }
      _write(chunk) {
        if (this._state === "errored" || this._state === "erroring") return Promise.reject(this._storedError);
        if (this._state !== "writable") return Promise.reject(new TypeError("WritableStream is closing"));
        let size;
        try {
          size = this._sizeAlgorithm(chunk);
        } catch (error) {
          this._error(error);
          return Promise.reject(error);
        }
        // User-supplied size callbacks can error or close the stream.
        if (this._state === "errored" || this._state === "erroring") return Promise.reject(this._storedError);
        if (this._state !== "writable") return Promise.reject(new TypeError("WritableStream is closing"));
        const promise = new Promise((resolve, reject) => {
          this._queue.push({ kind: "write", chunk, size, resolve, reject });
          this._queueTotalSize += size;
          this._updateBackpressure();
          this._process();
        });
        promise.catch(noop);
        return promise;
      }
      _closeWriter() {
        if (this._state === "errored") return Promise.reject(this._storedError);
        if (this._state === "closed" || this._state === "closing" || this._closePromise) {
          return Promise.reject(new TypeError("WritableStream is already closing or closed"));
        }
        if (this._state !== "erroring") this._state = "closing";
        this._closePromise = new Promise((resolve, reject) => {
          this._queue.push({ kind: "close", size: 0, resolve, reject });
          this._updateBackpressure();
          this._process();
        });
        this._closePromise.catch(noop);
        return this._closePromise;
      }
      _abort(reason) {
        if (this._state === "closed" || this._state === "errored") return Promise.resolve();
        this._controller._abortController.abort(reason);
        const state = this._state;
        if (state === "closed" || state === "errored") return Promise.resolve();
        if (this._abortPromise) return this._abortPromise;
        const wasErroring = state === "erroring";
        this._abortPromise = new Promise((resolve, reject) => {
          this._pendingAbort = { reason: wasErroring ? undefined : reason, wasErroring, resolve, reject };
        });
        this._abortPromise.catch(noop);
        if (!wasErroring) this._error(reason);
        this._finishError();
        return this._abortPromise;
      }
      _error(reason) {
        if (this._state === "closed" || this._state === "errored" || this._state === "erroring") return;
        this._state = "erroring";
        this._storedError = reason;
        if (this._writer) this._writer._ensureReadyRejected(reason);
        this._finishError();
      }
      _finishError() {
        // A controller error stops new work, but the sink still owns its active
        // operation. Wait for start/write/close before tearing its resource down.
        if (this._state !== "erroring" || !this._started || this._writing) return;
        this._state = "errored";
        const reason = this._storedError;
        let close;
        while (this._queue.length) {
          const record = this._queue.shift();
          if (record.kind === "close") close = record;
          else record.reject(reason);
        }
        this._queueTotalSize = 0;
        const rejectClosed = () => {
          if (close) close.reject(reason);
          if (this._writer) this._writer._closedReject(reason);
        };
        const abort = this._pendingAbort;
        if (!abort) { rejectClosed(); return; }
        this._pendingAbort = null;
        if (abort.wasErroring) {
          abort.reject(reason);
          rejectClosed();
          return;
        }
        let result;
        try {
          result = typeof this._sink.abort === "function" ? this._sink.abort(abort.reason) : undefined;
        } catch (error) {
          result = Promise.reject(error);
        }
        Promise.resolve(result).then(
          () => { abort.resolve(); rejectClosed(); },
          (error) => { abort.reject(error); rejectClosed(); },
        );
      }
      _process() {
        if (this._state === "erroring") { this._finishError(); return; }
        if (!this._started || this._writing || this._queue.length === 0) return;
        const record = this._queue[0];
        this._writing = true;
        let result;
        try {
          result = record.kind === "close"
            ? (typeof this._sink.close === "function" ? this._sink.close() : undefined)
            : (typeof this._sink.write === "function" ? this._sink.write(record.chunk, this._controller) : undefined);
        } catch (error) {
          result = Promise.reject(error);
        }
        Promise.resolve(result).then(
          () => {
            this._writing = false;
            if (this._queue[0] !== record) return;
            this._queue.shift();
            this._queueTotalSize -= record.size;
            if (record.kind === "close") {
              this._state = "closed";
              this._storedError = undefined;
              if (this._pendingAbort) {
                this._pendingAbort.resolve();
                this._pendingAbort = null;
              }
              record.resolve();
              if (this._writer) {
                this._writer._readyResolve();
                this._writer._closedResolve();
              }
            } else {
              record.resolve();
              this._updateBackpressure();
            }
            this._process();
          },
          (error) => {
            this._writing = false;
            this._queue.shift();
            this._queueTotalSize -= record.size;
            record.reject(error);
            if (record.kind === "close" && this._pendingAbort) {
              this._pendingAbort.reject(error);
              this._pendingAbort = null;
            }
            this._error(error);
            this._finishError();
          },
        );
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
        if (this._writer) return Promise.reject(new TypeError("WritableStream is locked to a writer"));
        return this._abort(reason);
      }
      close() {
        if (this._writer) return Promise.reject(new TypeError("WritableStream is locked to a writer"));
        return this._closeWriter();
      }
    }
    globalThis.WritableStream = WritableStream;
  }

  if (typeof globalThis.TransformStream === "undefined") {
    class TransformStream {
      constructor(transformer = {}, writableStrategy = {}, readableStrategy = {}) {
        const options = transformer || {};
        const box = {};
        this.readable = new globalThis.ReadableStream({
          start(controller) { box.controller = controller; },
        }, readableStrategy);
        const transform = typeof options.transform === "function"
          ? options.transform
          : (chunk, controller) => controller.enqueue(chunk);
        const controller = {
          enqueue: (chunk) => box.controller.enqueue(chunk),
          terminate: () => box.controller.close(),
          error: (reason) => box.controller.error(reason),
        };
        this.writable = new globalThis.WritableStream({
          start() {
            return typeof options.start === "function" ? options.start(controller) : undefined;
          },
          write(chunk) {
            try {
              return Promise.resolve(transform(chunk, controller)).catch((error) => {
                box.controller.error(error);
                throw error;
              });
            } catch (error) {
              box.controller.error(error);
              throw error;
            }
          },
          close() {
            const flushed = typeof options.flush === "function" ? options.flush(controller) : undefined;
            return Promise.resolve(flushed).then(() => box.controller.close());
          },
          abort(reason) {
            box.controller.error(reason);
          },
        }, writableStrategy);
      }
    }
    globalThis.TransformStream = TransformStream;
  }

  if (typeof globalThis.TextEncoderStream === "undefined") {
    class TextEncoderStream {
      constructor() {
        this.encoding = "utf-8";
        const encoder = new TextEncoder();
        const stream = new globalThis.TransformStream({
          transform(chunk, controller) {
            controller.enqueue(encoder.encode(chunk == null ? "" : String(chunk)));
          },
        });
        this.readable = stream.readable;
        this.writable = stream.writable;
      }
    }
    globalThis.TextEncoderStream = TextEncoderStream;
  }

  if (typeof globalThis.TextDecoderStream === "undefined") {
    class TextDecoderStream {
      constructor(label = "utf-8", options = {}) {
        this.encoding = label || "utf-8";
        const decoder = new TextDecoder(this.encoding);
        const stream = new globalThis.TransformStream({
          transform(chunk, controller) {
            let bytes;
            if (chunk instanceof Uint8Array) bytes = chunk;
            else if (chunk instanceof ArrayBuffer) bytes = new Uint8Array(chunk);
            else if (ArrayBuffer.isView(chunk)) bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
            else bytes = chunk;
            const text = decoder.decode(bytes);
            if (text) controller.enqueue(text);
          },
        });
        this.readable = stream.readable;
        this.writable = stream.writable;
      }
    }
    globalThis.TextDecoderStream = TextDecoderStream;
  }
})();
