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
  requiredPlaytestCapabilities,
} from "./assertion-schema.js";
/**
 * Evaluate rich semantic assertions against captured observations.
 * @situation assert movement, visibility, or diagnostics in a playtest
 * @situation turn a scenario observation into a pass or failure
 * @constraint malformed or empty assertions fail closed
 * @example const result = evaluateRichPlaytestAssertions(input);
 */
export { evaluateRichPlaytestAssertions } from "./assertion-evaluators.js";
/**
 * Resolve the effective diagnostics policy for a run, with fail-closed defaults applied.
 * @situation judge captured console, network, or runtime diagnostics for a playtest
 * @constraint absent policy fields default to rejecting errors
 * @example const policy = resolveDiagnosticsPolicy(scenario.assert?.diagnostics);
 */
export { resolveDiagnosticsPolicy } from "./assertion-report.js";
export type {
  IPlaytestAssertionResult,
  IPlaytestDiagnostic,
  IPlaytestFramebufferCoverageObservation,
  IPlaytestObservations,
} from "./assertion-report.js";
/**
 * Measure and judge device thermal, power and battery state around a device playtest run.
 * @situation find out whether an Android run was throttled or started hot
 * @situation read battery temperature, current draw or per-rail power for a run
 * @constraint a reading the device does not expose reports unavailable, never zero
 * @constraint a run that started hot or whose thermal status rose is flagged as confounded
 * @example const verdict = summarizeDeviceMetrics(observation.samples);
 */
export {
  DEVICE_METRICS_CADENCE_MS,
  DEVICE_METRICS_MAX_SAMPLES,
  DeviceMetricsError,
  DeviceMetricsRecorder,
  HOT_START_TEMPERATURE_C,
  parseDeviceBattery,
  parseDeviceCurrent,
  parseDevicePowerRails,
  parseDeviceThermal,
  summarizeDeviceMetrics,
} from "./runner/deviceMetrics.js";
export type {
  IPlaytestDeviceBattery,
  IPlaytestDeviceMetricsObservation,
  IPlaytestDeviceMetricsSample,
  IPlaytestDeviceMetricsVerdict,
  IPlaytestDeviceThermal,
  PlaytestDeviceMeasurement,
  PlaytestDevicePowerRails,
} from "./runner/deviceMetrics.js";
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
  PLAYTEST_FROZEN_MARKER,
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
  IPlaytestRenderChainObservation,
  IPlaytestRuntimeDiagnosticsSample,
  IPlaytestSampleRequest,
  IPlaytestSetupRequest,
  IPlaytestWorldObservation,
  IPlaytestWorldRuntimeObservation,
  JsonValue,
} from "./protocol.js";
// The replay wire protocol moved to @threenative/core (PRD-181); playtest no longer ships
// its own copy. Import it from `@threenative/core` if a harness needs the parser.
export type {
  IPlaytestCaptureProvenance,
  IPlaytestDiagnosticsPolicy,
  IPlaytestReport,
  IPlaytestSetupApplication,
  IPlaytestSetupRecord,
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
  IPlaytestRenderChainAssertion,
  IPlaytestPointer,
  IPlaytestScenario,
  IPlaytestSignalAssertion,
  IPlaytestStep,
  IPlaytestWheel,
  IPlaytestWorldRuntimeAssertion,
} from "./scenario.js";
