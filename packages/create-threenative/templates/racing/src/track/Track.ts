import { type ICtx, InstancedBatch, PathFollow3D } from "@threenative/core";
import { Area3D, CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import {
  BoxGeometry,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  SphereGeometry,
  Vector3,
} from "three";

/** Reused by the grandstand crowd placement; a fresh axis per seat is pure garbage. */
const UP = new Vector3(0, 1, 0);
import { Boost } from "../kart/boost.js";
import { createMaterials } from "../render/materials.js";
import { palette } from "../render/palette.js";
import { grandstand, hoardingGeometry, treeGeometry, tyreStackGeometry } from "../render/shapes.js";
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

/**
 * One kerb stone, recorded into a shared batch rather than drawn on its own.
 *
 * Every kerb is the same box at a different length and angle, so a unit box scaled per placement
 * draws exactly what a per-segment `BoxGeometry` drew — as one draw for the whole track instead of
 * two per sector. Change `materials.curb` and every kerb changes with it; the batch picks nothing.
 */
function addCurb(
  curbs: InstancedBatch,
  alternate: InstancedBatch,
  a: Vector3,
  b: Vector3,
  side: number,
): void {
  const direction = b.clone().sub(a).setY(0).normalize();
  const normal = new Vector3(-direction.z, 0, direction.x).multiplyScalar(
    side * (TRACK_WIDTH / 2 + 0.28),
  );
  // Both ends are pulled in by half the track width plus the kerb's own offset. Run to the raw
  // route point and the kerbs of two sectors cross at right angles inside the corner; the overlap
  // shows as a bitten-out notch in the middle of the stripe pattern. The square corner blocks that
  // `buildTrack` places take over from here.
  const inset = TRACK_WIDTH / 2 + 0.28;
  const from = a.clone().addScaledVector(direction, inset);
  const length = Math.max(a.distanceTo(b) - inset * 2, 0.6);
  // Kerbing is **striped**, and the stripes are what make a corner readable at speed. One long
  // cream box per sector is what shipped, and the first frame showed a plain white line: correct
  // geometry, no information. Two batches alternating along the sector cost one extra draw for the
  // whole circuit.
  const blocks = Math.max(2, Math.round(length / 1.3));
  const step = length / blocks;
  for (let index = 0; index < blocks; index += 1) {
    const centre = from
      .clone()
      .addScaledVector(direction, step * (index + 0.5))
      .add(normal);
    (index % 2 === 0 ? curbs : alternate).place({
      position: [centre.x, 0.08, centre.z],
      rotation: [0, Math.atan2(direction.z, direction.x), 0],
      scale: [step * 0.98, 0.18, 0.5],
    });
  }
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
  const post = new Mesh(new BoxGeometry(0.28, 3.4, 0.28), material);
  const otherPost = post.clone();
  const top = new Mesh(new BoxGeometry(width + 1.2, 0.34, 0.34), material);
  const banner = new Mesh(new BoxGeometry(width + 0.6, 0.7, 0.08), material);
  post.position.set(-(width / 2 + 0.5), 1.7, 0);
  otherPost.position.set(width / 2 + 0.5, 1.7, 0);
  top.position.y = 3.55;
  banner.position.y = 3.0;
  for (const mesh of [post, otherPost, top, banner]) mesh.castShadow = true;
  group.add(post, otherPost, top, banner);
  group.position.set(at.x, 0, at.z);
  // A gate spans the road, so it is rotated when the road runs along **X**, not along Z. The
  // condition used to be the other way round, which laid both gantries down the racing line: from
  // the chase camera the finish gantry read as a stray yellow post and a bar going nowhere.
  if (Math.abs(forward.x) > Math.abs(forward.z)) group.rotation.y = Math.PI / 2;
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
  // Chevrons, not a slab. A flat yellow rectangle across the road reads as a painting mistake;
  // arrows read as "drive here and go faster" without a word of UI.
  const pad = new Group();
  const base = new Mesh(new BoxGeometry(3.2, 0.04, TRACK_WIDTH - 0.6), materials.carbon);
  base.position.y = 0.005;
  base.receiveShadow = true;
  pad.add(base);
  for (let index = 0; index < 3; index += 1) {
    for (const side of [-1, 1]) {
      const arm = new Mesh(new BoxGeometry(1.5, 0.05, 0.42), materials.boost);
      arm.position.set(-1.0 + index * 1.0, 0.03, side * 0.9);
      arm.rotation.y = side * 0.62;
      arm.receiveShadow = true;
      pad.add(arm);
    }
  }
  pad.position.set(at.x, 0.12, at.z);
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

  // Every kerb is the same box at a different length and angle, so they are gathered into one
  // batch and drawn once instead of twice per sector. The count is not known before the route has
  // been walked, which is exactly what `InstancedBatch` is for — `new InstancedMesh` would need it
  // up front.
  const curbs = new InstancedBatch({
    geometry: new BoxGeometry(1, 1, 1),
    material: materials.curb,
  });
  const curbsAlt = new InstancedBatch({
    geometry: new BoxGeometry(1, 1, 1),
    material: materials.kerbAlt,
  });

  const roadMeshes: Mesh[] = [];
  for (let index = 0; index < ROUTE_POINTS.length; index += 1) {
    const a = ROUTE_POINTS[index];
    const b = ROUTE_POINTS[(index + 1) % ROUTE_POINTS.length];
    if (a === undefined || b === undefined) continue;
    roadMeshes.push(roadSegment(ctx, a, b, materials));
    addCurb(curbs, curbsAlt, a, b, 1);
    addCurb(curbs, curbsAlt, a, b, -1);
  }
  // A square of tarmac at every route point. Two straight sectors meeting at a right angle leave
  // the corner itself unpaved, and the frame showed grass biting into the racing line exactly
  // where the driver is turning.
  for (const point of ROUTE_POINTS) {
    const patch = new Mesh(new BoxGeometry(TRACK_WIDTH, 0.28, TRACK_WIDTH), materials.road);
    patch.position.set(point.x, -0.14, point.z);
    patch.receiveShadow = true;
    ctx.add(patch);
    new RigidBody3D({
      collisionLayer: 2,
      collisionMask: 1,
      object: patch,
      physics: ctx.physics,
      shape: CollisionShape3D.box(TRACK_WIDTH, 0.28, TRACK_WIDTH),
      type: "fixed",
    });
    roadMeshes.push(patch);
  }

  // The outside corner of the kerbing, filling the right angle the two inset runs leave open.
  for (const point of ROUTE_POINTS) {
    for (const [dx, dz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      curbs.place({
        position: [
          point.x + dx * (TRACK_WIDTH / 2 + 0.28),
          0.08,
          point.z + dz * (TRACK_WIDTH / 2 + 0.28),
        ],
        rotation: [0, 0, 0],
        scale: [0.5, 0.18, 0.5],
      });
    }
  }

  const curbMesh = curbs.build({ castShadow: true, name: "track-curbs" });
  if (curbMesh !== undefined) ctx.add(curbMesh);
  const curbAltMesh = curbsAlt.build({ castShadow: true, name: "track-curbs-alt" });
  if (curbAltMesh !== undefined) ctx.add(curbAltMesh);

  const gates = [
    gate(ctx, "mid", new Vector3(18, 0, 0), new Vector3(0, 0, 1), TRACK_WIDTH),
    gate(ctx, "finish", new Vector3(10, 0, -18), new Vector3(1, 0, 0), TRACK_WIDTH),
  ];
  const pad = boostPad(ctx, new Vector3(14, 0, -18), materials);
  dressCircuit(ctx, materials);
  return { boost: pad.boost, boostArea: pad.area, gates, roadMeshes, route: RACING_LINE };
}

/**
 * Everything beside the road.
 *
 * This used to be five thin coloured posts at the route corners, and the first frame showed why
 * that is not enough: past the kerbs the world was one unbroken green plane to the horizon, so a
 * corner arrived with nothing to judge it against and the circuit had no sense of place. Stands,
 * trees, tyre walls and hoardings cost one function and give the driver landmarks.
 *
 * Delete a line here and that piece of furniture is gone; nothing else depends on it.
 */
function dressCircuit(ctx: TrackCtx, materials: ReturnType<typeof createMaterials>): void {
  // Grass run-off inside the kerbs, a shade drier than the outfield, so the two read as two
  // surfaces rather than one flat colour.
  const apron = new Mesh(new BoxGeometry(52, 0.16, 52), materials.runoff);
  apron.position.y = -0.5;
  apron.receiveShadow = true;
  ctx.add(apron);

  // Grandstands, set back past the hoardings. Placed nearer the road they climbed into the chase
  // camera and hid the corner the driver was aiming at.
  const crowd = new InstancedBatch({
    geometry: new CapsuleGeometry(0.16, 0.24, 1, 4),
    material: materials.crowd,
  });
  for (const [x, z, turn, seats] of [
    [2, -34, 0, materials.kerbAlt],
    [-2, 34, Math.PI, materials.hoardingBoard],
  ] as const) {
    const stand = grandstand(materials.structure, seats);
    stand.group.position.set(x, 0, z);
    stand.group.rotation.y = turn;
    ctx.add(stand.group);
    for (const [seatX, seatY, seatZ] of stand.crowd) {
      const turned = new Vector3(seatX, seatY, seatZ).applyAxisAngle(UP, turn);
      crowd.place({ position: [x + turned.x, turned.y, z + turned.z], scale: [1, 1, 1] });
    }
  }
  const crowdMesh = crowd.build({ castShadow: true, name: "grandstand-crowd" });
  if (crowdMesh !== undefined) ctx.add(crowdMesh);

  // Tyre walls on the outside of all four corners, five stacks to an arc.
  const tyres = new InstancedBatch({
    geometry: tyreStackGeometry(3),
    material: materials.tire,
  });
  for (const [cornerX, cornerZ] of [
    [24.5, -24.5],
    [24.5, 24.5],
    [-24.5, 24.5],
    [-24.5, -24.5],
  ] as const) {
    const radius = Math.hypot(cornerX, cornerZ);
    for (let index = 0; index < 5; index += 1) {
      const angle = Math.atan2(cornerZ, cornerX) + (index - 2) * 0.09;
      tyres.place({
        position: [Math.cos(angle) * radius, 0, Math.sin(angle) * radius],
        rotation: [0, angle, 0],
        scale: [1, 1, 1],
      });
    }
  }
  const tyreMesh = tyres.build({ castShadow: true, name: "tyre-walls" });
  if (tyreMesh !== undefined) ctx.add(tyreMesh);

  // Sponsor hoardings around all four straights, turned to **face** the road. Left unrotated they
  // presented their broad faces down the racing line, which from the chase camera looked like
  // blue plates hanging in the air.
  const board = hoardingGeometry(5);
  const frames = new InstancedBatch({ geometry: board.frame, material: materials.structure });
  const boardsA = new InstancedBatch({ geometry: board.board, material: materials.hoardingBoard });
  const boardsB = new InstancedBatch({ geometry: board.board, material: materials.kerbAlt });
  const OUTSIDE = 22.8;
  for (let index = 0; index < 7; index += 1) {
    const along = -18 + index * 6;
    for (const side of [-1, 1] as const) {
      for (const [position, turn, batch] of [
        [
          [along, 0, side * OUTSIDE] as const,
          side < 0 ? Math.PI / 2 : -Math.PI / 2,
          side < 0 ? boardsA : boardsB,
        ],
        [[side * OUTSIDE, 0, along] as const, side < 0 ? Math.PI : 0, side < 0 ? boardsB : boardsA],
      ] as const) {
        const placement = {
          position: [position[0], position[1], position[2]] as [number, number, number],
          rotation: [0, turn, 0] as [number, number, number],
          scale: [1, 1, 1] as [number, number, number],
        };
        frames.place(placement);
        batch.place(placement);
      }
    }
  }
  for (const [batch, name] of [
    [frames, "hoarding-frames"],
    [boardsA, "hoarding-boards-a"],
    [boardsB, "hoarding-boards-b"],
  ] as const) {
    const mesh = batch.build({ castShadow: true, name });
    if (mesh !== undefined) ctx.add(mesh);
  }

  // A treeline outside the circuit. Deterministic placement — a seeded jitter, not Math.random —
  // so two captures of the same build frame the same world.
  const pine = treeGeometry();
  const trunks = new InstancedBatch({ geometry: pine.trunk, material: materials.trunk });
  const canopies = new InstancedBatch({ geometry: pine.canopy, material: materials.canopy });
  let seed = 6132;
  const jitter = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let index = 0; index < 44; index += 1) {
    const angle = (index / 44) * Math.PI * 2 + jitter() * 0.1;
    const distance = 42 + jitter() * 22;
    const scale = 1.4 + jitter() * 1.5;
    const placement = {
      position: [Math.cos(angle) * distance, 0, Math.sin(angle) * distance] as [
        number,
        number,
        number,
      ],
      rotation: [0, jitter() * Math.PI, 0] as [number, number, number],
      scale: [scale, scale, scale] as [number, number, number],
    };
    trunks.place(placement);
    canopies.place(placement);
  }
  for (const [batch, name] of [
    [trunks, "treeline-trunks"],
    [canopies, "treeline-canopies"],
  ] as const) {
    const mesh = batch.build({ castShadow: true, name });
    if (mesh !== undefined) ctx.add(mesh);
  }

  // Distant hills: three low domes past the treeline to give the horizon a shape.
  for (const [x, z, radius] of [
    [-70, -110, 46],
    [90, -120, 58],
    [130, 60, 40],
  ] as const) {
    const hill = new Mesh(new SphereGeometry(radius, 12, 6), materials.distant);
    hill.position.set(x, -radius * 0.72, z);
    ctx.add(hill);
  }
}
