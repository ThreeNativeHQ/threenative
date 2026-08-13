import type { PathFollow3D } from "@threenative/core";
import { Vector3 } from "three";
import { type IRescueTarget, rescueToLastValid } from "./rescue.js";

export interface IRayHit {
  readonly distance: number;
  readonly normalY?: number;
}

export type IntersectRay = (
  origin: Vector3,
  direction: Vector3,
  maxDistance: number,
) => IRayHit | undefined;

export type ITrackSectorTarget = IRescueTarget;

export interface ITrackSectorOptions {
  readonly route: PathFollow3D;
  readonly intersectRay: IntersectRay;
  readonly rescueDelay?: number;
  readonly rayHeight?: number;
}

/** Records a grounded transform and returns a racer to it after leaving the road. */
export class TrackSector {
  readonly lastOnRoadPosition = new Vector3();
  readonly lastOnRoadHeading = new Vector3(1, 0, 0);
  currentSector = 0;
  #offRoadTime = 0;
  #hasOnRoadSample = false;
  readonly #route: PathFollow3D;
  readonly #intersectRay: IntersectRay;
  readonly #rescueDelay: number;
  readonly #rayHeight: number;

  constructor(options: ITrackSectorOptions) {
    this.#route = options.route;
    this.#intersectRay = options.intersectRay;
    this.#rescueDelay = options.rescueDelay ?? 0.65;
    this.#rayHeight = options.rayHeight ?? 3;
    if (!(this.#rescueDelay > 0)) throw new Error("TrackSector rescueDelay must be positive.");
  }

  update(position: Vector3, heading: Vector3, dt: number): boolean {
    if (!Number.isFinite(dt) || dt < 0)
      throw new Error("TrackSector.update requires a finite non-negative dt.");
    const origin = position.clone().add(new Vector3(0, this.#rayHeight, 0));
    const hit = this.#intersectRay(origin, new Vector3(0, -1, 0), this.#rayHeight + 2);
    const onRoad = hit !== undefined && hit.distance >= 0 && hit.distance <= this.#rayHeight + 2;
    if (onRoad) {
      this.lastOnRoadPosition.copy(position);
      this.lastOnRoadHeading.copy(heading).setY(0).normalize();
      this.currentSector = this.#route.project(position).segment;
      this.#hasOnRoadSample = true;
      this.#offRoadTime = 0;
      return true;
    }
    this.#offRoadTime += dt;
    return false;
  }

  get offRoadTime(): number {
    return this.#offRoadTime;
  }

  get shouldRescue(): boolean {
    return this.#hasOnRoadSample && this.#offRoadTime >= this.#rescueDelay;
  }

  rescue(target: ITrackSectorTarget): boolean {
    if (!this.shouldRescue) return false;
    rescueToLastValid(target, this.lastOnRoadPosition, this.lastOnRoadHeading);
    this.#offRoadTime = 0;
    return true;
  }
}
