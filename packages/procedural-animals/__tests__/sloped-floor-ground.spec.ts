import "../../physics/src/web.js";
import { BoxGeometry, Mesh, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { CollisionShape3D } from "../../physics/src/CollisionShape3D.js";
import { RigidBody3D } from "../../physics/src/RigidBody3D.js";
import { type IPhysicsContext, rapier } from "../../physics/src/plugin.js";
import type { ICtx } from "../../core/src/scene.js";
import { slopedFloorGround } from "../../../examples/procedural-animals/src/render/course.js";

describe("sloped floor ground sampling", () => {
  it("matches the level-mask Rapier ray while avoiding repeated full casts", async () => {
    const plugin = rapier({ gravity: { x: 0, y: 0, z: 0 } });
    const ctx = { physics: undefined } as unknown as ICtx<
      Record<string, unknown>,
      IPhysicsContext
    >;
    await plugin.setup?.(ctx);
    const floor = new Mesh(
      new BoxGeometry(40, 0.5, 40),
      new MeshStandardMaterial({ roughness: 1 }),
    );
    floor.position.set(0, -0.25, -2);
    floor.rotation.z = Math.atan(0.1);
    const body = new RigidBody3D({
      object: floor,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(floor),
      type: "fixed",
      collisionLayer: 1,
      collisionMask: 0xffff,
    });
    const groundRay = (x: number, z: number) => {
      const hit = ctx.physics.directSpaceState.intersectRay({
        from: { x, y: 50, z },
        to: { x, y: -50, z },
        collisionMask: 1,
      });
      if (!hit) throw new Error("missing ground");
      return hit.position.y;
    };
    const ground = slopedFloorGround(floor, groundRay);
    try {
      for (const [x, z] of [
        [0, -2],
        [-5, 0],
        [8, 6],
        [-12, -8],
      ] as const) {
        expect(ground(x, z)).toBeCloseTo(groundRay(x, z), 5);
      }
      expect(() => ground(30, 30)).toThrow("missing ground");
    } finally {
      body.dispose();
      plugin.dispose?.(ctx);
    }
  });
});
