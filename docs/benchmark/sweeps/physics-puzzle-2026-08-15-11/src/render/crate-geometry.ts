// The crate look. A crate is two meshes sharing one transform: a solid painted
// body, and a raised plank frame with an X brace on all six faces. The frame is
// only ~12% lighter than the body — a high-contrast frame reads as a wireframe
// box, not as wood — and it is chunky and genuinely proud of the surface, so it
// catches the key light along its top edge.
import { BoxGeometry, type BufferGeometry, Matrix4 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { roundedBox } from "./shapes.js";

const RAIL = 0.2;
const PROUD = 0.035;

function plank(width: number, height: number, matrix: Matrix4): BufferGeometry {
  const geometry = new BoxGeometry(width, height, PROUD * 2, 1, 1, 1);
  geometry.deleteAttribute("uv");
  return geometry.applyMatrix4(matrix);
}

/** One face's worth of planks, authored on the +Z face then rotated into place. */
function facePlanks(size: number, face: Matrix4): BufferGeometry[] {
  const half = size / 2;
  const inner = size - RAIL * 2;
  const z = half - PROUD * 0.4;
  const local = new Matrix4();
  const place = (x: number, y: number, rotation = 0): Matrix4 =>
    local.makeRotationZ(rotation).setPosition(x, y, z).premultiply(face);

  const diagonal = Math.SQRT2 * inner * 0.99;
  return [
    plank(size, RAIL, place(0, half - RAIL / 2)),
    plank(size, RAIL, place(0, -half + RAIL / 2)),
    plank(RAIL, inner, place(-half + RAIL / 2, 0)),
    plank(RAIL, inner, place(half - RAIL / 2, 0)),
    plank(diagonal, RAIL * 0.8, place(0, 0, Math.PI / 4)),
    plank(diagonal, RAIL * 0.8, place(0, 0, -Math.PI / 4)),
  ];
}

const FACES: Matrix4[] = [
  new Matrix4(),
  new Matrix4().makeRotationY(Math.PI),
  new Matrix4().makeRotationY(Math.PI / 2),
  new Matrix4().makeRotationY(-Math.PI / 2),
  new Matrix4().makeRotationX(-Math.PI / 2),
  new Matrix4().makeRotationX(Math.PI / 2),
];

let cachedTrim: BufferGeometry | undefined;
let cachedBody: BufferGeometry | undefined;

export function crateTrimGeometry(size = 1): BufferGeometry {
  if (cachedTrim !== undefined) return cachedTrim;
  const parts = FACES.flatMap((face) => facePlanks(size, face));
  const merged = mergeGeometries(parts, false);
  if (merged === null) throw new Error("Crate trim failed to merge.");
  merged.computeVertexNormals();
  cachedTrim = merged;
  return merged;
}

export function crateBodyGeometry(size = 1): BufferGeometry {
  cachedBody ??= roundedBox(size, size, size, 0.055, 2);
  return cachedBody;
}
