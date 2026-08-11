import { Mesh, Object3D, Vector3 } from 'three';
import { GamePluginHooks } from '@threenative/core';
import { CrowdAgent, NavMesh, NavMeshQuery, Crowd } from 'recast-navigation';

/**
 * Portable handle for a backend-owned physics object.
 *
 * `raw` is deliberately backend-specific: it is a Rapier object on web and an opaque
 * native handle on device. Code that reads it is not portable across build targets.
 */
interface PhysicsHandle {
    readonly raw: unknown;
}
interface PhysicsBodyHandle extends PhysicsHandle {
    readonly id: number;
}
interface PhysicsColliderHandle extends PhysicsHandle {
    readonly id: number;
}
interface PhysicsWorldHandle extends PhysicsHandle {
    /** The selected backend, kept beside `raw` so shared nodes do not inspect it. */
    readonly simulation?: unknown;
}
declare function physicsHandle(raw: unknown): PhysicsHandle;
declare function physicsWorldHandle(raw: unknown, simulation: unknown): PhysicsWorldHandle;

/** One record is logical body id, xyz position, and xyzw rotation. */
declare const PHYSICS_TRANSFORM_STRIDE = 8;
declare const PHYSICS_COLLISION_EVENT_STRIDE = 4;
type PhysicsShapeKind = "box" | "sphere" | "capsule" | "trimesh" | "convexHull" | "heightfield";
/** Portable shape data. Backend-specific objects are created only by a simulation adapter. */
interface PhysicsShapeDescriptor {
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
interface PhysicsBodyCreateOptions {
    readonly type: PhysicsBodyType;
    readonly shape: PhysicsShapeDescriptor;
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
interface PhysicsBodyRegistration {
    readonly body: PhysicsBodyHandle;
    readonly collider: PhysicsColliderHandle;
    readonly controller?: PhysicsHandle;
    /** The backend shape object to expose through `CollisionShape3D.raw`. */
    readonly rawShape: unknown;
}
interface PhysicsCharacterOptions {
    readonly offset: number;
    readonly maxSlopeClimbAngle: number;
    readonly autostep?: {
        readonly maxHeight: number;
        readonly minWidth: number;
        readonly includeDynamicBodies: boolean;
    };
    readonly snapToGround?: number;
    readonly oneWayLayers: number;
}
interface PhysicsCharacterState {
    readonly grounded: boolean;
    readonly groundCollider?: number;
}
interface PhysicsInputSnapshot {
    /** One eight-float record per kinematic body. The buffer is caller-owned and reusable. */
    readonly kinematicTransforms: Readonly<Float32Array>;
    readonly kinematicCount: number;
}
/** The backend seam used by all shared physics nodes. */
interface PhysicsSimulation {
    createBody(options: PhysicsBodyCreateOptions): PhysicsBodyRegistration;
    configureCharacter(id: number, options: PhysicsCharacterOptions): void;
    removeBody(id: number): void;
    /** Cold-path repositioning for teleport/setup. Per-frame kinematics use `step()` input. */
    setBodyTransform(id: number, position: {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    }): void;
    step(deltaTime: number, inputSnapshot?: PhysicsInputSnapshot): void;
    readVisibleTransforms(renderBuffer: Float32Array): number;
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
    readCharacterState?(id: number): PhysicsCharacterState | undefined;
    /** Reflects the most recently completed step, independent of visible-transform reads. */
    areaIntersections?(id: number): ReadonlySet<number>;
    drainCollisionEvents(buffer: Uint32Array): number;
    dispose(): void;
}
/** Runtime metadata needed to expose backend-specific escape hatches without leaking them. */
interface PhysicsRuntimeSimulation extends PhysicsSimulation {
    readonly version: string;
    readonly rawWorld: unknown;
    readonly rawEventQueue: unknown;
}

type CollisionShapeKind = PhysicsShapeKind;
/** A backend-specific escape hatch: Rapier on web, opaque on native. */
interface CollisionShapeHandle {
    readonly raw: unknown;
}
declare class CollisionShape3D {
    #private;
    private constructor();
    /** Backend-neutral data consumed by the selected PhysicsSimulation adapter. */
    get descriptor(): PhysicsShapeDescriptor;
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

interface CharacterBody3DOptions {
    readonly object: Object3D;
    readonly physics?: PhysicsContext;
    /** @deprecated Prefer `physics`; a raw web world is backend-specific. */
    readonly world?: PhysicsWorldHandle | unknown;
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
}
declare class CharacterBody3D {
    #private;
    readonly body: PhysicsBodyHandle;
    readonly collider: PhysicsColliderHandle;
    readonly controller: PhysicsHandle;
    readonly object: Object3D;
    readonly velocity: Vector3;
    gravity: number;
    maxFallSpeed: number;
    readonly oneWayLayers: number;
    grounded: boolean;
    constructor(options: CharacterBody3DOptions);
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

type RigidBodyType = "dynamic" | "fixed" | "kinematic";
interface RigidBody3DOptions {
    readonly object: Object3D;
    readonly physics?: PhysicsContext;
    /** @deprecated Prefer `physics`; a raw web world is backend-specific. */
    readonly world?: PhysicsWorldHandle | unknown;
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
    readonly body: PhysicsBodyHandle;
    readonly collider: PhysicsColliderHandle;
    readonly object: Object3D;
    readonly type: RigidBodyType;
    constructor(options: RigidBody3DOptions);
    /** Called by the shared plugin before a bulk step. */
    writeKinematic(buffer: Float32Array, offset: number): void;
    /** Displacement since the last backend transform, used for moving-platform carry. */
    kinematicMotion(): {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    };
    syncToPhysics(): void;
    syncFromPhysics(): void;
    applyTransform(values: Readonly<Float32Array>, offset: number): void;
    dispose(): void;
}

type NavigationAgentEvent = "targetReached" | "navigationFinished" | "pathChanged";
type NavigationAgentHandler = () => void;
interface NavigationAgent3DOptions {
    readonly navigation: NavigationContext;
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
    readonly navigation: NavigationContext;
    readonly object: Object3D;
    readonly radius: number;
    readonly height: number;
    readonly maxSpeed: number;
    readonly pathDesiredDistance: number;
    readonly targetDesiredDistance: number;
    constructor(options: NavigationAgent3DOptions);
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

interface NavigationObstacle3DOptions {
    readonly navigation: NavigationContext;
    readonly object: Object3D;
    readonly radius?: number;
    readonly height?: number;
    readonly avoidanceEnabled?: boolean;
}
declare class NavigationObstacle3D {
    #private;
    readonly navigation: NavigationContext;
    readonly object: Object3D;
    readonly radius: number;
    readonly height: number;
    crowdAgent: CrowdAgent | undefined;
    constructor(options: NavigationObstacle3DOptions);
    get avoidanceEnabled(): boolean;
    set avoidanceEnabled(value: boolean);
    syncCrowd(): void;
    dispose(): void;
}

interface NavigationRegion3DOptions {
    readonly navigation: NavigationContext;
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
    readonly navigation: NavigationContext;
    readonly meshes: readonly Object3D[];
    navigationMesh: NavMesh;
    constructor(options: NavigationRegion3DOptions);
    get enabled(): boolean;
    set enabled(value: boolean);
    bakeNavigationMesh(): NavMesh;
    dispose(): void;
}

interface NavigationContext {
    navMesh: NavMesh;
    query: NavMeshQuery;
    readonly regions: Set<NavigationRegion3D>;
    readonly agents: Set<NavigationAgent3D>;
    readonly obstacles: Set<NavigationObstacle3D>;
    crowd?: Crowd;
}
type NavigationPlugin = GamePluginHooks<Record<string, unknown>, PhysicsContext>;
declare function recast(): NavigationPlugin;

interface PhysicsOptions {
    readonly gravity?: {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    };
}
type PhysicsBody3D = RigidBody3D | CharacterBody3D;
interface PhysicsContext {
    readonly world: ReturnType<typeof physicsWorldHandle>;
    readonly eventQueue: ReturnType<typeof physicsHandle>;
    readonly simulation: PhysicsSimulation;
    navigation?: NavigationContext;
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
type PhysicsPlugin = GamePluginHooks<Record<string, unknown>, PhysicsContext>;
declare function rapier(options?: PhysicsOptions): PhysicsPlugin;

type AreaEvent = "bodyEntered" | "bodyExited";
type AreaHandler = (body: PhysicsBody3D) => void;
interface AreaContact {
    readonly area: Area3D;
    readonly body: PhysicsBody3D;
    readonly entity?: string;
    readonly started: boolean;
}
interface Area3DOptions {
    readonly entity?: string;
    readonly physics?: PhysicsContext;
    /** @deprecated Prefer `physics`; a raw web world is backend-specific. */
    readonly world?: PhysicsWorldHandle | unknown;
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
    readonly body: PhysicsBodyHandle;
    readonly collider: PhysicsColliderHandle;
    constructor(options: Area3DOptions);
    on(event: AreaEvent, handler: AreaHandler): () => void;
    /** Mirrors Godot's Area3D.monitoring. When false the area reports no contacts. */
    get monitoring(): boolean;
    set monitoring(value: boolean);
    setPosition(position: Pick<Vector3, "x" | "y" | "z">): void;
    /** Called by the shared plugin before a bulk step. */
    writeKinematic(buffer: Float32Array, offset: number): void;
    applyTransform(values: Readonly<Float32Array>, offset: number): void;
    handleCollision(body: PhysicsBody3D, started: boolean): void;
    drainContacts(): AreaContact[];
    reconcileIntersections(current: ReadonlyMap<number, PhysicsBody3D>): void;
    dispose(): void;
}

export { Area3D as A, type RigidBodyType as B, CharacterBody3D as C, type NavigationAgent3DOptions as D, type NavigationAgentEvent as E, type NavigationAgentHandler as F, type NavigationContext as G, NavigationObstacle3D as H, type NavigationObstacle3DOptions as I, type NavigationPlugin as J, NavigationRegion3D as K, type NavigationRegion3DOptions as L, recast as M, NavigationAgent3D as N, PHYSICS_COLLISION_EVENT_STRIDE as P, RigidBody3D as R, CollisionShape3D as a, type CollisionShapeHandle as b, PHYSICS_TRANSFORM_STRIDE as c, type PhysicsBody3D as d, type PhysicsBodyCreateOptions as e, type PhysicsBodyHandle as f, type PhysicsCharacterOptions as g, type PhysicsColliderHandle as h, type PhysicsContext as i, type PhysicsHandle as j, type PhysicsInputSnapshot as k, type PhysicsRuntimeSimulation as l, type PhysicsShapeDescriptor as m, type PhysicsShapeKind as n, type PhysicsSimulation as o, type PhysicsWorldHandle as p, type Area3DOptions as q, rapier as r, type AreaContact as s, type AreaEvent as t, type AreaHandler as u, type CharacterBody3DOptions as v, type CollisionShapeKind as w, type PhysicsOptions as x, type PhysicsPlugin as y, type RigidBody3DOptions as z };
