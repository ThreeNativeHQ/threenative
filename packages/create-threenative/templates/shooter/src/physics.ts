import type { CollisionShape3D, IPhysicsBodyHandle, IPhysicsContext } from "@threenative/physics";
import type { Vector3 } from "three";

export type SpacePoint = Pick<Vector3, "x" | "y" | "z">;

export interface IRayHit {
  readonly body: IPhysicsBodyHandle;
  readonly distance: number;
  readonly entity?: string;
  readonly normal: SpacePoint;
  readonly position: SpacePoint;
}

export interface IShapeHit {
  readonly body: IPhysicsBodyHandle;
  readonly entity?: string;
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

type QueryPhysics = IPhysicsContext & {
  readonly directSpaceState: IPhysicsDirectSpaceState;
};

/**
 * PRD-088 is the only route to a collider query. The cast keeps this kit source-compatible with
 * the dependency lane while that public field is being integrated; it is not a fallback query.
 */
export function directSpaceState(physics: IPhysicsContext): IPhysicsDirectSpaceState {
  const state = (physics as QueryPhysics).directSpaceState;
  if (state === undefined) {
    throw new Error("TN_SHOOTER_SPACE_MISSING: @threenative/physics directSpaceState is required.");
  }
  return state;
}
