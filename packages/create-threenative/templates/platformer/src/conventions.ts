import { GroundSnap, normaliseToMetres } from "@threenative/core";
import type { Group } from "three";

export interface IPlatformerConventions {
  readonly applyGrounding: (surfaceY: number, dt: number) => void;
  readonly groundSnap: GroundSnap;
  readonly normaliseFactor: number;
}

export function prepareCharacterConventions(model: Group): IPlatformerConventions {
  const normaliseFactor = normaliseToMetres(model, { axis: "height", metres: 1.8 });
  const groundSnap = new GroundSnap(model);
  return {
    applyGrounding: (surfaceY, dt) => groundSnap.apply(model, surfaceY, dt),
    groundSnap,
    normaliseFactor,
  };
}
