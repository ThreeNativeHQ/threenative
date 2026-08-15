// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file. It builds the visible vault; the fixed
// bodies underneath it are created in `scenes/Play.ts`.
import { Group, Mesh, type Object3D } from "three";
import { PARAPET_HEIGHT, ROOM_HALF, WALL_THICKNESS } from "../level/layout.js";
import { LANTERNS } from "./lighting.js";
import type { Materials } from "./materials.js";
import { ball, block, roundedBox, tube } from "./shapes.js";

export function buildRoom(materials: Materials): Object3D {
  const room = new Group();
  room.name = "room";

  const span = ROOM_HALF * 2;
  const floor = new Mesh(roundedBox(span, 0.6, span, 0.08), materials.floor);
  floor.position.y = -0.3;
  floor.receiveShadow = true;
  room.add(floor);

  // Four inlaid tiles, purely so the floor has scale cues under a stack.
  for (const [sx, sz] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const) {
    const inlay = block(5.2, 0.06, 5.2, materials.floorInlay, { castShadow: false, radius: 0.03 });
    inlay.position.set(sx * 3.1, 0.02, sz * 3.1);
    room.add(inlay);
  }

  for (const [index, [nx, nz]] of (
    [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ] as const
  ).entries()) {
    const alongX = nz !== 0;
    const width = alongX ? span + WALL_THICKNESS * 2 : WALL_THICKNESS;
    const depth = alongX ? WALL_THICKNESS : span + WALL_THICKNESS * 2;
    const wall = block(width, PARAPET_HEIGHT, depth, materials.wall, { radius: 0.06 });
    wall.position.set(
      nx * (ROOM_HALF + WALL_THICKNESS / 2),
      PARAPET_HEIGHT / 2,
      nz * (ROOM_HALF + WALL_THICKNESS / 2),
    );
    wall.name = `wall-${index}`;
    room.add(wall);

    // A dark skirting board and a lighter cap rail: the two lines that stop a
    // flat wall reading as a flat wall.
    const skirt = block(width * 0.999, 0.34, depth * 0.999, materials.wallShade, { radius: 0.04 });
    skirt.position.copy(wall.position).setY(0.17);
    room.add(skirt);
    const cap = block(width * 1.01, 0.3, depth * 1.01, materials.trim, { radius: 0.06 });
    cap.position.copy(wall.position).setY(PARAPET_HEIGHT - 0.15);
    room.add(cap);
  }

  for (const [sx, sz] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const) {
    const pillar = block(1.1, PARAPET_HEIGHT + 0.35, 1.1, materials.trim, { radius: 0.08 });
    pillar.position.set(sx * (ROOM_HALF + 0.1), (PARAPET_HEIGHT + 0.35) / 2, sz * (ROOM_HALF + 0.1));
    room.add(pillar);
  }

  for (const lantern of LANTERNS) {
    const bracket = tube(0.05, 0.05, 0.42, materials.trim);
    bracket.position.set(lantern.x, 1.42, lantern.z);
    room.add(bracket);
    const housing = block(0.34, 0.44, 0.34, materials.trim, { radius: 0.05 });
    housing.position.set(lantern.x, 1.07, lantern.z);
    room.add(housing);
    const flame = ball(0.14, materials.lantern, { castShadow: false });
    flame.position.set(lantern.x, 1.07, lantern.z);
    room.add(flame);
  }

  return room;
}
