import type { INetworkOptions } from "./net.js";

const WIRE_VERSION = 1;
export const KIND_HELLO = 1;
export const KIND_WELCOME = 2;
export const KIND_BIND = 3;
export const KIND_BOUND = 4;
export const KIND_DATA = 16;
export const HEADER_BYTES = 8;
export const MAX_HELLO_BYTES = 4096;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RELIABLE_MESSAGE_BYTES = 65_536;
const DEFAULT_MAX_QUEUED_RELIABLE_BYTES = 1_048_576;
const DEFAULT_MAX_QUEUED_DATAGRAMS = 256;

export interface INormalizedOptions {
  applicationProtocol: string;
  credential: string;
  channels: { id: number; delivery: "unreliable" | "reliable-ordered" }[];
  signal: AbortSignal | undefined;
  connectTimeoutMs: number;
  maxReliableMessageBytes: number;
  maxQueuedReliableBytes: number;
  maxQueuedDatagrams: number;
}

export interface IDecodedFrame {
  kind: number;
  channel: number;
  payload: Uint8Array;
}

export interface IWebTransportLike {
  ready: Promise<unknown>;
  closed: Promise<unknown>;
  datagrams: {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    maxDatagramSize?: number;
  };
  createBidirectionalStream():
    | Promise<{
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
      }>
    | {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
      };
  close(): void;
}

export type IWebTransportConstructor = new (url: string, options?: object) => IWebTransportLike;

export function invalidArgument(message: string): Error {
  return new Error(`TN_NET_INVALID_ARGUMENT: ${message}`);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function normalizeOptions(url: string, options: INetworkOptions): INormalizedOptions {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalidArgument("url must be a valid URL");
  }
  if (parsed.protocol !== "https:") throw invalidArgument("url must use https");
  if (options === null || typeof options !== "object")
    throw invalidArgument("options are required");
  if (typeof options.applicationProtocol !== "string")
    throw invalidArgument("applicationProtocol is required");
  if (
    options.applicationProtocol.length < 1 ||
    options.applicationProtocol.length > 64 ||
    !/^[\x20-\x7e]+$/u.test(options.applicationProtocol)
  )
    throw invalidArgument("applicationProtocol must be 1-64 printable ASCII characters");
  if (typeof options.credential !== "string" || options.credential.length === 0)
    throw invalidArgument("credential must be nonempty");
  if (
    !Array.isArray(options.channels) ||
    options.channels.length < 1 ||
    options.channels.length > 32
  )
    throw invalidArgument("channels must list 1-32 entries");
  const seen = new Set<number>();
  const channels = options.channels.map((channel) => {
    if (channel === null || typeof channel !== "object")
      throw invalidArgument("channel entries are required");
    if (!Number.isInteger(channel.id) || channel.id < 1 || channel.id > 65535)
      throw invalidArgument("channel ids must be integers 1-65535");
    if (channel.delivery !== "unreliable" && channel.delivery !== "reliable-ordered")
      throw invalidArgument("channel delivery is unknown");
    if (seen.has(channel.id)) throw invalidArgument("channel ids must be unique");
    seen.add(channel.id);
    return { id: channel.id, delivery: channel.delivery };
  });
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    throw invalidArgument("signal must be an AbortSignal");
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const maxReliableMessageBytes =
    options.maxReliableMessageBytes ?? DEFAULT_MAX_RELIABLE_MESSAGE_BYTES;
  const maxQueuedReliableBytes =
    options.maxQueuedReliableBytes ?? DEFAULT_MAX_QUEUED_RELIABLE_BYTES;
  const maxQueuedDatagrams = options.maxQueuedDatagrams ?? DEFAULT_MAX_QUEUED_DATAGRAMS;
  if (!isPositiveSafeInteger(connectTimeoutMs))
    throw invalidArgument("connectTimeoutMs must be positive");
  if (!isPositiveSafeInteger(maxReliableMessageBytes))
    throw invalidArgument("maxReliableMessageBytes must be positive");
  if (!isPositiveSafeInteger(maxQueuedReliableBytes))
    throw invalidArgument("maxQueuedReliableBytes must be positive");
  if (!isPositiveSafeInteger(maxQueuedDatagrams))
    throw invalidArgument("maxQueuedDatagrams must be positive");
  if (maxReliableMessageBytes > maxQueuedReliableBytes)
    throw invalidArgument("message limit cannot exceed queue limit");
  return {
    applicationProtocol: options.applicationProtocol,
    credential: options.credential,
    channels,
    signal: options.signal,
    connectTimeoutMs,
    maxReliableMessageBytes,
    maxQueuedReliableBytes,
    maxQueuedDatagrams,
  };
}

export function encodeFrame(kind: number, channel: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(HEADER_BYTES + payload.length);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  out[0] = WIRE_VERSION;
  out[1] = kind;
  view.setUint16(2, channel);
  view.setUint32(4, payload.length);
  out.set(payload, HEADER_BYTES);
  return out;
}

function checkFrameHead(version: number, kind: number, channel: number): void {
  if (version !== WIRE_VERSION) throw new Error("TN_NET_PROTOCOL: unknown wire version");
  if (
    kind !== KIND_HELLO &&
    kind !== KIND_WELCOME &&
    kind !== KIND_BIND &&
    kind !== KIND_BOUND &&
    kind !== KIND_DATA
  )
    throw new Error("TN_NET_PROTOCOL: unknown frame kind");
  if (kind === KIND_DATA && channel === 0) throw new Error("TN_NET_PROTOCOL: DATA on channel 0");
}

export function decodeStandaloneFrame(bytes: Uint8Array): IDecodedFrame {
  if (bytes.length < HEADER_BYTES) throw new Error("TN_NET_PROTOCOL: truncated header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[0] ?? 0;
  const kind = bytes[1] ?? 0;
  const channel = view.getUint16(2);
  const length = view.getUint32(4);
  checkFrameHead(version, kind, channel);
  if (bytes.length !== HEADER_BYTES + length)
    throw new Error("TN_NET_PROTOCOL: bad datagram length");
  return { kind, channel, payload: bytes.slice(HEADER_BYTES) };
}

/** Split complete frames off a stream buffer; trailing partial bytes are kept. */
function splitStreamFrames(buffer: Uint8Array): { frames: IDecodedFrame[]; rest: Uint8Array } {
  const frames: IDecodedFrame[] = [];
  let offset = 0;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  while (offset + HEADER_BYTES <= buffer.length) {
    const version = buffer[offset] ?? 0;
    const kind = buffer[offset + 1] ?? 0;
    const channel = view.getUint16(offset + 2);
    const length = view.getUint32(offset + 4);
    checkFrameHead(version, kind, channel);
    if (offset + HEADER_BYTES + length > buffer.length) break;
    frames.push({
      kind,
      channel,
      payload: buffer.slice(offset + HEADER_BYTES, offset + HEADER_BYTES + length),
    });
    offset += HEADER_BYTES + length;
  }
  return { frames, rest: buffer.slice(offset) };
}

export function webTransportConstructor(): IWebTransportConstructor | undefined {
  const value = (globalThis as Record<string, unknown>).WebTransport;
  if (typeof value !== "function") return undefined;
  return value as IWebTransportConstructor;
}

export function parseWelcome(
  payload: Uint8Array,
  expectedProtocol: string,
): {
  sessionId: string;
  channels: { id: number; delivery: "unreliable" | "reliable-ordered" }[];
  maxReliableMessageBytes: number;
  maxQueuedReliableBytes: number;
  maxQueuedDatagrams: number;
} {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (
    Object.keys(parsed).sort().join(",") !==
    "applicationProtocol,channels,maxQueuedDatagrams,maxQueuedReliableBytes,maxReliableMessageBytes,sessionId"
  )
    throw new Error("TN_NET_PROTOCOL: WELCOME has unexpected keys");
  if (parsed.applicationProtocol !== expectedProtocol)
    throw new Error("TN_NET_PROTOCOL: WELCOME protocol mismatch");
  if (typeof parsed.sessionId !== "string" || !/^[0-9a-f]{32}$/u.test(parsed.sessionId))
    throw new Error("TN_NET_PROTOCOL: WELCOME session id is invalid");
  if (!Array.isArray(parsed.channels))
    throw new Error("TN_NET_PROTOCOL: WELCOME channels are invalid");
  const channels = (parsed.channels as unknown[]).map((entry) => {
    if (entry === null || typeof entry !== "object")
      throw new Error("TN_NET_PROTOCOL: bad channel");
    const record = entry as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "delivery,id")
      throw new Error("TN_NET_PROTOCOL: bad channel shape");
    if (!Number.isInteger(record.id) || (record.id as number) < 1 || (record.id as number) > 65535)
      throw new Error("TN_NET_PROTOCOL: bad channel id");
    if (record.delivery !== "unreliable" && record.delivery !== "reliable-ordered")
      throw new Error("TN_NET_PROTOCOL: bad delivery");
    return {
      id: record.id as number,
      delivery: record.delivery as "unreliable" | "reliable-ordered",
    };
  });
  for (const key of [
    "maxReliableMessageBytes",
    "maxQueuedReliableBytes",
    "maxQueuedDatagrams",
  ] as const) {
    const value = parsed[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
      throw new Error("TN_NET_PROTOCOL: bad WELCOME limit");
  }
  const messageLimit = parsed.maxReliableMessageBytes as number;
  const queueLimit = parsed.maxQueuedReliableBytes as number;
  if (messageLimit > queueLimit) throw new Error("TN_NET_PROTOCOL: invalid negotiated limits");
  return {
    sessionId: parsed.sessionId as string,
    channels,
    maxReliableMessageBytes: messageLimit,
    maxQueuedReliableBytes: queueLimit,
    maxQueuedDatagrams: parsed.maxQueuedDatagrams as number,
  };
}

export async function writeAll(
  writable: WritableStream<Uint8Array>,
  bytes: Uint8Array,
): Promise<void> {
  const writer = writable.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

export function asBytes(chunk: unknown): Uint8Array<ArrayBuffer> {
  if (chunk instanceof Uint8Array) return Uint8Array.from(chunk);
  if (chunk instanceof ArrayBuffer) return Uint8Array.from(new Uint8Array(chunk));
  return Uint8Array.from(new Uint8Array(chunk as ArrayBuffer));
}

/** Incremental stream-frame reader used for handshake and reliable channels. */
export class FrameReader {
  #reader: ReadableStreamDefaultReader<Uint8Array>;
  #buffer: Uint8Array = new Uint8Array(0);
  #limit: number;
  #released = false;

  constructor(readable: ReadableStream<Uint8Array>, limit: number) {
    this.#reader = readable.getReader();
    this.#limit = limit;
  }

  async nextFrame(signal?: AbortSignal): Promise<IDecodedFrame> {
    for (;;) {
      if (signal?.aborted) throw new Error("TN_NET_CANCELLED: aborted");
      if (this.#buffer.length >= HEADER_BYTES) {
        const declared = new DataView(
          this.#buffer.buffer,
          this.#buffer.byteOffset,
          this.#buffer.byteLength,
        ).getUint32(4);
        if (declared > this.#limit) throw new Error("TN_NET_PROTOCOL: frame exceeds limit");
      }
      const split = splitStreamFrames(this.#buffer);
      if (split.frames.length > 0) {
        const first = split.frames[0];
        if (first === undefined) throw new Error("TN_NET_PROTOCOL: missing frame");
        this.#buffer = split.rest;
        return first;
      }
      if (this.#buffer.length > this.#limit + HEADER_BYTES)
        throw new Error("TN_NET_PROTOCOL: frame exceeds limit");
      const abort = new Promise<never>((_, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("TN_NET_CANCELLED: aborted")), {
          once: true,
        });
      });
      const read =
        signal === undefined
          ? await this.#reader.read()
          : await Promise.race([this.#reader.read(), abort]);
      if (read.done) throw new Error("TN_NET_PROTOCOL: stream ended");
      this.#buffer = concatBytes(this.#buffer, asBytes(read.value).slice());
    }
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    try {
      this.#reader.releaseLock();
    } catch {
      /* already released */
    }
  }

  cancel(reason: unknown): Promise<void> {
    try {
      return this.#reader.cancel(reason);
    } catch {
      return Promise.resolve();
    }
  }
}
