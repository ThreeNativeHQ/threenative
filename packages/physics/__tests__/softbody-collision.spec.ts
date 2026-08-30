import * as RAPIER from "@dimforge/rapier3d-compat";
import { BoxGeometry, Matrix4, Mesh } from "three";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import "../src/index.js";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { RigidBody3D } from "../src/RigidBody3D.js";
import { softBodyCollision } from "../src/softbody-collision.js";

const worlds: RAPIER.World[] = [];

beforeAll(async () => RAPIER.init());

afterEach(() => {
  for (const world of worlds.splice(0)) world.free();
});

describe("softBodyCollision", () => {
  it("packs existing box bodies into cloth-local bounds", () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    worlds.push(world);
    const object = new Mesh(new BoxGeometry(2, 4, 6));
    object.position.set(5, 6, 7);
    object.updateMatrixWorld(true);
    const wall = new RigidBody3D({
      object,
      shape: CollisionShape3D.box(2, 4, 6),
      type: "fixed",
      world,
    });
    const collision = softBodyCollision(wall);
    const packed = new Float32Array(collision.capacity * 8);

    expect(collision.writeBoxes(packed, new Matrix4().makeTranslation(-1, -2, -3))).toBe(1);
    expect([...packed]).toEqual([4, 4, 4, 0, 1, 2, 3, 0]);
    wall.dispose();
  });

  it("rejects non-box and position-only bodies instead of silently dropping them", () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    worlds.push(world);
    const sphere = new RigidBody3D({
      object: new Mesh(new BoxGeometry(1, 1, 1)),
      shape: CollisionShape3D.sphere(0.5),
      type: "fixed",
      world,
    });
    const hidden = new RigidBody3D({
      position: { x: 0, y: 0, z: 0 },
      shape: CollisionShape3D.box(1, 1, 1),
      type: "fixed",
      world,
    });

    expect(() => softBodyCollision(sphere)).toThrow("supports box shapes");
    expect(() => softBodyCollision(hidden)).toThrow("requires an object transform");
    sphere.dispose();
    hidden.dispose();
  });
});
