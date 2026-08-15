// Ordinary Three.js. ThreeNative does not read this file.
//
// The vault shell: a dark tiled floor, a low wall of plaster between stone
// rails, corner pillars, lanterns that actually light the room, and the goal
// pad glowing in the far corner.
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Vector3,
} from "three";
import type { Materials } from "./materials.js";
import { palette } from "./palette.js";
import { block, roundedBox } from "./shapes.js";

export const ROOM = { halfX: 9, halfZ: 6.5, wallHeight: 1.9 } as const;

/** Where a pushed crate has to end up. Kept here so the scene and HUD agree. */
export const GOAL = { x: 5.6, z: -3.6, half: 1.35 } as const;

function lantern(materials: Materials, position: Vector3, group: Group): void {
  const housing = block(0.42, 0.62, 0.42, materials.trimDark, { radius: 0.06 });
  housing.position.copy(position);
  const glass = new Mesh(new BoxGeometry(0.26, 0.34, 0.26), materials.lantern);
  glass.position.copy(position);
  const cap = block(0.5, 0.1, 0.5, materials.trim, { radius: 0.03 });
  cap.position.copy(position).add(new Vector3(0, 0.36, 0));
  const light = new PointLight(palette.lantern, 27, 17, 2);
  light.position.copy(position).add(new Vector3(0, 0.1, 0.35));
  light.castShadow = false;
  group.add(housing, glass, cap, light);
}

export function buildRoom(materials: Materials): Group {
  const room = new Group();
  room.name = "vault";

  // Floor, laid as tiles so the seams catch the lantern light like the stone
  // slabs in the reference rather than reading as one flat sheet.
  const tile = 3;
  for (let x = -ROOM.halfX; x < ROOM.halfX; x += tile) {
    for (let z = -ROOM.halfZ; z < ROOM.halfZ; z += tile) {
      const even = (Math.round(x / tile) + Math.round(z / tile)) % 2 === 0;
      const slab = new Mesh(
        roundedBox(tile - 0.08, 0.4, tile - 0.08, 0.05, 2),
        even ? materials.floor : materials.floorDark,
      );
      slab.position.set(x + tile / 2, -0.2, z + tile / 2);
      slab.receiveShadow = true;
      room.add(slab);
    }
  }
  const bed = new Mesh(new PlaneGeometry(ROOM.halfX * 2 + 4, ROOM.halfZ * 2 + 4), materials.seam);
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = -0.02;
  bed.receiveShadow = true;
  room.add(bed);

  // Walls: a stone kerb at the floor, warm plaster above it, a stone rail on top.
  const sides: readonly { readonly length: number; readonly pos: Vector3; readonly yaw: number }[] =
    [
      { length: ROOM.halfX * 2, pos: new Vector3(0, 0, -ROOM.halfZ), yaw: 0 },
      { length: ROOM.halfX * 2, pos: new Vector3(0, 0, ROOM.halfZ), yaw: Math.PI },
      { length: ROOM.halfZ * 2, pos: new Vector3(-ROOM.halfX, 0, 0), yaw: Math.PI / 2 },
      { length: ROOM.halfZ * 2, pos: new Vector3(ROOM.halfX, 0, 0), yaw: -Math.PI / 2 },
    ];
  for (const side of sides) {
    const wall = new Group();
    const kerb = block(side.length, 0.5, 0.7, materials.stone, { radius: 0.06 });
    kerb.position.y = 0.25;
    const plaster = block(side.length, 1.0, 0.5, materials.plaster, { radius: 0.04 });
    plaster.position.set(0, 1.0, 0.08);
    const rail = block(side.length, 0.42, 0.78, materials.trim, { radius: 0.07 });
    rail.position.y = 1.7;
    const railCap = block(side.length, 0.14, 0.86, materials.trimDark, { radius: 0.05 });
    railCap.position.y = 1.95;
    wall.add(kerb, plaster, rail, railCap);
    wall.position.copy(side.pos);
    wall.rotation.y = side.yaw;
    room.add(wall);
  }

  // Corner pillars with the diamond inset the reference repeats along the wall.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pillar = block(1.1, 2.3, 1.1, materials.trim, { radius: 0.08 });
      pillar.position.set(sx * ROOM.halfX, 1.15, sz * ROOM.halfZ);
      const inset = block(0.34, 0.34, 0.34, materials.trimDark, { radius: 0.04 });
      inset.position.set(
        sx * (ROOM.halfX - 0.5),
        1.55,
        sz * (ROOM.halfZ - 0.5) + (sz > 0 ? 0.5 : -0.5),
      );
      inset.rotation.set(0, 0, Math.PI / 4);
      room.add(pillar, inset);
    }
  }

  lantern(materials, new Vector3(-4.2, 1.35, -ROOM.halfZ + 0.42), room);
  lantern(materials, new Vector3(1.4, 1.35, -ROOM.halfZ + 0.42), room);
  lantern(materials, new Vector3(-ROOM.halfX + 0.42, 1.35, 1.6), room);
  lantern(materials, new Vector3(-ROOM.halfX + 0.42, 1.35, -3.4), room);

  // Banners on the cold side of the room, to answer the lanterns opposite.
  for (const z of [-1.2, 2.4]) {
    const banner = new Mesh(new BoxGeometry(0.06, 1.1, 0.5), materials.banner);
    banner.position.set(ROOM.halfX - 0.3, 1.25, z);
    banner.castShadow = false;
    room.add(banner);
  }

  return room;
}

/** The goal: a recessed stone frame around concentric rings of cold light. */
export function buildGoalPad(materials: Materials): {
  readonly group: Group;
  readonly light: PointLight;
  readonly rings: readonly Mesh<never, MeshStandardMaterial>[];
} {
  const group = new Group();
  group.name = "goal-pad";
  const frame = block(GOAL.half * 2 + 0.6, 0.24, GOAL.half * 2 + 0.6, materials.stone, {
    radius: 0.06,
  });
  frame.position.set(GOAL.x, 0.06, GOAL.z);
  frame.receiveShadow = true;
  group.add(frame);

  const rings: Mesh<never, MeshStandardMaterial>[] = [];
  // Concentric frames, brightest at the rim: a filled square this size just
  // reads as a white hole once bloom touches it.
  const bed = new Mesh(new BoxGeometry(GOAL.half * 2, 0.03, GOAL.half * 2), materials.goalDim);
  bed.position.set(GOAL.x, 0.19, GOAL.z);
  group.add(bed);
  for (const [index, size] of [GOAL.half * 2, GOAL.half * 1.3, GOAL.half * 0.66].entries()) {
    const thickness = 0.13;
    const edge = size / 2 - thickness / 2;
    for (const { dx, dz } of [
      { dx: edge, dz: 0 },
      { dx: -edge, dz: 0 },
      { dx: 0, dz: edge },
      { dx: 0, dz: -edge },
    ]) {
      const along = dx === 0 ? size : thickness;
      const across = dx === 0 ? thickness : size - thickness * 2;
      const bar = new Mesh(
        new BoxGeometry(along, 0.035, across),
        materials.goal,
      ) as unknown as Mesh<never, MeshStandardMaterial>;
      bar.position.set(GOAL.x + dx, 0.2 + index * 0.002, GOAL.z + dz);
      group.add(bar);
      rings.push(bar);
    }
  }

  const light = new PointLight(palette.goal, 8, 11, 2);
  light.position.set(GOAL.x, 1.1, GOAL.z);
  group.add(light);
  return { group, light, rings };
}
