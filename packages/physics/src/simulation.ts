import type * as RAPIER from "@dimforge/rapier3d-compat";
import { interactionGroups } from "./collision.js";
import {
  type PhysicsBodyHandle,
  type PhysicsColliderHandle,
  type PhysicsHandle,
  physicsBodyHandle,
  physicsColliderHandle,
  physicsHandle,
} from "./handles.js";

/** One record is logical body id, xyz position, and xyzw rotation. */
export const PHYSICS_TRANSFORM_STRIDE = 8;

export const PHYSICS_COLLISION_EVENT_STRIDE = 4;

export type PhysicsShapeKind =
  | "box"
  | "sphere"
  | "capsule"
  | "trimesh"
  | "convexHull"
  | "heightfield";

/** Portable shape data. Backend-specific objects are created only by a simulation adapter. */
export interface PhysicsShapeDescriptor {
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

export interface PhysicsBodyCreateOptions {
  readonly type: PhysicsBodyType;
  readonly shape: PhysicsShapeDescriptor;
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

export interface PhysicsBodyRegistration {
  readonly body: PhysicsBodyHandle;
  readonly collider: PhysicsColliderHandle;
  readonly controller?: PhysicsHandle;
  /** The backend shape object to expose through `CollisionShape3D.raw`. */
  readonly rawShape: unknown;
}

export interface PhysicsCharacterOptions {
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

export interface PhysicsCharacterState {
  readonly grounded: boolean;
  readonly groundCollider?: number;
}

export interface PhysicsInputSnapshot {
  /** One eight-float record per kinematic body. The buffer is caller-owned and reusable. */
  readonly kinematicTransforms: Readonly<Float32Array>;
  readonly kinematicCount: number;
}

/** The backend seam used by all shared physics nodes. */
export interface PhysicsSimulation {
  createBody(options: PhysicsBodyCreateOptions): PhysicsBodyRegistration;
  configureCharacter(id: number, options: PhysicsCharacterOptions): void;
  removeBody(id: number): void;
  /** Cold-path repositioning for teleport/setup. Per-frame kinematics use `step()` input. */
  setBodyTransform(
    id: number,
    position: { readonly x: number; readonly y: number; readonly z: number },
  ): void;
  step(deltaTime: number, inputSnapshot?: PhysicsInputSnapshot): void;
  readVisibleTransforms(renderBuffer: Float32Array): number;
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
  readCharacterState?(id: number): PhysicsCharacterState | undefined;
  /** Reflects the most recently completed step, independent of visible-transform reads. */
  areaIntersections?(id: number): ReadonlySet<number>;
  drainCollisionEvents(buffer: Uint32Array): number;
  dispose(): void;
}

/** Runtime metadata needed to expose backend-specific escape hatches without leaking them. */
export interface PhysicsRuntimeSimulation extends PhysicsSimulation {
  readonly version: string;
  readonly rawWorld: unknown;
  readonly rawEventQueue: unknown;
}

export interface PhysicsSimulationBackend {
  initialize(): Promise<void>;
  createSimulation(options?: {
    readonly gravity?: { readonly x: number; readonly y: number; readonly z: number };
  }): PhysicsRuntimeSimulation;
  createShape?(shape: PhysicsShapeDescriptor): unknown;
  simulationForWorld?(world: unknown): PhysicsSimulation;
}

let selectedBackend: PhysicsSimulationBackend | undefined;

export function installPhysicsSimulationBackend(backend: PhysicsSimulationBackend): void {
  selectedBackend = backend;
}

export function physicsSimulationBackend(): PhysicsSimulationBackend {
  if (selectedBackend === undefined)
    throw new Error("TN_PHYSICS_BACKEND_MISSING: no PhysicsSimulation backend was selected");
  return selectedBackend;
}

interface SimulationBody {
  readonly id: number;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly type: PhysicsBodyType;
  controller?: RAPIER.KinematicCharacterController;
  controllerHandle?: PhysicsHandle;
  character?: PhysicsCharacterOptions;
  groundCollider?: number;
}

interface WebPhysicsSimulationOptions {
  readonly rapier: typeof RAPIER;
  readonly world: RAPIER.World;
  readonly eventQueue: RAPIER.EventQueue;
  readonly version: string;
}

export function requirePhysicsStepInput(
  deltaTime: number,
  inputSnapshot: PhysicsInputSnapshot | undefined,
  bodyExists: (id: number) => boolean,
): void {
  if (!Number.isFinite(deltaTime) || deltaTime <= 0)
    throw new Error("PhysicsSimulation.step requires a positive finite deltaTime.");
  if (inputSnapshot === undefined) return;
  if (!(inputSnapshot.kinematicTransforms instanceof Float32Array))
    throw new Error("PhysicsSimulation input must use a Float32Array.");
  if (
    !Number.isSafeInteger(inputSnapshot.kinematicCount) ||
    inputSnapshot.kinematicCount < 0 ||
    inputSnapshot.kinematicCount >
      Math.floor(inputSnapshot.kinematicTransforms.length / PHYSICS_TRANSFORM_STRIDE)
  ) {
    throw new Error("PhysicsSimulation input has an invalid kinematic record count.");
  }
  for (let index = 0; index < inputSnapshot.kinematicCount; index += 1) {
    const offset = index * PHYSICS_TRANSFORM_STRIDE;
    for (let scalar = 0; scalar < PHYSICS_TRANSFORM_STRIDE; scalar += 1) {
      if (!Number.isFinite(inputSnapshot.kinematicTransforms[offset + scalar]))
        throw new Error("PhysicsSimulation input contains a non-finite transform.");
    }
    const id = inputSnapshot.kinematicTransforms[offset] as number;
    if (!Number.isInteger(id) || id < 0)
      throw new Error("PhysicsSimulation input contains an invalid body id.");
    if (!bodyExists(id)) throw new Error("PhysicsSimulation input contains an unknown body id.");
  }
}

export function requirePhysicsRenderBuffer(renderBuffer: Float32Array, bodyCount: number): void {
  if (!(renderBuffer instanceof Float32Array))
    throw new Error("PhysicsSimulation output must use a Float32Array.");
  if (renderBuffer.length < bodyCount * PHYSICS_TRANSFORM_STRIDE)
    throw new Error("PhysicsSimulation output buffer is too small for visible transforms.");
}

export function requirePhysicsEventBuffer(buffer: Uint32Array): void {
  if (!(buffer instanceof Uint32Array))
    throw new Error("PhysicsSimulation events must use a Uint32Array.");
}

export function requirePhysicsBodySensor(
  options: Pick<PhysicsBodyCreateOptions, "sensor" | "shape">,
): boolean {
  if (options.sensor !== options.shape.sensor)
    throw new Error(
      `TN_PHYSICS_SENSOR_CONFLICT: options.sensor (${options.sensor}) must match shape.sensor (${options.shape.sensor}).`,
    );
  return options.sensor;
}

export function createWebPhysicsShape(
  rapier: typeof RAPIER,
  shape: PhysicsShapeDescriptor,
  sensor = shape.sensor,
): RAPIER.ColliderDesc {
  let descriptor: RAPIER.ColliderDesc | null;
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
  rapier: typeof RAPIER,
  type: PhysicsBodyType,
  position: PhysicsBodyCreateOptions["position"],
  rotation: PhysicsBodyCreateOptions["rotation"],
  mass: number,
): RAPIER.RigidBodyDesc {
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
  simulationBody: SimulationBody,
  byCollider: ReadonlyMap<number, SimulationBody>,
): PhysicsCharacterState {
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
  options: WebPhysicsSimulationOptions,
): PhysicsRuntimeSimulation {
  const bodies = new Map<number, SimulationBody>();
  const byCollider = new Map<number, SimulationBody>();
  const pendingCollisionEvents: number[][] = [];
  let nextId = 0;
  let disposed = false;

  const requireLive = () => {
    if (disposed) throw new Error("Physics simulation is disposed.");
  };

  const simulation: PhysicsRuntimeSimulation = {
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
      const entry: SimulationBody = {
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
          if (entry === undefined) throw new Error("PhysicsSimulation input body disappeared.");
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
                ? (collider: RAPIER.Collider) =>
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
              throw new Error("PhysicsSimulation received kinematic input for a dynamic body.");
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
        throw new Error("PhysicsSimulation collision event buffer is too small.");
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
  physics: { readonly simulation?: PhysicsSimulation } | undefined,
  world: unknown,
): PhysicsSimulation {
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
    return candidate as PhysicsSimulation;
  const backend = selectedBackend;
  if (world !== undefined && backend?.simulationForWorld !== undefined)
    return backend.simulationForWorld(candidate);
  throw new Error(
    "Physics nodes require a PhysicsContext. Passing a raw backend world is deprecated and backend-specific.",
  );
}
