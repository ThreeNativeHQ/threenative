import { Mesh, Object3D, Vector3 } from 'three';
import { IGamePluginHooks } from '@threenative/core';
import { CrowdAgent, NavMesh, NavMeshQuery, Crowd } from 'recast-navigation';

/**
 * Portable handle for a backend-owned physics object.
 *
 * `raw` is deliberately backend-specific: it is a Rapier object on web and an opaque
 * native handle on device. Code that reads it is not portable across build targets.
 */
interface IPhysicsHandle {
    readonly raw: unknown;
}
interface IPhysicsBodyHandle extends IPhysicsHandle {
    readonly id: number;
    readonly entity?: string;
}
interface IPhysicsColliderHandle extends IPhysicsHandle {
    readonly id: number;
}
interface IPhysicsWorldHandle extends IPhysicsHandle {
    /** The selected backend, kept beside `raw` so shared nodes do not inspect it. */
    readonly simulation?: unknown;
}
declare function physicsHandle(raw: unknown): IPhysicsHandle;
declare function physicsWorldHandle(raw: unknown, simulation: unknown): IPhysicsWorldHandle;

/** One record is logical body id, xyz position, and xyzw rotation. */
declare const PHYSICS_TRANSFORM_STRIDE = 8;
declare const PHYSICS_COLLISION_EVENT_STRIDE = 4;
/** Caps native query buffers while remaining exactly representable by the native ABI. */
declare const MAX_PHYSICS_QUERY_RESULTS = 1024;
type PhysicsShapeKind = "box" | "sphere" | "capsule" | "trimesh" | "convexHull" | "heightfield";
/** Portable shape data. Backend-specific objects are created only by a simulation adapter. */
interface IPhysicsShapeDescriptor {
    readonly kind: PhysicsShapeKind;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly vertices?: Float32Array;
    readonly indices?: Uint32Array;
    readonly rows?: number;
    readonly columns?: number;
    readonly heights?: Float32Array;
    readonly scale?: {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    };
    readonly shape?: unknown;
    collisionLayer: number;
    collisionMask: number;
    sensor: boolean;
}
type PhysicsBodyType = "character" | "dynamic" | "fixed" | "kinematic";
interface IPhysicsBodyCreateOptions {
    readonly type: PhysicsBodyType;
    readonly shape: IPhysicsShapeDescriptor;
    readonly entity?: string;
    readonly position: {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    };
    readonly rotation: {
        readonly x: number;
        readonly y: number;
        readonly z: number;
        readonly w: number;
    };
    readonly mass: number;
    /** Must match `shape.sensor`; conflicting values are rejected during body creation. */
    readonly sensor: boolean;
}
interface IPhysicsVector3 {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}
interface IPhysicsRotation {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
}
interface IPhysicsRayQuery {
    readonly from: IPhysicsVector3;
    readonly to: IPhysicsVector3;
    readonly collisionMask: number;
}
interface IPhysicsShapeQuery {
    readonly shape: IPhysicsShapeDescriptor;
    readonly position: IPhysicsVector3;
    readonly rotation: IPhysicsRotation;
    readonly collisionMask: number;
    readonly maxResults: number;
}
interface IPhysicsPointQuery {
    readonly position: IPhysicsVector3;
    readonly collisionMask: number;
    readonly maxResults: number;
}
interface IPhysicsQueryHit {
    readonly body: IPhysicsBodyHandle;
    readonly entity?: string;
    readonly position: IPhysicsVector3;
}
interface IPhysicsRayHit extends IPhysicsQueryHit {
    readonly normal: IPhysicsVector3;
    readonly distance: number;
}
interface IPhysicsBodyRegistration {
    readonly body: IPhysicsBodyHandle;
    readonly collider: IPhysicsColliderHandle;
    readonly controller?: IPhysicsHandle;
    /** The backend shape object to expose through `CollisionShape3D.raw`. */
    readonly rawShape: unknown;
}
interface IPhysicsCharacterOptions {
    readonly offset: number;
    readonly maxSlopeClimbAngle: number;
    readonly autostep?: {
        readonly maxHeight: number;
        readonly minWidth: number;
        readonly includeDynamicBodies: boolean;
    };
    readonly snapToGround?: number;
    readonly oneWayLayers: number;
    /** Let the character shove dynamic bodies it collides with, instead of sliding past them. */
    readonly pushesDynamicBodies?: boolean;
}
interface IPhysicsCharacterState {
    readonly grounded: boolean;
    readonly groundCollider?: number;
}
interface IPhysicsInputSnapshot {
    /** One eight-float record per kinematic body. The buffer is caller-owned and reusable. */
    readonly kinematicTransforms: Readonly<Float32Array>;
    readonly kinematicCount: number;
}
/** The backend seam used by all shared physics nodes. */
interface IPhysicsSimulation {
    createBody(options: IPhysicsBodyCreateOptions): IPhysicsBodyRegistration;
    configureCharacter(id: number, options: IPhysicsCharacterOptions): void;
    removeBody(id: number): void;
    /** Cold-path repositioning for teleport/setup. Per-frame kinematics use `step()` input. */
    setBodyTransform(id: number, position: {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    }): void;
    /**
     * Dynamic-body actuation. Without these a game cannot move a dynamic body at all: a transform
     * write is overwritten by the next step, so `setBodyTransform` is genuinely cold-path only.
     */
    applyBodyImpulse(id: number, impulse: IPhysicsVector3): void;
    applyBodyForce(id: number, force: IPhysicsVector3): void;
    setBodyLinearVelocity(id: number, velocity: IPhysicsVector3): void;
    readBodyLinearVelocity(id: number): IPhysicsVector3;
    step(deltaTime: number, inputSnapshot?: IPhysicsInputSnapshot): void;
    readVisibleTransforms(renderBuffer: Float32Array): number;
    readBodySleepStates(buffer: Float32Array): number;
    intersectRay(query: IPhysicsRayQuery): IPhysicsRayHit | undefined;
    intersectShape(query: IPhysicsShapeQuery): readonly IPhysicsQueryHit[];
    intersectPoint(query: IPhysicsPointQuery): readonly IPhysicsQueryHit[];
    readBodyTransform?(id: number): {
        readonly position: {
            readonly x: number;
            readonly y: number;
            readonly z: number;
        };
        readonly rotation: {
            readonly x: number;
            readonly y: number;
            readonly z: number;
            readonly w: number;
        };
    } | undefined;
    /** Reflects the most recently completed step, independent of visible-transform reads. */
    readCharacterState?(id: number): IPhysicsCharacterState | undefined;
    /** Reflects the most recently completed step, independent of visible-transform reads. */
    areaIntersections?(id: number): ReadonlySet<number>;
    drainCollisionEvents(buffer: Uint32Array): number;
    dispose(): void;
}
/** Runtime metadata needed to expose backend-specific escape hatches without leaking them. */
interface IPhysicsRuntimeSimulation extends IPhysicsSimulation {
    readonly version: string;
    readonly rawWorld: unknown;
    readonly rawEventQueue: unknown;
}

type CollisionShapeKind = PhysicsShapeKind;
/** A backend-specific escape hatch: Rapier on web, opaque on native. */
interface ICollisionShapeHandle {
    readonly raw: unknown;
}
declare class CollisionShape3D {
    #private;
    private constructor();
    /** Backend-neutral data consumed by the selected IPhysicsSimulation adapter. */
    get descriptor(): IPhysicsShapeDescriptor;
    /** Backend-specific escape hatch: Rapier's descriptor on web, or an opaque native handle. */
    get raw(): unknown;
    /** Internal seam: the backend binds its own descriptor when the body is created. */
    bindRaw(raw: unknown): void;
    static box(width: number, height: number, depth: number): CollisionShape3D;
    static sphere(radius: number): CollisionShape3D;
    static capsule(halfHeight: number, radius: number): CollisionShape3D;
    static heightfield(rows: number, columns: number, heights: Float32Array, scale: {
        x: number;
        y: number;
        z: number;
    }): CollisionShape3D;
    static fromMesh(mesh: Mesh, kind?: CollisionShapeKind): CollisionShape3D;
    setCollisionGroups(groups: number): this;
    setSensor(sensor: boolean): this;
}

interface ICharacterBody3DOptions {
    readonly object: Object3D;
    readonly entity?: string;
    readonly physics?: IPhysicsContext;
    /** @deprecated Prefer `physics`; a raw web world is backend-specific. */
    readonly world?: IPhysicsWorldHandle | unknown;
    readonly shape: CollisionShape3D;
    readonly offset?: number;
    readonly maxSlopeClimbAngle?: number;
    readonly autostep?: {
        readonly maxHeight: number;
        readonly minWidth: number;
        readonly includeDynamicBodies?: boolean;
    };
    readonly snapToGround?: number;
    readonly gravity?: number;
    readonly maxFallSpeed?: number;
    /** Godot's collision_layer — which layers this body occupies. Default 1. */
    readonly collisionLayer?: number;
    /** Godot's collision_mask — which layers this body scans. Default 0xffff. */
    readonly collisionMask?: number;
    /** Collider layer bits to ignore while moving upward. */
    readonly oneWayLayers?: number;
    /**
     * Shove dynamic bodies the character walks into, instead of sliding past them. Default false,
     * matching Rapier. Without it a character collides with a crate and the crate never moves,
     * which reads as a physics bug rather than a default.
     */
    readonly pushesDynamicBodies?: boolean;
}
declare class CharacterBody3D {
    #private;
    readonly body: IPhysicsBodyHandle;
    readonly collider: IPhysicsColliderHandle;
    readonly controller: IPhysicsHandle;
    readonly object: Object3D;
    readonly velocity: Vector3;
    gravity: number;
    maxFallSpeed: number;
    readonly oneWayLayers: number;
    grounded: boolean;
    constructor(options: ICharacterBody3DOptions);
    move(desiredTranslation: Pick<Vector3, "x" | "y" | "z">): void;
    moveAndSlide(dt: number): void;
    /** Called by the shared plugin before a bulk step. */
    writeKinematic(buffer: Float32Array, offset: number): void;
    syncToPhysics(): void;
    step(): void;
    teleport(position: Pick<Vector3, "x" | "y" | "z">): void;
    applyTransform(values: Readonly<Float32Array>, offset: number): void;
    syncFromPhysics(): void;
    dispose(): void;
}

type PhysicsQueryVector3 = IPhysicsVector3;
interface IIntersectRayOptions {
    readonly from: PhysicsQueryVector3;
    readonly to: PhysicsQueryVector3;
    readonly collisionMask?: number;
}
interface IIntersectShapeOptions {
    readonly shape: CollisionShape3D;
    readonly position: PhysicsQueryVector3;
    readonly rotation?: {
        readonly x: number;
        readonly y: number;
        readonly z: number;
        readonly w: number;
    };
    readonly collisionMask?: number;
    readonly maxResults?: number;
}
interface IIntersectPointOptions {
    readonly position: PhysicsQueryVector3;
    readonly collisionMask?: number;
    readonly maxResults?: number;
}
interface IRayHit extends IPhysicsRayHit {
    readonly body: IPhysicsBodyHandle;
}
type IShapeHit = IPhysicsQueryHit;
type IPointHit = IPhysicsQueryHit;
/** Godot-shaped point-in-time queries over the selected physics simulation. */
declare class PhysicsDirectSpaceState3D {
    #private;
    constructor(simulation: IPhysicsSimulation);
    intersectRay(options: IIntersectRayOptions): IRayHit | undefined;
    intersectShape(options: IIntersectShapeOptions): readonly IShapeHit[];
    intersectPoint(options: IIntersectPointOptions): readonly IPointHit[];
}

type RigidBodyType = "dynamic" | "fixed" | "kinematic";
interface IRigidBody3DOptions {
    readonly object: Object3D;
    readonly entity?: string;
    readonly physics?: IPhysicsContext;
    /** @deprecated Prefer `physics`; a raw web world is backend-specific. */
    readonly world?: IPhysicsWorldHandle | unknown;
    readonly shape: CollisionShape3D;
    readonly mass?: number;
    readonly type?: RigidBodyType;
    /** Godot's collision_layer — which layers this body occupies. Default 1. */
    readonly collisionLayer?: number;
    /** Godot's collision_mask — which layers this body scans. Default 0xffff. */
    readonly collisionMask?: number;
}
declare class RigidBody3D {
    #private;
    readonly body: IPhysicsBodyHandle;
    readonly collider: IPhysicsColliderHandle;
    readonly object: Object3D;
    readonly type: RigidBodyType;
    constructor(options: IRigidBody3DOptions);
    /** Called by the shared plugin before a bulk step. */
    writeKinematic(buffer: Float32Array, offset: number): void;
    /** Displacement since the last backend transform, used for moving-platform carry. */
    kinematicMotion(): {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    };
    syncToPhysics(): void;
    /**
     * Godot's `apply_impulse`. The one-shot shove: a thrown crate, a jump pad, a hit reaction.
     *
     * These four members exist because there is otherwise no portable way to move a dynamic body
     * at all. `body.raw` is a Rapier object on web and opaque on native, so reaching through it
     * forks the game by platform, and a transform write is discarded by the next step.
     */
    applyImpulse(impulse: {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    }): void;
    /** Godot's `apply_force`. Continuous push; cleared by the backend each step. */
    applyForce(force: {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    }): void;
    /** Godot's `linear_velocity`. */
    get linearVelocity(): {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    };
    set linearVelocity(velocity: {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    });
    syncFromPhysics(): void;
    applyTransform(values: Readonly<Float32Array>, offset: number): void;
    dispose(): void;
}

type NavigationAgentEvent = "targetReached" | "navigationFinished" | "pathChanged";
type NavigationAgentHandler = () => void;
interface INavigationAgent3DOptions {
    readonly navigation: INavigationContext;
    readonly object: Object3D;
    readonly radius?: number;
    readonly height?: number;
    readonly maxSpeed?: number;
    readonly pathDesiredDistance?: number;
    readonly targetDesiredDistance?: number;
    readonly avoidanceEnabled?: boolean;
}
declare class NavigationAgent3D {
    #private;
    readonly navigation: INavigationContext;
    readonly object: Object3D;
    readonly radius: number;
    readonly height: number;
    readonly maxSpeed: number;
    readonly pathDesiredDistance: number;
    readonly targetDesiredDistance: number;
    constructor(options: INavigationAgent3DOptions);
    get crowdAgent(): CrowdAgent | undefined;
    get avoidanceEnabled(): boolean;
    set avoidanceEnabled(value: boolean);
    on(event: NavigationAgentEvent, handler: NavigationAgentHandler): () => void;
    setTargetPosition(position: Pick<Vector3, "x" | "y" | "z">): void;
    getNextPathPosition(): Vector3;
    isNavigationFinished(): boolean;
    isTargetReachable(position?: Pick<Vector3, "x" | "y" | "z">): boolean;
    getFinalPosition(): Vector3;
    distanceToTarget(): number;
    syncCrowd(): void;
    advance(): void;
    dispose(): void;
}

interface INavigationObstacle3DOptions {
    readonly navigation: INavigationContext;
    readonly object: Object3D;
    readonly radius?: number;
    readonly height?: number;
    readonly avoidanceEnabled?: boolean;
}
declare class NavigationObstacle3D {
    #private;
    readonly navigation: INavigationContext;
    readonly object: Object3D;
    readonly radius: number;
    readonly height: number;
    crowdAgent: CrowdAgent | undefined;
    constructor(options: INavigationObstacle3DOptions);
    get avoidanceEnabled(): boolean;
    set avoidanceEnabled(value: boolean);
    syncCrowd(): void;
    dispose(): void;
}

interface INavigationRegion3DOptions {
    readonly navigation: INavigationContext;
    readonly meshes: readonly Object3D[];
    readonly cellSize?: number;
    readonly cellHeight?: number;
    readonly agentRadius?: number;
    readonly agentHeight?: number;
    readonly agentMaxClimb?: number;
    readonly agentMaxSlope?: number;
}
declare class NavigationRegion3D {
    #private;
    readonly navigation: INavigationContext;
    readonly meshes: readonly Object3D[];
    navigationMesh: NavMesh;
    constructor(options: INavigationRegion3DOptions);
    get enabled(): boolean;
    set enabled(value: boolean);
    bakeNavigationMesh(): NavMesh;
    dispose(): void;
}

interface INavigationContext {
    navMesh: NavMesh;
    query: NavMeshQuery;
    readonly regions: Set<NavigationRegion3D>;
    readonly agents: Set<NavigationAgent3D>;
    readonly obstacles: Set<NavigationObstacle3D>;
    crowd?: Crowd;
}
type NavigationPlugin = IGamePluginHooks<Record<string, unknown>, IPhysicsContext>;
declare function recast(): NavigationPlugin;

interface IPhysicsOptions {
    readonly gravity?: {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    };
}
type PhysicsBody3D = RigidBody3D | CharacterBody3D;
interface IPhysicsContext {
    readonly world: ReturnType<typeof physicsWorldHandle>;
    readonly eventQueue: ReturnType<typeof physicsHandle>;
    readonly simulation: IPhysicsSimulation;
    readonly directSpaceState: PhysicsDirectSpaceState3D;
    navigation?: INavigationContext;
    add(body: PhysicsBody3D): void;
    numBodies(): number;
    kinematicMotion?(colliderHandle: number): {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    } | undefined;
    remove(body: PhysicsBody3D): void;
    addArea(area: Area3D): void;
    removeArea(area: Area3D): void;
}
type PhysicsPlugin = IGamePluginHooks<Record<string, unknown>, IPhysicsContext>;
declare function rapier(options?: IPhysicsOptions): PhysicsPlugin;

type AreaEvent = "bodyEntered" | "bodyExited";
type AreaHandler = (body: PhysicsBody3D) => void;
interface IAreaContact {
    readonly area: Area3D;
    readonly body: PhysicsBody3D;
    readonly entity?: string;
    readonly started: boolean;
}
interface IArea3DOptions {
    readonly entity?: string;
    readonly physics?: IPhysicsContext;
    /** @deprecated Prefer `physics`; a raw web world is backend-specific. */
    readonly world?: IPhysicsWorldHandle | unknown;
    readonly shape: CollisionShape3D;
    readonly position?: Pick<Vector3, "x" | "y" | "z">;
    /** Godot's collision_layer — which layers this area occupies. Default 1. */
    readonly collisionLayer?: number;
    /** Godot's collision_mask — which layers this area scans. Default 0xffff. */
    readonly collisionMask?: number;
}
declare class Area3D {
    #private;
    readonly entity: string | undefined;
    readonly body: IPhysicsBodyHandle;
    readonly collider: IPhysicsColliderHandle;
    constructor(options: IArea3DOptions);
    on(event: AreaEvent, handler: AreaHandler): () => void;
    /** Mirrors Godot's Area3D.monitoring. When false the area reports no contacts. */
    get monitoring(): boolean;
    set monitoring(value: boolean);
    setPosition(position: Pick<Vector3, "x" | "y" | "z">): void;
    /** Called by the shared plugin before a bulk step. */
    writeKinematic(buffer: Float32Array, offset: number): void;
    applyTransform(values: Readonly<Float32Array>, offset: number): void;
    handleCollision(body: PhysicsBody3D, started: boolean): void;
    drainContacts(): IAreaContact[];
    reconcileIntersections(current: ReadonlyMap<number, PhysicsBody3D>): void;
    dispose(): void;
}

export { type NavigationAgentHandler as $, Area3D as A, type PhysicsBody3D as B, CharacterBody3D as C, PhysicsDirectSpaceState3D as D, type PhysicsQueryVector3 as E, type PhysicsShapeKind as F, rapier as G, type AreaEvent as H, type ICollisionShapeHandle as I, type AreaHandler as J, type CollisionShapeKind as K, type IArea3DOptions as L, MAX_PHYSICS_QUERY_RESULTS as M, type IAreaContact as N, type ICharacterBody3DOptions as O, PHYSICS_COLLISION_EVENT_STRIDE as P, type IPhysicsOptions as Q, RigidBody3D as R, type IRigidBody3DOptions as S, type PhysicsPlugin as T, type RigidBodyType as U, type INavigationAgent3DOptions as V, type INavigationContext as W, type INavigationObstacle3DOptions as X, type INavigationRegion3DOptions as Y, NavigationAgent3D as Z, type NavigationAgentEvent as _, CollisionShape3D as a, NavigationObstacle3D as a0, type NavigationPlugin as a1, NavigationRegion3D as a2, recast as a3, type IIntersectPointOptions as b, type IIntersectRayOptions as c, type IIntersectShapeOptions as d, type IPhysicsBodyCreateOptions as e, type IPhysicsBodyHandle as f, type IPhysicsCharacterOptions as g, type IPhysicsColliderHandle as h, type IPhysicsContext as i, type IPhysicsHandle as j, type IPhysicsInputSnapshot as k, type IPhysicsPointQuery as l, type IPhysicsQueryHit as m, type IPhysicsRayHit as n, type IPhysicsRayQuery as o, type IPhysicsRotation as p, type IPhysicsRuntimeSimulation as q, type IPhysicsShapeDescriptor as r, type IPhysicsShapeQuery as s, type IPhysicsSimulation as t, type IPhysicsVector3 as u, type IPhysicsWorldHandle as v, type IPointHit as w, type IRayHit as x, type IShapeHit as y, PHYSICS_TRANSFORM_STRIDE as z };
