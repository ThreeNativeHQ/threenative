import { type ICtx, PathFollow3D } from "@threenative/core";
import { Area3D, CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from "three";
import { Boost } from "../kart/boost.js";
import { createMaterials } from "../render/materials.js";
import { palette } from "../render/palette.js";
import type { GameState } from "../state.js";
import { Checkline } from "./Checkline.js";
import type { IRayHit, IntersectRay } from "./TrackSector.js";

export type TrackCtx = ICtx<GameState, IPhysicsContext>;

export const TRACK_WIDTH = 7;
export const TOTAL_LAPS = 3;
export const ROUTE_POINTS = [
  new Vector3(10, 0, -18),
  new Vector3(18, 0, -18),
  new Vector3(18, 0, 18),
  new Vector3(-18, 0, 18),
  new Vector3(-18, 0, -18),
] as const;

export const RACING_LINE = new PathFollow3D({ loop: true, points: ROUTE_POINTS });

export interface ITrackBuild {
  readonly boost: Boost;
  readonly boostArea: Area3D;
  readonly gates: readonly Checkline[];
  readonly route: PathFollow3D;
  readonly roadMeshes: readonly Mesh[];
}

function roadSegment(
  ctx: TrackCtx,
  a: Vector3,
  b: Vector3,
  materials: ReturnType<typeof createMaterials>,
): Mesh {
  const midpoint = a.clone().lerp(b, 0.5);
  const length = a.distanceTo(b);
  const road = new Mesh(new BoxGeometry(length, 0.28, TRACK_WIDTH), materials.road);
  road.position.set(midpoint.x, -0.14, midpoint.z);
  road.rotation.y = Math.atan2(b.z - a.z, b.x - a.x);
  road.receiveShadow = true;
  ctx.add(road);
  new RigidBody3D({
    collisionLayer: 2,
    collisionMask: 1,
    object: road,
    physics: ctx.physics,
    shape: CollisionShape3D.box(length, 0.28, TRACK_WIDTH),
    type: "fixed",
  });
  return road;
}

function addCurb(
  ctx: TrackCtx,
  a: Vector3,
  b: Vector3,
  side: number,
  materials: ReturnType<typeof createMaterials>,
): void {
  const direction = b.clone().sub(a).setY(0).normalize();
  const normal = new Vector3(-direction.z, 0, direction.x).multiplyScalar(
    side * (TRACK_WIDTH / 2 + 0.28),
  );
  const midpoint = a.clone().lerp(b, 0.5).add(normal);
  const length = a.distanceTo(b);
  const curb = new Mesh(new BoxGeometry(length, 0.18, 0.42), materials.curb);
  curb.position.set(midpoint.x, 0.08, midpoint.z);
  curb.rotation.y = Math.atan2(direction.z, direction.x);
  curb.castShadow = true;
  ctx.add(curb);
}

function gate(
  ctx: TrackCtx,
  id: Checkline["id"],
  at: Vector3,
  forward: Vector3,
  width: number,
): Checkline {
  const group = new Group();
  const material = new MeshStandardMaterial({
    color: id === "finish" ? palette.accent : palette.skyLow,
    metalness: 0.2,
    roughness: 0.45,
  });
  const post = new Mesh(new BoxGeometry(0.24, 2.5, 0.24), material);
  const otherPost = post.clone();
  const top = new Mesh(new BoxGeometry(width, 0.24, 0.24), material);
  post.position.set(-width / 2, 1.25, 0);
  otherPost.position.set(width / 2, 1.25, 0);
  top.position.y = 2.45;
  group.add(post, otherPost, top);
  group.position.set(at.x, 0, at.z);
  if (Math.abs(forward.z) > Math.abs(forward.x)) group.rotation.y = Math.PI / 2;
  ctx.add(group);
  const area = new Area3D({
    collisionMask: 1,
    entity: `gate.${id}`,
    physics: ctx.physics,
    position: { x: at.x, y: 0.7, z: at.z },
    shape: CollisionShape3D.box(
      Math.abs(forward.z) > Math.abs(forward.x) ? 0.65 : width / 2,
      1.1,
      Math.abs(forward.z) > Math.abs(forward.x) ? width / 2 : 0.65,
    ),
  });
  return new Checkline(id, at, forward, area);
}

function boostPad(
  ctx: TrackCtx,
  at: Vector3,
  materials: ReturnType<typeof createMaterials>,
): { area: Area3D; boost: Boost } {
  const pad = new Mesh(new BoxGeometry(3.2, 0.08, TRACK_WIDTH - 0.6), materials.boost);
  pad.position.set(at.x, 0.12, at.z);
  pad.receiveShadow = true;
  ctx.add(pad);
  const boost = new Boost();
  const area = new Area3D({
    collisionMask: 1,
    entity: "boost-pad",
    physics: ctx.physics,
    position: { x: at.x, y: 0.35, z: at.z },
    shape: CollisionShape3D.box(1.6, 0.45, TRACK_WIDTH / 2),
  });
  return { area, boost };
}

function normalizeRayHit(value: unknown): IRayHit | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const distance = record.distance;
  if (typeof distance !== "number" || !Number.isFinite(distance)) return undefined;
  const normal = record.normal;
  const normalY =
    typeof normal === "object" &&
    normal !== null &&
    typeof (normal as { y?: unknown }).y === "number"
      ? (normal as { y: number }).y
      : undefined;
  return { distance, ...(normalY === undefined ? {} : { normalY }) };
}

type PhysicsQueryPoint = Pick<Vector3, "x" | "y" | "z">;

interface IPhysicsDirectSpaceState {
  intersectRay(options: {
    readonly collisionMask?: number;
    readonly from: PhysicsQueryPoint;
    readonly to: PhysicsQueryPoint;
  }): unknown;
}

type QueryPhysics = IPhysicsContext & {
  readonly directSpaceState: IPhysicsDirectSpaceState;
};

/** Uses PRD-088's optional physics query when installed, with a local visual probe fallback. */
export function intersectRay(physics: IPhysicsContext, fallback: IntersectRay): IntersectRay {
  const directSpaceState = (physics as Partial<QueryPhysics>).directSpaceState;
  if (directSpaceState === undefined) return fallback;
  return (origin, direction, maxDistance) => {
    const to = origin.clone().addScaledVector(direction, maxDistance);
    const result = directSpaceState.intersectRay({
      collisionMask: 2,
      from: origin,
      to,
    });
    return normalizeRayHit(result);
  };
}

export function roadRayProbe(meshes: readonly Mesh[]): IntersectRay {
  const raycaster = new Raycaster();
  return (origin, direction, maxDistance) => {
    raycaster.set(origin, direction);
    const hit = raycaster.intersectObjects([...meshes], false)[0];
    if (hit === undefined || hit.distance > maxDistance) return undefined;
    return { distance: hit.distance, normalY: hit.face?.normal.y };
  };
}

export function buildTrack(ctx: TrackCtx): ITrackBuild {
  const materials = createMaterials();
  const field = new Mesh(new BoxGeometry(100, 0.3, 100), materials.field);
  field.position.y = -0.62;
  field.receiveShadow = true;
  ctx.add(field);
  new RigidBody3D({
    collisionLayer: 4,
    collisionMask: 1,
    object: field,
    physics: ctx.physics,
    shape: CollisionShape3D.box(50, 0.15, 50),
    type: "fixed",
  });

  const roadMeshes: Mesh[] = [];
  for (let index = 0; index < ROUTE_POINTS.length; index += 1) {
    const a = ROUTE_POINTS[index];
    const b = ROUTE_POINTS[(index + 1) % ROUTE_POINTS.length];
    if (a === undefined || b === undefined) continue;
    roadMeshes.push(roadSegment(ctx, a, b, materials));
    addCurb(ctx, a, b, 1, materials);
    addCurb(ctx, a, b, -1, materials);
  }

  const gates = [
    gate(ctx, "mid", new Vector3(18, 0, 0), new Vector3(0, 0, 1), TRACK_WIDTH),
    gate(ctx, "finish", new Vector3(10, 0, -18), new Vector3(1, 0, 0), TRACK_WIDTH),
  ];
  const pad = boostPad(ctx, new Vector3(14, 0, -18), materials);
  for (const [index, point] of ROUTE_POINTS.entries()) {
    const marker = new Mesh(
      new BoxGeometry(0.2, 1.2, 0.2),
      new MeshStandardMaterial({
        color: new Color(index % 2 === 0 ? palette.accent : palette.skyLow),
      }),
    );
    marker.position.set(point.x, 0.6, point.z);
    ctx.add(marker);
  }
  return { boost: pad.boost, boostArea: pad.area, gates, roadMeshes, route: RACING_LINE };
}
