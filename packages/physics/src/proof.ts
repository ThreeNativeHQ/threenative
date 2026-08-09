import * as RAPIER from "@dimforge/rapier3d-compat";
import { interactionGroups } from "./collision.js";
import {
  PHYSICS_COLLISION_EVENT_STRIDE,
  type PhysicsProof,
  type PhysicsProofOptions,
} from "./proof-contract.js";
import { PHYSICS_TRANSFORM_STRIDE } from "./simulation.js";

export type { PhysicsProof, PhysicsProofOptions } from "./proof-contract.js";
export { PHYSICS_COLLISION_EVENT_STRIDE } from "./proof-contract.js";

export async function createPhysicsProof(options: PhysicsProofOptions = {}): Promise<PhysicsProof> {
  await RAPIER.init();
  const world = new RAPIER.World(options.gravity ?? { x: 0, y: -9.81, z: 0 });
  const queue = new RAPIER.EventQueue(true);
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  const floorCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(50, 0.5, 50)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setCollisionGroups(
        interactionGroups(
          options.floor?.collisionLayer ?? 1,
          options.floor?.collisionMask ?? 0xffff,
        ),
      ),
    floor,
  );
  const cube = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, 0));
  const cubeCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setCollisionGroups(
        interactionGroups(options.cube?.collisionLayer ?? 1, options.cube?.collisionMask ?? 0xffff),
      ),
    cube,
  );
  const pending: number[][] = [];
  let disposed = false;

  const requireLive = () => {
    if (disposed) throw new Error("Physics proof simulation is disposed.");
  };
  return {
    createBody: () => {
      throw new Error("Physics proof simulation does not expose general body creation.");
    },
    configureCharacter: () => {
      throw new Error("Physics proof simulation does not expose character configuration.");
    },
    removeBody: () => {
      throw new Error("Physics proof simulation does not expose general body removal.");
    },
    setBodyTransform: () => {
      throw new Error("Physics proof simulation does not expose body transforms.");
    },
    version: RAPIER.version(),
    step: (deltaTime) => {
      requireLive();
      if (!Number.isFinite(deltaTime) || deltaTime <= 0)
        throw new Error("deltaTime must be a positive finite number");
      world.timestep = deltaTime;
      world.step(queue);
      queue.drainCollisionEvents((first, second, started) => {
        const ids =
          first === floorCollider.handle && second === cubeCollider.handle
            ? [0, 1]
            : first === cubeCollider.handle && second === floorCollider.handle
              ? [1, 0]
              : undefined;
        if (ids !== undefined) pending.push([ids[0] ?? 0, ids[1] ?? 0, Number(started), 1]);
      });
    },
    readVisibleTransforms: (buffer) => {
      requireLive();
      if (!(buffer instanceof Float32Array) || buffer.length < PHYSICS_TRANSFORM_STRIDE * 2)
        throw new Error("transform buffer must hold two 8-float records");
      for (const [index, body] of [floor, cube].entries()) {
        const offset = index * PHYSICS_TRANSFORM_STRIDE;
        const position = body.translation();
        const rotation = body.rotation();
        buffer.set(
          [
            index,
            position.x,
            position.y,
            position.z,
            rotation.x,
            rotation.y,
            rotation.z,
            rotation.w,
          ],
          offset,
        );
      }
      return 2;
    },
    drainCollisionEvents: (buffer) => {
      requireLive();
      if (!(buffer instanceof Uint32Array))
        throw new Error("collision event buffer must be a Uint32Array");
      if (buffer.length < pending.length * PHYSICS_COLLISION_EVENT_STRIDE)
        throw new Error("collision event buffer is too small");
      pending.forEach((event, index) => buffer.set(event, index * PHYSICS_COLLISION_EVENT_STRIDE));
      const count = pending.length;
      pending.length = 0;
      return count;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      world.free();
      queue.free();
      pending.length = 0;
    },
  };
}
