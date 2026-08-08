# Genre sweep ledger — endless-runner — 2026-08-08 — framework

Genre: endless-runner
Round: 2
Brief SHA-256: 21a0d1035d21b0520da448104271118570528cf5416d33e8ceed64efeb6326ec
Arm: framework
Proof result: 1/1
Proof SHA-256: 4e985122c5fdd62a5b8d36c2acc7d1a6c7d0b49aa1583f47dbf721c5c46764db
Template: starter
Archive: docs/benchmark/sweeps/endless-runner-2026-08-08-11
Framework version: 0.1.0
Starter source LOC: 788
Starter lines survived: 338
User source LOC: 1181
Authored LOC: 843
Authored bytes: 28076
Source files: 15
Framework files: 7
Three-only files: 5
Reach rate: 0.4666666666666667
Used exports: Ctx, Game, GameCanvas, Scene, SceneFrame, defineGame, playtest, useGameState
Unused exports: AnimationPlayOptions, AnimationPlayer, AnimationPlayerOptions, Area3D, Area3DOptions, AreaContact, AreaEvent, AreaHandler, AssetLoader, AssetLoaderOptions, AudioBus, AudioBusOptions, AudioPlayOptions, CameraConfig, CharacterBody3D, CharacterBody3DOptions, CollisionShape3D, CollisionShapeKind, DebugOverlay, DebugSnapshot, Debuggable, EntitySnapshot, FixedStepLoop, FixedStepLoopOptions, GPUParticles3D, GPUParticles3DBuffers, GPUParticles3DOptions, GameCanvasProps, GameConfig, GamePlugin, GamePluginFunction, GamePluginHooks, GamePluginRuntime, GameStore, IPlaytestAdvanceResult, IPlaytestAerodynamicsAssertion, IPlaytestAnimationAssertion, IPlaytestAnimationObservation, IPlaytestArtifactRequest, IPlaytestAssertionResult, IPlaytestAssertionSchemaEntry, IPlaytestAssertionSchemaField, IPlaytestBridgeClient, IPlaytestBridgeDescription, IPlaytestBridgeHost, IPlaytestBridgeReady, IPlaytestBridgeV1, IPlaytestCameraAssertion, IPlaytestCapabilityDescriptor, IPlaytestComponentAssertion, IPlaytestContactAssertion, IPlaytestContactObservation, IPlaytestDiagnostic, IPlaytestDiagnosticsAssertion, IPlaytestEntityObservation, IPlaytestEntityTransform, IPlaytestFollowReport, IPlaytestGameplayObservation, IPlaytestMovementAssertion, IPlaytestObservationSnapshot, IPlaytestObservations, IPlaytestOccludedAssertion, IPlaytestOverlayNodeAssertion, IPlaytestParityConfig, IPlaytestPathAssertion, IPlaytestProtocolDiagnostic, IPlaytestReachabilityAssertion, IPlaytestReport, IPlaytestResourceAnyOfAssertion, IPlaytestResourceAssertion, IPlaytestResourcePathAlternative, IPlaytestResourcePathAssertion, IPlaytestSampleRequest, IPlaytestScenario, IPlaytestScenarioAssertions, IPlaytestScenarioDiagnostic, IPlaytestScenarioSetup, IPlaytestServerConfig, IPlaytestSettledAssertion, IPlaytestSetupEntityTransform, IPlaytestSetupRequest, IPlaytestSetupResource, IPlaytestSetupSchemaEntry, IPlaytestStateAssertion, IPlaytestStep, IPlaytestTagCountAssertion, IPlaytestTagObservation, IPlaytestTransformSample, IPlaytestViewport, IPlaytestVisibilityAssertion, IPlaytestVisualAssertion, IPlaytestWorldAssertion, IStandalonePlaytestConfig, IStandalonePlaytestReport, IThreeObservationInput, IThreePlaytestBridgeInstallation, IThreePlaytestBridgeOptions, IThreePlaytestEntity, IThreePlaytestResources, InputAction, InputBindings, InputMap, JsonPrimitive, JsonValue, OrthogonalCameraConfig, PLAYTEST_ASSERTION_REGISTRY, PLAYTEST_BRIDGE_GLOBAL, PLAYTEST_CAPABILITY_REGISTRY, PLAYTEST_PROTOCOL_LIMITS, PLAYTEST_PROTOCOL_VERSION, PLAYTEST_SETUP_REGISTRY, PerspectiveCameraConfig, PhysicsBody3D, PhysicsContext, PhysicsOptions, PhysicsPlugin, PlaytestBridgeError, PlaytestCapability, PlaytestClockMode, PlaytestDiagnosticCode, PlaytestInputDelivery, PlaytestScenarioError, PlaytestTarget, PlaytestVec3, PluginCleanup, Random, RawInputState, Registry, RendererKind, RendererLike, RendererOptions, RigidBody3D, RigidBody3DOptions, RigidBodyType, SceneConstructor, SceneEnterResult, ScheduleHandle, Scheduler, StatePatch, ThreePlaytestEntityRegistry, ThreePlaytestRenderer, Viewport, ViewportOptions, ViewportResizeHandler, ViewportSize, applyScenarioOverrides, assertJsonSafe, autoFields, buildReport, connectPlaytestBridge, createAssetLoader, createGameStore, createRandom, createRenderer, evaluateRichPlaytestAssertions, initStandalonePlaytest, input, installThreePlaytestBridge, jsonByteLength, loadPlaytestScenario, missingPlaytestCapabilities, objectPath, oneShotScenario, overlayNodeObservationKey, parsePlaytestTarget, parseStandalonePlaytestArgs, parseViewport, playtestDiagnostic, playtestStepHoldTicks, playtestStepWaitTicks, rapier, requiredPlaytestCapabilities, runStandalonePlaytest, sampleThreeObservations, unknownPlaytestCapabilities, version
Measurement command: `pnpm sweep:measure docs/benchmark/sweeps/endless-runner-2026-08-08-11`
First game-code tool call: direct sandbox build; tool-call count not recorded
Visual result: PASS — active headed capture passed the frame guard; blind polish tie at 3.4/5
Blind polish: framework behavior 4, visuals 4, effects 3, particles 2, audio na, UX 4; average 3.4
Replay intent: yes — the run remains active with visible lane, jump, slide, score, distance, speed, and restart cues

## Paired proof

`pnpm sweep:pair docs/benchmark/sweeps/endless-runner-2026-08-08-11 docs/benchmark/sweeps/endless-runner-2026-08-08-6` passed both sealed proofs at `1/1`. The framework arm used 843 authored LOC above a 788-LOC starter; the vanilla Three.js arm used 401 authored LOC from an empty source tree. The fair framework-minus-vanilla delta is **+442 LOC / +11,466 bytes**, so this genre is not an efficiency win.

The blind image bundle is [blind-endless-runner-2026-08-08-webgl](blind-endless-runner-2026-08-08-webgl/bundle.json); its reveal remains outside the bundle. The judge accepted the v2 rubric and returned a tie. This one genre is evidence, not a consistency claim.

The framework arm used `render.preferWebGPU: false` for this capture. With WebGPU enabled in the benchmark browser, the starter rounded/cone attributes produced repeated `createBuffer` page errors; the direct runner recorded 202 console errors while sealed assertions still passed. The WebGL fallback recorded zero console errors and is the result scored above.

## Friction ledger

| API or surface | What blocked the build | Workaround | Evidence |
| --- | --- | --- | --- |
| Framework WebGPU renderer | The benchmark browser repeatedly rejected starter geometry buffers with `RangeError: createBuffer failed` / `OperationError: Instance dropped in popErrorScope`. | Set `render.preferWebGPU: false` in the framework arm and rerun the same sealed proof against its WebGL fallback. | `/tmp/endless-framework-webgl-report.json`; direct runner diagnostics reported `consoleErrors: 0` after fallback. |
