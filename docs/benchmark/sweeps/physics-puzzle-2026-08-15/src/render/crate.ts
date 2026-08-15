// Ordinary Three.js. ThreeNative does not read this file.
//
// A crate is two geometries sharing one transform: a soft-cornered body, and a
// darker plank layer — a border frame plus a diagonal X on every visible face.
// The X is what separates "a stack of boxes" from "a stack of crates" in a
// screenshot, and it costs one merged geometry built once for all of them.
import { BoxGeometry, type BufferGeometry, Euler, Matrix4, Quaternion } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { roundedBox } from "./shapes.js";

const PROUD = 0.505;
const BAR = 0.13;
const THICK = 0.06;

function bar(width: number, height: number, transform: Matrix4): BufferGeometry {
  const geometry = new BoxGeometry(width, height, THICK);
  geometry.applyMatrix4(transform);
  return geometry;
}

/** The plank layer for one face, authored in the XY plane at +Z, then rotated. */
function facePlanks(rotation: Euler): BufferGeometry[] {
  const orient = new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromEuler(rotation));
  const at = (x: number, y: number, tilt: number): Matrix4 => {
    const local = new Matrix4().makeRotationZ(tilt).setPosition(x, y, PROUD);
    return new Matrix4().multiplyMatrices(orient, local);
  };

  return [
    bar(0.98, BAR, at(0, 0.44, 0)),
    bar(0.98, BAR, at(0, -0.44, 0)),
    bar(BAR, 0.78, at(0.44, 0, 0)),
    bar(BAR, 0.78, at(-0.44, 0, 0)),
    bar(1.14, 0.11, at(0, 0, Math.PI / 4)),
    bar(1.14, 0.11, at(0, 0, -Math.PI / 4)),
  ];
}

let bodyGeometry: BufferGeometry | undefined;
let plankGeometry: BufferGeometry | undefined;

export function crateBody(): BufferGeometry {
  bodyGeometry ??= roundedBox(1, 1, 1, 0.1, 3);
  return bodyGeometry;
}

export function cratePlanks(): BufferGeometry {
  if (plankGeometry !== undefined) return plankGeometry;
  const half = Math.PI / 2;
  const faces = [
    new Euler(0, 0, 0),
    new Euler(0, Math.PI, 0),
    new Euler(0, half, 0),
    new Euler(0, -half, 0),
    new Euler(-half, 0, 0),
    new Euler(half, 0, 0),
  ];
  const parts = faces.flatMap((rotation) => facePlanks(rotation));
  const merged = mergeGeometries(parts, false);
  if (merged === null) throw new Error("Crate plank geometry failed to merge.");
  for (const part of parts) part.dispose();
  plankGeometry = merged;
  return merged;
}
