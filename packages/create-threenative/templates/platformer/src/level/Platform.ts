import { CollisionShape3D, type PhysicsContext, RigidBody3D } from "@threenative/physics";
import type { Object3D, Vector3 } from "three";
import { platform as platformMesh } from "../render/terrain.js";
import type { GameCtx } from "../scenes/Level.js";

/** Membership bit used by one-way platforms. CharacterBody3D consumes the bit. */
export const ONE_WAY_GROUP = 2;

export interface PlatformNode {
  readonly body: RigidBody3D;
  readonly visual: Object3D;
  dispose(): void;
}

export function createPlatform(
  ctx: GameCtx,
  at: Vector3,
  width: number,
  options: { readonly depth?: number; readonly oneWay?: boolean; readonly seed?: number } = {},
): PlatformNode {
  const depth = options.depth ?? 6;
  const height = 0.4;
  const visual = platformMesh(width, height, { depth, oneWay: options.oneWay, seed: options.seed });
  visual.position.set(at.x, at.y - height / 2, at.z);
  ctx.add(visual);
  const body = new RigidBody3D({
    object: visual,
    physics: ctx.physics,
    shape: CollisionShape3D.box(width, height, depth),
    type: "fixed",
  });
  if (options.oneWay === true) body.collider.setCollisionGroups((ONE_WAY_GROUP << 16) | 0xffff);
  return {
    body,
    dispose: () => {
      body.dispose();
      visual.removeFromParent();
    },
    visual,
  };
}
