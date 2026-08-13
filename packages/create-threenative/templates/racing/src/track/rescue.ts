import { type Object3D, Quaternion, Vector3 } from "three";

export interface IRescueTarget {
  readonly body: { teleport(position: Pick<Vector3, "x" | "y" | "z">): void };
  readonly mesh: Object3D;
  setHeading?(heading: Vector3): void;
}

export function rescueToLastValid(
  target: IRescueTarget,
  position: Vector3,
  heading: Vector3,
): void {
  target.body.teleport(position);
  if (target.setHeading !== undefined) {
    target.setHeading(heading);
    return;
  }
  const rotation = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), heading);
  target.mesh.quaternion.copy(rotation);
}
