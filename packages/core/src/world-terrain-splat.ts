import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  type Texture,
  UnsignedByteType,
} from "three";
import {
  cameraViewMatrix,
  clamp,
  dot,
  float,
  mix,
  mx_noise_float,
  normalWorld,
  positionWorld,
  texture,
  triplanarTexture,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { MeshStandardNodeMaterial } from "three/webgpu";
import type { IAssetLoader } from "./assets.js";
import type { IWorldExtent } from "./world-package.js";

type Component = "r" | "g" | "b" | "a";

/** One texture set: albedo (and optionally a normal map) tiled in metres, tinted in linear. */
export interface ITerrainSplatLayer {
  readonly id: string;
  readonly tile: number;
  readonly tint: readonly [number, number, number];
  readonly normal?: boolean;
  readonly saturation?: number;
  /** Box-projected, for cliffs a top-down projection smears. */
  readonly triplanar?: boolean;
}

/** A layer blended over what is below it by one mask channel, remapped from `lo..hi`. */
export interface ITerrainSplatMaskedLayer extends ITerrainSplatLayer {
  readonly mask: string;
  /** The component of a `rgb` mask; ignored by a single-component mask. */
  readonly channel: "r" | "g" | "b";
  readonly lo: number;
  readonly hi: number;
}

/**
 * The package's terrain table (`terrain.layers.table`). Written by the export recipe
 * `export_terrain_layers.py` from the game's own table; every value is the game's.
 */
export interface ITerrainSplatTable {
  readonly base: ITerrainSplatLayer;
  /** Noise (0..1 at `scale` per metre) that pushes every mask edge by +-`push`. */
  readonly breakup: { readonly scale: number; readonly push: number };
  /** Large-scale brightness variation against visible tiling, mapped to `min..max`. */
  readonly macro: { readonly scale: number; readonly min: number; readonly max: number };
  readonly layers: readonly ITerrainSplatMaskedLayer[];
  /**
   * `terrain.layers.splat`: `planes` RGBA8 planes of `size`², rows bottom-up, covering the
   * package extent. `masks` names each mask's plane and component (`rgb` = pick by the layer's
   * `channel`).
   */
  readonly splat: {
    readonly size: number;
    readonly planes: number;
    readonly masks: Readonly<Record<string, readonly [number, Component | "rgb"]>>;
  };
  /** Package-relative folder of `<id>_diff.jpg` and `<id>_nrm.jpg`. */
  readonly textures: string;
}

export interface ILoadTerrainSplatOptions {
  readonly assets: IAssetLoader;
  /** The world package's `world.json`, as `WorldCells.load` takes it. */
  readonly url: string;
}

/**
 * The two things this surface needs from world.json: its extent and its terrain layer paths.
 * `WorldCells.load` validates the whole package; this only refuses a shape it cannot read.
 */
function worldLayers(raw: unknown): {
  extent: IWorldExtent;
  layers: Readonly<Record<string, string>>;
} {
  const record = raw as { extent?: Partial<IWorldExtent>; terrain?: { layers?: unknown } };
  const extent = record.extent;
  const numbers = [extent?.minX, extent?.minZ, extent?.sizeX, extent?.sizeZ];
  if (
    extent === undefined ||
    !numbers.every((value) => typeof value === "number" && Number.isFinite(value))
  )
    throw new Error("loadTerrainSplat: world.json has no numeric extent.");
  const layers = record.terrain?.layers;
  const paths: Record<string, string> = {};
  if (typeof layers === "object" && layers !== null)
    for (const [name, value] of Object.entries(layers))
      if (typeof value === "string") paths[name] = value;
  return { extent: extent as IWorldExtent, layers: paths };
}

function packageDir(url: string): string {
  const slash = url.lastIndexOf("/");
  return slash === -1 ? "" : url.slice(0, slash + 1);
}

async function fetchResolved(assets: IAssetLoader, path: string): Promise<Response> {
  for (const candidate of await assets.resolve(path)) {
    const response = await fetch(candidate);
    if (response.ok) return response;
  }
  throw new Error(`loadTerrainSplat: '${path}' is not served.`);
}

function splatPlane(bytes: Uint8Array, size: number, plane: number): Texture {
  const texels = size * size * 4;
  if (bytes.byteLength < (plane + 1) * texels)
    throw new Error(`loadTerrainSplat: splat data is shorter than plane ${String(plane)}.`);
  const map = new DataTexture(
    bytes.subarray(plane * texels, (plane + 1) * texels),
    size,
    size,
    RGBAFormat,
    UnsignedByteType,
  );
  map.colorSpace = NoColorSpace;
  map.magFilter = LinearFilter;
  map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

/**
 * The splat terrain surface a world package describes, for `WorldCells.load({ surface })`.
 *
 * Layers blend over a base by mask channels read as linear data (the masks ship raw, beside the
 * heightmap, so no cook moves a blend threshold), with noise-broken edges and macro brightness
 * variation. Texture sets tile in world metres on the package's ground plane (x, -z: a Z-up
 * authoring tool's x and y), cliffs can be triplanar, and the base plus any layer that asks carries
 * a normal map. Nothing here is a look choice: textures, tiles, tints, thresholds and noise scales
 * all come from the package's table, which the game authors once and its DCC shares.
 *
 * @situation terrain textured by splat masks exported from Blender with the world package
 * @situation the game's terrain should match the DCC's terrain material without a second copy
 * @constraint the package's world.json must carry `terrain.layers.table` and `terrain.layers.splat`, written by the `export_terrain_layers.py` recipe
 * @constraint WebGPU allows 16 sampled textures per stage: planes + diffuse maps + normal maps must fit
 * @override every value comes from the package's table; the returned material is the game's to adjust
 * @example
 * const surface = await loadTerrainSplat({ assets: ctx.assets, url: "world/world.json" });
 * const world = await WorldCells.load({ assets: ctx.assets, url: "world/world.json", surface, follow, ring: 2 });
 */
export async function loadTerrainSplat(options: ILoadTerrainSplatOptions): Promise<Material> {
  const { assets, url } = options;
  const world = worldLayers(await (await fetchResolved(assets, url)).json());
  const layerPaths = world.layers;
  if (layerPaths.table === undefined || layerPaths.splat === undefined)
    throw new Error(
      "loadTerrainSplat: world.json has no terrain.layers.table/splat; export them with export_terrain_layers.py.",
    );
  const dir = packageDir(url);
  const table = (await (
    await fetchResolved(assets, dir + layerPaths.table)
  ).json()) as ITerrainSplatTable;
  const bytes = new Uint8Array(
    await (await fetchResolved(assets, dir + layerPaths.splat)).arrayBuffer(),
  );

  const { minX, minZ, sizeX, sizeZ } = world.extent;
  // Rows are bottom-up in the authoring tool's ground plane, whose +y is three's -z.
  const maskUv = vec2(
    positionWorld.x.sub(minX).div(sizeX),
    float(minZ + sizeZ)
      .sub(positionWorld.z)
      .div(sizeZ),
  );
  const planes: Node<"vec4">[] = [];
  for (let plane = 0; plane < table.splat.planes; plane += 1)
    planes.push(texture(splatPlane(bytes, table.splat.size, plane), maskUv));

  const load = async (layer: ITerrainSplatLayer, kind: "diff" | "nrm"): Promise<Texture> => {
    const map = await assets.texture(`${dir}${table.textures}/${layer.id}_${kind}.jpg`, {
      data: kind === "nrm",
    });
    map.wrapS = RepeatWrapping;
    map.wrapT = RepeatWrapping;
    map.anisotropy = 8;
    map.needsUpdate = true;
    return map;
  };
  const all: ITerrainSplatLayer[] = [table.base, ...table.layers];
  const diffuse = await Promise.all(all.map((layer) => load(layer, "diff")));
  const normals = await Promise.all(
    all.map((layer) => (layer.normal === true ? load(layer, "nrm") : Promise.resolve(undefined))),
  );

  const ground = vec2(positionWorld.x, positionWorld.z.negate());
  const maskOf = (layer: ITerrainSplatMaskedLayer): Node<"float"> => {
    const where = table.splat.masks[layer.mask];
    if (where === undefined) throw new Error(`loadTerrainSplat: unknown mask '${layer.mask}'.`);
    const source = planes[where[0]];
    if (source === undefined)
      throw new Error(`loadTerrainSplat: mask '${layer.mask}' names a missing plane.`);
    return source[where[1] === "rgb" ? layer.channel : where[1]];
  };
  const breakup = mx_noise_float(vec3(ground.mul(table.breakup.scale), 0))
    .mul(0.5)
    .add(0.5);
  const push = breakup.mul(2 * table.breakup.push).sub(table.breakup.push);

  const albedo = (layer: ITerrainSplatLayer, index: number): Node<"vec3"> => {
    const map = diffuse[index] as Texture;
    let sample: Node<"vec3"> =
      layer.triplanar === true
        ? triplanarTexture(
            texture(map),
            null,
            null,
            float(1 / layer.tile),
            positionWorld,
            normalWorld,
          ).rgb
        : texture(map, ground.div(layer.tile)).rgb;
    if (layer.saturation !== undefined) {
      const luma = dot(sample, vec3(0.2126, 0.7152, 0.0722));
      sample = mix(vec3(luma), sample, layer.saturation);
    }
    return sample.mul(vec3(...layer.tint));
  };

  let color = albedo(table.base, 0);
  const baseNormal = normals[0];
  let normalSample: Node<"vec3"> =
    baseNormal === undefined
      ? vec3(0.5, 0.5, 1)
      : texture(baseNormal, ground.div(table.base.tile)).rgb;
  table.layers.forEach((layer, offset) => {
    const index = offset + 1;
    const weight = clamp(
      maskOf(layer)
        .add(push)
        .sub(layer.lo)
        .div(layer.hi - layer.lo),
      0,
      1,
    );
    color = mix(color, albedo(layer, index), weight);
    const nrm = normals[index];
    if (nrm !== undefined)
      normalSample = mix(normalSample, texture(nrm, ground.div(layer.tile)).rgb, weight);
  });
  const macro = mx_noise_float(vec3(ground.mul(table.macro.scale), 0))
    .mul(0.5)
    .add(0.5)
    .mul(table.macro.max - table.macro.min)
    .add(table.macro.min);

  const material = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.92 });
  material.name = "terrain-splat";
  material.colorNode = color.mul(macro);
  // A top-down projection's tangent frame: +x along u, ground +y (three -z) along v, OpenGL green
  // up v, re-orthogonalised against the tile's own normal.
  const n = normalWorld;
  const tangent = vec3(1, 0, 0).sub(n.mul(n.x)).normalize();
  const bitangent = n.cross(tangent).normalize();
  const t = normalSample.mul(2).sub(1);
  const perturbed = tangent.mul(t.x).add(bitangent.mul(t.y)).add(n.mul(t.z)).normalize();
  material.normalNode = cameraViewMatrix.mul(vec4(perturbed, 0)).xyz.normalize();
  return material;
}
