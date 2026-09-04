// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { MeshStandardMaterial } from "three";

export function createMaterials() {
  return {
    enemy: new MeshStandardMaterial({ color: 0xf06b74, roughness: 0.55, metalness: 0.12 }),
    floor: new MeshStandardMaterial({ color: 0x12384a, roughness: 0.78, metalness: 0.12 }),
    goal: new MeshStandardMaterial({ color: 0xffd27a, emissive: 0x5b3212, roughness: 0.35 }),
    player: new MeshStandardMaterial({ color: 0x6fe8ff, roughness: 0.42, metalness: 0.22 }),
    wall: new MeshStandardMaterial({ color: 0x7868d9, roughness: 0.65, metalness: 0.08 }),
  };
}
