import { expect, test } from "vitest";

import { flushStdout, type IDrainableStream } from "../src/runner/cli.js";

// The CLI exits with `process.exit` so a browser that refuses to close cannot stall an `&&` chain.
// That discards whatever stdout has not flushed, and on a pipe — every caller that captures this
// CLI — writes are asynchronous. The iOS lane read exactly 8193 bytes of its report, cut
// mid-object, while the process still exited 0, so its verifier could not find the `"pass"` field
// that JSON never reached. Reproduced on Linux at its own 128KB pipe buffer: 131072 bytes written
// without a drain against 2000035 with one.

test("a stream with nothing pending needs no wait", async () => {
  let wrote = false;
  const stream: IDrainableStream = {
    writableLength: 0,
    write: (_chunk, callback) => {
      wrote = true;
      callback();
      return true;
    },
  };
  expect(await flushStdout(1_000, stream)).toBe(true);
  expect(wrote, "an empty buffer must not be probed").toBe(false);
});

test("pending bytes are waited for", async () => {
  const stream: IDrainableStream = {
    writableLength: 8_193,
    write: (_chunk, callback) => {
      setTimeout(callback, 5);
      return false;
    },
  };
  expect(await flushStdout(1_000, stream)).toBe(true);
});

test("a stalled reader loses to the deadline instead of hanging the exit", async () => {
  const stream: IDrainableStream = {
    writableLength: 8_193,
    // Never calls back: the far end stopped reading.
    write: () => false,
  };
  const startedAt = Date.now();
  expect(await flushStdout(50, stream)).toBe(false);
  expect(Date.now() - startedAt).toBeLessThan(2_000);
});
