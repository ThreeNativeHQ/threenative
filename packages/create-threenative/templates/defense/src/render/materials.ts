import { MeshStandardMaterial } from "three";
import { palette, toon } from "./palette.js";

export function createMaterials() {
  return {
    accent: toon(palette.accent, 0.42),
    attacker: toon(palette.skyLow, 0.58),
    ground: toon(palette.ground, 0.94),
    route: toon(palette.route, 0.88),
    shadow: new MeshStandardMaterial({ color: palette.shadow, roughness: 1 }),
    tower: toon(palette.accent, 0.56),
  };
}
