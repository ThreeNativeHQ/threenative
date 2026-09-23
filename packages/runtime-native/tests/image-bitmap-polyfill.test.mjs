import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const { test } = await import(process.env.VITEST ? "vitest" : "node:test");
const script = readFileSync(new URL("../src/runtime-scripts/image-bitmap-polyfill.js", import.meta.url), "utf8");

function host(decode) {
  const context = { ArrayBuffer, Uint8Array, __decodeImageDataAsync: decode };
  runInNewContext(script, context, { filename: "image-bitmap-polyfill.js" });
  return context;
}

for (const [name, source] of [
  ["an offset Uint8Array", new Uint8Array([99, 1, 2, 3, 88]).subarray(1, 4)],
  ["a prefix Uint8Array", new Uint8Array([1, 2, 3, 88]).subarray(0, 3)],
  ["a pooled Buffer", Buffer.from([99, 1, 2, 3, 88]).subarray(1, 4)],
]) {
  test(`createImageBitmap decodes only the byte range of ${name}`, async () => {
    let passed;
    const context = host((bytes, done) => {
      passed = [...new Uint8Array(bytes)];
      done({ width: 1, height: 1, _data: new ArrayBuffer(4) }, null);
    });
    const bitmap = await context.createImageBitmap(source);
    assert.equal(passed.length, 3, "unrelated backing-buffer bytes reached the decoder");
    assert.deepEqual(passed, [1, 2, 3]);
    assert.equal(bitmap.width, 1);
    assert.equal(bitmap.height, 1);
  });
}

test("a complete byte view keeps its backing buffer without another copy", async () => {
  const source = new Uint8Array([1, 2, 3]);
  let passed;
  const context = host((bytes, done) => {
    passed = bytes;
    done({ width: 1, height: 1, _data: new ArrayBuffer(4) }, null);
  });
  await context.createImageBitmap(source);
  assert.equal(passed, source.buffer);
});

test("native completion stays asynchronous and decode errors reject the promise", async () => {
  let complete;
  let settled = false;
  const context = host((_bytes, done) => { complete = done; });
  const promise = context.createImageBitmap(new ArrayBuffer(1));
  const observed = promise.then(() => { settled = true; }, (error) => {
    settled = true;
    throw error;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  const rejected = assert.rejects(observed, /invalid texture/u);
  complete(undefined, "invalid texture");
  await rejected;
});

test("Blob-like sources still await their encoded bytes", async () => {
  const bytes = new ArrayBuffer(3);
  let passed;
  const context = host((value, done) => {
    passed = value;
    done({ width: 2, height: 1, _data: new ArrayBuffer(8) }, null);
  });
  const bitmap = await context.createImageBitmap({ arrayBuffer: async () => bytes });
  assert.equal(passed, bytes);
  assert.equal(bitmap.width, 2);
});
