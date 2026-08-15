// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { MeshStandardMaterial } from "three";
import { palette } from "./palette.js";

export function createMaterials() {
  return {
    floor: new MeshStandardMaterial({ color: palette.floor, roughness: 0.78, metalness: 0.12 }),
    player: new MeshStandardMaterial({ color: palette.player, roughness: 0.42, metalness: 0.22 }),
    crate: new MeshStandardMaterial({ color: palette.crate, roughness: 0.8, metalness: 0 }),
  };
}
