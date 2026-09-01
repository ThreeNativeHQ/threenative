import { MeshNormalMaterial } from "three";

/** The terrain look belongs to this example; the world package receives it as an input. */
export function terrainMaterial(): MeshNormalMaterial {
  return new MeshNormalMaterial();
}
