import * as RAPIER from "@dimforge/rapier3d-compat";
import type { Ctx } from "@threenative/core";
import { BoxGeometry, Mesh } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { CharacterBody3D } from "../src/CharacterBody3D.js";
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

function fixedBody(ctx: PhysicsContext, geometry: BoxGeometry, x: number, y: number, rotation = 0) {
  const mesh = new Mesh(geometry);
  mesh.position.set(x, y, 0);
  mesh.rotation.z = rotation;
  return new RigidBody3D({
    mesh,
    physics: ctx,
    shape: CollisionShape3D.fromMesh(mesh),
    type: "fixed",
  });
}

afterEach(() => {
  for (const plugin of plugins.splice(0))
    plugin.dispose?.({} as Ctx<Record<string, unknown>, PhysicsContext>);
});

describe("CharacterBody3D", () => {
  it("should climb a 0.3-unit step without stopping", async () => {
    const { ctx, plugin } = await setup();
    fixedBody(ctx.physics, new BoxGeometry(10, 0.2, 4), 0, -0.1);
    fixedBody(ctx.physics, new BoxGeometry(0.6, 0.3, 4), 1, 0.15);
    const mesh = new Mesh(new BoxGeometry(0.6, 1, 0.6));
    mesh.position.set(-2, 0.5, 0);
    const character = new CharacterBody3D({
      autostep: { maxHeight: 0.4, minWidth: 0.2 },
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
      mesh,
    });

    for (let step = 0; step < 120; step++) {
      character.move({ x: 2 / 60, y: 0, z: 0 });
      plugin.update?.(ctx, 1 / 60);
    }

    expect(mesh.position.x).toBeGreaterThan(1.25);
    expect(mesh.position.y).toBeGreaterThan(0.7);
    character.dispose();
  });

  it("should not climb a 60-degree slope", async () => {
    const { ctx, plugin } = await setup();
    fixedBody(ctx.physics, new BoxGeometry(10, 0.2, 4), 0, -0.1);
    fixedBody(ctx.physics, new BoxGeometry(3, 0.2, 4), 0, 0.9, Math.PI / 3);
    const mesh = new Mesh(new BoxGeometry(0.6, 1, 0.6));
    mesh.position.set(-2, 0.5, 0);
    const character = new CharacterBody3D({
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
      mesh,
    });

    for (let step = 0; step < 120; step++) {
      character.move({ x: 2 / 60, y: 0, z: 0 });
      plugin.update?.(ctx, 1 / 60);
    }

    expect(mesh.position.x).toBeLessThan(0);
    character.dispose();
  });
});
