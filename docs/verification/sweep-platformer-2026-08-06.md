# Genre sweep ledger — platformer — 2026-08-06

Genre: platformer
Round: 2
Brief SHA-256: 8a7ee799256676d10fc7d22966e3e4fa93ed54c888fc91fd0f34fc3520ddd9fa
Arm: vanilla
Proof result: 2/2
Proof SHA-256: e4ba94e8c1ba0dd895f8074bcabd22c2f8273d219c958affc08eb5c5399d8cca
Template: starter
Archive: docs/benchmark/sweeps/platformer-2026-08-06
Framework version: 0.1.0
User source LOC: 149
Source files: 2
Framework files: 1
Three-only files: 0
Reach rate: 0.5
Used exports: installThreePlaytestBridge
Unused exports: IPlaytestAdvanceResult, IPlaytestAerodynamicsAssertion, IPlaytestAnimationAssertion, IPlaytestAnimationObservation, IPlaytestArtifactRequest, IPlaytestAssertionResult, IPlaytestAssertionSchemaEntry, IPlaytestAssertionSchemaField, IPlaytestBridgeClient, IPlaytestBridgeDescription, IPlaytestBridgeHost, IPlaytestBridgeReady, IPlaytestBridgeV1, IPlaytestCameraAssertion, IPlaytestCapabilityDescriptor, IPlaytestComponentAssertion, IPlaytestContactAssertion, IPlaytestContactObservation, IPlaytestDiagnostic, IPlaytestDiagnosticsAssertion, IPlaytestEntityObservation, IPlaytestEntityTransform, IPlaytestFollowReport, IPlaytestGameplayObservation, IPlaytestMovementAssertion, IPlaytestObservationSnapshot, IPlaytestObservations, IPlaytestOccludedAssertion, IPlaytestOverlayNodeAssertion, IPlaytestParityConfig, IPlaytestPathAssertion, IPlaytestProtocolDiagnostic, IPlaytestReachabilityAssertion, IPlaytestReport, IPlaytestSampleRequest, IPlaytestScenario, IPlaytestScenarioAssertions, IPlaytestScenarioDiagnostic, IPlaytestScenarioSetup, IPlaytestServerConfig, IPlaytestSettledAssertion, IPlaytestSetupEntityTransform, IPlaytestSetupRequest, IPlaytestSetupResource, IPlaytestSetupSchemaEntry, IPlaytestStateAssertion, IPlaytestStep, IPlaytestTagCountAssertion, IPlaytestTagObservation, IPlaytestTransformSample, IPlaytestViewport, IPlaytestVisibilityAssertion, IPlaytestVisualAssertion, IPlaytestWorldAssertion, IStandalonePlaytestConfig, IStandalonePlaytestReport, IThreeObservationInput, IThreePlaytestBridgeInstallation, IThreePlaytestBridgeOptions, IThreePlaytestEntity, IThreePlaytestResources, JsonPrimitive, JsonValue, PLAYTEST_ASSERTION_REGISTRY, PLAYTEST_BRIDGE_GLOBAL, PLAYTEST_CAPABILITY_REGISTRY, PLAYTEST_PROTOCOL_LIMITS, PLAYTEST_PROTOCOL_VERSION, PLAYTEST_SETUP_REGISTRY, PlaytestBridgeError, PlaytestCapability, PlaytestClockMode, PlaytestDiagnosticCode, PlaytestInputDelivery, PlaytestScenarioError, PlaytestTarget, PlaytestVec3, ThreePlaytestEntityRegistry, ThreePlaytestRenderer, applyScenarioOverrides, assertJsonSafe, buildReport, connectPlaytestBridge, evaluateRichPlaytestAssertions, initStandalonePlaytest, jsonByteLength, loadPlaytestScenario, missingPlaytestCapabilities, objectPath, oneShotScenario, overlayNodeObservationKey, parsePlaytestTarget, parseStandalonePlaytestArgs, parseViewport, playtestDiagnostic, playtestStepHoldTicks, playtestStepWaitTicks, requiredPlaytestCapabilities, runStandalonePlaytest, sampleThreeObservations, unknownPlaytestCapabilities
Measurement command: `pnpm sweep:measure docs/benchmark/sweeps/platformer-2026-08-06`
First game-code tool call: 1 (plain Three.js source)
Visual result: PASS — the real vanilla build passed the sealed jump/run proof 2/2 with zero console, network, and runtime diagnostics.

## Paired proof

`pnpm sweep:pair docs/benchmark/sweeps/platformer-2026-08-05-2 docs/benchmark/sweeps/platformer-2026-08-06` passed both arms 2/2 for the same brief and proof hash. The vanilla arm uses 149 user LOC across 2 source files; the framework arm uses 1073 user LOC across 18 source files.

## Friction ledger

| API or surface | What blocked the build | Workaround | Evidence |
| --- | --- | --- | --- |
| None | No plain Three.js blocker blocked the sealed proof. | None beyond installing the published playtest bridge. | `pnpm sweep:proof docs/benchmark/sweeps/platformer-2026-08-06` passed 2/2. |
