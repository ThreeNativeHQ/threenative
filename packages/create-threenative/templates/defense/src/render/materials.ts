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
    /** The plate the board sits on, and the terrain around it. */
    /** The terrain the board sits in: cooler and darker than the board itself. */
    terrain: toon(0x2f4a44, 0.96),
    /** Hills on the horizon. */
    distant: toon(0x44636a, 0.98),
    /** Tower and base plating: cool metal against the warm accent. */
    plating: toon(0x5c6f7d, 0.6),
    /** The one hostile colour. */
    hostile: toon(0xd9584f, 0.6),
  };
}
