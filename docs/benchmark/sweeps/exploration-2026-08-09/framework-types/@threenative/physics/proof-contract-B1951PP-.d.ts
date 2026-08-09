import { P as PhysicsSimulation } from './simulation-D6duq8U_.js';

declare const PHYSICS_COLLISION_EVENT_STRIDE = 4;
interface PhysicsProofOptions {
    readonly gravity?: {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    };
    readonly floor?: {
        readonly collisionLayer?: number;
        readonly collisionMask?: number;
    };
    readonly cube?: {
        readonly collisionLayer?: number;
        readonly collisionMask?: number;
    };
}
interface PhysicsProof extends PhysicsSimulation {
    readonly version: string;
    drainCollisionEvents(buffer: Uint32Array): number;
    dispose(): void;
}

export { type PhysicsProofOptions as P, type PhysicsProof as a, PHYSICS_COLLISION_EVENT_STRIDE as b };
