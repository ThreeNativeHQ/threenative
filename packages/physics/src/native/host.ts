import { physicsBodyHandle, physicsColliderHandle, physicsHandle } from "../handles.js";
import type {
  IPhysicsBodyCreateOptions,
  IPhysicsInputSnapshot,
  IPhysicsJointCreateOptions,
  IPhysicsPointQuery,
  IPhysicsQueryHit,
  IPhysicsRayHit,
  IPhysicsRayQuery,
  IPhysicsRuntimeSimulation,
  IPhysicsShapeDescriptor,
  IPhysicsShapeQuery,
  IPhysicsSimulation,
  IPhysicsVector3,
} from "../simulation.js";
import {
  requireFiniteVector,
  requirePhysicsBodySensor,
  requirePhysicsEventBuffer,
  requirePhysicsJointCreateOptions,
  requirePhysicsPointQuery,
  requirePhysicsRayQuery,
  requirePhysicsRenderBuffer,
  requirePhysicsShapeQuery,
  requirePhysicsSleepStateBuffer,
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
  readonly entity?: string;
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

export type INativeJointOptions = IPhysicsJointCreateOptions;

export interface INativeRayHit {
  readonly bodyId: number;
  readonly distance: number;
  readonly normal: { readonly x: number; readonly y: number; readonly z: number };
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
}

export interface INativeRayQuery {
  readonly from: { readonly x: number; readonly y: number; readonly z: number };
  readonly to: { readonly x: number; readonly y: number; readonly z: number };
  readonly collisionMask: number;
}

export interface INativeShapeQuery {
  readonly shape: INativeShapeDescriptor;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly rotation: {
    readonly w: number;
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly collisionMask: number;
  readonly maxResults: number;
}

export interface INativePointQuery {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly collisionMask: number;
  readonly maxResults: number;
}

export interface INativeQueryHit {
  readonly bodyId: number;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
}

/** Raw object installed by the C++ runtime. It is wrapped before shared nodes see it. */
export interface INativeSimulation {
  configureCharacter(
    id: number,
    options: Parameters<IPhysicsSimulation["configureCharacter"]>[1],
  ): void;
  createBody(options: INativeBodyOptions): number;
  createJoint?(options: INativeJointOptions): number;
  dispose(): void;
  drainCollisionEvents(buffer: Uint32Array): number;
  removeBody(id: number): void;
  removeJoint?(id: number): void;
  setBodyTransform?(
    id: number,
    position: { readonly x: number; readonly y: number; readonly z: number },
  ): void;
  /** Optional so old runtimes fail loudly through the adapter instead of silently diverging. */
  applyBodyImpulse?(id: number, impulse: IPhysicsVector3): void;
  applyBodyForce?(id: number, force: IPhysicsVector3): void;
  setBodyLinearVelocity?(id: number, velocity: IPhysicsVector3): void;
  readBodyLinearVelocity?(id: number): IPhysicsVector3;
  readVisibleTransforms(renderBuffer: Float32Array): number;
  readBodySleepStates(buffer: Float32Array): number;
  readCharacterStates(buffer: Float32Array): number;
  readAreaIntersections(buffer: Uint32Array): number;
  intersectRay(
    query: INativeRayQuery,
    output?: Float32Array,
  ): INativeRayHit | number | null | undefined;
  intersectShape(query: INativeShapeQuery): readonly INativeQueryHit[];
  intersectPoint(query: INativePointQuery): readonly INativeQueryHit[];
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
    !("readBodySleepStates" in value) ||
    typeof value.readBodySleepStates !== "function" ||
    !("readCharacterStates" in value) ||
    typeof value.readCharacterStates !== "function" ||
    !("readAreaIntersections" in value) ||
    typeof value.readAreaIntersections !== "function" ||
    !("intersectRay" in value) ||
    typeof value.intersectRay !== "function" ||
    !("intersectShape" in value) ||
    typeof value.intersectShape !== "function" ||
    !("intersectPoint" in value) ||
    typeof value.intersectPoint !== "function" ||
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
  const bodyHandles = new Map<number, ReturnType<typeof physicsBodyHandle>>();
  const jointBodies = new Map<number, readonly [number, number]>();
  const areaIds = new Set<number>();
  const characterIds = new Set<number>();
  const characterState = new Map<
    number,
    { readonly grounded: boolean; readonly groundCollider?: number }
  >();
  let characterStates = new Float32Array(48);
  const rayOutput = new Float32Array(8);
  let areaPairs: Uint32Array<ArrayBufferLike> = new Uint32Array(32);
  const areaIntersections = new Map<number, Set<number>>();
  let characterStateDirty = true;
  let areaIntersectionsDirty = true;
  let disposed = false;
  const requireLive = () => {
    if (disposed) throw new Error("Physics simulation is disposed.");
  };
  const invalidateObservations = () => {
    characterStateDirty = true;
    areaIntersectionsDirty = true;
  };
  const bodyHandle = (id: number) => {
    const handle = bodyHandles.get(id);
    if (handle === undefined)
      throw new Error("TN_NATIVE_PHYSICS_INVALID: query returned an unknown body");
    return handle;
  };
  const finiteQueryVector = (
    value: { readonly x: number; readonly y: number; readonly z: number },
    label: string,
  ) => {
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z))
      throw new Error(`TN_NATIVE_PHYSICS_INVALID: ${label} contains a non-finite vector`);
    return { x: value.x, y: value.y, z: value.z };
  };
  const nativeHit = (hit: INativeQueryHit): IPhysicsQueryHit => {
    if (!Number.isSafeInteger(hit.bodyId) || hit.bodyId < 0)
      throw new Error("TN_NATIVE_PHYSICS_INVALID: query returned an invalid body id");
    const body = bodyHandle(hit.bodyId);
    return {
      body,
      entity: body.entity,
      position: finiteQueryVector(hit.position, "query hit position"),
    };
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
      const bodyHandleValue = physicsBodyHandle(id, rawHandle, options.entity);
      bodyIds.add(id);
      bodyHandles.set(id, bodyHandleValue);
      if (sensor) areaIds.add(id);
      if (options.type === "character") characterIds.add(id);
      invalidateObservations();
      return {
        body: bodyHandleValue,
        collider: physicsColliderHandle(id, rawHandle),
        controller: options.type === "character" ? physicsHandle(rawHandle) : undefined,
        rawShape: opaqueNativeShape(shape),
      };
    },
    createJoint: (jointOptions) => {
      requireLive();
      const normalized = requirePhysicsJointCreateOptions(jointOptions);
      if (!bodyIds.has(normalized.bodyA) || !bodyIds.has(normalized.bodyB))
        throw new Error("TN_PHYSICS_UNKNOWN_BODY: joint references an unknown body.");
      if (raw.createJoint === undefined)
        throw new Error("TN_NATIVE_PHYSICS_JOINTS_MISSING: runtime ABI is too old");
      const id = raw.createJoint(normalized);
      if (!Number.isSafeInteger(id) || id < 0)
        throw new Error("TN_NATIVE_PHYSICS_INVALID: runtime returned an invalid joint id");
      if (jointBodies.has(id))
        throw new Error("TN_NATIVE_PHYSICS_INVALID: runtime returned a duplicate joint id");
      jointBodies.set(id, [normalized.bodyA, normalized.bodyB]);
      return id;
    },
    configureCharacter: (id, options) => {
      raw.configureCharacter(id, options);
      invalidateObservations();
    },
    removeBody: (id) => {
      raw.removeBody(id);
      bodyIds.delete(id);
      bodyHandles.delete(id);
      for (const [jointId, bodies] of jointBodies) {
        if (bodies[0] === id || bodies[1] === id) jointBodies.delete(jointId);
      }
      areaIds.delete(id);
      characterIds.delete(id);
      characterState.delete(id);
      invalidateObservations();
    },
    removeJoint: (id) => {
      if (disposed || !jointBodies.has(id)) return;
      if (raw.removeJoint === undefined)
        throw new Error("TN_NATIVE_PHYSICS_JOINTS_MISSING: runtime ABI is too old");
      raw.removeJoint(id);
      jointBodies.delete(id);
    },
    setBodyTransform: (id, position) => {
      if (raw.setBodyTransform === undefined)
        throw new Error("TN_NATIVE_PHYSICS_SET_TRANSFORM_MISSING: runtime ABI is too old");
      raw.setBodyTransform(id, position);
    },
    // Keep the optional raw members: an older runtime must throw rather than accept a call and
    // drop the actuation, which would make the same game diverge by platform.
    applyBodyImpulse: (id, impulse) => {
      requireLive();
      requireFiniteVector(impulse, "impulse");
      if (raw.applyBodyImpulse === undefined)
        throw new Error("TN_NATIVE_PHYSICS_ACTUATION_MISSING: runtime ABI is too old");
      raw.applyBodyImpulse(id, impulse);
    },
    applyBodyForce: (id, force) => {
      requireLive();
      requireFiniteVector(force, "force");
      if (raw.applyBodyForce === undefined)
        throw new Error("TN_NATIVE_PHYSICS_ACTUATION_MISSING: runtime ABI is too old");
      raw.applyBodyForce(id, force);
    },
    setBodyLinearVelocity: (id, velocity) => {
      requireLive();
      requireFiniteVector(velocity, "linearVelocity");
      if (raw.setBodyLinearVelocity === undefined)
        throw new Error("TN_NATIVE_PHYSICS_ACTUATION_MISSING: runtime ABI is too old");
      raw.setBodyLinearVelocity(id, velocity);
    },
    readBodyLinearVelocity: (id) => {
      requireLive();
      if (raw.readBodyLinearVelocity === undefined)
        throw new Error("TN_NATIVE_PHYSICS_ACTUATION_MISSING: runtime ABI is too old");
      const velocity = raw.readBodyLinearVelocity(id);
      requireFiniteVector(velocity, "native linear velocity");
      return velocity;
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
    readBodySleepStates: (buffer) => {
      if (disposed) throw new Error("Physics simulation is disposed.");
      requirePhysicsSleepStateBuffer(buffer, bodyIds.size);
      return raw.readBodySleepStates(buffer);
    },
    intersectRay: (value) => {
      const query = requirePhysicsRayQuery(value);
      const hit = raw.intersectRay(query, rayOutput);
      if (typeof hit === "number") {
        if (hit === 0) return undefined;
        if (hit !== 1)
          throw new Error("TN_NATIVE_PHYSICS_INVALID: ray query returned an invalid status");
        const bodyId = rayOutput[0];
        const position = {
          x: rayOutput[1] as number,
          y: rayOutput[2] as number,
          z: rayOutput[3] as number,
        };
        const normal = {
          x: rayOutput[4] as number,
          y: rayOutput[5] as number,
          z: rayOutput[6] as number,
        };
        const distance = rayOutput[7] as number;
        if (
          bodyId === undefined ||
          !Number.isSafeInteger(bodyId) ||
          bodyId < 0 ||
          distance === undefined
        )
          throw new Error("TN_NATIVE_PHYSICS_INVALID: ray output is malformed");
        const base = nativeHit({ bodyId, position });
        if (!Number.isFinite(distance) || distance < 0)
          throw new Error("TN_NATIVE_PHYSICS_INVALID: ray output distance is invalid");
        return { ...base, distance, normal: finiteQueryVector(normal, "ray output normal") };
      }
      if (hit === undefined || hit === null) return undefined;
      if (!Number.isFinite(hit.distance) || hit.distance < 0)
        throw new Error("TN_NATIVE_PHYSICS_INVALID: ray query returned an invalid distance");
      const base = nativeHit({ bodyId: hit.bodyId, position: hit.position });
      return {
        ...base,
        distance: hit.distance,
        normal: finiteQueryVector(hit.normal, "ray hit normal"),
      };
    },
    intersectShape: (value) => {
      const query = requirePhysicsShapeQuery(value);
      const hits = raw.intersectShape({
        collisionMask: query.collisionMask,
        maxResults: query.maxResults,
        position: query.position,
        rotation: query.rotation,
        shape: primitiveShape(query.shape),
      });
      if (!Array.isArray(hits) || hits.length > query.maxResults)
        throw new Error("TN_NATIVE_PHYSICS_INVALID: malformed shape query result");
      return hits.map(nativeHit);
    },
    intersectPoint: (value) => {
      const query = requirePhysicsPointQuery(value);
      const hits = raw.intersectPoint(query);
      if (!Array.isArray(hits) || hits.length > query.maxResults)
        throw new Error("TN_NATIVE_PHYSICS_INVALID: malformed point query result");
      return hits.map(nativeHit);
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
      if (disposed) return;
      disposed = true;
      raw.dispose();
      bodyIds.clear();
      bodyHandles.clear();
      jointBodies.clear();
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
