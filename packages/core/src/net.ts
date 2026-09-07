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

import { normalizeOptions } from "./net-protocol.js";
import { openConnection } from "./net-session.js";

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
