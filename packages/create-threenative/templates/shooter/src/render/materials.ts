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
    // The weapon is the largest thing on screen in first person, so it gets its own three
    // materials rather than borrowing the arena's. Parkerised steel, moulded polymer, and the
    // lit dot in the sight.
    gunmetal: new MeshStandardMaterial({ color: 0x2b3138, metalness: 0.85, roughness: 0.42 }),
    polymer: new MeshStandardMaterial({ color: 0x1b2129, metalness: 0.08, roughness: 0.72 }),
    glove: new MeshStandardMaterial({ color: 0x2f3a44, metalness: 0.05, roughness: 0.85 }),
    sight: new MeshStandardMaterial({
      color: palette.hostile,
      emissive: palette.hostile,
      emissiveIntensity: 2.4,
      metalness: 0,
      roughness: 1,
    }),
    trim: new MeshStandardMaterial({
      color: palette.accent,
      emissive: palette.accent,
      emissiveIntensity: 0.45,
      metalness: 0.45,
      roughness: 0.28,
    }),
  };
}
