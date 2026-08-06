# Genre sweep ledger — platformer — 2026-08-05

Genre: platformer
Round: 2
Brief SHA-256: 8a7ee799256676d10fc7d22966e3e4fa93ed54c888fc91fd0f34fc3520ddd9fa
Arm: framework
Proof result: 2/2
Proof SHA-256: 1a950bd0763a4c07f0d201739b5f133d977874f2585aee7c777bdc3a3413e4b7
Template: platformer
Archive: docs/benchmark/sweeps/platformer-2026-08-05-2
Framework version: 0.1.0
User source LOC: 1073
Source files: 18
Framework files: 10
Three-only files: 4
Reach rate: 0.5555555555555556
Used exports: Area3D, CharacterBody3D, CollisionShape3D, Ctx, DebugOverlay, Game, GameCanvas, PhysicsContext, RigidBody3D, Scene, defineGame, playtest, rapier, useGameState
Unused exports: AnimationPlayOptions, AnimationPlayer, AnimationPlayerOptions, Area3DOptions, AreaContact, AreaEvent, AreaHandler, AssetLoader, AssetLoaderOptions, AudioBus, AudioBusOptions, AudioPlayOptions, CharacterBody3DOptions, CollisionShapeKind, DebugSnapshot, Debuggable, EntitySnapshot, FixedStepLoop, FixedStepLoopOptions, GameCanvasProps, GameConfig, GamePlugin, GamePluginFunction, GamePluginHooks, GamePluginRuntime, GameStore, IPlaytestAdvanceResult, IPlaytestAerodynamicsAssertion, IPlaytestAnimationAssertion, IPlaytestAnimationObservation, IPlaytestArtifactRequest, IPlaytestAssertionResult, IPlaytestAssertionSchemaEntry, IPlaytestAssertionSchemaField, IPlaytestBridgeClient, IPlaytestBridgeDescription, IPlaytestBridgeHost, IPlaytestBridgeReady, IPlaytestBridgeV1, IPlaytestCameraAssertion, IPlaytestCapabilityDescriptor, IPlaytestComponentAssertion, IPlaytestContactAssertion, IPlaytestContactObservation, IPlaytestDiagnostic, IPlaytestDiagnosticsAssertion, IPlaytestEntityObservation, IPlaytestEntityTransform, IPlaytestFollowReport, IPlaytestGameplayObservation, IPlaytestMovementAssertion, IPlaytestObservationSnapshot, IPlaytestObservations, IPlaytestOccludedAssertion, IPlaytestOverlayNodeAssertion, IPlaytestParityConfig, IPlaytestPathAssertion, IPlaytestProtocolDiagnostic, IPlaytestReachabilityAssertion, IPlaytestReport, IPlaytestSampleRequest, IPlaytestScenario, IPlaytestScenarioAssertions, IPlaytestScenarioDiagnostic, IPlaytestScenarioSetup, IPlaytestServerConfig, IPlaytestSettledAssertion, IPlaytestSetupEntityTransform, IPlaytestSetupRequest, IPlaytestSetupResource, IPlaytestSetupSchemaEntry, IPlaytestStateAssertion, IPlaytestStep, IPlaytestTagCountAssertion, IPlaytestTagObservation, IPlaytestTransformSample, IPlaytestViewport, IPlaytestVisibilityAssertion, IPlaytestVisualAssertion, IPlaytestWorldAssertion, IStandalonePlaytestConfig, IStandalonePlaytestReport, IThreeObservationInput, IThreePlaytestBridgeInstallation, IThreePlaytestBridgeOptions, IThreePlaytestEntity, IThreePlaytestResources, InputAction, InputBindings, InputMap, JsonPrimitive, JsonValue, PLAYTEST_ASSERTION_REGISTRY, PLAYTEST_BRIDGE_GLOBAL, PLAYTEST_CAPABILITY_REGISTRY, PLAYTEST_PROTOCOL_LIMITS, PLAYTEST_PROTOCOL_VERSION, PLAYTEST_SETUP_REGISTRY, PhysicsBody3D, PhysicsOptions, PhysicsPlugin, PlaytestBridgeError, PlaytestCapability, PlaytestClockMode, PlaytestDiagnosticCode, PlaytestInputDelivery, PlaytestScenarioError, PlaytestTarget, PlaytestVec3, PluginCleanup, Random, RawInputState, Registry, RendererKind, RendererLike, RendererOptions, RigidBody3DOptions, RigidBodyType, SceneConstructor, ScheduleHandle, Scheduler, StatePatch, ThreePlaytestEntityRegistry, ThreePlaytestRenderer, applyScenarioOverrides, assertJsonSafe, autoFields, buildReport, connectPlaytestBridge, createAssetLoader, createGameStore, createRandom, createRenderer, evaluateRichPlaytestAssertions, initStandalonePlaytest, input, installThreePlaytestBridge, jsonByteLength, loadPlaytestScenario, missingPlaytestCapabilities, objectPath, oneShotScenario, overlayNodeObservationKey, parsePlaytestTarget, parseStandalonePlaytestArgs, parseViewport, playtestDiagnostic, playtestStepHoldTicks, playtestStepWaitTicks, requiredPlaytestCapabilities, runStandalonePlaytest, sampleThreeObservations, unknownPlaytestCapabilities, version
Measurement command: `pnpm sweep:measure docs/benchmark/sweeps/platformer-2026-08-05-2`
First game-code tool call: Fresh PRD-017 control replay in `/tmp/tn-prd017-platformer-final-Gk7Kw6/my-game`; the added goal proof used the shipped platformer APIs.
Visual result: FUNCTIONAL PASS — sealed jump/run proof passed 2/2; network and runtime diagnostics passed. The archived WebGPU run emitted 181 console errors and produced blank white screenshots under this headless Chromium environment, which are not asserted by the arm-neutral proof.

## Playtest proof

The sealed proof ran `platformer-jump-proof` and `platformer-run-proof` against the archived framework arm. Both scenarios passed (2/2): jump observed positive `+y` movement; run observed `coins=5`, `goalReached=true`, `respawns=2`, and a changed coins HUD. Network errors and runtime diagnostics were zero. The archived WebGPU run emitted 181 console errors during the long run; `noConsoleErrors` is intentionally absent because it is not part of the platformer brief's arm-neutral assertions. Before/after screenshot files were persisted, but all four framework captures are blank white because Chromium reports `Instance dropped in popErrorScope`; the vanilla captures render normally.

## Friction ledger

| API or surface | What blocked the build | Workaround | Evidence |
| --- | --- | --- | --- |
| Chromium WebGPU renderer | Headless WebGPU emitted `Instance dropped in popErrorScope`, leaving framework screenshots blank. | Functional assertions remain valid; PRD-020 needs a WebGPU-capable capture environment. | `pnpm sweep:proof docs/benchmark/sweeps/platformer-2026-08-05-2` passed 2/2; base, Vulkan, and SwiftShader flags reproduced the capture limitation. |
