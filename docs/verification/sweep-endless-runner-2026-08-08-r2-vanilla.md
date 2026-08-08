# Genre sweep ledger — endless-runner — 2026-08-08 — vanilla Three.js

Genre: endless-runner
Round: 2
Brief SHA-256: 21a0d1035d21b0520da448104271118570528cf5416d33e8ceed64efeb6326ec
Arm: vanilla
Proof result: 1/1
Proof SHA-256: 4e985122c5fdd62a5b8d36c2acc7d1a6c7d0b49aa1583f47dbf721c5c46764db
Template: starter
Archive: docs/benchmark/sweeps/endless-runner-2026-08-08-6
Framework version: 0.1.0
Starter source LOC: 0
Starter lines survived: 0
User source LOC: 401
Authored LOC: 401
Authored bytes: 16610
Source files: 2
Framework files: 1
Three-only files: 0
Reach rate: 0.5
Used exports: installThreePlaytestBridge
Unused exports: IPlaytestAdvanceResult, IPlaytestAerodynamicsAssertion, IPlaytestAnimationAssertion, IPlaytestAnimationObservation, IPlaytestArtifactRequest, IPlaytestAssertionResult, IPlaytestAssertionSchemaEntry, IPlaytestAssertionSchemaField, IPlaytestBridgeClient, IPlaytestBridgeDescription, IPlaytestBridgeHost, IPlaytestBridgeReady, IPlaytestBridgeV1, IPlaytestCameraAssertion, IPlaytestCapabilityDescriptor, IPlaytestComponentAssertion, IPlaytestContactAssertion, IPlaytestContactObservation, IPlaytestDiagnostic, IPlaytestDiagnosticsAssertion, IPlaytestEntityObservation, IPlaytestEntityTransform, IPlaytestFollowReport, IPlaytestGameplayObservation, IPlaytestMovementAssertion, IPlaytestObservationSnapshot, IPlaytestObservations, IPlaytestOccludedAssertion, IPlaytestOverlayNodeAssertion, IPlaytestParityConfig, IPlaytestPathAssertion, IPlaytestProtocolDiagnostic, IPlaytestReachabilityAssertion, IPlaytestReport, IPlaytestResourceAnyOfAssertion, IPlaytestResourceAssertion, IPlaytestResourcePathAlternative, IPlaytestResourcePathAssertion, IPlaytestSampleRequest, IPlaytestScenario, IPlaytestScenarioAssertions, IPlaytestScenarioDiagnostic, IPlaytestScenarioSetup, IPlaytestServerConfig, IPlaytestSettledAssertion, IPlaytestSetupEntityTransform, IPlaytestSetupRequest, IPlaytestSetupResource, IPlaytestSetupSchemaEntry, IPlaytestStateAssertion, IPlaytestStep, IPlaytestTagCountAssertion, IPlaytestTagObservation, IPlaytestTransformSample, IPlaytestViewport, IPlaytestVisibilityAssertion, IPlaytestVisualAssertion, IPlaytestWorldAssertion, IStandalonePlaytestConfig, IStandalonePlaytestReport, IThreeObservationInput, IThreePlaytestBridgeInstallation, IThreePlaytestBridgeOptions, IThreePlaytestEntity, IThreePlaytestResources, JsonPrimitive, JsonValue, PLAYTEST_ASSERTION_REGISTRY, PLAYTEST_BRIDGE_GLOBAL, PLAYTEST_CAPABILITY_REGISTRY, PLAYTEST_PROTOCOL_LIMITS, PLAYTEST_PROTOCOL_VERSION, PLAYTEST_SETUP_REGISTRY, PlaytestBridgeError, PlaytestCapability, PlaytestClockMode, PlaytestDiagnosticCode, PlaytestInputDelivery, PlaytestScenarioError, PlaytestTarget, PlaytestVec3, ThreePlaytestEntityRegistry, ThreePlaytestRenderer, applyScenarioOverrides, assertJsonSafe, buildReport, connectPlaytestBridge, evaluateRichPlaytestAssertions, initStandalonePlaytest, jsonByteLength, loadPlaytestScenario, missingPlaytestCapabilities, objectPath, oneShotScenario, overlayNodeObservationKey, parsePlaytestTarget, parseStandalonePlaytestArgs, parseViewport, playtestDiagnostic, playtestStepHoldTicks, playtestStepWaitTicks, requiredPlaytestCapabilities, runStandalonePlaytest, sampleThreeObservations, unknownPlaytestCapabilities
Measurement command: `pnpm sweep:measure docs/benchmark/sweeps/endless-runner-2026-08-08-6`
First game-code tool call: direct vanilla sandbox build; tool-call count not recorded
Visual result: PASS — active headed capture passed the frame guard; blind polish tie at 3.4/5
Blind polish: vanilla behavior 4, visuals 4, effects 3, particles 2, audio na, UX 4; average 3.4
Replay intent: yes — the run remains active with visible lane, jump, score, distance, speed, and restart cues

## Paired proof

`pnpm sweep:pair docs/benchmark/sweeps/endless-runner-2026-08-08-11 docs/benchmark/sweeps/endless-runner-2026-08-08-6` passed both sealed proofs at `1/1`. The vanilla Three.js arm used 401 authored LOC from an empty source tree; the framework arm used 843 authored LOC above a 788-LOC starter. The fair framework-minus-vanilla delta is **+442 LOC / +11,466 bytes**.

The blind image bundle is [blind-endless-runner-2026-08-08-webgl](blind-endless-runner-2026-08-08-webgl/bundle.json); its reveal remains outside the bundle. The judge accepted the v2 rubric and returned a tie. This one genre is evidence, not a consistency claim.

## Friction ledger

| API or surface | What blocked the build | Workaround | Evidence |
| --- | --- | --- | --- |
| None | No plain Three.js blocker prevented the sealed proof or active capture. | None beyond the shared playtest bridge. | `docs/benchmark/sweeps/endless-runner-2026-08-08-6/proof.json` and its guarded captures. |
