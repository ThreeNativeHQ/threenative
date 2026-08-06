# Genre sweep ledger — topdown-action — 2026-08-05

Genre: topdown-action
Round: 1
Brief SHA-256: 053c4b8c58219b0e578b7526526566496d8ab16b916c86cebb539672b2f86b86
Arm: framework
Proof result: 0/0 (not run; archived before PRD-019)
Proof SHA-256: 17d31dbd3be01c6c5f7391026297814e931bd3004608f5380f6ab8d71006cd28
Template: starter (no topdown-action template)
Archive: docs/benchmark/sweeps/topdown-action-2026-08-05
Framework version: 0.1.0
User source LOC: 801
Source files: 16
Framework files: 8
Three-only files: 6
Reach rate: 0.5
Used exports: Area3D, CharacterBody3D, CollisionShape3D, Ctx, DebugOverlay, Game, GameCanvas, PhysicsContext, RigidBody3D, Scene, defineGame, playtest, rapier, useGameState
Unused exports: AnimationPlayOptions, AnimationPlayer, AnimationPlayerOptions, Area3DOptions, AreaContact, AreaEvent, AreaHandler, AssetLoader, AssetLoaderOptions, AudioBus, AudioBusOptions, AudioPlayOptions, CharacterBody3DOptions, CollisionShapeKind, DebugSnapshot, Debuggable, EntitySnapshot, FixedStepLoop, FixedStepLoopOptions, GameCanvasProps, GameConfig, GamePlugin, GamePluginFunction, GamePluginHooks, GamePluginRuntime, GameStore, IPlaytestAdvanceResult, IPlaytestAerodynamicsAssertion, IPlaytestAnimationAssertion, IPlaytestAnimationObservation, IPlaytestArtifactRequest, IPlaytestAssertionResult, IPlaytestAssertionSchemaEntry, IPlaytestAssertionSchemaField, IPlaytestBridgeClient, IPlaytestBridgeDescription, IPlaytestBridgeHost, IPlaytestBridgeReady, IPlaytestBridgeV1, IPlaytestCameraAssertion, IPlaytestCapabilityDescriptor, IPlaytestComponentAssertion, IPlaytestContactAssertion, IPlaytestContactObservation, IPlaytestDiagnostic, IPlaytestDiagnosticsAssertion, IPlaytestEntityObservation, IPlaytestEntityTransform, IPlaytestFollowReport, IPlaytestGameplayObservation, IPlaytestMovementAssertion, IPlaytestObservationSnapshot, IPlaytestObservations, IPlaytestOccludedAssertion, IPlaytestOverlayNodeAssertion, IPlaytestParityConfig, IPlaytestPathAssertion, IPlaytestProtocolDiagnostic, IPlaytestReachabilityAssertion, IPlaytestReport, IPlaytestSampleRequest, IPlaytestScenario, IPlaytestScenarioAssertions, IPlaytestScenarioDiagnostic, IPlaytestScenarioSetup, IPlaytestServerConfig, IPlaytestSettledAssertion, IPlaytestSetupEntityTransform, IPlaytestSetupRequest, IPlaytestSetupResource, IPlaytestSetupSchemaEntry, IPlaytestStateAssertion, IPlaytestStep, IPlaytestTagCountAssertion, IPlaytestTagObservation, IPlaytestTransformSample, IPlaytestViewport, IPlaytestVisibilityAssertion, IPlaytestVisualAssertion, IPlaytestWorldAssertion, IStandalonePlaytestConfig, IStandalonePlaytestReport, IThreeObservationInput, IThreePlaytestBridgeInstallation, IThreePlaytestBridgeOptions, IThreePlaytestEntity, IThreePlaytestResources, InputAction, InputBindings, InputMap, JsonPrimitive, JsonValue, PLAYTEST_ASSERTION_REGISTRY, PLAYTEST_BRIDGE_GLOBAL, PLAYTEST_CAPABILITY_REGISTRY, PLAYTEST_PROTOCOL_LIMITS, PLAYTEST_PROTOCOL_VERSION, PLAYTEST_SETUP_REGISTRY, PhysicsBody3D, PhysicsOptions, PhysicsPlugin, PlaytestBridgeError, PlaytestCapability, PlaytestClockMode, PlaytestDiagnosticCode, PlaytestInputDelivery, PlaytestScenarioError, PlaytestTarget, PlaytestVec3, PluginCleanup, Random, RawInputState, Registry, RendererKind, RendererLike, RendererOptions, RigidBody3DOptions, RigidBodyType, SceneConstructor, ScheduleHandle, Scheduler, StatePatch, ThreePlaytestEntityRegistry, ThreePlaytestRenderer, applyScenarioOverrides, assertJsonSafe, autoFields, buildReport, connectPlaytestBridge, createAssetLoader, createGameStore, createRandom, createRenderer, evaluateRichPlaytestAssertions, initStandalonePlaytest, input, installThreePlaytestBridge, jsonByteLength, loadPlaytestScenario, missingPlaytestCapabilities, objectPath, oneShotScenario, overlayNodeObservationKey, parsePlaytestTarget, parseStandalonePlaytestArgs, parseViewport, playtestDiagnostic, playtestStepHoldTicks, playtestStepWaitTicks, requiredPlaytestCapabilities, runStandalonePlaytest, sampleThreeObservations, unknownPlaytestCapabilities, version
Measurement command: `pnpm sweep:measure docs/benchmark/sweeps/topdown-action-2026-08-05`
First game-code tool call: first post-scaffold source patch in `/tmp/tn-sweep-topdown-action-2026-08-05/my-game`; the external agent transcript did not assign a numeric tool-call id.
Visual result: PASS — the after screenshot shows the arena, player, HUD, gold exit, and `ARENA CLEARED`; the playtest frame-diff ratio was `0.45220052083333334`.

## Playtest proof

`pnpm test` passed after the consumer build. `topdown-action-sweep` observed:

- `3 shots → 3 hits → 0 targets`, `score=300`, and `won=true`.
- Player movement `7.049985408782959` units; camera separation `10.630171551938535`, within the declared `12` unit bound.
- Zero console errors, network errors, or runtime diagnostics.

## Friction ledger

| API or surface | What blocked the build | Workaround | Evidence |
| --- | --- | --- | --- |
| `CharacterBody3D` gravity | A planar consumer does not need vertical integration; the first build fell through the floor before attack assertions could run. | Set `gravity: 0` for the top-down body and keep horizontal movement under the playtest path. | `src/entities/Player.ts`; the failed run ended at `y=-854.9075`, the passing run held `y=0.7`. |
| Playtest artifact schema | `artifacts.trace` is not a supported key. | Use `artifacts.runtimeTrace`. | `playtests/topdown-action.playtest.json`; runner rejected the old key before the game ran. |
