import type * as rapier from "@dimforge/rapier3d-compat";
import { interactionGroups } from "./collision.js";
import {
  type IPhysicsBodyHandle,
  type IPhysicsColliderHandle,
  type IPhysicsHandle,
  physicsBodyHandle,
  physicsColliderHandle,
  physicsHandle,
} from "./handles.js";

/** One record is logical body id, xyz position, and xyzw rotation. */
export const PHYSICS_TRANSFORM_STRIDE = 8;

export const PHYSICS_COLLISION_EVENT_STRIDE = 4;

/** One record is logical body id and a sleeping flag encoded as 0 or 1. */
export const PHYSICS_SLEEP_STATE_STRIDE = 2;

export type PhysicsShapeKind =
  | "box"
  | "sphere"
  | "capsule"
  | "trimesh"
  | "convexHull"
  | "heightfield";

/** Portable shape data. Backend-specific objects are created only by a simulation adapter. */
export interface IPhysicsShapeDescriptor {
  readonly kind: PhysicsShapeKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vertices?: Float32Array;
  readonly indices?: Uint32Array;
  readonly rows?: number;
  readonly columns?: number;
  readonly heights?: Float32Array;
  readonly scale?: { readonly x: number; readonly y: number; readonly z: number };
  readonly shape?: unknown;
  collisionLayer: number;
  collisionMask: number;
  sensor: boolean;
}

export type PhysicsBodyType = "character" | "dynamic" | "fixed" | "kinematic";

export interface IPhysicsBodyCreateOptions {
  readonly type: PhysicsBodyType;
  readonly shape: IPhysicsShapeDescriptor;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
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

export interface IPhysicsBodyRegistration {
  readonly body: IPhysicsBodyHandle;
  readonly collider: IPhysicsColliderHandle;
  readonly controller?: IPhysicsHandle;
  /** The backend shape object to expose through `CollisionShape3D.raw`. */
  readonly rawShape: unknown;
}

export interface IPhysicsCharacterOptions {
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

export interface IPhysicsCharacterState {
  readonly grounded: boolean;
  readonly groundCollider?: number;
}

export interface IPhysicsInputSnapshot {
  /** One eight-float record per kinematic body. The buffer is caller-owned and reusable. */
  readonly kinematicTransforms: Readonly<Float32Array>;
  readonly kinematicCount: number;
}

/** The backend seam used by all shared physics nodes. */
export interface IPhysicsSimulation {
  createBody(options: IPhysicsBodyCreateOptions): IPhysicsBodyRegistration;
  configureCharacter(id: number, options: IPhysicsCharacterOptions): void;
  removeBody(id: number): void;
  /** Cold-path repositioning for teleport/setup. Per-frame kinematics use `step()` input. */
  setBodyTransform(
    id: number,
    position: { readonly x: number; readonly y: number; readonly z: number },
  ): void;
  step(deltaTime: number, inputSnapshot?: IPhysicsInputSnapshot): void;
  readVisibleTransforms(renderBuffer: Float32Array): number;
  readBodySleepStates(buffer: Float32Array): number;
  readBodyTransform?(id: number):
    | {
        readonly position: { readonly x: number; readonly y: number; readonly z: number };
        readonly rotation: {
          readonly x: number;
          readonly y: number;
          readonly z: number;
          readonly w: number;
        };
      }
    | undefined;
  /** Reflects the most recently completed step, independent of visible-transform reads. */
  readCharacterState?(id: number): IPhysicsCharacterState | undefined;
  /** Reflects the most recently completed step, independent of visible-transform reads. */
  areaIntersections?(id: number): ReadonlySet<number>;
  drainCollisionEvents(buffer: Uint32Array): number;
  dispose(): void;
}

/** Runtime metadata needed to expose backend-specific escape hatches without leaking them. */
export interface IPhysicsRuntimeSimulation extends IPhysicsSimulation {
  readonly version: string;
  readonly rawWorld: unknown;
  readonly rawEventQueue: unknown;
}

export interface IPhysicsSimulationBackend {
  initialize(): Promise<void>;
  createSimulation(options?: {
    readonly gravity?: { readonly x: number; readonly y: number; readonly z: number };
  }): IPhysicsRuntimeSimulation;
  createShape?(shape: IPhysicsShapeDescriptor): unknown;
  simulationForWorld?(world: unknown): IPhysicsSimulation;
}

let selectedBackend: IPhysicsSimulationBackend | undefined;

export function installPhysicsSimulationBackend(backend: IPhysicsSimulationBackend): void {
  selectedBackend = backend;
}

export function physicsSimulationBackend(): IPhysicsSimulationBackend {
  if (selectedBackend === undefined)
    throw new Error("TN_PHYSICS_BACKEND_MISSING: no IPhysicsSimulation backend was selected");
  return selectedBackend;
}

interface ISimulationBody {
  readonly id: number;
  readonly body: rapier.RigidBody;
  readonly collider: rapier.Collider;
  readonly type: PhysicsBodyType;
  controller?: rapier.KinematicCharacterController;
  controllerHandle?: IPhysicsHandle;
  character?: IPhysicsCharacterOptions;
  groundCollider?: number;
}

interface IWebPhysicsSimulationOptions {
  readonly rapier: typeof rapier;
  readonly world: rapier.World;
  readonly eventQueue: rapier.EventQueue;
  readonly version: string;
}

export function requirePhysicsStepInput(
  deltaTime: number,
  inputSnapshot: IPhysicsInputSnapshot | undefined,
  bodyExists: (id: number) => boolean,
): void {
  if (!Number.isFinite(deltaTime) || deltaTime <= 0)
    throw new Error("IPhysicsSimulation.step requires a positive finite deltaTime.");
  if (inputSnapshot === undefined) return;
  if (!(inputSnapshot.kinematicTransforms instanceof Float32Array))
    throw new Error("IPhysicsSimulation input must use a Float32Array.");
  if (
    !Number.isSafeInteger(inputSnapshot.kinematicCount) ||
    inputSnapshot.kinematicCount < 0 ||
    inputSnapshot.kinematicCount >
      Math.floor(inputSnapshot.kinematicTransforms.length / PHYSICS_TRANSFORM_STRIDE)
  ) {
    throw new Error("IPhysicsSimulation input has an invalid kinematic record count.");
  }
  for (let index = 0; index < inputSnapshot.kinematicCount; index += 1) {
    const offset = index * PHYSICS_TRANSFORM_STRIDE;
    for (let scalar = 0; scalar < PHYSICS_TRANSFORM_STRIDE; scalar += 1) {
      if (!Number.isFinite(inputSnapshot.kinematicTransforms[offset + scalar]))
        throw new Error("IPhysicsSimulation input contains a non-finite transform.");
    }
    const id = inputSnapshot.kinematicTransforms[offset] as number;
    if (!Number.isInteger(id) || id < 0)
      throw new Error("IPhysicsSimulation input contains an invalid body id.");
    if (!bodyExists(id)) throw new Error("IPhysicsSimulation input contains an unknown body id.");
  }
}

export function requirePhysicsRenderBuffer(renderBuffer: Float32Array, bodyCount: number): void {
  if (!(renderBuffer instanceof Float32Array))
    throw new Error("IPhysicsSimulation output must use a Float32Array.");
  if (renderBuffer.length < bodyCount * PHYSICS_TRANSFORM_STRIDE)
    throw new Error("IPhysicsSimulation output buffer is too small for visible transforms.");
}

export function requirePhysicsSleepStateBuffer(buffer: Float32Array, bodyCount: number): void {
  if (!(buffer instanceof Float32Array))
    throw new Error("IPhysicsSimulation sleep states must use a Float32Array.");
  if (buffer.length < bodyCount * PHYSICS_SLEEP_STATE_STRIDE)
    throw new Error("IPhysicsSimulation sleep state buffer is too small.");
}

export function requirePhysicsEventBuffer(buffer: Uint32Array): void {
  if (!(buffer instanceof Uint32Array))
    throw new Error("IPhysicsSimulation events must use a Uint32Array.");
}

export function requirePhysicsBodySensor(
  options: Pick<IPhysicsBodyCreateOptions, "sensor" | "shape">,
): boolean {
  if (options.sensor !== options.shape.sensor)
    throw new Error(
      `TN_PHYSICS_SENSOR_CONFLICT: options.sensor (${options.sensor}) must match shape.sensor (${options.shape.sensor}).`,
    );
  return options.sensor;
}

export function createWebPhysicsShape(
  rapier: typeof import("@dimforge/rapier3d-compat"),
  shape: IPhysicsShapeDescriptor,
  sensor = shape.sensor,
): rapier.ColliderDesc {
  let descriptor: rapier.ColliderDesc | null;
  if (shape.kind === "box") descriptor = rapier.ColliderDesc.cuboid(shape.x, shape.y, shape.z);
  else if (shape.kind === "sphere") descriptor = rapier.ColliderDesc.ball(shape.x);
  else if (shape.kind === "capsule") descriptor = rapier.ColliderDesc.capsule(shape.x, shape.y);
  else if (shape.kind === "trimesh") {
    if (shape.vertices === undefined || shape.indices === undefined)
      throw new Error("CollisionShape3D.trimesh is missing mesh data.");
    descriptor = rapier.ColliderDesc.trimesh(shape.vertices, shape.indices);
  } else if (shape.kind === "convexHull") {
    if (shape.vertices === undefined)
      throw new Error("CollisionShape3D.convexHull is missing vertices.");
    descriptor = rapier.ColliderDesc.convexHull(shape.vertices);
    if (descriptor === null) throw new Error("CollisionShape3D could not build a convex hull.");
  } else {
    if (
      shape.rows === undefined ||
      shape.columns === undefined ||
      shape.heights === undefined ||
      shape.scale === undefined
    )
      throw new Error("CollisionShape3D.heightfield is missing height data.");
    descriptor = rapier.ColliderDesc.heightfield(
      shape.rows - 1,
      shape.columns - 1,
      shape.heights,
      shape.scale,
    );
  }
  descriptor.setCollisionGroups(interactionGroups(shape.collisionLayer, shape.collisionMask));
  descriptor.setSensor(sensor);
  descriptor.setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);
  return descriptor;
}

function bodyDescription(
  rapier: typeof import("@dimforge/rapier3d-compat"),
  type: PhysicsBodyType,
  position: IPhysicsBodyCreateOptions["position"],
  rotation: IPhysicsBodyCreateOptions["rotation"],
  mass: number,
): rapier.RigidBodyDesc {
  const description =
    type === "fixed"
      ? rapier.RigidBodyDesc.fixed()
      : type === "kinematic" || type === "character"
        ? rapier.RigidBodyDesc.kinematicPositionBased()
        : rapier.RigidBodyDesc.dynamic();
  description
    .setTranslation(position.x, position.y, position.z)
    .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
  if (mass !== 0) description.setAdditionalMass(mass);
  return description;
}

function characterState(
  simulationBody: ISimulationBody,
  byCollider: ReadonlyMap<number, ISimulationBody>,
): IPhysicsCharacterState {
  const controller = simulationBody.controller;
  if (controller === undefined) return { grounded: false };
  let groundCollider: number | undefined;
  for (let index = 0; index < controller.numComputedCollisions(); index += 1) {
    const collision = controller.computedCollision(index);
    if (collision?.collider === null || collision?.collider === undefined) continue;
    if ((collision.normal1.y ?? Number.NEGATIVE_INFINITY) >= 0.5) {
      groundCollider = byCollider.get(collision.collider.handle)?.id;
      if (groundCollider !== undefined) break;
    }
  }
  const grounded = controller.computedGrounded();
  if (groundCollider !== undefined) simulationBody.groundCollider = groundCollider;
  else if (!grounded) simulationBody.groundCollider = undefined;
  return { grounded, groundCollider: simulationBody.groundCollider };
}

/** Web adapter. It is the only implementation that names Rapier's JS objects. */
export function createWebPhysicsSimulation(
  options: IWebPhysicsSimulationOptions,
): IPhysicsRuntimeSimulation {
  const bodies = new Map<number, ISimulationBody>();
  const byCollider = new Map<number, ISimulationBody>();
  const pendingCollisionEvents: number[][] = [];
  let nextId = 0;
  let disposed = false;

  const requireLive = () => {
    if (disposed) throw new Error("Physics simulation is disposed.");
  };

  const simulation: IPhysicsRuntimeSimulation = {
    version: options.version,
    rawWorld: options.world,
    rawEventQueue: options.eventQueue,
    createBody: (bodyOptions) => {
      requireLive();
      const sensor = requirePhysicsBodySensor(bodyOptions);
      if (!Number.isFinite(bodyOptions.mass) || bodyOptions.mass < 0)
        throw new Error("Physics body mass must be a finite non-negative number.");
      const id = nextId;
      nextId += 1;
      const rawShape = createWebPhysicsShape(options.rapier, bodyOptions.shape, sensor);
      const rawBody = options.world.createRigidBody(
        bodyDescription(
          options.rapier,
          bodyOptions.type,
          bodyOptions.position,
          bodyOptions.rotation,
          bodyOptions.mass,
        ),
      );
      const rawCollider = options.world.createCollider(rawShape, rawBody);
      const entry: ISimulationBody = {
        body: rawBody,
        collider: rawCollider,
        id,
        type: bodyOptions.type,
      };
      if (bodyOptions.type === "character") {
        entry.controller = options.world.createCharacterController(0.01);
        entry.controllerHandle = physicsHandle(entry.controller);
      }
      bodies.set(id, entry);
      byCollider.set(rawCollider.handle, entry);
      return {
        body: physicsBodyHandle(id, rawBody),
        collider: physicsColliderHandle(id, rawCollider),
        controller: entry.controllerHandle,
        rawShape,
      };
    },
    configureCharacter: (id, characterOptions) => {
      requireLive();
      const entry = bodies.get(id);
      if (entry?.controller === undefined)
        throw new Error("Physics character configuration references a non-character body.");
      if (characterOptions.offset !== 0.01) {
        options.world.removeCharacterController(entry.controller);
        entry.controller = options.world.createCharacterController(characterOptions.offset);
        if (entry.controllerHandle !== undefined)
          (entry.controllerHandle as { raw: unknown }).raw = entry.controller;
      }
      entry.character = characterOptions;
      entry.controller.setMaxSlopeClimbAngle(characterOptions.maxSlopeClimbAngle);
      if (characterOptions.autostep !== undefined) {
        entry.controller.enableAutostep(
          characterOptions.autostep.maxHeight,
          characterOptions.autostep.minWidth,
          characterOptions.autostep.includeDynamicBodies,
        );
      }
      if (characterOptions.snapToGround !== undefined)
        entry.controller.enableSnapToGround(characterOptions.snapToGround);
    },
    removeBody: (id) => {
      requireLive();
      const entry = bodies.get(id);
      if (entry === undefined) return;
      bodies.delete(id);
      byCollider.delete(entry.collider.handle);
      if (entry.controller !== undefined) options.world.removeCharacterController(entry.controller);
      if (entry.body.isValid()) options.world.removeRigidBody(entry.body);
    },
    setBodyTransform: (id, position) => {
      requireLive();
      const entry = bodies.get(id);
      if (entry === undefined)
        throw new Error("Physics body transform references an unknown body.");
      entry.body.setTranslation(position, true);
    },
    step: (deltaTime, inputSnapshot) => {
      requireLive();
      requirePhysicsStepInput(deltaTime, inputSnapshot, (id) => bodies.has(id));
      if (inputSnapshot !== undefined) {
        for (let index = 0; index < inputSnapshot.kinematicCount; index += 1) {
          const offset = index * PHYSICS_TRANSFORM_STRIDE;
          const id = inputSnapshot.kinematicTransforms[offset] as number;
          const entry = bodies.get(id);
          if (entry === undefined) throw new Error("IPhysicsSimulation input body disappeared.");
          const target = {
            x: inputSnapshot.kinematicTransforms[offset + 1] as number,
            y: inputSnapshot.kinematicTransforms[offset + 2] as number,
            z: inputSnapshot.kinematicTransforms[offset + 3] as number,
          };
          const rotation = {
            x: inputSnapshot.kinematicTransforms[offset + 4] as number,
            y: inputSnapshot.kinematicTransforms[offset + 5] as number,
            z: inputSnapshot.kinematicTransforms[offset + 6] as number,
            w: inputSnapshot.kinematicTransforms[offset + 7] as number,
          };
          if (entry.type === "character") {
            const controller = entry.controller;
            const config = entry.character;
            if (controller === undefined || config === undefined)
              throw new Error("Physics character was not configured before stepping.");
            const current = entry.body.translation();
            const desired = {
              x: target.x - current.x,
              y: target.y - current.y,
              z: target.z - current.z,
            };
            const characterGroups = entry.collider.collisionGroups();
            const filterGroups =
              config.oneWayLayers !== 0 && desired.y > 0
                ? interactionGroups(
                    characterGroups >>> 16,
                    characterGroups & 0xffff & (0xffff ^ config.oneWayLayers),
                  )
                : characterGroups;
            const filterPredicate =
              config.oneWayLayers !== 0 && desired.y > 0
                ? (collider: rapier.Collider) =>
                    ((collider.collisionGroups() >>> 16) & config.oneWayLayers) === 0
                : undefined;
            controller.computeColliderMovement(
              entry.collider,
              desired,
              options.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
              filterGroups,
              filterPredicate,
            );
            const movement = controller.computedMovement();
            entry.body.setNextKinematicTranslation({
              x: current.x + movement.x,
              y: current.y + movement.y,
              z: current.z + movement.z,
            });
          } else {
            if (!entry.body.isKinematic())
              throw new Error("IPhysicsSimulation received kinematic input for a dynamic body.");
            entry.body.setNextKinematicTranslation(target);
          }
          entry.body.setNextKinematicRotation(rotation);
        }
      }
      options.world.timestep = deltaTime;
      options.world.step(options.eventQueue);
    },
    readVisibleTransforms: (renderBuffer) => {
      requireLive();
      requirePhysicsRenderBuffer(renderBuffer, bodies.size);
      let index = 0;
      for (const entry of bodies.values()) {
        if (!entry.body.isValid()) continue;
        const offset = index * PHYSICS_TRANSFORM_STRIDE;
        const translation = entry.body.translation();
        const rotation = entry.body.rotation();
        renderBuffer[offset] = entry.id;
        renderBuffer[offset + 1] = translation.x;
        renderBuffer[offset + 2] = translation.y;
        renderBuffer[offset + 3] = translation.z;
        renderBuffer[offset + 4] = rotation.x;
        renderBuffer[offset + 5] = rotation.y;
        renderBuffer[offset + 6] = rotation.z;
        renderBuffer[offset + 7] = rotation.w;
        index += 1;
      }
      return index;
    },
    readBodySleepStates: (buffer) => {
      requireLive();
      requirePhysicsSleepStateBuffer(buffer, bodies.size);
      let index = 0;
      for (const entry of bodies.values()) {
        if (!entry.body.isValid()) continue;
        const offset = index * PHYSICS_SLEEP_STATE_STRIDE;
        buffer[offset] = entry.id;
        buffer[offset + 1] = entry.body.isSleeping() ? 1 : 0;
        index += 1;
      }
      return index;
    },
    readBodyTransform: (id) => {
      requireLive();
      const entry = bodies.get(id);
      if (entry === undefined || !entry.body.isValid()) return undefined;
      const position = entry.body.translation();
      const rotation = entry.body.rotation();
      return { position, rotation };
    },
    readCharacterState: (id) => {
      requireLive();
      const entry = bodies.get(id);
      return entry === undefined ? undefined : characterState(entry, byCollider);
    },
    areaIntersections: (id) => {
      requireLive();
      const area = bodies.get(id);
      if (area === undefined) return new Set();
      const current = new Set<number>();
      const areaMask = area.collider.collisionGroups() & 0xffff;
      options.world.intersectionsWithShape(
        area.collider.translation(),
        area.collider.rotation(),
        area.collider.shape,
        (collider) => {
          const body = byCollider.get(collider.handle);
          if (
            body !== undefined &&
            body.id !== id &&
            !collider.isSensor() &&
            ((collider.collisionGroups() >>> 16) & areaMask) !== 0
          )
            current.add(body.id);
          return true;
        },
        options.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        area.collider,
      );
      return current;
    },
    drainCollisionEvents: (buffer) => {
      requireLive();
      requirePhysicsEventBuffer(buffer);
      options.eventQueue.drainCollisionEvents((first, second, started) => {
        const left = byCollider.get(first)?.id;
        const right = byCollider.get(second)?.id;
        if (left !== undefined && right !== undefined)
          pendingCollisionEvents.push([left, right, Number(started), 1]);
      });
      if (buffer.length < pendingCollisionEvents.length * PHYSICS_COLLISION_EVENT_STRIDE)
        throw new Error("IPhysicsSimulation collision event buffer is too small.");
      pendingCollisionEvents.forEach((event, index) =>
        buffer.set(event, index * PHYSICS_COLLISION_EVENT_STRIDE),
      );
      const count = pendingCollisionEvents.length;
      pendingCollisionEvents.length = 0;
      return count;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const entry of bodies.values()) {
        if (entry.controller !== undefined)
          options.world.removeCharacterController(entry.controller);
        if (entry.body.isValid()) options.world.removeRigidBody(entry.body);
      }
      bodies.clear();
      byCollider.clear();
      pendingCollisionEvents.length = 0;
      options.eventQueue.free();
      options.world.free();
    },
  };
  return simulation;
}

export function requirePhysicsSimulation(
  physics: { readonly simulation?: IPhysicsSimulation } | undefined,
  world: unknown,
): IPhysicsSimulation {
  if (physics?.simulation !== undefined) return physics.simulation;
  const candidate =
    typeof world === "object" && world !== null && "simulation" in world
      ? (world as { readonly simulation?: unknown }).simulation
      : world;
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    "createBody" in candidate &&
    typeof candidate.createBody === "function" &&
    "step" in candidate &&
    typeof candidate.step === "function"
  )
    return candidate as IPhysicsSimulation;
  const backend = selectedBackend;
  if (world !== undefined && backend?.simulationForWorld !== undefined)
    return backend.simulationForWorld(candidate);
  throw new Error(
    "Physics nodes require an IPhysicsContext. Passing a raw backend world is deprecated and backend-specific.",
  );
}
