// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { MeshStandardMaterial } from "three";

export function createMaterials() {
  return {
    floor: new MeshStandardMaterial({ color: 0x12233b, roughness: 0.82, metalness: 0.12 }),
    floorLine: new MeshStandardMaterial({ color: 0x214267, roughness: 0.72, metalness: 0.2 }),
    wall: new MeshStandardMaterial({ color: 0x263e67, roughness: 0.7, metalness: 0.18 }),
    wallEdge: new MeshStandardMaterial({ color: 0x416da0, roughness: 0.5, metalness: 0.28 }),
    player: new MeshStandardMaterial({
      color: 0x42e8e3,
      emissive: 0x0b6a73,
      emissiveIntensity: 0.7,
      roughness: 0.34,
      metalness: 0.3,
    }),
    playerDark: new MeshStandardMaterial({ color: 0x0d7989, roughness: 0.45, metalness: 0.4 }),
    enemy: new MeshStandardMaterial({
      color: 0xff556d,
      emissive: 0x8e1f3c,
      emissiveIntensity: 0.8,
      roughness: 0.4,
      metalness: 0.16,
    }),
    enemyCore: new MeshStandardMaterial({
      color: 0xffd5a6,
      emissive: 0xff6c39,
      emissiveIntensity: 1.1,
      roughness: 0.3,
      metalness: 0.15,
    }),
    pickup: new MeshStandardMaterial({
      color: 0xffc94f,
      emissive: 0xc76514,
      emissiveIntensity: 0.9,
      roughness: 0.28,
      metalness: 0.24,
    }),
    bolt: new MeshStandardMaterial({
      color: 0xb8ffff,
      emissive: 0x34d8ff,
      emissiveIntensity: 1.9,
      roughness: 0.16,
      metalness: 0.38,
    }),
    crate: new MeshStandardMaterial({ color: 0xffb86b, roughness: 0.8, metalness: 0 }),
  };
}
