// Generated for you: ordinary Three.js materials, owned by this game.
import { MeshStandardMaterial } from "three";
import { palette } from "./palette.js";

export function createMaterials() {
  return {
    arena: new MeshStandardMaterial({ color: palette.arena, metalness: 0.35, roughness: 0.62 }),
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
      emissiveIntensity: 0.7,
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
    shadow: new MeshStandardMaterial({ color: 0x101820, metalness: 0.5, roughness: 0.7 }),
    trim: new MeshStandardMaterial({
      color: palette.accent,
      emissive: palette.accent,
      emissiveIntensity: 0.45,
      metalness: 0.45,
      roughness: 0.28,
    }),
  };
}
