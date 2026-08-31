#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(runtimeRoot, "..", "..");
const physicsRoot = join(workspaceRoot, "packages", "physics");
const nativeManifest = join(runtimeRoot, "native", "physics", "Cargo.toml");
const requirePhysics = createRequire(join(physicsRoot, "package.json"));
const RAPIER = requirePhysics("@dimforge/rapier3d-compat");

const BODY_COUNT = 128;
const DT = 1 / 60;
const PROJECTILE_RADIUS = 0.05;
const WALL_HALF_THICKNESS = 0.05;
const WALL_X = 0;
const WALL_HALF_HEIGHT = 16;
const WALL_HALF_DEPTH = 32;
const BODY_GRID_WIDTH = 16;
const MOVING_BODY_FARTHEST_START_X = -479;
const MOVING_BODY_NEAREST_START_X = -81;
const TUNNEL_SPEED_MAX = 300;
const MOVING_BODY_SPEED = 40;
const WARMUP_STEPS = 120;
const MEASURED_STEPS = 600;
const SAMPLES = 5;

function movingBodyStartX(index) {
  return (
    MOVING_BODY_FARTHEST_START_X +
    ((MOVING_BODY_NEAREST_START_X - MOVING_BODY_FARTHEST_START_X) * index) / (BODY_COUNT - 1)
  );
}

export const BENCHMARK_GEOMETRY = Object.freeze({
  bodyCount: BODY_COUNT,
  bodyStartFarthestX: MOVING_BODY_FARTHEST_START_X,
  bodyStartNearestX: MOVING_BODY_NEAREST_START_X,
  bodySpeed: MOVING_BODY_SPEED,
  dt: DT,
  measuredSteps: MEASURED_STEPS,
  projectileRadius: PROJECTILE_RADIUS,
  wallHalfDepth: WALL_HALF_DEPTH,
  wallHalfHeight: WALL_HALF_HEIGHT,
  wallThickness: WALL_HALF_THICKNESS * 2,
  wallX: WALL_X,
  warmupSteps: WARMUP_STEPS,
});

export function assertTimedCollisionGeometry() {
  const stepDistance = MOVING_BODY_SPEED * DT;
  const measuredStartX =
    movingBodyStartX(BODY_COUNT - 1) + stepDistance * WARMUP_STEPS;
  const measuredEndX =
    movingBodyStartX(0) + stepDistance * (WARMUP_STEPS + MEASURED_STEPS);
  const collisionEntryX = WALL_X - WALL_HALF_THICKNESS - PROJECTILE_RADIUS;
  const collisionExitX = WALL_X + WALL_HALF_THICKNESS + PROJECTILE_RADIUS;
  const maxY = Math.floor((BODY_COUNT - 1) / BODY_GRID_WIDTH) * 2;
  const maxZ = ((BODY_COUNT - 1) % BODY_GRID_WIDTH) * 2;

  if (
    !(
      measuredStartX < collisionEntryX &&
      measuredEndX > collisionExitX &&
      maxY + PROJECTILE_RADIUS < WALL_HALF_HEIGHT &&
      maxZ + PROJECTILE_RADIUS < WALL_HALF_DEPTH
    )
  ) {
    throw new Error(
      `TN_PRD292_BENCHMARK_GEOMETRY_UNMEASURED: timed path ${measuredStartX}..${measuredEndX} does not cross wall collision range ${collisionEntryX}..${collisionExitX}`,
    );
  }
}

function addWall(world, x) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0, 0));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(WALL_HALF_THICKNESS, WALL_HALF_HEIGHT, WALL_HALF_DEPTH),
    body,
  );
}

function firstTunnelSpeed(continuous) {
  for (let speed = 1; speed <= TUNNEL_SPEED_MAX; speed += 1) {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    addWall(world, WALL_X);
    const description = RAPIER.RigidBodyDesc.dynamic().setTranslation(-1, 0, 0);
    description.setCcdEnabled(continuous);
    const body = world.createRigidBody(description);
    world.createCollider(RAPIER.ColliderDesc.ball(PROJECTILE_RADIUS), body);
    body.setLinvel({ x: speed, y: 0, z: 0 }, true);
    world.timestep = DT;
    world.step();
    const x = body.translation().x;
    world.free();
    if (x > WALL_HALF_THICKNESS + PROJECTILE_RADIUS) return speed;
  }
  return null;
}

function movingWorld(continuous, withWall) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  if (withWall) addWall(world, WALL_X);
  for (let index = 0; index < BODY_COUNT; index += 1) {
    const y = Math.floor(index / BODY_GRID_WIDTH) * 2;
    const z = (index % BODY_GRID_WIDTH) * 2;
    const description = RAPIER.RigidBodyDesc.dynamic().setTranslation(movingBodyStartX(index), y, z);
    description.setCcdEnabled(continuous);
    const body = world.createRigidBody(description);
    world.createCollider(RAPIER.ColliderDesc.ball(PROJECTILE_RADIUS), body);
    body.setLinvel({ x: MOVING_BODY_SPEED, y: 0, z: 0 }, true);
  }
  world.timestep = DT;
  return world;
}

function median(values) {
  values.sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)];
}

function medianStepMs(continuous, withWall) {
  const samples = [];
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    const world = movingWorld(continuous, withWall);
    for (let step = 0; step < WARMUP_STEPS; step += 1) world.step();
    const started = performance.now();
    for (let step = 0; step < MEASURED_STEPS; step += 1) world.step();
    samples.push((performance.now() - started) / MEASURED_STEPS);
    world.free();
  }
  return median(samples);
}

function assertNear(actual, expected, label) {
  if (typeof actual !== "number" || !Number.isFinite(actual) || Math.abs(actual - expected) > 1e-5)
    throw new Error(
      `TN_PRD292_BENCHMARK_GEOMETRY_MISMATCH: native ${label}=${String(actual)} expected ${String(expected)}`,
    );
}

export function assertNativeGeometry(native) {
  const geometry = native?.geometry;
  if (geometry === undefined || typeof geometry !== "object" || geometry === null)
    throw new Error("TN_PRD292_BENCHMARK_GEOMETRY_MISSING: native runner returned no geometry");
  for (const [label, expected] of Object.entries({
    bodyCount: BODY_COUNT,
    bodySpeed: MOVING_BODY_SPEED,
    dt: DT,
    measuredSteps: MEASURED_STEPS,
    projectileRadius: PROJECTILE_RADIUS,
    wallHalfDepth: WALL_HALF_DEPTH,
    wallHalfHeight: WALL_HALF_HEIGHT,
    wallThickness: WALL_HALF_THICKNESS * 2,
    wallX: WALL_X,
    warmupSteps: WARMUP_STEPS,
  }))
    assertNear(geometry[label], expected, label);
  assertNear(geometry.bodyStartFarthestX, MOVING_BODY_FARTHEST_START_X, "bodyStartFarthestX");
  assertNear(geometry.bodyStartNearestX, MOVING_BODY_NEAREST_START_X, "bodyStartNearestX");
}

export function createBenchmarkReport(web, native) {
  return {
    scene: {
      bodyCount: BODY_COUNT,
      definition: `one ${WALL_HALF_THICKNESS * 2} m thick fixed wall; ${PROJECTILE_RADIUS} m radius projectile; ${DT} s step`,
      geometry: BENCHMARK_GEOMETRY,
      measuredSteps: MEASURED_STEPS,
      samples: SAMPLES,
      timedCollisionCandidate: true,
      warmupSteps: WARMUP_STEPS,
    },
    web: {
      backend: "web",
      ...web,
    },
    native,
  };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  assertTimedCollisionGeometry();
  await RAPIER.init();
  const noWallBaselineStepMs = medianStepMs(false, false);
  const noWallContinuousStepMs = medianStepMs(true, false);
  const baselineStepMs = medianStepMs(false, true);
  const continuousStepMs = medianStepMs(true, true);
  const native = JSON.parse(
    execFileSync(
      "cargo",
      [
        "run",
        "--quiet",
        "--release",
        "--manifest-path",
        nativeManifest,
        "--example",
        "measure_continuous_collision",
      ],
      { cwd: workspaceRoot, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .at(-1),
  );
  assertNativeGeometry(native);
  console.log(
    JSON.stringify(
      createBenchmarkReport(
        {
          noWallBaselineStepMs,
          noWallContinuousStepMs,
          noWallDeltaStepMs: noWallContinuousStepMs - noWallBaselineStepMs,
          baselineFirstTunnelSpeed: firstTunnelSpeed(false),
          continuousFirstTunnelSpeed: firstTunnelSpeed(true),
          baselineStepMs,
          continuousStepMs,
          deltaStepMs: continuousStepMs - baselineStepMs,
          rapierVersion: RAPIER.version(),
        },
        native,
      ),
      null,
      2,
    ),
  );
}
