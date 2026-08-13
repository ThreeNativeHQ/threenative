import { MeshStandardMaterial } from "three";
import { palette, toon } from "./palette.js";

export function createMaterials() {
  return {
    boost: toon(palette.accent, 0.4),
    curb: toon(0xf3f0dc, 0.55),
    field: toon(palette.field, 0.95),
    road: toon(palette.road, 0.9),
    shadow: new MeshStandardMaterial({ color: palette.shadow, roughness: 1 }),
    tire: new MeshStandardMaterial({ color: 0x111820, roughness: 0.92 }),
    vehicle: toon(0xd95050, 0.38),
    glass: new MeshStandardMaterial({ color: 0x9ee7f2, roughness: 0.18, metalness: 0.25 }),
  };
}
