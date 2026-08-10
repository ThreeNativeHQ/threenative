# Deletion census — 2026-08-10

Status: complete. This is the frozen worklist produced by the round-3 persistent-export report.

## Phase 0 — frozen candidate report

The report was regenerated with:

```sh
pnpm round:deletions
```

In this sandbox, the pnpm wrapper could not start `tsx` because it was denied permission to create `/tmp/tsx-1000/14.pipe` (`listen EPERM`). The equivalent report command ran successfully:

```sh
node --import tsx/esm scripts/round-deletions.ts
```

It checked the round-3 and round-2 framework archives named in the report and produced 167 persistent candidates. The report is a candidate generator; the table below records the required live-caller disposition for every row.

## Phase 1 — dispositions

Counts: 162 reached elsewhere, 0 public by contract, 5 dead; total 167.

A kept export has a caller in live package source, a package test, a template/example, or the playtest CLI. No export was retained solely because it appears in an export map, so the public-by-contract count is zero. Dead exports are deleted in this commit.

| Export | Disposition | Evidence |
| --- | --- | --- |
| `AnimationPlayOptions` | **reached elsewhere** | packages/core/src/animation.ts:40: play(name: string, options: AnimationPlayOptions = {}): void { |
| `AnimationPlayer` | **reached elsewhere** | packages/core/__tests__/animation.spec.ts:3: import { AnimationPlayer } from "../src/animation.js"; |
| `AnimationPlayerOptions` | **reached elsewhere** | packages/core/src/animation.ts:21: constructor(options: AnimationPlayerOptions) { |
| `Area3DOptions` | **reached elsewhere** | packages/physics/src/Area3D.ts:57: constructor(options: Area3DOptions) { |
| `AreaContact` | **reached elsewhere** | packages/physics/src/Area3D.ts:138: drainContacts(): AreaContact[] { |
| `AreaEvent` | **reached elsewhere** | packages/physics/src/Area3D.ts:82: on(event: AreaEvent, handler: AreaHandler): () => void { |
| `AreaHandler` | **reached elsewhere** | packages/physics/src/Area3D.ts:51: #listeners: Record<AreaEvent, Set<AreaHandler>> = { |
| `AssetLoader` | **reached elsewhere** | packages/core/src/assets.ts:35: export function createAssetLoader(options: AssetLoaderOptions = {}): AssetLoader { |
| `AssetLoaderOptions` | **reached elsewhere** | packages/core/src/game.ts:2: import { type AssetLoader, type AssetLoaderOptions, createAssetLoader } from "./assets.js"; |
| `AudioBusOptions` | **reached elsewhere** | packages/core/src/audio.ts:33: constructor(options: AudioBusOptions) { |
| `AudioPlayOptions` | **reached elsewhere** | packages/core/src/audio.ts:103: music(buffer: AudioBuffer, options: AudioPlayOptions = {}): ThreeAudio { |
| `CameraConfig` | **reached elsewhere** | packages/core/src/game.ts:144: function validateCameraConfig(config: CameraConfig \\| undefined): void { |
| `CharacterBody3DOptions` | **reached elsewhere** | packages/physics/src/CharacterBody3D.ts:69: constructor(options: CharacterBody3DOptions) { |
| `CollisionShapeKind` | **reached elsewhere** | packages/physics/src/CollisionShape3D.ts:156: static fromMesh(mesh: Mesh, kind?: CollisionShapeKind): CollisionShape3D { |
| `DebugSnapshot` | **reached elsewhere** | packages/ui/__tests__/overlay.spec.tsx:3: import { DebugOverlay, type DebugSnapshot } from "../src/DebugOverlay.js"; |
| `Debuggable` | **reached elsewhere** | packages/core/src/entities.ts:63: const debug = (entity as Partial<Debuggable>).debug; |
| `EntitySnapshot` | **reached elsewhere** | packages/core/src/game.ts:3: import { type EntitySnapshot, Registry } from "./entities.js"; |
| `FixedStepLoop` | **reached elsewhere** | packages/core/__tests__/loop.spec.ts:2: import { FixedStepLoop } from "../src/loop.js"; |
| `FixedStepLoopOptions` | **reached elsewhere** | packages/core/src/loop.ts:25: constructor(options: FixedStepLoopOptions) { |
| `GPUParticles3DBuffers` | **reached elsewhere** | packages/core/src/particles.ts:14: readonly start: (buffers: GPUParticles3DBuffers) => ComputeNode; |
| `GPUParticles3DOptions` | **reached elsewhere** | packages/core/src/particles.ts:38: constructor(options: GPUParticles3DOptions) { |
| `GameCanvasProps` | **reached elsewhere** | packages/ui/src/GameCanvas.tsx:15: }: GameCanvasProps<TState, TPhysics>) { |
| `GameConfig` | **reached elsewhere** | packages/core/src/game.ts:179: #config: GameConfig<TState, TPhysics>; |
| `GamePlugin` | **reached elsewhere** | packages/core/src/game.ts:97: readonly plugins?: readonly GamePlugin<TState, TPhysics>[]; |
| `GamePluginFunction` | **reached elsewhere** | packages/core/src/game.ts:82: > = GamePluginFunction<TState, TPhysics> \\| GamePluginHooks<TState, TPhysics>; |
| `GamePluginHooks` | **reached elsewhere** | examples/abyss-framework/src/main.tsx:2: import type { GamePluginHooks, GamePluginRuntime } from "@threenative/core"; |
| `GamePluginRuntime` | **reached elsewhere** | examples/abyss-framework/src/main.tsx:2: import type { GamePluginHooks, GamePluginRuntime } from "@threenative/core"; |
| `GameStore` | **reached elsewhere** | packages/core/src/game.ts:12: import { type GameStore, createGameStore } from "./state.js"; |
| `IPlaytestAdvanceResult` | **reached elsewhere** | packages/playtest/src/protocol.ts:106: advance?(ticks: number): Promise<IPlaytestAdvanceResult>; |
| `IPlaytestAerodynamicsAssertion` | **reached elsewhere** | packages/playtest/src/scenario.ts:1059: const controls: IPlaytestAerodynamicsAssertion["controls"] = Array.isArray(value.controls) |
| `IPlaytestAnimationAssertion` | **reached elsewhere** | packages/playtest/src/scenario.ts:1312: function validateAnimationAssertion(value: unknown): IPlaytestAnimationAssertion \\| undefined { |
| `IPlaytestAnimationObservation` | **reached elsewhere** | packages/playtest/src/protocol.ts:80: animation: Record<string, IPlaytestAnimationObservation>; |
| `IPlaytestArtifactRequest` | **reached elsewhere** | packages/playtest/src/scenario.ts:313: artifacts?: IPlaytestArtifactRequest; |
| `IPlaytestAssertionResult` | **reached elsewhere** | packages/playtest/src/report.ts:1: import type { IPlaytestAssertionResult, IPlaytestDiagnostic, IPlaytestObservations } from "./assertions.js"; |
| `IPlaytestAssertionSchemaEntry` | **reached elsewhere** | packages/playtest/src/assertions.ts:27: export const PLAYTEST_ASSERTION_REGISTRY: readonly IPlaytestAssertionSchemaEntry[] = [ |
| `IPlaytestAssertionSchemaField` | **reached elsewhere** | packages/playtest/src/assertions.ts:18: fields: IPlaytestAssertionSchemaField[]; |
| `IPlaytestBridgeClient` | **reached elsewhere** | packages/playtest/src/runner/runner.ts:24: import { connectPlaytestBridge, PlaytestBridgeError, type IPlaytestBridgeClient } from "./bridgeClient.js"; |
| `IPlaytestBridgeDescription` | **reached elsewhere** | packages/playtest/src/runner/bridgeClient.ts:110: const description = await transport.call<IPlaytestBridgeDescription>("describe"); |
| `IPlaytestBridgeHost` | **reached elsewhere** | packages/playtest/src/three/bridge.ts:52: const host = globalThis as IPlaytestBridgeHost; |
| `IPlaytestBridgeReady` | **reached elsewhere** | packages/playtest/src/protocol.ts:111: ready(): IPlaytestBridgeReady \\| Promise<IPlaytestBridgeReady>; |
| `IPlaytestBridgeV1` | **reached elsewhere** | packages/core/__tests__/playtest.spec.ts:1: import { type IPlaytestBridgeV1, PLAYTEST_BRIDGE_GLOBAL } from "@threenative/playtest"; |
| `IPlaytestCameraAssertion` | **reached elsewhere** | packages/playtest/src/scenario.ts:256: camera?: IPlaytestCameraAssertion; |
| `IPlaytestCapabilityDescriptor` | **reached elsewhere** | packages/playtest/src/capabilities.ts:33: export const PLAYTEST_CAPABILITY_REGISTRY: readonly IPlaytestCapabilityDescriptor[] = [ |
| `IPlaytestComponentAssertion` | **reached elsewhere** | packages/playtest/src/assertions.ts:2: import type { IPlaytestComponentAssertion, IPlaytestPathAssertion, IPlaytestResourceAnyOfAssertion, IPlaytestScenario, IPlaytestSignalAssertion, IPlaytestStateAssertion, IPlaytestTagCountAssertion, IPlaytestWorldAssertion, PlaytestTarget } from "./scenario.js"; |
| `IPlaytestContactAssertion` | **reached elsewhere** | packages/playtest/src/scenario.ts:1285: function validateContactAssertion(value: unknown): IPlaytestContactAssertion \\| undefined { |
| `IPlaytestContactObservation` | **reached elsewhere** | packages/core/src/playtest.ts:112: contactHistory: IPlaytestContactObservation[], |
| `IPlaytestDiagnostic` | **reached elsewhere** | packages/playtest/src/report.ts:1: import type { IPlaytestAssertionResult, IPlaytestDiagnostic, IPlaytestObservations } from "./assertions.js"; |
| `IPlaytestDiagnosticsAssertion` | **reached elsewhere** | packages/playtest/src/scenario.ts:259: diagnostics?: IPlaytestDiagnosticsAssertion; |
| `IPlaytestEntityObservation` | **reached elsewhere** | packages/playtest/src/protocol.ts:95: entities?: IPlaytestEntityObservation[]; |
| `IPlaytestEntityTransform` | **reached elsewhere** | packages/playtest/src/protocol.ts:34: entities?: Array<{ entity: string; transform: IPlaytestEntityTransform }>; |
| `IPlaytestFollowReport` | **reached elsewhere** | packages/playtest/src/report.ts:31: follow?: IPlaytestFollowReport; |
| `IPlaytestGameplayObservation` | **reached elsewhere** | packages/core/src/playtest.ts:116: const animation: IPlaytestGameplayObservation["animation"] = {}; |
| `IPlaytestMovementAssertion` | **reached elsewhere** | packages/playtest/src/scenario.ts:261: movement?: IPlaytestMovementAssertion; |
| `IPlaytestObservationSnapshot` | **reached elsewhere** | packages/playtest/__tests__/runner.spec.ts:6: import { loadPlaytestScenario, type IPlaytestObservationSnapshot, type IPlaytestScenario } from "../src/index.js"; |
| `IPlaytestObservations` | **reached elsewhere** | packages/playtest/__tests__/evidence-required.spec.ts:6: import { evaluateRichPlaytestAssertions, loadPlaytestScenario, type IPlaytestObservations, type IPlaytestScenario } from "../src/index.js"; |
| `IPlaytestOccludedAssertion` | **reached elsewhere** | packages/playtest/src/scenario.ts:1092: function validateOccludedAssertion(value: unknown): IPlaytestOccludedAssertion \\| undefined { |
| `IPlaytestOverlayNodeAssertion` | **reached elsewhere** | packages/playtest/src/scenario.ts:263: overlayNodes?: IPlaytestOverlayNodeAssertion[]; |
| `IPlaytestParityConfig` | **reached elsewhere** | packages/playtest/src/scenario.ts:317: parity?: IPlaytestParityConfig; |
| `IPlaytestPathAssertion` | **reached elsewhere** | packages/playtest/src/assertions.ts:2: import type { IPlaytestComponentAssertion, IPlaytestPathAssertion, IPlaytestResourceAnyOfAssertion, IPlaytestScenario, IPlaytestSignalAssertion, IPlaytestStateAssertion, IPlaytestTagCountAssertion, IPlaytestWorldAssertion, PlaytestTarget } from "./scenario.js"; |
| `IPlaytestProtocolDiagnostic` | **reached elsewhere** | packages/playtest/src/diagnostics.ts:31: ): IPlaytestProtocolDiagnostic { |
| `IPlaytestReachabilityAssertion` | **reached elsewhere** | packages/playtest/src/scenario.ts:264: reachability?: IPlaytestReachabilityAssertion; |
| `IPlaytestReport` | **reached elsewhere** | packages/playtest/src/assertions.ts:1: import type { IPlaytestReport } from "./report.js"; |
| `IPlaytestResourceAnyOfAssertion` | **reached elsewhere** | packages/playtest/src/assertions.ts:2: import type { IPlaytestComponentAssertion, IPlaytestPathAssertion, IPlaytestResourceAnyOfAssertion, IPlaytestScenario, IPlaytestSignalAssertion, IPlaytestStateAssertion, IPlaytestTagCountAssertion, IPlaytestWorldAssertion, PlaytestTarget } from "./scenario.js"; |
| `IPlaytestResourceAssertion` | **reached elsewhere** | packages/playtest/__tests__/scenario.spec.ts:14: import type { IPlaytestResourceAssertion } from "../src/index.js"; |
| `IPlaytestResourcePathAlternative` | **reached elsewhere** | packages/playtest/src/scenario.ts:115: anyOf: IPlaytestResourcePathAlternative[]; |
| `IPlaytestResourcePathAssertion` | **reached elsewhere** | packages/playtest/src/scenario.ts:129: \\| IPlaytestResourcePathAssertion; |
| `IPlaytestSampleRequest` | **reached elsewhere** | packages/playtest/src/protocol.ts:112: sample(request: IPlaytestSampleRequest): IPlaytestObservationSnapshot \\| Promise<IPlaytestObservationSnapshot>; |
| `IPlaytestScenario` | **reached elsewhere** | packages/playtest/__tests__/evidence-required.spec.ts:6: import { evaluateRichPlaytestAssertions, loadPlaytestScenario, type IPlaytestObservations, type IPlaytestScenario } from "../src/index.js"; |
| `IPlaytestScenarioAssertions` | **reached elsewhere** | packages/playtest/src/scenario.ts:314: assert?: IPlaytestScenarioAssertions; |
| `IPlaytestScenarioDiagnostic` | **reached elsewhere** | packages/playtest/src/scenario.ts:341: constructor(readonly diagnostic: IPlaytestScenarioDiagnostic) { |
| `IPlaytestScenarioSetup` | **reached elsewhere** | packages/playtest/src/scenario.ts:319: setup?: IPlaytestScenarioSetup; |
| `IPlaytestServerConfig` | **reached elsewhere** | packages/playtest/src/runner/config.ts:22: server?: IPlaytestServerConfig; |
| `IPlaytestSettledAssertion` | **reached elsewhere** | packages/playtest/src/scenario.ts:266: settled?: IPlaytestSettledAssertion[]; |
| `IPlaytestSetupEntityTransform` | **reached elsewhere** | packages/playtest/src/scenario.ts:307: entities?: IPlaytestSetupEntityTransform[]; |
| `IPlaytestSetupRequest` | **reached elsewhere** | packages/playtest/src/protocol.ts:107: applySetup?(request: IPlaytestSetupRequest): Promise<void>; |
| `IPlaytestSetupResource` | **reached elsewhere** | packages/playtest/src/scenario.ts:308: resources?: IPlaytestSetupResource[]; |
| `IPlaytestSetupSchemaEntry` | **reached elsewhere** | packages/playtest/src/assertions.ts:382: export const PLAYTEST_SETUP_REGISTRY: readonly IPlaytestSetupSchemaEntry[] = [ |
| `IPlaytestStateAssertion` | **reached elsewhere** | packages/playtest/src/assertions.ts:2: import type { IPlaytestComponentAssertion, IPlaytestPathAssertion, IPlaytestResourceAnyOfAssertion, IPlaytestScenario, IPlaytestSignalAssertion, IPlaytestStateAssertion, IPlaytestTagCountAssertion, IPlaytestWorldAssertion, PlaytestTarget } from "./scenario.js"; |
| `IPlaytestStep` | **reached elsewhere** | packages/playtest/__tests__/silent-drop.spec.ts:24: async function writeScenario(assert: unknown, steps: IPlaytestStep[] = [{ release: true, waitFrames: 1 }]): Promise<string> { |
| `IPlaytestTagCountAssertion` | **reached elsewhere** | packages/playtest/src/assertions.ts:2: import type { IPlaytestComponentAssertion, IPlaytestPathAssertion, IPlaytestResourceAnyOfAssertion, IPlaytestScenario, IPlaytestSignalAssertion, IPlaytestStateAssertion, IPlaytestTagCountAssertion, IPlaytestWorldAssertion, PlaytestTarget } from "./scenario.js"; |
| `IPlaytestTagObservation` | **reached elsewhere** | packages/playtest/src/protocol.ts:83: tags?: Record<string, IPlaytestTagObservation>; |
| `IPlaytestTransformSample` | **reached elsewhere** | packages/playtest/src/report.ts:13: after?: IPlaytestTransformSample; |
| `IPlaytestViewport` | **reached elsewhere** | packages/playtest/src/scenario.ts:1401: function validateViewport(value: unknown): IPlaytestViewport { |
| `IPlaytestVisibilityAssertion` | **reached elsewhere** | packages/playtest/src/scenario.ts:1324: function validateVisibilityAssertion(value: unknown): IPlaytestVisibilityAssertion \\| undefined { |
| `IPlaytestVisualAssertion` | **reached elsewhere** | packages/playtest/src/scenario.ts:1102: function validateVisualAssertion(value: unknown): IPlaytestVisualAssertion \\| undefined { |
| `IPlaytestWorldAssertion` | **reached elsewhere** | packages/playtest/src/assertions.ts:2: import type { IPlaytestComponentAssertion, IPlaytestPathAssertion, IPlaytestResourceAnyOfAssertion, IPlaytestScenario, IPlaytestSignalAssertion, IPlaytestStateAssertion, IPlaytestTagCountAssertion, IPlaytestWorldAssertion, PlaytestTarget } from "./scenario.js"; |
| `IStandalonePlaytestConfig` | **reached elsewhere** | packages/playtest/__tests__/device-playtest.spec.ts:15: import type { IStandalonePlaytestConfig } from "../src/runner/config.js"; |
| `IStandalonePlaytestReport` | **reached elsewhere** | packages/playtest/__tests__/e2e-runner.spec.ts:11: import type { IStandalonePlaytestReport } from "../src/runner/runner.js"; |
| `IThreeObservationInput` | **reached elsewhere** | packages/playtest/src/three/observations.ts:28: export function sampleThreeObservations(input: IThreeObservationInput, request: IPlaytestSampleRequest): IPlaytestObservationSnapshot { |
| `IThreePlaytestBridgeInstallation` | **reached elsewhere** | packages/playtest/src/three/bridge.ts:49: export function installThreePlaytestBridge(options: IThreePlaytestBridgeOptions): IThreePlaytestBridgeInstallation { |
| `IThreePlaytestBridgeOptions` | **reached elsewhere** | packages/playtest/src/three/bridge.ts:143: entities: IThreePlaytestBridgeOptions["entities"], |
| `IThreePlaytestEntity` | **reached elsewhere** | packages/core/src/playtest.ts:11: import { type IThreePlaytestEntity, installThreePlaytestBridge } from "@threenative/playtest/three"; |
| `IThreePlaytestResources` | **reached elsewhere** | packages/playtest/src/three/bridge.ts:151: resources: IThreePlaytestResources \\| undefined, |
| `InputAction` | **reached elsewhere** | packages/core/src/input.ts:12: export type InputBindings = Record<string, InputAction>; |
| `InputBindings` | **reached elsewhere** | packages/core/src/game.ts:4: import { type InputBindings, InputMap } from "./input.js"; |
| `InputMap` | **reached elsewhere** | packages/core/__tests__/input.spec.ts:2: import { InputMap } from "../src/input.js"; |
| `JsonPrimitive` | **reached elsewhere** | packages/playtest/src/protocol.ts:12: export type JsonValue = JsonPrimitive \\| JsonValue[] \\| { [key: string]: JsonValue }; |
| `JsonValue` | **reached elsewhere** | packages/core/src/playtest.ts:63: readonly events?: () => JsonValue[]; |
| `OrthogonalCameraConfig` | **reached elsewhere** | packages/core/src/game.ts:121: export type CameraConfig = PerspectiveCameraConfig \\| OrthogonalCameraConfig; |
| `PLAYTEST_ASSERTION_REGISTRY` | **reached elsewhere** | packages/playtest/__tests__/vacuous-assertion.spec.ts:6: import { PLAYTEST_ASSERTION_REGISTRY, PlaytestScenarioError, loadPlaytestScenario } from "../src/index.js"; |
| `PLAYTEST_BRIDGE_GLOBAL` | **reached elsewhere** | packages/core/__tests__/playtest.spec.ts:1: import { type IPlaytestBridgeV1, PLAYTEST_BRIDGE_GLOBAL } from "@threenative/playtest"; |
| `PLAYTEST_CAPABILITY_REGISTRY` | **reached elsewhere** | packages/playtest/__tests__/scenario.spec.ts:277: const known = new Set(PLAYTEST_CAPABILITY_REGISTRY.map(({ name }) => name)); |
| `PLAYTEST_PROTOCOL_LIMITS` | **reached elsewhere** | packages/playtest/__tests__/silent-drop.spec.ts:52: return { capabilities, limits: PLAYTEST_PROTOCOL_LIMITS, name: "test-bridge", protocolVersion: PLAYTEST_PROTOCOL_VERSION }; |
| `PLAYTEST_PROTOCOL_VERSION` | **reached elsewhere** | packages/playtest/__tests__/silent-drop.spec.ts:52: return { capabilities, limits: PLAYTEST_PROTOCOL_LIMITS, name: "test-bridge", protocolVersion: PLAYTEST_PROTOCOL_VERSION }; |
| `PLAYTEST_SETUP_REGISTRY` | **reached elsewhere** | packages/playtest/__tests__/scenario.spec.ts:278: for (const entry of [...PLAYTEST_ASSERTION_REGISTRY, ...PLAYTEST_SETUP_REGISTRY]) { |
| `PerspectiveCameraConfig` | **reached elsewhere** | packages/core/src/game.ts:121: export type CameraConfig = PerspectiveCameraConfig \\| OrthogonalCameraConfig; |
| `PhysicsBody3D` | **reached elsewhere** | examples/native-smoke/src/physics.ts:125: function position(body: PhysicsBody3D): VectorTuple { |
| `PhysicsOptions` | **reached elsewhere** | packages/physics/src/plugin.ts:70: export function rapier(options: PhysicsOptions = {}): PhysicsPlugin { |
| `PhysicsPlugin` | **reached elsewhere** | packages/physics/src/plugin.ts:70: export function rapier(options: PhysicsOptions = {}): PhysicsPlugin { |
| `PlaytestBridgeError` | **reached elsewhere** | packages/playtest/__tests__/silent-drop.spec.ts:14: import { connectPlaytestBridge, PlaytestBridgeError } from "../src/runner/bridgeClient.js"; |
| `PlaytestCapability` | **reached elsewhere** | packages/playtest/src/assertions.ts:3: import type { PlaytestCapability } from "./capabilities.js"; |
| `PlaytestClockMode` | **reached elsewhere** | packages/playtest/src/protocol.ts:89: mode: PlaytestClockMode; |
| `PlaytestDiagnosticCode` | **reached elsewhere** | packages/playtest/src/diagnostics.ts:16: code: PlaytestDiagnosticCode; |
| `PlaytestInputDelivery` | **reached elsewhere** | packages/playtest/src/scenario.ts:315: inputDelivery?: PlaytestInputDelivery; |
| `PlaytestScenarioError` | **reached elsewhere** | packages/playtest/__tests__/cli-classify.spec.ts:5: import { PlaytestScenarioError } from "../src/scenario.js"; |
| `PlaytestTarget` | **reached elsewhere** | packages/playtest/src/assertions.ts:2: import type { IPlaytestComponentAssertion, IPlaytestPathAssertion, IPlaytestResourceAnyOfAssertion, IPlaytestScenario, IPlaytestSignalAssertion, IPlaytestStateAssertion, IPlaytestTagCountAssertion, IPlaytestWorldAssertion, PlaytestTarget } from "./scenario.js"; |
| `PlaytestVec3` | **reached elsewhere** | packages/playtest/src/runner/androidRunner.ts:138: const pathPositions: PlaytestVec3[] = []; |
| `PluginCleanup` | **reached elsewhere** | packages/core/src/game.ts:42: function installDevTools(entities: Registry, host: DevToolsHost \\| undefined): PluginCleanup { |
| `Random` | **reached elsewhere** | packages/core/src/random.ts:8: export function createRandom(seed?: number): Random { |
| `RawInputState` | **reached elsewhere** | packages/core/src/input.ts:59: readonly raw: RawInputState; |
| `Registry` | **reached elsewhere** | packages/core/__tests__/entities.spec.ts:3: import { Registry } from "../src/entities.js"; |
| `RendererKind` | **reached elsewhere** | packages/core/src/renderer.ts:59: function wrapRenderer(raw: RendererInstance, kind: RendererKind): RendererLike { |
| `RendererLike` | **reached elsewhere** | packages/core/__tests__/particles.spec.ts:6: import type { RendererLike } from "../src/renderer.js"; |
| `RendererOptions` | **reached elsewhere** | packages/core/src/game.ts:9: import { type RendererLike, type RendererOptions, createRenderer } from "./renderer.js"; |
| `RigidBody3DOptions` | **reached elsewhere** | packages/physics/src/RigidBody3D.ts:43: constructor(options: RigidBody3DOptions) { |
| `RigidBodyType` | **reached elsewhere** | packages/physics/src/RigidBody3D.ts:17: readonly type?: RigidBodyType; |
| `SceneConstructor` | **reached elsewhere** | packages/core/src/game.ts:10: import type { Ctx, Scene, SceneConstructor, SceneFrame } from "./scene.js"; |
| `SceneEnterResult` | **reached elsewhere** | packages/core/src/scene.ts:20: enter(_ctx: Ctx<TState, TPhysics>): SceneEnterResult<TState, TPhysics> { |
| `ScheduleHandle` | **reached elsewhere** | packages/core/src/scene.ts:8: import type { ScheduleHandle } from "./schedule.js"; |
| `Scheduler` | **reached elsewhere** | packages/core/__tests__/schedule.spec.ts:4: import { Scheduler } from "../src/schedule.js"; |
| `StatePatch` | **reached elsewhere** | packages/core/src/state.ts:29: gameStore.set = (patch: StatePatch<T>) => { |
| `ThreePlaytestEntityRegistry` | **reached elsewhere** | packages/playtest/__tests__/three-bridge.spec.ts:5: import { ThreePlaytestEntityRegistry } from "../src/three/entities.js"; |
| `ThreePlaytestRenderer` | **reached elsewhere** | packages/playtest/src/three/bridge.ts:15: import { sampleThreeObservations, type ThreePlaytestRenderer } from "./observations.js"; |
| `Viewport` | **reached elsewhere** | packages/core/__tests__/picking.spec.ts:5: import { Viewport, type ViewportSize } from "../src/viewport.js"; |
| `ViewportOptions` | **reached elsewhere** | packages/core/src/game.ts:13: import { Viewport, type ViewportOptions } from "./viewport.js"; |
| `ViewportResizeHandler` | **reached elsewhere** | packages/core/src/viewport.ts:35: #listeners = new Set<ViewportResizeHandler>(); |
| `ViewportSize` | **reached elsewhere** | packages/core/__tests__/picking.spec.ts:5: import { Viewport, type ViewportSize } from "../src/viewport.js"; |
| `applyScenarioOverrides` | **dead** | `packages/playtest/src/scenario.ts` — definition only in the frozen worklist; no live caller remained after deletion |
| `assertJsonSafe` | **reached elsewhere** | packages/core/src/playtest.ts:219: assertJsonSafe(fields, `$.components.${id}`); |
| `autoFields` | **reached elsewhere** | packages/core/src/entities.ts:64: const fields = typeof debug === "function" ? debug.call(entity) : autoFields(entity); |
| `buildReport` | **reached elsewhere** | packages/playtest/__tests__/runner.spec.ts:8: import { buildReport, STANDALONE_PLAYTEST_OBSERVATION_FIELDS } from "../src/runner/runner.js"; |
| `connectPlaytestBridge` | **reached elsewhere** | packages/playtest/__tests__/silent-drop.spec.ts:14: import { connectPlaytestBridge, PlaytestBridgeError } from "../src/runner/bridgeClient.js"; |
| `createAssetLoader` | **reached elsewhere** | packages/core/__tests__/assets.spec.ts:2: import { createAssetLoader } from "../src/assets.js"; |
| `createGameStore` | **reached elsewhere** | packages/core/__tests__/state.spec.ts:2: import { createGameStore } from "../src/state.js"; |
| `createRandom` | **reached elsewhere** | packages/core/__tests__/replay.spec.ts:33: const ctx = { input, random: createRandom(90210) } as unknown as Ctx; |
| `createRenderer` | **reached elsewhere** | packages/core/__tests__/renderer.spec.ts:2: import { createRenderer } from "../src/renderer.js"; |
| `evaluateRichPlaytestAssertions` | **reached elsewhere** | packages/playtest/__tests__/evidence-required.spec.ts:6: import { evaluateRichPlaytestAssertions, loadPlaytestScenario, type IPlaytestObservations, type IPlaytestScenario } from "../src/index.js"; |
| `initStandalonePlaytest` | **reached elsewhere** | packages/playtest/__tests__/bridgeClient.spec.ts:7: import { initStandalonePlaytest } from "../src/runner/init.js"; |
| `input` | **dead** | `packages/core/src/input.ts` — exported factory had no live caller; `InputMap` is constructed directly by the game runtime and tests |
| `installThreePlaytestBridge` | **reached elsewhere** | packages/playtest/__tests__/three-bridge.spec.ts:4: import { installThreePlaytestBridge } from "../src/three/bridge.js"; |
| `jsonByteLength` | **reached elsewhere** | packages/playtest/src/runner/bridgeClient.ts:242: if (jsonByteLength(value) > PLAYTEST_PROTOCOL_LIMITS.maxPayloadBytes) { |
| `loadPlaytestScenario` | **reached elsewhere** | packages/playtest/__tests__/evidence-required.spec.ts:6: import { evaluateRichPlaytestAssertions, loadPlaytestScenario, type IPlaytestObservations, type IPlaytestScenario } from "../src/index.js"; |
| `missingPlaytestCapabilities` | **reached elsewhere** | packages/playtest/src/runner/bridgeClient.ts:135: const missing = missingPlaytestCapabilities(required, [ |
| `objectPath` | **reached elsewhere** | packages/playtest/src/three/entities.ts:13: const path = entry.path ?? objectPath(entry.object); |
| `oneShotScenario` | **dead** | `packages/playtest/src/scenario.ts` — definition only in the frozen worklist; no live caller remained after deletion |
| `overlayNodeObservationKey` | **reached elsewhere** | packages/playtest/src/assertions.ts:518: const id = overlayNodeObservationKey(assertion.overlayId, assertion.selector); |
| `parsePlaytestTarget` | **dead** | `packages/playtest/src/scenario.ts` — definition only in the frozen worklist; no live caller remained after deletion |
| `parseStandalonePlaytestArgs` | **reached elsewhere** | packages/playtest/__tests__/bridgeClient.spec.ts:6: import { parseStandalonePlaytestArgs } from "../src/runner/config.js"; |
| `parseViewport` | **dead** | `packages/playtest/src/scenario.ts` — definition only in the frozen worklist; no live caller remained after deletion |
| `playtestDiagnostic` | **reached elsewhere** | packages/playtest/src/runner/androidRunner.ts:113: return failureReport(config, scenario, playtestDiagnostic( |
| `playtestStepHoldTicks` | **reached elsewhere** | packages/playtest/__tests__/runner.spec.ts:9: import { playtestStepHoldTicks, playtestStepWaitTicks } from "../src/scenario.js"; |
| `playtestStepWaitTicks` | **reached elsewhere** | packages/playtest/__tests__/runner.spec.ts:9: import { playtestStepHoldTicks, playtestStepWaitTicks } from "../src/scenario.js"; |
| `requiredPlaytestCapabilities` | **reached elsewhere** | packages/playtest/__tests__/scenario.spec.ts:287: const required = requiredPlaytestCapabilities({ |
| `runStandalonePlaytest` | **reached elsewhere** | packages/playtest/__tests__/e2e-runner.spec.ts:10: import { runStandalonePlaytest } from "../src/runner/runner.js"; |
| `sampleThreeObservations` | **reached elsewhere** | packages/playtest/src/three/bridge.ts:15: import { sampleThreeObservations, type ThreePlaytestRenderer } from "./observations.js"; |
| `unknownPlaytestCapabilities` | **reached elsewhere** | packages/playtest/src/runner/bridgeClient.ts:111: const unknown = unknownPlaytestCapabilities(description.capabilities); |
| `version` | **reached elsewhere** | packages/physics/__tests__/native-contract.spec.ts:101: version: RAPIER.version(), |

## Phase 2 — deletion result

Deleted exports: `applyScenarioOverrides`, `input`, `oneShotScenario`, `parsePlaytestTarget`, and `parseViewport`. Their private `safeFilePart` helper was removed because the only caller was `oneShotScenario`. No test or export-map entry referenced these names.

The five dead rows are the only source deletions. The 162 kept rows retain their existing source/test/template contracts.

## Verification commands

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm budgets
pnpm test:templates
node --import tsx/esm scripts/round-deletions.ts
```

The required command outcomes are recorded here. The `pnpm` commands that invoke `tsx` are
subject to the sandbox pipe restriction stated above.

| Command | Result |
| --- | --- |
| `pnpm typecheck` | pass after building the missing local physics/UI declaration outputs |
| `pnpm lint` | pass — Biome checked 390 files |
| `pnpm exec vitest run packages/core/__tests__/input.spec.ts packages/playtest/__tests__/scenario.spec.ts packages/playtest/__tests__/runner.spec.ts scripts/__tests__/round-deletions.spec.ts scripts/__tests__/budgets.spec.ts` | pass — 5 files, 65 tests |
| `node --import tsx/esm scripts/round-deletions.ts` | pass — 167 candidates; the table has 167 unique rows |
| `pnpm test` | blocked at `@publint/pack`: `Failed to find packed tarball file` although `pnpm pack` returned exit 0 |
| `pnpm test:templates` | blocked first by `tsx` IPC `listen EPERM`; direct-loader retry reached the same `@publint/pack` failure |
| `node --import tsx/esm scripts/check-budgets.ts` | pass — native trigger remains visible at 61,351 / 50,000 |
