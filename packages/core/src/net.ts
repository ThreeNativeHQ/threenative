/**
 * Optional portable message transport over the platform WebTransport seam.
 *
 * Browser and native share this implementation: WebTransport owns QUIC/HTTP3
 * security and reliability, while this module owns validation, bounded queues,
 * application framing and delivery semantics. Gameplay serialization and
 * simulation stay in game/server code.
 */

export interface INetworkChannel {
  id: number;
  delivery: "unreliable" | "reliable-ordered";
}

export interface INetworkOptions {
  applicationProtocol: string;
  credential: string;
  channels: readonly INetworkChannel[];
  signal?: AbortSignal;
  connectTimeoutMs?: number;
  maxReliableMessageBytes?: number;
  maxQueuedReliableBytes?: number;
  maxQueuedDatagrams?: number;
}

export interface INetworkMessage {
  channel: number;
  data: Uint8Array;
}

export interface INetworkPoll {
  messages: INetworkMessage[];
  disconnected: boolean;
  reason: string | null;
}

export interface INetworkStats {
  transport: "webtransport";
  state: "connected" | "closing" | "closed";
  sessionId: string;
  maxDatagramPayload: number;
  maxReliableMessageBytes: number;
  maxQueuedReliableBytes: number;
  maxQueuedDatagrams: number;
  queuedReliableBytes: number;
  queuedDatagrams: number;
  droppedDatagrams: number;
  rttMs: number | null;
}

export interface INetworkConnection {
  send(channel: number, data: Uint8Array): boolean;
  poll(): INetworkPoll;
  getStats(): INetworkStats;
  close(): Promise<void>;
}

/**
 * Open a bounded, authenticated WebTransport message channel shared by browser and native games.
 *
 * @situation connect two game clients over the portable WebTransport seam
 * @situation send ordered actions and bounded unreliable state messages between game clients
 * @situation exchange multiplayer messages without putting replication or gameplay in the engine
 * @constraint the URL must use HTTPS and the credential is supplied by the game's identity flow; this API never issues credentials
 * @constraint channels, message sizes, and queues are validated before WebTransport opens, and reliable overflow returns false
 * @constraint native qualification depends on the installed host WebTransport bridge; iOS remains unverified
 * @override connectTimeoutMs, maxReliableMessageBytes, maxQueuedReliableBytes, and maxQueuedDatagrams are named per-connection limits
 * @example const connection = await connect("https://game.example/game", { applicationProtocol: "my-game/1", credential, channels: [{ id: 1, delivery: "unreliable" }] });
 */
export function connect(url: string, options: INetworkOptions): Promise<INetworkConnection> {
  try {
    const normalized = normalizeOptions(url, options);
    return openConnection(url, normalized);
  } catch (error) {
    return Promise.reject(error);
  }
}

const WIRE_VERSION = 1;
const KIND_HELLO = 1;
const KIND_WELCOME = 2;
const KIND_BIND = 3;
const KIND_BOUND = 4;
const KIND_DATA = 16;
const HEADER_BYTES = 8;
const MAX_HELLO_BYTES = 4096;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RELIABLE_MESSAGE_BYTES = 65_536;
const DEFAULT_MAX_QUEUED_RELIABLE_BYTES = 1_048_576;
const DEFAULT_MAX_QUEUED_DATAGRAMS = 256;

interface INormalizedOptions {
  applicationProtocol: string;
  credential: string;
  channels: { id: number; delivery: "unreliable" | "reliable-ordered" }[];
  signal: AbortSignal | undefined;
  connectTimeoutMs: number;
  maxReliableMessageBytes: number;
  maxQueuedReliableBytes: number;
  maxQueuedDatagrams: number;
}

interface IDecodedFrame {
  kind: number;
  channel: number;
  payload: Uint8Array;
}

interface IWebTransportLike {
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

type IWebTransportConstructor = new (url: string, options?: object) => IWebTransportLike;

function invalidArgument(message: string): Error {
  return new Error(`TN_NET_INVALID_ARGUMENT: ${message}`);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function normalizeOptions(url: string, options: INetworkOptions): INormalizedOptions {
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

function encodeFrame(kind: number, channel: number, payload: Uint8Array): Uint8Array {
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

function decodeStandaloneFrame(bytes: Uint8Array): IDecodedFrame {
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

function webTransportConstructor(): IWebTransportConstructor | undefined {
  const value = (globalThis as Record<string, unknown>).WebTransport;
  if (typeof value !== "function") return undefined;
  return value as IWebTransportConstructor;
}

function parseWelcome(
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

async function writeAll(writable: WritableStream<Uint8Array>, bytes: Uint8Array): Promise<void> {
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

function asBytes(chunk: unknown): Uint8Array<ArrayBuffer> {
  if (chunk instanceof Uint8Array) return Uint8Array.from(chunk);
  if (chunk instanceof ArrayBuffer) return Uint8Array.from(new Uint8Array(chunk));
  return Uint8Array.from(new Uint8Array(chunk as ArrayBuffer));
}

/** Incremental stream-frame reader used for handshake and reliable channels. */
class FrameReader {
  // biome-ignore lint/suspicious/noExplicitAny: stream chunk generics vary by lib.
  #reader: any;
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

async function openConnection(
  url: string,
  normalized: INormalizedOptions,
): Promise<INetworkConnection> {
  if (normalized.signal?.aborted) throw new Error("TN_NET_CANCELLED: aborted before connect");
  const Constructor = webTransportConstructor();
  if (Constructor === undefined) throw new Error("TN_NET_UNAVAILABLE: WebTransport is missing");

  const transport = new Constructor(url, {});
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const onAbort = (): void => {
    try {
      transport.close();
    } catch {
      /* best effort */
    }
  };
  normalized.signal?.addEventListener("abort", onAbort, { once: true });
  const deadline = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("TN_NET_TIMEOUT: connect timed out")),
      normalized.connectTimeoutMs,
    );
  });
  const cancelled = new Promise<never>((_, reject) => {
    if (normalized.signal === undefined) return;
    if (normalized.signal.aborted) reject(new Error("TN_NET_CANCELLED: aborted"));
    else
      normalized.signal.addEventListener(
        "abort",
        () => reject(new Error("TN_NET_CANCELLED: aborted")),
        { once: true },
      );
  });
  try {
    await Promise.race([Promise.resolve(transport.ready), deadline, cancelled]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    normalized.signal?.removeEventListener("abort", onAbort);
  }
  if (normalized.signal?.aborted) throw new Error("TN_NET_CANCELLED: aborted");
  return establishSession(transport, normalized);
}

async function establishSession(
  transport: IWebTransportLike,
  normalized: INormalizedOptions,
): Promise<INetworkConnection> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), normalized.connectTimeoutMs);
  const readers: FrameReader[] = [];
  const writers: WritableStream<Uint8Array>[] = [];
  try {
    const controlStream = await Promise.resolve(transport.createBidirectionalStream());
    writers.push(controlStream.writable);
    const controlReader = new FrameReader(controlStream.readable, MAX_HELLO_BYTES + HEADER_BYTES);
    readers.push(controlReader);

    const helloPayload = new TextEncoder().encode(
      JSON.stringify({
        applicationProtocol: normalized.applicationProtocol,
        credential: normalized.credential,
        channels: normalized.channels.map((channel) => ({
          id: channel.id,
          delivery: channel.delivery,
        })),
        maxReliableMessageBytes: normalized.maxReliableMessageBytes,
        maxQueuedReliableBytes: normalized.maxQueuedReliableBytes,
        maxQueuedDatagrams: normalized.maxQueuedDatagrams,
      }),
    );
    if (helloPayload.length > MAX_HELLO_BYTES)
      throw invalidArgument("handshake payload exceeds 4096 bytes");
    await writeAll(controlStream.writable, encodeFrame(KIND_HELLO, 0, helloPayload));

    const welcomeFrame = await controlReader.nextFrame(abort.signal);
    if (welcomeFrame.kind !== KIND_WELCOME || welcomeFrame.channel !== 0)
      throw new Error("TN_NET_PROTOCOL: expected WELCOME");
    const welcome = parseWelcome(welcomeFrame.payload, normalized.applicationProtocol);
    const expected = [...normalized.channels].sort((left, right) => left.id - right.id);
    const offered = [...welcome.channels].sort((left, right) => left.id - right.id);
    if (JSON.stringify(expected) !== JSON.stringify(offered))
      throw new Error("TN_NET_PROTOCOL: WELCOME channels mismatch");
    const messageLimit = Math.min(
      normalized.maxReliableMessageBytes,
      welcome.maxReliableMessageBytes,
    );
    const queueLimit = Math.min(normalized.maxQueuedReliableBytes, welcome.maxQueuedReliableBytes);
    const datagramLimit = Math.min(normalized.maxQueuedDatagrams, welcome.maxQueuedDatagrams);
    if (messageLimit > queueLimit) throw new Error("TN_NET_PROTOCOL: invalid negotiated limits");

    const maxDatagramSize = transport.datagrams.maxDatagramSize;
    const maxDatagramPayload =
      typeof maxDatagramSize === "number" && Number.isFinite(maxDatagramSize)
        ? maxDatagramSize - HEADER_BYTES
        : Number.NaN;
    if (!Number.isSafeInteger(maxDatagramPayload) || maxDatagramPayload <= 0)
      throw new Error("TN_NET_UNAVAILABLE: datagram support is missing");

    const reliableIds = expected
      .filter((channel) => channel.delivery === "reliable-ordered")
      .map((channel) => channel.id);
    const reliableReaders = new Map<number, FrameReader>();
    const reliableWriters = new Map<number, WritableStream<Uint8Array>>();
    for (const channelId of reliableIds) {
      const stream = await Promise.resolve(transport.createBidirectionalStream());
      writers.push(stream.writable);
      const reader = new FrameReader(stream.readable, messageLimit + HEADER_BYTES);
      readers.push(reader);
      await writeAll(stream.writable, encodeFrame(KIND_BIND, channelId, new Uint8Array(0)));
      const bound = await reader.nextFrame(abort.signal);
      if (bound.kind !== KIND_BOUND || bound.channel !== channelId)
        throw new Error("TN_NET_PROTOCOL: expected BOUND");
      if (bound.payload.length !== 0) throw new Error("TN_NET_PROTOCOL: BOUND carries payload");
      reliableReaders.set(channelId, reader);
      reliableWriters.set(channelId, stream.writable);
    }
    clearTimeout(timer);
    return createConnection({
      transport,
      channelById: new Map(normalized.channels.map((channel) => [channel.id, channel.delivery])),
      sessionId: welcome.sessionId,
      maxDatagramPayload,
      maxReliableMessageBytes: messageLimit,
      maxQueuedReliableBytes: queueLimit,
      maxQueuedDatagrams: datagramLimit,
      readers,
      reliableReaders,
      reliableWriters,
    });
  } catch (error) {
    clearTimeout(timer);
    abort.abort();
    for (const reader of readers) {
      await reader.cancel(error);
      reader.release();
    }
    try {
      transport.close();
    } catch {
      /* best effort */
    }
    if (normalized.signal?.aborted) throw new Error("TN_NET_CANCELLED: aborted");
    if (error instanceof Error && error.message.startsWith("TN_NET_")) throw error;
    if (error instanceof Error) throw new Error(`TN_NET_PROTOCOL: ${error.message}`);
    throw new Error("TN_NET_UNAVAILABLE: handshake failed");
  }
}

interface IEstablished {
  transport: IWebTransportLike;
  channelById: Map<number, "unreliable" | "reliable-ordered">;
  sessionId: string;
  maxDatagramPayload: number;
  maxReliableMessageBytes: number;
  maxQueuedReliableBytes: number;
  maxQueuedDatagrams: number;
  readers: FrameReader[];
  reliableReaders: Map<number, FrameReader>;
  reliableWriters: Map<number, WritableStream<Uint8Array>>;
}

function createConnection(established: IEstablished): INetworkConnection {
  let state: "connected" | "closing" | "closed" = "connected";
  let disconnectReason: string | null = null;
  let disconnectReported = false;
  let closePromise: Promise<void> | undefined;
  let droppedDatagrams = 0;
  let queuedReliableBytes = 0;
  let queuedReliableBytesReceived = 0;
  const pendingReliable = new Map<number, Uint8Array[]>();
  const pendingDatagrams: { channel: number; bytes: Uint8Array }[] = [];
  const receiveQueue: INetworkMessage[] = [];
  let flushScheduled = false;
  for (const channelId of established.reliableReaders.keys()) pendingReliable.set(channelId, []);

  const statsBase = {
    transport: "webtransport" as const,
    sessionId: established.sessionId,
    maxDatagramPayload: established.maxDatagramPayload,
    maxReliableMessageBytes: established.maxReliableMessageBytes,
    maxQueuedReliableBytes: established.maxQueuedReliableBytes,
    maxQueuedDatagrams: established.maxQueuedDatagrams,
  };

  const markDisconnected = (reason: string | null): void => {
    if (state === "closed") return;
    state = "closed";
    disconnectReason = reason;
  };

  const closedReason = (result: unknown): string | null => {
    if (typeof result === "object" && result !== null && "reason" in result) {
      const reason = (result as { reason?: unknown }).reason;
      if (reason === null || reason === undefined) return null;
      if (typeof reason === "string" && reason.length > 0) return reason;
    }
    return "transport closed";
  };

  void Promise.resolve(established.transport.closed).then(
    (result) => markDisconnected(closedReason(result)),
    () => markDisconnected("transport error"),
  );

  const enqueueReceived = (channel: number, data: Uint8Array): void => {
    const delivery = established.channelById.get(channel);
    if (delivery === "reliable-ordered") {
      // Reliable saturation pauses reads: the reader loop below stops consuming
      // while this queue holds a full window, and never drops.
      if (queuedReliableBytesReceived + data.length > established.maxQueuedReliableBytes) return;
      queuedReliableBytesReceived += data.length;
      receiveQueue.push({ channel, data });
      return;
    }
    if (delivery !== "unreliable") {
      droppedDatagrams += 1;
      return;
    }
    const unreliableCount = receiveQueue.filter(
      (message) => established.channelById.get(message.channel) === "unreliable",
    ).length;
    if (unreliableCount >= established.maxQueuedDatagrams) {
      const index = receiveQueue.findIndex(
        (message) => established.channelById.get(message.channel) === "unreliable",
      );
      if (index >= 0) receiveQueue.splice(index, 1);
      droppedDatagrams += 1;
    }
    receiveQueue.push({ channel, data });
  };

  const pumpReliable = (channelId: number, reader: FrameReader): void => {
    void (async () => {
      try {
        for (;;) {
          if (state !== "connected") return;
          if (queuedReliableBytesReceived >= established.maxQueuedReliableBytes) {
            await new Promise<void>((resolve) => setTimeout(resolve, 5));
            continue;
          }
          const frame = await reader.nextFrame();
          if (frame.kind !== KIND_DATA || frame.channel !== channelId)
            throw new Error("TN_NET_PROTOCOL: wrong stream frame");
          enqueueReceived(frame.channel, frame.payload.slice());
        }
      } catch {
        if (state === "connected") markDisconnected("transport error");
      }
    })();
  };

  const pumpDatagrams = (): void => {
    const reader = established.transport.datagrams.readable.getReader();
    void (async () => {
      try {
        for (;;) {
          if (state !== "connected") {
            try {
              reader.releaseLock();
            } catch {
              /* already released */
            }
            return;
          }
          const read = await reader.read();
          if (read.done) {
            markDisconnected("transport closed");
            return;
          }
          let frame: IDecodedFrame;
          try {
            frame = decodeStandaloneFrame(asBytes(read.value).slice());
          } catch {
            droppedDatagrams += 1;
            continue;
          }
          if (
            frame.kind !== KIND_DATA ||
            established.channelById.get(frame.channel) !== "unreliable"
          ) {
            droppedDatagrams += 1;
            continue;
          }
          enqueueReceived(frame.channel, frame.payload.slice());
        }
      } catch {
        if (state === "connected") markDisconnected("transport error");
      }
    })();
  };

  for (const [channelId, reader] of established.reliableReaders) pumpReliable(channelId, reader);
  pumpDatagrams();

  const flushQueues = (): void => {
    if (flushScheduled) return;
    flushScheduled = true;
    void Promise.resolve().then(async () => {
      flushScheduled = false;
      if (state !== "connected") return;
      while (pendingDatagrams.length > 0) {
        if (state !== "connected") return;
        const next = pendingDatagrams.shift();
        if (next === undefined) return;
        try {
          await writeAll(
            established.transport.datagrams.writable,
            encodeFrame(KIND_DATA, next.channel, next.bytes),
          );
        } catch {
          markDisconnected("transport error");
          return;
        }
      }
      for (const [channelId, queue] of pendingReliable) {
        while (queue.length > 0) {
          if (state !== "connected") return;
          const writer = established.reliableWriters.get(channelId);
          const next = queue.shift();
          if (writer === undefined || next === undefined) break;
          try {
            await writeAll(writer, encodeFrame(KIND_DATA, channelId, next));
            queuedReliableBytes -= next.length;
          } catch {
            markDisconnected("transport error");
            return;
          }
        }
      }
    });
  };

  const releaseAll = async (): Promise<void> => {
    for (const reader of established.readers) {
      try {
        await reader.cancel(new Error("TN_NET_CLOSED: connection closed"));
      } catch {
        /* best effort */
      }
      reader.release();
    }
    try {
      established.transport.datagrams.readable
        .cancel(new Error("TN_NET_CLOSED: connection closed"))
        .catch(() => {});
    } catch {
      /* best effort */
    }
    try {
      established.transport.close();
    } catch {
      /* best effort */
    }
  };

  return {
    send(channel: number, data: Uint8Array): boolean {
      const delivery = established.channelById.get(channel);
      if (delivery === undefined) throw new Error("TN_NET_INVALID_ARGUMENT: unknown channel");
      if (!(data instanceof Uint8Array))
        throw new Error("TN_NET_INVALID_ARGUMENT: data must be bytes");
      if (state !== "connected") throw new Error("TN_NET_CLOSED: connection is closed");
      const bytes = Uint8Array.from(data);
      if (delivery === "reliable-ordered") {
        if (bytes.length > established.maxReliableMessageBytes)
          throw new Error("TN_NET_MESSAGE_TOO_LARGE: reliable message exceeds limit");
        if (queuedReliableBytes + bytes.length > established.maxQueuedReliableBytes) return false;
        pendingReliable.get(channel)?.push(bytes);
        queuedReliableBytes += bytes.length;
        flushQueues();
        return true;
      }
      const payloadLimit = established.maxDatagramPayload;
      if (bytes.length > payloadLimit)
        throw new Error("TN_NET_MESSAGE_TOO_LARGE: datagram exceeds limit");
      if (pendingDatagrams.length >= established.maxQueuedDatagrams) {
        pendingDatagrams.shift();
        droppedDatagrams += 1;
      }
      pendingDatagrams.push({ channel, bytes });
      flushQueues();
      return true;
    },
    poll(): INetworkPoll {
      const room = established.maxQueuedDatagrams * 2;
      const messages = receiveQueue.splice(0, Math.max(0, room));
      queuedReliableBytesReceived = receiveQueue
        .filter((message) => established.channelById.get(message.channel) === "reliable-ordered")
        .reduce((sum, message) => sum + message.data.length, 0);
      if (state === "closed" && !disconnectReported) {
        disconnectReported = true;
        return { messages, disconnected: true, reason: disconnectReason };
      }
      return { messages, disconnected: false, reason: null };
    },
    getStats(): INetworkStats {
      return {
        ...statsBase,
        state,
        queuedReliableBytes,
        queuedDatagrams: pendingDatagrams.length,
        droppedDatagrams,
        rttMs: null,
      };
    },
    close(): Promise<void> {
      if (closePromise !== undefined) return closePromise;
      if (state === "connected") state = "closing";
      closePromise = (async () => {
        receiveQueue.length = 0;
        pendingDatagrams.length = 0;
        for (const queue of pendingReliable.values()) queue.length = 0;
        queuedReliableBytes = 0;
        queuedReliableBytesReceived = 0;
        await releaseAll();
        state = "closed";
      })();
      return closePromise;
    },
  };
}
