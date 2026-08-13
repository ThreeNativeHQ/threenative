import { type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import type { CollisionShape3D } from "@threenative/physics";
import type { Vector3 } from "three";

export const GROUND_LAYER = 1;
export const ROUTE_LAYER = 2;
export const TOWER_LAYER = 4;
export const ATTACKER_LAYER = 8;

export interface IShapeHit {
  readonly body: unknown;
  readonly entity?: string;
  readonly position?: Vector3;
}

export interface IPhysicsDirectSpaceState {
  intersectShape(options: {
    readonly collisionMask: number;
    readonly maxResults?: number;
    readonly position: Vector3;
    readonly shape: CollisionShape3D;
  }): readonly IShapeHit[];
}

export type DefensePhysics = IPhysicsContext & {
  readonly directSpaceState: IPhysicsDirectSpaceState;
};

export type EntityBodyOptions = ConstructorParameters<typeof RigidBody3D>[0] & {
  readonly entity?: string;
};

export function createEntityBody(options: EntityBodyOptions): RigidBody3D {
  return new RigidBody3D(options as ConstructorParameters<typeof RigidBody3D>[0]);
}

export function directSpaceState(physics: IPhysicsContext): IPhysicsDirectSpaceState {
  const state = (physics as Partial<DefensePhysics>).directSpaceState;
  if (state === undefined) {
    throw new Error("Defense requires PRD-088 directSpaceState.intersectShape.");
  }
  return state;
}
