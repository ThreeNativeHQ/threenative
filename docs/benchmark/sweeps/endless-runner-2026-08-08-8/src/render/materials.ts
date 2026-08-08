import { MeshBasicMaterial, MeshStandardMaterial } from "three";
import { palette } from "./palette.js";

export function createMaterials() {
  return {
    accent: new MeshStandardMaterial({ color: palette.accent, emissive: 0x4d3100, roughness: 0.62 }),
    coral: new MeshStandardMaterial({ color: palette.coral, roughness: 0.72 }),
    dark: new MeshStandardMaterial({ color: palette.road, roughness: 0.82 }),
    leaf: new MeshStandardMaterial({ color: palette.leaf, roughness: 0.9 }),
    leafDark: new MeshStandardMaterial({ color: 0x20a85d, roughness: 0.9 }),
    road: new MeshStandardMaterial({ color: palette.road, roughness: 0.88 }),
    shoulder: new MeshStandardMaterial({ color: 0x70cbe9, roughness: 0.96 }),
    sun: new MeshBasicMaterial({ color: palette.sun, toneMapped: false }),
    trunk: new MeshStandardMaterial({ color: 0x7e5546, roughness: 1 }),
    white: new MeshStandardMaterial({ color: palette.sun, roughness: 0.74 }),
  } as const;
}
