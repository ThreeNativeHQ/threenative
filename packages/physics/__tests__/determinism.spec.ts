import * as RAPIER from "@dimforge/rapier3d-compat";
import { FixedStepLoop } from "@threenative/core";
import type { Ctx } from "@threenative/core";
import { BoxGeometry, Mesh } from "three";
import { describe, expect, it } from "vitest";
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

describe("physics determinism", () => {
  it("should match at 30fps and 144fps", async () => {
    const at30 = await simulate(30);
    const at144 = await simulate(144);

    expect(Math.abs(at30 - at144)).toBeLessThan(0.01);
  });
});
