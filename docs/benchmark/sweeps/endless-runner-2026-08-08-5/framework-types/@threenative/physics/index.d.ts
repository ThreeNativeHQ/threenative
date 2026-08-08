import * as RAPIER from '@dimforge/rapier3d-compat';
import { Object3D, Vector3, Mesh } from 'three';
import { GamePluginHooks } from '@threenative/core';

interface CharacterBody3DOptions {
    readonly object: Object3D;
    readonly physics?: PhysicsContext;
    readonly world?: RAPIER.World;
    readonly shape: RAPIER.ColliderDesc;
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
    /** Collider membership bits to ignore while moving upward. */
    readonly oneWayGroups?: number;
}
declare class CharacterBody3D {
    #private;
    readonly body: RAPIER.RigidBody;
    readonly collider: RAPIER.Collider;
    readonly controller: RAPIER.KinematicCharacterController;
    readonly object: Object3D;
    readonly velocity: Vector3;
    gravity: number;
    maxFallSpeed: number;
    readonly oneWayGroups: number;
    grounded: boolean;
    constructor(options: CharacterBody3DOptions);
    move(desiredTranslation: Pick<Vector3, "x" | "y" | "z">): void;
    moveAndSlide(dt: number): void;
    syncToPhysics(): void;
    teleport(position: Pick<Vector3, "x" | "y" | "z">): void;
    step(): void;
    syncFromPhysics(): void;
    dispose(): void;
}

type RigidBodyType = "dynamic" | "fixed" | "kinematic";
interface RigidBody3DOptions {
    readonly object: Object3D;
    readonly physics?: PhysicsContext;
    readonly world?: RAPIER.World;
    readonly shape: RAPIER.ColliderDesc;
    readonly mass?: number;
    readonly type?: RigidBodyType;
}
declare class RigidBody3D {
    #private;
    readonly body: RAPIER.RigidBody;
    readonly collider: RAPIER.Collider;
    readonly object: Object3D;
    readonly type: RigidBodyType;
    constructor(options: RigidBody3DOptions);
    syncToPhysics(): void;
    syncFromPhysics(): void;
    dispose(): void;
}

interface PhysicsOptions {
    readonly gravity?: {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    };
}
type PhysicsBody3D = RigidBody3D | CharacterBody3D;
interface PhysicsContext {
    readonly world: RAPIER.World;
    readonly eventQueue: RAPIER.EventQueue;
    add(body: PhysicsBody3D): void;
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
    readonly world?: RAPIER.World;
    readonly shape: RAPIER.ColliderDesc;
    readonly position?: Pick<Vector3, "x" | "y" | "z">;
}
declare class Area3D {
    #private;
    readonly entity: string | undefined;
    readonly body: RAPIER.RigidBody;
    readonly collider: RAPIER.Collider;
    constructor(options: Area3DOptions);
    on(event: AreaEvent, handler: AreaHandler): () => void;
    setPosition(position: Pick<Vector3, "x" | "y" | "z">): void;
    handleCollision(body: PhysicsBody3D, started: boolean): void;
    drainContacts(): AreaContact[];
    reconcileIntersections(current: ReadonlyMap<number, PhysicsBody3D>): void;
    dispose(): void;
}

type CollisionShapeKind = "box" | "sphere" | "capsule" | "trimesh" | "convexHull";
declare class CollisionShape3D {
    static box(width: number, height: number, depth: number): RAPIER.ColliderDesc;
    static sphere(radius: number): RAPIER.ColliderDesc;
    static capsule(halfHeight: number, radius: number): RAPIER.ColliderDesc;
    static fromMesh(mesh: Mesh, kind?: CollisionShapeKind): RAPIER.ColliderDesc;
}

export { Area3D, type Area3DOptions, type AreaContact, type AreaEvent, type AreaHandler, CharacterBody3D, type CharacterBody3DOptions, CollisionShape3D, type CollisionShapeKind, type PhysicsBody3D, type PhysicsContext, type PhysicsOptions, type PhysicsPlugin, RigidBody3D, type RigidBody3DOptions, type RigidBodyType, rapier };
