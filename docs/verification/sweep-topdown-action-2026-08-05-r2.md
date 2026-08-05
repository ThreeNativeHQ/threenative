# Genre sweep ledger — topdown-action — 2026-08-05

Genre: topdown-action
Round: 2
Brief SHA-256: 053c4b8c58219b0e578b7526526566496d8ab16b916c86cebb539672b2f86b86
Template: starter (no topdown-action template)
Archive: docs/benchmark/sweeps/topdown-action-2026-08-05-3
Framework version: 0.1.0
User source LOC: 1199
Source files: 18
Framework files: 10
Three-only files: 6
Reach rate: 0.5555555555555556
Used exports: Area3D, CharacterBody3D, CollisionShape3D, Ctx, DebugOverlay, Game, GameCanvas, PhysicsContext, RigidBody3D, Scene, defineGame, playtest, rapier, useGameState
Unused exports: AnimationPlayOptions, AnimationPlayer, AnimationPlayerOptions, Area3DOptions, AreaContact, AreaEvent, AreaHandler, AssetLoader, AssetLoaderOptions, AudioBus, AudioBusOptions, AudioPlayOptions, CharacterBody3DOptions, CollisionShapeKind, DebugSnapshot, Debuggable, EntitySnapshot, FixedStepLoop, FixedStepLoopOptions, GameCanvasProps, GameConfig, GamePlugin, GamePluginFunction, GamePluginHooks, GamePluginRuntime, GameStore, IPlaytestAdvanceResult, IPlaytestAerodynamicsAssertion, IPlaytestAnimationAssertion, IPlaytestAnimationObservation, IPlaytestArtifactRequest, IPlaytestAssertionResult, IPlaytestAssertionSchemaEntry, IPlaytestAssertionSchemaField, IPlaytestBridgeClient, IPlaytestBridgeDescription, IPlaytestBridgeHost, IPlaytestBridgeReady, IPlaytestBridgeV1, IPlaytestCameraAssertion, IPlaytestCapabilityDescriptor, IPlaytestComponentAssertion, IPlaytestContactAssertion, IPlaytestContactObservation, IPlaytestDiagnostic, IPlaytestDiagnosticsAssertion, IPlaytestEntityObservation, IPlaytestEntityTransform, IPlaytestFollowReport, IPlaytestGameplayObservation, IPlaytestMovementAssertion, IPlaytestObservationSnapshot, IPlaytestObservations, IPlaytestOccludedAssertion, IPlaytestOverlayNodeAssertion, IPlaytestParityConfig, IPlaytestPathAssertion, IPlaytestProtocolDiagnostic, IPlaytestReachabilityAssertion, IPlaytestReport, IPlaytestSampleRequest, IPlaytestScenario, IPlaytestScenarioAssertions, IPlaytestScenarioDiagnostic, IPlaytestScenarioSetup, IPlaytestServerConfig, IPlaytestSettledAssertion, IPlaytestSetupEntityTransform, IPlaytestSetupRequest, IPlaytestSetupResource, IPlaytestSetupSchemaEntry, IPlaytestStateAssertion, IPlaytestStep, IPlaytestTagCountAssertion, IPlaytestTagObservation, IPlaytestTransformSample, IPlaytestViewport, IPlaytestVisibilityAssertion, IPlaytestVisualAssertion, IPlaytestWorldAssertion, IStandalonePlaytestConfig, IStandalonePlaytestReport, IThreeObservationInput, IThreePlaytestBridgeInstallation, IThreePlaytestBridgeOptions, IThreePlaytestEntity, IThreePlaytestResources, InputAction, InputBindings, InputMap, JsonPrimitive, JsonValue, PLAYTEST_ASSERTION_REGISTRY, PLAYTEST_BRIDGE_GLOBAL, PLAYTEST_CAPABILITY_REGISTRY, PLAYTEST_PROTOCOL_LIMITS, PLAYTEST_PROTOCOL_VERSION, PLAYTEST_SETUP_REGISTRY, PhysicsBody3D, PhysicsOptions, PhysicsPlugin, PlaytestBridgeError, PlaytestCapability, PlaytestClockMode, PlaytestDiagnosticCode, PlaytestInputDelivery, PlaytestScenarioError, PlaytestTarget, PlaytestVec3, PluginCleanup, Random, RawInputState, Registry, RendererKind, RendererLike, RendererOptions, RigidBody3DOptions, RigidBodyType, SceneConstructor, ScheduleHandle, Scheduler, StatePatch, ThreePlaytestEntityRegistry, ThreePlaytestRenderer, applyScenarioOverrides, assertJsonSafe, autoFields, buildReport, connectPlaytestBridge, createAssetLoader, createGameStore, createRandom, createRenderer, evaluateRichPlaytestAssertions, initStandalonePlaytest, input, installThreePlaytestBridge, jsonByteLength, loadPlaytestScenario, missingPlaytestCapabilities, objectPath, oneShotScenario, overlayNodeObservationKey, parsePlaytestTarget, parseStandalonePlaytestArgs, parseViewport, playtestDiagnostic, playtestStepHoldTicks, playtestStepWaitTicks, requiredPlaytestCapabilities, runStandalonePlaytest, sampleThreeObservations, unknownPlaytestCapabilities, version
Measurement command: `pnpm sweep:measure docs/benchmark/sweeps/topdown-action-2026-08-05-3`
First game-code tool call: Fresh uninformed top-down consumer pass in `/tmp/tn-prd018-topdown-action-4m6e5m/my-game`; no repository PRD text was available in that sandbox. The pass independently added a moving visible sensor using `Area3D.setPosition()`.
Visual result: PASS — the arena, player, HUD, pickups, enemies, cleared state, and moving patrol sensor rendered; the patrol-sensor visibility assertion observed `projectedPixels=12399.982987594076` with `offscreenRatio=0`.

## Playtest proof

`pnpm typecheck` passed. The package browser suite passed `play`, `movement`, `combat`, `win`, `diagnostics`, `visibility`, and `patrol-sensor`. The patrol-sensor run observed movement `2.650000000000056`, `sensorTravel=18.449999999999942`, and zero console, network, and runtime diagnostics. The combat/win run observed 3 shots, 3 hits, 0 remaining enemies, `score=3`, `won=true`, and zero console, network, and runtime diagnostics.

## Friction ledger

| API or surface | What blocked the build | Workaround | Evidence |
| --- | --- | --- | --- |
| `CharacterBody3D gravity` | A planar consumer does not need vertical integration; the first build fell through the floor before attack assertions ran. | Set `gravity: 0` and keep horizontal movement under the playtest path. | `docs/benchmark/sweeps/topdown-action-2026-08-05-3/src/entities/Player.ts`; the passing run held `y=0.7`. |
| `Playtest artifact schema` | `artifacts.trace` is not a supported key. | Use `artifacts.runtimeTrace`. | `docs/benchmark/sweeps/topdown-action-2026-08-05-3/playtests`; the corrected package suite passed. |
