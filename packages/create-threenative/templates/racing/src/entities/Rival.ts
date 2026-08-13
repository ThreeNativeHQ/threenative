import type { PathFollow3D } from "@threenative/core";
import { Group, Vector3 } from "three";
import { createMaterials } from "../render/materials.js";
import { vehicle } from "../render/shapes.js";

export class Rival {
  readonly mesh = new Group();
  readonly travelDirection = new Vector3(1, 0, 0);
  #distance: number;
  #lap = 0;

  constructor(
    private readonly route: PathFollow3D,
    startDistance: number,
  ) {
    this.#distance = startDistance;
    const visual = vehicle(createMaterials());
    visual.scale.setScalar(0.92);
    this.mesh.add(visual);
  }

  update(dt: number): void {
    this.#distance += 7.6 * dt;
    this.#lap = Math.floor(this.#distance / this.route.totalLength);
    const sample = this.route.pointAt(this.#distance);
    this.mesh.position.copy(sample.point).setY(0.48);
    this.travelDirection.copy(sample.tangent);
    this.mesh.rotation.y = Math.atan2(sample.tangent.z, sample.tangent.x);
  }

  get lap(): number {
    return this.#lap;
  }

  get distance(): number {
    return this.#distance;
  }

  debug(): Record<string, unknown> {
    return {
      lap: this.#lap,
      position: this.mesh.position.toArray(),
      routeProgress: this.#distance,
    };
  }
}
