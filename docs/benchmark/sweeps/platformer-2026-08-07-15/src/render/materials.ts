// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { MeshStandardMaterial } from "three";

export function createMaterials() {
  return {
    cloud: new MeshStandardMaterial({ color: 0xf8fdff, roughness: 0.95 }),
    coin: new MeshStandardMaterial({
      color: 0xffb51b,
      emissive: 0x9a4300,
      emissiveIntensity: 0.35,
      metalness: 0.55,
      roughness: 0.28,
    }),
    coinBright: new MeshStandardMaterial({
      color: 0xffe27a,
      emissive: 0xff8f00,
      emissiveIntensity: 0.45,
      metalness: 0.3,
      roughness: 0.24,
    }),
    dirt: new MeshStandardMaterial({ color: 0x76503d, roughness: 0.94 }),
    dirtDark: new MeshStandardMaterial({ color: 0x4d3540, roughness: 0.98 }),
    eye: new MeshStandardMaterial({ color: 0x1c2630, roughness: 0.3 }),
    flowerPink: new MeshStandardMaterial({ color: 0xff8f9c, roughness: 0.7 }),
    flowerWhite: new MeshStandardMaterial({ color: 0xfff3c5, roughness: 0.74 }),
    grass: new MeshStandardMaterial({ color: 0x64c94f, roughness: 0.88 }),
    grassDark: new MeshStandardMaterial({ color: 0x2c8b4b, roughness: 0.92 }),
    grassLight: new MeshStandardMaterial({ color: 0xa0df5d, roughness: 0.82 }),
    goal: new MeshStandardMaterial({
      color: 0xffdf59,
      emissive: 0xff7800,
      emissiveIntensity: 0.8,
      metalness: 0.45,
      roughness: 0.22,
    }),
    hazard: new MeshStandardMaterial({
      color: 0xe34b3f,
      emissive: 0x68140f,
      emissiveIntensity: 0.3,
      roughness: 0.48,
    }),
    hazardDark: new MeshStandardMaterial({ color: 0x5d2633, roughness: 0.72 }),
    leaf: new MeshStandardMaterial({ color: 0x3a9e50, roughness: 0.95 }),
    leafLight: new MeshStandardMaterial({ color: 0x78ca56, roughness: 0.9 }),
    playerBlue: new MeshStandardMaterial({ color: 0x287ac6, roughness: 0.48, metalness: 0.08 }),
    playerBlueDark: new MeshStandardMaterial({ color: 0x174e91, roughness: 0.6, metalness: 0.06 }),
    playerCream: new MeshStandardMaterial({ color: 0xffe5b0, roughness: 0.7 }),
    playerOrange: new MeshStandardMaterial({
      color: 0xf28b2d,
      emissive: 0x6c2205,
      emissiveIntensity: 0.18,
      roughness: 0.52,
    }),
    playerOrangeLight: new MeshStandardMaterial({ color: 0xffba3f, roughness: 0.5 }),
    stone: new MeshStandardMaterial({ color: 0x637f86, roughness: 0.96 }),
    stoneLight: new MeshStandardMaterial({ color: 0x8da9a0, roughness: 0.92 }),
    trunk: new MeshStandardMaterial({ color: 0x75422d, roughness: 0.95 }),
    trunkLight: new MeshStandardMaterial({ color: 0xb06b38, roughness: 0.9 }),
    water: new MeshStandardMaterial({
      color: 0x54d9f0,
      emissive: 0x0a7eaa,
      emissiveIntensity: 0.42,
      opacity: 0.72,
      roughness: 0.18,
      transparent: true,
    }),
    wood: new MeshStandardMaterial({ color: 0xae6733, roughness: 0.9 }),
    woodDark: new MeshStandardMaterial({ color: 0x6a3d2b, roughness: 0.96 }),
    woodLight: new MeshStandardMaterial({ color: 0xd8954b, roughness: 0.82 }),
  };
}
