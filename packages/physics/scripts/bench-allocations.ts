/**
 * Allocation bench for the physics hot path (PRD-170).
 *
 * Steps a mixed kinematic/dynamic/character scene through the shared plugin — the production
 * write/read loop — and reports heap churn across the measured window. Not a CI gate: the number
 * it exists for is the before/after delta when the per-body-per-step allocations land or are
 * reverted, recorded in docs/verification/.
 *
 * Run: NODE_OPTIONS=--expose-gc pnpm tsx scripts/bench-physics-allocations.ts
 */
import * as RAPIER from "@dimforge/rapier3d-compat";
import { BoxGeometry, Mesh, Scene } from "three";
import "../src/index.js";
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
  const plugin = rapier();
  const ctx = {
    physics: undefined,
  } as unknown as Parameters<typeof plugin.setup>[0] extends infer T ? T : never;
  await plugin.setup?.(ctx as never);
  const physics = (ctx as unknown as { physics: IPhysicsContext }).physics;
  if (physics === undefined) throw new Error("physics plugin did not install a context");

  const geometry = new BoxGeometry(1, 1, 1);
  const scene = new Scene();

  // Kinematic platforms (write + read path), characters (controller path), dynamic crates.
  const bodies: Array<RigidBody3D | CharacterBody3D> = [];
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

  // Warmup: compile paths, settle contacts, fill caches.
  for (let step = 0; step < 90; step += 1) {
    for (const body of bodies) {
      if (body instanceof CharacterBody3D) body.moveAndSlide(1 / 60);
    }
    plugin.update?.(ctx as never, 1 / 60);
  }
  forceGc();

  if (typeof globalThis.gc !== "function")
    console.warn("gc unavailable; run with NODE_OPTIONS=--expose-gc for stable numbers");
  forceGc();
  const startedAt = process.hrtime.bigint();
  let gcCount = 0;
  const observer = new PerformanceObserver((list) => {
    gcCount += list.getEntries().length;
  });
  observer.observe({ entryTypes: ["gc"] });

  for (let step = 0; step < STEPS; step += 1) {
    for (const body of bodies) {
      if (body instanceof CharacterBody3D) body.moveAndSlide(1 / 60);
    }
    plugin.update?.(ctx as never, 1 / 60);
  }

  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  observer.disconnect();
  forceGc();
  console.log(
    JSON.stringify(
      {
        bodies: bodies.length,
        steps: STEPS,
        gcEventsDuringWindow: gcCount,
        wallMs: elapsedMs.toFixed(1),
        usPerStep: ((elapsedMs * 1000) / STEPS).toFixed(1),
      },
      null,
      2,
    ),
  );

  for (const body of bodies) body.dispose();
  plugin.dispose?.(ctx as never);
}

void main();
