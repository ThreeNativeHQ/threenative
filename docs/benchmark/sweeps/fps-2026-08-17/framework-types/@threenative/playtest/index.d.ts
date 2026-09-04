export { I as IPlaytestArtifactRequest, a as IPlaytestAssertionResult, b as IPlaytestCaptureProvenance, c as IPlaytestDiagnostic, d as IPlaytestDiagnosticsPolicy, e as IPlaytestFramebufferCoverageAssertion, f as IPlaytestFramebufferCoverageObservation, g as IPlaytestObservations, h as IPlaytestPathAssertion, i as IPlaytestPerformanceAssertion, j as IPlaytestPointer, k as IPlaytestProtocolDiagnostic, l as IPlaytestReport, m as IPlaytestScenario, n as IPlaytestSignalAssertion, o as IPlaytestStep, p as IPlaytestWorldRuntimeAssertion, P as PLAYTEST_ASSERTION_REGISTRY, q as PLAYTEST_CAPABILITY_REGISTRY, r as PlaytestScenarioError, s as PlaytestVec3, t as evaluateRichPlaytestAssertions, u as invalidScenario, v as loadPlaytestScenario, w as missingPlaytestCapabilities, x as playtestDiagnostic, y as playtestStepHoldTicks, z as playtestStepWaitTicks, A as rejectUnknownKeys, B as requiredPlaytestCapabilities, C as resolveDiagnosticsPolicy, D as unknownPlaytestCapabilities } from './diagnostics-CnH0EfqA.js';
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
