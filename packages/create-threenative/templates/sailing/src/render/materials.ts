// Generated for you. This file owns the sailing kit's surface decisions, and nothing in
// `props.ts` names a colour: change the ship's timber, canvas or cordage entirely from here.
import { DoubleSide, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { palette } from "./palette.js";

export interface ISailingMaterials {
  readonly deck: MeshStandardMaterial;
  readonly hull: MeshStandardMaterial;
  readonly buoy: MeshStandardMaterial;
  /**
   * Canvas. A **node** material, because `SoftBody3D` drives cloth by replacing a material's
   * position node and refuses anything else — see `SHIP_SAILS` in `props.ts`. Everything visible
   * about it is still decided here.
   */
  readonly sail: MeshStandardNodeMaterial;
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
    // Not `palette.accent`. The accent is the crest-water colour, so a buoy painted with it was
    // literally the same teal as the sea it floated in and vanished at any range worth steering
    // by. A navigation mark is safety orange for exactly this reason.
    buoy: new MeshStandardMaterial({ color: 0xe8681c, roughness: 0.44, metalness: 0.06 }),
    sail: new MeshStandardNodeMaterial({
      color: 0xf2e7d2,
      // Flat, and not for the low-poly look — though it matches it. `SoftBody3D` replaces a
      // material's *position* node and nothing else, so a cloth's authored normals go on pointing
      // wherever the sail was cut while the sail itself swings away from them: the canvas came
      // back as flat grey slabs lit as though it were still hanging dead straight. Flat shading
      // takes the normal from the derivative of the drawn position instead, so it follows the
      // simulation for free.
      flatShading: true,
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
