import {
  FrameReader,
  HEADER_BYTES,
  type IDecodedFrame,
  type INormalizedOptions,
  type IWebTransportLike,
  KIND_BIND,
  KIND_BOUND,
  KIND_DATA,
  KIND_HELLO,
  KIND_WELCOME,
  MAX_HELLO_BYTES,
  asBytes,
  decodeStandaloneFrame,
  encodeFrame,
  invalidArgument,
  parseWelcome,
  webTransportConstructor,
  writeAll,
} from "./net-protocol.js";
import type { INetworkConnection, INetworkMessage, INetworkPoll, INetworkStats } from "./net.js";

export async function openConnection(
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
  let releasePromise: Promise<void> | undefined;
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
    void releaseAll();
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

  let datagramReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  const pumpDatagrams = (): void => {
    const reader = established.transport.datagrams.readable.getReader();
    datagramReader = reader;
    void (async () => {
      try {
        for (;;) {
          if (state !== "connected") {
            try {
              reader.releaseLock();
            } catch {
              /* already released */
            }
            datagramReader = undefined;
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

  async function releaseAll(): Promise<void> {
    if (releasePromise !== undefined) return releasePromise;
    releasePromise = (async () => {
      for (const reader of established.readers) {
        try {
          await reader.cancel(new Error("TN_NET_CLOSED: connection closed"));
        } catch {
          /* best effort */
        }
        reader.release();
      }
      if (datagramReader !== undefined) {
        try {
          await datagramReader.cancel(new Error("TN_NET_CLOSED: connection closed"));
        } catch {
          /* best effort */
        }
        try {
          datagramReader.releaseLock();
        } catch {
          /* best effort */
        }
        datagramReader = undefined;
      } else {
        try {
          await established.transport.datagrams.readable.cancel(
            new Error("TN_NET_CLOSED: connection closed"),
          );
        } catch {
          /* best effort */
        }
      }
      try {
        established.transport.close();
      } catch {
        /* best effort */
      }
    })();
    return releasePromise;
  }

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
