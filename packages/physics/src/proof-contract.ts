import type { PhysicsSimulation } from "./simulation.js";

export const PHYSICS_COLLISION_EVENT_STRIDE = 4;

export interface PhysicsProofOptions {
  readonly gravity?: { readonly x: number; readonly y: number; readonly z: number };
  readonly floor?: { readonly collisionLayer?: number; readonly collisionMask?: number };
  readonly cube?: { readonly collisionLayer?: number; readonly collisionMask?: number };
}

export interface PhysicsProof extends PhysicsSimulation {
  readonly version: string;
  drainCollisionEvents(buffer: Uint32Array): number;
  dispose(): void;
}
