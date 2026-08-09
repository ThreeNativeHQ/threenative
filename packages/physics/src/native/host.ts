import type { PhysicsInputSnapshot, PhysicsSimulation } from "../simulation.js";

export interface NativeShapeDescriptor {
  readonly kind: "box" | "capsule" | "sphere";
  readonly x: number;
  readonly y: number;
  readonly z: number;
  collisionLayer: number;
  collisionMask: number;
  sensor: boolean;
}

export interface NativeBodyOptions {
  readonly collisionLayer: number;
  readonly collisionMask: number;
  readonly mass: number;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly rotation: {
    readonly w: number;
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly sensor: boolean;
  readonly shape: NativeShapeDescriptor;
  readonly type: "character" | "dynamic" | "fixed" | "kinematic";
}

export interface NativeSimulation extends PhysicsSimulation {
  createBody(options: NativeBodyOptions): number;
  dispose(): void;
  drainCollisionEvents(buffer: Uint32Array): number;
  removeBody(id: number): void;
  step(deltaTime: number, inputSnapshot?: PhysicsInputSnapshot): void;
}

export interface NativePhysicsHost {
  readonly version: string;
  createProofSimulation(options?: unknown): NativeSimulation;
  createSimulation(options?: unknown): NativeSimulation;
}

declare global {
  var __THREENATIVE_NATIVE__: { readonly physics?: NativePhysicsHost } | undefined;
}

export function nativePhysicsHost(): NativePhysicsHost {
  const host = globalThis.__THREENATIVE_NATIVE__?.physics;
  if (
    host === undefined ||
    typeof host.version !== "string" ||
    typeof host.createSimulation !== "function"
  ) {
    throw new Error("TN_NATIVE_PHYSICS_MISSING: runtime did not install the physics ABI");
  }
  return host;
}

export function nativeSimulation(value: unknown): NativeSimulation {
  if (
    typeof value !== "object" ||
    value === null ||
    !("createBody" in value) ||
    typeof value.createBody !== "function"
  ) {
    throw new Error("TN_NATIVE_PHYSICS_INVALID: physics world is not a native simulation");
  }
  return value as NativeSimulation;
}
