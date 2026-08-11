export { I as IPlaytestAssertionResult, a as IPlaytestDiagnostic, b as IPlaytestObservations, c as IPlaytestPathAssertion, d as IPlaytestPointer, e as IPlaytestProtocolDiagnostic, f as IPlaytestReport, g as IPlaytestScenario, h as IPlaytestSignalAssertion, i as IPlaytestStep, j as IPlaytestWorldRuntimeAssertion, P as PLAYTEST_ASSERTION_REGISTRY, k as PLAYTEST_CAPABILITY_REGISTRY, l as PlaytestScenarioError, m as PlaytestVec3, n as evaluateRichPlaytestAssertions, o as invalidScenario, p as loadPlaytestScenario, q as missingPlaytestCapabilities, r as playtestDiagnostic, s as playtestStepHoldTicks, t as playtestStepWaitTicks, u as rejectUnknownKeys, v as requiredPlaytestCapabilities, w as unknownPlaytestCapabilities } from './diagnostics-6B0q3Qcj.js';
export { I as IPlaytestBridgeDescription, a as IPlaytestBridgeV1, b as IPlaytestContactObservation, c as IPlaytestDeviceRequest, d as IPlaytestDeviceResponse, e as IPlaytestGameplayObservation, f as IPlaytestObservationSnapshot, g as IPlaytestSampleRequest, h as IPlaytestSetupRequest, i as IPlaytestWorldObservation, j as IPlaytestWorldRuntimeObservation, J as JsonValue, P as PLAYTEST_BRIDGE_GLOBAL, k as PLAYTEST_PROTOCOL_LIMITS, l as PLAYTEST_PROTOCOL_VERSION, m as assertJsonSafe, n as jsonByteLength } from './protocol-C93FOGyC.js';

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
