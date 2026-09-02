import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import type { Vector3 } from "three";
import { platform as platformMesh } from "../render/terrain.js";
import type { GameCtx } from "../scenes/Level.js";

export const ONE_WAY_LAYER = 2;

export interface IPlatform {
  readonly body: RigidBody3D;
  readonly contains: (position: Pick<Vector3, "x" | "z">) => boolean;
  readonly surfaceY: number;
  readonly visual: ReturnType<typeof platformMesh>;
  dispose(): void;
}

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
  const center = at.clone();
  return {
    body,
    contains: (position: Pick<Vector3, "x" | "z">) =>
      Math.abs(position.x - center.x) <= width / 2 && Math.abs(position.z - center.z) <= depth / 2,
    dispose: () => {
      body.dispose();
      visual.removeFromParent();
    },
    surfaceY: at.y,
    visual,
  } satisfies IPlatform;
}
