import { Group } from "three";
import { palette } from "../render/materials.js";
import { roundedBox } from "../render/shapes.js";

export function createCrate(): Group {
  const crate = new Group();
  crate.add(roundedBox(1.35, 1.35, 1.35, palette.wood, 0.1));
  for (const z of [-0.69, 0.69]) {
    const brace = roundedBox(1.5, 0.13, 0.09, palette.woodLight, 0.03);
    brace.position.z = z;
    brace.rotation.z = Math.PI / 4;
    crate.add(brace);
  }
  return crate;
}
