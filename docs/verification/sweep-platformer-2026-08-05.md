# Genre sweep ledger — platformer — 2026-08-05

Genre: platformer
Round: 1
Brief SHA-256: 8a7ee799256676d10fc7d22966e3e4fa93ed54c888fc91fd0f34fc3520ddd9fa
Arm: framework
Proof result: 0/0 (not run; archived before PRD-019)
Proof SHA-256: 1a950bd0763a4c07f0d201739b5f133d977874f2585aee7c777bdc3a3413e4b7
Template: platformer
Archive: docs/benchmark/sweeps/platformer-2026-08-05
Framework version: 0.1.0
User source LOC: 1015
Source files: 17
Framework files: 9
Three-only files: 4
Reach rate: 0.5294117647058824
Used exports: Area3D, CharacterBody3D, CollisionShape3D, Ctx, DebugOverlay, Game, GameCanvas, PhysicsContext, RigidBody3D, Scene, defineGame, playtest, rapier, useGameState
Unused exports: AnimationPlayOptions, AnimationPlayer, AnimationPlayerOptions, Area3DOptions, AreaContact, AreaEvent, AreaHandler, AssetLoader, AssetLoaderOptions, AudioBus, AudioBusOptions, AudioPlayOptions, CharacterBody3DOptions, CollisionShapeKind, DebugSnapshot, Debuggable, EntitySnapshot, FixedStepLoop, FixedStepLoopOptions, GameCanvasProps, GameConfig, GamePlugin, GamePluginFunction, GamePluginHooks, GamePluginRuntime, GameStore, IPlaytestAdvanceResult, IPlaytestAerodynamicsAssertion, IPlaytestAnimationAssertion, IPlaytestAnimationObservation, IPlaytestArtifactRequest, IPlaytestAssertionResult, IPlaytestAssertionSchemaEntry, IPlaytestAssertionSchemaField, IPlaytestBridgeClient, IPlaytestBridgeDescription, IPlaytestBridgeHost, IPlaytestBridgeReady, IPlaytestBridgeV1, IPlaytestCameraAssertion, IPlaytestCapabilityDescriptor, IPlaytestComponentAssertion, IPlaytestContactAssertion, IPlaytestContactObservation, IPlaytestDiagnostic, IPlaytestDiagnosticsAssertion, IPlaytestEntityObservation, IPlaytestEntityTransform, IPlaytestFollowReport, IPlaytestGameplayObservation, IPlaytestMovementAssertion, IPlaytestObservationSnapshot, IPlaytestObservations, IPlaytestOccludedAssertion, IPlaytestOverlayNodeAssertion, IPlaytestParityConfig, IPlaytestPathAssertion, IPlaytestProtocolDiagnostic, IPlaytestReachabilityAssertion, IPlaytestReport, IPlaytestSampleRequest, IPlaytestScenario, IPlaytestScenarioAssertions, IPlaytestScenarioDiagnostic, IPlaytestScenarioSetup, IPlaytestServerConfig, IPlaytestSettledAssertion, IPlaytestSetupEntityTransform, IPlaytestSetupRequest, IPlaytestSetupResource, IPlaytestSetupSchemaEntry, IPlaytestStateAssertion, IPlaytestStep, IPlaytestTagCountAssertion, IPlaytestTagObservation, IPlaytestTransformSample, IPlaytestViewport, IPlaytestVisibilityAssertion, IPlaytestVisualAssertion, IPlaytestWorldAssertion, IStandalonePlaytestConfig, IStandalonePlaytestReport, IThreeObservationInput, IThreePlaytestBridgeInstallation, IThreePlaytestBridgeOptions, IThreePlaytestEntity, IThreePlaytestResources, InputAction, InputBindings, InputMap, JsonPrimitive, JsonValue, PLAYTEST_ASSERTION_REGISTRY, PLAYTEST_BRIDGE_GLOBAL, PLAYTEST_CAPABILITY_REGISTRY, PLAYTEST_PROTOCOL_LIMITS, PLAYTEST_PROTOCOL_VERSION, PLAYTEST_SETUP_REGISTRY, PhysicsBody3D, PhysicsOptions, PhysicsPlugin, PlaytestBridgeError, PlaytestCapability, PlaytestClockMode, PlaytestDiagnosticCode, PlaytestInputDelivery, PlaytestScenarioError, PlaytestTarget, PlaytestVec3, PluginCleanup, Random, RawInputState, Registry, RendererKind, RendererLike, RendererOptions, RigidBody3DOptions, RigidBodyType, SceneConstructor, ScheduleHandle, Scheduler, StatePatch, ThreePlaytestEntityRegistry, ThreePlaytestRenderer, applyScenarioOverrides, assertJsonSafe, autoFields, buildReport, connectPlaytestBridge, createAssetLoader, createGameStore, createRandom, createRenderer, evaluateRichPlaytestAssertions, initStandalonePlaytest, input, installThreePlaytestBridge, jsonByteLength, loadPlaytestScenario, missingPlaytestCapabilities, objectPath, oneShotScenario, overlayNodeObservationKey, parsePlaytestTarget, parseStandalonePlaytestArgs, parseViewport, playtestDiagnostic, playtestStepHoldTicks, playtestStepWaitTicks, requiredPlaytestCapabilities, runStandalonePlaytest, sampleThreeObservations, unknownPlaytestCapabilities, version
Measurement command: `pnpm sweep:measure docs/benchmark/sweeps/platformer-2026-08-05`
First game-code tool call: platformer template scaffold; no user source was added after scaffolding.
Visual result: PASS — the template completed its playable control sweep; the shipped browser scenarios provided semantic proof rather than a reference-image assertion.

## Playtest proof

`pnpm typecheck && pnpm test` passed in the consumer. All 10 platformer scenarios passed: jump, coyote, buffer, dash, patrol, collect, stomp, stomp-rise, respawn, and one-way. Each report had zero console errors, network errors, and runtime diagnostics.

Observed framework behavior included jump rise `2.0385618209838867`, coyote jump `1`, dash count `1`, patrol path length `27.359999999999715`, coin collection `5`, stomp defeat `1`, and respawns `12`.

## Friction ledger

| API or surface | What blocked the build | Workaround | Evidence |
| --- | --- | --- | --- |
| `CharacterBody3D.object` | A `Group`-based character could not use the old `mesh: Mesh` option. | Use `object: Object3D`; the platformer character keeps its visual parts under a `Group`. | Closed by `1cd1df76`; fresh `/tmp/tn-prd017-platformer-2026-08-05/my-game` consumer passed typecheck and all 10 browser scenarios. |
| `RigidBody3D.object` | The platform collision body required the old mesh-only option. | Pass the visible platform `Object3D` as `object`; the collision shape remains explicit. | Closed by `1cd1df76` and repaired after review; `src/level/Platform.ts` has no hidden physics mesh, and fresh `/tmp/tn-prd017-platformer-final-Gk7Kw6/my-game` typechecked and passed all 10 scenarios. |
| `CharacterBody3D.teleport()` | Respawn reached into raw Rapier translation state. | Call `body.teleport(point)` from `Checkpoints`. | Closed by `1cd1df76`; `respawn` passed with `respawns=12`, target distance `0.0907`, and zero diagnostics. |
| Minimal scaffold type declarations | A clean minimal scaffold lacked `@types/three` before its first typecheck. | Ship `@types/three` in the minimal template and smoke-test a generated project. | Closed by `1cd1df76`; scaffold smoke passed in the repository suite with no source edits. |
| Forward input axis | `input.vector("move").y` was not documented at the template call site. | Map the one input line to world-space `-z` and assert it in `forward.playtest.json`. | Closed by `1cd1df76`; fresh starter consumer measured `-3.7333` z delta over 60 ticks with zero diagnostics. |

The patrol sensor move was also kept behind the `Area3D` surface while closing the template
Rapier scan; `5e95807` added `Area3D.setPosition()` and its unit assertion. The fresh
platformer `patrol` scenario passed with path length `27.36`. After the Linchpin reviewer
requested removal of the platform's hidden physics mesh, the visible platform object became
the body object; the fresh final consumer `/tmp/tn-prd017-platformer-final-Gk7Kw6/my-game`
passed all 10 scenarios with zero console, network, and runtime diagnostics.
