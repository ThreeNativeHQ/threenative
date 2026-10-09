import type { Mesh, Object3D } from "three";

/** True when the object draws something, whether or not this class can batch it. */
export function isRenderable(object: Object3D): boolean {
  const candidate = object as Mesh & { isSprite?: boolean; isPoints?: boolean; isLine?: boolean };
  return (
    candidate.isMesh === true ||
    candidate.isSprite === true ||
    candidate.isPoints === true ||
    candidate.isLine === true
  );
}
