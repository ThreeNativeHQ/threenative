import { GroundSnap, normaliseToMetres } from "@threenative/core";
import type { Group } from "three";

export interface IRunnerConventions {
  readonly applyGrounding: (surfaceY: number, dt: number) => void;
  readonly groundSnap: GroundSnap;
  readonly normaliseFactor: number;
}

/**
 * One metre is one metre, and the runner's feet meet the track — including mid-jump.
 *
 * `GroundSnap` takes the surface height as an argument, so a jump is a *surface that moved*
 * rather than an exception to grounding. That is what keeps the landing exact at any frame rate.
 */
export function prepareRunnerConventions(model: Group): IRunnerConventions {
  const normaliseFactor = normaliseToMetres(model, { axis: "height", metres: 1.6 });
  const groundSnap = new GroundSnap(model);
  return {
    applyGrounding: (surfaceY, dt) => groundSnap.apply(model, surfaceY, dt),
    groundSnap,
    normaliseFactor,
  };
}
