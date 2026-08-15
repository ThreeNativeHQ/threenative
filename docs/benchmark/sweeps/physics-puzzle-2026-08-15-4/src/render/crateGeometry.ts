// One shared brace cage, merged once and reused by every crate: 12 edge battens
// plus an X across each of the five visible faces. Two meshes per crate keeps
// forty boxes on screen without forty draw-call groups of loose planks.
import { BoxGeometry, type BufferGeometry, Matrix4, Euler, Quaternion, Vector3 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const SIZE = 1;
const BATTEN = 0.05;

function put(
  parts: BufferGeometry[],
  geometry: BufferGeometry,
  position: [number, number, number],
  rotation?: [number, number, number],
): void {
  const matrix = new Matrix4().compose(
    new Vector3(...position),
    new Quaternion().setFromEuler(new Euler(...(rotation ?? [0, 0, 0]))),
    new Vector3(1, 1, 1),
  );
  parts.push(geometry.clone().applyMatrix4(matrix));
}

export function crateBraceGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const half = SIZE / 2;
  const long = SIZE + 0.012;
  const bar = new BoxGeometry(long, BATTEN, BATTEN);
  const diagonal = new BoxGeometry(SIZE * 1.33, BATTEN * 0.9, BATTEN * 0.55);

  // Twelve edge battens: four per axis, at the cube's corners.
  for (const y of [-half, half])
    for (const z of [-half, half]) put(parts, bar, [0, y, z]);
  for (const x of [-half, half])
    for (const z of [-half, half]) put(parts, bar, [x, 0, z], [0, Math.PI / 2, Math.PI / 2]);
  for (const x of [-half, half])
    for (const y of [-half, half]) put(parts, bar, [x, y, 0], [0, Math.PI / 2, 0]);

  // An X on +Z/-Z, +X/-X and the lid. The reference crates have a single
  // diagonal on some faces, so alternate: two bars front and back, one on the sides.
  const face = half + 0.008;
  for (const z of [face, -face]) {
    put(parts, diagonal, [0, 0, z], [0, 0, Math.PI / 4]);
    put(parts, diagonal, [0, 0, z], [0, 0, -Math.PI / 4]);
  }
  for (const x of [face, -face]) {
    put(parts, diagonal, [x, 0, 0], [Math.PI / 4, Math.PI / 2, 0]);
    put(parts, diagonal, [x, 0, 0], [-Math.PI / 4, Math.PI / 2, 0]);
  }
  put(parts, diagonal, [0, face, 0], [Math.PI / 2, 0, Math.PI / 4]);
  put(parts, diagonal, [0, face, 0], [Math.PI / 2, 0, -Math.PI / 4]);

  const merged = mergeGeometries(parts, false);
  if (merged === null) throw new Error("Crate brace merge failed.");
  for (const part of parts) part.dispose();
  bar.dispose();
  diagonal.dispose();
  return merged;
}
