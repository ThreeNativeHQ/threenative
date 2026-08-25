// TextDecoder polyfill (if not available)
if (typeof TextDecoder === "undefined") {
  class TextDecoder {
    constructor(encoding = "utf-8") {
      this.encoding = encoding;
    }
    decode(input) {
      if (!input) return "";
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
      let result = "";
      for (let i = 0; i < bytes.length; i++) {
        result += String.fromCharCode(bytes[i]);
      }
      // Handle UTF-8 decoding properly
      try {
        return decodeURIComponent(escape(result));
      } catch (e) {
        return result;
      }
    }
  }
  globalThis.TextDecoder = TextDecoder;
}

// TextEncoder polyfill (if not available)
if (typeof TextEncoder === "undefined") {
  class TextEncoder {
    constructor() {
      this.encoding = "utf-8";
    }
    encode(str) {
      const utf8 = unescape(encodeURIComponent(str));
      const result = new Uint8Array(utf8.length);
      for (let i = 0; i < utf8.length; i++) {
        result[i] = utf8.charCodeAt(i);
      }
      return result;
    }
  }
  globalThis.TextEncoder = TextEncoder;
}

// AbortController / AbortSignal polyfill (Web API standard)
// Three.js' FileLoader/GLTFLoader (r168+) construct an AbortController to
// manage fetch cancellation, so these globals must exist or loading throws
// "ReferenceError: AbortController is not defined". MystralNative's native
// fetch cannot cancel an in-flight request, but it honors an aborted signal
// by rejecting the fetch promise (see fetch() below).
if (typeof AbortSignal === "undefined") {
  class AbortSignal {
    constructor() {
      this.aborted = false;
      this.reason = undefined;
      this.onabort = null;
      this._listeners = [];
    }
    addEventListener(type, listener) {
      if (type === "abort" && typeof listener === "function") {
        this._listeners.push(listener);
      }
    }
    removeEventListener(type, listener) {
      if (type === "abort") {
        this._listeners = this._listeners.filter((l) => l !== listener);
      }
    }
    dispatchEvent(event) {
      if (event && event.type === "abort") {
        if (typeof this.onabort === "function") this.onabort(event);
        const listeners = this._listeners.slice();
        for (let i = 0; i < listeners.length; i++) listeners[i](event);
      }
      return true;
    }
    throwIfAborted() {
      if (this.aborted) throw this.reason !== undefined ? this.reason : new Error("AbortError");
    }
    _fireAbort(reason) {
      if (this.aborted) return;
      this.aborted = true;
      this.reason = reason !== undefined ? reason : new Error("AbortError");
      this.dispatchEvent({ type: "abort", target: this });
    }
    static abort(reason) {
      const signal = new AbortSignal();
      signal._fireAbort(reason);
      return signal;
    }
    static timeout(ms) {
      const signal = new AbortSignal();
      setTimeout(() => {
        signal._fireAbort(new Error("TimeoutError"));
      }, ms);
      return signal;
    }
    static any(signals) {
      const result = new AbortSignal();
      const list = Array.from(signals || []);
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (!s) continue;
        if (s.aborted) {
          result._fireAbort(s.reason);
          return result;
        }
        s.addEventListener("abort", () => {
          result._fireAbort(s.reason);
        });
      }
      return result;
    }
  }
  globalThis.AbortSignal = AbortSignal;
}

if (typeof AbortController === "undefined") {
  class AbortController {
    constructor() {
      this.signal = new AbortSignal();
    }
    abort(reason) {
      this.signal._fireAbort(reason);
    }
  }
  globalThis.AbortController = AbortController;
}

// Blob class (Web API standard)
if (typeof Blob === "undefined") {
  class Blob {
    constructor(blobParts = [], options = {}) {
      this.type = options.type || "";

      // Concatenate all parts into a single ArrayBuffer
      let totalSize = 0;
      const parts = [];

      for (const part of blobParts) {
        if (part instanceof ArrayBuffer) {
          parts.push(new Uint8Array(part));
          totalSize += part.byteLength;
        } else if (part instanceof Uint8Array) {
          parts.push(part);
          totalSize += part.byteLength;
        } else if (part instanceof Blob) {
          // Need to get the Blob's internal data
          parts.push(new Uint8Array(part._data));
          totalSize += part._data.byteLength;
        } else if (typeof part === "string") {
          const encoder = new TextEncoder();
          const encoded = encoder.encode(part);
          parts.push(encoded);
          totalSize += encoded.byteLength;
        }
      }

      // Create final buffer
      const buffer = new ArrayBuffer(totalSize);
      const view = new Uint8Array(buffer);
      let offset = 0;
      for (const part of parts) {
        view.set(part, offset);
        offset += part.byteLength;
      }

      this._data = buffer;
      this.size = totalSize;
    }

    async arrayBuffer() {
      return this._data;
    }

    async text() {
      const decoder = new TextDecoder();
      return decoder.decode(new Uint8Array(this._data));
    }

    slice(start = 0, end = this.size, type = "") {
      const data = new Uint8Array(this._data, start, end - start);
      return new Blob([data], { type });
    }

    async stream() {
      // ReadableStream not implemented yet
      throw new Error("Blob.stream() not implemented");
    }
  }
  globalThis.Blob = Blob;
}

// Headers class - mimics Web Headers API
class Headers {
  constructor(init = {}) {
    this._headers = new Map();
    if (init) {
      if (init instanceof Headers) {
        for (const [key, value] of init) {
          this._headers.set(key.toLowerCase(), value);
        }
      } else if (Array.isArray(init)) {
        for (const [key, value] of init) {
          this._headers.set(key.toLowerCase(), value);
        }
      } else if (typeof init === "object") {
        for (const [key, value] of Object.entries(init)) {
          this._headers.set(key.toLowerCase(), value);
        }
      }
    }
  }

  get(name) {
    return this._headers.get(name.toLowerCase()) || null;
  }

  set(name, value) {
    this._headers.set(name.toLowerCase(), value);
  }

  has(name) {
    return this._headers.has(name.toLowerCase());
  }

  delete(name) {
    this._headers.delete(name.toLowerCase());
  }

  entries() {
    return this._headers.entries();
  }

  keys() {
    return this._headers.keys();
  }

  values() {
    return this._headers.values();
  }

  forEach(callback) {
    this._headers.forEach((value, key) => callback(value, key, this));
  }

  [Symbol.iterator]() {
    return this._headers.entries();
  }
}
globalThis.Headers = Headers;

// Response class
class Response {
  constructor(data, options = {}) {
    this._data = data;
    this.ok = options.ok !== undefined ? options.ok : true;
    this.status = options.status || 200;
    this.statusText = options.statusText || "OK";
    this.url = options.url || "";
    this.headers = new Headers(options.headers || {});
  }

  async arrayBuffer() {
    return this._data;
  }

  async text() {
    const decoder = new TextDecoder();
    return decoder.decode(new Uint8Array(this._data));
  }

  async json() {
    const text = await this.text();
    return JSON.parse(text);
  }

  async blob() {
    return new Blob([this._data]);
  }
}

// Request class (Web API standard) - Three.js' FileLoader (r168+) wraps the
// URL in a Request (with headers/credentials/signal) before calling fetch().
class Request {
  constructor(input, init = {}) {
    if (input && typeof input === "object" && typeof input.url === "string") {
      this.url = input.url;
      this.method = init.method || input.method || "GET";
      this.headers = new Headers(init.headers || input.headers || {});
      this.credentials = init.credentials || input.credentials || "same-origin";
      this.signal = init.signal || input.signal || null;
      this.body = init.body !== undefined ? init.body : input.body != null ? input.body : null;
    } else {
      this.url = String(input);
      this.method = init.method || "GET";
      this.headers = new Headers(init.headers || {});
      this.credentials = init.credentials || "same-origin";
      this.signal = init.signal || null;
      this.body = init.body !== undefined ? init.body : null;
    }
    this.mode = init.mode || "cors";
  }
}
globalThis.Request = Request;

// Fetch function - supports file://, http://, and https://
// HTTP requests are now async via libuv (non-blocking)
// Accepts either a URL string or a Request object (Three.js passes a Request).
async function fetch(input, options = {}) {
  let url;
  if (input && typeof input === "object" && typeof input.url === "string") {
    // Unwrap a Request object: pull url + per-request fields unless overridden.
    url = input.url;
    if (options.signal === undefined && input.signal) options.signal = input.signal;
    if (options.method === undefined && input.method) options.method = input.method;
    if (options.headers === undefined && input.headers) options.headers = input.headers;
    if (options.body === undefined && input.body != null) options.body = input.body;
  } else {
    url = String(input);
  }

  // AbortController support: reject up-front if the signal is already aborted.
  // The native request itself cannot be cancelled mid-flight, but a late abort
  // rejects the promise (the in-flight native op simply completes and is ignored).
  const signal = options?.signal;
  const abortError = () =>
    signal && signal.reason !== undefined ? signal.reason : new Error("AbortError");
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }

  // blob: URLs - created via URL.createObjectURL(). Three.js GLTFLoader uses
  // these for embedded (GLB) and external textures, fetched by ImageBitmapLoader.
  if (url.startsWith("blob:")) {
    const blob = typeof URL !== "undefined" && URL._getBlobData ? URL._getBlobData(url) : null;
    if (!blob) {
      return new Response(new ArrayBuffer(0), {
        ok: false,
        status: 404,
        statusText: "Not Found",
        url,
      });
    }
    let data = blob._data;
    if (data instanceof Uint8Array) data = data.buffer;
    if (!(data instanceof ArrayBuffer)) data = new ArrayBuffer(0);
    return new Response(data, {
      ok: true,
      status: 200,
      statusText: "OK",
      url,
      headers: { "content-type": blob.type || "" },
    });
  }

  // Check URL type
  if (url.startsWith("http://") || url.startsWith("https://")) {
    // HTTP/HTTPS request via async libcurl + libuv (non-blocking)
    return new Promise((resolve, reject) => {
      if (signal) signal.addEventListener("abort", () => reject(abortError()));
      __httpRequestAsync(url, options, (result) => {
        if (result.error) {
          reject(new Error(`Fetch error: ${result.error}`));
        } else {
          resolve(
            new Response(result.data || new ArrayBuffer(0), {
              ok: result.ok,
              status: result.status,
              statusText: result.ok ? "OK" : "Error",
              url: result.url || url,
            }),
          );
        }
      });
    });
  }

  // File URL or relative path - use async file reading for non-blocking I/O
  let path = url;
  if (url.startsWith("file://")) {
    path = url;
  } else if (!url.includes("://")) {
    // Relative path - treat as file
    path = url;
  } else {
    throw new Error(`Unsupported URL scheme: ${url.split("://")[0]}`);
  }

  // Use async file reading to avoid blocking the render loop
  return new Promise((resolve, reject) => {
    if (signal) signal.addEventListener("abort", () => reject(abortError()));
    __readFileAsync(path, (data, error) => {
      if (error) {
        reject(new Error(`File read error: ${error}`));
      } else if (data === null) {
        resolve(
          new Response(new ArrayBuffer(0), {
            ok: false,
            status: 404,
            statusText: "Not Found",
            url: url,
          }),
        );
      } else {
        resolve(
          new Response(data, {
            ok: true,
            status: 200,
            statusText: "OK",
            url: url,
          }),
        );
      }
    });
  });
}

// Also expose globally
globalThis.fetch = fetch;
globalThis.Response = Response;
