import * as RAPIER from "@dimforge/rapier3d-compat";
import type { ICtx } from "@threenative/core";
import { Mesh } from "three";
import { afterEach, describe, expect, it } from "vitest";
import "../src/index.js";
import { CollisionShape3D } from "../src/CollisionShape3D.js";
import { RigidBody3D } from "../src/RigidBody3D.js";
import { type IPhysicsContext, rapier } from "../src/plugin.js";

const plugins: Array<ReturnType<typeof rapier>> = [];

afterEach(() => {
  for (const plugin of plugins.splice(0))
    plugin.dispose?.({} as ICtx<Record<string, unknown>, IPhysicsContext>);
});

describe("plugin render buffer vs simulation body count", () => {
  it("keeps updating when bodies exist outside plugin registration", async () => {
    await RAPIER.init();
    const plugin = rapier({ gravity: { x: 0, y: 0, z: 0 } });
    const ctx = { physics: undefined } as unknown as ICtx<Record<string, unknown>, IPhysicsContext>;
    await plugin.setup?.(ctx);
    plugins.push(plugin);

    // Registered bodies size the plugin's bulk transform buffer to exactly this registry.
    const registered: RigidBody3D[] = [];
    for (let index = 0; index < 24; index += 1) {
      const mesh = new Mesh();
      mesh.position.set(index * 2, 0, 0);
      registered.push(
        new RigidBody3D({
          object: mesh,
          physics: ctx.physics,
          shape: CollisionShape3D.sphere(0.5),
          type: "fixed",
        }),
      );
    }
    // One body through the deprecated raw-world path: the simulation owns it, the plugin
    // does not know about it. The pipeline must still update instead of throwing a
    // buffer-sized error every frame from inside the physics step.
    const stray = new RigidBody3D({
      position: { x: 0, y: 5, z: 0 },
      shape: CollisionShape3D.sphere(0.5),
      type: "fixed",
      world: ctx.physics.world,
    });

    expect(() => plugin.update?.(ctx, 1 / 60)).not.toThrow();

    for (const body of registered) body.dispose();
    stray.dispose();
  });

  it("keeps updating when raw simulation bodies outnumber the plugin registry", async () => {
    await RAPIER.init();
    const plugin = rapier({ gravity: { x: 0, y: 0, z: 0 } });
    const ctx = { physics: undefined } as unknown as ICtx<Record<string, unknown>, IPhysicsContext>;
    await plugin.setup?.(ctx);
    plugins.push(plugin);

    const body = {
      mass: 0,
      position: { x: 0, y: 0, z: 0 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      sensor: false,
      shape: {
        collisionLayer: 1,
        collisionMask: 65535,
        kind: "box" as const,
        sensor: false,
        x: 1,
        y: 1,
        z: 1,
      },
      type: "fixed" as const,
    };
    for (let index = 0; index < 17; index += 1) {
      ctx.physics.simulation.createBody({
        ...body,
        position: { x: index * 2, y: 0, z: 0 },
      });
    }

    expect(() => plugin.update?.(ctx, 1 / 60)).not.toThrow();
  });
});
