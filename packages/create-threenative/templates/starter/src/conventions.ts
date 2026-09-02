import { GroundSnap, normaliseToMetres } from "@threenative/core";
import type { Mesh } from "three";

export interface IStarterConventions {
  readonly applyGrounding: (surfaceY: number, dt: number) => void;
  readonly groundSnap: GroundSnap;
  readonly normaliseFactor: number;
}

export function preparePlayerConventions(model: Mesh): IStarterConventions {
  const normaliseFactor = normaliseToMetres(model, { axis: "height", metres: 1.1 });
  const groundSnap = new GroundSnap(model);
  return {
    applyGrounding: (surfaceY, dt) => groundSnap.apply(model, surfaceY, dt),
    groundSnap,
    normaliseFactor,
  };
}
