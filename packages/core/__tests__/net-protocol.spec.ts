import { describe, expect, it } from "vitest";
import { FrameReader, KIND_BOUND, KIND_DATA, encodeFrame } from "../src/net-protocol.js";

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function readableFrom(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function expectFrame(
  reader: FrameReader,
  expected: { kind: number; channel: number; payload: number[] },
): Promise<void> {
  const frame = await reader.nextFrame();
  expect(frame.kind).toBe(expected.kind);
  expect(frame.channel).toBe(expected.channel);
  expect(Array.from(frame.payload)).toEqual(expected.payload);
}

describe("FrameReader", () => {
  it("returns multiple complete frames from one chunk exactly once and in order", async () => {
    const reader = new FrameReader(
      readableFrom([
        concat([
          encodeFrame(KIND_DATA, 1, new Uint8Array([1])),
          encodeFrame(KIND_DATA, 1, new Uint8Array([2])),
        ]),
      ]),
      64,
    );

    try {
      await expectFrame(reader, { kind: KIND_DATA, channel: 1, payload: [1] });
      await expectFrame(reader, { kind: KIND_DATA, channel: 1, payload: [2] });
      await expect(reader.nextFrame()).rejects.toThrow(/TN_NET_PROTOCOL: stream ended/u);
    } finally {
      reader.release();
    }
  });

  it("retains a complete frame before a partial frame", async () => {
    const first = encodeFrame(KIND_DATA, 1, new Uint8Array([1]));
    const second = encodeFrame(KIND_DATA, 1, new Uint8Array([2, 3]));
    const splitAt = 4;
    const reader = new FrameReader(
      readableFrom([concat([first, second.slice(0, splitAt)]), second.slice(splitAt)]),
      64,
    );

    try {
      await expectFrame(reader, { kind: KIND_DATA, channel: 1, payload: [1] });
      await expectFrame(reader, { kind: KIND_DATA, channel: 1, payload: [2, 3] });
    } finally {
      reader.release();
    }
  });

  it("delivers coalesced BOUND and DATA frames in order", async () => {
    const reader = new FrameReader(
      readableFrom([
        concat([
          encodeFrame(KIND_BOUND, 2, new Uint8Array(0)),
          encodeFrame(KIND_DATA, 2, new Uint8Array([7])),
        ]),
      ]),
      64,
    );

    try {
      await expectFrame(reader, { kind: KIND_BOUND, channel: 2, payload: [] });
      await expectFrame(reader, { kind: KIND_DATA, channel: 2, payload: [7] });
    } finally {
      reader.release();
    }
  });

  it("keeps malformed and oversized stream frames fail-closed", async () => {
    const limit = 64;
    const cases = [
      {
        frame: encodeFrame(255, 1, new Uint8Array(0)),
        error: /TN_NET_PROTOCOL: unknown frame kind/u,
      },
      {
        frame: encodeFrame(KIND_DATA, 0, new Uint8Array(0)),
        error: /TN_NET_PROTOCOL: DATA on channel 0/u,
      },
      {
        frame: (() => {
          const bytes = encodeFrame(KIND_DATA, 1, new Uint8Array(0));
          bytes[0] = 2;
          return bytes;
        })(),
        error: /TN_NET_PROTOCOL: unknown wire version/u,
      },
      {
        frame: encodeFrame(KIND_DATA, 1, new Uint8Array(limit + 1)),
        error: /TN_NET_PROTOCOL: frame exceeds limit/u,
      },
    ];

    for (const testCase of cases) {
      const reader = new FrameReader(readableFrom([testCase.frame]), limit);
      try {
        await expect(reader.nextFrame()).rejects.toThrow(testCase.error);
      } finally {
        reader.release();
      }
    }
  });

  it("delivers a valid coalesced frame before rejecting a later oversized frame", async () => {
    const limit = 64;
    const reader = new FrameReader(
      readableFrom([
        concat([
          encodeFrame(KIND_DATA, 1, new Uint8Array([1])),
          encodeFrame(KIND_DATA, 1, new Uint8Array(limit + 1)),
        ]),
      ]),
      limit,
    );

    try {
      await expectFrame(reader, { kind: KIND_DATA, channel: 1, payload: [1] });
      await expect(reader.nextFrame()).rejects.toThrow(/TN_NET_PROTOCOL: frame exceeds limit/u);
    } finally {
      reader.release();
    }
  });
});
