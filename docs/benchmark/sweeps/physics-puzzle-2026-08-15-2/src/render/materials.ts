// Ordinary Three.js. Every colour a screenshot shows is decided here.
import { Color, LineBasicMaterial, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { crateDyes, palette } from "./palette.js";

export function createMaterials() {
  return {
    floor: new MeshStandardMaterial({ color: palette.floor, roughness: 0.92, metalness: 0.04 }),
    seam: new MeshStandardMaterial({ color: palette.floorSeam, roughness: 0.95, metalness: 0 }),
    wall: new MeshStandardMaterial({ color: palette.wall, roughness: 0.95, metalness: 0 }),
    wallDark: new MeshStandardMaterial({ color: palette.wallDark, roughness: 0.95, metalness: 0 }),
    wood: new MeshStandardMaterial({ color: palette.wood, roughness: 0.85, metalness: 0 }),
    woodDark: new MeshStandardMaterial({ color: palette.woodDark, roughness: 0.85, metalness: 0 }),
    brace: new MeshStandardMaterial({ color: palette.brace, roughness: 0.8, metalness: 0 }),
    // Each crate's battens are its own dye, darkened: brown on teal reads as a
    // cage, the same colour one stop down reads as a plank.
    braces: crateDyes.map(
      (color) =>
        new MeshStandardMaterial({
          color: new Color(color).multiplyScalar(0.72),
          roughness: 0.85,
          metalness: 0,
        }),
    ),
    crates: crateDyes.map(
      (color) => new MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.02 }),
    ),
    player: new MeshStandardMaterial({ color: palette.player, roughness: 0.55, metalness: 0.02 }),
    // The pass-through crate reads as a hologram: see-through, self-lit, no shadow.
    ghost: new MeshStandardMaterial({
      color: palette.ghost,
      emissive: palette.ghost,
      emissiveIntensity: 1.1,
      transparent: true,
      opacity: 0.42,
      roughness: 0.2,
      metalness: 0,
    }),
    ghostEdge: new LineBasicMaterial({ color: palette.ghost, transparent: true, opacity: 0.9 }),
    goal: new MeshBasicMaterial({ color: 0x6ff0ff }),
    goalDim: new MeshStandardMaterial({
      color: 0x0a3a4c,
      emissive: 0x0d7f9c,
      emissiveIntensity: 0.35,
      roughness: 0.4,
      metalness: 0,
    }),
    lantern: new MeshBasicMaterial({ color: palette.lantern }),
    banner: new MeshStandardMaterial({
      color: 0x1f5f7a,
      roughness: 0.9,
      metalness: 0,
      side: 2,
    }),
  };
}

export type Materials = ReturnType<typeof createMaterials>;
