// URLSearchParams polyfill
if (typeof URLSearchParams === "undefined") {
  class URLSearchParams {
    constructor(init) {
      this._params = [];
      if (typeof init === "string") {
        const str = init.startsWith("?") ? init.slice(1) : init;
        if (str) {
          for (const pair of str.split("&")) {
            const eq = pair.indexOf("=");
            if (eq >= 0) {
              this._params.push([
                decodeURIComponent(pair.slice(0, eq)),
                decodeURIComponent(pair.slice(eq + 1)),
              ]);
            } else {
              this._params.push([decodeURIComponent(pair), ""]);
            }
          }
        }
      } else if (init && typeof init === "object") {
        if (Array.isArray(init)) {
          for (const [k, v] of init) this._params.push([String(k), String(v)]);
        } else {
          for (const [k, v] of Object.entries(init)) this._params.push([String(k), String(v)]);
        }
      }
    }
    get(name) {
      const entry = this._params.find(([k]) => k === name);
      return entry ? entry[1] : null;
    }
    has(name) {
      return this._params.some(([k]) => k === name);
    }
    set(name, value) {
      const idx = this._params.findIndex(([k]) => k === name);
      if (idx >= 0) this._params[idx] = [name, String(value)];
      else this._params.push([name, String(value)]);
    }
    append(name, value) {
      this._params.push([String(name), String(value)]);
    }
    delete(name) {
      this._params = this._params.filter(([k]) => k !== name);
    }
    toString() {
      return this._params
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
    }
    forEach(cb) {
      for (const [k, v] of this._params) cb(v, k, this);
    }
    entries() {
      return this._params[Symbol.iterator]();
    }
    keys() {
      return this._params.map(([k]) => k)[Symbol.iterator]();
    }
    values() {
      return this._params.map(([, v]) => v)[Symbol.iterator]();
    }
    [Symbol.iterator]() {
      return this.entries();
    }
  }
  globalThis.URLSearchParams = URLSearchParams;
}

// URL polyfill
if (typeof URL === "undefined") {
  const _blobStore = new Map();
  let _blobCounter = 0;

  class Url {
    constructor(url, base) {
      const inputUrl = typeof url === "string" ? url : String(url);
      let fullUrl = inputUrl;

      // Resolve relative URLs against base
      if (base !== undefined) {
        const b = typeof base === "string" ? base : String(base);
        if (/^[a-z][a-z0-9+.-]*:/i.test(inputUrl)) {
          // url is already absolute
          fullUrl = url;
        } else if (inputUrl.startsWith("//")) {
          const proto = b.match(/^([a-z][a-z0-9+.-]*:)/i);
          fullUrl = (proto ? proto[1] : "https:") + url;
        } else if (inputUrl.startsWith("/")) {
          const origin = b.match(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)/i);
          fullUrl = (origin ? origin[1] : "") + url;
        } else {
          const baseNoQuery = b.split("?")[0].split("#")[0];
          const lastSlash = baseNoQuery.lastIndexOf("/");
          fullUrl = baseNoQuery.slice(0, lastSlash + 1) + inputUrl;
        }
      }

      // Parse components
      const match = fullUrl.match(
        /^([a-z][a-z0-9+.-]*:)?(\/\/([^/?#]*))?([^?#]*)(\?[^#]*)?(#.*)?$/i,
      );
      if (!match) throw new TypeError(`Invalid URL: ${inputUrl}`);

      this.protocol = match[1] || "";
      const authority = match[3] || "";
      this.pathname = match[4] || "/";
      this.search = match[5] || "";
      this.hash = match[6] || "";

      // Parse authority (userinfo@host:port)
      const atIdx = authority.lastIndexOf("@");
      const hostPart = atIdx >= 0 ? authority.slice(atIdx + 1) : authority;
      const portMatch = hostPart.match(/:(\d+)$/);
      this.port = portMatch ? portMatch[1] : "";
      this.hostname = portMatch ? hostPart.slice(0, -portMatch[0].length) : hostPart;
      this.host = this.port ? `${this.hostname}:${this.port}` : this.hostname;
      this.origin = this.protocol ? `${this.protocol}//${this.host}` : "";
      this.href = fullUrl;
      this.username = "";
      this.password = "";
      if (atIdx >= 0) {
        const userInfo = authority.slice(0, atIdx);
        const colonIdx = userInfo.indexOf(":");
        this.username = colonIdx >= 0 ? userInfo.slice(0, colonIdx) : userInfo;
        this.password = colonIdx >= 0 ? userInfo.slice(colonIdx + 1) : "";
      }
      this.searchParams = new URLSearchParams(this.search);
    }

    toString() {
      return this.href;
    }
    toJSON() {
      return this.href;
    }

    static createObjectURL(blob) {
      const id = `blob:mystral-native/${_blobCounter++}`;
      _blobStore.set(id, blob);
      return id;
    }

    static revokeObjectURL(url) {
      _blobStore.delete(url);
    }

    // Internal: retrieve blob data for Worker polyfill
    static _getBlobData(url) {
      return _blobStore.get(url);
    }
  }

  globalThis.URL = Url;
}

// Standard Worker facade over the native registry. Worker source is never evaluated in this
// isolate: missing native callbacks and every unproved URL/scope branch fail by a stable name.
if (typeof Worker === "undefined") {
  const workers = new Map();

  const namedError = (name, message) => {
    const error = new Error(message);
    error.name = name;
    return error;
  };

  class Worker {
    constructor(url, options = {}) {
      this.onmessage = null;
      this.onerror = null;
      this._messageListeners = [];
      this._errorListeners = [];
      this._terminated = false;
      this._id = -1;

      if (options?.type === "module") {
        throw namedError(
          "NotSupportedError",
          "TN_NATIVE_WORKER_MODULE_UNSUPPORTED: module workers are not supported",
        );
      }
      if (typeof url !== "string" || !url.startsWith("blob:")) {
        throw namedError(
          "NotSupportedError",
          "TN_NATIVE_WORKER_URL_UNSUPPORTED: Phase 1 supports classic Blob workers only",
        );
      }
      if (
        typeof __tnNativeWorkerCreate !== "function" ||
        typeof __tnNativeWorkerPost !== "function" ||
        typeof __tnNativeWorkerTerminate !== "function"
      ) {
        throw namedError(
          "NotSupportedError",
          "TN_NATIVE_WORKER_UNAVAILABLE: native worker sources were not linked",
        );
      }

      const blob = typeof URL._getBlobData === "function" ? URL._getBlobData(url) : undefined;
      if (!blob?._data) {
        throw namedError(
          "NetworkError",
          "TN_NATIVE_WORKER_SOURCE_MISSING: Blob worker source is unavailable",
        );
      }
      const source = new TextDecoder().decode(new Uint8Array(blob._data));
      if (source.length === 0) {
        throw namedError(
          "NetworkError",
          "TN_NATIVE_WORKER_SOURCE_MISSING: Blob worker source is empty",
        );
      }

      this._id = __tnNativeWorkerCreate(source);
      if (!Number.isInteger(this._id) || this._id < 1) {
        throw namedError(
          "NotSupportedError",
          "TN_NATIVE_WORKER_UNAVAILABLE: native worker creation failed",
        );
      }
      workers.set(this._id, this);
    }

    postMessage(data, transfer = []) {
      if (this._terminated) return;
      if (transfer.length !== 0) {
        throw namedError(
          "DataCloneError",
          "TN_NATIVE_WORKER_TRANSFER_UNSUPPORTED: Phase 1 does not support transfer lists",
        );
      }
      let payload;
      try {
        payload = JSON.stringify(data);
      } catch (error) {
        throw namedError("DataCloneError", `TN_NATIVE_WORKER_CLONE_FAILED: ${error}`);
      }
      if (payload === undefined) {
        throw namedError(
          "DataCloneError",
          "TN_NATIVE_WORKER_CLONE_FAILED: value is not JSON-cloneable",
        );
      }
      if (!__tnNativeWorkerPost(this._id, payload)) {
        throw namedError("InvalidStateError", "TN_NATIVE_WORKER_POST_FAILED: worker is unavailable");
      }
    }

    terminate() {
      if (this._terminated) return;
      this._terminated = true;
      workers.delete(this._id);
      __tnNativeWorkerTerminate(this._id);
      this._messageListeners.length = 0;
      this._errorListeners.length = 0;
      this.onmessage = null;
      this.onerror = null;
    }

    addEventListener(type, handler) {
      if (typeof handler !== "function") return;
      if (type === "message") this._messageListeners.push(handler);
      else if (type === "error") this._errorListeners.push(handler);
    }

    removeEventListener(type, handler) {
      const listeners = type === "message" ? this._messageListeners : this._errorListeners;
      const index = listeners.indexOf(handler);
      if (index >= 0) listeners.splice(index, 1);
    }

    _dispatch(type, payload) {
      if (this._terminated) return;
      if (type === 1) {
        const event = new ErrorEvent("error", { message: payload });
        this.onerror?.(event);
        for (const listener of [...this._errorListeners]) listener(event);
        return;
      }
      let data;
      try {
        data = payload.length === 0 ? undefined : JSON.parse(payload);
      } catch (error) {
        const event = new ErrorEvent("error", {
          message: `TN_NATIVE_WORKER_CLONE_FAILED: ${error}`,
        });
        this.onerror?.(event);
        for (const listener of [...this._errorListeners]) listener(event);
        return;
      }
      const event = { data, target: this };
      this.onmessage?.(event);
      for (const listener of [...this._messageListeners]) listener(event);
    }
  }

  globalThis.__tnNativeWorkerDispatch = (id, type, payload) => {
    workers.get(id)?._dispatch(type, payload);
  };
  globalThis.Worker = Worker;
}
