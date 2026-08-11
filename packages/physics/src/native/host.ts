import { physicsBodyHandle, physicsColliderHandle, physicsHandle } from "../handles.js";
import type {
  IPhysicsBodyCreateOptions,
  IPhysicsInputSnapshot,
  IPhysicsRuntimeSimulation,
  IPhysicsShapeDescriptor,
  IPhysicsSimulation,
} from "../simulation.js";
import {
  requirePhysicsBodySensor,
  requirePhysicsEventBuffer,
  requirePhysicsRenderBuffer,
  requirePhysicsStepInput,
} from "../simulation.js";

export interface INativeShapeDescriptor {
  readonly kind: "box" | "capsule" | "sphere";
  readonly x: number;
  readonly y: number;
  readonly z: number;
  collisionLayer: number;
  collisionMask: number;
  sensor: boolean;
}

export interface INativeBodyOptions {
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
  readonly shape: INativeShapeDescriptor;
  readonly type: "character" | "dynamic" | "fixed" | "kinematic";
}

/** Raw object installed by the C++ runtime. It is wrapped before shared nodes see it. */
export interface INativeSimulation {
  configureCharacter(
    id: number,
    options: Parameters<IPhysicsSimulation["configureCharacter"]>[1],
  ): void;
  createBody(options: INativeBodyOptions): number;
  dispose(): void;
  drainCollisionEvents(buffer: Uint32Array): number;
  removeBody(id: number): void;
  setBodyTransform?(
    id: number,
    position: { readonly x: number; readonly y: number; readonly z: number },
  ): void;
  readVisibleTransforms(renderBuffer: Float32Array): number;
  readCharacterStates(buffer: Float32Array): number;
  readAreaIntersections(buffer: Uint32Array): number;
  step(deltaTime: number, inputSnapshot?: IPhysicsInputSnapshot): void;
}

export interface INativePhysicsHost {
  readonly version: string;
  createSimulation(options?: unknown): INativeSimulation;
}

declare global {
  var __THREENATIVE_NATIVE__: { readonly physics?: INativePhysicsHost } | undefined;
}

export function nativePhysicsHost(): INativePhysicsHost {
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

export function nativeSimulation(value: unknown): INativeSimulation {
  if (
    typeof value !== "object" ||
    value === null ||
    !("configureCharacter" in value) ||
    typeof value.configureCharacter !== "function" ||
    !("createBody" in value) ||
    typeof value.createBody !== "function" ||
    !("dispose" in value) ||
    typeof value.dispose !== "function" ||
    !("drainCollisionEvents" in value) ||
    typeof value.drainCollisionEvents !== "function" ||
    !("removeBody" in value) ||
    typeof value.removeBody !== "function" ||
    !("readVisibleTransforms" in value) ||
    typeof value.readVisibleTransforms !== "function" ||
    !("readCharacterStates" in value) ||
    typeof value.readCharacterStates !== "function" ||
    !("readAreaIntersections" in value) ||
    typeof value.readAreaIntersections !== "function" ||
    !("step" in value) ||
    typeof value.step !== "function"
  ) {
    throw new Error("TN_NATIVE_PHYSICS_INVALID: physics world is not a native simulation");
  }
  return value as INativeSimulation;
}

function primitiveShape(shape: IPhysicsShapeDescriptor): INativeShapeDescriptor {
  if (shape.kind !== "box" && shape.kind !== "sphere" && shape.kind !== "capsule")
    throw new Error(`TN_NATIVE_PHYSICS_SHAPE_UNSUPPORTED: ${shape.kind} remains OPEN on native`);
  return shape as INativeShapeDescriptor;
}

function opaqueNativeShape(shape: INativeShapeDescriptor): unknown {
  return Object.freeze({ backend: "native", kind: shape.kind });
}

function isSmallBufferError(error: unknown): boolean {
  return error instanceof Error && /buffer is too small/i.test(error.message);
}

function growUint32(buffer: Uint32Array, minimum: number): Uint32Array {
  let length = Math.max(16, buffer.length);
  while (length < minimum) length *= 2;
  return length === buffer.length ? buffer : new Uint32Array(length);
}

export function createNativePhysicsSimulation(
  raw: INativeSimulation,
  version: string,
): IPhysicsRuntimeSimulation {
  const bodyIds = new Set<number>();
  const areaIds = new Set<number>();
  const characterIds = new Set<number>();
  const characterState = new Map<
    number,
    { readonly grounded: boolean; readonly groundCollider?: number }
  >();
  let characterStates = new Float32Array(48);
  let areaPairs: Uint32Array<ArrayBufferLike> = new Uint32Array(32);
  const areaIntersections = new Map<number, Set<number>>();
  let characterStateDirty = true;
  let areaIntersectionsDirty = true;
  const invalidateObservations = () => {
    characterStateDirty = true;
    areaIntersectionsDirty = true;
  };
  const refreshCharacterState = () => {
    if (!characterStateDirty) return;
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
    characterStateDirty = false;
  };
  const refreshAreaIntersections = () => {
    if (!areaIntersectionsDirty) return;
    areaPairs = growUint32(areaPairs, bodyIds.size * 2);
    const maximum = Math.max(16, bodyIds.size * bodyIds.size * 2);
    let pairCount: number;
    for (;;) {
      try {
        pairCount = raw.readAreaIntersections(areaPairs);
        break;
      } catch (error) {
        if (!isSmallBufferError(error) || areaPairs.length >= maximum) throw error;
        areaPairs = growUint32(areaPairs, Math.min(maximum, areaPairs.length * 2));
      }
    }
    areaIntersections.clear();
    for (const areaId of areaIds) areaIntersections.set(areaId, new Set());
    for (let index = 0; index < pairCount; index += 1) {
      const offset = index * 2;
      const areaId = areaPairs[offset];
      const bodyId = areaPairs[offset + 1];
      if (areaId === undefined || bodyId === undefined)
        throw new Error("TN_NATIVE_PHYSICS_INVALID: malformed area intersection");
      areaIntersections.get(areaId)?.add(bodyId);
    }
    areaIntersectionsDirty = false;
  };
  const simulation: IPhysicsRuntimeSimulation = {
    version,
    rawEventQueue: raw,
    rawWorld: raw,
    createBody: (options: IPhysicsBodyCreateOptions) => {
      const shape = primitiveShape(options.shape);
      const sensor = requirePhysicsBodySensor(options);
      const id = raw.createBody({
        collisionLayer: shape.collisionLayer,
        collisionMask: shape.collisionMask,
        mass: options.mass,
        position: options.position,
        rotation: options.rotation,
        sensor,
        shape,
        type: options.type,
      });
      if (!Number.isInteger(id) || id < 0)
        throw new Error("TN_NATIVE_PHYSICS_INVALID: runtime returned an invalid body id");
      const rawHandle = { backend: "native", id };
      bodyIds.add(id);
      if (sensor) areaIds.add(id);
      if (options.type === "character") characterIds.add(id);
      invalidateObservations();
      return {
        body: physicsBodyHandle(id, rawHandle),
        collider: physicsColliderHandle(id, rawHandle),
        controller: options.type === "character" ? physicsHandle(rawHandle) : undefined,
        rawShape: opaqueNativeShape(shape),
      };
    },
    configureCharacter: (id, options) => {
      raw.configureCharacter(id, options);
      invalidateObservations();
    },
    removeBody: (id) => {
      raw.removeBody(id);
      bodyIds.delete(id);
      areaIds.delete(id);
      characterIds.delete(id);
      characterState.delete(id);
      invalidateObservations();
    },
    setBodyTransform: (id, position) => {
      if (raw.setBodyTransform === undefined)
        throw new Error("TN_NATIVE_PHYSICS_SET_TRANSFORM_MISSING: runtime ABI is too old");
      raw.setBodyTransform(id, position);
    },
    step: (deltaTime, inputSnapshot) => {
      requirePhysicsStepInput(deltaTime, inputSnapshot, (id) => bodyIds.has(id));
      raw.step(deltaTime, inputSnapshot);
      invalidateObservations();
    },
    readVisibleTransforms: (buffer) => {
      requirePhysicsRenderBuffer(buffer, bodyIds.size);
      return raw.readVisibleTransforms(buffer);
    },
    readCharacterState: (id) => {
      refreshCharacterState();
      return characterState.get(id);
    },
    areaIntersections: (id) => {
      refreshAreaIntersections();
      return areaIntersections.get(id) ?? new Set();
    },
    drainCollisionEvents: (buffer) => {
      requirePhysicsEventBuffer(buffer);
      return raw.drainCollisionEvents(buffer);
    },
    dispose: () => {
      raw.dispose();
      bodyIds.clear();
      areaIds.clear();
      characterIds.clear();
      characterState.clear();
      areaIntersections.clear();
      characterStateDirty = false;
      areaIntersectionsDirty = false;
    },
  };
  return simulation;
}
