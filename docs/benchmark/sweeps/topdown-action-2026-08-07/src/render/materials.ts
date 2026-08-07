// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { MeshBasicMaterial, MeshStandardMaterial } from "three";
import { palette } from "./palette.js";

export function createMaterials() {
  return {
    floor: new MeshStandardMaterial({ color: palette.floor, roughness: 0.86, metalness: 0.08 }),
    floorInset: new MeshStandardMaterial({ color: 0x213862, roughness: 0.82, metalness: 0.1 }),
    wall: new MeshStandardMaterial({ color: 0x3c5f94, roughness: 0.68, metalness: 0.14 }),
    cover: new MeshStandardMaterial({ color: 0x29466f, roughness: 0.76, metalness: 0.12 }),
    stripe: new MeshStandardMaterial({ color: 0x5679aa, roughness: 0.68, metalness: 0.16 }),
    player: new MeshStandardMaterial({
      color: palette.player,
      emissive: 0x0d5b70,
      emissiveIntensity: 0.5,
      roughness: 0.38,
      metalness: 0.28,
    }),
    playerDetail: new MeshStandardMaterial({ color: 0x0a2c49, roughness: 0.42, metalness: 0.48 }),
    enemy: new MeshStandardMaterial({
      color: palette.crate,
      emissive: 0x641b2a,
      emissiveIntensity: 0.5,
      roughness: 0.46,
      metalness: 0.2,
    }),
    enemyDetail: new MeshStandardMaterial({ color: 0x5c1d36, roughness: 0.5, metalness: 0.38 }),
    health: new MeshBasicMaterial({ color: palette.crate, toneMapped: false }),
    pickup: new MeshStandardMaterial({
      color: palette.accent,
      emissive: 0x8b4f12,
      emissiveIntensity: 0.7,
      roughness: 0.34,
      metalness: 0.24,
    }),
    pickupDetail: new MeshStandardMaterial({ color: 0xffe1a0, roughness: 0.3, metalness: 0.34 }),
    shot: new MeshBasicMaterial({ color: palette.player, toneMapped: false }),
    shotTrail: new MeshBasicMaterial({ color: 0x9af6ff, transparent: true, opacity: 0.6, toneMapped: false }),
    reticle: new MeshBasicMaterial({ color: palette.accent, transparent: true, opacity: 0.78, toneMapped: false }),
    shadow: new MeshBasicMaterial({ color: 0x070d1d, transparent: true, opacity: 0.32, depthWrite: false }),
  };
}
