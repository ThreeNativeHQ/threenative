import { MeshStandardMaterial } from "three";
import { palette, surface } from "./palette.js";

export function createMaterials() {
  return {
    // The obstacle is the only emissive thing in the scene. At speed the player has one glance to
    // read the lane, and a matte block on a dark track does not survive that glance.
    obstacle: new MeshStandardMaterial({
      color: palette.accent,
      emissive: palette.accent,
      // Low, and it was not the first number tried. At 0.75 with the bloom stage on, every
      // obstacle came back a white blob with no readable face — the accent needs to *glow*, not
      // to clip. This reads as lit at speed and still has geometry inside it.
      emissiveIntensity: 0.28,
      metalness: 0.1,
      roughness: 0.45,
    }),
    rail: surface(palette.rail, 0.62, 0.28),
    // Light and neutral, and mixed here rather than named in the palette, because it is not a
    // sixth role — it is the absence of one. The first version made the runner out of `rail` and
    // gave its fin the accent, so the player and the thing that kills the player were the same
    // colour on a dark track. At speed that is unreadable.
    runner: surface(0xdedae8, 0.32, 0.35),
    shadow: new MeshStandardMaterial({ color: palette.shadow, roughness: 1 }),
    track: surface(palette.track, 0.92),
  };
}
