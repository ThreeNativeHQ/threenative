import { MeshStandardMaterial } from "three";

export function createMaterials() {
  return {
    road: new MeshStandardMaterial({ color: 0x172a3c, roughness: 0.86, metalness: 0.08 }),
    roadEdge: new MeshStandardMaterial({ color: 0x31536a, roughness: 0.72, metalness: 0.1 }),
    lane: new MeshStandardMaterial({ color: 0xffd66e, roughness: 0.56, metalness: 0.12 }),
    player: new MeshStandardMaterial({ color: 0xff5b62, roughness: 0.4, metalness: 0.08 }),
    playerTop: new MeshStandardMaterial({ color: 0xff8a62, roughness: 0.34, metalness: 0.1 }),
    hazard: new MeshStandardMaterial({ color: 0xff5c50, roughness: 0.58, metalness: 0.05 }),
    hazardDark: new MeshStandardMaterial({ color: 0xc33748, roughness: 0.7, metalness: 0.05 }),
    pickup: new MeshStandardMaterial({ color: 0xffd45f, roughness: 0.32, metalness: 0.32 }),
    pickupLight: new MeshStandardMaterial({ color: 0xfff1a4, roughness: 0.26, metalness: 0.18 }),
    foliage: new MeshStandardMaterial({ color: 0x40c982, roughness: 0.76, metalness: 0 }),
    foliageDark: new MeshStandardMaterial({ color: 0x268f72, roughness: 0.86, metalness: 0 }),
    trunk: new MeshStandardMaterial({ color: 0x8a5b42, roughness: 0.9, metalness: 0 }),
    sign: new MeshStandardMaterial({ color: 0x6fe8ff, roughness: 0.42, metalness: 0.2 }),
  };
}
