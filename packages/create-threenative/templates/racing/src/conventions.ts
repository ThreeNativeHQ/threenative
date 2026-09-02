import { normaliseToMetres } from "@threenative/core";
import type { Group } from "three";

export function prepareVehicleConventions(model: Group): number {
  return normaliseToMetres(model, { axis: "longest", metres: 3 });
}
