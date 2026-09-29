import type { Area3D } from "@threenative/physics";
import { Vector3 } from "three";

export type ChecklineId = "finish" | "sector-1" | "sector-2";

/**
 * An ordered crossing plane used by Lap to reject shortcuts.
 *
 * `at` and `forward` describe the **line across the road**, and `halfWidth` is what stops it being
 * an infinite plane: the sector-2 gate's plane is `x = 117`, and the main straight runs along `x`
 * from 25 to 195, so an unbounded test rejects the main straight for crossing a gate that is three
 * hundred metres away up the circuit. Measured: that one false crossing was the reverse rejection
 * the `reverse` playtest used to read on a car driving forwards.
 */
export class Checkline {
  readonly at: Vector3;
  readonly area: Area3D;
  readonly forward: Vector3;
  /** The direction across the road, so a crossing is only a crossing where the line is drawn. */
  readonly across: Vector3;
  readonly halfWidth: number;
  readonly id: ChecklineId;

  constructor(id: ChecklineId, at: Vector3, forward: Vector3, area: Area3D, halfWidth: number) {
    this.id = id;
    this.at = at.clone();
    this.forward = forward.clone().setY(0).normalize();
    this.across = new Vector3(-this.forward.z, 0, this.forward.x);
    this.area = area;
    this.halfWidth = halfWidth;
  }
}
