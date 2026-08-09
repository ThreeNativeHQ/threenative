import type * as RAPIER from "@dimforge/rapier3d-compat";

/** One record is logical body id, xyz position, and xyzw rotation. */
export const PHYSICS_TRANSFORM_STRIDE = 8;

export interface PhysicsInputSnapshot {
  /** One eight-float record per kinematic body. The buffer is caller-owned and reusable. */
  readonly kinematicTransforms: Readonly<Float32Array>;
  readonly kinematicCount: number;
}

export interface PhysicsSimulation {
  step(deltaTime: number, inputSnapshot?: PhysicsInputSnapshot): void;
  readVisibleTransforms(renderBuffer: Float32Array): number;
}

interface SimulationBody {
  readonly id: number;
  readonly body: RAPIER.RigidBody;
}

interface WebPhysicsSimulationOptions {
  readonly world: RAPIER.World;
  readonly eventQueue: RAPIER.EventQueue;
  readonly bodies: () => Iterable<SimulationBody>;
  readonly bodyById: (id: number) => SimulationBody | undefined;
}

function requireFiniteDelta(deltaTime: number): void {
  if (!Number.isFinite(deltaTime) || deltaTime <= 0)
    throw new Error("PhysicsSimulation.step requires a positive finite deltaTime.");
}

function requireInputSnapshot(inputSnapshot: PhysicsInputSnapshot): void {
  if (!(inputSnapshot.kinematicTransforms instanceof Float32Array))
    throw new Error("PhysicsSimulation input must use a Float32Array.");
  if (
    !Number.isInteger(inputSnapshot.kinematicCount) ||
    inputSnapshot.kinematicCount < 0 ||
    inputSnapshot.kinematicCount * PHYSICS_TRANSFORM_STRIDE >
      inputSnapshot.kinematicTransforms.length
  ) {
    throw new Error("PhysicsSimulation input has an invalid kinematic record count.");
  }
}

function inputValue(buffer: Readonly<Float32Array>, index: number): number {
  const value = buffer[index];
  if (value === undefined || !Number.isFinite(value))
    throw new Error("PhysicsSimulation input contains a non-finite transform.");
  return value;
}

function requireRenderBuffer(renderBuffer: Float32Array, bodyCount: number): void {
  if (!(renderBuffer instanceof Float32Array))
    throw new Error("PhysicsSimulation output must use a Float32Array.");
  if (renderBuffer.length < bodyCount * PHYSICS_TRANSFORM_STRIDE)
    throw new Error("PhysicsSimulation output buffer is too small for visible transforms.");
}

export function createWebPhysicsSimulation(
  options: WebPhysicsSimulationOptions,
): PhysicsSimulation {
  return {
    step: (deltaTime, inputSnapshot) => {
      requireFiniteDelta(deltaTime);
      if (inputSnapshot !== undefined) {
        requireInputSnapshot(inputSnapshot);
        for (let index = 0; index < inputSnapshot.kinematicCount; index += 1) {
          const offset = index * PHYSICS_TRANSFORM_STRIDE;
          const id = inputValue(inputSnapshot.kinematicTransforms, offset);
          if (!Number.isInteger(id) || id < 0)
            throw new Error("PhysicsSimulation input contains an invalid body id.");
          const simulationBody = options.bodyById(id);
          if (simulationBody === undefined)
            throw new Error("PhysicsSimulation input contains an unknown body id.");
          simulationBody.body.setNextKinematicTranslation({
            x: inputValue(inputSnapshot.kinematicTransforms, offset + 1),
            y: inputValue(inputSnapshot.kinematicTransforms, offset + 2),
            z: inputValue(inputSnapshot.kinematicTransforms, offset + 3),
          });
          simulationBody.body.setNextKinematicRotation({
            x: inputValue(inputSnapshot.kinematicTransforms, offset + 4),
            y: inputValue(inputSnapshot.kinematicTransforms, offset + 5),
            z: inputValue(inputSnapshot.kinematicTransforms, offset + 6),
            w: inputValue(inputSnapshot.kinematicTransforms, offset + 7),
          });
        }
      }
      options.world.timestep = deltaTime;
      options.world.step(options.eventQueue);
    },
    readVisibleTransforms: (renderBuffer) => {
      let bodyCount = 0;
      for (const { body } of options.bodies()) if (body.isValid()) bodyCount += 1;
      requireRenderBuffer(renderBuffer, bodyCount);
      let index = 0;
      for (const { id, body } of options.bodies()) {
        if (!body.isValid()) continue;
        const offset = index * PHYSICS_TRANSFORM_STRIDE;
        const translation = body.translation();
        const rotation = body.rotation();
        renderBuffer[offset] = id;
        renderBuffer[offset + 1] = translation.x;
        renderBuffer[offset + 2] = translation.y;
        renderBuffer[offset + 3] = translation.z;
        renderBuffer[offset + 4] = rotation.x;
        renderBuffer[offset + 5] = rotation.y;
        renderBuffer[offset + 6] = rotation.z;
        renderBuffer[offset + 7] = rotation.w;
        index += 1;
      }
      return bodyCount;
    },
  };
}
