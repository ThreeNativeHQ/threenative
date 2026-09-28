// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// Every colour is a plausible albedo rather than a pastel, and every roughness is varied between
// neighbours — grass, sand and granite scatter light very differently, and the sky environment
// `sky.ts` installs is what makes that difference visible. This scene now runs on a real
// photographic sky, so a material that is only convincing next to an unlit dome will not be.
import { Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, type Texture } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { palette } from "./palette.js";

export function createMaterials() {
  return {
    floor: new MeshStandardMaterial({ color: palette.grass, roughness: 0.9, metalness: 0 }),
    /** The pickup's four pieces. The one saturated colour: it is the thing you collect. */
    player: new MeshStandardMaterial({ color: palette.accent, roughness: 0.42, metalness: 0 }),
    crate: new MeshStandardMaterial({ color: palette.accent, roughness: 0.62, metalness: 0 }),
    // The flagpole only. The island under it is `floor`, so the far side reads as more of
    // the same ground and the gap between them stays legible as a gap.
    goal: new MeshStandardMaterial({ color: palette.rock, roughness: 0.45, metalness: 0.2 }),
    // The columns under the ledge: lit, matte, granite, so the drop has a below.
    rock: new MeshStandardMaterial({ color: palette.rock, roughness: 0.98, metalness: 0 }),
    // The ridge on the horizon is unlit on purpose. A standard material there takes the warm key
    // like everything else and the backdrop stops being a backdrop; a flat colour between the
    // granite and the sky's own horizon stays a silhouette from every light angle, reads as
    // distance rather than as a rock, and the scene's fog still fades it.
    ridge: new MeshBasicMaterial({
      color: new Color(palette.rock).lerp(new Color(palette.skyLow), 0.55),
    }),
    /** A pale dry wildflower head: sand lightened towards the white it is in daylight. */
    flower: new MeshStandardMaterial({
      color: new Color(palette.sand).lerp(new Color(0xffffff), 0.45),
      roughness: 0.7,
    }),
    grass: new MeshStandardMaterial({ color: palette.grass, roughness: 0.95, metalness: 0 }),
    grassDark: new MeshStandardMaterial({
      color: new Color(palette.grass).multiplyScalar(0.72),
      roughness: 0.98,
      metalness: 0,
    }),
    sand: new MeshStandardMaterial({ color: palette.sand, roughness: 0.96, metalness: 0 }),
    /** The far sandbar's beach rim: the same sand as the main island's shore. */
    shore: new MeshStandardMaterial({ color: palette.sand, roughness: 0.96, metalness: 0 }),
    /** The wet ring at the waterline: sand with the water still on it, so it is darker. */
    shoreline: new MeshStandardMaterial({
      color: new Color(palette.sand).multiplyScalar(0.78),
      roughness: 0.55,
      metalness: 0,
    }),
  };
}

/** The finish flag owns its sampled, double-sided look; SoftBody3D only drives its positions. */
export function createPennantMaterial(texture: Texture): MeshBasicNodeMaterial {
  return new MeshBasicNodeMaterial({ map: texture, side: DoubleSide });
}
