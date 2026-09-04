// Ordinary Three.js. Every surface in the game picks a material from here so a
// colour change lands everywhere at once. Toy-bright means low metalness and a
// mid roughness: a specular hotspot on a rounded box is what makes it read as
// painted plastic rather than as a flat swatch.
import { MeshStandardMaterial } from "three";
import { palette, tints } from "./palette.js";

function toy(color: number, roughness = 0.62): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

export type Materials = ReturnType<typeof createMaterials>;

export function createMaterials() {
  return {
    grass: toy(palette.grass, 0.72),
    grassDark: toy(tints.grassDark, 0.78),
    grassLight: toy(tints.grassLight, 0.7),
    rock: toy(palette.rock, 0.86),
    rockDark: toy(tints.rockDark, 0.88),
    dirt: toy(tints.dirt, 0.9),
    wood: toy(palette.wood, 0.68),
    woodDark: toy(tints.woodDark, 0.7),
    woodLight: toy(tints.woodLight, 0.66),
    rope: toy(tints.rope, 0.85),
    coin: new MeshStandardMaterial({
      color: palette.accent,
      roughness: 0.24,
      metalness: 0.72,
      emissive: palette.accent,
      emissiveIntensity: 0.22,
    }),
    coinCore: new MeshStandardMaterial({
      color: tints.coinCore,
      roughness: 0.2,
      metalness: 0.55,
      emissive: tints.coinCore,
      emissiveIntensity: 0.35,
    }),
    leaf: toy(tints.leaf, 0.74),
    leafLight: toy(tints.leafLight, 0.72),
    trunk: toy(tints.trunk, 0.82),
    cloud: new MeshStandardMaterial({
      color: tints.cloud,
      roughness: 1,
      metalness: 0,
      emissive: 0xdfefff,
      emissiveIntensity: 0.28,
    }),
    fur: toy(tints.fur, 0.58),
    furLight: toy(tints.furLight, 0.6),
    jacket: toy(tints.jacket, 0.55),
    ink: toy(0x2a2118, 0.5),
    white: toy(0xfdfdfd, 0.5),
    capRed: toy(tints.capRed, 0.5),
    cream: toy(tints.cream, 0.62),
    shell: toy(tints.shell, 0.42),
    snail: toy(tints.snail, 0.6),
    petal: toy(tints.petal, 0.6),
    goal: new MeshStandardMaterial({
      color: tints.goal,
      roughness: 0.24,
      metalness: 0.3,
      emissive: tints.goal,
      emissiveIntensity: 0.55,
    }),
  };
}
