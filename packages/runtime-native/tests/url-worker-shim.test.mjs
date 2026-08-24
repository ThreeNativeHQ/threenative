import assert from "node:assert/strict";
import { test } from "vitest";
import vm from "node:vm";
import {
  createGuestContext,
  createRecordingConsole,
  createTimers,
  extractEmbeddedJs,
  guest,
  readRuntimeCpp,
} from "./embedded-js.mjs";

// URL/URLSearchParams and the main-thread Worker polyfill. The Worker contract
// matters to real loaders: KTX2Loader posts 'init' immediately after
// constructing its transcoder worker and registers handlers inside the worker
// script, so messages sent before registration must queue, not drop.

function setupUrlWorkerContext(natives = {}) {
  const timers = createTimers();
  const consoleShim = createRecordingConsole();
  const context = createGuestContext({
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    console: consoleShim,
    ...natives,
  });
  const source = readRuntimeCpp();
  // All blocks land in one global, as in RuntimeImpl; the event constructors
  // are included because the Worker polyfill's failed-load path constructs an
  // ErrorEvent when its deferred callback fires.
  vm.runInContext(extractEmbeddedJs(source, "fetchPolyfill"), context);
  vm.runInContext(extractEmbeddedJs(source, "streamsPolyfill"), context);
  vm.runInContext(extractEmbeddedJs(source, "urlPolyfill"), context);
  vm.runInContext(extractEmbeddedJs(source, "eventConstructorsSetup"), context);
  return { context, timers };
}

test("URL parses protocol, authority, port, path, query and hash", () => {
  const { context } = setupUrlWorkerContext();
  const result = vm.runInContext(
    `(() => {
      const url = new URL("https://cdn.example:8443/assets/models/ship.glb?v=3#lod");
      return {
        protocol: url.protocol,
        host: url.host,
        hostname: url.hostname,
        port: url.port,
        pathname: url.pathname,
        search: url.search,
        hash: url.hash,
        origin: url.origin,
        href: url.href,
        queryParam: url.searchParams.get("v"),
        stringifies: String(url) === url.href,
      };
    })()`,
    context,
  );
  assert.deepEqual(guest(result), {
    protocol: "https:",
    host: "cdn.example:8443",
    hostname: "cdn.example",
    port: "8443",
    pathname: "/assets/models/ship.glb",
    search: "?v=3",
    hash: "#lod",
    origin: "https://cdn.example:8443",
    href: "https://cdn.example:8443/assets/models/ship.glb?v=3#lod",
    queryParam: "3",
    stringifies: true,
  });
});

test("relative URLs resolve against a base like GLTFLoader resource paths", () => {
  const { context } = setupUrlWorkerContext();
  const result = vm.runInContext(
    `(() => {
      const base = new URL("https://game.example/assets/scene.gltf");
      return {
        sibling: new URL("textures/hull.png", base).href,
        rootRelative: new URL("/shared/env.hdr", base).href,
        absoluteWins: new URL("https://other.example/x.bin", base).href,
        baseQueryIgnored: new URL("mesh.bin", "https://game.example/a/b.glb?token=x").href,
      };
    })()`,
    context,
  );
  assert.deepEqual(guest(result), {
    sibling: "https://game.example/assets/textures/hull.png",
    rootRelative: "https://game.example/shared/env.hdr",
    absoluteWins: "https://other.example/x.bin",
    baseQueryIgnored: "https://game.example/a/mesh.bin",
  });
});

test("URLSearchParams round-trips encoding and mutates in place", () => {
  const { context } = setupUrlWorkerContext();
  const result = vm.runInContext(
    `(() => {
      const params = new URLSearchParams("a=1&flag&b=hello%20world");
      params.set("a", "2");     // replaces every occurrence of a
      params.append("a", "3");  // appends a duplicate
      params.delete("flag");
      const entries = [...params.entries()];
      const fromObject = new URLSearchParams({ key: "val ue" });
      return {
        getA: params.get("a"),
        flagGone: params.has("flag"),
        entries,
        serialized: params.toString(),
        objectInit: fromObject.toString(),
        missingNull: params.get("nope") === null,
      };
    })()`,
    context,
  );
  assert.deepEqual(guest(result), {
    getA: "2",
    flagGone: false,
    entries: [["a", "2"], ["b", "hello world"], ["a", "3"]],
    serialized: "a=2&b=hello%20world&a=3",
    objectInit: "key=val%20ue",
    missingNull: true,
  });
});

function makeWorker(context, timers, script) {
  const blobUrl = vm.runInContext(
    `URL.createObjectURL(new Blob([${JSON.stringify(script)}]))`,
    context,
  );
  return vm.runInContext(`new Worker("${blobUrl}")`, context);
}

test("worker code runs and answers postMessage in both directions", () => {
  const { context, timers } = setupUrlWorkerContext();
  const worker = makeWorker(
    context,
    timers,
    `
      let counter = 0;
      self.onmessage = (event) => {
        counter += event.data;
        postMessage({ echo: event.data, total: counter });
      };
    `,
  );
  const received = [];
  worker.onmessage = (event) => received.push(event.data);

  worker.postMessage(2);
  worker.postMessage(5);
  timers.drain();

  assert.deepEqual(guest(received), [
    { echo: 2, total: 2 },
    { echo: 5, total: 7 },
  ]);
});

test("messages posted before the handler registers are queued, not dropped", () => {
  const { context, timers } = setupUrlWorkerContext();
  const worker = makeWorker(
    context,
    timers,
    `
      // KTX2Loader pattern: register the handler a tick later.
      setTimeout(() => {
        self.onmessage = (event) => postMessage({ got: event.data });
      }, 0);
    `,
  );
  const received = [];
  worker.onmessage = (event) => received.push(event.data);

  worker.postMessage("early-init"); // before the worker registered anything
  timers.drain();

  assert.deepEqual(guest(received), [{ got: "early-init" }]);
});

test("self.addEventListener('message') fires alongside onmessage for each delivery", () => {
  const { context, timers } = setupUrlWorkerContext();
  const worker = makeWorker(
    context,
    timers,
    `
      let listenerHits = 0;
      self.addEventListener("message", () => { listenerHits += 1; });
      self.onmessage = (event) => {
        if (event.data === "report") { postMessage({ listenerHits }); return; }
        postMessage({ ack: event.data });
      };
    `,
  );
  const received = [];
  worker.onmessage = (event) => received.push(event.data);
  worker.postMessage("ping");
  worker.postMessage("pong");
  worker.postMessage("report");
  timers.drain();

  // Both handler styles see every delivery: onmessage acknowledged all three
  // posts and the listener counted the two non-report deliveries too.
  // (Worker->worker posts are not echoed here; only onmessage responds.)
  assert.deepEqual(guest(received), [
    { ack: "ping" },
    { ack: "pong" },
    { listenerHits: 2 },
  ]);
});

test("terminate discards pending work: no further deliveries either way", () => {
  const { context, timers } = setupUrlWorkerContext();
  const worker = makeWorker(
    context,
    timers,
    `self.onmessage = (event) => postMessage({ got: event.data });`,
  );
  const received = [];
  worker.onmessage = (event) => received.push(event.data);

  worker.postMessage("in-flight");
  worker.terminate();
  timers.drain();

  // The message stays queued but is never delivered — terminate() stops both
  // directions without draining.
  assert.deepEqual(guest(received), []);
  assert.equal(worker._pendingMessages.length, 1);
});

test("importScripts loads scripts synchronously through the bundle reader", () => {
  const { context, timers } = setupUrlWorkerContext({
    __readFileSync: (path) => {
      if (path === "libs/helper.js") {
        const bytes = new TextEncoder().encode("globalThis.__helperLoaded = true;");
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
      return null;
    },
  });
  const worker = makeWorker(
    context,
    timers,
    `
      importScripts("libs/helper.js");
      self.onmessage = () => postMessage({ loaded: typeof __helperLoaded !== "undefined" && __helperLoaded });
    `,
  );
  const received = [];
  worker.onmessage = (event) => received.push(event.data);

  worker.postMessage("check");
  timers.drain();
  assert.deepEqual(guest(received), [{ loaded: true }]);
});

// RED while runtime.cpp ships no ErrorEvent definition: the failed-load path
// constructs one inside its deferred callback, so today the game sees a
// ReferenceError instead of its onerror handler.
test("a worker whose script cannot load reports through onerror", () => {
  const { context, timers } = setupUrlWorkerContext();
  const errors = [];
  const worker = vm.runInContext(`new Worker("blob:mystral-native/never-created")`, context);
  worker.onerror = (event) => errors.push(event.message ?? String(event));

  timers.drain();

  assert.equal(errors.length, 1);
  assert.match(errors[0], /Failed to load worker script/u);
});
