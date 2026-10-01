// The ground's look, and every number in it, lives in this game: which surface covers which
// height and slope, how many metres one texture tile spans, and how the blend edges break. The
// evaluator in `packages/terrain` produces heights and eight material channels; none of that is a
// picture, and this file is the only place that decides what one looks like.
//
// Layer weights are read from the baked heightfield where it is drawn — its own world height, its
// own geometric normal, and the palette the bake painted — so a cliff is rock because it is steep,
// a beach is sand because it sits near the sea level the bake recorded, and snow settles only on
// the high flat ground. Nothing here resamples the terrain or adds a mask texture that could
// disagree with the geometry.
//
// WebGPU allows sixteen samplers per fragment stage, and the daylight rig's clipmap shadow spends
// two of them per window before this file binds anything: three windows, six samplers, and ten
// textures left. So this binds six albedos and four normal maps — every layer that covers ground,
// and relief on the four surfaces whose relief you can see — and takes the rest from what it
// already has. Roughness is a constant, because soil at 0.94 has no specular break worth a binding.
// Crevices come out of the normal maps' own blue channel, which is a baked ambient occlusion
// sitting in the texture that was already sampled for the tilt: a texel the map painted as facing
// away from the sky is a crevice, and darkening it costs no binding at all.
import type { IAssetLoader } from "@threenative/core";
import { Heightfield } from "@threenative/core/world";
import {
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  type Texture,
} from "three";
import {
  abs,
  attribute,
  clamp,
  float,
  max,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalWorld,
  normalize,
  oneMinus,
  positionView,
  positionWorld,
  rotateUV,
  smoothstep,
  texture,
  transformNormalToView,
  triplanarTexture,
  vec2,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { MeshStandardNodeMaterial } from "three/webgpu";

export interface IBakedWorld {
  size: number;
  resolution: number;
  heights: number[];
  colors: number[];
  waterLevel: number | null;
}

type LayerKey = "grass" | "dirt" | "rock" | "moss" | "sand" | "snow";

/** The layers that cover ground, ordered so the heavier surface blends over the base one. */
const LAYERS: readonly LayerKey[] = ["dirt", "moss", "sand", "rock", "snow"];

interface ILayerMaps {
  diffuse: Texture;
  normal?: Texture;
}

/**
 * One tile of each layer, in metres — the distance over which its texture repeats.
 *
 * Grass repeats every 2.6 m so a blade pattern still reads under the player's feet; the cliff rock
 * every 9 m, because its strata are wider than the cliff they sit on; snow every 12 m, because a
 * drift has no detail at the scale of a footprint. The same numbers are recorded per map in
 * `packages/terrain/starter-assets/credits.json`.
 */
const TILE: Record<LayerKey, number> = {
  dirt: 3.4,
  grass: 2.6,
  moss: 3.6,
  rock: 9,
  sand: 3.2,
  snow: 12,
};

/** Which CC0 starter maps each surface binds. This mapping is the game's, not the package's. */
const MAPS: Record<LayerKey, { diffuse: string; normal?: string }> = {
  dirt: {
    diffuse: "forest_ground_04/forest_ground_04_diff_1k.jpg",
    normal: "forest_ground_04/forest_ground_04_nor_gl_1k.jpg",
  },
  grass: {
    diffuse: "leafy_grass/leafy_grass_diff_1k.jpg",
    normal: "leafy_grass/leafy_grass_nor_gl_1k.jpg",
  },
  moss: {
    diffuse: "mossy_rock/mossy_rock_diff_1k.jpg",
    normal: "mossy_rock/mossy_rock_nor_gl_1k.jpg",
  },
  rock: {
    diffuse: "cliff_side/cliff_side_diff_1k.jpg",
    normal: "cliff_side/cliff_side_nor_gl_1k.jpg",
  },
  sand: { diffuse: "sand_01/sand_01_diff_1k.jpg" },
  snow: { diffuse: "snow_02/snow_02_diff_1k.jpg" },
};

/**
 * How far a crevice darkens its layer, as a share of the normal map's own up-facing channel.
 *
 * The blue channel of a tangent-space normal is 1 on a texel facing straight up and falls away on
 * every crease, undercut and hollow in the surface it was cooked from — which is what an ambient
 * occlusion map is, drawn into the map that was already bound for the tilt.
 */
const OCCLUSION = 0.5;

/** Where the snow line sits, in metres, and the slope above which it cannot settle. */
const SNOW = { from: 52, to: 70, sheds: 0.22 };

/**
 * The beach band, in metres above the bake's own sea level.
 *
 * Wide, because this coast rises a few degrees: a 3 m band is a 30 m walk of beach here and stops
 * halfway up it. The bake paints sand below 6 m for the same reason.
 */
const SHORE = { beach: 7.5, wet: 1 };

/**
 * What makes the ground grass rather than the dry autumn meadow the CC0 set photographs.
 *
 * Leafy Grass is a real meadow in October: brown thatch with green sprigs. A temperate starter
 * wants June, so this trades red for green on that one layer and leaves the texture's own detail,
 * its normal map and every other surface alone.
 */
const MEADOW = vec3(0.66, 1.06, 0.54);

/**
 * A world-space UV, rotated by a slow noise so the tile lattice is never axis-aligned.
 *
 * Rotating a *tiling* texture cannot open a seam — neighbouring tiles stay identical wherever the
 * rotation lands — but it turns an obvious 2.6 m grid into a slowly curving one, which is the
 * difference between "detailed ground" and "a checkerboard seen from above".
 */
function layerUV(key: LayerKey, scale = 1): Node<"vec2"> {
  return rotateUV(
    positionWorld.xz.div(float(TILE[key])).mul(scale),
    mx_noise_float(positionWorld.mul(0.006)).mul(1.4),
    vec2(0, 0),
  );
}

/**
 * One normal map's two answers on the ground plane: the tilt it asks for, and how much of its own
 * up-facing it kept.
 *
 * Only the two tangential channels go into the tilt. The surface direction is already the
 * heightfield's own normal, and folding a second "out of the surface" term in here would cancel the
 * relief this map exists to add. On the ground plane the map's red runs along +x and its green
 * along +z. The third channel is not thrown away: it is the crevice term below.
 */
interface IRelief {
  /** How much this texel faces up, 0..1. A crevice is a texel that does not. */
  readonly crevice: Node<"float">;
  readonly tilt: Node<"vec3">;
}

function planarRelief(source: Texture, uv: Node<"vec2">, strength: number): IRelief {
  const sample = texture(source, uv);
  return {
    crevice: sample.z,
    tilt: vec3(sample.y, 0, sample.x).mul(strength),
  };
}

/**
 * The same relief projected on all three axes — this is what keeps a cliff from smearing.
 *
 * Each projection owns a different pair of world axes, so one map tilts the surface along a
 * different direction per axis and the three are recombined by the surface's own blend weights. The
 * crevice term is the one projection, because a crease is a crease whichever way the cliff faces.
 */
function triplanarRelief(source: Texture, key: LayerKey): IRelief {
  const tile = float(TILE[key]);
  const x = texture(source, positionWorld.yz.div(tile));
  const y = texture(source, positionWorld.zx.div(tile));
  const z = texture(source, positionWorld.xy.div(tile));
  const weight = abs(normalWorld).normalize();
  return {
    crevice: x.z,
    tilt: weight.x
      .mul(vec3(0, x.x, x.y))
      .add(weight.y.mul(vec3(y.y, 0, y.x)))
      .add(weight.z.mul(vec3(z.x, z.y, 0))),
  };
}

/**
 * The ground material: one lit surface whose colour is a blend of six PBR layers, blended in weight
 * order outwards from the base surface.
 */
export function createGroundMaterial(
  data: IBakedWorld,
  maps: Partial<Record<LayerKey, ILayerMaps>>,
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.94 });
  const held = new Set<Texture>();
  const layer = (key: LayerKey): ILayerMaps => {
    const found = maps[key];
    if (!found?.diffuse) throw new RangeError(`Ground layer '${key}' has no diffuse texture`);
    return found;
  };

  // --- where each surface sits -------------------------------------------------------------
  const slope = normalWorld.y.abs().oneMinus();
  const breakUp = mx_fractal_noise_float(positionWorld.mul(0.05), 3);
  const steep = clamp(slope.add(breakUp.mul(0.05)), 0, 1);
  // The bake painted its dirt, its sand and its road in its own palette, and every one of those
  // entries is redder than it is green where grass and moss are not. That difference *is* the
  // authored mask arriving with the data: the patches this world's recipe painted, with no second
  // splat texture that could disagree with the geometry.
  const baked = attribute<"vec3">("color", "vec3");
  const painted = smoothstep(
    float(0.012),
    float(-0.02),
    baked.g.sub(baked.r).add(breakUp.mul(0.035)),
  );
  // No recorded sea level means an inland world, and an inland world has no beach.
  const sand =
    data.waterLevel === null
      ? float(0)
      : smoothstep(float(SHORE.beach), float(SHORE.wet), positionWorld.y).mul(
          smoothstep(0.34, 0.1, steep),
        );
  const weights: Record<LayerKey, Node<"float">> = {
    // The bake painted its beach in the same red-over-green as its dirt, so the height rule above
    // has to be the one that speaks for the shore; painted dirt steps aside where it does.
    dirt: max(
      painted,
      smoothstep(0.28, 0.62, mx_fractal_noise_float(positionWorld.mul(0.016), 4)).mul(
        smoothstep(0.5, 0.2, steep),
      ),
    ).mul(sand.oneMinus()),
    grass: float(1),
    moss: smoothstep(0.06, 0.2, steep).mul(
      smoothstep(-0.2, 0.35, mx_fractal_noise_float(positionWorld.mul(0.011), 3)),
    ),
    sand,
    rock: smoothstep(0.2, 0.4, steep),
    snow: smoothstep(float(SNOW.from), float(SNOW.to), positionWorld.y).mul(
      smoothstep(SNOW.sheds, 0.06, steep),
    ),
  };

  // --- how each surface looks -------------------------------------------------------------
  // The layers that cover most of a meadow take a second, larger scale faded in with distance: one
  // tile under the player's feet, a coarser one near the horizon, and no single lattice for the eye
  // to find anywhere between.
  const far = smoothstep(float(14), float(52), positionView.length()).mul(0.35);
  const albedoOf = (key: LayerKey): Node<"vec4"> => {
    const { diffuse } = layer(key);
    held.add(diffuse);
    return mix(
      texture(diffuse, layerUV(key)),
      texture(diffuse, layerUV(key, 2.35).add(vec2(0.37, 0.19))),
      far,
    );
  };
  // The relief takes the same two scales as the colour, or the ground keeps its detail underfoot
  // and goes flat past twenty metres.
  const reliefOf = (key: LayerKey, strength: number): IRelief => {
    const source = layer(key).normal;
    if (source === undefined) return { crevice: float(1), tilt: vec3(0) };
    held.add(source);
    if (key === "rock") return triplanarRelief(source, key);
    const near = planarRelief(source, layerUV(key), strength);
    const coarse = planarRelief(source, layerUV(key, 2.35), strength * 0.6);
    return {
      crevice: mix(near.crevice, coarse.crevice, far),
      tilt: mix(near.tilt, coarse.tilt, far),
    };
  };

  const grassRelief = reliefOf("grass", 1.45);
  let albedo = albedoOf("grass").mul(MEADOW);
  let normal = grassRelief.tilt.mul(weights.grass);
  // The crevice term follows the surface the eye is actually looking at, so it is blended by the
  // same weights as the colour rather than applied to every layer at once.
  let crevice = grassRelief.crevice;
  for (const key of LAYERS) {
    const weight = weights[key];
    // A surface takes the ground over once it *is* most of the ground. Blending every layer by a
    // share of the running total instead leaves a beach a third sand, a third grass and a third
    // dirt, which is mud with a texture on it.
    const over = smoothstep(0.45, 0.92, weight);
    albedo = mix(albedo, albedoOf(key), over);
    const relief = reliefOf(key, 1.3);
    normal = normal.add(relief.tilt.mul(weight));
    crevice = mix(crevice, relief.crevice, over);
  }
  albedo = albedo.mul(mix(float(1), crevice, OCCLUSION));

  // Macro colour variation, in metres rather than in tile space so it survives the tiling, and at
  // two scales: one wide enough to read across a valley, one at the distance where a player is
  // actually looking at the ground. A single scale leaves the middle distance a flat wash, because
  // a 2.6 m tile is only a dozen pixels wide from fifty metres away.
  const macro = mx_fractal_noise_float(positionWorld.mul(0.004), 3)
    .mul(0.16)
    .add(mx_fractal_noise_float(positionWorld.mul(0.045), 2).mul(0.1));
  material.colorNode = albedo.mul(float(1).add(macro));
  material.normalNode = transformNormalToView(normalize(normalWorld.add(normal)));
  material.addEventListener("dispose", () => {
    for (const source of held) source.dispose();
  });
  return material;
}

/**
 * The baked heightfield, its geometry, and the lit ground material once the PBR maps arrive.
 *
 * `enter` is synchronous and the physics collider is built from this very mesh, so the mesh exists
 * immediately and draws with flat vertex colours until the textures settle. A map that never loads
 * keeps that fallback rather than failing the world: the terrain still has to collide on a host
 * with no asset server.
 */
export function createTerrain(
  data: IBakedWorld,
  assets?: IAssetLoader,
): { field: Heightfield; mesh: Mesh } {
  const field = new Heightfield({
    rows: data.resolution,
    columns: data.resolution,
    width: data.size,
    depth: data.size,
    origin: { x: 0, z: 0 },
    heights: new Float32Array(data.heights),
  });
  const geometry = field.toGeometry();
  if (data.colors.length !== geometry.getAttribute("position").count * 3)
    throw new RangeError("Baked terrain colours do not match the heightfield");
  geometry.setAttribute("color", new Float32BufferAttribute(data.colors, 3));
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const mesh: Mesh = new Mesh(geometry, material);
  mesh.name = "authored-terrain";
  mesh.receiveShadow = true;

  if (assets !== undefined)
    void loadGroundMaps(assets)
      .then((maps) => createGroundMaterial(data, maps))
      .then((ground) => {
        // Anything but the flat placeholder means the scene already moved on; a material nothing
        // draws holds GPU memory until its textures are released.
        if (mesh.material !== material) return ground.dispose();
        mesh.material = ground;
      })
      // A map that never arrives, or a set this material cannot bind, leaves the ground on its
      // baked vertex colours. It must still collide and still draw.
      .catch(() => undefined);
  return { field, mesh };
}

/**
 * Every starter map the ground binds, keyed by layer.
 *
 * Albedo is colour data and everything else is linear, so the loader is told which is which: a
 * normal map read as sRGB bends its own channels and the ground loses the relief it was cooked with.
 */
async function loadGroundMaps(
  assets: IAssetLoader,
): Promise<Partial<Record<LayerKey, ILayerMaps>>> {
  const layers = await Promise.all(
    Object.entries(MAPS).map(async ([key, paths]) => {
      // A layer without its albedo has no place in the blend, so the set comes back without it.
      const diffuse = await get(assets, paths.diffuse, false);
      if (diffuse === undefined) return undefined;
      const maps: ILayerMaps = { diffuse };
      for (const [slot, path] of Object.entries(paths)) {
        if (slot === "diffuse") continue;
        const found = await get(assets, path, true);
        if (found !== undefined) maps[slot as "normal"] = found;
      }
      return [key, maps] as const;
    }),
  );
  return Object.fromEntries(layers.filter((entry) => entry !== undefined));
}

async function get(
  assets: IAssetLoader,
  path: string,
  data: boolean,
): Promise<Texture | undefined> {
  return assets.texture(path, { anisotropy: 8, data, wrap: RepeatWrapping }).catch(() => undefined);
}
