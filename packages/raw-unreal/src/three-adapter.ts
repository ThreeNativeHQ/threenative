import {
  BufferGeometry,
  BufferAttribute,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from "three";

import type { IDecodedUAssetStaticMesh, IUAssetParseOptions } from "./types.js";

export interface IThreeAdapterOptions {
  /** Override the fallback material. Every material is the game's decision; the fallback is one
   * plain `MeshStandardMaterial` per section (or a single one for single-section meshes). */
  materialFactory?: (decoded: IDecodedUAssetStaticMesh) => Material | Material[];
}

function fallbackMaterial(): Material {
  return new MeshStandardMaterial({ color: 0xb8c8df, metalness: 0.08, roughness: 0.42 });
}

/** Converts one decoded `.uasset` static mesh into a `THREE.BufferGeometry` — positions, UVs,
 * normals, an index buffer sized to the vertex count, and one draw group per material section.
 * Coordinate conversion and winding repair already happened at parse time per the parse
 * options; this builder makes no further geometry decisions. */
export function createThreeGeometry(decoded: IDecodedUAssetStaticMesh): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(decoded.positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(decoded.uvs, 2));
  if (decoded.normals) {
    geometry.setAttribute("normal", new BufferAttribute(decoded.normals, 3));
  } else {
    geometry.computeVertexNormals();
  }
  geometry.setIndex(new BufferAttribute(decoded.indices, 1));
  for (const section of decoded.sections) {
    geometry.addGroup(section.start, section.count, section.materialIndex);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Converts a decoded `.uasset` static mesh into a renderable `THREE.Mesh` with provenance in
 * `userData.unreal`. Materials come from `materialFactory`; without one, a plain fallback is
 * used so nothing renders invisible by accident. */
export function createThreeObject(
  decoded: IDecodedUAssetStaticMesh,
  options: IThreeAdapterOptions = {},
): Object3D {
  const geometry = createThreeGeometry(decoded);
  const chosen = options.materialFactory
    ? options.materialFactory(decoded)
    : decoded.sections.length > 1
      ? decoded.sections.map(() => fallbackMaterial())
      : fallbackMaterial();
  const material: Material | Material[] = Array.isArray(chosen) ? [...chosen] : chosen;

  const mesh = new Mesh(geometry, material);
  mesh.name = decoded.metadata.objectPath.split("/").at(-1) || "UnrealStaticMesh";
  mesh.userData.unreal = {
    ...decoded.metadata,
    ...decoded.unreal,
    sections: decoded.sections,
    sourceStats: decoded.sourceStats,
    directUasset: true,
  };
  return mesh;
}

/** The parse options a caller may still want to hand to the loader, re-exported for
 * convenience so the adapter surface stays one import. */
export type { IUAssetParseOptions };
