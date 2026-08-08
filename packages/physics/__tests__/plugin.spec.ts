import * as RAPIER from "@dimforge/rapier3d-compat";
import type { Ctx, GamePluginRuntime } from "@threenative/core";
import { Object3D } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Area3D } from "../src/Area3D.js";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { RigidBody3D } from "../src/RigidBody3D.js";
import { type PhysicsContext, rapier } from "../src/plugin.js";

const plugins: Array<ReturnType<typeof rapier>> = [];

async function setup() {
  await RAPIER.init();
  const plugin = rapier({ gravity: { x: 0, y: 0, z: 0 } });
  const ctx = { physics: undefined } as unknown as Ctx<Record<string, unknown>, PhysicsContext>;
  await plugin.setup?.(ctx);
  plugins.push(plugin);
  return { ctx, plugin };
}

afterEach(() => {
  for (const plugin of plugins.splice(0))
    plugin.dispose?.({} as Ctx<Record<string, unknown>, PhysicsContext>);
});

describe("rapier plugin", () => {
  it("should register the actual Rapier runtime version", async () => {
    await RAPIER.init();
    const plugin = rapier();
    const ctx = { physics: undefined } as unknown as Ctx<Record<string, unknown>, PhysicsContext>;
    const runtime = {
      fixedStep: () => 0,
      rapier: null,
      seed: 1,
      step: 1 / 60,
    } satisfies GamePluginRuntime;

    await plugin.setup?.(ctx, runtime);

    expect(runtime.rapier).toBe(RAPIER.version());
    plugin.dispose?.(ctx);
  });

  it("should step exactly once per fixed tick", async () => {
    const { ctx, plugin } = await setup();
    const world = ctx.physics.world;
    const originalStep = world.step.bind(world);
    let steps = 0;
    world.step = (eventQueue, hooks) => {
      steps += 1;
      originalStep(eventQueue, hooks);
    };

    for (let tick = 0; tick < 60; tick++) plugin.update?.(ctx, 1 / 60);

    expect(steps).toBe(60);
  });

  it("releases scene physics on sceneExit", async () => {
    const { ctx, plugin } = await setup();
    const body = new RigidBody3D({
      object: new Object3D(),
      physics: ctx.physics,
      shape: CollisionShape3D.box(1, 1, 1),
    });
    const area = new Area3D({
      physics: ctx.physics,
      shape: CollisionShape3D.box(1, 1, 1),
    });

    plugin.sceneExit?.(ctx);
    expect(body.body.isValid()).toBe(false);
    expect(area.body.isValid()).toBe(false);
  });

  it("should report zero bodies after dispose", async () => {
    const { ctx, plugin } = await setup();
    const body = new RigidBody3D({
      object: new Object3D(),
      physics: ctx.physics,
      shape: CollisionShape3D.box(1, 1, 1),
    });

    expect(ctx.physics.numBodies()).toBe(1);
    expect(body.body.isValid()).toBe(true);
    plugin.dispose?.(ctx);
    expect(ctx.physics.numBodies()).toBe(0);
  });

  it("should free one world per setup across ten reload cycles", async () => {
    const worldFree = vi.spyOn(RAPIER.World.prototype, "free");
    const eventQueueFree = vi.spyOn(RAPIER.EventQueue.prototype, "free");
    for (let cycle = 0; cycle < 10; cycle += 1) {
      const { plugin } = await setup();
      plugin.dispose?.({} as Ctx<Record<string, unknown>, PhysicsContext>);
    }

    expect(worldFree).toHaveBeenCalledTimes(10);
    expect(eventQueueFree).toHaveBeenCalledTimes(10);
  });
});
