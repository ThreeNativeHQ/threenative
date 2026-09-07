// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { MeshStandardMaterial } from "three";
import { palette } from "./palette.js";

export const floorMaterial = new MeshStandardMaterial({
  color: palette.floor,
  roughness: 0.78,
  metalness: 0.12,
});

/** The player's visor and boots: the one warm note against a cool morning. */
export const accentMaterial = new MeshStandardMaterial({
  color: palette.accent,
  roughness: 0.6,
  metalness: 0.05,
});

export const defaultMaterial = new MeshStandardMaterial({
  color: palette.player,
  roughness: 0.52,
  metalness: 0.08,
});
