import assert from "node:assert/strict";
import { test } from "vitest";
import vm from "node:vm";
import {
  createGuestContext,
  extractEmbeddedJs,
  guest,
  readRuntimeCpp,
} from "./embedded-js.mjs";

// The WHATWG streams shim backs Response bodies, GLTF streaming loaders and
// TextEncoderStream/TextDecoderStream pipelines on engines that lack them
// natively (QuickJS). Evaluated here exactly as the host does: fetch first
// (it owns TextEncoder/TextDecoder), then the streams block.

function setupStreamsContext() {
  const context = createGuestContext();
  vm.runInContext(extractEmbeddedJs(readRuntimeCpp(), "fetchPolyfill"), context);
  vm.runInContext(extractEmbeddedJs(readRuntimeCpp(), "streamsPolyfill"), context);
  return context;
}

test("streams polyfill installs the full WHATWG surface", () => {
  const context = setupStreamsContext();
  const installed = vm.runInContext(
    `[typeof ReadableStream, typeof WritableStream, typeof TransformStream,
      typeof TextEncoderStream, typeof TextDecoderStream]`,
    context,
  );
  assert.deepEqual(guest(installed), ["function", "function", "function", "function", "function"]);
});

test("ReadableStream delivers queued chunks then done", async () => {
  const context = setupStreamsContext();
  const result = await vm.runInContext(
    `(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          controller.enqueue(new Uint8Array([2]));
          controller.close();
        },
      });
      const chunks = [];
      const reader = stream.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(...value);
      }
      await reader.closed;
      return { chunks, desiredSizeAfterClose: reader.desiredSize };
    })()`,
    context,
  );
  assert.deepEqual(guest(result).chunks, [1, 2]);
  assert.equal(guest(result).desiredSizeAfterClose, undefined);
});

test("reads made before enqueue are fulfilled when the chunk arrives", async () => {
  const context = setupStreamsContext();
  const result = await vm.runInContext(
    `(async () => {
      let controller;
      const stream = new ReadableStream({ start(c) { controller = c; } });
      const reader = stream.getReader();
      const pending = reader.read();
      // Snapshot whether the pending read settles on its own before any chunk.
      const stateBeforeEnqueue = await Promise.race([
        pending.then(() => "settled"),
        Promise.resolve("still-pending"),
      ]);
      controller.enqueue("chunk");
      const first = await pending;
      controller.close();
      const last = await reader.read();
      return {
        stateBeforeEnqueue,
        value: first.value,
        done: first.done,
        closed: last.done,
      };
    })()`,
    context,
  );
  assert.deepEqual(guest(result), { stateBeforeEnqueue: "still-pending", value: "chunk", done: false, closed: true });
});

test("stream errors reject pending and future reads and mark desiredSize null", async () => {
  const context = setupStreamsContext();
  const result = await vm.runInContext(
    `(async () => {
      let failure;
      const stream = new ReadableStream({
        start() { throw new Error("source exploded"); },
      });
      const reader = stream.getReader();
      try { await reader.read(); } catch (e) { failure = e.message; }
      return { failure, desiredSize: reader.desiredSize ?? stream._controller.desiredSize };
    })()`,
    context,
  );
  assert.equal(guest(result).failure, "source exploded");
  assert.equal(guest(result).desiredSize, null);
});

test("a locked stream refuses a second reader; releaseLock frees it", () => {
  const context = setupStreamsContext();
  const result = vm.runInContext(
    `(() => {
      const stream = new ReadableStream({});
      const first = stream.getReader();
      let secondThrew = null;
      try { stream.getReader(); } catch (e) { secondThrew = e.message; }
      first.releaseLock();
      const second = stream.getReader();
      return { lockedWhileHeld: stream.locked, secondThrew, lockedAgain: stream.locked };
    })()`,
    context,
  );
  assert.equal(guest(result).lockedWhileHeld, true);
  assert.match(guest(result).secondThrew, /locked/u);
  assert.equal(guest(result).lockedAgain, true);
});

test("async iteration drains the stream and tee duplicates every chunk", async () => {
  const context = setupStreamsContext();
  const result = await vm.runInContext(
    `(async () => {
      const source = new ReadableStream({
        start(controller) {
          for (const byte of [7, 8, 9]) controller.enqueue(byte);
          controller.close();
        },
      });
      const iterated = [];
      for await (const chunk of source) iterated.push(chunk);

      const original = new ReadableStream({
        start(controller) {
          controller.enqueue("a");
          controller.enqueue("b");
          controller.close();
        },
      });
      const [branchA, branchB] = original.tee();
      const fromA = [];
      for await (const chunk of branchA) fromA.push(chunk);
      const fromB = [];
      for await (const chunk of branchB) fromB.push(chunk);
      return { iterated, fromA, fromB };
    })()`,
    context,
  );
  assert.deepEqual(guest(result).iterated, [7, 8, 9]);
  assert.deepEqual(guest(result).fromA, ["a", "b"]);
  assert.deepEqual(guest(result).fromB, ["a", "b"]);
});

test("pipeTo forwards chunks into a writable sink and closes it", async () => {
  const context = setupStreamsContext();
  const result = await vm.runInContext(
    `(async () => {
      const written = [];
      let sinkClosed = false;
      const dest = new WritableStream({
        write(chunk) { written.push(chunk); },
        close() { sinkClosed = true; },
      });
      const source = new ReadableStream({
        start(controller) {
          controller.enqueue(1);
          controller.enqueue(2);
          controller.close();
        },
      });
      await source.pipeTo(dest);
      return { written, sinkClosed };
    })()`,
    context,
  );
  assert.deepEqual(guest(result).written, [1, 2]);
  assert.equal(guest(result).sinkClosed, true);
});

test("TransformStream + text streams round-trip bytes back to text", async () => {
  const context = setupStreamsContext();
  const result = await vm.runInContext(
    `(async () => {
      const upper = new TransformStream({
        transform(chunk, controller) { controller.enqueue(chunk.toUpperCase()); },
      });
      const writer = upper.writable.getWriter();
      writer.write("ab");
      writer.write("cd");
      writer.close();

      const piped = new TextEncoderStream();
      const decoded = new TextDecoderStream();

      const collected = [];
      for await (const chunk of upper.readable.pipeThrough(piped).pipeThrough(decoded)) {
        collected.push(chunk);
      }
      return collected.join("");
    })()`,
    context,
  );
  assert.equal(guest(result), "ABCD");
});

test("identity TransformStream passes chunks through untouched", async () => {
  const context = setupStreamsContext();
  const result = await vm.runInContext(
    `(async () => {
      const identity = new TransformStream();
      const writer = identity.writable.getWriter();
      const read = identity.readable.getReader().read();
      writer.write("passthrough");
      const { value } = await read;
      writer.close();
      return value;
    })()`,
    context,
  );
  assert.equal(guest(result), "passthrough");
});
