import type { CollisionShape3D, IPhysicsBodyHandle, IPhysicsContext } from "@threenative/physics";
import type { Vector3 } from "three";

export type SpacePoint = Pick<Vector3, "x" | "y" | "z">;

export interface IRayHit {
  readonly body: IPhysicsBodyHandle;
  readonly distance: number;
  readonly normal: SpacePoint;
  readonly position: SpacePoint;
}

export interface IShapeHit {
  readonly body: IPhysicsBodyHandle;
  readonly position?: SpacePoint;
}

export interface IPhysicsDirectSpaceState {
  intersectRay(options: {
    readonly collisionMask?: number;
    readonly from: SpacePoint;
    readonly maxResults?: number;
    readonly to: SpacePoint;
  }): IRayHit | undefined;
  intersectShape(options: {
    readonly collisionMask?: number;
    readonly maxResults?: number;
    readonly position: SpacePoint;
    readonly shape: CollisionShape3D;
  }): readonly IShapeHit[];
}

type QueryPhysics = IPhysicsContext & { readonly directSpaceState: IPhysicsDirectSpaceState };

export function directSpaceState(physics: IPhysicsContext): IPhysicsDirectSpaceState {
  const state = (physics as QueryPhysics).directSpaceState;
  if (state === undefined)
    throw new Error("TN_ACTION_RPG_SPACE_MISSING: directSpaceState is required.");
  return state;
}
