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
/** Caps native query buffers while remaining exactly representable by the native ABI. */
export const MAX_PHYSICS_QUERY_RESULTS = 1024;

/** Matches the f32::EPSILON boundary used by the native Rapier seam. */
const F32_EPSILON = Math.fround(2 ** -23);
/** Native nalgebra's UnitVector::try_new compares the squared norm with this value. */
const F32_EPSILON_SQUARED = Math.fround(F32_EPSILON * F32_EPSILON);

/** Mirrors the native seam's f32 conversion and left-to-right f32 length-squared arithmetic. */
function f32LengthSquared(values: readonly number[]): number {
  let lengthSquared = 0;
  for (const value of values) {
    const component = Math.fround(value);
    lengthSquared = Math.fround(lengthSquared + Math.fround(component * component));
  }
  return lengthSquared;
}

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

/** Return the backend-effective CCD setting; only dynamic bodies can use continuous collision. */
export function effectiveContinuousCollision(
  type: PhysicsBodyType,
  requested: boolean | undefined,
): boolean {
  return type === "dynamic" && (requested ?? true);
}

export interface IPhysicsBodyCreateOptions {
  readonly type: PhysicsBodyType;
  readonly shape: IPhysicsShapeDescriptor;
  readonly entity?: string;
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
  /** Enable continuous collision for fast-moving dynamic bodies. Defaults true for dynamic bodies and is always false for non-dynamic bodies. */
  readonly continuousCollision?: boolean;
}

export interface IPhysicsVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface IPhysicsRotation {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export type PhysicsJointKind = "pin" | "hinge" | "fixed";

export interface IPhysicsJointLimit {
  readonly lower: number;
  readonly upper: number;
}

/** Backend-neutral data for a cold-path joint creation call. Anchors and frames are local-space. */
export interface IPhysicsJointCreateOptions {
  readonly type: PhysicsJointKind;
  readonly bodyA: number;
  readonly bodyB: number;
  readonly anchorA: IPhysicsVector3;
  readonly anchorB: IPhysicsVector3;
  readonly axis?: IPhysicsVector3;
  readonly limit?: IPhysicsJointLimit;
  readonly frameA?: IPhysicsRotation;
  readonly frameB?: IPhysicsRotation;
}

export interface IPhysicsRayQuery {
  readonly from: IPhysicsVector3;
  readonly to: IPhysicsVector3;
  readonly collisionMask: number;
}

export interface IPhysicsShapeQuery {
  readonly shape: IPhysicsShapeDescriptor;
  readonly position: IPhysicsVector3;
  readonly rotation: IPhysicsRotation;
  readonly collisionMask: number;
  readonly maxResults: number;
}

export interface IPhysicsPointQuery {
  readonly position: IPhysicsVector3;
  readonly collisionMask: number;
  readonly maxResults: number;
}

export interface IPhysicsQueryHit {
  readonly body: IPhysicsBodyHandle;
  readonly entity?: string;
  readonly position: IPhysicsVector3;
}

export interface IPhysicsRayHit extends IPhysicsQueryHit {
  readonly normal: IPhysicsVector3;
  readonly distance: number;
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
  /** Let the character shove dynamic bodies it collides with, instead of sliding past them. */
  readonly pushesDynamicBodies?: boolean;
}

export interface IPhysicsCharacterState {
  readonly grounded: boolean;
  readonly groundBody?: IPhysicsBodyHandle;
  readonly groundCollider?: number;
  readonly groundNormal?: IPhysicsVector3;
}

export interface IPhysicsInputSnapshot {
  /** One eight-float record per kinematic body. The buffer is caller-owned and reusable. */
  readonly kinematicTransforms: Readonly<Float32Array>;
  readonly kinematicCount: number;
}

/** The backend seam used by all shared physics nodes. */
export interface IPhysicsSimulation {
  createBody(options: IPhysicsBodyCreateOptions): IPhysicsBodyRegistration;
  createJoint(options: IPhysicsJointCreateOptions): number;
  configureCharacter(id: number, options: IPhysicsCharacterOptions): void;
  removeBody(id: number): void;
  removeJoint(id: number): void;
  /** Cold-path repositioning for teleport/setup. Per-frame kinematics use `step()` input. */
  setBodyTransform(
    id: number,
    position: { readonly x: number; readonly y: number; readonly z: number },
  ): void;
  /**
   * Dynamic-body actuation. Without these a game cannot move a dynamic body at all: a transform
   * write is overwritten by the next step, so `setBodyTransform` is genuinely cold-path only.
   */
  applyBodyImpulse(id: number, impulse: IPhysicsVector3): void;
  applyBodyForce(id: number, force: IPhysicsVector3): void;
  applyBodyForceAtPoint(id: number, force: IPhysicsVector3, point: IPhysicsVector3): void;
  setBodyLinearVelocity(id: number, velocity: IPhysicsVector3): void;
  readBodyLinearVelocity(id: number): IPhysicsVector3;
  step(deltaTime: number, inputSnapshot?: IPhysicsInputSnapshot): void;
  readVisibleTransforms(renderBuffer: Float32Array): number;
  readBodySleepStates(buffer: Float32Array): number;
  intersectRay(query: IPhysicsRayQuery): IPhysicsRayHit | undefined;
  intersectShape(query: IPhysicsShapeQuery): readonly IPhysicsQueryHit[];
  intersectPoint(query: IPhysicsPointQuery): readonly IPhysicsQueryHit[];
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
  /**
   * Reflects the most recently completed step, independent of visible-transform reads.
   *
   * This reuses one record per character, so the next call overwrites the object it returned.
   * Read it in the same tick, or copy the fields out before the step advances.
   */
  readCharacterState?(id: number): IPhysicsCharacterState | undefined;
  /**
   * Reflects the most recently completed step, independent of visible-transform reads.
   *
   * This reuses one set per area, so the next call overwrites the set it returned. Read it in
   * the same tick, or copy the fields out before the step advances.
   */
  areaIntersections?(id: number): ReadonlySet<number>;
  drainCollisionEvents(buffer: Uint32Array): number;
  dispose(): void;
}

/**
 * A NaN reaching Rapier corrupts the body's state for the rest of the run rather than throwing,
 * and the symptom surfaces frames later as a body that vanished. Reject it at the seam.
 */
export function requireFiniteVector(vector: IPhysicsVector3, label: string): void {
  if (
    typeof vector?.x !== "number" ||
    typeof vector.y !== "number" ||
    typeof vector.z !== "number" ||
    !Number.isFinite(vector.x) ||
    !Number.isFinite(vector.y) ||
    !Number.isFinite(vector.z)
  )
    throw new Error(`TN_PHYSICS_NON_FINITE: ${label} must be a finite { x, y, z }.`);
}

export function requireFiniteRotation(rotation: IPhysicsRotation, label: string): void {
  if (
    typeof rotation?.x !== "number" ||
    typeof rotation.y !== "number" ||
    typeof rotation.z !== "number" ||
    typeof rotation.w !== "number" ||
    !Number.isFinite(rotation.x) ||
    !Number.isFinite(rotation.y) ||
    !Number.isFinite(rotation.z) ||
    !Number.isFinite(rotation.w)
  )
    throw new Error(`TN_PHYSICS_NON_FINITE: ${label} must be a finite { x, y, z, w }.`);
  if (f32LengthSquared([rotation.x, rotation.y, rotation.z, rotation.w]) <= F32_EPSILON)
    throw new Error(`TN_PHYSICS_INVALID: ${label} must not have zero length.`);
}

export function requirePhysicsJointCreateOptions(
  options: IPhysicsJointCreateOptions,
): IPhysicsJointCreateOptions {
  if (typeof options !== "object" || options === null)
    throw new Error("IPhysicsSimulation joint options must be an object.");
  if (options.type !== "pin" && options.type !== "hinge" && options.type !== "fixed")
    throw new Error("IPhysicsSimulation joint options have an unknown type.");
  if (
    !Number.isSafeInteger(options.bodyA) ||
    options.bodyA < 0 ||
    !Number.isSafeInteger(options.bodyB) ||
    options.bodyB < 0 ||
    options.bodyA === options.bodyB
  )
    throw new Error("IPhysicsSimulation joint options must reference two distinct body ids.");
  requireFiniteVector(options.anchorA, "joint anchorA");
  requireFiniteVector(options.anchorB, "joint anchorB");
  if (options.type === "hinge") {
    if (options.axis === undefined) throw new Error("IPhysicsSimulation hinge requires an axis.");
    requireFiniteVector(options.axis, "joint axis");
    if (f32LengthSquared([options.axis.x, options.axis.y, options.axis.z]) <= F32_EPSILON_SQUARED)
      throw new Error("IPhysicsSimulation hinge axis must not have zero length.");
    if (options.limit !== undefined) {
      if (typeof options.limit !== "object" || options.limit === null)
        throw new Error("IPhysicsSimulation hinge limit must contain ordered finite bounds.");
      if (
        !Number.isFinite(options.limit.lower) ||
        !Number.isFinite(options.limit.upper) ||
        options.limit.lower > options.limit.upper
      )
        throw new Error("IPhysicsSimulation hinge limit must contain ordered finite bounds.");
    }
  } else if (options.axis !== undefined || options.limit !== undefined) {
    throw new Error("IPhysicsSimulation joint limits and axes are only valid for a hinge.");
  }
  if (options.type !== "fixed" && (options.frameA !== undefined || options.frameB !== undefined))
    throw new Error("IPhysicsSimulation joint frames are only valid for a fixed joint.");
  if (options.frameA !== undefined) requireFiniteRotation(options.frameA, "joint frameA");
  if (options.frameB !== undefined) requireFiniteRotation(options.frameB, "joint frameB");
  return options;
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
  readonly bodyHandle: IPhysicsBodyHandle;
  readonly collider: rapier.Collider;
  readonly characterState: IStoredCharacterState;
  readonly entity?: string;
  readonly type: PhysicsBodyType;
  controller?: rapier.KinematicCharacterController;
  controllerHandle?: IPhysicsHandle;
  character?: IPhysicsCharacterOptions;
  groundCollider?: number;
}

interface IStoredCharacterState {
  grounded: boolean;
  groundBody?: IPhysicsBodyHandle;
  groundCollider?: number;
  readonly groundNormal: { x: number; y: number; z: number };
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

// Reused across kinematic input records in `step`: per-body-per-step object literals here were
// pure garbage handed to the collector at frame rate. Rapier reads each of them synchronously
// within the same call that receives it.
const kinematicScratch = {
  target: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  desired: { x: 0, y: 0, z: 0 },
  nextTranslation: { x: 0, y: 0, z: 0 },
};
// One closure instead of one per character per step; the layers it tests are set right before
// computeColliderMovement, which consumes it synchronously.
let oneWayFilterLayers = 0;
const oneWayFilterPredicate = (collider: rapier.Collider): boolean =>
  ((collider.collisionGroups() >>> 16) & oneWayFilterLayers) === 0;

const QUERY_SHAPE_KINDS = new Set<PhysicsShapeKind>([
  "box",
  "sphere",
  "capsule",
  "trimesh",
  "convexHull",
  "heightfield",
]);

function queryObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null)
    throw new Error(`IPhysicsSimulation ${label} must be an object.`);
  return value as Record<string, unknown>;
}

function queryVector(value: unknown, label: string): IPhysicsVector3 {
  const object = queryObject(value, `${label} vector`);
  const x = object.x;
  const y = object.y;
  const z = object.z;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof z !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  )
    throw new Error(`IPhysicsSimulation ${label} vector must contain finite x, y, and z values.`);
  return { x, y, z };
}

function queryRotation(value: unknown): IPhysicsRotation {
  const object = queryObject(value, "shape rotation");
  const x = object.x;
  const y = object.y;
  const z = object.z;
  const w = object.w;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof z !== "number" ||
    typeof w !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z) ||
    !Number.isFinite(w)
  )
    throw new Error("IPhysicsSimulation shape rotation must contain finite x, y, z, and w values.");
  const lengthSquared = x * x + y * y + z * z + w * w;
  if (lengthSquared <= Number.EPSILON)
    throw new Error("IPhysicsSimulation shape rotation must not have zero length.");
  return { w, x, y, z };
}

export function requirePhysicsCollisionMask(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 0xffff)
    throw new Error("IPhysicsSimulation collisionMask must be an integer from 0 through 65535.");
  return value;
}

export function requirePhysicsMaxResults(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_PHYSICS_QUERY_RESULTS
  )
    throw new Error(
      `IPhysicsSimulation maxResults must be an integer from 1 through ${MAX_PHYSICS_QUERY_RESULTS}.`,
    );
  return value;
}

function queryShape(value: unknown): IPhysicsShapeDescriptor {
  const shape = queryObject(value, "query shape");
  const kind = shape.kind;
  if (typeof kind !== "string" || !QUERY_SHAPE_KINDS.has(kind as PhysicsShapeKind))
    throw new Error("IPhysicsSimulation query shape has an unknown kind.");
  const x = shape.x;
  const y = shape.y;
  const z = shape.z;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof z !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  )
    throw new Error("IPhysicsSimulation query shape dimensions must be finite.");
  if (kind === "box" && (x <= 0 || y <= 0 || z <= 0))
    throw new Error("IPhysicsSimulation query box dimensions must be positive.");
  if (kind === "sphere" && x <= 0)
    throw new Error("IPhysicsSimulation query sphere radius must be positive.");
  if (kind === "capsule" && (x < 0 || y <= 0))
    throw new Error("IPhysicsSimulation query capsule dimensions are invalid.");
  return shape as unknown as IPhysicsShapeDescriptor;
}

export function requirePhysicsRayQuery(value: unknown): IPhysicsRayQuery {
  const query = queryObject(value, "ray query");
  const from = queryVector(query.from, "ray from");
  const to = queryVector(query.to, "ray to");
  if (from.x === to.x && from.y === to.y && from.z === to.z)
    throw new Error("IPhysicsSimulation ray must have non-zero length.");
  return {
    collisionMask: requirePhysicsCollisionMask(query.collisionMask),
    from,
    to,
  };
}

export function requirePhysicsShapeQuery(value: unknown): IPhysicsShapeQuery {
  const query = queryObject(value, "shape query");
  return {
    collisionMask: requirePhysicsCollisionMask(query.collisionMask),
    maxResults: requirePhysicsMaxResults(query.maxResults),
    position: queryVector(query.position, "shape position"),
    rotation: queryRotation(query.rotation),
    shape: queryShape(query.shape),
  };
}

export function requirePhysicsPointQuery(value: unknown): IPhysicsPointQuery {
  const query = queryObject(value, "point query");
  return {
    collisionMask: requirePhysicsCollisionMask(query.collisionMask),
    maxResults: requirePhysicsMaxResults(query.maxResults),
    position: queryVector(query.position, "point position"),
  };
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
  continuousCollision: boolean,
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
  // Rapier applies CCD to kinematic position targets as a sweep. Kinematic bodies are driven
  // transforms (including teleports), so enabling it there changes the existing bulk-transform
  // contract; CCD is meaningful for the dynamic bodies this option targets.
  if (type === "dynamic") description.setCcdEnabled(continuousCollision);
  if (mass !== 0) description.setAdditionalMass(mass);
  return description;
}

function jointDescription(
  rapier: typeof import("@dimforge/rapier3d-compat"),
  jointOptions: IPhysicsJointCreateOptions,
): rapier.JointData {
  if (jointOptions.type === "pin")
    return rapier.JointData.spherical(jointOptions.anchorA, jointOptions.anchorB);
  if (jointOptions.type === "hinge") {
    return rapier.JointData.revolute(
      jointOptions.anchorA,
      jointOptions.anchorB,
      jointOptions.axis as IPhysicsVector3,
    );
  }
  return rapier.JointData.fixed(
    jointOptions.anchorA,
    jointOptions.frameA ?? { x: 0, y: 0, z: 0, w: 1 },
    jointOptions.anchorB,
    jointOptions.frameB ?? { x: 0, y: 0, z: 0, w: 1 },
  );
}

function characterState(
  simulationBody: ISimulationBody,
  byCollider: ReadonlyMap<number, ISimulationBody>,
): IPhysicsCharacterState {
  const state = simulationBody.characterState;
  const controller = simulationBody.controller;
  if (controller === undefined) return state;
  let groundCollider: number | undefined;
  let groundBody: IPhysicsBodyHandle | undefined;
  let groundNormal: IPhysicsVector3 | undefined;
  for (let index = 0; index < controller.numComputedCollisions(); index += 1) {
    const collision = controller.computedCollision(index);
    if (collision?.collider === null || collision?.collider === undefined) continue;
    if ((collision.normal1.y ?? Number.NEGATIVE_INFINITY) >= 0.5) {
      const contacted = byCollider.get(collision.collider.handle);
      if (contacted !== undefined) {
        groundCollider = contacted.id;
        groundBody = contacted.bodyHandle;
        groundNormal = collision.normal1;
        break;
      }
    }
  }
  const grounded = controller.computedGrounded();
  if (groundCollider !== undefined) simulationBody.groundCollider = groundCollider;
  else if (!grounded) simulationBody.groundCollider = undefined;
  state.grounded = grounded;
  state.groundCollider = simulationBody.groundCollider;
  if (groundBody !== undefined) state.groundBody = groundBody;
  else if (!grounded) state.groundBody = undefined;
  if (groundNormal !== undefined) {
    state.groundNormal.x = groundNormal.x;
    state.groundNormal.y = groundNormal.y;
    state.groundNormal.z = groundNormal.z;
  } else if (!grounded) {
    state.groundNormal.x = 0;
    state.groundNormal.y = 1;
    state.groundNormal.z = 0;
  }
  return state;
}

/**
 * Rapier compat 0.19.3 exposes no out-parameter for rigid-body transforms. Keep its two
 * short-lived wrapper records behind this adapter and write their values directly to the shared
 * typed record; reaching through Rapier's private raw set would be an unstable API seam.
 */
function writeRapierTransformRecord(
  entry: ISimulationBody,
  renderBuffer: Float32Array,
  offset: number,
): void {
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
}

/** Web adapter. It is the only implementation that names Rapier's JS objects. */
export function createWebPhysicsSimulation(
  options: IWebPhysicsSimulationOptions,
): IPhysicsRuntimeSimulation {
  const bodies = new Map<number, ISimulationBody>();
  const byCollider = new Map<number, ISimulationBody>();
  const joints = new Map<
    number,
    { readonly handle: number; readonly bodyA: number; readonly bodyB: number }
  >();
  const dirtyBodies = new Set<ISimulationBody>();
  const areaIntersections = new Map<number, Set<number>>();
  const emptyAreaIntersections = new Set<number>();
  let areaIntersectionId = -1;
  let areaIntersectionMask = 0;
  let areaIntersectionMembers: Set<number> | undefined;
  const areaIntersectionCallback = (collider: rapier.Collider): boolean => {
    const members = areaIntersectionMembers;
    if (members === undefined) return true;
    const body = byCollider.get(collider.handle);
    if (
      body !== undefined &&
      body.id !== areaIntersectionId &&
      !collider.isSensor() &&
      ((collider.collisionGroups() >>> 16) & areaIntersectionMask) !== 0
    )
      members.add(body.id);
    return true;
  };
  // Flat stride-4 records instead of one array per event: contact-heavy scenes
  // drained hundreds of short-lived tuples per step into the collector.
  const pendingCollisionEvents: number[] = [];
  let nextId = 0;
  let nextJointId = 0;
  let disposed = false;

  const requireLive = () => {
    if (disposed) throw new Error("Physics simulation is disposed.");
  };

  // Actuation on a fixed, kinematic or character body is not a weaker push, it is no push at
  // all -- Rapier discards it. Failing here beats a silently motionless body.
  const requireDynamic = (
    entry: ISimulationBody | undefined,
    id: number,
    operation: string,
  ): ISimulationBody => {
    if (entry === undefined)
      throw new Error(`TN_PHYSICS_UNKNOWN_BODY: ${operation} references an unknown body ${id}.`);
    if (entry.type !== "dynamic")
      throw new Error(
        `TN_PHYSICS_NOT_DYNAMIC: ${operation} needs a dynamic body; body ${id} is '${entry.type}'.`,
      );
    return entry;
  };

  const queryPredicate =
    (collisionMask: number) =>
    (collider: rapier.Collider): boolean => {
      const body = byCollider.get(collider.handle);
      return (
        body !== undefined &&
        !dirtyBodies.has(body) &&
        !collider.isSensor() &&
        ((collider.collisionGroups() >>> 16) & collisionMask) !== 0
      );
    };

  const queryMatches = (collisionMask: number, collider: rapier.Collider): boolean => {
    const body = byCollider.get(collider.handle);
    return (
      body !== undefined &&
      !collider.isSensor() &&
      ((collider.collisionGroups() >>> 16) & collisionMask) !== 0
    );
  };

  const queryHit = (entry: ISimulationBody): IPhysicsQueryHit => {
    const position = entry.body.translation();
    return {
      body: physicsBodyHandle(entry.id, entry.body, entry.entity),
      entity: entry.entity,
      position: { x: position.x, y: position.y, z: position.z },
    };
  };

  const removeJointRecord = (id: number): void => {
    const record = joints.get(id);
    if (record === undefined) return;
    joints.delete(id);
    const joint = options.world.impulseJoints.get(record.handle);
    if (joint !== null) options.world.removeImpulseJoint(joint, true);
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
      if (
        bodyOptions.continuousCollision !== undefined &&
        typeof bodyOptions.continuousCollision !== "boolean"
      )
        throw new Error("Physics body continuousCollision must be a boolean.");
      // A NaN reaching Rapier corrupts the body for the rest of the run and surfaces
      // frames later as a body that vanished; reject it here like every other seam.
      requireFiniteVector(bodyOptions.position, "body position");
      requireFiniteRotation(bodyOptions.rotation, "body rotation");
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
          effectiveContinuousCollision(bodyOptions.type, bodyOptions.continuousCollision),
        ),
      );
      const rawCollider = options.world.createCollider(rawShape, rawBody);
      const bodyHandle = physicsBodyHandle(id, rawBody, bodyOptions.entity);
      const entry: ISimulationBody = {
        body: rawBody,
        bodyHandle,
        characterState: { grounded: false, groundNormal: { x: 0, y: 1, z: 0 } },
        collider: rawCollider,
        entity: bodyOptions.entity,
        id,
        type: bodyOptions.type,
      };
      if (bodyOptions.type === "character") {
        entry.controller = options.world.createCharacterController(0.01);
        entry.controllerHandle = physicsHandle(entry.controller);
      }
      bodies.set(id, entry);
      byCollider.set(rawCollider.handle, entry);
      if (bodyOptions.sensor) areaIntersections.set(id, new Set());
      dirtyBodies.add(entry);
      return {
        body: bodyHandle,
        collider: physicsColliderHandle(id, rawCollider),
        controller: entry.controllerHandle,
        rawShape,
      };
    },
    createJoint: (jointOptions) => {
      requireLive();
      const normalized = requirePhysicsJointCreateOptions(jointOptions);
      const bodyA = bodies.get(normalized.bodyA);
      const bodyB = bodies.get(normalized.bodyB);
      if (bodyA === undefined || bodyB === undefined)
        throw new Error("TN_PHYSICS_UNKNOWN_BODY: joint references an unknown body.");
      if (!bodyA.body.isValid() || !bodyB.body.isValid())
        throw new Error("TN_PHYSICS_INVALID_BODY: joint references an invalid body.");
      const joint = options.world.createImpulseJoint(
        jointDescription(options.rapier, normalized),
        bodyA.body,
        bodyB.body,
        true,
      );
      if (normalized.limit !== undefined) {
        const revoluteJoint = joint as rapier.UnitImpulseJoint;
        if (typeof revoluteJoint.setLimits !== "function") {
          options.world.removeImpulseJoint(joint, true);
          throw new Error(
            "TN_PHYSICS_JOINT_LIMIT_UNSUPPORTED: web backend cannot set hinge limits.",
          );
        }
        revoluteJoint.setLimits(normalized.limit.lower, normalized.limit.upper);
      }
      const id = nextJointId;
      nextJointId += 1;
      joints.set(id, { bodyA: normalized.bodyA, bodyB: normalized.bodyB, handle: joint.handle });
      return id;
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
      // Off by default in Rapier, so a character collides with crates without ever moving them.
      entry.controller.setApplyImpulsesToDynamicBodies(
        characterOptions.pushesDynamicBodies === true,
      );
    },
    removeBody: (id) => {
      requireLive();
      const entry = bodies.get(id);
      if (entry === undefined) return;
      for (const [jointId, joint] of joints) {
        if (joint.bodyA === id || joint.bodyB === id) removeJointRecord(jointId);
      }
      bodies.delete(id);
      byCollider.delete(entry.collider.handle);
      areaIntersections.delete(id);
      dirtyBodies.delete(entry);
      if (entry.controller !== undefined) options.world.removeCharacterController(entry.controller);
      if (entry.body.isValid()) options.world.removeRigidBody(entry.body);
    },
    removeJoint: (id) => {
      if (disposed) return;
      removeJointRecord(id);
    },
    setBodyTransform: (id, position) => {
      requireLive();
      const entry = bodies.get(id);
      if (entry === undefined)
        throw new Error("Physics body transform references an unknown body.");
      entry.body.setTranslation(position, true);
      options.world.propagateModifiedBodyPositionsToColliders();
      dirtyBodies.add(entry);
    },
    applyBodyImpulse: (id, impulse) => {
      requireLive();
      requireFiniteVector(impulse, "impulse");
      // wakeUp: an impulse applied to a sleeping body is otherwise silently discarded, which is
      // the same class of no-op as a discarded transform write.
      requireDynamic(bodies.get(id), id, "applyImpulse").body.applyImpulse(impulse, true);
    },
    applyBodyForce: (id, force) => {
      requireLive();
      requireFiniteVector(force, "force");
      requireDynamic(bodies.get(id), id, "applyForce").body.addForce(force, true);
    },
    applyBodyForceAtPoint: (id, force, point) => {
      requireLive();
      requireFiniteVector(force, "force");
      requireFiniteVector(point, "force point");
      requireDynamic(bodies.get(id), id, "applyForceAtPoint").body.addForceAtPoint(
        force,
        point,
        true,
      );
    },
    setBodyLinearVelocity: (id, velocity) => {
      requireLive();
      requireFiniteVector(velocity, "velocity");
      requireDynamic(bodies.get(id), id, "linearVelocity").body.setLinvel(velocity, true);
    },
    readBodyLinearVelocity: (id) => {
      requireLive();
      const { x, y, z } = requireDynamic(bodies.get(id), id, "linearVelocity").body.linvel();
      return { x, y, z };
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
          const { target, rotation } = kinematicScratch;
          target.x = inputSnapshot.kinematicTransforms[offset + 1] as number;
          target.y = inputSnapshot.kinematicTransforms[offset + 2] as number;
          target.z = inputSnapshot.kinematicTransforms[offset + 3] as number;
          rotation.x = inputSnapshot.kinematicTransforms[offset + 4] as number;
          rotation.y = inputSnapshot.kinematicTransforms[offset + 5] as number;
          rotation.z = inputSnapshot.kinematicTransforms[offset + 6] as number;
          rotation.w = inputSnapshot.kinematicTransforms[offset + 7] as number;
          if (entry.type === "character") {
            const controller = entry.controller;
            const config = entry.character;
            if (controller === undefined || config === undefined)
              throw new Error("Physics character was not configured before stepping.");
            const current = entry.body.translation();
            const desired = kinematicScratch.desired;
            desired.x = target.x - current.x;
            desired.y = target.y - current.y;
            desired.z = target.z - current.z;
            const characterGroups = entry.collider.collisionGroups();
            const oneWayActive = config.oneWayLayers !== 0 && desired.y > 0;
            const filterGroups = oneWayActive
              ? interactionGroups(
                  characterGroups >>> 16,
                  characterGroups & 0xffff & (0xffff ^ config.oneWayLayers),
                )
              : characterGroups;
            let filterPredicate: ((collider: rapier.Collider) => boolean) | undefined;
            if (oneWayActive) {
              oneWayFilterLayers = config.oneWayLayers;
              filterPredicate = oneWayFilterPredicate;
            }
            controller.computeColliderMovement(
              entry.collider,
              desired,
              options.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
              filterGroups,
              filterPredicate,
            );
            const movement = controller.computedMovement();
            const nextTranslation = kinematicScratch.nextTranslation;
            nextTranslation.x = current.x + movement.x;
            nextTranslation.y = current.y + movement.y;
            nextTranslation.z = current.z + movement.z;
            entry.body.setNextKinematicTranslation(nextTranslation);
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
      // Rapier retains accumulated forces unless the caller clears them. The public seam is a
      // fixed-step force, so clear it after every step to keep web and native actuation aligned.
      for (const entry of bodies.values()) entry.body.resetForces(true);
      dirtyBodies.clear();
    },
    readVisibleTransforms: (renderBuffer) => {
      requireLive();
      requirePhysicsRenderBuffer(renderBuffer, bodies.size);
      let index = 0;
      for (const entry of bodies.values()) {
        if (!entry.body.isValid()) continue;
        const offset = index * PHYSICS_TRANSFORM_STRIDE;
        writeRapierTransformRecord(entry, renderBuffer, offset);
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
    intersectRay: (value) => {
      requireLive();
      const query = requirePhysicsRayQuery(value);
      const dx = query.to.x - query.from.x;
      const dy = query.to.y - query.from.y;
      const dz = query.to.z - query.from.z;
      const distance = Math.hypot(dx, dy, dz);
      const ray = new options.rapier.Ray(query.from, {
        x: dx / distance,
        y: dy / distance,
        z: dz / distance,
      });
      const hit = options.world.castRayAndGetNormal(
        ray,
        distance,
        true,
        options.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        undefined,
        queryPredicate(query.collisionMask),
      );
      let closestCollider = hit?.collider;
      let closestTime = hit?.timeOfImpact;
      let closestNormal = hit?.normal;
      for (const dirtyBody of dirtyBodies) {
        if (!queryMatches(query.collisionMask, dirtyBody.collider)) continue;
        const dirtyHit = dirtyBody.collider.castRayAndGetNormal(ray, distance, true);
        if (
          dirtyHit === null ||
          (closestTime !== undefined && dirtyHit.timeOfImpact >= closestTime)
        )
          continue;
        closestCollider = dirtyBody.collider;
        closestTime = dirtyHit.timeOfImpact;
        closestNormal = dirtyHit.normal;
      }
      if (closestCollider === undefined || closestTime === undefined || closestNormal === undefined)
        return undefined;
      const entry = byCollider.get(closestCollider.handle);
      if (entry === undefined)
        throw new Error("IPhysicsSimulation query returned an unknown body.");
      const position = ray.pointAt(closestTime);
      return {
        ...queryHit(entry),
        distance: closestTime,
        normal: { x: closestNormal.x, y: closestNormal.y, z: closestNormal.z },
        position: { x: position.x, y: position.y, z: position.z },
      };
    },
    intersectShape: (value) => {
      requireLive();
      const query = requirePhysicsShapeQuery(value);
      const rawShape = createWebPhysicsShape(options.rapier, query.shape, false).shape;
      const hits: IPhysicsQueryHit[] = [];
      options.world.intersectionsWithShape(
        query.position,
        query.rotation,
        rawShape,
        (collider) => {
          const entry = byCollider.get(collider.handle);
          if (entry !== undefined && queryPredicate(query.collisionMask)(collider))
            hits.push(queryHit(entry));
          return hits.length < query.maxResults;
        },
        options.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        undefined,
        queryPredicate(query.collisionMask),
      );
      for (const dirtyBody of dirtyBodies) {
        if (
          hits.length < query.maxResults &&
          queryMatches(query.collisionMask, dirtyBody.collider) &&
          dirtyBody.collider.intersectsShape(rawShape, query.position, query.rotation)
        )
          hits.push(queryHit(dirtyBody));
      }
      return hits;
    },
    intersectPoint: (value) => {
      requireLive();
      const query = requirePhysicsPointQuery(value);
      const hits: IPhysicsQueryHit[] = [];
      options.world.intersectionsWithPoint(
        query.position,
        (collider) => {
          const entry = byCollider.get(collider.handle);
          if (entry !== undefined && queryPredicate(query.collisionMask)(collider))
            hits.push(queryHit(entry));
          return hits.length < query.maxResults;
        },
        options.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        undefined,
        queryPredicate(query.collisionMask),
      );
      for (const dirtyBody of dirtyBodies) {
        if (
          hits.length < query.maxResults &&
          queryMatches(query.collisionMask, dirtyBody.collider) &&
          dirtyBody.collider.containsPoint(query.position)
        )
          hits.push(queryHit(dirtyBody));
      }
      return hits;
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
      const current = areaIntersections.get(id);
      if (area === undefined || current === undefined) return emptyAreaIntersections;
      current.clear();
      areaIntersectionId = id;
      areaIntersectionMask = area.collider.collisionGroups() & 0xffff;
      areaIntersectionMembers = current;
      try {
        options.world.intersectionsWithShape(
          area.collider.translation(),
          area.collider.rotation(),
          area.collider.shape,
          areaIntersectionCallback,
          options.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
          undefined,
          area.collider,
        );
      } finally {
        areaIntersectionMembers = undefined;
        areaIntersectionId = -1;
        areaIntersectionMask = 0;
      }
      return current;
    },
    drainCollisionEvents: (buffer) => {
      requireLive();
      requirePhysicsEventBuffer(buffer);
      options.eventQueue.drainCollisionEvents((first, second, started) => {
        const left = byCollider.get(first)?.id;
        const right = byCollider.get(second)?.id;
        if (left !== undefined && right !== undefined) {
          pendingCollisionEvents.push(left, right, Number(started), 1);
        }
      });
      const count = pendingCollisionEvents.length / PHYSICS_COLLISION_EVENT_STRIDE;
      if (buffer.length < pendingCollisionEvents.length)
        throw new Error("IPhysicsSimulation collision event buffer is too small.");
      for (let index = 0; index < pendingCollisionEvents.length; index += 1)
        buffer[index] = pendingCollisionEvents[index] as number;
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
      joints.clear();
      dirtyBodies.clear();
      areaIntersections.clear();
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
