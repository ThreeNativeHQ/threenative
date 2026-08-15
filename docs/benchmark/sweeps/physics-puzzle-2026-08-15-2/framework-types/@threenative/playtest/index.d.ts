export { I as IPlaytestAssertionResult, a as IPlaytestDiagnostic, b as IPlaytestFramebufferCoverageAssertion, c as IPlaytestFramebufferCoverageObservation, d as IPlaytestObservations, e as IPlaytestPathAssertion, f as IPlaytestPerformanceAssertion, g as IPlaytestPointer, h as IPlaytestProtocolDiagnostic, i as IPlaytestReport, j as IPlaytestScenario, k as IPlaytestSignalAssertion, l as IPlaytestStep, m as IPlaytestWorldRuntimeAssertion, P as PLAYTEST_ASSERTION_REGISTRY, n as PLAYTEST_CAPABILITY_REGISTRY, o as PlaytestScenarioError, p as PlaytestVec3, q as evaluateRichPlaytestAssertions, r as invalidScenario, s as loadPlaytestScenario, t as missingPlaytestCapabilities, u as playtestDiagnostic, v as playtestStepHoldTicks, w as playtestStepWaitTicks, x as rejectUnknownKeys, y as requiredPlaytestCapabilities, z as unknownPlaytestCapabilities } from './diagnostics-D_s5XC8t.js';
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
