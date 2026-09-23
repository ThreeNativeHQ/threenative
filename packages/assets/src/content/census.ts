/**
 * The bucket census: what a merge could collapse, before and after an atlas.
 *
 * "Fewer objects" was the obvious lever on the reference game and it recovered nothing — a runtime
 * per-material merge replaced 246 of 1,561 meshes and moved no frame time, because 274 buckets
 * held 213 singletons. The census is the number to read before promising a merge, and this is the
 * thing that reads it: it walks a glTF document's materials, takes the same signature the dedupe
 * takes, and reports the buckets twice — once as authored, once with every atlasable texture
 * repointed at a page.
 *
 * The second number is the falsification point for the whole atlas argument. If singletons do not
 * fall, the atlas is not the lever and nothing downstream of it should be built.
 */

import type { Document, Material, Texture } from "@gltf-transform/core";
import { type IAtlasSource, packAtlas } from "../atlas/packer.js";
import { uvsTile } from "../atlas/rewrite-uvs.js";
import {
  type IDedupeCensus,
  type IMaterialState,
  dedupeMaterials,
  withAtlasTextures,
} from "./dedupe-materials.js";

/** One model's census. */
export interface IContentCensus {
  readonly model: string;
  readonly meshes: number;
  readonly primitives: number;
  readonly materials: number;
  /** Distinct texture images the materials reference. */
  readonly textureSources: number;
  /** Sources the packer refused, with the reason — tiling surfaces, mostly. */
  readonly excluded: number;
  readonly atlasPages: number;
  readonly before: IDedupeCensus;
  readonly after: IDedupeCensus;
}

function textureKey(texture: Texture | null): string | undefined {
  if (texture === null) return undefined;
  const uri = texture.getURI();
  if (uri !== "") return uri;
  const name = texture.getName();
  if (name !== "") return `name:${name}`;
  // An embedded image with neither a URI nor a name is identified by its bytes, which is also the
  // only identity two models that embed the same image would agree on.
  const image = texture.getImage();
  return image === null ? undefined : `bytes:${String(image.byteLength)}:${String(image[0] ?? 0)}`;
}

/** Reads a material into the state the signature is taken over. */
export function materialStateOf(material: Material): IMaterialState {
  const textures: Record<string, string | undefined> = {
    baseColor: textureKey(material.getBaseColorTexture()),
    emissive: textureKey(material.getEmissiveTexture()),
    metallicRoughness: textureKey(material.getMetallicRoughnessTexture()),
    normal: textureKey(material.getNormalTexture()),
    occlusion: textureKey(material.getOcclusionTexture()),
  };
  return {
    flags: {
      alphaMode: material.getAlphaMode(),
      doubleSided: material.getDoubleSided(),
    },
    name: material.getName(),
    textures,
    uniforms: {
      alphaCutoff: material.getAlphaCutoff(),
      baseColorFactor: [...material.getBaseColorFactor()],
      emissiveFactor: [...material.getEmissiveFactor()],
      metallic: material.getMetallicFactor(),
      normalScale: material.getNormalScale(),
      occlusionStrength: material.getOcclusionStrength(),
      roughness: material.getRoughnessFactor(),
    },
  };
}

/**
 * Textures the scene actually samples outside the unit square.
 *
 * **The obvious test is wrong, and getting it wrong would have killed the atlas on a false
 * negative.** glTF's default sampler wrap is `REPEAT`, so almost every exported texture claims to
 * tile whether or not anything tiles it; excluding on the wrap mode alone excluded 214 of 220
 * sources on the reference game's content and made the atlas look useless. What decides it is the
 * geometry: a surface whose UVs stay inside `[0, 1]` samples one copy of its image and can share a
 * page no matter what the sampler says, and a surface that leaves the square cannot, no matter how
 * it is clamped.
 *
 * So the census walks the primitives, reads each one's UV accessor, and marks the textures of the
 * materials that overflow. A primitive with no UVs cannot tile.
 */
function tilingTextures(document: Document): Set<string> {
  const tiling = new Set<string>();
  const overflowing = new Set<Material>();
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial();
      if (material === null || overflowing.has(material)) continue;
      const uv = primitive.getAttribute("TEXCOORD_0");
      if (uv === null) continue;
      if (uvsTile(uv.getArray() ?? new Float32Array())) overflowing.add(material);
    }
  }
  for (const material of overflowing) {
    for (const key of Object.values(materialStateOf(material).textures)) {
      if (key !== undefined) tiling.add(key);
    }
  }
  return tiling;
}

/**
 * Censuses one document: what its materials are now, and what they would be once their textures
 * shared atlas pages.
 *
 * A texture whose size the document does not state cannot be packed, so it is reported as excluded
 * rather than assumed square — an assumed size is an assumed page layout.
 */
export function censusDocument(
  model: string,
  document: Document,
  pageSize = 4_096,
): IContentCensus {
  const root = document.getRoot();
  const materials = root.listMaterials();
  const states = materials.map(materialStateOf);
  const before = dedupeMaterials(states).census;

  const tiling = tilingTextures(document);
  const sources: IAtlasSource[] = [];
  const seen = new Set<string>();
  for (const texture of root.listTextures()) {
    const key = textureKey(texture);
    if (key === undefined || seen.has(key)) continue;
    seen.add(key);
    const size = texture.getSize();
    if (size === null) {
      // A texture whose size the document does not state cannot be placed; reported as too large
      // rather than assumed square, because an assumed size is an assumed page layout.
      sources.push({ height: pageSize * 2, key, width: pageSize * 2 });
      continue;
    }
    sources.push({ height: size[1], key, tiles: tiling.has(key), width: size[0] });
  }
  const packed = packAtlas(sources, { pageSize });
  const after = dedupeMaterials(
    withAtlasTextures(states, (texture) => {
      const transform = packed.transforms.get(texture);
      return transform === undefined ? undefined : `atlas-page-${String(transform.page)}`;
    }),
  ).census;

  let primitives = 0;
  for (const mesh of root.listMeshes()) primitives += mesh.listPrimitives().length;
  return {
    after,
    atlasPages: packed.pages.length,
    before,
    excluded: packed.excluded.length,
    materials: materials.length,
    meshes: root.listMeshes().length,
    model,
    primitives,
    textureSources: sources.length,
  };
}

/** Totals across a set of models, so a scene's census is one line rather than twenty-nine. */
export function totalCensus(entries: readonly IContentCensus[]): Omit<IContentCensus, "model"> {
  const sum = (pick: (entry: IContentCensus) => number): number =>
    entries.reduce((total, entry) => total + pick(entry), 0);
  return {
    after: {
      buckets: sum((entry) => entry.after.buckets),
      materials: sum((entry) => entry.after.materials),
      singletons: sum((entry) => entry.after.singletons),
    },
    atlasPages: sum((entry) => entry.atlasPages),
    before: {
      buckets: sum((entry) => entry.before.buckets),
      materials: sum((entry) => entry.before.materials),
      singletons: sum((entry) => entry.before.singletons),
    },
    excluded: sum((entry) => entry.excluded),
    materials: sum((entry) => entry.materials),
    meshes: sum((entry) => entry.meshes),
    primitives: sum((entry) => entry.primitives),
    textureSources: sum((entry) => entry.textureSources),
  };
}
