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
const START_X = -1;
const TUNNEL_SPEED_MAX = 300;
const MOVING_BODY_SPEED = 40;
const WARMUP_STEPS = 120;
const MEASURED_STEPS = 600;
const SAMPLES = 5;

function addWall(world, x) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(WALL_HALF_THICKNESS, 10, 10), body);
}

function firstTunnelSpeed(continuous) {
  for (let speed = 1; speed <= TUNNEL_SPEED_MAX; speed += 1) {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    addWall(world, 0);
    const description = RAPIER.RigidBodyDesc.dynamic().setTranslation(START_X, 0, 0);
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

function movingWorld(continuous) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  addWall(world, 10_000);
  for (let index = 0; index < BODY_COUNT; index += 1) {
    const y = Math.floor(index / 16) * 2;
    const z = (index % 16) * 2;
    const description = RAPIER.RigidBodyDesc.dynamic().setTranslation(-1_000, y, z);
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

function medianStepMs(continuous) {
  const samples = [];
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    const world = movingWorld(continuous);
    for (let step = 0; step < WARMUP_STEPS; step += 1) world.step();
    const started = performance.now();
    for (let step = 0; step < MEASURED_STEPS; step += 1) world.step();
    samples.push((performance.now() - started) / MEASURED_STEPS);
    world.free();
  }
  return median(samples);
}

await RAPIER.init();
const baselineStepMs = medianStepMs(false);
const continuousStepMs = medianStepMs(true);
const native = JSON.parse(
  execFileSync(
    "cargo",
    ["run", "--quiet", "--release", "--manifest-path", nativeManifest, "--example", "measure_continuous_collision"],
    { cwd: workspaceRoot, encoding: "utf8" },
  ).trim().split("\n").at(-1),
);

console.log(JSON.stringify({
  scene: {
    bodyCount: BODY_COUNT,
    definition: "one 0.1 m thick fixed wall; 0.1 m radius projectile; 1/60 s step",
    measuredSteps: MEASURED_STEPS,
    samples: SAMPLES,
    warmupSteps: WARMUP_STEPS,
  },
  web: {
    backend: "web",
    rapierVersion: RAPIER.version(),
    baselineFirstTunnelSpeed: firstTunnelSpeed(false),
    continuousFirstTunnelSpeed: firstTunnelSpeed(true),
    baselineStepMs,
    continuousStepMs,
    deltaStepMs: continuousStepMs - baselineStepMs,
  },
  native,
}, null, 2));
