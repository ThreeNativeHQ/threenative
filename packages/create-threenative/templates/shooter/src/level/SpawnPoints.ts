import type { Vector3 } from "three";
import type { Target } from "../entities/Target.js";

export class SpawnPoints {
  readonly points: readonly Vector3[];

  constructor(points: readonly Vector3[]) {
    if (points.length === 0) throw new Error("SpawnPoints requires at least one point.");
    this.points = points.map((point) => point.clone());
  }

  furthestFrom(hostiles: readonly Target[]): Vector3 {
    let best = this.points[0] as Vector3;
    let bestDistance = -1;
    for (const point of this.points) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const hostile of hostiles) {
        if (!hostile.alive) continue;
        nearest = Math.min(nearest, point.distanceToSquared(hostile.mesh.position));
      }
      if (nearest > bestDistance) {
        best = point;
        bestDistance = nearest;
      }
    }
    return best.clone();
  }
}
