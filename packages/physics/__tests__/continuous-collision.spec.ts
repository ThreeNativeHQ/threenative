import * as RAPIER from "@dimforge/rapier3d-compat";
import { Mesh } from "three";
import { afterEach, describe, expect, it } from "vitest";
import "../src/index.js";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { type IRigidBody3DOptions, RigidBody3D } from "../src/RigidBody3D.js";

const worlds: RAPIER.World[] = [];

async function makeProjectile(options: Pick<IRigidBody3DOptions, "continuousCollision"> = {}) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  worlds.push(world);
  new RigidBody3D({
    position: { x: 0, y: 0, z: 0 },
    shape: CollisionShape3D.box(0.05, 1, 1),
    type: "fixed",
    world,
  });
  const projectileMesh = new Mesh();
  projectileMesh.position.x = -1;
  const projectile = new RigidBody3D({
    object: projectileMesh,
    shape: CollisionShape3D.sphere(0.05),
    world,
    ...options,
  });
  projectile.linearVelocity = { x: 120, y: 0, z: 0 };
  return { projectile, projectileMesh, world };
}

afterEach(() => {
  for (const world of worlds.splice(0)) world.free();
});

describe("continuous collision", () => {
  it("keeps a fast projectile on the near side of a thin wall", async () => {
    const { projectile, projectileMesh, world } = await makeProjectile();
    world.step();
    projectile.syncFromPhysics();

    expect(projectileMesh.position.x).toBeLessThan(0);
    expect(projectile.continuousCollision).toBe(true);
  });

  it("reports an explicit opt-out while allowing the projectile to pass through", async () => {
    const { projectile, projectileMesh, world } = await makeProjectile({
      continuousCollision: false,
    });
    world.step();
    projectile.syncFromPhysics();

    expect(projectileMesh.position.x).toBeGreaterThan(0.1);
    expect(projectile.continuousCollision).toBe(false);
  });
});
