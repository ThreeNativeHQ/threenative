// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { MeshStandardMaterial } from "three";

export function createMaterials() {
  return {
    floor: new MeshStandardMaterial({ color: 0x12384a, roughness: 0.78, metalness: 0.12 }),
    player: new MeshStandardMaterial({ color: 0x6fe8ff, roughness: 0.42, metalness: 0.22 }),
    crate: new MeshStandardMaterial({ color: 0xffb86b, roughness: 0.8, metalness: 0 }),
  };
}
