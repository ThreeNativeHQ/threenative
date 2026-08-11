// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { MeshStandardMaterial } from "three";
import { palette } from "./palette.js";

export const floorMaterial = new MeshStandardMaterial({
  color: palette.floor,
  roughness: 0.78,
  metalness: 0.12,
});

export const defaultMaterial = new MeshStandardMaterial({
  color: palette.player,
  roughness: 0.52,
  metalness: 0.08,
});
