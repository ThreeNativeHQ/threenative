import { physicsBodyHandle, physicsColliderHandle, physicsHandle } from "../handles.js";
import type {
  PhysicsBodyCreateOptions,
  PhysicsInputSnapshot,
  PhysicsRuntimeSimulation,
  PhysicsShapeDescriptor,
  PhysicsSimulation,
} from "../simulation.js";

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

/** Raw object installed by the C++ runtime. It is wrapped before shared nodes see it. */
export interface NativeSimulation {
  configureCharacter(id: number, options: Parameters<PhysicsSimulation["configureCharacter"]>[1]): void;
  createBody(options: NativeBodyOptions): number;
  dispose(): void;
  drainCollisionEvents(buffer: Uint32Array): number;
  removeBody(id: number): void;
  setBodyTransform?(id: number, position: { readonly x: number; readonly y: number; readonly z: number }): void;
  readVisibleTransforms(renderBuffer: Float32Array): number;
  readCharacterStates(buffer: Float32Array): number;
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
    typeof value.createBody !== "function" ||
    !("step" in value) ||
    typeof value.step !== "function"
  ) {
    throw new Error("TN_NATIVE_PHYSICS_INVALID: physics world is not a native simulation");
  }
  return value as NativeSimulation;
}

function primitiveShape(shape: PhysicsShapeDescriptor): NativeShapeDescriptor {
  if (shape.kind !== "box" && shape.kind !== "sphere" && shape.kind !== "capsule")
    throw new Error(`TN_NATIVE_PHYSICS_SHAPE_UNSUPPORTED: ${shape.kind} remains OPEN on native`);
  return shape as NativeShapeDescriptor;
}

export function createNativePhysicsSimulation(
  raw: NativeSimulation,
  version: string,
): PhysicsRuntimeSimulation {
  const characterIds = new Set<number>();
  const characterState = new Map<
    number,
    { readonly grounded: boolean; readonly groundCollider?: number }
  >();
  let characterStates = new Float32Array(48);
  const simulation: PhysicsRuntimeSimulation = {
    version,
    rawEventQueue: raw,
    rawWorld: raw,
    createBody: (options: PhysicsBodyCreateOptions) => {
      const shape = primitiveShape(options.shape);
      const id = raw.createBody({
        collisionLayer: shape.collisionLayer,
        collisionMask: shape.collisionMask,
        mass: options.mass,
        position: options.position,
        rotation: options.rotation,
        sensor: options.sensor,
        shape,
        type: options.type,
      });
      if (!Number.isInteger(id) || id < 0)
        throw new Error("TN_NATIVE_PHYSICS_INVALID: runtime returned an invalid body id");
      const rawHandle = { backend: "native", id };
      if (options.type === "character") characterIds.add(id);
      return {
        body: physicsBodyHandle(id, rawHandle),
        collider: physicsColliderHandle(id, rawHandle),
        controller: options.type === "character" ? physicsHandle(rawHandle) : undefined,
        rawShape: shape,
      };
    },
    configureCharacter: (id, options) => raw.configureCharacter(id, options),
    removeBody: (id) => {
      raw.removeBody(id);
      characterIds.delete(id);
      characterState.delete(id);
    },
    setBodyTransform: (id, position) => {
      if (raw.setBodyTransform === undefined)
        throw new Error("TN_NATIVE_PHYSICS_SET_TRANSFORM_MISSING: runtime ABI is too old");
      raw.setBodyTransform(id, position);
    },
    step: (deltaTime, inputSnapshot) => raw.step(deltaTime, inputSnapshot),
    readVisibleTransforms: (buffer) => {
      const count = raw.readVisibleTransforms(buffer);
      const required = Math.max(1, characterIds.size) * 3;
      if (characterStates.length < required) characterStates = new Float32Array(required);
      const stateCount = raw.readCharacterStates(characterStates);
      characterState.clear();
      for (let index = 0; index < stateCount; index += 1) {
        const offset = index * 3;
        const id = characterStates[offset];
        const grounded = characterStates[offset + 1];
        const groundCollider = characterStates[offset + 2];
        if (id === undefined || grounded === undefined || groundCollider === undefined)
          throw new Error("TN_NATIVE_PHYSICS_INVALID: malformed character state");
        characterState.set(id, {
          grounded: grounded === 1,
          groundCollider: groundCollider < 0 ? undefined : groundCollider,
        });
      }
      return count;
    },
    readCharacterState: (id) => characterState.get(id),
    drainCollisionEvents: (buffer) => raw.drainCollisionEvents(buffer),
    dispose: () => {
      raw.dispose();
      characterIds.clear();
      characterState.clear();
    },
  };
  return simulation;
}
