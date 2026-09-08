import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type INetworkOptions, connect } from "../src/net.js";

const textEncoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1)
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
}

/** Minimal test-local frame writer for the fake peer. Never used for expected bytes. */
function testFrame(kind: number, channel: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);
  out[0] = 1;
  out[1] = kind;
  view.setUint16(2, channel);
  view.setUint32(4, payload.length);
  out.set(payload, 8);
  return out;
}

interface IFakePipe {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  written: Uint8Array[];
  enqueue: (chunk: Uint8Array) => void;
}

function makePipe(onWrite?: (chunk: Uint8Array) => void | Promise<void>): IFakePipe {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const readable = new ReadableStream<Uint8Array>({
    start(startController) {
      controller = startController;
    },
  });
  const written: Uint8Array[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      written.push(chunk.slice());
      onWrite?.(chunk);
    },
  });
  return { readable, writable, written, enqueue: (chunk) => controller.enqueue(chunk) };
}

function decodeFrames(
  buffer: Uint8Array,
): { kind: number; channel: number; payload: Uint8Array }[] {
  const frames: { kind: number; channel: number; payload: Uint8Array }[] = [];
  let offset = 0;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  while (offset + 8 <= buffer.length) {
    const length = view.getUint32(offset + 4);
    if (offset + 8 + length > buffer.length) break;
    frames.push({
      kind: buffer[offset + 1] ?? 0,
      channel: view.getUint16(offset + 2),
      payload: buffer.slice(offset + 8, offset + 8 + length),
    });
    offset += 8 + length;
  }
  return frames;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const SESSION_ID = "0123456789abcdef0123456789abcdef";

class FakeWebTransport {
  static instances: FakeWebTransport[] = [];
  static holdReady = false;
  static reliableWriteBarrier: { promise: Promise<void>; started: () => void } | undefined;

  readonly url: string;
  readonly ready: Promise<void>;
  readonly closed: Promise<{ reason: string | null }>;
  datagrams: IFakePipe & { maxDatagramSize: number };
  streams: IFakePipe[] = [];
  #closeResolve!: (value: { reason: string | null }) => void;
  #pending = new Uint8Array(0);

  constructor(url: string) {
    this.url = url;
    FakeWebTransport.instances.push(this);
    this.ready = FakeWebTransport.holdReady ? new Promise<void>(() => {}) : Promise.resolve();
    this.closed = new Promise<{ reason: string | null }>((resolve) => {
      this.#closeResolve = resolve;
    });
    this.datagrams = Object.assign(makePipe(), { maxDatagramSize: 1200 });
  }

  createBidirectionalStream(): {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  } {
    const streamIndex = this.streams.length;
    const pipe = makePipe(async (chunk) => {
      if (streamIndex === 1 && pipe.written.length === 2) {
        const barrier = FakeWebTransport.reliableWriteBarrier;
        FakeWebTransport.reliableWriteBarrier = undefined;
        if (barrier !== undefined) {
          barrier.started();
          await barrier.promise;
        }
      }
      this.#onClientBytes(pipe, chunk);
    });
    this.streams.push(pipe);
    return { readable: pipe.readable, writable: pipe.writable };
  }

  #onClientBytes(pipe: IFakePipe, chunk: Uint8Array): void {
    const merged = new Uint8Array(this.#pending.length + chunk.length);
    merged.set(this.#pending, 0);
    merged.set(chunk, this.#pending.length);
    this.#pending = merged;
    for (const frame of decodeFrames(this.#pending)) {
      if (frame.kind === 1) {
        const hello = JSON.parse(new TextDecoder().decode(frame.payload)) as {
          applicationProtocol: string;
          channels: { id: number; delivery: string }[];
          maxReliableMessageBytes: number;
          maxQueuedReliableBytes: number;
          maxQueuedDatagrams: number;
        };
        const welcome = {
          applicationProtocol: hello.applicationProtocol,
          sessionId: SESSION_ID,
          channels: hello.channels,
          maxReliableMessageBytes: hello.maxReliableMessageBytes,
          maxQueuedReliableBytes: hello.maxQueuedReliableBytes,
          maxQueuedDatagrams: hello.maxQueuedDatagrams,
        };
        pipe.enqueue(testFrame(2, 0, textEncoder.encode(JSON.stringify(welcome))));
      } else if (frame.kind === 3) {
        pipe.enqueue(testFrame(4, frame.channel, new Uint8Array(0)));
      }
    }
    const consumed = decodeFrames(this.#pending).reduce(
      (sum, frame) => sum + 8 + frame.payload.length,
      0,
    );
    this.#pending = this.#pending.slice(consumed);
  }

  close(): void {
    this.#closeResolve({ reason: null });
  }

  simulateDrop(reason: string): void {
    for (const pipe of this.streams) {
      try {
        pipe.enqueue(new Uint8Array(0));
      } catch {
        /* pipe already released */
      }
    }
    this.#closeResolve({ reason });
  }
}

function validOptions(overrides: Partial<INetworkOptions> = {}): INetworkOptions {
  return {
    applicationProtocol: "threenative-smoke/1",
    credential: "opaque-token",
    channels: [
      { id: 1, delivery: "unreliable" },
      { id: 2, delivery: "reliable-ordered" },
    ],
    ...overrides,
  };
}

const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  FakeWebTransport.instances = [];
  FakeWebTransport.holdReady = false;
  FakeWebTransport.reliableWriteBarrier = undefined;
  (globalThis as Record<string, unknown>).WebTransport = FakeWebTransport;
});

afterEach(() => {
  (globalThis as Record<string, unknown>).WebTransport = undefined;
});

function fixtureVectors(): {
  version: number;
  valid: { name: string; hex: string; kind: number; channel: number; payloadHex: string }[];
  invalid: { name: string; hex: string; reason: string }[];
} {
  const raw = readFileSync(
    new URL("../../../docs/PRDs/networking/protocol-v1-vectors.json", import.meta.url),
    "utf8",
  );
  return JSON.parse(raw) as {
    version: number;
    valid: { name: string; hex: string; kind: number; channel: number; payloadHex: string }[];
    invalid: { name: string; hex: string; reason: string }[];
  };
}

describe("net", () => {
  it("matches shared protocol vectors", async () => {
    const vectors = fixtureVectors();
    expect(vectors.version).toBe(1);
    const byName = new Map(vectors.valid.map((item) => [item.name, item]));
    for (const name of [
      "empty-data-channel-1",
      "data-ab-channel-1",
      "bind-channel-2",
      "bound-channel-2",
      "data-channel-65535",
    ])
      expect(byName.has(name)).toBe(true);

    const connection = await connect("https://example.test/game", validOptions());
    try {
      const transport = FakeWebTransport.instances[0];
      expect(transport).toBeDefined();
      const helloHex = toHex(concat(transport?.streams[0]?.written ?? []));
      expect(helloHex).toBe(byName.get("hello-smoke-channels-1-2")?.hex);

      connection.send(1, new Uint8Array([0x61, 0x62]));
      await tick();
      const datagramHex = (transport?.datagrams.written ?? []).map(toHex);
      expect(datagramHex).toContain(byName.get("data-ab-channel-1")?.hex);

      transport?.datagrams.enqueue(fromHex(byName.get("data-ab-channel-1")?.hex ?? ""));
      await tick();
      const batch = connection.poll();
      expect(batch.messages).toHaveLength(1);
      expect(batch.messages[0]?.channel).toBe(1);
      expect(Array.from(batch.messages[0]?.data ?? [])).toEqual([0x61, 0x62]);

      const trailing = vectors.invalid.find((item) => item.name === "trailing-datagram-bytes");
      expect(trailing).toBeDefined();
      const droppedBefore = connection.getStats().droppedDatagrams;
      transport?.datagrams.enqueue(fromHex(trailing?.hex ?? ""));
      await tick();
      expect(connection.poll().messages).toEqual([]);
      expect(connection.getStats().droppedDatagrams).toBeGreaterThan(droppedBefore);
    } finally {
      await connection.close();
    }
  });

  it("honors typed array offsets", async () => {
    const connection = await connect("https://example.test/game", validOptions());
    try {
      const transport = FakeWebTransport.instances[0];
      const backing = new Uint8Array([9, 9, 9, 0x61, 0x62, 9, 9, 9, 9, 9]);
      const view = new Uint8Array(backing.buffer, 3, 2);
      expect(connection.send(1, view)).toBe(true);
      backing.fill(0);
      await tick();
      const payloads = (transport?.datagrams.written ?? []).map((frame) =>
        Array.from(frame.slice(8)),
      );
      expect(payloads).toContainEqual([0x61, 0x62]);

      transport?.datagrams.enqueue(fromHex("01100001000000026162"));
      await tick();
      const received = connection.poll().messages[0]?.data;
      expect(received).toBeInstanceOf(Uint8Array);
      expect(Array.from(received ?? [])).toEqual([0x61, 0x62]);
    } finally {
      await connection.close();
    }
  });

  it("rejects invalid options", async () => {
    const cases: { name: string; options: INetworkOptions; url?: string }[] = [
      { name: "http-url", options: validOptions(), url: "http://example.test/game" },
      { name: "bad-url", options: validOptions(), url: "not a url" },
      { name: "empty-credential", options: validOptions({ credential: "" }) },
      { name: "empty-protocol", options: validOptions({ applicationProtocol: "" }) },
      {
        name: "long-protocol",
        options: validOptions({ applicationProtocol: `x${"y".repeat(64)}` }),
      },
      {
        name: "nonprintable-protocol",
        options: validOptions({ applicationProtocol: "bad\nprotocol" }),
      },
      { name: "no-channels", options: validOptions({ channels: [] }) },
      {
        name: "duplicate-channels",
        options: validOptions({
          channels: [
            { id: 1, delivery: "unreliable" },
            { id: 1, delivery: "reliable-ordered" },
          ],
        }),
      },
      {
        name: "channel-zero",
        options: validOptions({ channels: [{ id: 0, delivery: "unreliable" }] }),
      },
      {
        name: "channel-overflow",
        options: validOptions({ channels: [{ id: 65536, delivery: "unreliable" }] }),
      },
      {
        name: "unknown-delivery",
        options: validOptions({ channels: [{ id: 1, delivery: "sometimes" as never }] }),
      },
      {
        name: "too-many-channels",
        options: validOptions({
          channels: Array.from({ length: 33 }, (_, index) => ({
            id: index + 1,
            delivery: "unreliable" as const,
          })),
        }),
      },
      { name: "zero-timeout", options: validOptions({ connectTimeoutMs: 0 }) },
      { name: "zero-message-limit", options: validOptions({ maxReliableMessageBytes: 0 }) },
      { name: "zero-queue-limit", options: validOptions({ maxQueuedReliableBytes: 0 }) },
      { name: "zero-datagram-limit", options: validOptions({ maxQueuedDatagrams: 0 }) },
      {
        name: "message-exceeds-queue",
        options: validOptions({ maxReliableMessageBytes: 2048, maxQueuedReliableBytes: 1024 }),
      },
    ];
    for (const testCase of cases) {
      const before = FakeWebTransport.instances.length;
      await expect(
        connect(testCase.url ?? "https://example.test/game", testCase.options),
      ).rejects.toThrow(/TN_NET_INVALID_ARGUMENT/);
      expect(FakeWebTransport.instances.length, testCase.name).toBe(before);
    }
  });

  it("bounds queues", async () => {
    const connection = await connect(
      "https://example.test/game",
      validOptions({
        maxReliableMessageBytes: 10,
        maxQueuedReliableBytes: 10,
        maxQueuedDatagrams: 2,
      }),
    );
    try {
      const transport = FakeWebTransport.instances[0];
      expect(connection.send(2, new Uint8Array(6))).toBe(true);
      expect(connection.send(2, new Uint8Array(6))).toBe(false);
      expect(connection.getStats().queuedReliableBytes).toBe(6);
      expect(() => connection.send(2, new Uint8Array(11))).toThrow(/TN_NET_MESSAGE_TOO_LARGE/);

      expect(connection.send(1, new Uint8Array(11))).toBe(true);
      await tick();

      expect(connection.send(1, new Uint8Array([1]))).toBe(true);
      expect(connection.send(1, new Uint8Array([2]))).toBe(true);
      expect(connection.send(1, new Uint8Array([3]))).toBe(true);
      expect(connection.getStats().droppedDatagrams).toBe(1);
      await tick();
      const payloads = (transport?.datagrams.written ?? []).map((frame) =>
        Array.from(frame.slice(8)),
      );
      expect(payloads).toContainEqual([2]);
      expect(payloads).toContainEqual([3]);
      expect(payloads).not.toContainEqual([1]);
    } finally {
      await connection.close();
    }
  });

  it("enforces negotiated reliable receive payload limits", async () => {
    const messageLimit = 10;
    const connection = await connect(
      "https://example.test/game",
      validOptions({
        maxReliableMessageBytes: messageLimit,
        maxQueuedReliableBytes: 64,
      }),
    );
    try {
      const transport = FakeWebTransport.instances[0];
      transport?.streams[1]?.enqueue(testFrame(16, 2, new Uint8Array(messageLimit)));
      await tick();
      const exact = connection.poll();
      expect(exact.disconnected).toBe(false);
      expect(exact.messages).toHaveLength(1);
      expect(exact.messages[0]?.channel).toBe(2);
      expect(exact.messages[0]?.data).toHaveLength(messageLimit);

      transport?.streams[1]?.enqueue(testFrame(16, 2, new Uint8Array(messageLimit + 1)));
      await tick();
      const oversized = connection.poll();
      expect(oversized.messages).toEqual([]);
      expect(oversized).toMatchObject({ disconnected: true, reason: "transport error" });
    } finally {
      await connection.close();
    }
  });

  it("serializes concurrent reliable writes", async () => {
    let releaseFirstWrite!: () => void;
    let firstWriteStarted!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const started = new Promise<void>((resolve) => {
      firstWriteStarted = resolve;
    });
    FakeWebTransport.reliableWriteBarrier = { promise: firstWrite, started: firstWriteStarted };
    const connection = await connect("https://example.test/game", validOptions());
    try {
      const transport = FakeWebTransport.instances[0];
      expect(connection.send(2, new Uint8Array([1]))).toBe(true);
      await started;
      expect(connection.send(2, new Uint8Array([2]))).toBe(true);
      releaseFirstWrite();
      await tick();
      expect(connection.poll()).toMatchObject({ disconnected: false, reason: null });
      const frames = decodeFrames(concat(transport?.streams[1]?.written ?? []));
      expect(frames.slice(1).map((frame) => Array.from(frame.payload))).toEqual([[1], [2]]);
    } finally {
      await connection.close();
    }
  });

  it("settles cancellation", async () => {
    const aborted = new AbortController();
    aborted.abort();
    const before = FakeWebTransport.instances.length;
    await expect(
      connect("https://example.test/game", validOptions({ signal: aborted.signal })),
    ).rejects.toThrow(/TN_NET/);
    expect(FakeWebTransport.instances.length).toBe(before);

    FakeWebTransport.holdReady = true;
    const controller = new AbortController();
    const pending = connect(
      "https://example.test/game",
      validOptions({ signal: controller.signal }),
    );
    controller.abort();
    await expect(pending).rejects.toThrow(/TN_NET/);
    FakeWebTransport.holdReady = false;
  });

  it("polls disconnect once", async () => {
    const connection = await connect("https://example.test/game", validOptions());
    await connection.close();
    const first = connection.poll();
    expect(first.disconnected).toBe(true);
    const second = connection.poll();
    expect(second).toEqual({ messages: [], disconnected: false, reason: null });

    const reopened = await connect("https://example.test/game", validOptions());
    try {
      FakeWebTransport.instances[FakeWebTransport.instances.length - 1]?.simulateDrop("peer gone");
      await tick();
      const dropped = reopened.poll();
      expect(dropped.disconnected).toBe(true);
      expect(dropped.reason).toBe("peer gone");
      expect(reopened.poll()).toEqual({ messages: [], disconnected: false, reason: null });
    } finally {
      await reopened.close();
    }
  });

  it("does not replay actions on reconnect", async () => {
    const first = await connect("https://example.test/game", validOptions());
    const firstTransport = FakeWebTransport.instances[0];
    expect(first.send(2, new Uint8Array([7, 8, 9]))).toBe(true);
    await first.close();

    const reopened = await connect("https://example.test/game", validOptions());
    const secondTransport = FakeWebTransport.instances[1];
    try {
      const frames = decodeFrames(concat(secondTransport?.streams[1]?.written ?? []));
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({ kind: 3, channel: 2, payload: new Uint8Array(0) });
      expect(firstTransport?.streams[1]?.written.length).toBeGreaterThan(0);
    } finally {
      await reopened.close();
    }
  });

  it("releases readers after a server restart", async () => {
    const connection = await connect("https://example.test/game", validOptions());
    const transport = FakeWebTransport.instances[0];
    transport?.simulateDrop("server restarted");
    await tick();
    expect(connection.poll()).toMatchObject({ disconnected: true, reason: "server restarted" });
    expect(transport?.streams.every((stream) => !stream.readable.locked)).toBe(true);
    expect(transport?.datagrams.readable.locked).toBe(false);
  });

  it("offline import opens no transport", async () => {
    const holder = globalThis as Record<string, unknown>;
    const saved = holder.WebTransport;
    holder.WebTransport = undefined;
    try {
      const before = FakeWebTransport.instances.length;
      expect(typeof connect).toBe("function");
      expect(FakeWebTransport.instances.length).toBe(before);
      await expect(connect("https://example.test/game", validOptions())).rejects.toThrow(/TN_NET/);
      expect(FakeWebTransport.instances.length).toBe(before);
    } finally {
      holder.WebTransport = saved;
    }
  });
});
