export { I as IPlaytestAssertionResult, a as IPlaytestCaptureProvenance, b as IPlaytestDiagnostic, c as IPlaytestDiagnosticsPolicy, d as IPlaytestFramebufferCoverageAssertion, e as IPlaytestFramebufferCoverageObservation, f as IPlaytestObservations, g as IPlaytestPathAssertion, h as IPlaytestPerformanceAssertion, i as IPlaytestPointer, j as IPlaytestProtocolDiagnostic, k as IPlaytestReport, l as IPlaytestScenario, m as IPlaytestSignalAssertion, n as IPlaytestStep, o as IPlaytestWorldRuntimeAssertion, P as PLAYTEST_ASSERTION_REGISTRY, p as PLAYTEST_CAPABILITY_REGISTRY, q as PlaytestScenarioError, r as PlaytestVec3, s as evaluateRichPlaytestAssertions, t as invalidScenario, u as loadPlaytestScenario, v as missingPlaytestCapabilities, w as playtestDiagnostic, x as playtestStepHoldTicks, y as playtestStepWaitTicks, z as rejectUnknownKeys, A as requiredPlaytestCapabilities, B as resolveDiagnosticsPolicy, C as unknownPlaytestCapabilities } from './diagnostics-D22G9mwy.js';
export { I as IPlaytestBridgeDescription, a as IPlaytestBridgeV1, b as IPlaytestContactObservation, c as IPlaytestDeviceRequest, d as IPlaytestDeviceResponse, e as IPlaytestGameplayObservation, f as IPlaytestObservationSnapshot, g as IPlaytestPerformanceObservation, h as IPlaytestRuntimeDiagnosticsSample, i as IPlaytestSampleRequest, j as IPlaytestSetupRequest, k as IPlaytestWorldObservation, l as IPlaytestWorldRuntimeObservation, J as JsonValue, P as PLAYTEST_BRIDGE_GLOBAL, m as PLAYTEST_PROTOCOL_LIMITS, n as PLAYTEST_PROTOCOL_VERSION, o as assertJsonSafe, p as jsonByteLength } from './protocol-D0DV7Wxm.js';

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
