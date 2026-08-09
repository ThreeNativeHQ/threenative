export { I as IPlaytestAerodynamicsAssertion, a as IPlaytestAnimationAssertion, b as IPlaytestArtifactRequest, c as IPlaytestAssertionResult, d as IPlaytestAssertionSchemaEntry, e as IPlaytestAssertionSchemaField, f as IPlaytestCameraAssertion, g as IPlaytestCapabilityDescriptor, h as IPlaytestComponentAssertion, i as IPlaytestContactAssertion, j as IPlaytestDiagnostic, k as IPlaytestDiagnosticsAssertion, l as IPlaytestFollowReport, m as IPlaytestMovementAssertion, n as IPlaytestObservations, o as IPlaytestOccludedAssertion, p as IPlaytestOverlayNodeAssertion, q as IPlaytestParityConfig, r as IPlaytestPathAssertion, s as IPlaytestProtocolDiagnostic, t as IPlaytestReachabilityAssertion, u as IPlaytestReport, v as IPlaytestResourceAnyOfAssertion, w as IPlaytestResourceAssertion, x as IPlaytestResourcePathAlternative, y as IPlaytestResourcePathAssertion, z as IPlaytestScenario, A as IPlaytestScenarioAssertions, B as IPlaytestScenarioDiagnostic, C as IPlaytestScenarioSetup, D as IPlaytestSettledAssertion, E as IPlaytestSetupEntityTransform, F as IPlaytestSetupResource, G as IPlaytestSetupSchemaEntry, H as IPlaytestSignalAssertion, J as IPlaytestStateAssertion, K as IPlaytestStep, L as IPlaytestTagCountAssertion, M as IPlaytestTransformSample, N as IPlaytestViewport, O as IPlaytestVisibilityAssertion, P as IPlaytestVisualAssertion, Q as IPlaytestWorldAssertion, R as IPlaytestWorldRuntimeAssertion, S as PLAYTEST_ASSERTION_REGISTRY, T as PLAYTEST_CAPABILITY_REGISTRY, U as PLAYTEST_SETUP_REGISTRY, V as PlaytestCapability, W as PlaytestDiagnosticCode, X as PlaytestInputDelivery, Y as PlaytestScenarioError, Z as PlaytestTarget, _ as PlaytestVec3, $ as applyScenarioOverrides, a0 as evaluateRichPlaytestAssertions, a1 as invalidScenario, a2 as loadPlaytestScenario, a3 as missingPlaytestCapabilities, a4 as oneShotScenario, a5 as overlayNodeObservationKey, a6 as parsePlaytestTarget, a7 as parseViewport, a8 as playtestDiagnostic, a9 as playtestStepHoldTicks, aa as playtestStepWaitTicks, ab as rejectUnknownKeys, ac as requiredPlaytestCapabilities, ad as unknownPlaytestCapabilities } from './diagnostics-Ckm_5lrw.js';
export { I as IPlaytestAdvanceResult, a as IPlaytestAnimationObservation, b as IPlaytestBridgeDescription, c as IPlaytestBridgeHost, d as IPlaytestBridgeReady, e as IPlaytestBridgeV1, f as IPlaytestContactObservation, g as IPlaytestDeviceRequest, h as IPlaytestDeviceResponse, i as IPlaytestEntityObservation, j as IPlaytestEntityTransform, k as IPlaytestGameplayObservation, l as IPlaytestObservationSnapshot, m as IPlaytestSampleRequest, n as IPlaytestSetupRequest, o as IPlaytestTagObservation, p as IPlaytestWorldObservation, q as IPlaytestWorldRuntimeObservation, J as JsonPrimitive, r as JsonValue, P as PLAYTEST_BRIDGE_GLOBAL, s as PLAYTEST_PROTOCOL_LIMITS, t as PLAYTEST_PROTOCOL_VERSION, u as PlaytestClockMode, v as assertJsonSafe, w as jsonByteLength } from './protocol-CeC1lz_G.js';

type ReplayPointer = readonly [number, number, number, number, number];
interface IReplayRecordingSample {
    readonly keys: readonly string[];
    readonly pointer?: ReplayPointer;
    readonly tick: number;
}
interface IReplayRecording {
    readonly input: readonly IReplayRecordingSample[];
    readonly randomState: number;
    readonly runtime: {
        agent: string;
        core: string;
        rapier: string | null;
        step: number;
    };
    readonly seed: number;
    readonly ticks: number;
    readonly version: 1;
}
declare function parseReplayRecording(value: unknown): IReplayRecording;

export { type IReplayRecording, type IReplayRecordingSample, type ReplayPointer, parseReplayRecording };
