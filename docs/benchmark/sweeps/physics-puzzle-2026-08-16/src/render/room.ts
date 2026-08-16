// The vault: a slab floor with seams, four low walls capped in wood, corner
// pillars, four lanterns on the west wall, two banners east, and the goal pad
// sunk into the north-east corner. Pure Three.js; Play.ts turns the returned
// boxes into fixed bodies.
import { BoxGeometry, Group, Mesh, PlaneGeometry } from "three";
import { goalLight, lanternLight } from "./lighting.js";
import type { Materials } from "./materials.js";
import { palette } from "./palette.js";

export const ROOM = {
  width: 17,
  depth: 12.5,
  wallHeight: 2.0,
  wallThickness: 0.7,
  goal: { x: 5.4, z: -3.4, size: 2.5 },
} as const;

export interface IStaticBox {
  readonly size: [number, number, number];
  readonly position: [number, number, number];
}

export interface IRoom {
  readonly group: Group;
  readonly colliders: readonly IStaticBox[];
  readonly goalRing: Mesh;
  readonly goalFill: Mesh;
}

function box(
  materials: Materials,
  key: keyof Materials,
  size: [number, number, number],
  position: [number, number, number],
): Mesh {
  const material = materials[key];
  const mesh = new Mesh(new BoxGeometry(...size), material as never);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createRoom(materials: Materials): IRoom {
  const group = new Group();
  const colliders: IStaticBox[] = [];
  const halfW = ROOM.width / 2;
  const halfD = ROOM.depth / 2;

  const floor = box(materials, "floor", [ROOM.width, 0.6, ROOM.depth], [0, -0.3, 0]);
  floor.castShadow = false;
  group.add(floor);
  colliders.push({ size: [ROOM.width, 0.6, ROOM.depth], position: [0, -0.3, 0] });

  // Seams: darker strips flush with the floor, on a 5.5 x 4 grid. They give the
  // eye a scale reference under the crates the way tiles do in the reference.
  for (let index = -1; index <= 1; index += 1) {
    const across = box(materials, "seam", [ROOM.width, 0.02, 0.09], [0, 0.005, index * 3.1]);
    across.castShadow = false;
    const along = box(materials, "seam", [0.09, 0.02, ROOM.depth], [index * 4.2, 0.005, 0]);
    along.castShadow = false;
    group.add(across, along);
  }

  const wallSpecs: IStaticBox[] = [
    { size: [ROOM.width, ROOM.wallHeight, ROOM.wallThickness], position: [0, ROOM.wallHeight / 2, -halfD] },
    { size: [ROOM.width, ROOM.wallHeight, ROOM.wallThickness], position: [0, ROOM.wallHeight / 2, halfD] },
    { size: [ROOM.wallThickness, ROOM.wallHeight, ROOM.depth], position: [-halfW, ROOM.wallHeight / 2, 0] },
    { size: [ROOM.wallThickness, ROOM.wallHeight, ROOM.depth], position: [halfW, ROOM.wallHeight / 2, 0] },
  ];
  for (const spec of wallSpecs) {
    group.add(box(materials, "wall", spec.size, spec.position));
    // A dark plinth at the foot and a wood cap on top: three bands, like the reference.
    const [sx, , sz] = spec.size;
    const [px, , pz] = spec.position;
    group.add(box(materials, "wallDark", [sx * 1.01, 0.55, sz * 1.02], [px, 0.27, pz]));
    group.add(box(materials, "wood", [sx * 1.02, 0.42, sz * 1.06], [px, ROOM.wallHeight - 0.5, pz]));
    group.add(
      box(materials, "woodDark", [sx * 1.03, 0.16, sz * 1.1], [px, ROOM.wallHeight + 0.08, pz]),
    );
    colliders.push(spec);
  }

  // Corner and mid-wall pillars in wood, each with a diamond boss.
  const pillars: [number, number][] = [
    [-halfW, -halfD],
    [halfW, -halfD],
    [-halfW, halfD],
    [halfW, halfD],
    [-halfW, 0],
    [halfW, 0],
    [0, -halfD],
  ];
  for (const [x, z] of pillars) {
    group.add(box(materials, "wood", [1.15, ROOM.wallHeight + 0.5, 1.15], [x, (ROOM.wallHeight + 0.5) / 2, z]));
    group.add(box(materials, "woodDark", [1.25, 0.3, 1.25], [x, ROOM.wallHeight + 0.6, z]));
    const boss = box(materials, "woodDark", [0.28, 0.28, 1.2], [x, ROOM.wallHeight * 0.55, z]);
    boss.rotation.z = Math.PI / 4;
    group.add(boss);
  }

  // Lanterns on the west wall: a dark casing, a self-lit pane, and the point light.
  for (const z of [-3.4, 1.2]) {
    const bracket = box(materials, "woodDark", [0.5, 0.12, 0.12], [-halfW + 0.5, 2.05, z]);
    const casing = box(materials, "woodDark", [0.42, 0.62, 0.42], [-halfW + 0.85, 1.72, z]);
    const pane = box(materials, "lantern", [0.3, 0.42, 0.3], [-halfW + 0.85, 1.7, z]);
    pane.castShadow = false;
    group.add(bracket, casing, pane, lanternLight(-halfW + 1.2, 1.7, z));
  }

  // Banners on the east wall, near the cold corner.
  for (const z of [-4.6, -0.9]) {
    const banner = new Mesh(new PlaneGeometry(0.75, 1.35), materials.banner);
    banner.position.set(halfW - 0.4, 1.25, z);
    banner.rotation.y = -Math.PI / 2;
    group.add(banner);
    group.add(box(materials, "wood", [0.12, 0.12, 0.95], [halfW - 0.4, 1.96, z]));
  }

  // The goal: a stone kerb, a glowing inlay, and two rings inside it.
  const { x: gx, z: gz, size } = ROOM.goal;
  for (const [ox, oz, sx, sz] of [
    [0, -size / 2, size + 0.6, 0.6],
    [0, size / 2, size + 0.6, 0.6],
    [-size / 2, 0, 0.6, size + 0.6],
    [size / 2, 0, 0.6, size + 0.6],
  ] as const) {
    group.add(box(materials, "wall", [sx, 0.34, sz], [gx + ox, 0.17, gz + oz]));
  }
  const goalFill = box(materials, "goalDim", [size, 0.12, size], [gx, 0.055, gz]);
  goalFill.castShadow = false;
  const goalRing = box(materials, "goal", [size * 0.7, 0.14, size * 0.7], [gx, 0.075, gz]);

  goalRing.castShadow = false;
  const inner = box(materials, "goalDim", [size * 0.52, 0.16, size * 0.52], [gx, 0.09, gz]);

  inner.castShadow = false;
  const core = box(materials, "goal", [size * 0.3, 0.17, size * 0.3], [gx, 0.1, gz]);
  core.castShadow = false;
  group.add(goalFill, goalRing, inner, core, goalLight(gx, 1.6, gz));

  group.traverse((object) => {
    if (object instanceof Mesh) object.receiveShadow = true;
  });
  floor.receiveShadow = true;
  group.name = "vault-room";
  void palette;
  return { group, colliders, goalRing, goalFill };
}
