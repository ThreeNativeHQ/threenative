// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { Color, MeshStandardMaterial } from "three";
import { palette } from "./palette.js";

export function createMaterials() {
  const stoneColor = new Color(palette.skyHigh).offsetHSL(0, 0.02, -0.04);
  const stoneLightColor = new Color(palette.skyHigh).offsetHSL(0, 0.02, 0.08);
  const foliageColor = new Color(palette.floor).lerp(new Color(palette.player), 0.42);
  const foliageLightColor = new Color(palette.floor).lerp(new Color(palette.player), 0.58);
  const shadowColor = new Color(palette.skyLow).offsetHSL(0, 0.02, 0.02);
  return {
    floor: new MeshStandardMaterial({ color: palette.floor, roughness: 0.84, metalness: 0.08 }),
    floorEdge: new MeshStandardMaterial({ color: stoneColor, roughness: 0.9, metalness: 0.04 }),
    stone: new MeshStandardMaterial({ color: stoneColor, roughness: 0.82, metalness: 0.05 }),
    stoneLight: new MeshStandardMaterial({ color: stoneLightColor, roughness: 0.76, metalness: 0.06 }),
    foliage: new MeshStandardMaterial({ color: foliageColor, roughness: 0.96, metalness: 0 }),
    foliageLight: new MeshStandardMaterial({ color: foliageLightColor, roughness: 0.92, metalness: 0 }),
    player: new MeshStandardMaterial({ color: palette.player, roughness: 0.42, metalness: 0.22 }),
    crate: new MeshStandardMaterial({ color: palette.crate, roughness: 0.8, metalness: 0 }),
    accent: new MeshStandardMaterial({ color: palette.accent, roughness: 0.44, metalness: 0.12 }),
    shadow: new MeshStandardMaterial({ color: shadowColor, roughness: 1, metalness: 0 }),
    glow: new MeshStandardMaterial({
      color: palette.player,
      emissive: palette.player,
      emissiveIntensity: 1.15,
      roughness: 0.28,
      metalness: 0.08,
    }),
    goldGlow: new MeshStandardMaterial({
      color: palette.accent,
      emissive: palette.accent,
      emissiveIntensity: 0.78,
      roughness: 0.32,
      metalness: 0.12,
    }),
  };
}
