import * as RAPIER from "@dimforge/rapier3d-compat";
import { BoxGeometry, Mesh } from "three";
import { afterEach, describe, expect, it } from "vitest";
import "../src/index.js";
import { Area3D } from "../src/Area3D.js";
import { CharacterBody3D } from "../src/CharacterBody3D.js";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { RigidBody3D } from "../src/RigidBody3D.js";
import { interactionGroups } from "../src/index.js";

const worlds: RAPIER.World[] = [];

afterEach(() => {
  for (const world of worlds.splice(0)) world.free();
});

describe("interactionGroups", () => {
  it("packs layer and mask bits as an unsigned Rapier group", () => {
    expect(interactionGroups(1, 0xffff)).toBe(0x0001ffff);
    expect(interactionGroups(0x8000, 1)).toBe(0x80000001);
    expect(interactionGroups(0x8000, 1)).toBeGreaterThan(0);
  });

  it.each([
    [-1, 0],
    [0x10000, 0],
    [1.5, 0],
  ])("rejects malformed layer input %s", (layer, mask) => {
    expect(() => interactionGroups(layer, mask)).toThrow();
  });
});

describe("CollisionShape3D.heightfield", () => {
  it("rejects a height buffer with the wrong number of samples", () => {
    expect(() =>
      CollisionShape3D.heightfield(3, 4, new Float32Array(11), { x: 1, y: 1, z: 1 }),
    ).toThrow("expected 12 heights, received 11");
  });

  it("maps vertex counts to Rapier segment counts", () => {
    const shape = CollisionShape3D.heightfield(3, 4, new Float32Array(12), {
      x: 2,
      y: 3,
      z: 4,
    });

    expect((shape.raw as RAPIER.ColliderDesc).shape).toMatchObject({
      nrows: 2,
      ncols: 3,
      scale: { x: 2, y: 3, z: 4 },
    });
  });
});

async function fallingCrate(disjoint: boolean): Promise<number> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  worlds.push(world);
  const floorMesh = new Mesh(new BoxGeometry(10, 0.2, 10));
  const floor = new RigidBody3D({
    collisionLayer: disjoint ? 1 : undefined,
    collisionMask: disjoint ? 1 : undefined,
    object: floorMesh,
    shape: CollisionShape3D.box(10, 0.2, 10),
    type: "fixed",
    world,
  });
  const crateMesh = new Mesh(new BoxGeometry(1, 1, 1));
  crateMesh.position.y = 3;
  const crate = new RigidBody3D({
    collisionLayer: disjoint ? 2 : undefined,
    collisionMask: disjoint ? 2 : undefined,
    object: crateMesh,
    shape: CollisionShape3D.box(1, 1, 1),
    world,
  });

  for (let step = 0; step < 60; step += 1) {
    world.step();
    crate.syncFromPhysics();
  }

  const height = crateMesh.position.y;
  crate.dispose();
  floor.dispose();
  return height;
}

describe("collision layers", () => {
  it("preserves caller-owned groups when collision options are omitted", async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    worlds.push(world);
    const groups = interactionGroups(8, 4);

    const rigidShape = CollisionShape3D.box(1, 1, 1).setCollisionGroups(groups);
    const rigid = new RigidBody3D({
      object: new Mesh(new BoxGeometry(1, 1, 1)),
      shape: rigidShape,
      world,
    });
    const areaShape = CollisionShape3D.box(1, 1, 1).setCollisionGroups(groups);
    const area = new Area3D({ shape: areaShape, world });
    const characterShape = CollisionShape3D.capsule(0.2, 0.3).setCollisionGroups(groups);
    const character = new CharacterBody3D({
      object: new Mesh(new BoxGeometry(0.6, 1, 0.6)),
      shape: characterShape,
      world,
    });

    expect((rigid.collider.raw as RAPIER.Collider).collisionGroups()).toBe(groups);
    expect((area.collider.raw as RAPIER.Collider).collisionGroups()).toBe(groups);
    expect((character.collider.raw as RAPIER.Collider).collisionGroups()).toBe(groups);

    character.dispose();
    area.dispose();
    rigid.dispose();
  });

  it("keeps disjoint bodies apart while default bodies still collide", async () => {
    const disjointHeight = await fallingCrate(true);
    const defaultHeight = await fallingCrate(false);

    expect(disjointHeight).toBeLessThan(0.1);
    expect(defaultHeight).toBeGreaterThan(0.5);
  });
});
