import { Worker } from "node:worker_threads";
import * as RAPIER from "@dimforge/rapier3d-compat";
import type { Ctx } from "@threenative/core";
import { BoxGeometry, Mesh } from "three";
import { describe, expect, it } from "vitest";
import { FixedStepLoop } from "../../core/src/loop.js";
import "../src/index.js";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { RigidBody3D } from "../src/RigidBody3D.js";
import { type PhysicsContext, rapier } from "../src/plugin.js";

async function simulate(frameRate: number): Promise<number> {
  await RAPIER.init();
  const plugin = rapier();
  const ctx = { physics: undefined } as unknown as Ctx<Record<string, unknown>, PhysicsContext>;
  await plugin.setup?.(ctx);
  const mesh = new Mesh(new BoxGeometry(1, 1, 1));
  mesh.position.y = 5;
  const body = new RigidBody3D({
    object: mesh,
    physics: ctx.physics,
    shape: CollisionShape3D.box(1, 1, 1),
  });
  const loop = new FixedStepLoop({
    onRender: () => undefined,
    onUpdate: (dt) => plugin.update?.(ctx, dt),
  });
  loop.stepFrame(0);
  for (let frame = 1; frame <= frameRate; frame++) {
    loop.stepFrame(Math.round((frame * 1_000) / frameRate));
  }
  const result = mesh.position.y;
  body.dispose();
  plugin.dispose?.(ctx);
  return result;
}

async function simulateStack(seed: number, yOffset = 0): Promise<Uint8Array> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const x = ((seed >>> 0) % 5) * 0.01;
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, -0.6, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.1, 4), floor);
  for (let index = 0; index < 5; index += 1) {
    const y = index + (index === 0 ? yOffset : 0);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), body);
  }
  for (let tick = 0; tick < 300; tick += 1) world.step();
  const snapshot = world.takeSnapshot();
  world.free();
  return snapshot;
}

async function simulateStackInFreshWorker(seed: number): Promise<Uint8Array> {
  const rapierModule = import.meta.resolve("@dimforge/rapier3d-compat");
  const worker = new Worker(
    `
      import * as RAPIER from ${JSON.stringify(rapierModule)};
      import { parentPort } from "node:worker_threads";

      await RAPIER.init();
      parentPort?.on("message", ({ seed }) => {
        const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
        const x = ((seed >>> 0) % 5) * 0.01;
        const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, -0.6, 0));
        world.createCollider(RAPIER.ColliderDesc.cuboid(4, 0.1, 4), floor);
        for (let index = 0; index < 5; index += 1) {
          const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, index, 0));
          world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), body);
        }
        for (let tick = 0; tick < 300; tick += 1) world.step();
        parentPort?.postMessage([...world.takeSnapshot()]);
        world.free();
      });
    `,
    { eval: true, type: "module" } as unknown as ConstructorParameters<typeof Worker>[1],
  );
  return new Promise((resolve, reject) => {
    worker.once("message", (snapshot: number[]) => {
      resolve(Uint8Array.from(snapshot));
      void worker.terminate();
    });
    worker.once("error", (error) => {
      reject(error);
      void worker.terminate();
    });
    worker.postMessage({ seed });
  });
}

describe("physics determinism", () => {
  it("should match at 30fps and 144fps", async () => {
    const at30 = await simulate(30);
    const at144 = await simulate(144);

    expect(Math.abs(at30 - at144)).toBeLessThan(0.01);
  });

  it("should produce byte-identical snapshots when the same contact-rich scene is stepped twice", async () => {
    const first = await simulateStack(1);
    const second = await simulateStack(1);
    const freshWorker = await simulateStackInFreshWorker(1);

    expect(first).toEqual(second);
    expect(first).toEqual(freshWorker);
  });

  it("should produce different snapshots when one body starts 1e-9 higher", async () => {
    const baseline = await simulateStack(1);
    const perturbed = await simulateStack(1, 1e-9);

    expect(baseline).not.toEqual(perturbed);
  });
});
