type PlaytestCapability = "browser.canvas" | "browser.console" | "browser.dom" | "browser.input" | "browser.network" | "browser.screenshot" | "browser.trace" | "camera.observe" | "entity.bounds" | "entity.observe" | "entity.setup" | "runtime.animation" | "runtime.audio" | "runtime.components" | "runtime.contacts" | "runtime.diagnostics" | "runtime.events" | "runtime.fixedStep" | "runtime.physics" | "runtime.resources" | "runtime.state" | "runtime.tags" | "runtime.ui" | "runtime.world";
interface IPlaytestCapabilityDescriptor {
    description: string;
    name: PlaytestCapability;
    protocolVersion: 1;
}
declare const PLAYTEST_CAPABILITY_REGISTRY: readonly IPlaytestCapabilityDescriptor[];
declare function unknownPlaytestCapabilities(capabilities: readonly string[]): string[];
declare function missingPlaytestCapabilities(required: readonly string[], available: readonly string[]): string[];

type PlaytestVec3 = [number, number, number];
interface IPlaytestTransformSample {
    frame: number;
    position: PlaytestVec3;
    rotation?: readonly [number, number, number, number];
    tick: number;
}
interface IPlaytestFollowReport {
    after?: IPlaytestTransformSample;
    before?: IPlaytestTransformSample;
    entity: string;
    moved?: number;
    separation?: number;
    within: number;
}
interface IPlaytestReport {
    after?: IPlaytestTransformSample;
    assertionResults?: IPlaytestAssertionResult[];
    before?: IPlaytestTransformSample;
    diagnostics: IPlaytestDiagnostic[];
    distance: number;
    effectLog?: unknown;
    entity: string;
    expectAxis?: string;
    expectMoved: boolean;
    follow?: IPlaytestFollowReport;
    frames: number;
    movementDelta?: PlaytestVec3;
    observations?: IPlaytestObservations;
    pathLength?: number;
}

type PlaytestTarget = "web" | "desktop" | "bevy";
type PlaytestInputDelivery = "deterministic" | "focused-dom";
interface IPlaytestViewport {
    height: number;
    width: number;
}
interface IPlaytestStep {
    kind?: "input" | "wait";
    holdFrames?: number;
    holdTicks?: number;
    label?: string;
    overlayMessage?: {
        overlayId: string;
        payload: unknown;
        type: string;
    };
    pointerPosition?: {
        buttons?: number;
        x: number;
        y: number;
    };
    /** A string presses one key; an array describes the complete held-key set. */
    press?: string | readonly string[];
    release: boolean;
    screenshot?: string;
    waitFrames?: number;
    waitTicks?: number;
    window?: {
        height?: number;
        operation: "minimize" | "resize" | "restore";
        width?: number;
    };
}
interface IPlaytestMovementAssertion {
    axis?: string;
    closesDistanceToPosition?: {
        position: [number, number, number];
        min: number;
    };
    entity?: string;
    facesMovementWithinDegrees?: number;
    minAxisDelta?: {
        axis: string;
        min: number;
    };
    minResolvedAxisDelta?: {
        axis: string;
        min: number;
    };
    maxTiltDegrees?: number;
    minDistance?: number;
    minVelocity?: number;
    maxDistance?: number;
    pathLength?: number;
    notFacing?: {
        entity: string;
        minDegrees: number;
    };
    notFacingPosition?: {
        position: [number, number, number];
        minDegrees: number;
    };
    reachesPositionWithin?: {
        atStep?: string;
        position: [number, number, number];
        maxDistance: number;
    };
    rotationChanged?: boolean;
}
interface IPlaytestCameraAssertion {
    entity?: string;
    follows?: string;
    targetInViewport?: boolean;
    within?: number;
}
interface IPlaytestPathAssertion {
    atSteps?: Array<{
        equals?: unknown;
        label: string;
        textIncludes?: string;
    }>;
    changed?: boolean;
    equals?: unknown;
    gte?: number;
    id: string;
    allowTrivial?: boolean;
    path?: string;
    textIncludes?: string;
    throughoutSteps?: boolean;
}
interface IPlaytestResourcePathAlternative {
    changed?: boolean;
    equals?: unknown;
    gte?: number;
    path: string;
    textIncludes?: string;
}
interface IPlaytestResourcePathAssertion extends IPlaytestPathAssertion {
    anyOf?: never;
}
interface IPlaytestResourceAnyOfAssertion {
    anyOf: IPlaytestResourcePathAlternative[];
    atSteps?: never;
    changed?: never;
    equals?: never;
    gte?: never;
    id: string;
    allowTrivial?: never;
    path?: never;
    textIncludes?: never;
    throughoutSteps?: never;
}
type IPlaytestResourceAssertion = IPlaytestResourceAnyOfAssertion | IPlaytestResourcePathAssertion;
interface IPlaytestComponentAssertion extends Omit<IPlaytestPathAssertion, "id" | "textIncludes" | "throughoutSteps"> {
    component: string;
    entity: string;
}
interface IPlaytestContactAssertion {
    atStep?: string;
    entity?: string;
    kind?: string;
    maxCount?: number;
    minCount?: number;
    requiredOn?: PlaytestTarget[];
    with?: string;
}
interface IPlaytestSignalAssertion {
    atStep?: string;
    entity?: string;
    maxCount?: number;
    minCount?: number;
    name: string;
}
interface IPlaytestSettledAssertion {
    atStep?: string;
    compareToStep?: string;
    entity: string;
    minBodies?: number;
    minMeanPoseDistance?: number;
    requiredOn?: PlaytestTarget[];
}
interface IPlaytestOccludedAssertion {
    entity?: string;
    target?: string;
}
interface IPlaytestOverlayNodeAssertion {
    attribute?: string;
    equals?: unknown;
    overlayId: string;
    selector: string;
    textIncludes?: string;
    visible?: boolean;
}
interface IPlaytestAnimationAssertion {
    advancedFrames?: number;
    clip?: string;
    entered?: boolean;
    entity?: string;
}
interface IPlaytestTagCountAssertion {
    count?: number;
    gte?: number;
    tag: string;
}
interface IPlaytestStateAssertion {
    entity: string;
    equals: string;
}
interface IPlaytestVisibilityAssertion {
    entity?: string;
    maxOffscreenRatio?: number;
    minProjectedPixels?: number;
    present?: boolean;
}
interface IPlaytestDiagnosticsAssertion {
    noConsoleErrors?: boolean;
    noNetworkErrors?: boolean;
    noRuntimeDiagnostics?: boolean;
    runtimeDiagnosticsOptOutReason?: string;
    runtimeReady?: boolean;
}
interface IPlaytestVisualAssertion {
    entityVisible?: {
        entity: string;
        minProjectedPixels: number;
        throughoutFrames?: boolean;
    };
    frameDiff?: {
        baselineImage?: string;
        maxChangedPixelRatio?: number;
        minChangedPixelRatio?: number;
    };
    region?: {
        height: number;
        maxLuminance?: number;
        minDarkPixelRatio?: number;
        minNonblankPixelRatio?: number;
        width: number;
        x: number;
        y: number;
    };
}
interface IPlaytestAerodynamicsAssertion {
    controls?: Array<{
        minAbs?: number;
        sign: "negative" | "positive";
        surface: string;
    }>;
    entity: string;
    minForceSamples?: number;
    torques?: Array<{
        axis: "x" | "y" | "z";
        label: string;
        minAbs?: number;
        relativeToLabel?: string;
        sign: "negative" | "positive";
    }>;
}
interface IPlaytestReachabilityAssertion {
    artifact: string;
    entities: string[];
    /** Loaded from artifact by loadPlaytestScenario; not authored in scenario JSON. */
    envelope?: {
        fallDistanceToGround: number;
        forwardReach: number;
        maxRise: number;
    };
}
interface IPlaytestWorldRuntimeAssertion {
    agent: string;
    core: string;
    randomState: number;
    rapier: string | null;
    step: number;
}
interface IPlaytestWorldAssertion {
    runtime?: IPlaytestWorldRuntimeAssertion;
    seed: number | null;
}
interface IPlaytestScenarioAssertions {
    aerodynamics?: IPlaytestAerodynamicsAssertion[];
    animation?: IPlaytestAnimationAssertion[];
    camera?: IPlaytestCameraAssertion;
    components?: IPlaytestComponentAssertion[];
    contacts?: IPlaytestContactAssertion[];
    diagnostics?: IPlaytestDiagnosticsAssertion;
    hud?: IPlaytestPathAssertion[];
    movement?: IPlaytestMovementAssertion;
    occluded?: IPlaytestOccludedAssertion[];
    overlayNodes?: IPlaytestOverlayNodeAssertion[];
    reachability?: IPlaytestReachabilityAssertion;
    resources?: IPlaytestResourceAssertion[];
    settled?: IPlaytestSettledAssertion[];
    signals?: IPlaytestSignalAssertion[];
    states?: IPlaytestStateAssertion[];
    tags?: IPlaytestTagCountAssertion[];
    visibility?: IPlaytestVisibilityAssertion[];
    visual?: IPlaytestVisualAssertion[];
    world?: IPlaytestWorldAssertion;
}
interface IPlaytestParityConfig {
    animation?: Array<{
        clip?: string;
        entity: string;
        requiredOn?: PlaytestTarget[];
    }>;
    axisDelta?: Partial<Record<"x" | "y" | "z", number>>;
    contacts?: {
        minSharedCount?: number;
    };
    movementDistance?: {
        maxDelta: number;
    };
    resources?: string[];
    targets?: PlaytestTarget[];
}
interface IPlaytestArtifactRequest {
    console?: boolean;
    contactSheet?: boolean;
    effectLog?: "focused" | boolean;
    network?: boolean;
    runtimeTrace?: boolean;
    screenshots?: "before-after" | "after" | false;
}
interface IPlaytestSetupEntityTransform {
    entity: string;
    position?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
}
interface IPlaytestSetupResource {
    id: string;
    path?: string;
    value: unknown;
}
interface IPlaytestScenarioSetup {
    entities?: IPlaytestSetupEntityTransform[];
    resources?: IPlaytestSetupResource[];
}
interface IPlaytestScenario {
    acceptanceId?: string;
    artifacts?: IPlaytestArtifactRequest;
    assert?: IPlaytestScenarioAssertions;
    inputDelivery?: PlaytestInputDelivery;
    name: string;
    parity?: IPlaytestParityConfig;
    schemaVersion: 1;
    setup?: IPlaytestScenarioSetup;
    sourcePath?: string;
    steps: IPlaytestStep[];
    subject?: string;
    target: PlaytestTarget;
    viewport: IPlaytestViewport;
    warmupFrames: number;
}
interface IPlaytestScenarioDiagnostic {
    code: "TN_PLAYTEST_SCENARIO_INVALID" | "TN_PLAYTEST_SCENARIO_NOT_FOUND" | "TN_PLAYTEST_SCENARIO_STEP_INVALID";
    fix?: {
        docs?: string;
        instruction: string;
        snippet?: string;
    };
    message: string;
    severity: "error";
    suggestion?: string;
}
declare class PlaytestScenarioError extends Error {
    readonly diagnostic: IPlaytestScenarioDiagnostic;
    constructor(diagnostic: IPlaytestScenarioDiagnostic);
}
declare function loadPlaytestScenario(projectPath: string, scenarioPath: string): Promise<IPlaytestScenario>;
declare function oneShotScenario(options: {
    expectAxis?: string;
    expectMoved: boolean;
    follow?: {
        entityId: string;
        within: number;
    };
    frames: number;
    movementThreshold: number;
    press: string;
    subject: string;
    target?: PlaytestTarget;
    viewport?: IPlaytestViewport;
}): IPlaytestScenario;
declare function applyScenarioOverrides(scenario: IPlaytestScenario, overrides: {
    target?: PlaytestTarget;
    viewport?: IPlaytestViewport;
}): IPlaytestScenario;
declare function parsePlaytestTarget(value: string | undefined): PlaytestTarget | undefined;
declare function parseViewport(value: string | undefined): IPlaytestViewport | undefined;
declare function playtestStepHoldTicks(step: IPlaytestStep, fallback?: number): number;
declare function playtestStepWaitTicks(step: IPlaytestStep): number;
declare function invalidScenario(scenarioPath: string, message: string): PlaytestScenarioError;
declare function rejectUnknownKeys(value: Record<string, unknown>, allowedKeys: readonly string[], scenarioPath: string, objectPath: string): void;

type Vec3 = [number, number, number];
interface IPlaytestAssertionSchemaField {
    description: string;
    name: string;
    required?: boolean;
    type: string;
}
interface IPlaytestAssertionSchemaEntry {
    cardinality: "array" | "object";
    description: string;
    example: unknown;
    fields: IPlaytestAssertionSchemaField[];
    kind: keyof NonNullable<IPlaytestScenario["assert"]>;
    observationPath: string;
    requiredCapabilities: readonly PlaytestCapability[];
    resultIdPrefix: string;
    supportedOn: readonly PlaytestTarget[];
    triviality: "not-applicable" | "reject-initial-value";
}
declare const PLAYTEST_ASSERTION_REGISTRY: readonly IPlaytestAssertionSchemaEntry[];
interface IPlaytestSetupSchemaEntry {
    description: string;
    kind: keyof NonNullable<IPlaytestScenario["setup"]>;
    requiredCapabilities: readonly PlaytestCapability[];
}
declare const PLAYTEST_SETUP_REGISTRY: readonly IPlaytestSetupSchemaEntry[];
declare function requiredPlaytestCapabilities(scenario: IPlaytestScenario): PlaytestCapability[];
interface IPlaytestDiagnostic {
    artifactPath?: string;
    code: string;
    exportName?: string;
    gate?: "waived-headless";
    message: string;
    modulePath?: string;
    observedRuntimePath?: string;
    path?: string;
    resourceId?: string;
    severity: "error" | "warning";
    sourcePath?: string;
    suggestion?: string;
    systemId?: string;
}
interface IPlaytestAssertionResult {
    details?: Record<string, unknown>;
    id: string;
    pass: boolean;
}
interface IPlaytestObservations {
    animation?: unknown;
    components?: Record<string, Record<string, {
        after?: unknown;
        before?: unknown;
    }>>;
    componentSeries?: Array<{
        label: string;
        snapshots: Record<string, Record<string, unknown>>;
        tick: number;
    }>;
    console: Array<{
        text: string;
        type: string;
    }>;
    contacts?: unknown;
    debugColliderCount?: number;
    effectLog?: unknown;
    effectLogSeries?: Array<{
        label: string;
        snapshot: unknown;
        tick: number;
    }>;
    entityTransforms?: Record<string, {
        halfExtents?: Vec3;
        position?: Vec3;
        scale?: Vec3;
    }>;
    hud: Record<string, {
        after?: unknown;
        before?: unknown;
    }>;
    overlayNodes?: Record<string, {
        after?: unknown;
        before?: unknown;
    }>;
    network: Array<{
        method: string;
        url: string;
    }>;
    physicsDebug?: unknown;
    physicsDebugSeries?: Array<{
        label: string;
        snapshot: unknown;
        tick: number;
    }>;
    resources: Record<string, {
        after?: unknown;
        before?: unknown;
    }>;
    resourceSeries?: Array<{
        label: string;
        snapshots: Record<string, unknown>;
        tick: number;
    }>;
    runtimeObservations?: unknown;
    runtimeDiagnostics?: unknown;
    signals?: unknown[];
    signalSeries?: Array<{
        label: string;
        signals: unknown[];
        tick: number;
    }>;
    visibility?: Record<string, unknown>;
    visual?: {
        changedPixelRatio?: number;
        comparisonSource?: string;
        nonblankRegions?: Array<{
            darkPixelRatio?: number;
            height: number;
            nonblankPixelRatio: number;
            width: number;
            x: number;
            y: number;
        }>;
        runtimeDiagnosticsSeries?: unknown[];
    };
}
declare function evaluateRichPlaytestAssertions(input: {
    report: IPlaytestReport;
    scenario: IPlaytestScenario;
}): {
    assertions: IPlaytestAssertionResult[];
    diagnostics: IPlaytestDiagnostic[];
};
declare function overlayNodeObservationKey(overlayId: string, selector: string): string;

type PlaytestDiagnosticCode = "TN_PLAYTEST_BRIDGE_INCOMPATIBLE" | "TN_PLAYTEST_BRIDGE_CAPABILITY_UNKNOWN" | "TN_PLAYTEST_BRIDGE_MISSING" | "TN_PLAYTEST_BRIDGE_NOT_READY" | "TN_PLAYTEST_CAPABILITY_MISSING" | "TN_PLAYTEST_DEVICE_FAILED" | "TN_PLAYTEST_OBSERVATION_UNAVAILABLE" | "TN_PLAYTEST_OPERATION_TIMEOUT" | "TN_PLAYTEST_PAYLOAD_TOO_LARGE" | "TN_PLAYTEST_SERVER_FAILED" | "TN_PLAYTEST_UNSUPPORTED_ON_TARGET";
interface IPlaytestProtocolDiagnostic {
    capability?: string;
    code: PlaytestDiagnosticCode;
    fix: {
        instruction: string;
        nextCommand?: string;
    };
    message: string;
    path?: string;
    severity: "error";
}
declare function playtestDiagnostic(code: PlaytestDiagnosticCode, message: string, instruction: string, details?: Pick<IPlaytestProtocolDiagnostic, "capability" | "path"> & {
    nextCommand?: string;
}): IPlaytestProtocolDiagnostic;

export { applyScenarioOverrides as $, type IPlaytestScenarioAssertions as A, type IPlaytestScenarioDiagnostic as B, type IPlaytestScenarioSetup as C, type IPlaytestSettledAssertion as D, type IPlaytestSetupEntityTransform as E, type IPlaytestSetupResource as F, type IPlaytestSetupSchemaEntry as G, type IPlaytestSignalAssertion as H, type IPlaytestAerodynamicsAssertion as I, type IPlaytestStateAssertion as J, type IPlaytestStep as K, type IPlaytestTagCountAssertion as L, type IPlaytestTransformSample as M, type IPlaytestViewport as N, type IPlaytestVisibilityAssertion as O, type IPlaytestVisualAssertion as P, type IPlaytestWorldAssertion as Q, type IPlaytestWorldRuntimeAssertion as R, PLAYTEST_ASSERTION_REGISTRY as S, PLAYTEST_CAPABILITY_REGISTRY as T, PLAYTEST_SETUP_REGISTRY as U, type PlaytestCapability as V, type PlaytestDiagnosticCode as W, type PlaytestInputDelivery as X, PlaytestScenarioError as Y, type PlaytestTarget as Z, type PlaytestVec3 as _, type IPlaytestAnimationAssertion as a, evaluateRichPlaytestAssertions as a0, invalidScenario as a1, loadPlaytestScenario as a2, missingPlaytestCapabilities as a3, oneShotScenario as a4, overlayNodeObservationKey as a5, parsePlaytestTarget as a6, parseViewport as a7, playtestDiagnostic as a8, playtestStepHoldTicks as a9, playtestStepWaitTicks as aa, rejectUnknownKeys as ab, requiredPlaytestCapabilities as ac, unknownPlaytestCapabilities as ad, type IPlaytestArtifactRequest as b, type IPlaytestAssertionResult as c, type IPlaytestAssertionSchemaEntry as d, type IPlaytestAssertionSchemaField as e, type IPlaytestCameraAssertion as f, type IPlaytestCapabilityDescriptor as g, type IPlaytestComponentAssertion as h, type IPlaytestContactAssertion as i, type IPlaytestDiagnostic as j, type IPlaytestDiagnosticsAssertion as k, type IPlaytestFollowReport as l, type IPlaytestMovementAssertion as m, type IPlaytestObservations as n, type IPlaytestOccludedAssertion as o, type IPlaytestOverlayNodeAssertion as p, type IPlaytestParityConfig as q, type IPlaytestPathAssertion as r, type IPlaytestProtocolDiagnostic as s, type IPlaytestReachabilityAssertion as t, type IPlaytestReport as u, type IPlaytestResourceAnyOfAssertion as v, type IPlaytestResourceAssertion as w, type IPlaytestResourcePathAlternative as x, type IPlaytestResourcePathAssertion as y, type IPlaytestScenario as z };
