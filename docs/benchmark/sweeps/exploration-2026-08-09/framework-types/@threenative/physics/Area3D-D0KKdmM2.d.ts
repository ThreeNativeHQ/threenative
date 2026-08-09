import { Mesh, Object3D, Vector3 } from 'three';
import { a as PhysicsShapeDescriptor, b as PhysicsShapeKind, c as PhysicsBodyHandle, d as PhysicsColliderHandle, e as PhysicsHandle, f as PhysicsWorldHandle, p as physicsWorldHandle, g as physicsHandle, P as PhysicsSimulation } from './simulation-D6duq8U_.js';
import { GamePluginHooks } from '@threenative/core';
import { CrowdAgent, NavMesh, NavMeshQuery, Crowd } from 'recast-navigation';

type CollisionShapeKind = PhysicsShapeKind;
interface CollisionShapeHandle {
    readonly raw: unknown;
}
declare class CollisionShape3D {
    #private;
    private constructor();
    /** Backend-neutral data consumed by the selected PhysicsSimulation adapter. */
    get descriptor(): PhysicsShapeDescriptor;
    /** Rapier's descriptor on web, or an opaque native descriptor after registration. */
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

export { Area3D as A, CharacterBody3D as C, NavigationAgent3D as N, type PhysicsBody3D as P, RigidBody3D as R, type Area3DOptions as a, type AreaContact as b, type AreaEvent as c, type AreaHandler as d, type CharacterBody3DOptions as e, CollisionShape3D as f, type CollisionShapeHandle as g, type CollisionShapeKind as h, type PhysicsContext as i, type PhysicsOptions as j, type PhysicsPlugin as k, type RigidBody3DOptions as l, type RigidBodyType as m, type NavigationAgent3DOptions as n, type NavigationAgentEvent as o, type NavigationAgentHandler as p, type NavigationContext as q, rapier as r, NavigationObstacle3D as s, type NavigationObstacle3DOptions as t, type NavigationPlugin as u, NavigationRegion3D as v, type NavigationRegion3DOptions as w, recast as x };
