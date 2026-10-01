import * as THREE from "three/webgpu";
import { CollisionShape3D } from "../../../../physics/src/CollisionShape3D.ts";
import { RigidBody3D } from "../../../../physics/src/RigidBody3D.ts";
import { createWebPhysicsSimulation } from "../../../../physics/src/simulation.ts";
import { VehicleBody3D } from "../../../../physics/src/VehicleBody3D.ts";
import {
  createNativePhysicsSimulation,
  nativeSimulation,
} from "../../../../physics/src/native/host.ts";
import { assertCondition, startBehaviorScene } from "./scene-support.js";

/**
 * A car on ray-cast wheels, driven through the same `VehicleBody3D` node on both lanes. The
 * numbers are the ones `packages/physics/__tests__/vehicle-body.spec.ts` pins on web, so the
 * native Rust controller has to settle, accelerate and brake in the same order of magnitude
 * rather than merely not throw.
 */
const DT = 1 / 60;
const TRACK = 0.8;
const WHEEL_BASE = 1.2;
const REST = 0.3;
const RADIUS = 0.34;
const MOUNT = -0.15;
const RIDE = REST + RADIUS - MOUNT;

function wheel(front, left) {
  return {
    dampingCompression: 2.3,
    dampingRelaxation: 4.4,
    maxSuspensionTravel: 0.3,
    position: { x: left ? -TRACK : TRACK, y: MOUNT, z: front ? -WHEEL_BASE : WHEEL_BASE },
    suspensionRestLength: REST,
    // Mass-normalised stiffness: sag is about 9.81 / (4 * 100) = 0.025 m of the 0.3 m strut.
    suspensionStiffness: 100,
    useAsSteering: front,
    useAsTraction: !front,
    wheelFrictionSlip: 10.5,
    wheelRadius: RADIUS,
  };
}

const WHEELS = [wheel(true, true), wheel(true, false), wheel(false, true), wheel(false, false)];

/**
 * The simulation for whichever runtime is executing this scene: the Rust `tn_physics_*` ABI
 * behind the shared adapter on native, the WASM world on web. The node class and every wheel
 * number are identical either way, so the row measures the vehicle rather than the harness.
 */
async function simulationForThisRuntime() {
  const host = globalThis.__THREENATIVE_NATIVE__?.physics;
  if (host !== undefined) {
    const raw = nativeSimulation(host.createSimulation({}));
    return { kind: "native", simulation: createNativePhysicsSimulation(raw, host.version) };
  }
  const rapier = await import("@dimforge/rapier3d-compat");
  await rapier.init();
  return {
    kind: "web",
    simulation: createWebPhysicsSimulation({
      eventQueue: new rapier.EventQueue(true),
      rapier: rapier,
      version: rapier.version(),
      world: new rapier.World({ x: 0, y: -9.81, z: 0 }),
    }),
  };
}

export async function startScene(canvas, dimensions) {
  const { kind, simulation } = await simulationForThisRuntime();
  // The only thing the wheel rays can find, 400 m either way so the car never leaves it.
  const floor = new RigidBody3D({
    position: { x: 0, y: -0.25, z: 0 },
    shape: CollisionShape3D.box(800, 0.5, 800),
    type: "fixed",
    world: simulation,
  });
  const chassis = new THREE.Group();
  chassis.position.set(0, RIDE + 0.05, 0);
  const vehicle = new VehicleBody3D({
    mass: 900,
    object: chassis,
    shape: CollisionShape3D.box(1.6, 0.5, 3.6),
    wheels: WHEELS,
    world: simulation,
  });
  // The scene owns the loop so both lanes run the same fixed step the same number of times.
  const advance = (frames) => {
    for (let frame = 0; frame < frames; frame += 1) {
      simulation.step(DT);
      vehicle.syncFromPhysics();
    }
  };

  const observation = { kind };
  advance(300);
  observation.contacts = WHEELS.map((_, index) => vehicle.wheelContact(index));
  observation.strut = WHEELS.map((_, index) => vehicle.wheelSuspensionLength(index));
  observation.settledY = chassis.position.y;
  assertCondition(
    observation.contacts.every(Boolean),
    `a settled car lost wheel contact: ${JSON.stringify(observation.contacts)}`,
  );
  for (const [index, length] of observation.strut.entries()) {
    assertCondition(
      length > 0 && length < REST,
      `wheel ${index} strut is ${length}, not a compression of the ${REST} m rest length`,
    );
  }
  // Carried by the springs, not resting on its own collider: the floor top is at 0.
  assertCondition(
    observation.settledY - 0.25 > 0.4,
    `the chassis sank onto its own collider at y ${observation.settledY}`,
  );
  assertCondition(
    Math.abs(vehicle.speed) < 0.01,
    `a parked car reads ${vehicle.speed} m/s of suspension noise`,
  );

  vehicle.engineForce = 4000;
  advance(180);
  observation.speed = vehicle.speed;
  // Web measures 26.58 m/s here. The native controller is a different Rapier build, so the
  // claim is the same order of magnitude rather than the same digits.
  assertCondition(
    observation.speed > 20,
    `4000 N per rear wheel reached only ${observation.speed} m/s in 3 s`,
  );
  assertCondition(
    chassis.position.z < -5,
    `a positive engine force drove to z ${chassis.position.z} instead of -z`,
  );

  vehicle.engineForce = 0;
  vehicle.brake = 60;
  let brakingSeconds = 0;
  while (Math.abs(vehicle.speed) > 0.2 && brakingSeconds < 3) {
    advance(1);
    brakingSeconds += DT;
  }
  observation.brakingSeconds = brakingSeconds;
  assertCondition(
    brakingSeconds < 3,
    `braking from ${observation.speed} m/s took ${brakingSeconds} s`,
  );
  assertCondition(
    Math.abs(vehicle.speed) < 0.2,
    `the car is still rolling at ${vehicle.speed} m/s after the brake window`,
  );

  // Respawn: the fourth entry point, and the sign check — facing the other way, the same
  // positive engine force is now +z.
  vehicle.teleport({ x: 10, y: RIDE, z: 40 }, Math.PI);
  advance(10);
  observation.respawn = [chassis.position.x, chassis.position.z];
  assertCondition(
    Math.abs(chassis.position.x - 10) < 0.01 && Math.abs(chassis.position.z - 40) < 0.01,
    `a respawn landed at ${chassis.position.x}, ${chassis.position.z} instead of 10, 40`,
  );
  vehicle.engineForce = 4000;
  vehicle.brake = 0;
  advance(120);
  observation.reverseSpeed = vehicle.speed;
  assertCondition(
    observation.reverseSpeed > 5,
    `a respawned car reached only ${observation.reverseSpeed} m/s driving the other way`,
  );
  assertCondition(
    chassis.position.z > 41,
    `a respawned car drove to z ${chassis.position.z} instead of +z`,
  );

  vehicle.dispose();
  floor.dispose();
  console.info(`TN_VEHICLE_PROOF:${JSON.stringify(observation)}`);
  return startBehaviorScene(canvas, dimensions, "vehicle-physics", () => observation);
}
