# Deletion census — 2026-08-10

Status: complete. This is the frozen worklist produced by the round-3 persistent-export report.

## Phase 0 — frozen candidate report

The declared report command was run:

```sh
pnpm round:deletions
```

Observed setup failure:

```text
exit_code=1
Error: listen EPERM: operation not permitted /tmp/tsx-1000/13.pipe
```

The equivalent fail-closed report query ran without the pnpm `tsx` IPC wrapper:

```sh
node --import tsx/esm --input-type=module -e 'import { findPersistentUnusedExports } from "./scripts/round-deletions.ts"; const r = findPersistentUnusedExports(); console.log(JSON.stringify({ currentRound: r.currentRound, previousRound: r.previousRound, candidates: r.candidates.length }, null, 2));'
```

Observed summary:

```json
{
  "currentRound": 3,
  "previousRound": 2,
  "candidates": 167
}
```

The report checked the round-3 and round-2 framework archives named in the instrument output. It
is a candidate generator; the table below records the required caller disposition for every row.

## Phase 1 — dispositions

Counts: 48 reached externally, 114 internal only, 0 public by contract, 5 dead; total 167.

A `reached externally` row has a caller outside its declaring package, including the playtest
CLI's runner subpath; an `internal only` row has callers only in that package's `src` or
`__tests__`. No export was retained solely because it appears in an export map, so the
public-by-contract count is zero. Dead exports are deleted in this commit.

| Export | Disposition | Evidence |
| --- | --- | --- |
| `AnimationPlayOptions` | **internal only** | packages/core/src/animation.ts:40: play(name: string, options: AnimationPlayOptions = {}): void { |
| `AnimationPlayer` | **internal only** | packages/core/__tests__/animation.spec.ts:3: import { AnimationPlayer } from "../src/animation.js"; |
| `AnimationPlayerOptions` | **internal only** | packages/core/src/animation.ts:21: constructor(options: AnimationPlayerOptions) { |
| `Area3DOptions` | **internal only** | packages/physics/src/Area3D.ts:57: constructor(options: Area3DOptions) { |
| `AreaContact` | **internal only** | packages/physics/src/Area3D.ts:138: drainContacts(): AreaContact[] { |
| `AreaEvent` | **internal only** | packages/physics/src/Area3D.ts:82: on(event: AreaEvent, handler: AreaHandler): () => void { |
| `AreaHandler` | **internal only** | packages/physics/src/Area3D.ts:51: #listeners: Record<AreaEvent, Set<AreaHandler>> = { |
| `AssetLoader` | **internal only** | packages/core/src/assets.ts:35: export function createAssetLoader(options: AssetLoaderOptions = {}): AssetLoader { |
| `AssetLoaderOptions` | **internal only** | packages/core/src/game.ts:2: import { type AssetLoader, type AssetLoaderOptions, createAssetLoader } from "./assets.js"; |
| `AudioBusOptions` | **internal only** | packages/core/src/audio.ts:33: constructor(options: AudioBusOptions) { |
| `AudioPlayOptions` | **internal only** | packages/core/src/audio.ts:103: music(buffer: AudioBuffer, options: AudioPlayOptions = {}): ThreeAudio { |
| `CameraConfig` | **internal only** | packages/core/src/game.ts:144: function validateCameraConfig(config: CameraConfig \\| undefined): void { |
| `CharacterBody3DOptions` | **internal only** | packages/physics/src/CharacterBody3D.ts:69: constructor(options: CharacterBody3DOptions) { |
| `CollisionShapeKind` | **internal only** | packages/physics/src/CollisionShape3D.ts:156: static fromMesh(mesh: Mesh, kind?: CollisionShapeKind): CollisionShape3D { |
| `DebugSnapshot` | **internal only** | packages/ui/__tests__/overlay.spec.tsx:3: import { DebugOverlay, type DebugSnapshot } from "../src/DebugOverlay.js"; |
| `Debuggable` | **internal only** | packages/core/src/entities.ts:63: const debug = (entity as Partial<Debuggable>).debug; |
| `EntitySnapshot` | **internal only** | packages/core/src/game.ts:3: import { type EntitySnapshot, Registry } from "./entities.js"; |
| `FixedStepLoop` | **internal only** | packages/core/__tests__/loop.spec.ts:2: import { FixedStepLoop } from "../src/loop.js"; |
| `FixedStepLoopOptions` | **internal only** | packages/core/src/loop.ts:25: constructor(options: FixedStepLoopOptions) { |
| `GPUParticles3DBuffers` | **internal only** | packages/core/src/particles.ts:14: readonly start: (buffers: GPUParticles3DBuffers) => ComputeNode; |
| `GPUParticles3DOptions` | **internal only** | packages/core/src/particles.ts:38: constructor(options: GPUParticles3DOptions) { |
| `GameCanvasProps` | **internal only** | packages/ui/src/GameCanvas.tsx:15: }: GameCanvasProps<TState, TPhysics>) { |
| `GameConfig` | **internal only** | packages/core/src/game.ts:179: #config: GameConfig<TState, TPhysics>; |
| `GamePlugin` | **internal only** | packages/core/src/game.ts:97: readonly plugins?: readonly GamePlugin<TState, TPhysics>[]; |
| `GamePluginFunction` | **internal only** | packages/core/src/game.ts:82: > = GamePluginFunction<TState, TPhysics> \\| GamePluginHooks<TState, TPhysics>; |
| `GamePluginHooks` | **reached externally** | examples/abyss-framework/src/main.tsx:2: import type { GamePluginHooks, GamePluginRuntime } from "@threenative/core"; |
| `GamePluginRuntime` | **reached externally** | examples/abyss-framework/src/main.tsx:2: import type { GamePluginHooks, GamePluginRuntime } from "@threenative/core"; |
| `GameStore` | **internal only** | packages/core/src/game.ts:12: import { type GameStore, createGameStore } from "./state.js"; |
| `IPlaytestAdvanceResult` | **internal only** | packages/playtest/src/protocol.ts:106: advance?(ticks: number): Promise<IPlaytestAdvanceResult>; |
| `IPlaytestAerodynamicsAssertion` | **internal only** | packages/playtest/src/scenario.ts:1059: const controls: IPlaytestAerodynamicsAssertion["controls"] = Array.isArray(value.controls) |
| `IPlaytestAnimationAssertion` | **internal only** | packages/playtest/src/scenario.ts:1312: function validateAnimationAssertion(value: unknown): IPlaytestAnimationAssertion \\| undefined { |
| `IPlaytestAnimationObservation` | **internal only** | packages/playtest/src/protocol.ts:80: animation: Record<string, IPlaytestAnimationObservation>; |
| `IPlaytestArtifactRequest` | **internal only** | packages/playtest/src/scenario.ts:313: artifacts?: IPlaytestArtifactRequest; |
| `IPlaytestAssertionResult` | **reached externally** | packages/playtest/src/runner/runner.ts:11: type IPlaytestAssertionResult, |
| `IPlaytestAssertionSchemaEntry` | **internal only** | packages/playtest/src/assertions.ts:27: export const PLAYTEST_ASSERTION_REGISTRY: readonly IPlaytestAssertionSchemaEntry[] = [ |
| `IPlaytestAssertionSchemaField` | **internal only** | packages/playtest/src/assertions.ts:18: fields: IPlaytestAssertionSchemaField[]; |
| `IPlaytestBridgeClient` | **reached externally** | packages/playtest/src/runner/runner.ts:24: import { connectPlaytestBridge, PlaytestBridgeError, type IPlaytestBridgeClient } from "./bridgeClient.js"; |
| `IPlaytestBridgeDescription` | **reached externally** | packages/playtest/src/runner/bridgeClient.ts:110: const description = await transport.call<IPlaytestBridgeDescription>("describe"); |
| `IPlaytestBridgeHost` | **internal only** | packages/playtest/src/three/bridge.ts:52: const host = globalThis as IPlaytestBridgeHost; |
| `IPlaytestBridgeReady` | **internal only** | packages/playtest/src/protocol.ts:111: ready(): IPlaytestBridgeReady \\| Promise<IPlaytestBridgeReady>; |
| `IPlaytestBridgeV1` | **reached externally** | packages/core/src/playtest.ts:3: type IPlaytestBridgeV1, |
| `IPlaytestCameraAssertion` | **internal only** | packages/playtest/src/scenario.ts:256: camera?: IPlaytestCameraAssertion; |
| `IPlaytestCapabilityDescriptor` | **internal only** | packages/playtest/src/capabilities.ts:33: export const PLAYTEST_CAPABILITY_REGISTRY: readonly IPlaytestCapabilityDescriptor[] = [ |
| `IPlaytestComponentAssertion` | **internal only** | packages/playtest/src/assertions.ts:2: import type { IPlaytestComponentAssertion, IPlaytestPathAssertion, IPlaytestResourceAnyOfAssertion, IPlaytestScenario, IPlaytestSignalAssertion, IPlaytestStateAssertion, IPlaytestTagCountAssertion, IPlaytestWorldAssertion, PlaytestTarget } from "./scenario.js"; |
| `IPlaytestContactAssertion` | **internal only** | packages/playtest/src/scenario.ts:1285: function validateContactAssertion(value: unknown): IPlaytestContactAssertion \\| undefined { |
| `IPlaytestContactObservation` | **reached externally** | packages/core/src/playtest.ts:112: contactHistory: IPlaytestContactObservation[], |
| `IPlaytestDiagnostic` | **reached externally** | packages/playtest/src/runner/runner.ts:12: type IPlaytestDiagnostic, |
| `IPlaytestDiagnosticsAssertion` | **internal only** | packages/playtest/src/scenario.ts:259: diagnostics?: IPlaytestDiagnosticsAssertion; |
| `IPlaytestEntityObservation` | **internal only** | packages/playtest/src/protocol.ts:95: entities?: IPlaytestEntityObservation[]; |
| `IPlaytestEntityTransform` | **internal only** | packages/playtest/src/protocol.ts:34: entities?: Array<{ entity: string; transform: IPlaytestEntityTransform }>; |
| `IPlaytestFollowReport` | **internal only** | packages/playtest/src/report.ts:31: follow?: IPlaytestFollowReport; |
| `IPlaytestGameplayObservation` | **reached externally** | packages/core/src/playtest.ts:116: const animation: IPlaytestGameplayObservation["animation"] = {}; |
| `IPlaytestMovementAssertion` | **internal only** | packages/playtest/src/scenario.ts:261: movement?: IPlaytestMovementAssertion; |
| `IPlaytestObservationSnapshot` | **reached externally** | packages/playtest/src/runner/runner.ts:13: type IPlaytestObservationSnapshot, |
| `IPlaytestObservations` | **reached externally** | packages/playtest/src/runner/runner.ts:14: type IPlaytestObservations, |
| `IPlaytestOccludedAssertion` | **internal only** | packages/playtest/src/scenario.ts:1092: function validateOccludedAssertion(value: unknown): IPlaytestOccludedAssertion \\| undefined { |
| `IPlaytestOverlayNodeAssertion` | **internal only** | packages/playtest/src/scenario.ts:263: overlayNodes?: IPlaytestOverlayNodeAssertion[]; |
| `IPlaytestParityConfig` | **internal only** | packages/playtest/src/scenario.ts:317: parity?: IPlaytestParityConfig; |
| `IPlaytestPathAssertion` | **reached externally** | packages/playtest/src/runner/runner.ts:15: type IPlaytestPathAssertion, |
| `IPlaytestProtocolDiagnostic` | **reached externally** | packages/playtest/src/runner/runner.ts:16: type IPlaytestProtocolDiagnostic, |
| `IPlaytestReachabilityAssertion` | **internal only** | packages/playtest/src/scenario.ts:264: reachability?: IPlaytestReachabilityAssertion; |
| `IPlaytestReport` | **reached externally** | packages/playtest/src/runner/runner.ts:17: type IPlaytestReport, |
| `IPlaytestResourceAnyOfAssertion` | **internal only** | packages/playtest/src/assertions.ts:2: import type { IPlaytestComponentAssertion, IPlaytestPathAssertion, IPlaytestResourceAnyOfAssertion, IPlaytestScenario, IPlaytestSignalAssertion, IPlaytestStateAssertion, IPlaytestTagCountAssertion, IPlaytestWorldAssertion, PlaytestTarget } from "./scenario.js"; |
| `IPlaytestResourceAssertion` | **internal only** | packages/playtest/__tests__/scenario.spec.ts:14: import type { IPlaytestResourceAssertion } from "../src/index.js"; |
| `IPlaytestResourcePathAlternative` | **internal only** | packages/playtest/src/scenario.ts:115: anyOf: IPlaytestResourcePathAlternative[]; |
| `IPlaytestResourcePathAssertion` | **internal only** | packages/playtest/src/scenario.ts:129: \\| IPlaytestResourcePathAssertion; |
| `IPlaytestSampleRequest` | **reached externally** | packages/playtest/src/runner/bridgeClient.ts:14: type IPlaytestSampleRequest, |
| `IPlaytestScenario` | **reached externally** | packages/playtest/src/runner/runner.ts:18: type IPlaytestScenario, |
| `IPlaytestScenarioAssertions` | **internal only** | packages/playtest/src/scenario.ts:314: assert?: IPlaytestScenarioAssertions; |
| `IPlaytestScenarioDiagnostic` | **internal only** | packages/playtest/src/scenario.ts:341: constructor(readonly diagnostic: IPlaytestScenarioDiagnostic) { |
| `IPlaytestScenarioSetup` | **internal only** | packages/playtest/src/scenario.ts:319: setup?: IPlaytestScenarioSetup; |
| `IPlaytestServerConfig` | **reached externally** | packages/playtest/src/runner/config.ts:22: server?: IPlaytestServerConfig; |
| `IPlaytestSettledAssertion` | **internal only** | packages/playtest/src/scenario.ts:266: settled?: IPlaytestSettledAssertion[]; |
| `IPlaytestSetupEntityTransform` | **internal only** | packages/playtest/src/scenario.ts:307: entities?: IPlaytestSetupEntityTransform[]; |
| `IPlaytestSetupRequest` | **reached externally** | packages/playtest/src/runner/runner.ts:19: type IPlaytestSetupRequest, |
| `IPlaytestSetupResource` | **internal only** | packages/playtest/src/scenario.ts:308: resources?: IPlaytestSetupResource[]; |
| `IPlaytestSetupSchemaEntry` | **internal only** | packages/playtest/src/assertions.ts:382: export const PLAYTEST_SETUP_REGISTRY: readonly IPlaytestSetupSchemaEntry[] = [ |
| `IPlaytestStateAssertion` | **internal only** | packages/playtest/src/assertions.ts:2: import type { IPlaytestComponentAssertion, IPlaytestPathAssertion, IPlaytestResourceAnyOfAssertion, IPlaytestScenario, IPlaytestSignalAssertion, IPlaytestStateAssertion, IPlaytestTagCountAssertion, IPlaytestWorldAssertion, PlaytestTarget } from "./scenario.js"; |
| `IPlaytestStep` | **reached externally** | packages/playtest/src/runner/recording.ts:1: import type { IPlaytestScenario, IPlaytestStep } from "../scenario.js"; |
| `IPlaytestTagCountAssertion` | **internal only** | packages/playtest/src/assertions.ts:2: import type { IPlaytestComponentAssertion, IPlaytestPathAssertion, IPlaytestResourceAnyOfAssertion, IPlaytestScenario, IPlaytestSignalAssertion, IPlaytestStateAssertion, IPlaytestTagCountAssertion, IPlaytestWorldAssertion, PlaytestTarget } from "./scenario.js"; |
| `IPlaytestTagObservation` | **internal only** | packages/playtest/src/protocol.ts:83: tags?: Record<string, IPlaytestTagObservation>; |
| `IPlaytestTransformSample` | **internal only** | packages/playtest/src/report.ts:13: after?: IPlaytestTransformSample; |
| `IPlaytestViewport` | **internal only** | packages/playtest/src/scenario.ts:1401: function validateViewport(value: unknown): IPlaytestViewport { |
| `IPlaytestVisibilityAssertion` | **internal only** | packages/playtest/src/scenario.ts:1324: function validateVisibilityAssertion(value: unknown): IPlaytestVisibilityAssertion \\| undefined { |
| `IPlaytestVisualAssertion` | **internal only** | packages/playtest/src/scenario.ts:1102: function validateVisualAssertion(value: unknown): IPlaytestVisualAssertion \\| undefined { |
| `IPlaytestWorldAssertion` | **internal only** | packages/playtest/src/assertions.ts:2: import type { IPlaytestComponentAssertion, IPlaytestPathAssertion, IPlaytestResourceAnyOfAssertion, IPlaytestScenario, IPlaytestSignalAssertion, IPlaytestStateAssertion, IPlaytestTagCountAssertion, IPlaytestWorldAssertion, PlaytestTarget } from "./scenario.js"; |
| `IStandalonePlaytestConfig` | **reached externally** | packages/playtest/src/runner/cli.ts:12: type IStandalonePlaytestConfig, |
| `IStandalonePlaytestReport` | **reached externally** | packages/playtest/src/runner/runner.ts:37: export interface IStandalonePlaytestReport extends IPlaytestReport { |
| `IThreeObservationInput` | **internal only** | packages/playtest/src/three/observations.ts:28: export function sampleThreeObservations(input: IThreeObservationInput, request: IPlaytestSampleRequest): IPlaytestObservationSnapshot { |
| `IThreePlaytestBridgeInstallation` | **internal only** | packages/playtest/src/three/bridge.ts:49: export function installThreePlaytestBridge(options: IThreePlaytestBridgeOptions): IThreePlaytestBridgeInstallation { |
| `IThreePlaytestBridgeOptions` | **internal only** | packages/playtest/src/three/bridge.ts:143: entities: IThreePlaytestBridgeOptions["entities"], |
| `IThreePlaytestEntity` | **reached externally** | packages/core/src/playtest.ts:11: import { type IThreePlaytestEntity, installThreePlaytestBridge } from "@threenative/playtest/three"; |
| `IThreePlaytestResources` | **internal only** | packages/playtest/src/three/bridge.ts:151: resources: IThreePlaytestResources \\| undefined, |
| `InputAction` | **internal only** | packages/core/src/input.ts:12: export type InputBindings = Record<string, InputAction>; |
| `InputBindings` | **internal only** | packages/core/src/game.ts:4: import { type InputBindings, InputMap } from "./input.js"; |
| `InputMap` | **internal only** | packages/core/__tests__/input.spec.ts:2: import { InputMap } from "../src/input.js"; |
| `JsonPrimitive` | **internal only** | packages/playtest/src/protocol.ts:12: export type JsonValue = JsonPrimitive \\| JsonValue[] \\| { [key: string]: JsonValue }; |
| `JsonValue` | **reached externally** | packages/core/src/playtest.ts:63: readonly events?: () => JsonValue[]; |
| `OrthogonalCameraConfig` | **internal only** | packages/core/src/game.ts:121: export type CameraConfig = PerspectiveCameraConfig \\| OrthogonalCameraConfig; |
| `PLAYTEST_ASSERTION_REGISTRY` | **reached externally** | packages/playtest/src/runner/bridgeClient.ts:3: PLAYTEST_ASSERTION_REGISTRY, |
| `PLAYTEST_BRIDGE_GLOBAL` | **reached externally** | packages/playtest/src/runner/bridgeClient.ts:2: PLAYTEST_BRIDGE_GLOBAL, |
| `PLAYTEST_CAPABILITY_REGISTRY` | **reached externally** | packages/playtest/src/runner/bridgeClient.ts:116: register it in PLAYTEST_CAPABILITY_REGISTRY before running the scenario. |
| `PLAYTEST_PROTOCOL_LIMITS` | **reached externally** | packages/core/src/playtest.ts:8: PLAYTEST_PROTOCOL_LIMITS, |
| `PLAYTEST_PROTOCOL_VERSION` | **reached externally** | packages/playtest/src/runner/bridgeClient.ts:5: PLAYTEST_PROTOCOL_VERSION, |
| `PLAYTEST_SETUP_REGISTRY` | **internal only** | packages/playtest/__tests__/scenario.spec.ts:278: for (const entry of [...PLAYTEST_ASSERTION_REGISTRY, ...PLAYTEST_SETUP_REGISTRY]) { |
| `PerspectiveCameraConfig` | **internal only** | packages/core/src/game.ts:121: export type CameraConfig = PerspectiveCameraConfig \\| OrthogonalCameraConfig; |
| `PhysicsBody3D` | **reached externally** | examples/native-smoke/src/physics.ts:125: function position(body: PhysicsBody3D): VectorTuple { |
| `PhysicsOptions` | **internal only** | packages/physics/src/plugin.ts:70: export function rapier(options: PhysicsOptions = {}): PhysicsPlugin { |
| `PhysicsPlugin` | **internal only** | packages/physics/src/plugin.ts:70: export function rapier(options: PhysicsOptions = {}): PhysicsPlugin { |
| `PlaytestBridgeError` | **reached externally** | packages/playtest/src/runner/runner.ts:24: import { connectPlaytestBridge, PlaytestBridgeError, type IPlaytestBridgeClient } from "./bridgeClient.js"; |
| `PlaytestCapability` | **internal only** | packages/playtest/src/assertions.ts:3: import type { PlaytestCapability } from "./capabilities.js"; |
| `PlaytestClockMode` | **internal only** | packages/playtest/src/protocol.ts:89: mode: PlaytestClockMode; |
| `PlaytestDiagnosticCode` | **internal only** | packages/playtest/src/diagnostics.ts:16: code: PlaytestDiagnosticCode; |
| `PlaytestInputDelivery` | **internal only** | packages/playtest/src/scenario.ts:315: inputDelivery?: PlaytestInputDelivery; |
| `PlaytestScenarioError` | **reached externally** | packages/playtest/src/runner/cli.ts:7: import { PlaytestScenarioError } from "../scenario.js"; |
| `PlaytestTarget` | **internal only** | packages/playtest/src/assertions.ts:2: import type { IPlaytestComponentAssertion, IPlaytestPathAssertion, IPlaytestResourceAnyOfAssertion, IPlaytestScenario, IPlaytestSignalAssertion, IPlaytestStateAssertion, IPlaytestTagCountAssertion, IPlaytestWorldAssertion, PlaytestTarget } from "./scenario.js"; |
| `PlaytestVec3` | **reached externally** | packages/playtest/src/runner/androidRunner.ts:138: const pathPositions: PlaytestVec3[] = []; |
| `PluginCleanup` | **internal only** | packages/core/src/game.ts:42: function installDevTools(entities: Registry, host: DevToolsHost \\| undefined): PluginCleanup { |
| `Random` | **internal only** | packages/core/src/random.ts:8: export function createRandom(seed?: number): Random { |
| `RawInputState` | **internal only** | packages/core/src/input.ts:59: readonly raw: RawInputState; |
| `Registry` | **internal only** | packages/core/__tests__/entities.spec.ts:3: import { Registry } from "../src/entities.js"; |
| `RendererKind` | **internal only** | packages/core/src/renderer.ts:59: function wrapRenderer(raw: RendererInstance, kind: RendererKind): RendererLike { |
| `RendererLike` | **internal only** | packages/core/__tests__/particles.spec.ts:6: import type { RendererLike } from "../src/renderer.js"; |
| `RendererOptions` | **internal only** | packages/core/src/game.ts:9: import { type RendererLike, type RendererOptions, createRenderer } from "./renderer.js"; |
| `RigidBody3DOptions` | **internal only** | packages/physics/src/RigidBody3D.ts:43: constructor(options: RigidBody3DOptions) { |
| `RigidBodyType` | **internal only** | packages/physics/src/RigidBody3D.ts:17: readonly type?: RigidBodyType; |
| `SceneConstructor` | **internal only** | packages/core/src/game.ts:10: import type { Ctx, Scene, SceneConstructor, SceneFrame } from "./scene.js"; |
| `SceneEnterResult` | **internal only** | packages/core/src/scene.ts:20: enter(_ctx: Ctx<TState, TPhysics>): SceneEnterResult<TState, TPhysics> { |
| `ScheduleHandle` | **internal only** | packages/core/src/scene.ts:8: import type { ScheduleHandle } from "./schedule.js"; |
| `Scheduler` | **internal only** | packages/core/__tests__/schedule.spec.ts:4: import { Scheduler } from "../src/schedule.js"; |
| `StatePatch` | **internal only** | packages/core/src/state.ts:29: gameStore.set = (patch: StatePatch<T>) => { |
| `ThreePlaytestEntityRegistry` | **internal only** | packages/playtest/__tests__/three-bridge.spec.ts:5: import { ThreePlaytestEntityRegistry } from "../src/three/entities.js"; |
| `ThreePlaytestRenderer` | **internal only** | packages/playtest/src/three/bridge.ts:15: import { sampleThreeObservations, type ThreePlaytestRenderer } from "./observations.js"; |
| `Viewport` | **internal only** | packages/core/__tests__/picking.spec.ts:5: import { Viewport, type ViewportSize } from "../src/viewport.js"; |
| `ViewportOptions` | **internal only** | packages/core/src/game.ts:13: import { Viewport, type ViewportOptions } from "./viewport.js"; |
| `ViewportResizeHandler` | **internal only** | packages/core/src/viewport.ts:35: #listeners = new Set<ViewportResizeHandler>(); |
| `ViewportSize` | **internal only** | packages/core/__tests__/picking.spec.ts:5: import { Viewport, type ViewportSize } from "../src/viewport.js"; |
| `applyScenarioOverrides` | **dead** | `packages/playtest/src/scenario.ts` — definition only in the frozen worklist; no live caller remained after deletion |
| `assertJsonSafe` | **reached externally** | packages/core/src/playtest.ts:9: assertJsonSafe, |
| `autoFields` | **internal only** | packages/core/src/entities.ts:64: const fields = typeof debug === "function" ? debug.call(entity) : autoFields(entity); |
| `buildReport` | **reached externally** | packages/playtest/src/runner/runner.ts:168: const report = buildReport( |
| `connectPlaytestBridge` | **reached externally** | packages/playtest/src/runner/runner.ts:24: import { connectPlaytestBridge, PlaytestBridgeError, type IPlaytestBridgeClient } from "./bridgeClient.js"; |
| `createAssetLoader` | **internal only** | packages/core/__tests__/assets.spec.ts:2: import { createAssetLoader } from "../src/assets.js"; |
| `createGameStore` | **internal only** | packages/core/__tests__/state.spec.ts:2: import { createGameStore } from "../src/state.js"; |
| `createRandom` | **internal only** | packages/core/__tests__/replay.spec.ts:33: const ctx = { input, random: createRandom(90210) } as unknown as Ctx; |
| `createRenderer` | **internal only** | packages/core/__tests__/renderer.spec.ts:2: import { createRenderer } from "../src/renderer.js"; |
| `evaluateRichPlaytestAssertions` | **reached externally** | packages/playtest/src/runner/runner.ts:6: evaluateRichPlaytestAssertions, |
| `initStandalonePlaytest` | **reached externally** | packages/playtest/src/runner/cli.ts:14: import { initStandalonePlaytest } from "./init.js"; |
| `input` | **dead** | `packages/core/src/input.ts` — exported factory had no live caller; `InputMap` is constructed directly by the game runtime and tests |
| `installThreePlaytestBridge` | **reached externally** | packages/core/src/playtest.ts:11: import { type IThreePlaytestEntity, installThreePlaytestBridge } from "@threenative/playtest/three"; |
| `jsonByteLength` | **reached externally** | packages/playtest/src/runner/bridgeClient.ts:242: if (jsonByteLength(value) > PLAYTEST_PROTOCOL_LIMITS.maxPayloadBytes) { |
| `loadPlaytestScenario` | **reached externally** | packages/playtest/src/runner/runner.ts:7: loadPlaytestScenario, |
| `missingPlaytestCapabilities` | **reached externally** | packages/playtest/src/runner/bridgeClient.ts:135: const missing = missingPlaytestCapabilities(required, [ |
| `objectPath` | **internal only** | packages/playtest/src/three/entities.ts:13: const path = entry.path ?? objectPath(entry.object); |
| `oneShotScenario` | **dead** | `packages/playtest/src/scenario.ts` — definition only in the frozen worklist; no live caller remained after deletion |
| `overlayNodeObservationKey` | **internal only** | packages/playtest/src/assertions.ts:518: const id = overlayNodeObservationKey(assertion.overlayId, assertion.selector); |
| `parsePlaytestTarget` | **dead** | `packages/playtest/src/scenario.ts` — definition only in the frozen worklist; no live caller remained after deletion |
| `parseStandalonePlaytestArgs` | **reached externally** | packages/playtest/src/runner/cli.ts:10: parseStandalonePlaytestArgs, |
| `parseViewport` | **dead** | `packages/playtest/src/scenario.ts` — definition only in the frozen worklist; no live caller remained after deletion |
| `playtestDiagnostic` | **reached externally** | packages/playtest/src/runner/runner.ts:8: playtestDiagnostic, |
| `playtestStepHoldTicks` | **reached externally** | packages/playtest/src/runner/runner.ts:9: playtestStepHoldTicks, |
| `playtestStepWaitTicks` | **reached externally** | packages/playtest/src/runner/runner.ts:10: playtestStepWaitTicks, |
| `requiredPlaytestCapabilities` | **reached externally** | packages/playtest/src/runner/bridgeClient.ts:17: requiredPlaytestCapabilities, |
| `runStandalonePlaytest` | **reached externally** | packages/playtest/src/runner/cli.ts:18: import { runStandalonePlaytest } from "./runner.js"; |
| `sampleThreeObservations` | **internal only** | packages/playtest/src/three/bridge.ts:15: import { sampleThreeObservations, type ThreePlaytestRenderer } from "./observations.js"; |
| `unknownPlaytestCapabilities` | **reached externally** | packages/playtest/src/runner/bridgeClient.ts:111: const unknown = unknownPlaytestCapabilities(description.capabilities); |
| `version` | **internal only** | packages/physics/__tests__/native-contract.spec.ts:101: version: RAPIER.version(), |

## Phase 2 — deletion result

The package entrypoints now un-export all 114 `internal only` candidates while keeping their
declarations module-local. Internal tests that still exercise those symbols import the declaring
module directly; a test-only caller does not restore a package export.

The five `dead` candidates were deleted with their private-only implementations:

- `applyScenarioOverrides`
- `input`
- `oneShotScenario`
- `parsePlaytestTarget`
- `parseViewport`

No candidate was `public by contract`. The 48 `reached externally` rows retain public exports
and record the external package, template, example, or playtest CLI caller in the evidence
column.

## Verification commands

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm budgets
pnpm test:templates
node --import tsx/esm scripts/round-deletions.ts
```

The `pnpm` report command is blocked by the sandbox's `tsx` IPC restriction; the equivalent
query still observed the frozen 167-candidate list.

| Command | Result |
| --- | --- |
| `pnpm round:deletions` | setup-blocked; exit 1, `listen EPERM: operation not permitted /tmp/tsx-1000/13.pipe` |
| equivalent `node --import tsx/esm` query | pass — current round 3, previous round 2, 167 candidates |
| `pnpm typecheck` | pass; exit 0 |
| `pnpm lint` | pass; Biome checked 391 files |
| `pnpm test` | setup-blocked at `@publint/pack`: `Failed to find packed tarball file` although the pack subprocess returned exit 0 |
| `pnpm test:templates` | setup-blocked at `tsx` IPC; direct-loader retry reached the same `@publint/pack` failure |
| `pnpm budgets` | setup-blocked at `tsx` IPC; direct check passed with review trigger 61,554 / 50,000 |
| Android AAR preflight unit test | pass — 1 test, 31 skipped |
