import { Vector3 } from "three";

export type ChecklineId = "finish" | "sector-1" | "sector-2";

/**
 * A line drawn across the road, and where the car crossed it.
 *
 * `at` and `forward` describe the line; `across` and `halfWidth` are what stop it being an infinite
 * plane. The sector-2 gate's plane is `x = 117`, and the main straight runs along `x` from 25 to
 * 195, so an unbounded test rejects the main straight for crossing a gate that is three hundred
 * metres away up the circuit. Measured: that one false crossing was the reverse rejection the
 * `reverse` playtest used to read on a car driving forwards.
 *
 * There is no sensor here. `Lap` counts a crossing by sweeping the car's transform between frames,
 * which sees every crossing exactly once, and an `Area3D` reports the same crossing a second time
 * as the car's collider touches the gate's box — most of a metre before the plane. Two mechanisms
 * counting one event is how a clean lap raised a `shortcutReject` at every gate.
 */
export class Checkline {
  readonly at: Vector3;
  readonly forward: Vector3;
  /** The direction across the road, so a crossing is only a crossing where the line is drawn. */
  readonly across: Vector3;
  readonly halfWidth: number;
  readonly id: ChecklineId;

  constructor(id: ChecklineId, at: Vector3, forward: Vector3, halfWidth: number) {
    this.id = id;
    this.at = at.clone();
    this.forward = forward.clone().setY(0).normalize();
    this.across = new Vector3(-this.forward.z, 0, this.forward.x);
    this.halfWidth = halfWidth;
  }
}
