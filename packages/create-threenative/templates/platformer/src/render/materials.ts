import { MeshStandardMaterial } from "three";
import { palette, toon } from "./palette.js";

export function createMaterials() {
  return {
    accent: toon(palette.accent),
    character: toon(palette.character),
    ground: toon(palette.ground),
    shadow: new MeshStandardMaterial({ color: palette.shadow, roughness: 0.9 }),
  };
}
