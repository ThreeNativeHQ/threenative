import { MeshStandardMaterial } from "three";
import { palette, surface } from "./palette.js";

export function createMaterials() {
  return {
    // Steel is the wall grey read at low roughness and high metalness. A ball that is a different
    // hue from the room reads as a sticker on it; one that is the same grey, polished, reads as
    // a machined part of the same place.
    ball: surface(palette.wall, 0.2, 0.72),
    crate: surface(palette.accent, 0.62),
    floor: surface(palette.floor, 0.95),
    // The goal carries the same accent as the crates and separates from them by being emissive
    // and translucent — a light in the floor rather than a seventh colour in the palette.
    goal: new MeshStandardMaterial({
      color: palette.accent,
      emissive: palette.accent,
      emissiveIntensity: 1.15,
      opacity: 0.55,
      roughness: 0.4,
      transparent: true,
    }),
    shadow: new MeshStandardMaterial({ color: palette.shadow, roughness: 1 }),
    steel: surface(palette.wall, 0.34, 0.55),
    // A half-step above the floor slab, mixed from the two greys the palette already names.
    tile: surface(0x2c3644, 0.93),
    wall: surface(palette.wall, 0.88),
  };
}
