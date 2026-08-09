declare const PLAYTEST_BRIDGE_GLOBAL = "__THREENATIVE_PLAYTEST_BRIDGE__";
declare const PLAYTEST_PROTOCOL_VERSION: 1;
declare const PLAYTEST_PROTOCOL_LIMITS: {
    readonly maxEntitiesPerSample: 100;
    readonly maxEventsPerDrain: 1000;
    readonly maxPayloadBytes: 1000000;
    readonly operationTimeoutMs: 5000;
};
type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | {
    [key: string]: JsonValue;
};
type PlaytestClockMode = "fixed-step" | "render-frame" | "wall-clock";
interface IPlaytestBridgeDescription {
    capabilities: readonly string[];
    limits: typeof PLAYTEST_PROTOCOL_LIMITS;
    name: string;
    protocolVersion: typeof PLAYTEST_PROTOCOL_VERSION;
}
interface IPlaytestBridgeReady {
    ready: boolean;
    reason?: string;
}
interface IPlaytestEntityTransform {
    position?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
}
interface IPlaytestSetupRequest {
    entities?: Array<{
        entity: string;
        transform: IPlaytestEntityTransform;
    }>;
    resources?: Array<{
        id: string;
        path?: string;
        value: JsonValue;
    }>;
}
interface IPlaytestSampleRequest {
    entities?: readonly string[];
    include?: readonly string[];
    resources?: readonly string[];
}
interface IPlaytestEntityObservation {
    bounds?: {
        height: number;
        width: number;
        x: number;
        y: number;
    };
    id: string;
    transform?: IPlaytestEntityTransform;
    visible?: boolean;
}
interface IPlaytestAnimationObservation {
    advancedFrames: number;
    clip: string;
}
interface IPlaytestContactObservation {
    entity: string;
    kind: string;
    with: string;
}
interface IPlaytestTagObservation {
    count: number;
}
interface IPlaytestWorldRuntimeObservation {
    agent: string;
    core: string;
    randomState: number;
    rapier: string | null;
    step: number;
}
interface IPlaytestWorldObservation {
    runtime?: IPlaytestWorldRuntimeObservation;
    seed: number | null;
}
interface IPlaytestGameplayObservation {
    animation: Record<string, IPlaytestAnimationObservation>;
    contacts?: IPlaytestContactObservation[];
    states: Record<string, string>;
    tags?: Record<string, IPlaytestTagObservation>;
    world?: IPlaytestWorldObservation;
}
interface IPlaytestObservationSnapshot {
    clock: {
        mode: PlaytestClockMode;
        tick?: number;
        timeMs?: number;
    };
    diagnostics?: JsonValue[];
    components?: Record<string, Record<string, JsonValue>>;
    entities?: IPlaytestEntityObservation[];
    gameplay?: IPlaytestGameplayObservation;
    resources?: Record<string, JsonValue>;
}
interface IPlaytestAdvanceResult {
    clock: IPlaytestObservationSnapshot["clock"];
    ticks: number;
}
interface IPlaytestBridgeV1 {
    advance?(ticks: number): Promise<IPlaytestAdvanceResult>;
    applySetup?(request: IPlaytestSetupRequest): Promise<void>;
    describe(): IPlaytestBridgeDescription | Promise<IPlaytestBridgeDescription>;
    drainEvents?(limit?: number): Promise<JsonValue[]>;
    focus?(): boolean | Promise<boolean>;
    ready(): IPlaytestBridgeReady | Promise<IPlaytestBridgeReady>;
    sample(request: IPlaytestSampleRequest): IPlaytestObservationSnapshot | Promise<IPlaytestObservationSnapshot>;
}
interface IPlaytestBridgeHost {
    [PLAYTEST_BRIDGE_GLOBAL]?: IPlaytestBridgeV1;
}
declare function jsonByteLength(value: JsonValue): number;
declare function assertJsonSafe(value: unknown, path?: string): asserts value is JsonValue;

export { type IPlaytestObservationSnapshot as I, type JsonValue as J, type PlaytestClockMode as P, type IPlaytestSampleRequest as a, type IPlaytestBridgeV1 as b, type IPlaytestGameplayObservation as c, type IPlaytestSetupRequest as d, type IPlaytestBridgeDescription as e, type IPlaytestAdvanceResult as f, type IPlaytestAnimationObservation as g, type IPlaytestBridgeHost as h, type IPlaytestBridgeReady as i, type IPlaytestContactObservation as j, type IPlaytestEntityObservation as k, type IPlaytestEntityTransform as l, type IPlaytestTagObservation as m, type IPlaytestWorldObservation as n, type IPlaytestWorldRuntimeObservation as o, type JsonPrimitive as p, PLAYTEST_BRIDGE_GLOBAL as q, PLAYTEST_PROTOCOL_LIMITS as r, PLAYTEST_PROTOCOL_VERSION as s, assertJsonSafe as t, jsonByteLength as u };
