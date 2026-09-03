import { CollisionShape3D, type PhysicsDirectSpaceState3D } from "@threenative/physics";
import type { Vector3 } from "three";
import { ROUTE_LAYER, TOWER_LAYER } from "../physics.js";

export type PlacementReason = "clear" | "overlap" | "route";

export interface IPlacementResult {
  readonly reason: PlacementReason;
  readonly accepted: boolean;
}

const BUILD_MASK = ROUTE_LAYER | TOWER_LAYER;
const BUILD_HEIGHT = 0.6;

export class Buildable {
  readonly #query: PhysicsDirectSpaceState3D;
  readonly #shape = CollisionShape3D.box(1.55, 1.2, 1.55);
  readonly #placed: Vector3[] = [];

  constructor(query: PhysicsDirectSpaceState3D) {
    this.#query = query;
  }

  validate(position: Vector3): IPlacementResult {
    if (![position.x, position.y, position.z].every(Number.isFinite))
      throw new Error("Buildable position must be finite.");
    const centre = position.clone().setY(BUILD_HEIGHT);
    const hits = this.#query.intersectShape({
      collisionMask: BUILD_MASK,
      maxResults: 32,
      position: centre,
      shape: this.#shape,
    });
    if (hits.some((hit) => hit.entity?.startsWith("route.") === true))
      return { accepted: false, reason: "route" };
    if (
      hits.some((hit) => hit.entity?.startsWith("tower.") === true) ||
      this.#placed.some((placed) => placed.distanceToSquared(position) < 2.2)
    )
      return { accepted: false, reason: "overlap" };
    return { accepted: true, reason: "clear" };
  }

  commit(position: Vector3): void {
    if (!this.validate(position).accepted)
      throw new Error("Buildable.commit requires a position that passed validation.");
    this.#placed.push(position.clone());
  }
}
