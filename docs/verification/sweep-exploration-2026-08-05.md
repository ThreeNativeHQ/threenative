# Genre sweep ledger — exploration — 2026-08-05

Genre: exploration
Round: 2
Brief SHA-256: e0eb67ef4568bece73a2db7bccdd4d7a1c4f85b08d7575e8df98790353603f39
Arm: framework
Proof result: 0/0 (not run; archived before PRD-019)
Proof SHA-256: 247110b609859c765de7dbb285c1609b57dc04c51cbec375735d004e5265a88a
Template: starter
Archive: docs/benchmark/sweeps/exploration-2026-08-05
Framework version: 0.1.0
User source LOC: 1140
Source files: 16
Framework files: 8
Three-only files: 6
Reach rate: 0.5
Used exports: CharacterBody3D, CollisionShape3D, Ctx, DebugOverlay, Game, GameCanvas, PhysicsContext, RigidBody3D, Scene, defineGame, playtest, rapier, useGameState
Unused exports: AnimationPlayOptions, AnimationPlayer, AnimationPlayerOptions, Area3D, Area3DOptions, AreaContact, AreaEvent, AreaHandler, AssetLoader, AssetLoaderOptions, AudioBus, AudioBusOptions, AudioPlayOptions, CharacterBody3DOptions, CollisionShapeKind, DebugSnapshot, Debuggable, EntitySnapshot, FixedStepLoop, FixedStepLoopOptions, GameCanvasProps, GameConfig, GamePlugin, GamePluginFunction, GamePluginHooks, GamePluginRuntime, GameStore, IPlaytestAdvanceResult, IPlaytestAerodynamicsAssertion, IPlaytestAnimationAssertion, IPlaytestAnimationObservation, IPlaytestArtifactRequest, IPlaytestAssertionResult, IPlaytestAssertionSchemaEntry, IPlaytestAssertionSchemaField, IPlaytestBridgeClient, IPlaytestBridgeDescription, IPlaytestBridgeHost, IPlaytestBridgeReady, IPlaytestBridgeV1, IPlaytestCameraAssertion, IPlaytestCapabilityDescriptor, IPlaytestComponentAssertion, IPlaytestContactAssertion, IPlaytestContactObservation, IPlaytestDiagnostic, IPlaytestDiagnosticsAssertion, IPlaytestEntityObservation, IPlaytestEntityTransform, IPlaytestFollowReport, IPlaytestGameplayObservation, IPlaytestMovementAssertion, IPlaytestObservationSnapshot, IPlaytestObservations, IPlaytestOccludedAssertion, IPlaytestOverlayNodeAssertion, IPlaytestParityConfig, IPlaytestPathAssertion, IPlaytestProtocolDiagnostic, IPlaytestReachabilityAssertion, IPlaytestReport, IPlaytestSampleRequest, IPlaytestScenario, IPlaytestScenarioAssertions, IPlaytestScenarioDiagnostic, IPlaytestScenarioSetup, IPlaytestServerConfig, IPlaytestSettledAssertion, IPlaytestSetupEntityTransform, IPlaytestSetupRequest, IPlaytestSetupResource, IPlaytestSetupSchemaEntry, IPlaytestStateAssertion, IPlaytestStep, IPlaytestTagCountAssertion, IPlaytestTagObservation, IPlaytestTransformSample, IPlaytestViewport, IPlaytestVisibilityAssertion, IPlaytestVisualAssertion, IPlaytestWorldAssertion, IStandalonePlaytestConfig, IStandalonePlaytestReport, IThreeObservationInput, IThreePlaytestBridgeInstallation, IThreePlaytestBridgeOptions, IThreePlaytestEntity, IThreePlaytestResources, InputAction, InputBindings, InputMap, JsonPrimitive, JsonValue, PLAYTEST_ASSERTION_REGISTRY, PLAYTEST_BRIDGE_GLOBAL, PLAYTEST_CAPABILITY_REGISTRY, PLAYTEST_PROTOCOL_LIMITS, PLAYTEST_PROTOCOL_VERSION, PLAYTEST_SETUP_REGISTRY, PhysicsBody3D, PhysicsOptions, PhysicsPlugin, PlaytestBridgeError, PlaytestCapability, PlaytestClockMode, PlaytestDiagnosticCode, PlaytestInputDelivery, PlaytestScenarioError, PlaytestTarget, PlaytestVec3, PluginCleanup, Random, RawInputState, Registry, RendererKind, RendererLike, RendererOptions, RigidBody3DOptions, RigidBodyType, SceneConstructor, ScheduleHandle, Scheduler, StatePatch, ThreePlaytestEntityRegistry, ThreePlaytestRenderer, applyScenarioOverrides, assertJsonSafe, autoFields, buildReport, connectPlaytestBridge, createAssetLoader, createGameStore, createRandom, createRenderer, evaluateRichPlaytestAssertions, initStandalonePlaytest, input, installThreePlaytestBridge, jsonByteLength, loadPlaytestScenario, missingPlaytestCapabilities, objectPath, oneShotScenario, overlayNodeObservationKey, parsePlaytestTarget, parseStandalonePlaytestArgs, parseViewport, playtestDiagnostic, playtestStepHoldTicks, playtestStepWaitTicks, requiredPlaytestCapabilities, runStandalonePlaytest, sampleThreeObservations, unknownPlaytestCapabilities, version
Measurement command: `pnpm sweep:measure docs/benchmark/sweeps/exploration-2026-08-05`
First game-code tool call: Fresh uninformed exploration consumer pass in `/tmp/tn-prd018-exploration-mtzwCw/my-game`; no repository PRD text was available in that sandbox.
Visual result: PASS — independent north and south area playtests rendered the exploration scene and passed frame-diff assertions.

## Playtest proof

`pnpm typecheck` and the consumer package test passed. The north scenario observed `area=north`, `inspections=2`, `north.archive`, and `transitionCount=1`; the south scenario observed `area=south`, `inspections=2`, `south.tide`, and `transitionCount=1`. Both scenarios had zero console, network, and runtime diagnostics.

The first route scenario exposed a runner defect: `holdFrames` was incorrectly treated as fixed ticks. The root regression test `frame-timed steps stay on the live browser loop` now passes, and the two archived consumer scenarios pass with the corrected runner package.

## Friction ledger

| API or surface | What blocked the build | Workaround | Evidence |
| --- | --- | --- | --- |
| `Playtest frame timing` | `holdFrames` was routed through fixed-step bridge calls, causing slow-render route drift. | Keep frame steps on the live RAF loop; reserve `bridge.advance` for `holdTicks` and `waitTicks`. | `packages/playtest/src/scenario.ts`, `packages/playtest/__tests__/runner.spec.ts`; the archived north/south scenarios pass. |
