import * as RAPIER from "@dimforge/rapier3d-compat";
import type { Ctx } from "@threenative/core";
import { afterEach, describe, expect, it } from "vitest";
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
});
