import { Group, type Object3D } from "three";
import { rockBox } from "./palette.js";

export function platform(
  width: number,
  height: number,
  options: { readonly depth?: number; readonly seed?: number; readonly oneWay?: boolean } = {},
): Object3D {
  const depth = options.depth ?? 6;
  if (options.oneWay === true) {
    const group = new Group();
    const slab = rockBox(width, height, depth, options.seed ?? 1);
    group.add(slab);
    return group;
  }
  return rockBox(width, height, depth, options.seed ?? 1);
}

export function bridge(length: number, depth = 2.6): Object3D {
  const group = new Group();
  for (let index = 0; index < Math.ceil(length); index += 1) {
    const board = rockBox(0.86, 0.32, depth, index + 3);
    board.position.x = index * 0.92;
    group.add(board);
  }
  return group;
}

export function crate(): Object3D {
  return rockBox(0.8, 0.8, 0.8, 23);
}
