import { type Object3D, Quaternion, Vector3 } from "three";

/**
 * What a rescue can put back on the road.
 *
 * A `VehicleBody3D` respawns with a **yaw**, because a ray-cast chassis has to be re-aimed or it
 * drops in sideways: `teleport(position)` alone is a Godot `RigidBody3D` call, and the car this
 * template drives is a vehicle. The heading therefore goes in with the position.
 */
export interface IRescueTarget {
  readonly body: {
    teleport(position: Pick<Vector3, "x" | "y" | "z">, yaw: number): void;
  };
  readonly mesh: Object3D;
  setHeading?(heading: Vector3): void;
}

export function rescueToLastValid(
  target: IRescueTarget,
  position: Vector3,
  heading: Vector3,
): void {
  const flat = heading.clone().setY(0);
  if (flat.lengthSq() < 0.0001) return;
  flat.normalize();
  target.body.teleport(position, Math.atan2(flat.z, flat.x));
  if (target.setHeading !== undefined) {
    target.setHeading(flat);
    return;
  }
  const rotation = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), flat);
  target.mesh.quaternion.copy(rotation);
}
