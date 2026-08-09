import * as RAPIER from "@dimforge/rapier3d-compat";
import type { Ctx } from "@threenative/core";
import { BoxGeometry, Group, Mesh, Vector3 } from "three";
import { afterEach, describe, expect, it } from "vitest";
import "../src/index.js";
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
    object: mesh,
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
  it("should accumulate gravity into velocity when airborne", async () => {
    const { ctx, plugin } = await setup();
    const mesh = new Mesh(new BoxGeometry(0.6, 1, 0.6));
    mesh.position.y = 4;
    const character = new CharacterBody3D({
      gravity: -9.81,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
      object: mesh,
    });

    for (let step = 0; step < 10; step += 1) {
      character.moveAndSlide(1 / 60);
      plugin.update?.(ctx, 1 / 60);
    }

    expect(character.velocity.y).toBeLessThan(0);
    character.dispose();
  });

  it("should zero downward velocity when grounded", async () => {
    const { ctx, plugin } = await setup();
    fixedBody(ctx.physics, new BoxGeometry(10, 0.2, 4), 0, -0.1);
    const mesh = new Mesh(new BoxGeometry(0.6, 1, 0.6));
    mesh.position.set(0, 0.5, 0);
    const character = new CharacterBody3D({
      gravity: -9.81,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
      object: mesh,
    });

    for (let step = 0; step < 30; step += 1) {
      character.moveAndSlide(1 / 60);
      plugin.update?.(ctx, 1 / 60);
    }

    expect(character.grounded).toBe(true);
    expect(character.velocity.y).toBe(0);
    character.dispose();
  });

  it("should carry a grounded rider with a moving kinematic platform", async () => {
    const { ctx, plugin } = await setup();
    const platformMesh = new Mesh(new BoxGeometry(4, 0.2, 4));
    platformMesh.position.y = -0.1;
    const platform = new RigidBody3D({
      object: platformMesh,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(platformMesh),
      type: "kinematic",
    });
    const mesh = new Mesh(new BoxGeometry(0.6, 1, 0.6));
    mesh.position.set(0, 0.5, 0);
    const character = new CharacterBody3D({
      gravity: -9.81,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
      object: mesh,
    });

    for (let step = 0; step < 120; step += 1) {
      platformMesh.position.x += 0.02;
      character.moveAndSlide(1 / 60);
      plugin.update?.(ctx, 1 / 60);
    }

    expect(character.grounded).toBe(true);
    expect(mesh.position.x).toBeGreaterThan(1.5);
    character.dispose();
    platform.dispose();
  });

  it("should apply the motion reported by its ground collider", async () => {
    const { ctx, plugin } = await setup();
    fixedBody(ctx.physics, new BoxGeometry(10, 0.2, 4), 0, -0.1);
    const mesh = new Mesh(new BoxGeometry(0.6, 1, 0.6));
    mesh.position.set(0, 0.5, 0);
    const character = new CharacterBody3D({
      gravity: -9.81,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
      object: mesh,
    });

    for (let step = 0; step < 30; step += 1) {
      character.moveAndSlide(1 / 60);
      plugin.update?.(ctx, 1 / 60);
    }
    ctx.physics.kinematicMotion = () => ({ x: 1.5, y: 0, z: 0 });
    character.moveAndSlide(1 / 60);
    plugin.update?.(ctx, 1 / 60);

    expect(character.grounded).toBe(true);
    expect(mesh.position.x).toBeGreaterThan(1.4);
    character.dispose();
  });

  it("should not carry a rider that is not grounded on the platform", async () => {
    const { ctx, plugin } = await setup();
    const platformMesh = new Mesh(new BoxGeometry(4, 0.2, 4));
    platformMesh.position.y = -0.1;
    const platform = new RigidBody3D({
      object: platformMesh,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(platformMesh),
      type: "kinematic",
    });
    const mesh = new Mesh(new BoxGeometry(0.6, 1, 0.6));
    mesh.position.set(0, 0.5, 0);
    const character = new CharacterBody3D({
      gravity: -9.81,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
      object: mesh,
    });

    for (let step = 0; step < 30; step += 1) {
      character.moveAndSlide(1 / 60);
      plugin.update?.(ctx, 1 / 60);
    }
    character.velocity.y = 5;
    platformMesh.position.x += 1;
    character.moveAndSlide(1 / 60);
    plugin.update?.(ctx, 1 / 60);

    expect(mesh.position.x).toBeLessThan(0.2);
    character.dispose();
    platform.dispose();
  });

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
      object: mesh,
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
      object: mesh,
    });

    for (let step = 0; step < 120; step++) {
      character.move({ x: 2 / 60, y: 0, z: 0 });
      plugin.update?.(ctx, 1 / 60);
    }

    expect(mesh.position.x).toBeLessThan(0);
    character.dispose();
  });

  it("should ignore colliders outside its collision mask while moving", async () => {
    const { ctx, plugin } = await setup();
    const wallMesh = new Mesh(new BoxGeometry(0.6, 2, 4));
    const wall = new RigidBody3D({
      collisionLayer: 4,
      object: wallMesh,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(wallMesh),
      type: "fixed",
    });
    const mesh = new Mesh(new BoxGeometry(0.6, 1, 0.6));
    mesh.position.x = -2;
    const character = new CharacterBody3D({
      collisionLayer: 1,
      collisionMask: 0xfffb,
      gravity: 0,
      object: mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
    });

    for (let step = 0; step < 120; step += 1) {
      character.move({ x: 2 / 60, y: 0, z: 0 });
      plugin.update?.(ctx, 1 / 60);
    }

    expect(mesh.position.x).toBeGreaterThan(1.5);
    character.dispose();
    wall.dispose();
  });

  it("should clear the filter predicate after step() and land on a one-way platform", async () => {
    const { ctx, plugin } = await setup();
    fixedBody(ctx.physics, new BoxGeometry(10, 0.2, 4), 0, -0.1);
    const platformMesh = new Mesh(new BoxGeometry(4, 0.2, 4));
    platformMesh.position.y = 2;
    const platform = new RigidBody3D({
      collisionLayer: 2,
      object: platformMesh,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(platformMesh),
      type: "fixed",
    });

    const mesh = new Mesh(new BoxGeometry(0.6, 1, 0.6));
    mesh.position.set(0, 0.5, 0);
    const character = new CharacterBody3D({
      gravity: -9.81,
      oneWayLayers: 2,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
      object: mesh,
    });
    character.velocity.y = 8;

    for (let step = 0; step < 120; step += 1) {
      character.moveAndSlide(1 / 60);
      plugin.update?.(ctx, 1 / 60);
    }

    expect(character.grounded).toBe(true);
    expect(mesh.position.y).toBeGreaterThan(2.3);
    character.dispose();
    platform.dispose();
  });

  it("should drive a Group as a character body", async () => {
    const { ctx, plugin } = await setup();
    const object = new Group();
    const left = new Mesh(new BoxGeometry(0.4, 0.4, 0.4));
    const right = new Mesh(new BoxGeometry(0.4, 0.4, 0.4));
    left.position.x = -0.6;
    right.position.x = 0.6;
    object.add(left, right);
    const character = new CharacterBody3D({
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
      object,
    });

    character.move({ x: 1, y: 0, z: 0 });
    plugin.update?.(ctx, 1 / 60);

    const leftWorld = left.getWorldPosition(new Vector3());
    const rightWorld = right.getWorldPosition(new Vector3());
    expect(object.position.x).toBeCloseTo(1, 4);
    expect(leftWorld.x).toBeCloseTo(object.position.x - 0.6, 4);
    expect(rightWorld.x).toBeCloseTo(object.position.x + 0.6, 4);
    character.dispose();
  });

  it("should preserve script-controlled rotation through a physics tick", async () => {
    const { ctx, plugin } = await setup();
    const object = new Mesh(new BoxGeometry(0.6, 1, 0.6));
    const character = new CharacterBody3D({
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
      object,
    });

    object.rotation.y = Math.PI / 2;
    character.move({ x: 1, y: 0, z: 0 });
    plugin.update?.(ctx, 1 / 60);

    expect(object.rotation.y).toBeCloseTo(Math.PI / 2, 4);
    expect((character.body.raw as RAPIER.RigidBody).rotation().y).toBeCloseTo(
      Math.sin(Math.PI / 4),
      4,
    );
    character.dispose();
  });

  it("should keep CollisionShape3D.fromMesh taking a Mesh", () => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1));
    expect(() => CollisionShape3D.fromMesh(mesh)).not.toThrow();
  });

  it("should place the body and zero its velocity when teleported", async () => {
    const { ctx } = await setup();
    const object = new Mesh(new BoxGeometry(0.6, 1, 0.6));
    const character = new CharacterBody3D({
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
      object,
    });
    character.velocity.set(4, -3, 2);
    character.grounded = true;

    character.teleport({ x: 3, y: 4, z: 5 });

    expect(object.position.toArray()).toEqual([3, 4, 5]);
    expect(character.velocity.lengthSq()).toBe(0);
    expect(character.grounded).toBe(false);
    character.dispose();
  });

  it("should throw when teleported after dispose", async () => {
    const { ctx } = await setup();
    const character = new CharacterBody3D({
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
      object: new Mesh(new BoxGeometry(0.6, 1, 0.6)),
    });
    character.dispose();

    expect(() => character.teleport({ x: 0, y: 0, z: 0 })).toThrow(
      "CharacterBody3D.teleport cannot be used after dispose.",
    );
  });
});
