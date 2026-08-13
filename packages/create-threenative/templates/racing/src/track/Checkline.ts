import type { Area3D } from "@threenative/physics";
import type { Vector3 } from "three";

export type ChecklineId = "finish" | "mid";

/** An ordered crossing plane used by Lap to reject shortcuts. */
export class Checkline {
  readonly at: Vector3;
  readonly area: Area3D;
  readonly forward: Vector3;
  readonly id: ChecklineId;

  constructor(id: ChecklineId, at: Vector3, forward: Vector3, area: Area3D) {
    this.id = id;
    this.at = at.clone();
    this.forward = forward.clone().setY(0).normalize();
    this.area = area;
  }
}
