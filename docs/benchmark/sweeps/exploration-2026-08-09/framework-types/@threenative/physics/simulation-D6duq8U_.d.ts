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
    readCharacterState?(id: number): PhysicsCharacterState | undefined;
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

export { type PhysicsSimulation as P, type PhysicsShapeDescriptor as a, type PhysicsShapeKind as b, type PhysicsBodyHandle as c, type PhysicsColliderHandle as d, type PhysicsHandle as e, type PhysicsWorldHandle as f, physicsHandle as g, PHYSICS_COLLISION_EVENT_STRIDE as h, PHYSICS_TRANSFORM_STRIDE as i, type PhysicsBodyCreateOptions as j, type PhysicsCharacterOptions as k, type PhysicsInputSnapshot as l, type PhysicsRuntimeSimulation as m, physicsWorldHandle as p };
