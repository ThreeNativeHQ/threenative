import { GroundSnap, normaliseToMetres } from "@threenative/core";
import type { Group } from "three";

export interface IPuzzleConventions {
  readonly applyGrounding: (surfaceY: number, dt: number) => void;
  readonly groundSnap: GroundSnap;
  readonly normaliseFactor: number;
}

/**
 * One metre is one metre, and the claw's feet meet the floor.
 *
 * `normaliseToMetres` returns the factor it applied, and `GroundSnap` reports the clearance it
 * settled on. Both are published through the gripper's `debug()`, so a scenario can prove the
 * conventions ran rather than trusting that they did.
 */
export function prepareGripperConventions(model: Group): IPuzzleConventions {
  const normaliseFactor = normaliseToMetres(model, { axis: "height", metres: 1.7 });
  const groundSnap = new GroundSnap(model);
  return {
    applyGrounding: (surfaceY, dt) => groundSnap.apply(model, surfaceY, dt),
    groundSnap,
    normaliseFactor,
  };
}
