import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import type { Vector3 } from "three";
import { platform as platformMesh } from "../render/terrain.js";
import type { GameCtx } from "../scenes/Level.js";

export const ONE_WAY_LAYER = 2;

export function createPlatform(
  ctx: GameCtx,
  at: Vector3,
  width: number,
  options: { readonly depth?: number; readonly oneWay?: boolean; readonly seed?: number } = {},
) {
  const depth = options.depth ?? 6;
  const height = 0.4;
  const visual = platformMesh(width, height, { depth, oneWay: options.oneWay, seed: options.seed });
  visual.position.set(at.x, at.y - height / 2, at.z);
  ctx.add(visual);
  const body = new RigidBody3D({
    collisionLayer: options.oneWay === true ? ONE_WAY_LAYER : undefined,
    object: visual,
    physics: ctx.physics,
    shape: CollisionShape3D.box(width, height, depth),
    type: "fixed",
  });
  return {
    body,
    dispose: () => {
      body.dispose();
      visual.removeFromParent();
    },
    visual,
  };
}
