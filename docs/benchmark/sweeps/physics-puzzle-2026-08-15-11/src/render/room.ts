// The vault the puzzle happens in. Pure Three.js: floor plates, four walls with
// a warm stone band above a dark dado, corner pilasters, wall lanterns and the
// goal pad. Physics colliders for the walls are added by the scene, because the
// room only knows where its surfaces are.
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Matrix4,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Materials } from "./materials.js";
import { palette } from "./palette.js";
import { roundedBox } from "./shapes.js";

export const ROOM = {
  halfX: 9.5,
  halfZ: 5.6,
  wallHeight: 4.6,
  wallThickness: 0.8,
  dadoHeight: 2.15,
} as const;

/** Far-right corner, matching the reference's glowing inlay. */
export const GOAL = { x: 6.2, z: -3.4, radius: 1.35 } as const;

function box(
  width: number,
  height: number,
  depth: number,
  material: MeshStandardMaterial,
  x: number,
  y: number,
  z: number,
): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function mergedMesh(parts: BufferGeometry[], material: MeshStandardMaterial): Mesh {
  const merged = mergeGeometries(parts, false);
  if (merged === null) throw new Error("Room geometry failed to merge.");
  merged.computeVertexNormals();
  const mesh = new Mesh(merged, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

function floorPlates(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const cols = 6;
  const rows = 4;
  const plateX = (ROOM.halfX * 2 - 1.6) / cols;
  const plateZ = (ROOM.halfZ * 2 - 1.6) / rows;
  for (let ix = 0; ix < cols; ix += 1) {
    for (let iz = 0; iz < rows; iz += 1) {
      const geometry = new BoxGeometry(plateX - 0.14, 0.06, plateZ - 0.14);
      geometry.applyMatrix4(
        new Matrix4().makeTranslation(
          -ROOM.halfX + 0.8 + plateX * (ix + 0.5),
          0.02,
          -ROOM.halfZ + 0.8 + plateZ * (iz + 0.5),
        ),
      );
      parts.push(geometry);
    }
  }
  return parts;
}

/** A pilaster: dark stone column with the reference's diamond inlays. */
function pilaster(materials: Materials, x: number, z: number, rotation: number): Group {
  const group = new Group();
  const shaft = box(1.1, ROOM.wallHeight, 1.1, materials.stone, 0, ROOM.wallHeight / 2, 0);
  const cap = box(1.34, 0.5, 1.34, materials.stoneCap, 0, ROOM.wallHeight - 0.25, 0);
  const base = box(1.3, 0.5, 1.3, materials.stoneCap, 0, 0.25, 0);
  group.add(shaft, cap, base);
  for (const y of [1.3, 2.9]) {
    const diamond = box(0.34, 0.34, 0.34, materials.stoneCap, 0, y, 0.58);
    diamond.rotation.z = Math.PI / 4;
    group.add(diamond);
  }
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  return group;
}

function lantern(materials: Materials, x: number, y: number, z: number, rotation: number): Group {
  const group = new Group();
  const bracket = box(0.14, 0.14, 0.7, materials.lanternCase, 0, 0.55, -0.35);
  const housing = box(0.46, 0.6, 0.46, materials.lanternCase, 0, 0.1, 0);
  const flame = new Mesh(roundedBox(0.3, 0.4, 0.3, 0.08, 2), materials.lantern);
  flame.position.y = 0.1;
  const roof = box(0.58, 0.12, 0.58, materials.lanternCase, 0, 0.46, 0);
  group.add(bracket, housing, flame, roof);
  const light = new PointLight(palette.lantern, 34, 16, 2);
  light.position.set(0, 0.15, 0.4);
  light.castShadow = false;
  group.add(light);
  group.position.set(x, y, z);
  group.rotation.y = rotation;
  return group;
}

function banner(materials: Materials, x: number, y: number, z: number, rotation: number): Group {
  const group = new Group();
  const rod = box(1.0, 0.11, 0.11, materials.stoneCap, 0, 0, 0);
  const cloth = box(0.72, 1.5, 0.06, materials.banner, 0, -0.78, 0);
  const tail = box(0.72, 0.36, 0.06, materials.banner, 0, -1.6, 0);
  tail.rotation.z = Math.PI / 4;
  tail.scale.set(0.7, 0.7, 1);
  group.add(rod, cloth, tail);
  group.position.set(x, y, z);
  group.rotation.y = rotation;
  return group;
}

/** Four bars laid out as a square outline, so the ring reads as a line of light. */
function ringOutline(size: number, thickness: number): BufferGeometry {
  const half = size / 2 - thickness / 2;
  const parts = [
    new BoxGeometry(size, 0.05, thickness).translate(0, 0, -half),
    new BoxGeometry(size, 0.05, thickness).translate(0, 0, half),
    new BoxGeometry(thickness, 0.05, size - thickness * 2).translate(-half, 0, 0),
    new BoxGeometry(thickness, 0.05, size - thickness * 2).translate(half, 0, 0),
  ];
  const merged = mergeGeometries(parts, false);
  if (merged === null) throw new Error("Goal ring failed to merge.");
  return merged;
}

/** The goal: a stone-framed inlay with concentric glowing rings, as in the reference. */
function goalPad(materials: Materials): Group {
  const group = new Group();
  const frame = box(3.6, 0.3, 3.6, materials.goalStone, 0, 0.15, 0);
  group.add(frame);
  // A dark inlay, then the rings on top of it. A filled glowing plate blows out
  // to a white rectangle the moment bloom touches it.
  const inlay = box(2.9, 0.06, 2.9, materials.goalInlay, 0, 0.3, 0);
  group.add(inlay);
  for (const size of [2.55, 1.75, 0.95]) {
    const ring = new Mesh(ringOutline(size, 0.17), materials.goal);
    ring.position.y = 0.33;
    ring.rotation.y = Math.PI / 4;
    ring.scale.set(0.74, 1, 0.74);
    group.add(ring);
  }
  const light = new PointLight(palette.goal, 14, 10, 2);
  light.position.set(0, 1.4, 0);
  group.add(light);
  group.position.set(GOAL.x, 0, GOAL.z);
  return group;
}

export interface IWallSlab {
  readonly width: number;
  readonly depth: number;
  readonly x: number;
  readonly z: number;
  /** False for the wall between the camera and the floor: it is drawn as a low
   * ledge so nothing the player does happens behind it. The collider is still
   * full height, so crates cannot leave the room over it. */
  readonly tall: boolean;
}

/** Where the scene must put fixed colliders so nothing leaves the room. */
export function wallSlabs(): IWallSlab[] {
  const t = ROOM.wallThickness;
  return [
    { width: ROOM.halfX * 2 + t * 2, depth: t, x: 0, z: -ROOM.halfZ - t / 2, tall: true },
    { width: ROOM.halfX * 2 + t * 2, depth: t, x: 0, z: ROOM.halfZ + t / 2, tall: false },
    { width: t, depth: ROOM.halfZ * 2 + t * 2, x: -ROOM.halfX - t / 2, z: 0, tall: true },
    { width: t, depth: ROOM.halfZ * 2 + t * 2, x: ROOM.halfX + t / 2, z: 0, tall: true },
  ];
}

export function buildRoom(materials: Materials): { root: Object3D; floor: Mesh } {
  const root = new Group();
  root.name = "room";

  const floor = box(ROOM.halfX * 2, 0.6, ROOM.halfZ * 2, materials.floor, 0, -0.3, 0);
  floor.name = "floor";
  root.add(floor, mergedMesh(floorPlates(), materials.floorTile));

  const t = ROOM.wallThickness;
  for (const slab of wallSlabs()) {
    if (!slab.tall) {
      const ledgeWall = box(slab.width, 0.95, slab.depth, materials.wallLower, slab.x, 0.475, slab.z);
      const cap = box(slab.width + 0.12, 0.42, slab.depth + 0.12, materials.trim, slab.x, 1.16, slab.z);
      root.add(ledgeWall, cap);
      continue;
    }
    const dado = box(
      slab.width,
      ROOM.dadoHeight,
      slab.depth,
      materials.wallLower,
      slab.x,
      ROOM.dadoHeight / 2,
      slab.z,
    );
    const band = box(
      slab.width,
      ROOM.wallHeight - ROOM.dadoHeight - 0.5,
      slab.depth,
      materials.wallUpper,
      slab.x,
      (ROOM.wallHeight + ROOM.dadoHeight - 0.5) / 2,
      slab.z,
    );
    // The band is inset, so the dark dado below it reads as a ledge.
    const inset = 0.16;
    band.scale.set(
      slab.depth === t ? 1 : (slab.width - inset) / slab.width,
      1,
      slab.depth === t ? (slab.depth - inset) / slab.depth : 1,
    );
    const rail = box(
      slab.width + 0.12,
      0.5,
      slab.depth + 0.12,
      materials.trim,
      slab.x,
      ROOM.wallHeight - 0.25,
      slab.z,
    );
    const ledge = box(
      slab.width + 0.1,
      0.22,
      slab.depth + 0.1,
      materials.ledge,
      slab.x,
      ROOM.dadoHeight,
      slab.z,
    );
    root.add(dado, band, rail, ledge);
  }

  const corners: [number, number][] = [
    [-ROOM.halfX, -ROOM.halfZ],
    [ROOM.halfX, -ROOM.halfZ],
    [-ROOM.halfX, ROOM.halfZ],
    [ROOM.halfX, ROOM.halfZ],
  ];
  for (const [x, z] of corners) root.add(pilaster(materials, x, z, 0));
  root.add(pilaster(materials, -3.0, -ROOM.halfZ - 0.1, 0));
  root.add(pilaster(materials, 3.6, -ROOM.halfZ - 0.1, 0));
  root.add(pilaster(materials, -ROOM.halfX - 0.1, 1.6, Math.PI / 2));

  root.add(lantern(materials, -ROOM.halfX + 0.55, 3.0, -2.8, Math.PI / 2));
  root.add(lantern(materials, -5.6, 3.0, -ROOM.halfZ + 0.55, 0));
  root.add(banner(materials, ROOM.halfX - 0.5, 3.5, -1.2, -Math.PI / 2));
  root.add(banner(materials, ROOM.halfX - 0.5, 3.5, 2.4, -Math.PI / 2));
  root.add(goalPad(materials));

  return { root, floor };
}
