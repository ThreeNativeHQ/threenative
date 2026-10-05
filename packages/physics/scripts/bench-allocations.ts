/**
 * Allocation bench for the physics hot path (PRD-191).
 *
 * Steps a mixed kinematic/dynamic/character scene through the shared plugin — the production
 * write/read loop — and reports heap churn across the measured window. Not a CI gate: the number
 * it exists for is the before/after delta when the per-body-per-step allocations land or are
 * reverted, recorded in docs/verification/.
 *
 * Run: NODE_OPTIONS=--expose-gc pnpm --filter @threenative/physics exec tsx scripts/bench-allocations.ts
 */
import * as RAPIER from "@dimforge/rapier3d-compat";
import { BoxGeometry, Mesh, Scene } from "three";
import "../src/index.js";
import { Area3D } from "../src/Area3D.js";
import { CharacterBody3D } from "../src/CharacterBody3D.js";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { RigidBody3D } from "../src/RigidBody3D.js";
import { type IPhysicsContext, rapier } from "../src/plugin.js";

const BODIES = 120;
const STEPS = 6_000;

function forceGc(): void {
  if (typeof globalThis.gc === "function") globalThis.gc();
}

async function main(): Promise<void> {
  await RAPIER.init();
  let measureHotPath = false;
  let measuredCharacterCollisionRecords = 0;
  let measuredCharacterCollisionVectorReads = 0;
  let measuredRigidBodyTranslationCalls = 0;
  let measuredRigidBodyRotationCalls = 0;
  let measuredColliderTranslationCalls = 0;
  let measuredColliderRotationCalls = 0;
  let measuredCharacterComputeMovementCalls = 0;
  let measuredCharacterComputeMovementDesiredTranslationCalls = 0;
  let measuredKinematicTargetTranslationCalls = 0;
  let measuredKinematicTargetRotationCalls = 0;
  const computedCollision = RAPIER.KinematicCharacterController.prototype.computedCollision;
  RAPIER.KinematicCharacterController.prototype.computedCollision = function (
    this: RAPIER.KinematicCharacterController,
    index: number,
    out?: RAPIER.CharacterCollision,
  ): RAPIER.CharacterCollision | null {
    const collision = computedCollision.call(this, index, out);
    if (measureHotPath && out === undefined && collision !== null) {
      measuredCharacterCollisionRecords += 1;
      measuredCharacterCollisionVectorReads += 6;
    }
    return collision;
  };
  const rigidBodyTranslation = RAPIER.RigidBody.prototype.translation;
  RAPIER.RigidBody.prototype.translation = function (this: RAPIER.RigidBody) {
    if (measureHotPath) measuredRigidBodyTranslationCalls += 1;
    return rigidBodyTranslation.call(this);
  };
  const rigidBodyRotation = RAPIER.RigidBody.prototype.rotation;
  RAPIER.RigidBody.prototype.rotation = function (this: RAPIER.RigidBody) {
    if (measureHotPath) measuredRigidBodyRotationCalls += 1;
    return rigidBodyRotation.call(this);
  };
  const colliderTranslation = RAPIER.Collider.prototype.translation;
  RAPIER.Collider.prototype.translation = function (this: RAPIER.Collider) {
    if (measureHotPath) measuredColliderTranslationCalls += 1;
    return colliderTranslation.call(this);
  };
  const colliderRotation = RAPIER.Collider.prototype.rotation;
  RAPIER.Collider.prototype.rotation = function (this: RAPIER.Collider) {
    if (measureHotPath) measuredColliderRotationCalls += 1;
    return colliderRotation.call(this);
  };
  const computedMovement = RAPIER.KinematicCharacterController.prototype.computedMovement;
  RAPIER.KinematicCharacterController.prototype.computedMovement = function (
    this: RAPIER.KinematicCharacterController,
  ) {
    if (measureHotPath) measuredCharacterComputeMovementCalls += 1;
    return computedMovement.call(this);
  };
  const computeColliderMovement =
    RAPIER.KinematicCharacterController.prototype.computeColliderMovement;
  RAPIER.KinematicCharacterController.prototype.computeColliderMovement = function (
    this: RAPIER.KinematicCharacterController,
    collider: RAPIER.Collider,
    desiredTranslationDelta: RAPIER.Vector,
    ...args: Parameters<RAPIER.KinematicCharacterController["computeColliderMovement"]> extends [
      unknown,
      unknown,
      ...infer Rest,
    ]
      ? Rest
      : never
  ) {
    if (measureHotPath) measuredCharacterComputeMovementDesiredTranslationCalls += 1;
    return computeColliderMovement.call(this, collider, desiredTranslationDelta, ...args);
  };
  const setNextKinematicTranslation = RAPIER.RigidBody.prototype.setNextKinematicTranslation;
  RAPIER.RigidBody.prototype.setNextKinematicTranslation = function (
    this: RAPIER.RigidBody,
    translation: RAPIER.Vector,
  ) {
    if (measureHotPath) measuredKinematicTargetTranslationCalls += 1;
    return setNextKinematicTranslation.call(this, translation);
  };
  const setNextKinematicRotation = RAPIER.RigidBody.prototype.setNextKinematicRotation;
  RAPIER.RigidBody.prototype.setNextKinematicRotation = function (
    this: RAPIER.RigidBody,
    rotation: RAPIER.Rotation,
  ) {
    if (measureHotPath) measuredKinematicTargetRotationCalls += 1;
    return setNextKinematicRotation.call(this, rotation);
  };
  const plugin = rapier();
  const ctx = {
    physics: undefined,
  } as unknown as Parameters<typeof plugin.setup>[0] extends infer T ? T : never;
  await plugin.setup?.(ctx as never);
  const physics = (ctx as unknown as { physics: IPhysicsContext }).physics;
  if (physics === undefined) throw new Error("physics plugin did not install a context");
  const readVisibleTransforms = physics.simulation.readVisibleTransforms.bind(physics.simulation);
  const step = physics.simulation.step.bind(physics.simulation);
  const readCharacterState = physics.simulation.readCharacterState?.bind(physics.simulation);
  const readAreaIntersections = physics.simulation.areaIntersections?.bind(physics.simulation);
  if (readCharacterState === undefined)
    throw new Error("physics simulation does not expose character state");
  if (readAreaIntersections === undefined)
    throw new Error("physics simulation does not expose Area3D intersections");
  let measuredVisibleTransformRecords = 0;
  let measuredKinematicInputRecords = 0;
  let measuredCharacterStateReads = 0;
  let measuredAreaIntersectionQueries = 0;
  let measuredAreaIntersectionCallbackInvocations = 0;
  physics.simulation.readVisibleTransforms = (buffer) => {
    const count = readVisibleTransforms(buffer);
    if (measureHotPath) measuredVisibleTransformRecords += count;
    return count;
  };
  physics.simulation.step = (deltaTime, input) => {
    if (measureHotPath) measuredKinematicInputRecords += input?.kinematicCount ?? 0;
    return step(deltaTime, input);
  };
  physics.simulation.readCharacterState = (id) => {
    const state = readCharacterState(id);
    if (measureHotPath) measuredCharacterStateReads += 1;
    return state;
  };
  physics.simulation.areaIntersections = (id) => {
    const members = readAreaIntersections(id);
    if (measureHotPath) {
      measuredAreaIntersectionQueries += 1;
      measuredAreaIntersectionCallbackInvocations += members.size;
    }
    return members;
  };

  const geometry = new BoxGeometry(1, 1, 1);
  const scene = new Scene();

  // Kinematic platforms (write + read path), characters (controller path), dynamic crates.
  const bodies: Array<RigidBody3D | CharacterBody3D> = [];
  const areas: Area3D[] = [];
  for (let index = 0; index < BODIES; index += 1) {
    const platformMesh = new Mesh(geometry);
    platformMesh.position.set(index % 10, Math.floor(index / 10) * 3, 0);
    scene.add(platformMesh);
    bodies.push(
      new RigidBody3D({
        object: platformMesh,
        physics,
        shape: CollisionShape3D.box(1, 1, 1),
        type: "kinematic",
      }),
    );
    areas.push(
      new Area3D({
        physics,
        position:
          index % 2 === 0
            ? { x: index % 10, y: Math.floor(index / 10) * 3, z: 0 }
            : { x: 100 + index, y: 0, z: 0 },
        shape: CollisionShape3D.box(1, 1, 1),
      }),
    );
    const characterMesh = new Mesh(geometry);
    characterMesh.position.set(index % 10, Math.floor(index / 10) * 3 + 2, 0);
    scene.add(characterMesh);
    bodies.push(
      new CharacterBody3D({
        object: characterMesh,
        physics,
        shape: CollisionShape3D.capsule(0.4, 0.8),
      }) as CharacterBody3D,
    );
    const crateMesh = new Mesh(geometry);
    crateMesh.position.set(index % 10, Math.floor(index / 10) * 3 + 6, 0);
    scene.add(crateMesh);
    bodies.push(
      new RigidBody3D({
        object: crateMesh,
        physics,
        shape: CollisionShape3D.box(0.5, 0.5, 0.5),
      }),
    );
  }
  const characterCount = bodies.filter((body) => body instanceof CharacterBody3D).length;

  // Warmup: compile paths, settle contacts, fill caches.
  for (let step = 0; step < 90; step += 1) {
    for (const body of bodies) {
      if (body instanceof CharacterBody3D) body.moveAndSlide(1 / 60);
    }
    plugin.update?.(ctx as never, 1 / 60);
  }
  forceGc();
  const heapUsedBeforeBytes = process.memoryUsage().heapUsed;

  if (typeof globalThis.gc !== "function")
    console.warn("gc unavailable; run with NODE_OPTIONS=--expose-gc for stable numbers");
  forceGc();
  const startedAt = process.hrtime.bigint();
  measureHotPath = true;
  let gcCount = 0;
  let measuredWindowEnd = Number.POSITIVE_INFINITY;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.startTime <= measuredWindowEnd) gcCount += 1;
    }
  });
  observer.observe({ entryTypes: ["gc"] });

  for (let step = 0; step < STEPS; step += 1) {
    for (const body of bodies) {
      if (body instanceof CharacterBody3D) body.moveAndSlide(1 / 60);
    }
    plugin.update?.(ctx as never, 1 / 60);
  }

  measureHotPath = false;
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  measuredWindowEnd = performance.now();
  // PerformanceObserver delivers GC entries on a later event-loop turn. Drain that turn before
  // disconnecting so queued entries from the measured window are not discarded.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  observer.disconnect();
  forceGc();
  const heapUsedAfterBytes = process.memoryUsage().heapUsed;
  if (
    measuredRigidBodyTranslationCalls !==
      measuredVisibleTransformRecords + measuredCharacterStateReads ||
    measuredRigidBodyRotationCalls !== measuredVisibleTransformRecords
  )
    throw new Error(
      `Rapier rigid-body transform wrapper counts did not match measured call sites: translation=${measuredRigidBodyTranslationCalls}, rotation=${measuredRigidBodyRotationCalls}, expectedTranslation=${measuredVisibleTransformRecords + measuredCharacterStateReads}, expectedRotation=${measuredVisibleTransformRecords}.`,
    );
  if (
    measuredColliderTranslationCalls !== measuredAreaIntersectionQueries ||
    measuredColliderRotationCalls !== measuredAreaIntersectionQueries
  )
    throw new Error("Rapier Area3D transform wrapper counts did not match measured queries.");
  if (
    measuredCharacterComputeMovementCalls !== measuredCharacterStateReads ||
    measuredCharacterComputeMovementDesiredTranslationCalls !== measuredCharacterStateReads
  )
    throw new Error("Rapier character vector wrapper counts did not match measured characters.");
  if (
    measuredKinematicTargetTranslationCalls !== measuredKinematicInputRecords ||
    measuredKinematicTargetRotationCalls !== measuredKinematicInputRecords
  )
    throw new Error("Rapier kinematic target wrapper counts did not match measured inputs.");

  // Rapier compat 0.19.3 returns a raw WASM wrapper and then a public record for each transform
  // read. Character collision records reuse one raw record per controller, but every no-out call
  // creates one public record and six raw/public vector pairs. Area queries additionally convert
  // their position, rotation, and shape through intoRaw() on every call.
  const rapierCompatVisibleTranslationRawWrappers = measuredVisibleTransformRecords;
  const rapierCompatVisibleTranslationPublicWrappers = measuredVisibleTransformRecords;
  const rapierCompatVisibleRotationRawWrappers = measuredVisibleTransformRecords;
  const rapierCompatVisibleRotationPublicWrappers = measuredVisibleTransformRecords;
  const rapierCompatCharacterStepTranslationRawWrappers = measuredCharacterStateReads;
  const rapierCompatCharacterStepTranslationPublicWrappers = measuredCharacterStateReads;
  const rapierCompatCharacterStepMovementRawWrappers = measuredCharacterStateReads;
  const rapierCompatCharacterStepMovementPublicWrappers = measuredCharacterStateReads;
  const rapierCompatCharacterStepDesiredTranslationRawWrappers =
    measuredCharacterComputeMovementDesiredTranslationCalls;
  const rapierCompatKinematicTargetTranslationRawWrappers = measuredKinematicTargetTranslationCalls;
  const rapierCompatKinematicTargetRotationRawWrappers = measuredKinematicTargetRotationCalls;
  const rapierCompatAreaTranslationRawWrappers = measuredAreaIntersectionQueries;
  const rapierCompatAreaTranslationPublicWrappers = measuredAreaIntersectionQueries;
  const rapierCompatAreaRotationRawWrappers = measuredAreaIntersectionQueries;
  const rapierCompatAreaRotationPublicWrappers = measuredAreaIntersectionQueries;
  const rapierCompatAreaQueryPositionRawWrappers = measuredAreaIntersectionQueries;
  const rapierCompatAreaQueryRotationRawWrappers = measuredAreaIntersectionQueries;
  const rapierCompatAreaQueryShapeRawWrappers = measuredAreaIntersectionQueries;
  const rapierCompatAreaIntersectionCallbackWrappers = measuredAreaIntersectionQueries * 2;
  const rapierCompatCharacterCollisionPublicRecordWrappers = measuredCharacterCollisionRecords;
  const rapierCompatCharacterCollisionRawRecordWrappersCreatedBeforeMeasuredWindow = characterCount;
  const rapierCompatCharacterCollisionTranslationDeltaAppliedRawWrappers =
    measuredCharacterCollisionRecords;
  const rapierCompatCharacterCollisionTranslationDeltaAppliedPublicWrappers =
    measuredCharacterCollisionRecords;
  const rapierCompatCharacterCollisionTranslationDeltaRemainingRawWrappers =
    measuredCharacterCollisionRecords;
  const rapierCompatCharacterCollisionTranslationDeltaRemainingPublicWrappers =
    measuredCharacterCollisionRecords;
  const rapierCompatCharacterCollisionWitness1RawWrappers = measuredCharacterCollisionRecords;
  const rapierCompatCharacterCollisionWitness1PublicWrappers = measuredCharacterCollisionRecords;
  const rapierCompatCharacterCollisionWitness2RawWrappers = measuredCharacterCollisionRecords;
  const rapierCompatCharacterCollisionWitness2PublicWrappers = measuredCharacterCollisionRecords;
  const rapierCompatCharacterCollisionNormal1RawWrappers = measuredCharacterCollisionRecords;
  const rapierCompatCharacterCollisionNormal1PublicWrappers = measuredCharacterCollisionRecords;
  const rapierCompatCharacterCollisionNormal2RawWrappers = measuredCharacterCollisionRecords;
  const rapierCompatCharacterCollisionNormal2PublicWrappers = measuredCharacterCollisionRecords;
  const rapierCompatWrapperRecordsTotal =
    rapierCompatVisibleTranslationRawWrappers +
    rapierCompatVisibleTranslationPublicWrappers +
    rapierCompatVisibleRotationRawWrappers +
    rapierCompatVisibleRotationPublicWrappers +
    rapierCompatCharacterStepTranslationRawWrappers +
    rapierCompatCharacterStepTranslationPublicWrappers +
    rapierCompatCharacterStepMovementRawWrappers +
    rapierCompatCharacterStepMovementPublicWrappers +
    rapierCompatCharacterStepDesiredTranslationRawWrappers +
    rapierCompatKinematicTargetTranslationRawWrappers +
    rapierCompatKinematicTargetRotationRawWrappers +
    rapierCompatAreaTranslationRawWrappers +
    rapierCompatAreaTranslationPublicWrappers +
    rapierCompatAreaRotationRawWrappers +
    rapierCompatAreaRotationPublicWrappers +
    rapierCompatAreaQueryPositionRawWrappers +
    rapierCompatAreaQueryRotationRawWrappers +
    rapierCompatAreaQueryShapeRawWrappers +
    rapierCompatAreaIntersectionCallbackWrappers +
    STEPS +
    rapierCompatCharacterCollisionPublicRecordWrappers +
    rapierCompatCharacterCollisionTranslationDeltaAppliedRawWrappers +
    rapierCompatCharacterCollisionTranslationDeltaAppliedPublicWrappers +
    rapierCompatCharacterCollisionTranslationDeltaRemainingRawWrappers +
    rapierCompatCharacterCollisionTranslationDeltaRemainingPublicWrappers +
    rapierCompatCharacterCollisionWitness1RawWrappers +
    rapierCompatCharacterCollisionWitness1PublicWrappers +
    rapierCompatCharacterCollisionWitness2RawWrappers +
    rapierCompatCharacterCollisionWitness2PublicWrappers +
    rapierCompatCharacterCollisionNormal1RawWrappers +
    rapierCompatCharacterCollisionNormal1PublicWrappers +
    rapierCompatCharacterCollisionNormal2RawWrappers +
    rapierCompatCharacterCollisionNormal2PublicWrappers;
  console.log(
    JSON.stringify(
      {
        bodies: bodies.length,
        areas: areas.length,
        characters: characterCount,
        steps: STEPS,
        gcEventsDuringWindow: gcCount,
        heapUsedBeforeBytes,
        heapUsedAfterBytes,
        heapDeltaBytes: heapUsedAfterBytes - heapUsedBeforeBytes,
        measuredVisibleTransformRecords,
        measuredKinematicInputRecords,
        measuredCharacterStateReads,
        measuredAreaIntersectionQueries,
        measuredAreaIntersectionCallbackInvocations,
        rapierCompatVisibleTranslationRawWrappers,
        rapierCompatVisibleTranslationPublicWrappers,
        rapierCompatVisibleRotationRawWrappers,
        rapierCompatVisibleRotationPublicWrappers,
        rapierCompatCharacterStepTranslationRawWrappers,
        rapierCompatCharacterStepTranslationPublicWrappers,
        rapierCompatCharacterStepMovementRawWrappers,
        rapierCompatCharacterStepMovementPublicWrappers,
        rapierCompatCharacterStepDesiredTranslationRawWrappers,
        rapierCompatKinematicTargetTranslationRawWrappers,
        rapierCompatKinematicTargetRotationRawWrappers,
        rapierCompatAreaTranslationRawWrappers,
        rapierCompatAreaTranslationPublicWrappers,
        rapierCompatAreaRotationRawWrappers,
        rapierCompatAreaRotationPublicWrappers,
        rapierCompatAreaQueryPositionRawWrappers,
        rapierCompatAreaQueryRotationRawWrappers,
        rapierCompatAreaQueryShapeRawWrappers,
        rapierCompatAreaIntersectionCallbackWrappers,
        rapierCompatCollisionEventCallbackWrappers: STEPS,
        rapierCompatCharacterCollisionPublicRecordWrappers,
        rapierCompatCharacterCollisionRawRecordWrappersCreatedBeforeMeasuredWindow,
        rapierCompatCharacterCollisionTranslationDeltaAppliedRawWrappers,
        rapierCompatCharacterCollisionTranslationDeltaAppliedPublicWrappers,
        rapierCompatCharacterCollisionTranslationDeltaRemainingRawWrappers,
        rapierCompatCharacterCollisionTranslationDeltaRemainingPublicWrappers,
        rapierCompatCharacterCollisionWitness1RawWrappers,
        rapierCompatCharacterCollisionWitness1PublicWrappers,
        rapierCompatCharacterCollisionWitness2RawWrappers,
        rapierCompatCharacterCollisionWitness2PublicWrappers,
        rapierCompatCharacterCollisionNormal1RawWrappers,
        rapierCompatCharacterCollisionNormal1PublicWrappers,
        rapierCompatCharacterCollisionNormal2RawWrappers,
        rapierCompatCharacterCollisionNormal2PublicWrappers,
        measuredCharacterCollisionVectorReads,
        rapierCompatAreaShapeWrappersCreatedBeforeMeasuredWindow: areas.length,
        rapierCompatAreaShapeAccesses: measuredAreaIntersectionQueries,
        rapierCompatWrapperRecordsTotal,
        wallMs: elapsedMs.toFixed(1),
        usPerStep: ((elapsedMs * 1000) / STEPS).toFixed(1),
      },
      null,
      2,
    ),
  );

  for (const area of areas) area.dispose();
  for (const body of bodies) body.dispose();
  plugin.dispose?.(ctx as never);
  RAPIER.KinematicCharacterController.prototype.computedCollision = computedCollision;
}

void main();
