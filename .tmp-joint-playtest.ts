import {
  createNativePhysicsSimulation,
  nativePhysicsHost,
} from "/home/joao/projects/threenative/threenative-engine/.worktrees/prd-143-physics-joints/packages/physics/src/native/host.ts";
import {
  CollisionShape3D,
  Joint3D,
  RigidBody3D,
} from "/home/joao/projects/threenative/threenative-engine/.worktrees/prd-143-physics-joints/packages/physics/src/native/index.ts";
import { Object3D } from "three";

const host = nativePhysicsHost();
const simulation = createNativePhysicsSimulation(
  host.createSimulation({ gravity: { x: 0, y: 0, z: 0 } }),
  host.version,
);

function makeBody(x: number, type: "dynamic" | "fixed"): RigidBody3D {
  const object = new Object3D();
  object.position.x = x;
  return new RigidBody3D({
    object,
    shape: CollisionShape3D.sphere(0.2),
    type,
    world: simulation,
  });
}

const anchor = makeBody(0, "fixed");
const door = makeBody(1, "dynamic");
const joint = Joint3D.hinge({
  anchorA: { x: 0, y: 0, z: 0 },
  anchorB: { x: -1, y: 0, z: 0 },
  axis: { x: 0, y: 1, z: 0 },
  bodyA: anchor,
  bodyB: door,
  limit: { lower: -0.4, upper: 0.4 },
  world: simulation,
});

door.applyImpulse({ x: 0, y: 0, z: 4 });
for (let step = 0; step < 120; step += 1) {
  simulation.step(1 / 60);
  anchor.syncFromPhysics();
  door.syncFromPhysics();
}

const angle = 2 * Math.atan2(Math.abs(door.object.quaternion.y), door.object.quaternion.w);
const offAxis = Math.abs(door.object.quaternion.x) + Math.abs(door.object.quaternion.z);
if (angle < 0.05 || angle > 0.55 || offAxis > 0.05)
  throw new Error(`TN_JOINT_PLAYTEST_FAILED angle=${angle} offAxis=${offAxis}`);
console.info(`TN_JOINT_PLAYTEST_PASS angle=${angle} offAxis=${offAxis}`);

joint.dispose();
simulation.dispose();
