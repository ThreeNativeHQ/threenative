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

export interface IRankedRacerScratch {
  id: string;
  lap: number;
  position: Vector3;
  place: number;
  routeProgress: number;
}

const projectionScratch: IPathFollow3DProjection = {
  distanceFromStart: 0,
  lateralDistance: 0,
  point: new Vector3(0, 0, 0),
  segment: 0,
  tangent: new Vector3(0, 0, 1),
};

function compareRankedRacers(left: IRankedRacerScratch, right: IRankedRacerScratch): number {
  return right.routeProgress - left.routeProgress || left.id.localeCompare(right.id);
}

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
  buffer: IRankedRacerScratch[] = [],
): readonly IRankedRacer[] {
  if (buffer.length > racers.length) buffer.length = racers.length;
  for (let index = buffer.length; index < racers.length; index += 1) {
    buffer.push({ id: "", lap: 0, position: projectionScratch.point, place: 0, routeProgress: 0 });
  }
  for (let index = 0; index < racers.length; index += 1) {
    const racer = racers[index];
    if (racer === undefined) throw new Error("Racing racer input is missing.");
    const ranked = buffer[index];
    if (ranked === undefined) throw new Error("Racing ranking buffer slot is missing.");
    ranked.id = racer.id;
    ranked.lap = racer.lap;
    ranked.position = racer.position;
    ranked.routeProgress = routeProgress(route, racer.position, racer.lap, target);
    ranked.place = 0;
  }
  buffer.sort(compareRankedRacers);
  for (let index = 0; index < buffer.length; index += 1) {
    const racer = buffer[index];
    if (racer === undefined) throw new Error("Racing ranked racer is missing.");
    racer.place = index + 1;
  }
  return buffer;
}
