import * as RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { PhysicsDirectSpaceState3D } from "../src/PhysicsDirectSpaceState3D.js";
import { createWebPhysicsSimulation } from "../src/simulation.js";

const AGENT_COUNT = 5;
const FRAME_COUNT = 60;

beforeAll(async () => {
  await RAPIER.init();
});

function createSimulation() {
  return createWebPhysicsSimulation({
    eventQueue: new RAPIER.EventQueue(true),
    rapier: RAPIER,
    version: RAPIER.version(),
    world: new RAPIER.World({ x: 0, y: 0, z: 0 }),
  });
}

function addStaticBox(
  simulation: ReturnType<typeof createSimulation>,
  position: { readonly x: number; readonly y: number; readonly z: number },
): void {
  simulation.createBody({
    mass: 0,
    position,
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    sensor: false,
    shape: CollisionShape3D.box(1, 1, 1).descriptor,
    type: "fixed",
  });
}

interface IVisibilityMeasurement {
  readonly frames: number;
  readonly queries: number;
  readonly queryMs: number;
}

function requireQueryObservation(measurement: IVisibilityMeasurement): void {
  if (
    measurement.frames === 0 ||
    measurement.queries === 0 ||
    !Number.isFinite(measurement.queryMs)
  ) {
    throw new Error("TN_PRD325_VISIBILITY_MISSING_QUERY_OBSERVATION");
  }
}

describe("Phase 0 direct-space visibility measurement", () => {
  it("records one shipped ray query per agent per fixed frame and fails closed when absent", () => {
    const simulation = createSimulation();
    for (let index = 0; index < 143; index += 1) {
      addStaticBox(simulation, {
        x: (index % 13) * 2 - 12,
        y: 1,
        z: Math.floor(index / 13) * 2 - 10,
      });
    }
    simulation.step(1 / 60);
    const space = new PhysicsDirectSpaceState3D(simulation);
    let queryMs = 0;
    let queries = 0;
    const runQuery = (options: Parameters<PhysicsDirectSpaceState3D["intersectRay"]>[0]): void => {
      space.intersectRay(options);
      queries += 1;
    };
    const started = performance.now();
    for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
      for (let agent = 0; agent < AGENT_COUNT; agent += 1) {
        runQuery({
          collisionMask: 1,
          from: { x: agent * 0.25, y: 1.7, z: 20 },
          to: { x: agent * 0.25, y: 1.7, z: -20 },
        });
      }
    }
    queryMs = performance.now() - started;
    const measurement = { frames: FRAME_COUNT, queries, queryMs };
    requireQueryObservation(measurement);
    expect(measurement.queries).toBe(FRAME_COUNT * AGENT_COUNT);
    expect(measurement.queryMs).toBeGreaterThanOrEqual(0);
    console.info(`TN_PRD325_VISIBILITY_UNIT:${JSON.stringify(measurement)}`);
    simulation.dispose();
  });
});
