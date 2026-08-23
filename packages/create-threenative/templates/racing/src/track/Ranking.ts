import type { IPathFollow3DProjection, PathFollow3D } from "@threenative/core";
import { Vector3 } from "three";

export interface IRacerProgress {
  readonly id: string;
  readonly lap: number;
  readonly position: Vector3;
}

export interface IRankedRacer extends IRacerProgress {
  readonly place: number;
  readonly routeProgress: number;
}

const projectionScratch: IPathFollow3DProjection = {
  distanceFromStart: 0,
  lateralDistance: 0,
  point: new Vector3(),
  segment: 0,
  tangent: new Vector3(),
};

export function routeProgress(
  route: PathFollow3D,
  position: Vector3,
  lap: number,
  target: IPathFollow3DProjection = projectionScratch,
): number {
  if (!Number.isInteger(lap) || lap < 0)
    throw new Error("Racing route lap must be a non-negative integer.");
  return lap * route.totalLength + route.project(position, target).distanceFromStart;
}

export function rankRacers(
  route: PathFollow3D,
  racers: readonly IRacerProgress[],
  target: IPathFollow3DProjection = projectionScratch,
): readonly IRankedRacer[] {
  const ranked = racers
    .map((racer) => ({
      ...racer,
      place: 0,
      routeProgress: routeProgress(route, racer.position, racer.lap, target),
    }))
    .sort(
      (left, right) => right.routeProgress - left.routeProgress || left.id.localeCompare(right.id),
    );
  return ranked.map((racer, index) => ({ ...racer, place: index + 1 }));
}
