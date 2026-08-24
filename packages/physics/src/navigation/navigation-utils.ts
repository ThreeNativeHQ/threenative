import type { Vector3 as NavigationVector3 } from "recast-navigation";
import type { Vector3 } from "three";

export function finitePositive(owner: string, name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${owner} ${name} must be finite and positive.`);
  return value;
}

export function toNavigationVector(
  value: Pick<Vector3, "x" | "y" | "z">,
  target: NavigationVector3 = { x: 0, y: 0, z: 0 },
): NavigationVector3 {
  target.x = value.x;
  target.y = value.y;
  target.z = value.z;
  return target;
}
