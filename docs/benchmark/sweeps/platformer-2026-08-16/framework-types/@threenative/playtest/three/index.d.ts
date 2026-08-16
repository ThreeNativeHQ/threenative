import { Camera, Scene, Object3D, Vector2 } from 'three';
import { i as IPlaytestSampleRequest, f as IPlaytestObservationSnapshot, a as IPlaytestBridgeV1, J as JsonValue, e as IPlaytestGameplayObservation, h as IPlaytestRuntimeDiagnosticsSample } from '../protocol-D0DV7Wxm.js';

type RenderAdvisorOwner = "framework" | "generated-src";
type RenderAdvisorSeverity = "info" | "warning";
type RenderAdvisorTransformSafety = "caller-declared-static" | "unknown";
interface IRenderAdvisorExamplePaths {
    readonly gpuParticles: string;
    readonly hudInstancing: string;
    readonly materialSharing: string;
    readonly staticMerge: string;
}
interface IRenderAdvisorObservedRendererCounters {
    readonly drawCalls?: number;
    readonly triangles?: number;
}
interface IRenderAdvisorObservedPass {
    readonly cameraToken: string;
    readonly depthToken?: string;
    readonly equivalenceToken?: string;
    readonly purpose?: "color" | "depth-prepass" | "other" | "post" | "shadow";
    readonly renderCalls?: number;
    readonly sceneToken: string;
    readonly targetToken?: string;
}
interface IRenderAdvisorObservedInput {
    readonly passes?: readonly IRenderAdvisorObservedPass[];
    readonly renderer?: IRenderAdvisorObservedRendererCounters;
}
interface IRenderAdvisorSceneCollapseAggregate {
    readonly mergedMaterialIdentities?: number;
    readonly mergedMeshes: number;
    readonly reasonCode: string;
    readonly schemaVersion: number;
    readonly sourceMaterialIdentities?: number;
    readonly sourceMeshes: number;
    readonly status: "applied" | "deferred" | "rejected" | string;
}
interface IRenderAdvisorInput {
    readonly camera?: Camera;
    readonly materialMutationSafety?: "caller-declared-stable" | "unknown";
    readonly observed?: IRenderAdvisorObservedInput;
    readonly particleWorkload?: "caller-declared-many-independent-objects" | "unknown";
    readonly scene: Scene;
    readonly sceneCollapse?: IRenderAdvisorSceneCollapseAggregate;
    readonly spriteWorkload?: "caller-declared-camera-overlay" | "unknown";
    readonly topN?: number;
    readonly transformSafety?: RenderAdvisorTransformSafety;
    readonly verifiedExamplePaths: IRenderAdvisorExamplePaths;
}
interface IRenderAdvisorGroup {
    readonly constraintReasonCounts: Record<string, number>;
    readonly eligibleDynamicCount: number;
    readonly eligibleStaticCount: number;
    readonly geometryIdentities: number;
    readonly materialIdentities: number;
    readonly memberCount: number;
}
interface IRenderAdvisorRecommendation {
    readonly caveats: readonly string[];
    readonly code: string;
    readonly constraints: Record<string, number>;
    readonly evidence: {
        readonly metric: string;
        readonly path: string;
    };
    readonly examplePath: string;
    readonly expectedReducedCount?: number;
    readonly observedCount: number;
    readonly owner: RenderAdvisorOwner;
    readonly severity: RenderAdvisorSeverity;
}
interface IRenderAdvisorReport {
    readonly schemaVersion: 1;
    readonly observed: {
        readonly passes: {
            readonly recorded: number;
            readonly truncated: number;
        };
        readonly renderer: IRenderAdvisorObservedRendererCounters;
    };
    readonly passObservations: readonly {
        readonly count: number;
        readonly reasonCode: string;
    }[];
    readonly recommendations: readonly IRenderAdvisorRecommendation[];
    readonly sceneCollapse?: IRenderAdvisorSceneCollapseAggregate;
    readonly snapshot: {
        readonly geometryIdentityCount: number;
        readonly instancedRenderableCount: number;
        readonly logicalObjectCount: number;
        readonly logicalObjectCountIncludesRootScene: true;
        readonly materialIdentityCount: number;
        readonly pointsCount: number;
        readonly renderableCount: number;
        readonly spriteCount: number;
        readonly visibleFlagRenderableCount: number;
    };
    readonly topGroups: readonly IRenderAdvisorGroup[];
}
declare function adviseThreeRenderWorkload(input: IRenderAdvisorInput): IRenderAdvisorReport;

interface IThreePlaytestEntity {
    id: string;
    object: Object3D;
    path?: string;
}

interface IThreePlaytestRenderer {
    getDrawingBufferSize(target: Vector2): Vector2;
    info?: {
        render?: {
            drawCalls?: unknown;
            calls?: unknown;
            triangles?: unknown;
        };
    };
}

/**
 * Physics evidence for a project that drives its own simulation.
 *
 * The `settled` and `aerodynamics` assertions read a `physicsDebugSeries` whose snapshots have
 * a specific interior shape -- `artifact.primitives[]` entries categorised `sleep` and
 * `center-of-mass`, plus an `artifact.overflow.omittedBodies` count. That shape is a harness
 * contract, not something a caller should have to rediscover by reading a failed assertion, so
 * the bridge builds it here from a flat body list. A caller supplies what it already knows.
 */
interface IThreePlaytestPhysicsBody {
    /** Body id. An assertion matches it exactly or by prefix, so `crate.3` matches entity `crate`. */
    readonly id: string;
    readonly position: readonly [number, number, number];
    readonly sleeping: boolean;
}
interface IThreePlaytestPhysics {
    bodies(): readonly IThreePlaytestPhysicsBody[];
}
/** Retained bodies per labelled sample. Bodies past the limit are reported, never dropped. */
declare const PLAYTEST_PHYSICS_BODY_LIMIT = 100;
/** Labelled samples retained per run. */
declare const PLAYTEST_PHYSICS_SAMPLE_LIMIT = 100;
type PhysicsDebugSeries = NonNullable<IPlaytestObservationSnapshot["physicsDebugSeries"]>;
/**
 * Retains one physics snapshot per scenario step label.
 *
 * Fails closed throughout: a duplicate label, an exhausted retention budget, and a malformed
 * body all throw rather than yielding a series an assertion would read as merely empty. An
 * assertion that cannot see its evidence must fail loudly; one that silently sees nothing is
 * the vacuous pass this package exists to prevent.
 */
declare class ThreePlaytestPhysicsRecorder {
    #private;
    constructor(physics: IThreePlaytestPhysics);
    sample(request: IPlaytestSampleRequest, tick: number): PhysicsDebugSeries;
}

interface IThreePlaytestResources {
    read(): Record<string, JsonValue>;
    write?(id: string, path: string | undefined, value: JsonValue): boolean;
}
interface IThreePlaytestBridgeOptions {
    camera: Camera;
    components?: () => Record<string, Record<string, JsonValue>>;
    diagnostics?: () => JsonValue[];
    entities?: readonly IThreePlaytestEntity[] | (() => readonly IThreePlaytestEntity[]);
    fixedStep?: (ticks: number) => Promise<number | void> | number | void;
    gameplay?: () => IPlaytestGameplayObservation;
    gameplayChannels?: () => readonly ("runtime.contacts" | "runtime.tags" | "runtime.world")[];
    runtimeDiagnosticsSeries?: () => readonly IPlaytestRuntimeDiagnosticsSample[];
    events?: () => JsonValue[];
    /** Physics bodies to retain per labelled step. Requires the authoritative tick provider. */
    physics?: IThreePlaytestPhysics;
    renderer: IThreePlaytestRenderer;
    resources?: IThreePlaytestResources;
    scene: Scene;
    tick?: () => number;
}
interface IThreePlaytestBridgeInstallation {
    bridge: IPlaytestBridgeV1;
    dispose(): void;
    registerEntity(entry: IThreePlaytestEntity): void;
    syncEntities(): void;
}
declare function installThreePlaytestBridge(options: IThreePlaytestBridgeOptions): IThreePlaytestBridgeInstallation;

interface IDeviceBridgeInstallation {
    close(): void;
}
declare function connectDevicePlaytestBridge(bridge: IPlaytestBridgeV1, endpoint: string): IDeviceBridgeInstallation;
declare function readPlaytestEndpoint(): string | undefined;

export { type IDeviceBridgeInstallation, type IRenderAdvisorExamplePaths, type IRenderAdvisorInput, type IRenderAdvisorObservedInput, type IRenderAdvisorObservedPass, type IRenderAdvisorRecommendation, type IRenderAdvisorReport, type IRenderAdvisorSceneCollapseAggregate, type IThreePlaytestBridgeInstallation, type IThreePlaytestBridgeOptions, type IThreePlaytestEntity, type IThreePlaytestPhysics, type IThreePlaytestPhysicsBody, type IThreePlaytestResources, PLAYTEST_PHYSICS_BODY_LIMIT, PLAYTEST_PHYSICS_SAMPLE_LIMIT, ThreePlaytestPhysicsRecorder, adviseThreeRenderWorkload, connectDevicePlaytestBridge, installThreePlaytestBridge, readPlaytestEndpoint };
