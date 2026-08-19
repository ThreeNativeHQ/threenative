# PRD-157 Phase 1 negative control

Date: 2026-08-19

Before adding the structured export tags, the real generator ran against the current worktree:

```text
pnpm tsx scripts/build-capability-manifest.ts
```

It exited `1` with `Capability manifest generation failed` and enumerated every untagged public
class or function. The artifact was not written. The complete offender set was:

```text
@threenative/core: AnimationPlayer, attachToBone, AudioBus, CanvasLayer, createRandom,
createReplayDriver, defineGame, getPlatform, GPUParticles3D, isMobile, isNative,
isTouchscreenAvailable, isWeb, PathFollow3D, replay, Scene, ScenePicker, Scheduler, skeletonBones
@threenative/core/hot: acceptHotUpdate, assertPortableState
@threenative/core/playtest: playtest
@threenative/physics: Area3D, CharacterBody3D, CollisionShape3D, interactionGroups, Joint3D,
PhysicsDirectSpaceState3D, rapier, RigidBody3D
@threenative/physics/navigation: NavigationAgent3D, NavigationObstacle3D, NavigationRegion3D,
recast
@threenative/playtest: assertJsonSafe, evaluateRichPlaytestAssertions, invalidScenario,
jsonByteLength, loadPlaytestScenario, missingPlaytestCapabilities, parseReplayRecording,
playtestDiagnostic, PlaytestScenarioError, playtestStepHoldTicks, playtestStepWaitTicks,
rejectUnknownKeys, requiredPlaytestCapabilities, resolveDiagnosticsPolicy,
unknownPlaytestCapabilities
@threenative/playtest/capture: assertCaptureNotBlank, CaptureGuardError, inspectFrame
@threenative/playtest/runner: AdbAndroidDriver, androidMailboxPaths, androidTouchBatches,
boundedTeardownStep, buildReport, captureVisualSurface, connectPlaytestBridge,
connectPlaytestBridgeTransport, DesktopPlaytestDriver, DeviceBridgeTransport, deviceMailboxPaths,
DeviceMailboxTransport, discoverAdb, failedDiagnosticsAssertion, formatUsage,
handlePlaytestSignal, initStandalonePlaytest, isRuntimeReadout, LocalDeviceMailbox,
openPageAndConnectBridge, pageLifecycleDiagnostic, parseAndroidConsole, parseLaunchedPid,
parseStandalonePlaytestArgs, PlaytestBridgeError, PlaytestCliUsageError,
playtestStepDrivesMovement, PlaywrightTransport, preflightDisplay, reconcileBrowserPointers,
recordToScenario, requireAssertions, resolveBrowserArguments, resolveManagedServerCommand,
rotatedTouchPosition, runAndroidPlaytest, runDesktopPlaytest, runDevicePlaytest, runIosPlaytest,
runStandalonePlaytest, runStandalonePlaytests, softwareAdapterName, substituteManagedPort,
validateDeviceEndpoint, writeCaptureProvenance, writeObservationArtifacts, XcrunIosDriver
@threenative/playtest/three: adviseThreeRenderWorkload, connectDevicePlaytestBridge,
installThreePlaytestBridge, measureThreePose, readPlaytestEndpoint,
ThreePlaytestPhysicsRecorder
@threenative/ui: DebugOverlay, GameCanvas, useGameState
```

The subpath offender is explicitly present as `NavigationAgent3D` under
`@threenative/physics/navigation`; this is the observed red control for the subpath walk. The
same real export set now generates 110 documented entries.
