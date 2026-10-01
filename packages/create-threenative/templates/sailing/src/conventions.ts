import { normaliseToMetres } from "@threenative/core";
import { Box3, type Group } from "three";

export function prepareShipConventions(model: Group): number {
  // 4.6 m stem to transom. At 2.5 the caravel came out smaller than the course buoys beside it,
  // which reads as a toy rather than a passage-making vessel. `ship.glb` carries masts taller than
  // its hull is long, so "longest" measures the rig rather than the waterline length — within a
  // couple of percent of the same 4.6 m, which `measureHull` below reads back rather than assumes.
  return normaliseToMetres(model, { axis: "longest", metres: 4.6 });
}

/** The hull's own footprint, measured after scaling, relative to the model's own origin. */
export interface IHullDimensions {
  readonly halfLength: number;
  readonly halfBeam: number;
  readonly draft: number;
}

/** The named mesh `ship.glb` ships for its hull, isolated from the taller mast/rig geometry. */
const HULL_NODE_NAME = "dutch_ship_medium_hull";

/**
 * Measure the loaded hull rather than assume its size, so the physics body and the visual agree
 * however the source model or its cook settings change. Falls back to the whole model's box when
 * the named node is missing, which only means a less exact footprint, not a crash.
 */
export function measureHull(model: Group): IHullDimensions {
  const hull = model.getObjectByName(HULL_NODE_NAME) ?? model;
  const box = new Box3().setFromObject(hull, true);
  return {
    draft: Math.max(0, -box.min.y),
    halfBeam: Math.max(0, (box.max.x - box.min.x) / 2),
    halfLength: Math.max(0, (box.max.z - box.min.z) / 2),
  };
}
