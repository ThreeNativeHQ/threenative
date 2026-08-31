// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
import { MeshStandardMaterial, Vector3 } from "three";
import { renderGroup, uniform } from "three/tsl";
import { palette } from "./palette.js";

export const floorMaterial = new MeshStandardMaterial({
  color: palette.floor,
  roughness: 0.78,
  metalness: 0.12,
});

export const defaultMaterial = new MeshStandardMaterial({
  color: palette.player,
  roughness: 0.52,
  metalness: 0.08,
});

export const wallMaterial = new MeshStandardMaterial({
  color: palette.accent,
  roughness: 0.68,
  metalness: 0.04,
});

/** The wall's authored colour is the radiance input consumed by the opt-in GI solve. */
export const wallBounceRadiance = uniform(new Vector3())
  .setGroup(renderGroup)
  .onRenderUpdate((_frame, node) => {
    node.value.set(wallMaterial.color.r, wallMaterial.color.g, wallMaterial.color.b);
    return node.value;
  });

export function setWallColour(changed: boolean): void {
  wallMaterial.color.setHex(changed ? palette.player : palette.accent);
  renderGroup.needsUpdate = true;
}
