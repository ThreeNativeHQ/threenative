// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { MeshStandardMaterial } from "three";

export function createMaterials() {
  return {
    floor: new MeshStandardMaterial({ color: 0x152a3c, roughness: 0.84, metalness: 0.08 }),
    hub: new MeshStandardMaterial({ color: 0x29465a, roughness: 0.76, metalness: 0.12 }),
    moss: new MeshStandardMaterial({ color: 0x3e6659, roughness: 0.9, metalness: 0.02 }),
    tide: new MeshStandardMaterial({ color: 0x3b566b, roughness: 0.68, metalness: 0.18 }),
    stone: new MeshStandardMaterial({ color: 0x91a7b8, roughness: 0.78, metalness: 0.08 }),
    bark: new MeshStandardMaterial({ color: 0x845d43, roughness: 0.92, metalness: 0 }),
    foliage: new MeshStandardMaterial({ color: 0x24484a, roughness: 0.9, metalness: 0 }),
    gold: new MeshStandardMaterial({ color: 0xc78d51, roughness: 0.68, metalness: 0.08 }),
    coral: new MeshStandardMaterial({ color: 0xa56f68, roughness: 0.72, metalness: 0.05 }),
    player: new MeshStandardMaterial({ color: 0x74e6d4, roughness: 0.38, metalness: 0.2 }),
    playerAccent: new MeshStandardMaterial({ color: 0xffd16e, roughness: 0.42, metalness: 0.14 }),
    glow: new MeshStandardMaterial({
      color: 0x65e3d0,
      emissive: 0x1b8f8c,
      emissiveIntensity: 1.5,
      roughness: 0.3,
      metalness: 0.08,
    }),
    warmGlow: new MeshStandardMaterial({
      color: 0xffc862,
      emissive: 0xa45525,
      emissiveIntensity: 1.2,
      roughness: 0.32,
      metalness: 0.06,
    }),
  };
}
