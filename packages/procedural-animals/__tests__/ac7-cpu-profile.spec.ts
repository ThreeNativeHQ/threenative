import { FixedStepLoop, createAfterPhysicsPhase } from "../../core/src/loop.js";
import type { ICtx } from "../../core/src/scene.js";
import "../../physics/src/web.js";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { wolfMotion } from "../../../examples/procedural-animals/src/render/wolf-motion.js";
import { CharacterBody3D } from "../../physics/src/CharacterBody3D.js";
import { CollisionShape3D } from "../../physics/src/CollisionShape3D.js";
import { RigidBody3D } from "../../physics/src/RigidBody3D.js";
import { type IPhysicsContext, rapier } from "../../physics/src/plugin.js";
import { bakeWolf } from "../src/build.js";
import { createAnimalActor } from "../src/follow.js";
import { parseAnimalBake } from "../src/format.js";
import { slopedFloorGround } from "../../../examples/procedural-animals/src/render/course.js";

const material = () => new MeshBasicMaterial();

describe("AC7 temporary CPU profile", () => {
  it("profiles real bake follow/pose/bounds through Rapier", async () => {
    const bake = parseAnimalBake(await bakeWolf({ seed: 7, tier: "crowd" }));
    const plugin = rapier({ gravity: { x: 0, y: 0, z: 0 } });
    const ctx = { physics: undefined } as unknown as ICtx<
      Record<string, unknown>,
      IPhysicsContext
    >;
    await plugin.setup?.(ctx);
    const floorMesh = new Mesh(
      new BoxGeometry(80, 0.2, 80),
      new MeshStandardMaterial({ roughness: 1 }),
    );
    floorMesh.position.set(0, -0.1, 0);
    const floor = new RigidBody3D({
      physics: ctx.physics,
      object: floorMesh,
      shape: CollisionShape3D.fromMesh(floorMesh),
      type: "fixed",
      collisionLayer: 1,
      collisionMask: 0xffff,
    });
    const groundRay = (x: number, z: number) => {
      const hit = ctx.physics.directSpaceState.intersectRay({
        from: { x, y: 10, z },
        to: { x, y: -10, z },
        collisionMask: 1,
      });
      if (!hit) throw new Error("missing Rapier course ground");
      return hit.position.y;
    };
    const ground = slopedFloorGround(floorMesh, groundRay);
    const actors = Array.from({ length: 32 }, (_, index) => {
      const root = new Group();
      root.position.set(((index % 8) - 3.5) * 1.45, 0.2, Math.floor(index / 8) * 2 - 3);
      const body = new CharacterBody3D({
        object: root,
        physics: ctx.physics,
        shape: CollisionShape3D.capsule(0.2, 0.3),
        gravity: 0,
        collisionLayer: 2,
        collisionMask: 5,
      });
      const animal = createAnimalActor(bake, { motion: wolfMotion, material, ground });
      return {
        root,
        body,
        animal,
        previous: root.position.clone(),
        velocity: new Vector3(),
      };
    });
    const phase = createAfterPhysicsPhase();
    const unregister = phase.register((dt) => {
      for (const actor of actors) {
        actor.velocity.copy(actor.root.position).sub(actor.previous).divideScalar(dt);
        actor.animal.follow(
          {
            position: actor.root.position,
            velocity: actor.velocity,
            heading: actor.root.rotation.y,
          },
          dt,
        );
        actor.previous.copy(actor.root.position);
      }
    });
    const loop = new FixedStepLoop({
      requestFrame: () => 0,
      cancelFrame: () => undefined,
      onUpdate: (dt) => {
        for (const [index, actor] of actors.entries()) {
          actor.body.velocity.set((index % 8) * 0.05, 0, (Math.floor(index / 8) - 1.5) * 0.02);
          actor.body.moveAndSlide(dt);
        }
        plugin.update?.(ctx, dt);
      },
      onAfterPhysics: phase.run,
    });
    loop.start(0);
    try {
      loop.advance(300);
      expect(actors[0]?.animal.pose.data.every(Number.isFinite)).toBe(true);
    } finally {
      loop.stop();
      unregister();
      for (const { body, animal } of actors) {
        animal.dispose();
        body.dispose();
      }
      floor.dispose();
      floorMesh.geometry.dispose();
      (floorMesh.material as MeshStandardMaterial).dispose();
      plugin.dispose?.(ctx);
    }
  }, 120000);
});
