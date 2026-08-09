import * as RAPIER from "@dimforge/rapier3d-compat";
import type { Ctx } from "@threenative/core";
import { BoxGeometry, Mesh } from "three";
import { afterEach, describe, expect, it } from "vitest";
import "../src/index.js";
import { Area3D } from "../src/Area3D.js";
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

afterEach(() => {
  for (const plugin of plugins.splice(0))
    plugin.dispose?.({} as Ctx<Record<string, unknown>, PhysicsContext>);
});

describe("Area3D", () => {
  it("monitors by default and suppresses stale exits while disabled", async () => {
    const { ctx, plugin } = await setup();
    const area = new Area3D({ physics: ctx.physics, shape: CollisionShape3D.box(2, 2, 2) });
    const body = new RigidBody3D({
      object: new Mesh(new BoxGeometry(1, 1, 1)),
      physics: ctx.physics,
      shape: CollisionShape3D.box(1, 1, 1),
    });
    let entered = 0;
    let exited = 0;
    area.on("bodyEntered", () => entered++);
    area.on("bodyExited", () => exited++);

    expect(area.monitoring).toBe(true);
    plugin.update?.(ctx, 1 / 60);
    expect(entered).toBe(1);

    area.monitoring = false;
    expect(area.monitoring).toBe(false);
    (body.body.raw as RAPIER.RigidBody).setTranslation({ x: 5, y: 0, z: 0 }, true);
    plugin.update?.(ctx, 1 / 60);
    area.monitoring = true;
    plugin.update?.(ctx, 1 / 60);

    expect(exited).toBe(0);
    body.dispose();
    area.dispose();
  });

  it("does not report a new intersection while monitoring is disabled", async () => {
    const { ctx, plugin } = await setup();
    const area = new Area3D({ physics: ctx.physics, shape: CollisionShape3D.box(2, 2, 2) });
    const body = new RigidBody3D({
      object: new Mesh(new BoxGeometry(1, 1, 1)),
      physics: ctx.physics,
      shape: CollisionShape3D.box(1, 1, 1),
    });
    let entered = 0;
    area.on("bodyEntered", () => entered++);
    area.monitoring = false;
    plugin.update?.(ctx, 1 / 60);
    expect(entered).toBe(0);

    area.monitoring = true;
    plugin.update?.(ctx, 1 / 60);
    expect(entered).toBe(1);
    body.dispose();
    area.dispose();
  });

  it("should move its sensor through the Area3D surface", async () => {
    const { ctx } = await setup();
    const area = new Area3D({ physics: ctx.physics, shape: CollisionShape3D.box(2, 2, 2) });

    area.setPosition({ x: 3, y: 4, z: 5 });

    expect((area.body.raw as RAPIER.RigidBody).translation()).toEqual({ x: 3, y: 4, z: 5 });
    area.dispose();
  });

  it("should fire bodyEntered exactly once while a body remains inside", async () => {
    const { ctx, plugin } = await setup();
    const area = new Area3D({ physics: ctx.physics, shape: CollisionShape3D.box(2, 2, 2) });
    const body = new RigidBody3D({
      object: new Mesh(new BoxGeometry(1, 1, 1)),
      physics: ctx.physics,
      shape: CollisionShape3D.box(1, 1, 1),
    });
    let entered = 0;
    area.on("bodyEntered", () => entered++);

    for (let step = 0; step < 100; step++) plugin.update?.(ctx, 1 / 60);

    expect(entered).toBe(1);
    body.dispose();
    area.dispose();
  });

  it("should ignore bodies outside its collision mask", async () => {
    const { ctx, plugin } = await setup();
    const area = new Area3D({
      collisionMask: 2,
      physics: ctx.physics,
      shape: CollisionShape3D.box(2, 2, 2),
    });
    const debris = new RigidBody3D({
      collisionLayer: 4,
      object: new Mesh(new BoxGeometry(1, 1, 1)),
      physics: ctx.physics,
      shape: CollisionShape3D.box(1, 1, 1),
    });
    let entered = 0;
    area.on("bodyEntered", () => entered++);

    plugin.update?.(ctx, 1 / 60);

    expect(entered).toBe(0);
    debris.dispose();
    area.dispose();
  });

  it("should use its mask without requiring the body to scan the area layer", async () => {
    const { ctx, plugin } = await setup();
    const area = new Area3D({
      collisionLayer: 8,
      collisionMask: 2,
      physics: ctx.physics,
      shape: CollisionShape3D.box(2, 2, 2),
    });
    const body = new RigidBody3D({
      collisionLayer: 2,
      collisionMask: 4,
      object: new Mesh(new BoxGeometry(1, 1, 1)),
      physics: ctx.physics,
      shape: CollisionShape3D.box(1, 1, 1),
    });
    let entered = 0;
    area.on("bodyEntered", () => entered++);

    plugin.update?.(ctx, 1 / 60);

    expect(entered).toBe(1);
    body.dispose();
    area.dispose();
  });

  it("should retain entered contacts for a playtest drain", async () => {
    const { ctx, plugin } = await setup();
    const area = new Area3D({
      entity: "coin.3",
      physics: ctx.physics,
      shape: CollisionShape3D.box(2, 2, 2),
    });
    const body = new RigidBody3D({
      object: new Mesh(new BoxGeometry(1, 1, 1)),
      physics: ctx.physics,
      shape: CollisionShape3D.box(1, 1, 1),
    });

    plugin.update?.(ctx, 1 / 60);

    expect(area.drainContacts()).toEqual([
      expect.objectContaining({ area, body, entity: "coin.3", started: true }),
    ]);
    expect(area.drainContacts()).toEqual([]);
    body.dispose();
    area.dispose();
  });

  it("should fire bodyExited when the body leaves", async () => {
    const { ctx, plugin } = await setup();
    const area = new Area3D({ physics: ctx.physics, shape: CollisionShape3D.box(2, 2, 2) });
    const body = new RigidBody3D({
      object: new Mesh(new BoxGeometry(1, 1, 1)),
      physics: ctx.physics,
      shape: CollisionShape3D.box(1, 1, 1),
    });
    let exited = 0;
    area.on("bodyExited", () => exited++);
    plugin.update?.(ctx, 1 / 60);
    (body.body.raw as RAPIER.RigidBody).setTranslation({ x: 5, y: 0, z: 0 }, true);
    plugin.update?.(ctx, 1 / 60);

    expect(exited).toBe(1);
    body.dispose();
    area.dispose();
  });

  it("should report a character entering without treating the sensor as a wall", async () => {
    const { ctx, plugin } = await setup();
    const area = new Area3D({
      physics: ctx.physics,
      position: { x: 1.5, y: 0.5, z: 0 },
      shape: CollisionShape3D.box(1, 1, 1),
    });
    const mesh = new Mesh(new BoxGeometry(0.6, 1, 0.6));
    mesh.position.set(-2, 0.5, 0);
    const character = new CharacterBody3D({
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
      object: mesh,
    });
    let entered = 0;
    area.on("bodyEntered", () => entered++);

    for (let step = 0; step < 120; step++) {
      character.move({ x: 2 / 60, y: 0, z: 0 });
      plugin.update?.(ctx, 1 / 60);
    }

    expect(mesh.position.x).toBeGreaterThan(1.9);
    expect(entered).toBe(1);
    character.dispose();
    area.dispose();
  });
});
