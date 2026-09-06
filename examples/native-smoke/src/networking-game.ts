import { type INetworkConnection, type INetworkOptions, connect } from "@threenative/core/net";

export interface INetworkingConfig {
  readonly enabled: boolean;
  readonly endpoint?: string;
  readonly issuerUrl?: string;
  readonly room?: string;
  readonly playerId?: string;
}

export type NetworkingStatus = "disabled" | "connecting" | "connected" | "disconnected";

export interface INetworkingState extends Record<string, unknown> {
  networkActionAcks?: number;
  networkConnected: boolean;
  networkError: string;
  networkLastActionId?: number;
  networkLocalX?: number;
  networkLocalZ?: number;
  networkPeerId?: string;
  networkPeerObserved?: boolean;
  networkProtocolErrors?: number;
  networkReconnects?: number;
  networkRemoteDistance?: number;
  networkRemoteX?: number;
  networkRemoteZ?: number;
  networkRetry: number;
  networkSessionId: string;
  networkStatus: NetworkingStatus;
  networkServerTick?: number;
}

interface INetworkingStore<TState extends INetworkingState> {
  getState(): TState;
  set(patch: Partial<TState>): void;
  flush(): void;
}

export interface INetworkingGame<TState extends INetworkingState> {
  enter(store: INetworkingStore<TState>): void;
  update(store: INetworkingStore<TState>): void;
  retry(): void;
  exit(): void;
}

interface IStagedGrant {
  readonly expiresAt: string;
  readonly issuerAuthorization: string;
}

interface IIssuedCredential {
  readonly credential: string;
  readonly expiresAt: string;
}

interface INetworkSnapshot {
  readonly tick: number;
  readonly serverMonoMs: number;
  readonly player: {
    readonly id: string;
    readonly x: number;
    readonly z: number;
    readonly lastActionId: number;
  };
}

interface IActionReply {
  readonly id: number;
  readonly accepted: boolean;
}

const NETWORK_SESSION_ASSET = "networking-session.json";
const APPLICATION_PROTOCOL = "threenative-smoke/1";
const INPUT_TICKS_PER_SECOND = 60;
const INPUT_DURATION_TICKS = INPUT_TICKS_PER_SECOND * 2;
const HEARTBEAT_INTERVAL_TICKS = INPUT_TICKS_PER_SECOND;
const PEER_SILENCE_TIMEOUT_MS = 500;
const CHANNELS = [
  { id: 1, delivery: "unreliable" },
  { id: 2, delivery: "unreliable" },
  { id: 3, delivery: "reliable-ordered" },
  { id: 4, delivery: "reliable-ordered" },
] as const;

function invalid(message: string): Error {
  return new Error(`TN_NETWORK_CONFIG: ${message}`);
}

function parseObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw invalid(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function parseHttpsUrl(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw invalid(`${name} must be an HTTPS URL`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalid(`${name} must be an HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash)
    throw invalid(`${name} must be an HTTPS URL without credentials or a fragment`);
  return parsed.toString();
}

function parseNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw invalid(`${name} must be a nonempty string`);
  return value;
}

function parseExpiry(value: unknown, name: string, maximumMs: number): string {
  if (typeof value !== "string") throw new Error(`TN_NETWORK_AUTH: ${name} is missing`);
  const expiresAt = Date.parse(value);
  const now = Date.now();
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + maximumMs)
    throw new Error(`TN_NETWORK_AUTH: ${name} is expired or outside its validity window`);
  return value;
}

function stagedGrant(value: unknown): IStagedGrant {
  const record = parseObject(value, "networking session");
  if (Object.keys(record).sort().join(",") !== "expiresAt,issuerAuthorization")
    throw new Error("TN_NETWORK_AUTH: networking session has unexpected keys");
  return {
    expiresAt: parseExpiry(record.expiresAt, "grant expiry", 15 * 60 * 1000),
    issuerAuthorization: parseNonEmptyString(record.issuerAuthorization, "grant authorization"),
  };
}

function issuedCredential(value: unknown): IIssuedCredential {
  const record = parseObject(value, "issuer response");
  if (Object.keys(record).sort().join(",") !== "credential,expiresAt")
    throw new Error("TN_NETWORK_AUTH: issuer response has unexpected keys");
  return {
    credential: parseNonEmptyString(record.credential, "issued credential"),
    expiresAt: parseExpiry(record.expiresAt, "join-token expiry", 65 * 1000),
  };
}

async function readJson(response: Response, name: string): Promise<unknown> {
  if (!response.ok) throw new Error(`TN_NETWORK_AUTH: ${name} returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`TN_NETWORK_AUTH: ${name} returned invalid JSON`);
  }
}

async function issueCredential(config: INetworkingConfig): Promise<string> {
  if (!config.enabled || config.issuerUrl === undefined || config.playerId === undefined)
    throw invalid("enabled networking requires issuerUrl and playerId");
  const grantResponse = await fetch(NETWORK_SESSION_ASSET);
  const grant = stagedGrant(await readJson(grantResponse, "networking session"));
  const response = await fetch(config.issuerUrl, {
    body: JSON.stringify({ playerId: config.playerId }),
    headers: {
      Authorization: `Bearer ${grant.issuerAuthorization}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  return issuedCredential(await readJson(response, "credential issuer")).credential;
}

function publicFailure(): string {
  return "network connection failed; press Retry";
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  name: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`TN_NETWORK_PROTOCOL: ${name} must be an object`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== [...keys].sort().join(","))
    throw new Error(`TN_NETWORK_PROTOCOL: ${name} has unexpected keys`);
  return record;
}

function safeNonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`TN_NETWORK_PROTOCOL: ${name} is invalid`);
  return value;
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`TN_NETWORK_PROTOCOL: ${name} is invalid`);
  return value;
}

function parseSnapshot(data: Uint8Array): INetworkSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    throw new Error("TN_NETWORK_PROTOCOL: snapshot is not valid JSON");
  }
  const record = exactRecord(value, ["player", "serverMonoMs", "tick"], "snapshot");
  const player = exactRecord(record.player, ["id", "lastActionId", "x", "z"], "snapshot player");
  if (typeof player.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(player.id))
    throw new Error("TN_NETWORK_PROTOCOL: snapshot player id is invalid");
  return {
    tick: safeNonNegativeInteger(record.tick, "snapshot tick"),
    serverMonoMs: finiteNumber(record.serverMonoMs, "snapshot server time"),
    player: {
      id: player.id,
      lastActionId: safeNonNegativeInteger(player.lastActionId, "snapshot action id"),
      x: finiteNumber(player.x, "snapshot x"),
      z: finiteNumber(player.z, "snapshot z"),
    },
  };
}

function parseActionReply(data: Uint8Array): IActionReply {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    throw new Error("TN_NETWORK_PROTOCOL: action acknowledgement is not valid JSON");
  }
  const record = exactRecord(value, ["accepted", "id"], "action acknowledgement");
  if (typeof record.accepted !== "boolean")
    throw new Error("TN_NETWORK_PROTOCOL: action acknowledgement accepted is invalid");
  return {
    id: safeNonNegativeInteger(record.id, "action acknowledgement id"),
    accepted: record.accepted,
  };
}

function encodeGameplay(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function playerAxes(playerId: string): { x: number; z: number } {
  let checksum = 0;
  for (let index = 0; index < playerId.length; index += 1)
    checksum = (checksum + playerId.charCodeAt(index)) % 2;
  return checksum === 0 ? { x: 1, z: 0 } : { x: 0, z: 1 };
}

function patch<TState extends INetworkingState>(
  store: INetworkingStore<TState>,
  values: Partial<INetworkingState>,
): void {
  store.set(values as Partial<TState>);
  store.flush();
}

interface IObservedPositions {
  local: { x: number; z: number } | undefined;
  remote: { id: string; x: number; z: number } | undefined;
  remoteDistance: number;
  peerLastSeenAtMs: number | undefined;
}

function reportProtocolError<TState extends INetworkingState>(
  store: INetworkingStore<TState>,
): void {
  const state = store.getState();
  patch(store, { networkProtocolErrors: (state.networkProtocolErrors ?? 0) + 1 });
}

function observeSnapshot<TState extends INetworkingState>(
  store: INetworkingStore<TState>,
  config: INetworkingConfig,
  snapshot: INetworkSnapshot,
  lastSnapshotTick: Map<string, number>,
  positions: IObservedPositions,
): void {
  const previousTick = lastSnapshotTick.get(snapshot.player.id);
  if (previousTick !== undefined && snapshot.tick <= previousTick) return;
  lastSnapshotTick.set(snapshot.player.id, snapshot.tick);
  if (snapshot.player.id === config.playerId) {
    positions.local = { x: snapshot.player.x, z: snapshot.player.z };
  } else {
    if (positions.remote?.id === snapshot.player.id) {
      positions.remoteDistance += Math.hypot(
        snapshot.player.x - positions.remote.x,
        snapshot.player.z - positions.remote.z,
      );
    }
    positions.remote = {
      id: snapshot.player.id,
      x: snapshot.player.x,
      z: snapshot.player.z,
    };
    positions.peerLastSeenAtMs = performance.now();
  }
  const local = positions.local;
  const remote = positions.remote;
  patch(store, {
    networkLastActionId: snapshot.player.lastActionId,
    networkLocalX: local?.x ?? 0,
    networkLocalZ: local?.z ?? 0,
    networkPeerId: remote?.id ?? "",
    networkPeerObserved: remote !== undefined,
    networkRemoteDistance: positions.remoteDistance,
    networkRemoteX: remote?.x ?? 0,
    networkRemoteZ: remote?.z ?? 0,
    networkServerTick: snapshot.tick,
  });
}

function observeActionReply<TState extends INetworkingState>(
  store: INetworkingStore<TState>,
  reply: IActionReply,
  lastActionId: { value: number },
): void {
  if (reply.id <= lastActionId.value) return;
  lastActionId.value = reply.id;
  if (!reply.accepted) return;
  const state = store.getState();
  patch(store, { networkActionAcks: (state.networkActionAcks ?? 0) + 1 });
}

function consumeMessages<TState extends INetworkingState>(
  store: INetworkingStore<TState>,
  messages: readonly { channel: number; data: Uint8Array }[],
  config: INetworkingConfig,
  lastSnapshotTick: Map<string, number>,
  positions: IObservedPositions,
  lastActionId: { value: number },
): void {
  for (const message of messages) {
    try {
      if (message.channel === 2) {
        observeSnapshot(store, config, parseSnapshot(message.data), lastSnapshotTick, positions);
      } else if (message.channel === 3) {
        observeActionReply(store, parseActionReply(message.data), lastActionId);
      }
    } catch {
      reportProtocolError(store);
    }
  }
}

function sendGameplay(
  connection: INetworkConnection,
  playerId: string,
  inputTick: number,
  nextActionId: number,
  sendAction: boolean,
): number {
  const axes = playerAxes(playerId);
  connection.send(1, encodeGameplay({ tick: inputTick, x: axes.x, z: axes.z }));
  if (!sendAction) return nextActionId;
  connection.send(3, encodeGameplay({ id: nextActionId }));
  return nextActionId + 1;
}

function sendHeartbeat(connection: INetworkConnection, inputTick: number): void {
  connection.send(1, encodeGameplay({ tick: inputTick, x: 0, z: 0 }));
}

function sendScheduledGameplay<TState extends INetworkingState>(
  store: INetworkingStore<TState>,
  connection: INetworkConnection,
  config: INetworkingConfig,
  inputTick: number,
  nextActionId: number,
): { inputTick: number; nextActionId: number } {
  const nextInputTick = inputTick + 1;
  if (inputTick >= INPUT_DURATION_TICKS) {
    if (nextInputTick % HEARTBEAT_INTERVAL_TICKS !== 0)
      return { inputTick: nextInputTick, nextActionId };
    try {
      sendHeartbeat(connection, nextInputTick);
    } catch {
      reportProtocolError(store);
    }
    return { inputTick: nextInputTick, nextActionId };
  }
  if (store.getState().networkPeerObserved !== true) return { inputTick, nextActionId };
  try {
    return {
      inputTick: nextInputTick,
      nextActionId: sendGameplay(
        connection,
        config.playerId ?? "player",
        nextInputTick,
        nextActionId,
        nextInputTick === 1,
      ),
    };
  } catch {
    reportProtocolError(store);
    return { inputTick: nextInputTick, nextActionId };
  }
}

export function createNetworkingGame<TState extends INetworkingState>(
  config: INetworkingConfig,
): INetworkingGame<TState> {
  let connection: INetworkConnection | undefined;
  let connecting: Promise<void> | undefined;
  let generation = 0;
  let closed = true;
  let retryRequested = false;
  let inputTick = 0;
  let nextActionId = 1;
  const lastActionId = { value: 0 };
  const positions: IObservedPositions = {
    local: undefined,
    remote: undefined,
    remoteDistance: 0,
    peerLastSeenAtMs: undefined,
  };
  let lastSnapshotTick = new Map<string, number>();

  const start = (store: INetworkingStore<TState>, retry: boolean): void => {
    if (!config.enabled || connecting !== undefined || !closed) return;
    closed = false;
    const run = ++generation;
    const current = store.getState();
    patch(store, {
      networkConnected: false,
      networkError: "",
      networkReconnects: retry
        ? (current.networkReconnects ?? 0) + 1
        : (current.networkReconnects ?? 0),
      networkRetry: retry ? current.networkRetry + 1 : current.networkRetry,
      networkSessionId: "",
      networkStatus: "connecting",
      networkProtocolErrors: 0,
    });
    inputTick = 0;
    nextActionId = 1;
    lastActionId.value = 0;
    lastSnapshotTick = new Map();
    positions.local = undefined;
    positions.remote = undefined;
    positions.remoteDistance = 0;
    positions.peerLastSeenAtMs = undefined;
    const work = issueCredential(config).then((credential) => {
      if (run !== generation || closed || config.endpoint === undefined)
        throw new Error("TN_NETWORK_AUTH: connection was canceled");
      const options: INetworkOptions = {
        applicationProtocol: APPLICATION_PROTOCOL,
        channels: CHANNELS,
        credential,
      };
      return connect(config.endpoint, options);
    });
    connecting = work
      .then((opened) => {
        if (run !== generation || closed) {
          void opened.close();
          return;
        }
        connection = opened;
        patch(store, {
          networkConnected: true,
          networkError: "",
          networkSessionId: opened.getStats().sessionId,
          networkStatus: "connected",
        });
      })
      .catch(() => {
        if (run !== generation || closed) return;
        patch(store, {
          networkConnected: false,
          networkError: publicFailure(),
          networkSessionId: "",
          networkStatus: "disconnected",
        });
      })
      .finally(() => {
        if (run === generation) connecting = undefined;
      });
  };

  return {
    enter(store) {
      closed = true;
      retryRequested = false;
      if (!config.enabled) {
        patch(store, {
          networkConnected: false,
          networkError: "",
          networkSessionId: "",
          networkStatus: "disabled",
        });
        return;
      }
      start(store, false);
    },
    update(store) {
      if (retryRequested && connecting === undefined) {
        retryRequested = false;
        const previous = connection;
        connection = undefined;
        if (previous !== undefined) void previous.close();
        closed = true;
        start(store, true);
      }
      const active = connection;
      if (active === undefined) return;
      const batch = active.poll();
      consumeMessages(store, batch.messages, config, lastSnapshotTick, positions, lastActionId);
      if (
        positions.remote !== undefined &&
        positions.peerLastSeenAtMs !== undefined &&
        performance.now() - positions.peerLastSeenAtMs >= PEER_SILENCE_TIMEOUT_MS
      ) {
        positions.remote = undefined;
        positions.peerLastSeenAtMs = undefined;
        patch(store, {
          networkPeerId: "",
          networkPeerObserved: false,
          networkRemoteX: 0,
          networkRemoteZ: 0,
        });
      }
      if (batch.disconnected) {
        connection = undefined;
        closed = true;
        patch(store, {
          networkConnected: false,
          networkError: batch.reason ?? publicFailure(),
          networkSessionId: "",
          networkStatus: "disconnected",
        });
        void active.close();
        return;
      }
      const schedule = sendScheduledGameplay(store, active, config, inputTick, nextActionId);
      inputTick = schedule.inputTick;
      nextActionId = schedule.nextActionId;
    },
    retry() {
      retryRequested = true;
    },
    exit() {
      generation += 1;
      closed = true;
      retryRequested = false;
      const active = connection;
      connection = undefined;
      if (active !== undefined) void active.close();
    },
  };
}
