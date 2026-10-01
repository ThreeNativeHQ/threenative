// Generated for you. This file owns the sailing kit's surface decisions, and nothing in
// `props.ts` names a colour: change the ship's timber, canvas or cordage entirely from here.
import { DoubleSide, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { palette } from "./palette.js";

export interface ISailingMaterials {
  readonly buoy: MeshStandardMaterial;
  /**
   * Canvas. A **node** material, because `SoftBody3D` drives cloth by replacing a material's
   * position node and refuses anything else — see `SHIP_SAILS` in `props.ts`. Everything visible
   * about it is still decided here.
   */
  readonly sail: MeshStandardNodeMaterial;
  readonly island: MeshStandardMaterial;
  /** Wet rock at the water's edge, where the swell has been working on the headland. */
  readonly rock: MeshStandardMaterial;
  readonly horizon: MeshBasicMaterial;
  /** The buoy's pole and the island's palm trunks. */
  readonly spar: MeshStandardMaterial;
  /** The buoy's band and flag — the ship's own hull, deck and rigging now come from `ship.glb`. */
  readonly trim: MeshStandardMaterial;
  /**
   * The masthead flag. Canvas, dyed red and given the same translucency as the sails, because a
   * small backlit shape in a deep oxblood reads as a hole cut in the sky.
   */
  readonly pennant: MeshStandardMaterial;
  readonly sand: MeshStandardMaterial;
  readonly foliage: MeshStandardMaterial;
}

export function createMaterials(): ISailingMaterials {
  return {
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
      // Canvas is thin, and the sun is usually on the far side of it: a sail the camera sees in
      // shadow is lit only by the sky, which came back a blue-grey slab the size of the rig. Real
      // canvas is translucent — a backlit sail glows and the seams show through it. This is the
      // light coming through the cloth, and it is the difference between the rig reading as three
      // sails and as one grey wall.
      emissive: 0x4a3f2c,
      metalness: 0,
      roughness: 0.95,
      side: DoubleSide,
    }),
    island: new MeshStandardMaterial({ color: 0x4c6b45, roughness: 0.96, metalness: 0 }),
    // Darker and smoother than the scrub, because it is wet. The island's whole silhouette used to
    // be one green dome; the half of a headland the sea touches is rock, and saying so is what makes
    // the rest of it read as land.
    rock: new MeshStandardMaterial({ color: 0x5d5750, roughness: 0.72, metalness: 0.02 }),
    horizon: new MeshBasicMaterial({ color: palette.skyLow }),
    spar: new MeshStandardMaterial({ color: 0x8a6238, roughness: 0.72, metalness: 0 }),
    trim: new MeshStandardMaterial({ color: 0xa33f2c, roughness: 0.6, metalness: 0.05 }),
    // Two stops brighter than the rails, and translucent like the sails: the flag is a backlit
    // shape against the sky, and canvas that does not let light through is a card.
    pennant: new MeshStandardMaterial({
      color: 0xd4573a,
      emissive: 0x59241a,
      metalness: 0,
      roughness: 0.9,
      side: DoubleSide,
    }),
    // Wet-darkened at the top: a beach is the brightest thing on an island, and at full value it
    // outshone the ship and pulled the eye off the subject.
    sand: new MeshStandardMaterial({ color: 0xc4b184, roughness: 0.98, metalness: 0 }),
    foliage: new MeshStandardMaterial({ color: 0x3f7a48, roughness: 0.94, metalness: 0 }),
  };
}
