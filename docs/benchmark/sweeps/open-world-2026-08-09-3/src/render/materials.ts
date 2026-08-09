// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { MeshStandardMaterial } from "three";
import { palette } from "./palette.js";

export function createMaterials() {
  return {
    bark: new MeshStandardMaterial({ color: palette.bark, roughness: 1 }),
    coat: new MeshStandardMaterial({ color: palette.coat, roughness: 0.8 }),
    dark: new MeshStandardMaterial({ color: palette.dark, roughness: 0.95 }),
    grass: new MeshStandardMaterial({ color: palette.grass, roughness: 1, vertexColors: true }),
    grassBlade: new MeshStandardMaterial({ color: palette.grassLight, roughness: 1 }),
    leaf: new MeshStandardMaterial({ color: palette.leaf, roughness: 0.95 }),
    leafLight: new MeshStandardMaterial({ color: palette.leafLight, roughness: 0.95 }),
    path: new MeshStandardMaterial({ color: palette.path, roughness: 1 }),
    rock: new MeshStandardMaterial({ color: palette.rock, roughness: 0.94 }),
    rockLight: new MeshStandardMaterial({ color: palette.rockLight, roughness: 0.92 }),
    skin: new MeshStandardMaterial({ color: palette.skin, roughness: 0.82 }),
  };
}
