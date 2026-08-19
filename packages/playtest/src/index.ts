/**
 * Validate and inspect playtest capability declarations.
 * @situation check whether a scenario's required capabilities are installed
 * @situation report unknown or missing playtest capabilities
 * @example const missing = missingPlaytestCapabilities(required, available);
 */
export {
  PLAYTEST_CAPABILITY_REGISTRY,
  missingPlaytestCapabilities,
  unknownPlaytestCapabilities,
} from "./capabilities.js";
/**
 * Evaluate rich semantic assertions against captured observations.
 * @situation assert movement, visibility, or diagnostics in a playtest
 * @situation turn a scenario observation into a pass or failure
 * @constraint malformed or empty assertions fail closed
 * @example const result = evaluateRichPlaytestAssertions(input);
 */
export {
  PLAYTEST_ASSERTION_REGISTRY,
  evaluateRichPlaytestAssertions,
  resolveDiagnosticsPolicy,
  requiredPlaytestCapabilities,
} from "./assertions.js";
export type {
  IPlaytestAssertionResult,
  IPlaytestDiagnostic,
  IPlaytestFramebufferCoverageObservation,
  IPlaytestObservations,
} from "./assertions.js";
/**
 * Create a structured playtest diagnostic.
 * @situation report a named runtime diagnostic to a scenario
 * @situation explain why a playtest assertion cannot pass
 * @example playtestDiagnostic("physics", "body missing");
 */
export { playtestDiagnostic } from "./diagnostics.js";
export type { IPlaytestProtocolDiagnostic } from "./diagnostics.js";
/**
 * Validate JSON-safe bridge messages and protocol sizes.
 * @situation send a safe observation over the playtest bridge
 * @situation reject an oversized or cyclic playtest payload
 * @constraint bridge values must be JSON-shaped
 * @example assertJsonSafe({ score: 10 });
 */
export {
  PLAYTEST_BRIDGE_GLOBAL,
  PLAYTEST_PROTOCOL_LIMITS,
  PLAYTEST_PROTOCOL_VERSION,
  assertJsonSafe,
  jsonByteLength,
} from "./protocol.js";
export type {
  IPlaytestBridgeDescription,
  IPlaytestBridgeV1,
  IPlaytestContactObservation,
  IPlaytestDeviceRequest,
  IPlaytestDeviceResponse,
  IPlaytestGameplayObservation,
  IPlaytestObservationSnapshot,
  IPlaytestPerformanceObservation,
  IPlaytestRuntimeDiagnosticsSample,
  IPlaytestSampleRequest,
  IPlaytestSetupRequest,
  IPlaytestWorldObservation,
  IPlaytestWorldRuntimeObservation,
  JsonValue,
} from "./protocol.js";
/**
 * Parse a recorded playtest replay into a validated recording.
 * @situation load recorded input for deterministic playback
 * @situation validate a replay fixture before running it
 * @constraint malformed recordings throw instead of becoming empty input
 * @example const recording = parseReplayRecording(rawRecording);
 */
export { parseReplayRecording } from "./replay.js";
export type { IReplayRecording, IReplayRecordingSample, ReplayPointer } from "./replay.js";
export type {
  IPlaytestCaptureProvenance,
  IPlaytestDiagnosticsPolicy,
  IPlaytestReport,
  IPlaytestTrivialityOptOut,
  PlaytestVec3,
} from "./report.js";
/**
 * Load and validate a scenario, then control its tick steps.
 * @situation create a browser or device playtest scenario
 * @situation wait or hold a game for a deterministic number of ticks
 * @constraint unknown scenario keys fail closed
 * @example const scenario = await loadPlaytestScenario(project, file);
 */
export {
  PlaytestScenarioError,
  invalidScenario,
  loadPlaytestScenario,
  playtestStepHoldTicks,
  playtestStepWaitTicks,
  rejectUnknownKeys,
} from "./scenario.js";
export type {
  IPlaytestArtifactRequest,
  IPlaytestPathAssertion,
  IPlaytestFramebufferCoverageAssertion,
  IPlaytestPerformanceAssertion,
  IPlaytestPointer,
  IPlaytestScenario,
  IPlaytestSignalAssertion,
  IPlaytestStep,
  IPlaytestWorldRuntimeAssertion,
} from "./scenario.js";
