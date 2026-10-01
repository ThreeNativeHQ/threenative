import { Vector3 } from "three";

/** Where the road runs, in metres on the ground plane. The reactor waits at the last point. */
export const WAYPOINTS: readonly (readonly [number, number])[] = [
  [-17, -7],
  [-10, -7],
  [-10, 3],
  [-2, 3],
  [-2, -6],
  [6, -6],
  [6, 6],
  [15, 6],
];

export const REACTOR = new Vector3(15.5, 0, 6);

/** The sixteen places a tower can stand. The road is the level design; these are its answers. */
export const PADS: readonly (readonly [number, number])[] = [
  [-12, -3],
  [-7, -5],
  [-7, 0],
  [-12, 5],
  [-5, 6],
  [1, 1],
  [1, -3],
  [2, -9],
  [9, -7],
  [9, -2],
  [3, 5],
  [9, 9],
  [12, 2],
  [-1, 8],
  [-15, 1],
  [-5, -9],
];

/** The pad the game starts with a free Sentry on. */
export const STARTING_PAD = 2;

/**
 * Pads ranked by how much road each covers, best first. The "safe build" key walks this list, so
 * three purchases cover most of the route instead of stacking on one corner.
 */
export const SAFE_PADS: readonly number[] = [2, 6, 0, 5, 1, 7, 9, 4, 11, 10];

const CORNER_RADIUS = 1.15;
const CORNER_SAMPLES = 10;

/**
 * The road as a polyline with each corner cut into a short curve, so an enemy turns instead of
 * pivoting. Fed to `PathFollow3D`, which is the single source of truth for where the road is: the
 * ribbon on the ground is drawn from the same curve the enemies walk.
 */
export function roundedRoute(): Vector3[] {
  const points: Vector3[] = [];
  const corners = WAYPOINTS.map(([x, z]) => new Vector3(x, 0, z));
  const first = corners[0];
  const last = corners.at(-1);
  if (first === undefined || last === undefined) throw new Error("The route needs waypoints.");
  points.push(first.clone());
  for (let index = 1; index < corners.length - 1; index += 1) {
    const before = corners[index - 1];
    const corner = corners[index];
    const after = corners[index + 1];
    if (before === undefined || corner === undefined || after === undefined) continue;
    const toBefore = before.clone().sub(corner);
    const toAfter = after.clone().sub(corner);
    const radius = Math.min(CORNER_RADIUS, toBefore.length() * 0.4, toAfter.length() * 0.4);
    const start = corner.clone().addScaledVector(toBefore.normalize(), radius);
    const end = corner.clone().addScaledVector(toAfter.normalize(), radius);
    for (let step = 0; step <= CORNER_SAMPLES; step += 1) {
      const t = step / CORNER_SAMPLES;
      points.push(
        new Vector3(
          (1 - t) * (1 - t) * start.x + 2 * (1 - t) * t * corner.x + t * t * end.x,
          0,
          (1 - t) * (1 - t) * start.z + 2 * (1 - t) * t * corner.z + t * t * end.z,
        ),
      );
    }
  }
  points.push(last.clone());
  return points;
}
