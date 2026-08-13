import { MeshStandardMaterial } from "three";
import { palette } from "./palette.js";

export function createMaterials() {
  return {
    accent: new MeshStandardMaterial({
      color: palette.accent,
      emissive: palette.accent,
      emissiveIntensity: 0.34,
      metalness: 0.42,
      roughness: 0.3,
    }),
    enemy: new MeshStandardMaterial({
      color: palette.hostile,
      emissive: palette.hostile,
      emissiveIntensity: 0.38,
      metalness: 0.08,
      roughness: 0.46,
    }),
    player: new MeshStandardMaterial({
      color: palette.player,
      emissive: palette.player,
      emissiveIntensity: 0.2,
      metalness: 0.28,
      roughness: 0.38,
    }),
    stone: new MeshStandardMaterial({
      color: palette.stone,
      metalness: 0.26,
      roughness: 0.72,
    }),
    trim: new MeshStandardMaterial({
      color: palette.accent,
      emissive: palette.accent,
      emissiveIntensity: 0.75,
      metalness: 0.55,
      roughness: 0.24,
    }),
  };
}
