import { InstancedBatch } from "@threenative/core";
import { buildStaticColliders } from "@threenative/physics";
import { Group, type Object3D } from "three";
import { floorSlab, floorTile, gantry, ramp, wallSlab } from "./render/shapes.js";

export const ROOM_WIDTH = 22;
export const ROOM_DEPTH = 26;
export const WALL_HEIGHT = 4.4;
export const GANTRY_HEIGHT = 5;
export const GANTRY_SPAN = 5.4;
/** Where the ball starts, and where it has to end up. */
export const BALL_START = { x: -5.5, y: 0.5, z: 7 } as const;
export const GOAL_POSITION = { x: 5.4, y: 0, z: -8.4 } as const;

/**
 * Every mesh the ball can hit and none it cannot.
 *
 * `buildStaticColliders` reads the meshes a game authored and builds fixed trimesh bodies from
 * them, so the room's collision is the room's geometry rather than a second, hand-written list of
 * boxes that drifts from it the first time a wall moves. The predicate is the game's: only meshes
 * this file named `room-*` become colliders, so the floor tiles and the goal ring stay decorative.
 */
export function buildRoom(): Group {
  const room = new Group();
  room.name = "room";
  room.add(floorSlab(ROOM_WIDTH, ROOM_DEPTH));

  const half = { x: ROOM_WIDTH / 2, z: ROOM_DEPTH / 2 };
  for (const [width, depth, x, z] of [
    [ROOM_WIDTH, 0.6, 0, -half.z],
    [ROOM_WIDTH, 0.6, 0, half.z],
    [0.6, ROOM_DEPTH, -half.x, 0],
    [0.6, ROOM_DEPTH, half.x, 0],
  ] as const) {
    const wall = wallSlab(width, WALL_HEIGHT, depth);
    wall.position.set(x, WALL_HEIGHT / 2, z);
    room.add(wall);
  }

  // The lip the ball cannot clear on its own. Everything the player does is in service of
  // getting past this one 0.55m step.
  const lip = ramp(ROOM_WIDTH - 1.2, 0.55, 0.9);
  lip.position.set(0, 0.275, -1.5);
  room.add(lip);

  const frame = gantry(GANTRY_SPAN, GANTRY_HEIGHT);
  frame.position.set(0, 0, 3.2);
  room.add(frame);
  return room;
}

/**
 * The floor's tile grid, as one draw.
 *
 * `InstancedBatch` takes the geometry and the material from the game and places copies as the
 * layout is walked, so the grid never has to be counted first. Two hundred and forty tiles cost
 * one draw call, which is why the room can have a readable floor at all.
 */
export function buildFloorTiles(parent: Object3D, size = 2): void {
  const { geometry, material } = floorTile(size);
  const tiles = new InstancedBatch({ geometry, material });
  const columns = Math.floor((ROOM_WIDTH - 1) / size);
  const rows = Math.floor((ROOM_DEPTH - 1) / size);
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      if ((column + row) % 2 === 1) continue;
      tiles.place({
        position: [
          (column + 0.5) * size - (columns * size) / 2,
          0.03,
          (row + 0.5) * size - (rows * size) / 2,
        ],
      });
    }
  }
  tiles.build({ name: "floor-tiles", parent, receiveShadow: true });
}

export function collideRoom(physics: Parameters<typeof buildStaticColliders>[0], room: Object3D) {
  return buildStaticColliders(physics, room, {
    predicate: (object) => object.name.startsWith("room-"),
  });
}
