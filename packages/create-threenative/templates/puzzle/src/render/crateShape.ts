// Ordinary Three.js — ThreeNative does not read this file.
//
// A crate is a rounded box with plank braces nailed across each side in an X. Both parts are
// merged into ONE geometry carrying two material groups, so a crate costs two draws instead of
// nine, and forty of them stay affordable while every one is a separately simulated body.
import { BoxGeometry, type BufferGeometry, Matrix4 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { roundedBox } from "./shapes.js";

export const CRATE_SIZE = 0.92;

let cached: BufferGeometry | undefined;

/**
 * Group 0 is the crate body, group 1 is the brace timber. Build a crate with
 * `new Mesh(crateGeometry(), [colour, braceMaterial])`.
 */
export function crateGeometry(): BufferGeometry {
  if (cached !== undefined) return cached;
  const half = CRATE_SIZE / 2;
  const body = roundedBox(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE, 0.075, 3).clone();

  const planks: BufferGeometry[] = [];
  const diagonal = CRATE_SIZE * 1.24;
  // Four side faces and the lid. The underside is never seen and is not paid for.
  const faces: readonly {
    readonly rotation: Matrix4;
    readonly offset: [number, number, number];
  }[] = [
    { offset: [0, 0, half], rotation: new Matrix4() },
    { offset: [0, 0, -half], rotation: new Matrix4().makeRotationY(Math.PI) },
    { offset: [half, 0, 0], rotation: new Matrix4().makeRotationY(Math.PI / 2) },
    { offset: [-half, 0, 0], rotation: new Matrix4().makeRotationY(-Math.PI / 2) },
    { offset: [0, half, 0], rotation: new Matrix4().makeRotationX(-Math.PI / 2) },
  ];
  for (const face of faces) {
    for (const sign of [1, -1]) {
      const plank = new BoxGeometry(diagonal, 0.058, 0.028);
      // `roundedBox` welds away its UVs, and `mergeGeometries` refuses a set of geometries whose
      // attributes do not match exactly — it returns null and logs, which is easy to miss.
      plank.deleteAttribute("uv");
      plank.applyMatrix4(new Matrix4().makeRotationZ((sign * Math.PI) / 4));
      plank.applyMatrix4(new Matrix4().makeTranslation(0, 0, 0.01));
      plank.applyMatrix4(face.rotation);
      plank.applyMatrix4(
        new Matrix4().makeTranslation(face.offset[0], face.offset[1], face.offset[2]),
      );
      planks.push(plank);
    }
    // A rail along the top and bottom of each side face, which is what stops the X reading as a
    // sticker and starts it reading as carpentry.
    for (const edge of [half - 0.1, -half + 0.1]) {
      const rail = new BoxGeometry(CRATE_SIZE * 0.98, 0.062, 0.028);
      rail.deleteAttribute("uv");
      rail.applyMatrix4(new Matrix4().makeTranslation(0, edge, 0.01));
      rail.applyMatrix4(face.rotation);
      rail.applyMatrix4(
        new Matrix4().makeTranslation(face.offset[0], face.offset[1], face.offset[2]),
      );
      planks.push(rail);
    }
  }

  const braces = mergeGeometries(planks, false);
  if (braces === null) throw new Error("Crate braces failed to merge.");
  const merged = mergeGeometries([body, braces], true);
  if (merged === null) throw new Error("Crate geometry failed to merge.");
  cached = merged;
  return merged;
}
