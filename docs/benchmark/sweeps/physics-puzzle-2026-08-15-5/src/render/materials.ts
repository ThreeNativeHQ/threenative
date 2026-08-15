// Ordinary Three.js. ThreeNative does not read this file.
import { Color, MeshStandardMaterial } from "three";
import { crateColors, palette } from "./palette.js";

/** A darker sibling of a crate colour, used for its planks and corner braces. */
function plankOf(color: number): MeshStandardMaterial {
  const shade = new Color(color).multiplyScalar(0.72);
  return new MeshStandardMaterial({ color: shade, roughness: 0.92, metalness: 0 });
}

export function createMaterials() {
  return {
    floor: new MeshStandardMaterial({ color: palette.floor, roughness: 0.88, metalness: 0.04 }),
    floorDark: new MeshStandardMaterial({
      color: palette.floorDark,
      roughness: 0.9,
      metalness: 0.04,
    }),
    seam: new MeshStandardMaterial({ color: palette.floorSeam, roughness: 0.95, metalness: 0 }),
    stone: new MeshStandardMaterial({ color: palette.stone, roughness: 0.9, metalness: 0.05 }),
    stoneDark: new MeshStandardMaterial({
      color: palette.stoneDark,
      roughness: 0.92,
      metalness: 0.05,
    }),
    plaster: new MeshStandardMaterial({ color: palette.plaster, roughness: 0.95, metalness: 0 }),
    trim: new MeshStandardMaterial({ color: palette.trim, roughness: 0.85, metalness: 0.02 }),
    trimDark: new MeshStandardMaterial({
      color: palette.trimDark,
      roughness: 0.88,
      metalness: 0.02,
    }),
    banner: new MeshStandardMaterial({ color: palette.banner, roughness: 0.85, metalness: 0 }),

    crate: crateColors.map(
      (color) => new MeshStandardMaterial({ color, roughness: 0.82, metalness: 0 }),
    ),
    cratePlank: crateColors.map((color) => plankOf(color)),

    player: new MeshStandardMaterial({ color: palette.player, roughness: 0.55, metalness: 0.05 }),

    // The pass-through crate: see-through, self-lit, and deliberately unlike
    // every solid crate in the room.
    phantom: new MeshStandardMaterial({
      color: palette.phantom,
      emissive: palette.phantom,
      emissiveIntensity: 0.45,
      metalness: 0,
      opacity: 0.34,
      roughness: 0.25,
      transparent: true,
    }),
    phantomEdge: new MeshStandardMaterial({
      color: palette.phantom,
      emissive: palette.phantom,
      emissiveIntensity: 0.9,
      roughness: 0.3,
    }),

    goal: new MeshStandardMaterial({
      color: palette.goal,
      emissive: palette.goal,
      emissiveIntensity: 0.3,
      roughness: 0.3,
    }),
    goalDim: new MeshStandardMaterial({
      color: palette.goal,
      emissive: palette.goal,
      emissiveIntensity: 0.1,
      roughness: 0.4,
    }),
    lantern: new MeshStandardMaterial({
      color: palette.lantern,
      emissive: palette.lantern,
      emissiveIntensity: 1.6,
      roughness: 0.4,
    }),
  };
}

export type Materials = ReturnType<typeof createMaterials>;
