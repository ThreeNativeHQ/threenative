import { readFileSync } from "node:fs";
import * as RAPIER from "@dimforge/rapier3d-compat";
import type { ICtx, IGamePluginRuntime } from "@threenative/core";
import { Object3D } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/index.js";
import { Area3D } from "../src/Area3D.js";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { RigidBody3D } from "../src/RigidBody3D.js";
import { PHYSICS_TRANSFORM_STRIDE } from "../src/index.js";
import { type IPhysicsContext, isSmallBufferError, rapier } from "../src/plugin.js";

const plugins: Array<ReturnType<typeof rapier>> = [];

async function setup() {
  await RAPIER.init();
  const plugin = rapier({ gravity: { x: 0, y: 0, z: 0 } });
  const ctx = { physics: undefined } as unknown as ICtx<Record<string, unknown>, IPhysicsContext>;
  await plugin.setup?.(ctx);
  plugins.push(plugin);
  return { ctx, plugin };
}

afterEach(() => {
  for (const plugin of plugins.splice(0))
    plugin.dispose?.({} as ICtx<Record<string, unknown>, IPhysicsContext>);
});

describe("rapier plugin", () => {
  it("should use one ABI buffer matcher in both adapters", () => {
    const pluginSource = readFileSync(new URL("../src/plugin.ts", import.meta.url), "utf8");
    const nativeSource = readFileSync(new URL("../src/native/host.ts", import.meta.url), "utf8");

    expect(pluginSource).toContain("export function isSmallBufferError");
    expect(nativeSource).toContain('import { isSmallBufferError } from "../plugin.js";');
    expect(nativeSource).not.toContain("function isSmallBufferError");
  });

  it("should keep the ABI buffer message contract shared", () => {
    expect(isSmallBufferError(new Error("buffer is too small for visible transforms"))).toBe(true);
    expect(isSmallBufferError(new Error("BUFFER IS TOO SMALL"))).toBe(true);
    expect(isSmallBufferError(new Error("buffer capacity exhausted"))).toBe(false);
    expect(isSmallBufferError("buffer is too small")).toBe(false);
  });

  it("should route sceneExit and dispose through one ordered teardown", () => {
    const source = readFileSync(new URL("../src/plugin.ts", import.meta.url), "utf8");
    const surface = source.match(/const teardownRegistries = \{\n([\s\S]*?)\n {2}\} as const;/);
    if (surface === null) throw new Error("Physics teardown registry surface is missing.");
    const registryBlock = surface[1];
    if (registryBlock === undefined) throw new Error("Physics teardown registry list is missing.");
    const registryNames = [...registryBlock.matchAll(/^\s+(\w+),$/gm)].map(([, name]) => name);
    const releaseStart = source.indexOf("function releaseRegistries");
    const releaseEnd = source.indexOf("\n  function teardown", releaseStart);
    const releaseSource = source.slice(releaseStart, releaseEnd);
    const clearedRegistryNames = [
      ...releaseSource.matchAll(/^\s+teardownRegistries\.(\w+),$/gm),
    ].map(([, name]) => name);

    expect(registryNames.length).toBeGreaterThan(0);
    for (const registryName of registryNames) expect(clearedRegistryNames).toContain(registryName);

    expect(source.match(/function teardown/g)).toHaveLength(1);
    expect(source.match(/teardown\("sceneExit"/g)).toHaveLength(1);
    expect(source.match(/teardown\("dispose"/g)).toHaveLength(1);
    expect(
      source.match(
        /for \(const area of \[\.\.\.teardownRegistries\.areas\.values\(\)\]\) area\.dispose\(\)/g,
      ),
    ).toHaveLength(1);
    expect(
      source.match(/for \(const body of \[\.\.\.teardownRegistries\.bodies\]\) body\.dispose\(\)/g),
    ).toHaveLength(1);
  });

  it("should register the actual Rapier runtime version", async () => {
    await RAPIER.init();
    const plugin = rapier();
    const ctx = { physics: undefined } as unknown as ICtx<Record<string, unknown>, IPhysicsContext>;
    const runtime = {
      fixedStep: () => 0,
      observations: {
        contribute: () => () => undefined,
        contributions: () => [],
      },
      rapier: null,
      seed: 1,
      step: 1 / 60,
      tick: () => 0,
    } satisfies IGamePluginRuntime;

    await plugin.setup?.(ctx, runtime);

    expect(runtime.rapier).toBe(RAPIER.version());
    plugin.dispose?.(ctx);
  });

  it("should step exactly once per fixed tick", async () => {
    const { ctx, plugin } = await setup();
    const world = ctx.physics.world.raw as RAPIER.World;
    const originalStep = world.step.bind(world);
    let steps = 0;
    world.step = (eventQueue, hooks) => {
      steps += 1;
      originalStep(eventQueue, hooks);
    };

    for (let tick = 0; tick < 60; tick++) plugin.update?.(ctx, 1 / 60);

    expect(steps).toBe(60);
  });

  it("should route kinematic input and visible transforms through the bulk API", async () => {
    const { ctx, plugin } = await setup();
    const object = new Object3D();
    const body = new RigidBody3D({
      object,
      physics: ctx.physics,
      shape: CollisionShape3D.box(1, 1, 1),
      type: "kinematic",
    });
    new RigidBody3D({
      object: new Object3D(),
      physics: ctx.physics,
      shape: CollisionShape3D.box(1, 1, 1),
      type: "fixed",
    });
    object.position.set(4, 5, 6);

    plugin.update?.(ctx, 1 / 60);

    const buffer = new Float32Array(PHYSICS_TRANSFORM_STRIDE * 2);
    expect(ctx.physics.simulation.readVisibleTransforms(buffer)).toBe(2);
    expect(buffer[0]).toBe(0);
    expect([...buffer.slice(1, 4)]).toEqual([4, 5, 6]);
    expect(buffer[PHYSICS_TRANSFORM_STRIDE]).toBe(1);
    expect(object.position.toArray()).toEqual([4, 5, 6]);
  });

  it("should fail closed when the visible transform buffer is too small", async () => {
    const { ctx } = await setup();
    new RigidBody3D({
      object: new Object3D(),
      physics: ctx.physics,
      shape: CollisionShape3D.box(1, 1, 1),
    });

    expect(() =>
      ctx.physics.simulation.readVisibleTransforms(new Float32Array(PHYSICS_TRANSFORM_STRIDE - 1)),
    ).toThrow(/buffer is too small/);
  });

  it("grows the event buffer geometrically without losing a collision burst", async () => {
    const { ctx, plugin } = await setup();
    const lengths: number[] = [];
    const drain = ctx.physics.simulation.drainCollisionEvents.bind(ctx.physics.simulation);
    ctx.physics.simulation.drainCollisionEvents = (buffer) => {
      lengths.push(buffer.length);
      return drain(buffer);
    };
    for (let index = 0; index < 20; index += 1) {
      new RigidBody3D({
        object: new Object3D(),
        physics: ctx.physics,
        shape: CollisionShape3D.box(1, 1, 1),
      });
    }

    plugin.update?.(ctx, 1 / 60);

    expect(lengths.length).toBeGreaterThan(1);
    expect(lengths).toEqual([...lengths].sort((left, right) => left - right));
    expect(new Set(lengths).size).toBe(lengths.length);
  });

  it("reuses two area reconciliation maps across feature frames", async () => {
    const { ctx, plugin } = await setup();
    const area = new Area3D({ physics: ctx.physics, shape: CollisionShape3D.box(1, 1, 1) });
    const maps: ReadonlyMap<number, unknown>[] = [];
    const reconcile = area.reconcileIntersections.bind(area);
    area.reconcileIntersections = (current) => {
      maps.push(current);
      reconcile(current);
    };

    for (let step = 0; step < 4; step += 1) plugin.update?.(ctx, 1 / 60);

    expect(maps).toHaveLength(4);
    expect(new Set(maps).size).toBe(2);
    expect(maps[0]).toBe(maps[2]);
    expect(maps[1]).toBe(maps[3]);
    expect(maps[0]).not.toBe(maps[1]);
    area.dispose();
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
    expect((body.body.raw as RAPIER.RigidBody).isValid()).toBe(false);
    expect((area.body.raw as RAPIER.RigidBody).isValid()).toBe(false);
  });

  it("releases the same registered set through sceneExit and dispose", async () => {
    async function release(kind: "sceneExit" | "dispose") {
      const plugin = rapier({ deterministicRestart: true, gravity: { x: 0, y: 0, z: 0 } });
      const ctx = { physics: undefined } as unknown as ICtx<
        Record<string, unknown>,
        IPhysicsContext
      >;
      await plugin.setup?.(ctx);
      plugins.push(plugin);
      const body = new RigidBody3D({
        object: new Object3D(),
        physics: ctx.physics,
        shape: CollisionShape3D.box(1, 1, 1),
      });
      const area = new Area3D({ physics: ctx.physics, shape: CollisionShape3D.box(1, 1, 1) });
      const simulation = ctx.physics.simulation;
      const bodyDispose = vi.spyOn(body, "dispose");
      const areaDispose = vi.spyOn(area, "dispose");
      const simulationDispose = vi.spyOn(simulation, "dispose");

      if (kind === "sceneExit") plugin.sceneExit?.(ctx);
      else plugin.dispose?.(ctx);

      return {
        areaDisposeCalls: areaDispose.mock.calls.length,
        areaReleased: areaDispose.mock.calls.length === 1,
        bodyDisposeCalls: bodyDispose.mock.calls.length,
        bodyReleased: bodyDispose.mock.calls.length === 1,
        numBodies: ctx.physics.numBodies(),
        simulationDisposeCalls: simulationDispose.mock.calls.length,
      };
    }

    expect(await release("sceneExit")).toEqual(await release("dispose"));
  });

  it("should report zero bodies after dispose", async () => {
    const { ctx, plugin } = await setup();
    const body = new RigidBody3D({
      object: new Object3D(),
      physics: ctx.physics,
      shape: CollisionShape3D.box(1, 1, 1),
    });

    expect(ctx.physics.numBodies()).toBe(1);
    expect((body.body.raw as RAPIER.RigidBody).isValid()).toBe(true);
    plugin.dispose?.(ctx);
    expect(ctx.physics.numBodies()).toBe(0);
  });

  it("should free one world per setup across ten reload cycles", async () => {
    const worldFree = vi.spyOn(RAPIER.World.prototype, "free");
    const eventQueueFree = vi.spyOn(RAPIER.EventQueue.prototype, "free");
    for (let cycle = 0; cycle < 10; cycle += 1) {
      const { plugin } = await setup();
      plugin.dispose?.({} as ICtx<Record<string, unknown>, IPhysicsContext>);
    }

    expect(worldFree).toHaveBeenCalledTimes(10);
    expect(eventQueueFree).toHaveBeenCalledTimes(10);
  });
});
