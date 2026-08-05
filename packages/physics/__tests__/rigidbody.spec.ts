import * as RAPIER from "@dimforge/rapier3d-compat";
import { BoxGeometry, Mesh } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { RigidBody3D } from "../src/RigidBody3D.js";

const worlds: RAPIER.World[] = [];

function world(): RAPIER.World {
  const instance = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  worlds.push(instance);
  return instance;
}

afterEach(() => {
  for (const instance of worlds.splice(0)) instance.free();
});

describe("RigidBody3D", () => {
  it("should move the mesh downward when the body falls", async () => {
    await RAPIER.init();
    const instance = world();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1));
    mesh.position.y = 5;
    const body = new RigidBody3D({
      object: mesh,
      shape: CollisionShape3D.fromMesh(mesh),
      world: instance,
    });

    for (let step = 0; step < 60; step++) {
      instance.step();
      body.syncFromPhysics();
    }

    const drop = 5 - mesh.position.y;
    expect(drop).toBeGreaterThan(4.5);
    expect(drop).toBeLessThan(5.2);
  });

  it("should rest on a fixed floor rather than pass through", async () => {
    await RAPIER.init();
    const instance = world();
    const floorMesh = new Mesh(new BoxGeometry(4, 0.2, 4));
    const floor = new RigidBody3D({
      object: floorMesh,
      shape: CollisionShape3D.fromMesh(floorMesh),
      type: "fixed",
      world: instance,
    });
    const crateMesh = new Mesh(new BoxGeometry(4, 4, 4));
    crateMesh.position.y = 8;
    const crate = new RigidBody3D({
      object: crateMesh,
      shape: CollisionShape3D.fromMesh(crateMesh),
      world: instance,
    });

    for (let step = 0; step < 300; step++) {
      instance.step();
      crate.syncFromPhysics();
    }

    expect(crateMesh.position.y).toBeCloseTo(2.1, 1);
    floor.dispose();
    crate.dispose();
  });
});
