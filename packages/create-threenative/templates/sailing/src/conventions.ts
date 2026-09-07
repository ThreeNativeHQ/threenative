import { normaliseToMetres } from "@threenative/core";
import type { Group } from "three";

export function prepareShipConventions(model: Group): number {
  // 4.6 m stem to transom. At 2.5 the caravel came out smaller than the course buoys beside it,
  // which reads as a toy rather than a passage-making vessel.
  return normaliseToMetres(model, { axis: "longest", metres: 4.6 });
}
