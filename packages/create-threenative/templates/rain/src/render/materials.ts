// Generated for you. This file owns the sailing kit's surface decisions, and nothing in
// `props.ts` names a colour: change the ship's timber, canvas or cordage entirely from here.
import { DoubleSide, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { palette } from "./palette.js";

export interface ISailingMaterials {
  readonly deck: MeshStandardMaterial;
  readonly hull: MeshStandardMaterial;
  readonly buoy: MeshStandardMaterial;
  readonly sail: MeshStandardMaterial;
  readonly island: MeshStandardMaterial;
  readonly horizon: MeshBasicMaterial;
  /** Masts, yards, bowsprit, palm trunks. */
  readonly spar: MeshStandardMaterial;
  /** Standing rigging: thinner and darker than the spars, or it reads as more mast. */
  readonly cordage: MeshStandardMaterial;
  /** Rails, wale strakes, pennant — the ship's one saturated accent. */
  readonly trim: MeshStandardMaterial;
  readonly sand: MeshStandardMaterial;
  readonly foliage: MeshStandardMaterial;
}

export function createMaterials(): ISailingMaterials {
  return {
    // Holystoned deck: pale, and clearly not the hull. One timber colour for both made the ship
    // read as a single carved lump.
    deck: new MeshStandardMaterial({ color: 0xd9b98a, roughness: 0.68, metalness: 0 }),
    hull: new MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.72, metalness: 0.03 }),
    buoy: new MeshStandardMaterial({ color: palette.accent, roughness: 0.4, metalness: 0.08 }),
    sail: new MeshStandardMaterial({
      color: 0xf2e7d2,
      metalness: 0,
      roughness: 0.95,
      side: DoubleSide,
    }),
    island: new MeshStandardMaterial({ color: 0x4c6b45, roughness: 0.96, metalness: 0 }),
    horizon: new MeshBasicMaterial({ color: palette.skyLow }),
    spar: new MeshStandardMaterial({ color: 0x8a6238, roughness: 0.72, metalness: 0 }),
    cordage: new MeshStandardMaterial({ color: 0x3b2c22, roughness: 0.94, metalness: 0 }),
    trim: new MeshStandardMaterial({ color: 0xa33f2c, roughness: 0.6, metalness: 0.05 }),
    sand: new MeshStandardMaterial({ color: 0xe4d3a6, roughness: 0.98, metalness: 0 }),
    foliage: new MeshStandardMaterial({ color: 0x3f7a48, roughness: 0.94, metalness: 0 }),
  };
}
