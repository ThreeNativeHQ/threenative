// Generated for you. This file owns the sailing kit's surface decisions.
import { DoubleSide, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { palette } from "./palette.js";

export interface ISailingMaterials {
  readonly deck: MeshStandardMaterial;
  readonly hull: MeshStandardMaterial;
  readonly buoy: MeshStandardMaterial;
  readonly sail: MeshStandardMaterial;
  readonly island: MeshStandardMaterial;
  readonly horizon: MeshBasicMaterial;
}

export function createMaterials(): ISailingMaterials {
  return {
    deck: new MeshStandardMaterial({ color: palette.player, roughness: 0.5, metalness: 0.15 }),
    hull: new MeshStandardMaterial({ color: 0x7f403a, roughness: 0.62, metalness: 0.12 }),
    buoy: new MeshStandardMaterial({ color: palette.accent, roughness: 0.35, metalness: 0.1 }),
    sail: new MeshStandardMaterial({
      color: 0xf4eee0,
      metalness: 0,
      roughness: 0.92,
      side: DoubleSide,
    }),
    island: new MeshStandardMaterial({ color: palette.floor, roughness: 0.95, metalness: 0 }),
    horizon: new MeshBasicMaterial({ color: palette.shadow }),
  };
}
