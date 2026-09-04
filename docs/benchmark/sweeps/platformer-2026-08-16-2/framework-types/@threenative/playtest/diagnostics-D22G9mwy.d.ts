type PlaytestCapability = "browser.canvas" | "browser.console" | "browser.dom" | "browser.input" | "browser.network" | "browser.screenshot" | "browser.trace" | "camera.observe" | "entity.bounds" | "entity.observe" | "entity.setup" | "runtime.animation" | "runtime.audio" | "runtime.components" | "runtime.contacts" | "runtime.diagnostics" | "runtime.events" | "runtime.fixedStep" | "runtime.physics" | "runtime.performance" | "runtime.resources" | "runtime.state" | "runtime.tags" | "runtime.ui" | "runtime.world";
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
interface IPlaytestDiagnosticsPolicy {
    consoleErrorsOptOutReason?: string;
    networkErrorsOptOutReason?: string;
    noConsoleErrors: boolean;
    noNetworkErrors: boolean;
    noRuntimeDiagnostics: boolean;
    runtimeReady?: boolean;
    runtimeDiagnosticsOptOutReason?: string;
}
interface IPlaytestCaptureProvenance {
    adapter: Record<string, string>;
    browserArgs: readonly string[];
    captureMethod: "page.screenshot";
    rendererKind: "webgl" | "webgpu";
    target: string;
    viewport: IPlaytestViewport$1;
}
interface IPlaytestViewport$1 {
    height: number;
    width: number;
}
interface IPlaytestReport {
    after?: IPlaytestTransformSample;
    assertionResults?: IPlaytestAssertionResult[];
    before?: IPlaytestTransformSample;
    capture?: IPlaytestCaptureProvenance;
    diagnostics: IPlaytestDiagnostic[];
    diagnosticsPolicy?: IPlaytestDiagnosticsPolicy;
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
interface IPlaytestPointer {
    buttons?: number;
    id: number;
    x: number;
    y: number;
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
    /** The complete held-pointer set for this step, in arrival order. */
    pointers?: readonly IPlaytestPointer[];
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
    entity?: string;
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
    entity?: string;
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
    consoleErrorsOptOutReason?: string;
    networkErrorsOptOutReason?: string;
    runtimeDiagnosticsOptOutReason?: string;
    runtimeReady?: boolean;
}
interface IPlaytestPerformanceAssertion {
    maxDrawCalls?: number;
    maxFrameMsP95?: number;
    maxTriangles?: number;
}
interface IPlaytestFramebufferCoverageAssertion {
    backdrop: [number, number, number];
    grid?: {
        columns: number;
        rows: number;
    };
    tolerance: number;
    window: {
        endStep: string;
        startStep: string;
    };
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
    framebufferCoverage?: IPlaytestFramebufferCoverageAssertion;
    hud?: IPlaytestPathAssertion[];
    movement?: IPlaytestMovementAssertion;
    occluded?: IPlaytestOccludedAssertion[];
    overlayNodes?: IPlaytestOverlayNodeAssertion[];
    performance?: IPlaytestPerformanceAssertion;
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
        source?: "browser-console" | "page-error" | "unhandled-rejection";
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
    framebufferCoverage?: IPlaytestFramebufferCoverageObservation;
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
    performanceSeries?: unknown[];
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
        captureFailure?: {
            code: "TN_CAPTURE_BLANK";
            label: string;
            reason: string;
        };
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
        /** Visual frame observations only; performance samples live in performanceSeries. */
        runtimeDiagnosticsSeries?: unknown[];
    };
}
declare function resolveDiagnosticsPolicy(policy: IPlaytestDiagnosticsAssertion | undefined): IPlaytestDiagnosticsPolicy;
interface IPlaytestFramebufferCoverageObservation {
    boundarySource: "scenario-steps" | "video-backdrop-dominance";
    firstViolation?: {
        frameIndex: number;
        grid: {
            columns: number;
            rows: number;
            samples: Array<[number, number, number]>;
        };
        screenshotPath: string;
    };
    frameCount: number;
    unreadableReason?: string;
    windowCompleted: boolean;
    windowStarted: boolean;
}
declare function evaluateRichPlaytestAssertions(input: {
    report: IPlaytestReport;
    scenario: IPlaytestScenario;
}): {
    assertions: IPlaytestAssertionResult[];
    diagnostics: IPlaytestDiagnostic[];
};

type PlaytestDiagnosticCode = "TN_PLAYTEST_BRIDGE_INCOMPATIBLE" | "TN_PLAYTEST_BRIDGE_CAPABILITY_UNKNOWN" | "TN_PLAYTEST_BRIDGE_MISSING" | "TN_PLAYTEST_BRIDGE_NOT_READY" | "TN_PLAYTEST_CAPTURE_PROVENANCE_MISSING" | "TN_PLAYTEST_CAPABILITY_MISSING" | "TN_PLAYTEST_DEVICE_FAILED" | "TN_PLAYTEST_OBSERVATION_UNAVAILABLE" | "TN_PLAYTEST_OPERATION_TIMEOUT" | "TN_PLAYTEST_PAGE_CRASHED" | "TN_PLAYTEST_PAGE_NAVIGATED" | "TN_PLAYTEST_PAYLOAD_TOO_LARGE" | "TN_PLAYTEST_SERVER_FAILED" | "TN_PLAYTEST_UNSUPPORTED_ON_TARGET";
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

export { requiredPlaytestCapabilities as A, resolveDiagnosticsPolicy as B, unknownPlaytestCapabilities as C, type IPlaytestAssertionResult as I, PLAYTEST_ASSERTION_REGISTRY as P, type IPlaytestCaptureProvenance as a, type IPlaytestDiagnostic as b, type IPlaytestDiagnosticsPolicy as c, type IPlaytestFramebufferCoverageAssertion as d, type IPlaytestFramebufferCoverageObservation as e, type IPlaytestObservations as f, type IPlaytestPathAssertion as g, type IPlaytestPerformanceAssertion as h, type IPlaytestPointer as i, type IPlaytestProtocolDiagnostic as j, type IPlaytestReport as k, type IPlaytestScenario as l, type IPlaytestSignalAssertion as m, type IPlaytestStep as n, type IPlaytestWorldRuntimeAssertion as o, PLAYTEST_CAPABILITY_REGISTRY as p, PlaytestScenarioError as q, type PlaytestVec3 as r, evaluateRichPlaytestAssertions as s, invalidScenario as t, loadPlaytestScenario as u, missingPlaytestCapabilities as v, playtestDiagnostic as w, playtestStepHoldTicks as x, playtestStepWaitTicks as y, rejectUnknownKeys as z };
