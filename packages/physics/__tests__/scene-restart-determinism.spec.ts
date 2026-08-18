import * as RAPIER from "@dimforge/rapier3d-compat";
import type { ICtx } from "@threenative/core";
import { BoxGeometry, Mesh } from "three";
import { beforeAll, expect, it } from "vitest";
import { FixedStepLoop } from "../../core/src/loop.js";
import "../src/index.js";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { RigidBody3D } from "../src/RigidBody3D.js";
import { type IPhysicsContext, rapier } from "../src/plugin.js";

function rigidBodyObject(body: RigidBody3D) {
  const object = body.object;
  if (object === undefined) throw new Error("TEST_RIGID_BODY_OBJECT_MISSING");
  return object;
}

// A sandbox build needed the brief's "run the same input twice with a fixed seed and fixed step
// and report whether the final state matched". It could not get a match, and had no API to fix
// it: rapier() exposes only { gravity }. Measured there: settle hashes a2f87bad vs 658eb6f8 at
// 240 vs 266 ticks, diverging during the initial drop, before any scripted input.
//
// Disposing the bodies on scene exit was never enough. The Rapier world survived the scene, so
// the second run inherited solver, island-manager and broad-phase state from the first.

type PhysicsCtx = ICtx<Record<string, unknown>, IPhysicsContext>;

beforeAll(async () => {
  await RAPIER.init();
});

/** Millimetre-quantised FNV-1a over every body pose, the same shape a game would hash. */
function poseHash(bodies: readonly RigidBody3D[]): string {
  let hash = 0x811c9dc5;
  for (const body of bodies) {
    const { x, y, z } = rigidBodyObject(body).position;
    for (const component of [x, y, z]) {
      const quantised = Math.round(component * 1000);
      for (let byte = 0; byte < 4; byte += 1) {
        hash ^= (quantised >>> (byte * 8)) & 0xff;
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
    }
  }
  return hash.toString(16).padStart(8, "0");
}

/** The same authored layout every time: a stack that topples, so contacts drive the result. */
function dropStack(ctx: PhysicsCtx): RigidBody3D[] {
  const floor = new Mesh(new BoxGeometry(40, 1, 40));
  floor.position.set(0, -0.5, 0);
  const bodies = [
    new RigidBody3D({
      object: floor,
      physics: ctx.physics,
      shape: CollisionShape3D.box(40, 1, 40),
      type: "fixed",
    }),
  ];
  for (let index = 0; index < 12; index += 1) {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1));
    // Deliberately offset so the stack is unstable and the settle depends on contact solving.
    mesh.position.set((index % 3) * 0.35, 0.6 + index * 1.05, (index % 2) * 0.3);
    bodies.push(
      new RigidBody3D({
        mass: 1,
        object: mesh,
        physics: ctx.physics,
        shape: CollisionShape3D.box(1, 1, 1),
      }),
    );
  }
  return bodies;
}

async function settleHashAcrossSceneRestarts(runs: number): Promise<string[]> {
  const plugin = rapier({ deterministicRestart: true, gravity: { x: 0, y: -9.81, z: 0 } });
  const ctx = { physics: undefined } as unknown as PhysicsCtx;
  await plugin.setup?.(ctx);
  const hashes: string[] = [];
  for (let run = 0; run < runs; run += 1) {
    // A fresh loop gets a fresh clock; carrying timestamps across runs would feed run 2 a huge
    // first delta and measure maxSteps clamping instead of simulation state.
    let frame = 0;
    const bodies = dropStack(ctx);
    const loop = new FixedStepLoop({
      onRender: () => undefined,
      onUpdate: (dt) => plugin.update?.(ctx, dt),
    });
    loop.stepFrame(0);
    for (let step = 0; step < 240; step += 1) {
      frame += 1;
      loop.stepFrame(Math.round((frame * 1_000) / 60));
    }
    hashes.push(poseHash(bodies));
    plugin.sceneExit?.(ctx);
  }
  return hashes;
}

it("settles a restarted scene identically, so a fixed-seed replay can match", async () => {
  const [first, second, third] = await settleHashAcrossSceneRestarts(3);

  expect(second).toBe(first);
  expect(third).toBe(first);
}, 30_000);

// The control, and the reason the option exists. With the default settings the same authored
// layout settles differently on the second run, so the test above cannot pass vacuously by
// hashing something that never varied in the first place.
it("diverges by default, when the scene reuses the world", async () => {
  const plugin = rapier({ gravity: { x: 0, y: -9.81, z: 0 } });
  const ctx = { physics: undefined } as unknown as PhysicsCtx;
  await plugin.setup?.(ctx);
  const hashes: string[] = [];
  for (let run = 0; run < 2; run += 1) {
    let frame = 0;
    const bodies = dropStack(ctx);
    const loop = new FixedStepLoop({
      onRender: () => undefined,
      onUpdate: (dt) => plugin.update?.(ctx, dt),
    });
    loop.stepFrame(0);
    for (let step = 0; step < 240; step += 1) {
      frame += 1;
      loop.stepFrame(Math.round((frame * 1_000) / 60));
    }
    hashes.push(poseHash(bodies));
    // Only the bodies go, exactly what sceneExit used to do. The world stays.
    for (const body of bodies) body.dispose();
  }

  expect(hashes[1]).not.toBe(hashes[0]);
}, 30_000);
