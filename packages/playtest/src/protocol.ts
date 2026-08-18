export const PLAYTEST_BRIDGE_GLOBAL = "__THREENATIVE_PLAYTEST_BRIDGE__";
export const PLAYTEST_PROTOCOL_VERSION = 1 as const;

export const PLAYTEST_PROTOCOL_LIMITS = {
  maxEntitiesPerSample: 100,
  maxEventsPerDrain: 1_000,
  maxPayloadBytes: 1_000_000,
  operationTimeoutMs: 5_000,
} as const;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type PlaytestClockMode = "fixed-step" | "render-frame" | "wall-clock";

export interface IPlaytestBridgeDescription {
  capabilities: readonly string[];
  limits: typeof PLAYTEST_PROTOCOL_LIMITS;
  name: string;
  protocolVersion: typeof PLAYTEST_PROTOCOL_VERSION;
}

export interface IPlaytestBridgeReady {
  ready: boolean;
  reason?: string;
}

export interface IPlaytestEntityTransform {
  position?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}

export interface IPlaytestSetupRequest {
  entities?: Array<{ entity: string; transform: IPlaytestEntityTransform }>;
  resources?: Array<{ id: string; path?: string; value: JsonValue }>;
}

export interface IPlaytestSampleRequest {
  entities?: readonly string[];
  include?: readonly string[];
  /** Scenario-step label for providers that retain labelled observation series. */
  label?: string;
  resources?: readonly string[];
}

export interface IPlaytestEntityObservation {
  bounds?: { height: number; width: number; x: number; y: number };
  id: string;
  transform?: IPlaytestEntityTransform;
  visible?: boolean;
}

export interface IPlaytestAnimationObservation {
  advancedFrames: number;
  clip: string;
  finished?: boolean;
}

export interface IPlaytestContactObservation {
  entity: string;
  kind: string;
  with: string;
}

export interface IPlaytestTagObservation {
  count: number;
}

export interface IPlaytestPerformanceObservation {
  drawCalls?: number;
  triangles?: number;
}

export interface IPlaytestWorldRuntimeObservation {
  agent: string;
  core: string;
  randomState: number;
  rapier: string | null;
  step: number;
}

export interface IPlaytestWorldObservation {
  runtime?: IPlaytestWorldRuntimeObservation;
  seed: number | null;
}

export interface IPlaytestGameplayObservation {
  animation: Record<string, IPlaytestAnimationObservation>;
  contacts?: IPlaytestContactObservation[];
  states: Record<string, string>;
  tags?: Record<string, IPlaytestTagObservation>;
  world?: IPlaytestWorldObservation;
}

/** Per-render samples shared by the browser and native playtest bridges. */
export interface IPlaytestRuntimeDiagnosticsSample {
  drawCalls?: number;
  frameMs: number;
  triangles?: number;
}

export interface IPlaytestObservationSnapshot {
  clock: {
    mode: PlaytestClockMode;
    tick?: number;
    timeMs?: number;
  };
  diagnostics?: JsonValue[];
  components?: Record<string, Record<string, JsonValue>>;
  entities?: IPlaytestEntityObservation[];
  gameplay?: IPlaytestGameplayObservation;
  physicsDebugSeries?: Array<{ label: string; snapshot: JsonValue; tick: number }>;
  performance?: IPlaytestPerformanceObservation;
  runtimeDiagnosticsSeries?: IPlaytestRuntimeDiagnosticsSample[];
  resources?: Record<string, JsonValue>;
}

export interface IPlaytestAdvanceResult {
  clock: IPlaytestObservationSnapshot["clock"];
  ticks: number;
}

export interface IPlaytestBridgeV1 {
  advance?(ticks: number): Promise<IPlaytestAdvanceResult>;
  applySetup?(request: IPlaytestSetupRequest): Promise<void>;
  describe(): IPlaytestBridgeDescription | Promise<IPlaytestBridgeDescription>;
  drainEvents?(limit?: number): Promise<JsonValue[]>;
  focus?(): boolean | Promise<boolean>;
  ready(): IPlaytestBridgeReady | Promise<IPlaytestBridgeReady>;
  sample(request: IPlaytestSampleRequest): IPlaytestObservationSnapshot | Promise<IPlaytestObservationSnapshot>;
}

/** Request/response envelope used by the host-neutral device transport. */
export interface IPlaytestDeviceRequest {
  argument?: JsonValue;
  id: string;
  method: string;
}

export interface IPlaytestDeviceResponse {
  error?: { message: string };
  id: string;
  result?: JsonValue;
}

export interface IPlaytestBridgeHost {
  [PLAYTEST_BRIDGE_GLOBAL]?: IPlaytestBridgeV1;
}

export function jsonByteLength(value: JsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function assertJsonSafe(value: unknown, path = "$"): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      return;
    }
    throw new TypeError(`${path} must contain only finite JSON numbers.`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertJsonSafe(item, `${path}.${key}`);
    }
    return;
  }
  throw new TypeError(`${path} must be JSON-safe.`);
}
