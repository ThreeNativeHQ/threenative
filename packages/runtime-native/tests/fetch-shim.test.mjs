import assert from "node:assert/strict";
import { test } from "vitest";
import vm from "node:vm";
import {
  createGuestContext,
  createTimers,
  extractEmbeddedJs,
  guest,
  readRuntimeCpp,
} from "./embedded-js.mjs";

// The fetch shim backs every asset load in a native game: Three.js' FileLoader
// and GLTFLoader construct Requests, pass AbortSignals, and read Responses
// through this surface. These tests eval the exact embedded block into a bare
// context (no Node globals) the way the host evals it into QuickJS/V8.

function setupFetchContext(natives = {}) {
  const timers = createTimers();
  const context = createGuestContext({ setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, ...natives });
  vm.runInContext(extractEmbeddedJs(readRuntimeCpp(), "fetchPolyfill"), context);
  return { context, timers };
}

function bytes(value) {
  return Array.from(new Uint8Array(value));
}

test("fetch polyfill installs the globals Three.js loaders require", () => {
  const { context } = setupFetchContext();
  const installed = vm.runInContext(
    `[typeof fetch, typeof Response, typeof Request, typeof Headers, typeof Blob,
      typeof AbortController, typeof AbortSignal, typeof TextEncoder, typeof TextDecoder]`,
    context,
  );
  assert.deepEqual(guest(installed), [
    "function", "function", "function", "function", "function",
    "function", "function", "function", "function",
  ]);
});

test("TextEncoder/TextDecoder round-trip multi-byte UTF-8", () => {
  const { context } = setupFetchContext();
  const roundTrip = vm.runInContext(
    `(() => {
      const text = "héllo — 中文字 🎮";
      const bytes = new TextEncoder().encode(text);
      const decoded = new TextDecoder().decode(bytes);
      return [decoded === text, bytes.length > text.length];
    })()`,
    context,
  );
  assert.deepEqual(guest(roundTrip), [true, true]);
});

test("existing engine globals are not overwritten by the shims", () => {
  // V8 desktop ships TextDecoder natively; the guards must leave it alone.
  const source = readRuntimeCpp();
  const block = extractEmbeddedJs(source, "fetchPolyfill");
  assert.match(block, /if \(typeof TextDecoder === ["']undefined["']\)/u);
  assert.match(block, /if \(typeof TextEncoder === ["']undefined["']\)/u);
  assert.match(block, /if \(typeof AbortSignal === ["']undefined["']\)/u);
});

test("AbortController signals fire listeners exactly once and throwIfAborted carries the reason", async () => {
  const { context } = setupFetchContext();
  const result = await vm.runInContext(
    `(async () => {
      const controller = new AbortController();
      let fires = 0;
      controller.signal.addEventListener("abort", () => { fires += 1; });
      try { controller.signal.throwIfAborted(); } catch { throw new Error("threw before abort"); }
      controller.abort(new Error("game requested"));
      controller.abort(); // second abort is a no-op
      let caught;
      try { controller.signal.throwIfAborted(); } catch (e) { caught = e; }
      return {
        aborted: controller.signal.aborted,
        fires,
        reason: caught && caught.message,
        listenerReason: controller.signal.reason.message,
      };
    })()`,
    context,
  );
  assert.deepEqual(guest(result), {
    aborted: true,
    fires: 1,
    reason: "game requested",
    listenerReason: "game requested",
  });
});

test("Headers are case-insensitive and iterate lowercase keys like the Web API", () => {
  const { context } = setupFetchContext();
  const result = vm.runInContext(
    `(() => {
      const headers = new Headers({ "Content-Type": "model/gltf-binary" });
      headers.set("ACCEPT", "*/*");
      const fromArray = new Headers([["x-one", "1"], ["X-One", "2"]]);
      const entries = [];
      headers.forEach((value, key) => entries.push(key + "=" + value));
      return {
        get: headers.get("content-type"),
        mixedGet: headers.get("CONTENT-TYPE"),
        has: headers.has("accept"),
        lastWriteWins: fromArray.get("x-one"),
        entries,
        missingIsNull: headers.get("nope") === null,
      };
    })()`,
    context,
  );
  assert.deepEqual(guest(result), {
    get: "model/gltf-binary",
    mixedGet: "model/gltf-binary",
    has: true,
    lastWriteWins: "2",
    entries: ["content-type=model/gltf-binary", "accept=*/*"],
    missingIsNull: true,
  });
});

test("Response decodes body through text/json/arrayBuffer/blob", async () => {
  const { context } = setupFetchContext();
  const payload = JSON.stringify({ name: "abyss", depth: 42 });
  context.__payloadText = payload;
  const result = await vm.runInContext(
    `(async () => {
      const response = new Response(new TextEncoder().encode(__payloadText).buffer);
      const text = await response.text();
      return {
        status: response.status,
        ok: response.ok,
        json: await new Response(new TextEncoder().encode(text).buffer).json(),
        emptyBlobSize: (await new Response(new ArrayBuffer(0)).blob()).size,
        blobText: await (await response.blob()).text(),
      };
    })()`,
    context,
  );
  assert.deepEqual(guest(result).json, { name: "abyss", depth: 42 });
  assert.equal(result.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.emptyBlobSize, 0);
  assert.equal(result.blobText, payload);
});

test("Request carries url/method/headers/signal and unwraps a prior Request", () => {
  const { context } = setupFetchContext();
  const controller = new AbortController();
  context.__probeSignal = controller.signal;
  const result = vm.runInContext(
    `(() => {
      const fromUrl = new Request("models/ship.glb", {
        method: "POST", headers: { "x-game": "yes" }, signal: __probeSignal,
      });
      const rewrapped = new Request(fromUrl, { method: "PUT" });
      return {
        method: fromUrl.method,
        header: fromUrl.headers.get("x-game"),
        signalKept: rewrapped.signal === __probeSignal,
        rewrappedMethod: rewrapped.method,
        sameOrigin: fromUrl.credentials,
        bodyDefaultsNull: fromUrl.body === null,
      };
    })()`,
    context,
  );
  assert.deepEqual(guest(result), {
    method: "POST",
    header: "yes",
    signalKept: true,
    rewrappedMethod: "PUT",
    sameOrigin: "same-origin",
    bodyDefaultsNull: true,
  });
});

test("file fetch resolves 200 on data, 404 on null, and rejects on native error", async () => {
  const calls = [];
  const { context } = setupFetchContext({
    __readFileAsync: (path, callback) => {
      calls.push(path);
      // Shim semantics: a null data with no error string means "not found"
      // and becomes a 404 Response; any truthy error string rejects instead.
      if (path === "assets/missing.glb") callback(null, null);
      else if (path === "assets/broken.glb") callback(undefined, "io failure");
      else callback(new ArrayBuffer(3), undefined);
    },
  });

  const good = await vm.runInContext(`fetch("assets/ship.glb")`, context);
  assert.deepEqual(bytes(good._data), [0, 0, 0]);
  assert.equal(good.ok, true);

  const missing = await vm.runInContext(`fetch("assets/missing.glb")`, context);
  assert.equal(missing.status, 404);
  assert.equal(missing.ok, false);

  await assert.rejects(
    vm.runInContext(`fetch("assets/broken.glb")`, context),
    /File read error: io failure/u,
  );
  assert.deepEqual(calls, ["assets/ship.glb", "assets/missing.glb", "assets/broken.glb"]);
});

test("pre-aborted signal rejects fetch before any native call is made", async () => {
  let nativeCalls = 0;
  const { context } = setupFetchContext({
    __readFileAsync: () => { nativeCalls += 1; },
  });
  context.__makeAborted = () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    return controller.signal;
  };
  await assert.rejects(
    vm.runInContext(`fetch("assets/ship.glb", { signal: __makeAborted() })`, context),
    /cancelled/u,
  );
  assert.equal(nativeCalls, 0);
});

test("aborting mid-flight rejects the pending fetch promise", async () => {
  const { context } = setupFetchContext({
    __readFileAsync: (_path, callback) => {
      // Native op completes later; the late abort must still reject the game's promise.
      setTimeout(() => callback(new ArrayBuffer(1), undefined), 0);
    },
  });
  const outcome = await vm.runInContext(
    `(async () => {
      const controller = new AbortController();
      const pending = fetch("assets/ship.glb", { signal: controller.signal });
      controller.abort();
      try {
        await pending;
        return "resolved";
      } catch (e) {
        return e.message;
      }
    })()`,
    context,
  );
  assert.equal(outcome, "AbortError");
});

test("http fetch surfaces status fields and unwraps a Request for the native bridge", async () => {
  const seen = [];
  const { context } = setupFetchContext({
    __httpRequestAsync: (url, options, callback) => {
      seen.push({ url, method: options.method });
      if (url.includes("down")) callback({ error: "connection refused" });
      else callback({ ok: true, status: 200, url, data: new ArrayBuffer(4) });
    },
  });

  const response = await vm.runInContext(`fetch("https://cdn.example/ship.glb")`, context);
  assert.equal(response.ok, true);
  assert.equal(response.status, 200);

  // Three.js r168+ passes a Request object, not a URL string.
  const viaRequest = await vm.runInContext(
    `fetch(new Request("https://cdn.example/tracks.glb", { method: "GET" }))`,
    context,
  );
  assert.equal(viaRequest.status, 200);
  assert.deepEqual(seen.slice(0, 2), [
    { url: "https://cdn.example/ship.glb", method: undefined },
    { url: "https://cdn.example/tracks.glb", method: "GET" },
  ]);

  await assert.rejects(
    vm.runInContext(`fetch("https://cdn.example/down")`, context),
    /Fetch error: connection refused/u,
  );
});

test("unsupported URL schemes reject instead of falling through to file reads", async () => {
  const { context } = setupFetchContext({
    __readFileAsync: () => { throw new Error("must not be reached"); },
  });
  await assert.rejects(
    vm.runInContext(`fetch("ftp://cdn.example/ship.glb")`, context),
    /Unsupported URL scheme: ftp/u,
  );
});
