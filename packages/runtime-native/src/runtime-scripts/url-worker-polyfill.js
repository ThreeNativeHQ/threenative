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

// Worker polyfill — runs worker code on the main thread with async message passing.
// This enables WebWorker-based libraries (like Draco decoder) to function in native runtime.
if (typeof Worker === "undefined") {
  class Worker {
    constructor(url) {
      this.onmessage = null;
      this.onerror = null;
      this._terminated = false;
      this._workerSelf = null;
      // Browser semantics: messages posted before the worker script has registered
      // its handler are queued, not dropped. KTX2Loader posts 'init' immediately
      // after constructing the worker and registers handlers inside that script.
      this._pendingMessages = [];

      // Extract code from blob URL
      let code = "";
      if (typeof url === "string" && url.startsWith("blob:")) {
        const blob = URL._getBlobData(url);
        if (blob?._data) {
          const decoder = new TextDecoder();
          code = decoder.decode(new Uint8Array(blob._data));
        }
      }

      if (!code) {
        setTimeout(() => {
          if (this.onerror)
            this.onerror(new ErrorEvent("error", { message: "Failed to load worker script" }));
        }, 0);
        return;
      }
      const messageListeners = [];
      const workerSelf = {
        onmessage: null,
        // Emscripten worker builds read self.location.href for scriptDirectory
        // during init; without it BASIS()/Draco setup rejects silently.
        location: { href: "blob:threenative-worker.js" },
        addEventListener: (type, handler) => {
          // DedicatedWorkerGlobalScope API; KTX2Loader's transcoder workers
          // register their message handler through this instead of onmessage.
          if (type === "message" && typeof handler === "function") {
            messageListeners.push(handler);
          }
          setTimeout(() => this._flushPending(), 0);
        },
        removeEventListener: (type, handler) => {
          if (type === "message") {
            const index = messageListeners.indexOf(handler);
            if (index >= 0) messageListeners.splice(index, 1);
          }
        },
        hasMessageHandler: () => workerSelf.onmessage !== null || messageListeners.length > 0,
        _deliverFromMain: (event) => {
          if (workerSelf.onmessage !== null) {
            try {
              workerSelf.onmessage(event);
            } catch (e) {
              console.error("[Worker] message handler error:", e);
            }
          }
          for (const listener of messageListeners) {
            try {
              listener(event);
            } catch (e) {
              console.error("[Worker] message listener error:", e);
            }
          }
        },
        postMessage: (data) => {
          if (this._terminated) return;
          // Async delivery to main thread's onmessage handler and listeners
          setTimeout(() => {
            if (this._terminated) return;
            const event = { data };
            if (this.onmessage) {
              try {
                this.onmessage(event);
              } catch (e) {
                console.error("[Worker] onmessage error:", e);
              }
            }
            for (const listener of messageListeners) {
              try {
                listener(event);
              } catch (e) {
                console.error("[Worker] listener error:", e);
              }
            }
          }, 0);
        },
      };
      workerSelf.self = workerSelf;

      // importScripts polyfill — uses __readFileSync (synchronous bundle/FS read)
      // combined with TextDecoder to load and execute scripts synchronously,
      // matching the browser WebWorker importScripts() behavior.
      workerSelf.importScripts = (...urls) => {
        for (const url of urls) {
          const data = __readFileSync(url);
          if (!data) {
            throw new Error(`importScripts: Failed to load script: ${url}`);
          }
          const code = new TextDecoder().decode(new Uint8Array(data));
          Reflect.get(globalThis, "eval")(code);
        }
      };

      // Execute the worker code as a function with self and postMessage in scope.
      // The worker code can set self.onmessage and call postMessage() / self.postMessage().
      // We also provide a patched eval that handles Emscripten's `(var X = ...)` pattern,
      // which is invalid as an expression but common in WASM module loaders.
      try {
        const wrapped = `(function(self, postMessage, __nativeEval, importScripts) {\nvar eval = function(code) {\n  try { return __nativeEval(code); }\n  catch(e) {\n    if (e instanceof SyntaxError) {\n      var t = code.trim();\n      if (t[0]==="(" && t[t.length-1]===")") {\n        var inner = t.slice(1, -1).trim();\n        if (/^(?:var|let|const)\\s/.test(inner)) {\n          __nativeEval(inner);\n          var m = inner.match(/^(?:var|let|const)\\s+(\\w+)/);\n          if (m) return __nativeEval(m[1]);\n        }\n      }\n    }\n    throw e;\n  }\n};\n${code}\n})`;
        const evaluate = Reflect.get(globalThis, "eval");
        const fn = evaluate(wrapped);
        fn(workerSelf, workerSelf.postMessage, evaluate, workerSelf.importScripts);
      } catch (e) {
        console.error("[Worker] Initialization error:", e);
        setTimeout(() => {
          if (this.onerror) this.onerror(e);
        }, 0);
        return;
      }

      this._workerSelf = workerSelf;
      // The worker script may register handlers in a task after this one.
      setTimeout(() => this._flushPending(), 0);
    }

    postMessage(data) {
      if (this._terminated || !this._workerSelf) return;
      this._pendingMessages.push({ data });
      setTimeout(() => this._flushPending(), 0);
    }

    _flushPending() {
      if (this._terminated || !this._workerSelf) return;
      const ws = this._workerSelf;
      while (this._pendingMessages.length > 0 && ws.hasMessageHandler()) {
        const message = this._pendingMessages.shift();
        ws._deliverFromMain({ data: message.data });
      }
    }

    terminate() {
      this._terminated = true;
      this._workerSelf = null;
    }

    addEventListener(type, handler) {
      if (type === "message") this.onmessage = handler;
      else if (type === "error") this.onerror = handler;
    }

    removeEventListener() {}
  }

  globalThis.Worker = Worker;
}
