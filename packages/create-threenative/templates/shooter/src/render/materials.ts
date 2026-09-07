// Generated for you: ordinary Three.js materials, owned by this game.
import { MeshStandardMaterial } from "three";
import { palette } from "./palette.js";

export function createMaterials() {
  return {
    // Matte. At 0.35 metalness the deck became a mirror under the screen-space reflection stage
    // once the walls were shaded correctly, and the arena read as a polished showroom floor.
    arena: new MeshStandardMaterial({ color: palette.arena, metalness: 0.06, roughness: 0.82 }),
    accent: new MeshStandardMaterial({
      color: palette.accent,
      emissive: palette.accent,
      emissiveIntensity: 0.24,
      metalness: 0.2,
      roughness: 0.38,
    }),
    hostile: new MeshStandardMaterial({
      color: palette.hostile,
      emissive: palette.hostile,
      emissiveIntensity: 0.3,
      metalness: 0.1,
      roughness: 0.3,
    }),
    player: new MeshStandardMaterial({
      color: palette.player,
      emissive: palette.player,
      emissiveIntensity: 0.22,
      metalness: 0.35,
      roughness: 0.34,
    }),
    /** The arena's boundary walls and the drones' dark plating. Lifted twice now: at 0x18242f and
     * again at 0x263646 the four walls photographed as one black band straight across the middle
     * of the frame, which is exactly the height the targets stand at. */
    shadow: new MeshStandardMaterial({ color: 0x334659, metalness: 0.1, roughness: 0.8 }),
    // The weapon is the largest thing on screen in first person, so it gets its own three
    // materials rather than borrowing the arena's. Parkerised steel, moulded polymer, and the
    // lit dot in the sight.
    // Light enough to read as a shape against a dark arena. The first pass at 0x2b3138 was
    // physically reasonable and photographed as a black slab.
    // The weapon hangs at the eye, out of reach of the key light, so it carries a little emissive
    // of its own. This is the flat "viewmodel light" every shooter uses, spent as material rather
    // than as a light the rest of the arena would also see.
    gunmetal: new MeshStandardMaterial({
      color: 0x7d8996,
      emissive: 0x2c343d,
      emissiveIntensity: 1,
      metalness: 0.7,
      roughness: 0.42,
    }),
    polymer: new MeshStandardMaterial({
      color: 0x4a5561,
      emissive: 0x1e242b,
      emissiveIntensity: 1,
      metalness: 0.08,
      roughness: 0.66,
    }),
    glove: new MeshStandardMaterial({
      color: 0x6a7986,
      emissive: 0x232b33,
      emissiveIntensity: 1,
      metalness: 0.05,
      roughness: 0.8,
    }),
    /** Inset floor panels: one step off the arena tone, so the deck has a surface rather than a
     * colour. Cheaper and quieter than a painted grid. */
    floorPanel: new MeshStandardMaterial({
      color: 0x2e4257,
      metalness: 0.06,
      roughness: 0.84,
    }),
    /** Waist-high crates and pillars. A mid tone, so a box reads as a box and not as its lit lip. */
    cover: new MeshStandardMaterial({ color: 0x3d5266, metalness: 0.08, roughness: 0.78 }),
    sight: new MeshStandardMaterial({
      color: palette.hostile,
      emissive: palette.hostile,
      emissiveIntensity: 2.4,
      metalness: 0,
      roughness: 1,
    }),
    // Cover edges. Same accent hue as `trim`, a fraction of its emissive: a waist-high crate lit
    // like a HUD element photographs as a glowing platform rather than something to hide behind.
    edge: new MeshStandardMaterial({ color: 0x9a8b55, metalness: 0.35, roughness: 0.6 }),
    trim: new MeshStandardMaterial({
      color: palette.accent,
      emissive: palette.accent,
      emissiveIntensity: 0.45,
      metalness: 0.45,
      roughness: 0.28,
    }),
  };
}
