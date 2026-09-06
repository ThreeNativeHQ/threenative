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
  networkActionAckLatencyMs?: number;
  networkAppliedStateAgeMs?: number;
  networkConnected: boolean;
  networkClockOffsetMs?: number;
  networkClockUncertaintyMs?: number;
  networkError: string;
  networkJsNetworkingCpuMs?: number;
  networkMetricsReady?: boolean;
  networkUnmatchedActionAcks?: number;
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

export interface INetworkSnapshot {
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

interface IClockReply {
  readonly probeId: number;
  readonly clientSentMs: number;
  readonly serverReceivedMs: number;
  readonly serverSentMs: number;
}

interface IClockProbe {
  readonly rttMs: number;
  readonly offsetMs: number;
  readonly uncertaintyMs: number;
  readonly receivedAtMs: number;
}

interface INetworkingMetricSamples {
  readonly appliedStateAgeMs: number[];
  readonly actionAckLatencyMs: number[];
  connectedAtMs: number | undefined;
  collectionStartedAtMs: number | undefined;
  lastSampleAtMs: number | undefined;
  nextActionAtMs: number | undefined;
  nextClockProbeAtMs: number | undefined;
  nextHeartbeatAtMs: number | undefined;
  readonly jsNetworkingCpuMs: number[];
  unmatchedActionAckCount: number;
  readonly clockProbes: IClockProbe[];
  readonly pendingActions: Map<number, number>;
  readonly pendingClockProbes: Map<number, number>;
}

const NETWORK_SESSION_ASSET = "networking-session.json";
const APPLICATION_PROTOCOL = "threenative-smoke/1";
const INPUT_TICKS_PER_SECOND = 60;
const INPUT_DURATION_TICKS = INPUT_TICKS_PER_SECOND * 2;
const MAX_METRIC_SAMPLES = 10_000;
const METRIC_SCHEMA_VERSION = 2;
const METRIC_WARMUP_MS = 10_000;
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

function parseClockReply(data: Uint8Array): IClockReply {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    throw new Error("TN_NETWORK_PROTOCOL: clock reply is not valid JSON");
  }
  const record = exactRecord(
    value,
    ["clientSentMs", "probeId", "serverReceivedMs", "serverSentMs"],
    "clock reply",
  );
  return {
    clientSentMs: finiteNumber(record.clientSentMs, "clock client send time"),
    probeId: safeNonNegativeInteger(record.probeId, "clock probe id"),
    serverReceivedMs: finiteNumber(record.serverReceivedMs, "clock server receive time"),
    serverSentMs: finiteNumber(record.serverSentMs, "clock server send time"),
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

export interface IObservedPositions {
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

export function observeSnapshot<TState extends INetworkingState>(
  store: INetworkingStore<TState>,
  config: INetworkingConfig,
  snapshot: INetworkSnapshot,
  lastSnapshotTick: Map<string, number>,
  positions: IObservedPositions,
  metrics?: INetworkingMetricSamples,
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
  if (metrics !== undefined) {
    const nowMs = performance.now();
    const probe = bestClockProbe(metrics, nowMs);
    if (probe !== undefined) {
      const estimateMs = nowMs + probe.offsetMs - snapshot.serverMonoMs;
      const upperBoundMs = Math.max(0, estimateMs + probe.uncertaintyMs);
      if (Number.isFinite(upperBoundMs)) {
        appendMeasuredSample(metrics, metrics.appliedStateAgeMs, upperBoundMs, nowMs);
        patch(store, {
          networkAppliedStateAgeMs: upperBoundMs,
          networkClockOffsetMs: probe.offsetMs,
          networkClockUncertaintyMs: probe.uncertaintyMs,
          networkMetricsReady: true,
        });
      }
    }
  }
  patch(store, {
    networkLastActionId: snapshot.player.lastActionId,
    networkLocalX: local?.x,
    networkLocalZ: local?.z,
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
  metrics: INetworkingMetricSamples,
): void {
  const sentAtMs = metrics.pendingActions.get(reply.id);
  metrics.pendingActions.delete(reply.id);
  if (sentAtMs === undefined) {
    metrics.unmatchedActionAckCount += 1;
    patch(store, {
      networkUnmatchedActionAcks: metrics.unmatchedActionAckCount,
    });
    return;
  }
  lastActionId.value = Math.max(lastActionId.value, reply.id);
  if (!reply.accepted) return;
  const nowMs = performance.now();
  const latencyMs = nowMs - sentAtMs;
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
  if (!appendMeasuredSample(metrics, metrics.actionAckLatencyMs, latencyMs, nowMs)) return;
  const state = store.getState();
  patch(store, {
    networkActionAckLatencyMs: latencyMs,
    networkActionAcks: (state.networkActionAcks ?? 0) + 1,
  });
}

function appendSample<T>(samples: T[], value: T): void {
  samples.push(value);
  if (samples.length > MAX_METRIC_SAMPLES) samples.shift();
}

function metricCollectionActive(metrics: INetworkingMetricSamples, nowMs: number): boolean {
  if (metrics.connectedAtMs === undefined) return false;
  if (metrics.collectionStartedAtMs === undefined) {
    if (nowMs - metrics.connectedAtMs < METRIC_WARMUP_MS) return false;
    metrics.collectionStartedAtMs = nowMs;
  }
  metrics.lastSampleAtMs = nowMs;
  return true;
}

function appendMeasuredSample<T>(
  metrics: INetworkingMetricSamples,
  samples: T[],
  value: T,
  nowMs: number,
): boolean {
  if (!metricCollectionActive(metrics, nowMs)) return false;
  appendSample(samples, value);
  return true;
}

function bestClockProbe(metrics: INetworkingMetricSamples, nowMs: number): IClockProbe | undefined {
  const recent = metrics.clockProbes.filter((probe) => nowMs - probe.receivedAtMs <= 10_000);
  return recent.reduce<IClockProbe | undefined>(
    (best, probe) => (best === undefined || probe.rttMs < best.rttMs ? probe : best),
    undefined,
  );
}

function observeClockReply<TState extends INetworkingState>(
  store: INetworkingStore<TState>,
  reply: IClockReply,
  metrics: INetworkingMetricSamples,
): void {
  const sentAtMs = metrics.pendingClockProbes.get(reply.probeId);
  metrics.pendingClockProbes.delete(reply.probeId);
  if (sentAtMs === undefined || Math.abs(reply.clientSentMs - sentAtMs) > 0.001) return;
  const clientReceivedMs = performance.now();
  const rttMs =
    clientReceivedMs - reply.clientSentMs - (reply.serverSentMs - reply.serverReceivedMs);
  const uncertaintyMs = rttMs / 2;
  const offsetMs =
    (reply.serverReceivedMs - reply.clientSentMs + reply.serverSentMs - clientReceivedMs) / 2;
  if (
    !Number.isFinite(rttMs) ||
    !Number.isFinite(offsetMs) ||
    !Number.isFinite(uncertaintyMs) ||
    rttMs < 0 ||
    uncertaintyMs < 0
  )
    return;
  appendMeasuredSample(
    metrics,
    metrics.clockProbes,
    {
      rttMs,
      offsetMs,
      uncertaintyMs,
      receivedAtMs: clientReceivedMs,
    },
    clientReceivedMs,
  );
  patch(store, {
    networkClockOffsetMs: offsetMs,
    networkClockUncertaintyMs: uncertaintyMs,
    networkMetricsReady: true,
  });
}

function consumeMessages<TState extends INetworkingState>(
  store: INetworkingStore<TState>,
  messages: readonly { channel: number; data: Uint8Array }[],
  config: INetworkingConfig,
  lastSnapshotTick: Map<string, number>,
  positions: IObservedPositions,
  lastActionId: { value: number },
  metrics: INetworkingMetricSamples,
): void {
  for (const message of messages) {
    try {
      if (message.channel === 2) {
        observeSnapshot(
          store,
          config,
          parseSnapshot(message.data),
          lastSnapshotTick,
          positions,
          metrics,
        );
      } else if (message.channel === 3) {
        observeActionReply(store, parseActionReply(message.data), lastActionId, metrics);
      } else if (message.channel === 4) {
        observeClockReply(store, parseClockReply(message.data), metrics);
      }
    } catch {
      reportProtocolError(store);
    }
  }
}

function sendAction(
  connection: INetworkConnection,
  nextActionId: number,
  metrics: INetworkingMetricSamples,
): number {
  const sentAtMs = performance.now();
  if (!connection.send(3, encodeGameplay({ id: nextActionId })))
    throw new Error("TN_NETWORK_QUEUE_FULL: action could not be queued");
  metrics.pendingActions.set(nextActionId, sentAtMs);
  return nextActionId + 1;
}

function sendGameplay(
  connection: INetworkConnection,
  playerId: string,
  inputTick: number,
  nextActionId: number,
  shouldSendAction: boolean,
  metrics: INetworkingMetricSamples,
): number {
  const axes = playerAxes(playerId);
  connection.send(1, encodeGameplay({ tick: inputTick, x: axes.x, z: axes.z }));
  if (!shouldSendAction || !metricCollectionActive(metrics, performance.now())) return nextActionId;
  return sendAction(connection, nextActionId, metrics);
}

function sendHeartbeat(connection: INetworkConnection, inputTick: number): void {
  connection.send(1, encodeGameplay({ tick: inputTick, x: 0, z: 0 }));
}

function sendMeasuredGameplay<TState extends INetworkingState>(
  store: INetworkingStore<TState>,
  connection: INetworkConnection,
  nextInputTick: number,
  nextActionId: number,
  metrics: INetworkingMetricSamples,
): { inputTick: number; nextActionId: number } {
  const nowMs = performance.now();
  if (metrics.nextHeartbeatAtMs === undefined) metrics.nextHeartbeatAtMs = nowMs;
  const heartbeatDue = nowMs >= metrics.nextHeartbeatAtMs;
  if (heartbeatDue) metrics.nextHeartbeatAtMs = nowMs + 1_000;
  try {
    if (heartbeatDue) sendHeartbeat(connection, nextInputTick);
    if (!metricCollectionActive(metrics, nowMs)) return { inputTick: nextInputTick, nextActionId };
    if (metrics.nextActionAtMs === undefined) metrics.nextActionAtMs = nowMs;
    if (nowMs < metrics.nextActionAtMs) return { inputTick: nextInputTick, nextActionId };
    const actionId = sendAction(connection, nextActionId, metrics);
    metrics.nextActionAtMs = nowMs + 500;
    return { inputTick: nextInputTick, nextActionId: actionId };
  } catch {
    reportProtocolError(store);
    return { inputTick: nextInputTick, nextActionId };
  }
}

function sendInputGameplay<TState extends INetworkingState>(
  store: INetworkingStore<TState>,
  connection: INetworkConnection,
  config: INetworkingConfig,
  inputTick: number,
  nextActionId: number,
  metrics: INetworkingMetricSamples,
): { inputTick: number; nextActionId: number } {
  try {
    return {
      inputTick: inputTick + 1,
      nextActionId: sendGameplay(
        connection,
        config.playerId ?? "player",
        inputTick + 1,
        nextActionId,
        false,
        metrics,
      ),
    };
  } catch {
    reportProtocolError(store);
    return { inputTick: inputTick + 1, nextActionId };
  }
}

function sendScheduledGameplay<TState extends INetworkingState>(
  store: INetworkingStore<TState>,
  connection: INetworkConnection,
  config: INetworkingConfig,
  inputTick: number,
  nextActionId: number,
  metrics: INetworkingMetricSamples,
): { inputTick: number; nextActionId: number } {
  if (inputTick >= INPUT_DURATION_TICKS) {
    return sendMeasuredGameplay(store, connection, inputTick + 1, nextActionId, metrics);
  }
  if (store.getState().networkPeerObserved !== true) return { inputTick, nextActionId };
  return sendInputGameplay(store, connection, config, inputTick, nextActionId, metrics);
}

function metricsSignature(metrics: INetworkingMetricSamples): string {
  return [
    metrics.actionAckLatencyMs.length,
    metrics.appliedStateAgeMs.length,
    metrics.clockProbes.length,
    metrics.jsNetworkingCpuMs.length,
  ].join(":");
}

function shouldEmitMetrics(metrics: INetworkingMetricSamples, force: boolean): boolean {
  if (force) return true;
  if (metrics.collectionStartedAtMs === undefined || metrics.lastSampleAtMs === undefined)
    return false;
  return metrics.actionAckLatencyMs.length > 0 || metrics.appliedStateAgeMs.length > 0;
}

function metricsPayload(metrics: INetworkingMetricSamples): Record<string, unknown> {
  const collectionDurationMs =
    metrics.collectionStartedAtMs === undefined || metrics.lastSampleAtMs === undefined
      ? 0
      : Math.max(0, metrics.lastSampleAtMs - metrics.collectionStartedAtMs);
  const warmupMs =
    metrics.connectedAtMs === undefined || metrics.collectionStartedAtMs === undefined
      ? 0
      : Math.max(0, metrics.collectionStartedAtMs - metrics.connectedAtMs);
  return {
    actionAckLatencyMs: metrics.actionAckLatencyMs,
    appliedStateAgeMs: metrics.appliedStateAgeMs,
    clockProbes: metrics.clockProbes.map(({ receivedAtMs: _receivedAtMs, ...probe }) => probe),
    collectionDurationMs,
    jsNetworkingCpuMs: metrics.jsNetworkingCpuMs,
    schemaVersion: METRIC_SCHEMA_VERSION,
    unmatchedActionAckCount: metrics.unmatchedActionAckCount,
    warmupMs,
  };
}

function expireSilentPeer<TState extends INetworkingState>(
  store: INetworkingStore<TState>,
  positions: IObservedPositions,
): void {
  if (
    positions.remote === undefined ||
    positions.peerLastSeenAtMs === undefined ||
    performance.now() - positions.peerLastSeenAtMs < PEER_SILENCE_TIMEOUT_MS
  )
    return;
  positions.remote = undefined;
  positions.peerLastSeenAtMs = undefined;
  patch(store, {
    networkPeerId: "",
    networkPeerObserved: false,
    networkRemoteX: 0,
    networkRemoteZ: 0,
  });
}

function sendClockProbe<TState extends INetworkingState>(
  store: INetworkingStore<TState>,
  connection: INetworkConnection,
  metrics: INetworkingMetricSamples,
  nextClockProbeId: number,
): number {
  const nowMs = performance.now();
  if (!metricCollectionActive(metrics, nowMs)) return nextClockProbeId;
  if (metrics.nextClockProbeAtMs === undefined) metrics.nextClockProbeAtMs = nowMs;
  if (nowMs < metrics.nextClockProbeAtMs) return nextClockProbeId;
  metrics.nextClockProbeAtMs = nowMs + 500;
  const probeId = nextClockProbeId;
  const clientSentMs = performance.now();
  try {
    if (connection.send(4, encodeGameplay({ clientSentMs, probeId })))
      metrics.pendingClockProbes.set(probeId, clientSentMs);
  } catch {
    reportProtocolError(store);
  }
  return probeId + 1;
}

function recordNetworkingPoll<TState extends INetworkingState>(
  store: INetworkingStore<TState>,
  metrics: INetworkingMetricSamples,
  startedAtMs: number,
): void {
  const finishedAtMs = performance.now();
  const elapsedMs = finishedAtMs - startedAtMs;
  appendMeasuredSample(metrics, metrics.jsNetworkingCpuMs, elapsedMs, finishedAtMs);
  patch(store, { networkJsNetworkingCpuMs: elapsedMs });
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
  let nextClockProbeId = 1;
  let lastMetricsSampleSignature: string | undefined;
  const lastActionId = { value: 0 };
  const positions: IObservedPositions = {
    local: undefined,
    remote: undefined,
    remoteDistance: 0,
    peerLastSeenAtMs: undefined,
  };
  let lastSnapshotTick = new Map<string, number>();
  const metrics: INetworkingMetricSamples = {
    actionAckLatencyMs: [],
    appliedStateAgeMs: [],
    connectedAtMs: undefined,
    collectionStartedAtMs: undefined,
    lastSampleAtMs: undefined,
    nextActionAtMs: undefined,
    nextClockProbeAtMs: undefined,
    nextHeartbeatAtMs: undefined,
    clockProbes: [],
    jsNetworkingCpuMs: [],
    pendingActions: new Map(),
    pendingClockProbes: new Map(),
    unmatchedActionAckCount: 0,
  };

  const resetMetrics = (): void => {
    metrics.actionAckLatencyMs.length = 0;
    metrics.appliedStateAgeMs.length = 0;
    metrics.connectedAtMs = undefined;
    metrics.collectionStartedAtMs = undefined;
    metrics.lastSampleAtMs = undefined;
    metrics.nextActionAtMs = undefined;
    metrics.nextClockProbeAtMs = undefined;
    metrics.nextHeartbeatAtMs = undefined;
    metrics.clockProbes.length = 0;
    metrics.jsNetworkingCpuMs.length = 0;
    metrics.unmatchedActionAckCount = 0;
    metrics.pendingActions.clear();
    metrics.pendingClockProbes.clear();
    nextClockProbeId = 1;
    lastMetricsSampleSignature = undefined;
  };

  const emitMetrics = (force = false): void => {
    const signature = metricsSignature(metrics);
    if (!shouldEmitMetrics(metrics, force) || (!force && lastMetricsSampleSignature === signature))
      return;
    lastMetricsSampleSignature = signature;
    console.log(`TN_NETWORK_METRICS:${JSON.stringify(metricsPayload(metrics))}`);
  };

  const start = (store: INetworkingStore<TState>, retry: boolean): void => {
    if (!config.enabled || connecting !== undefined || !closed) return;
    closed = false;
    const run = ++generation;
    const current = store.getState();
    patch(store, {
      networkConnected: false,
      networkError: "",
      networkLocalX: undefined,
      networkLocalZ: undefined,
      networkReconnects: retry
        ? (current.networkReconnects ?? 0) + 1
        : (current.networkReconnects ?? 0),
      networkRetry: retry ? current.networkRetry + 1 : current.networkRetry,
      networkSessionId: "",
      networkStatus: "connecting",
      networkProtocolErrors: 0,
      networkMetricsReady: false,
      networkUnmatchedActionAcks: 0,
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
        metrics.connectedAtMs = performance.now();
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

  const pollConnection = (store: INetworkingStore<TState>, active: INetworkConnection): void => {
    const networkStartedAtMs = performance.now();
    const batch = active.poll();
    consumeMessages(
      store,
      batch.messages,
      config,
      lastSnapshotTick,
      positions,
      lastActionId,
      metrics,
    );
    expireSilentPeer(store, positions);
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
      recordNetworkingPoll(store, metrics, networkStartedAtMs);
      emitMetrics();
      return;
    }
    const schedule = sendScheduledGameplay(store, active, config, inputTick, nextActionId, metrics);
    inputTick = schedule.inputTick;
    nextActionId = schedule.nextActionId;
    nextClockProbeId = sendClockProbe(store, active, metrics, nextClockProbeId);
    recordNetworkingPoll(store, metrics, networkStartedAtMs);
    emitMetrics();
  };

  return {
    enter(store) {
      resetMetrics();
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
        resetMetrics();
        start(store, true);
      }
      const active = connection;
      if (active === undefined) return;
      pollConnection(store, active);
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
      emitMetrics(true);
    },
  };
}
