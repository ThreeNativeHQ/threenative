import { normaliseToMetres } from "@threenative/core";
import type { Group } from "three";

export function prepareShipConventions(model: Group): number {
  return normaliseToMetres(model, { axis: "longest", metres: 2.5 });
}
