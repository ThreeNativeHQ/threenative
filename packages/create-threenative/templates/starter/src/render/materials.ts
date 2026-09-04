// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, type Texture } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { palette } from "./palette.js";

export function createMaterials() {
  return {
    floor: new MeshStandardMaterial({ color: palette.floor, roughness: 0.9, metalness: 0 }),
    player: new MeshStandardMaterial({ color: palette.player, roughness: 0.48, metalness: 0.04 }),
    crate: new MeshStandardMaterial({ color: palette.crate, roughness: 0.76, metalness: 0 }),
    // The flagpole only. The island under it is `floor`, so the far side reads as more of
    // the same ground and the gap between them stays legible as a gap.
    goal: new MeshStandardMaterial({ color: palette.accent, roughness: 0.45, metalness: 0.04 }),
    // The columns under the ledge: lit, matte, near-black, so the drop has a below.
    rock: new MeshStandardMaterial({ color: palette.skyLow, roughness: 0.98, metalness: 0 }),
    // The ridge on the horizon is unlit on purpose. A standard material there takes the
    // warm key like everything else and the backdrop stops being a backdrop; a flat colour
    // between the two sky stops stays a silhouette from every light angle, and the scene's
    // fog still fades it with distance.
    ridge: new MeshBasicMaterial({ color: new Color(palette.skyLow).multiplyScalar(0.72) }),
    flower: new MeshStandardMaterial({ color: palette.crate, roughness: 0.6, metalness: 0 }),
    grass: new MeshStandardMaterial({ color: palette.floor, roughness: 0.95, metalness: 0 }),
    grassDark: new MeshStandardMaterial({
      color: new Color(palette.floor).multiplyScalar(0.58),
      roughness: 0.98,
      metalness: 0,
    }),
    sand: new MeshStandardMaterial({ color: palette.accent, roughness: 0.96, metalness: 0 }),
    shoreline: new MeshStandardMaterial({ color: palette.player, roughness: 0.9, metalness: 0 }),
  };
}

/** The finish flag owns its sampled, double-sided look; SoftBody3D only drives its positions. */
export function createPennantMaterial(texture: Texture): MeshBasicNodeMaterial {
  return new MeshBasicNodeMaterial({ map: texture, side: DoubleSide });
}
