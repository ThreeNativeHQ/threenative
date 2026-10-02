import type { IAssetLoader } from "@threenative/core";
import { Heightfield } from "@threenative/core/world";
import {
  type BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  RGFormat,
  RepeatWrapping,
  type Texture,
} from "three";
import {
  abs,
  clamp,
  dot,
  float,
  max,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalWorldGeometry,
  normalize,
  oneMinus,
  positionView,
  positionWorld,
  rotateUV,
  sign,
  sin,
  smoothstep,
  texture,
  transformNormalToView,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { GROUND_MAPS, GROUND_TILE, type LayerKey, ROCKFACE_MAPS } from "../world/terrainAssets.js";
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
// Texture budget: six albedos + four normals + curvature + two shadow levels × two = 15/16.
import { type IBiome, biomeWeights } from "./biomes.js";
import { createHorizonGeometry } from "./horizon.js";
import { type IBakedLake, type IBakedRiver, surfaceHeights, waterlineRadius } from "./river.js";

export interface IBakedWorld {
  size: number;
  resolution: number;
  heights: number[];
  colors: number[];
  waterLevel: number | null;
  lakes?: readonly IBakedLake[];
  rivers?: readonly IBakedRiver[];
}

/**
 * The ground's own curvature, sampled from a height texture, as the material's curvature term.
 *
 * This is the one signal the ground material cannot get any other way, and it is what separates a
 * hillside with hollows in it from a hillside with a colour painted on it. The heightfield's own
 * samples give a Laplacian: positive where the ground is concave (a hollow, a gully, the crease
 * where two slopes meet), negative on a nose or a rib. Both the moss and the rock below read it, so
 * moss grows in the crease at the bottom of a slope and rock shows on the rib at the top, which is
 * where each actually grows — rather than both keysing off slope alone and covering a whole face.
 *
 * Built once in `createTerrain` from the same heights the geometry and the collider were built from,
 * so it cannot disagree with either.
 */
export interface IGroundCurvature {
  /** +1 in a hollow, -1 on a rib, ~0 on flat ground. */
  readonly node: Node<"float">;
  readonly texture: DataTexture;
  readonly wetBank: Node<"float">;
}

/** The layers that cover ground, ordered so the heavier surface blends over the base one. */
const LAYERS: readonly LayerKey[] = ["dirt", "moss", "sand", "rock", "snow"];

interface ILayerMaps {
  diffuse: Texture;
  normal?: Texture;
}

/** Where the snow line sits, in metres, and the slope above which it cannot settle. */
const SNOW = { from: 145, to: 195, sheds: 0.22 };

/**
 * The beach band, in metres above the bake's own sea level.
 *
 * Wide, because this coast rises a few degrees: a 3 m band is a 30 m walk of beach here and stops
 * halfway up it. The bake paints sand below 6 m for the same reason.
 */
const SHORE = { beach: 7.5, wet: 1 };

/**
 * The wet band, and what it does to the sand.
 *
 * Sand that the sea has just left is darker and more saturated than the sand above it, because the
 * water is still in the pores and the grains are closer together for it. The band is a metre and a half
 * of height above the bake's own sea level and it feathers: a hard line at the high-water mark is
 * exactly the "straight-edged white shape" the foam work removed from the water.
 *
 * It is also the reason the beach reads as a *beach* rather than as a tan field, and it is a colour
 * the sand layer cannot supply on its own because it is a fact about the water's last reach, not about
 * the sand.
 */
const WET_SAND = {
  /** Height above sea level over which the band fades out, in metres. */
  band: 2.8,
  /** How much darker and how much more saturated the wet sand is. */
  darken: vec3(0.38, 0.4, 0.42),
  /** The grain the band adds: wet sand is smooth and packed, so the ripples flatten in it. */
  calm: 0.45,
} as const;

/**
 * What makes the ground grass rather than the dry autumn meadow the CC0 set photographs.
 *
 * Leafy Grass is a real meadow in October: brown thatch with green sprigs. A temperate starter
 * wants June, so this trades red for green on that one layer and leaves the texture's own detail,
 * its normal map and every other surface alone.
 */
const MEADOW = vec3(0.47, 0.72, 0.4);

/** Continuous stochastic warp: no hard cell boundaries in colour or normals. */
function tiledUV(key: LayerKey, scale = 1): Node<"vec2"> {
  const base = positionWorld.xz.div(GROUND_TILE[key] * scale);
  const warp = vec2(
    mx_noise_float(positionWorld.mul(0.025)),
    mx_noise_float(positionWorld.mul(0.025).add(vec3(17, 0, 29))),
  );
  return rotateUV(base, float(scale === 1 ? 0.38 : -0.73), vec2(0)).add(warp.mul(0.35));
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
  const tangent = rotateUV(sample.xy.mul(2).sub(1), float(-0.38), vec2(0));
  return {
    crevice: sample.z,
    tilt: vec3(tangent.x, 0, tangent.y).mul(strength),
  };
}

/**
 * The same relief projected on all three axes — this is what keeps a cliff from smearing.
 *
 * Each projection owns a different pair of world axes, so one map tilts the surface along a
 * different direction per axis and the three are recombined by the surface's own blend weights. The
 * crevice term is the one projection, because a crease is a crease whichever way the cliff faces.
 *
 * `roughnessScale` widens the sample spacing on the wall projections. A cliff nine metres of strata
 * across reads a nine-metre map at a one-metre scale as an unreadable fine band along its own
 * tangential direction, which is what a wall projection always does without this.
 */
function triplanarRelief(source: Texture, key: LayerKey, roughnessScale = 1): IRelief {
  const tile = float(GROUND_TILE[key]).mul(roughnessScale);
  const x = texture(source, positionWorld.zy.div(tile)).xyz.mul(2).sub(1);
  const y = texture(source, positionWorld.xz.div(tile)).xyz.mul(2).sub(1);
  const z = texture(source, positionWorld.xy.div(tile)).xyz.mul(2).sub(1);
  const axis = abs(normalWorldGeometry).pow(4);
  const weight = axis.div(axis.x.add(axis.y).add(axis.z));
  return {
    crevice: float(1),
    tilt: weight.x
      .mul(vec3(0, x.y, x.x.mul(sign(normalWorldGeometry.x))))
      .add(weight.y.mul(vec3(y.x, 0, y.y)))
      .add(weight.z.mul(vec3(z.x.mul(sign(normalWorldGeometry.z)), z.y, 0))),
  };
}

/**
 * How steep a face has to be before a layer stops being projected onto the ground plane.
 *
 * A planar projection is exact on flat ground and wrong everywhere else, and it is *very* wrong on a
 * slope: the map is stretched along the slope's own direction by the reciprocal of the cosine, so a
 * thirty-degree hillside turns a 2.6 m grass tile into a five-metre smear. Thirty-five degrees is
 * where that smear stops being invisible — below it the slope is gentle enough that the detail still
 * reads, above it the triplanar takes over.
 */
// Slope is 1 − cos(angle): 0.18 is 35°, not the sine of 35°.
const TRIPLANAR_SLOPE = 0.18;

/**
 * The sand's own relief: shore-aligned ripples, as a tilt in world space.
 *
 * A beach's texture is not isotropic. Waves run roughly parallel to the shore and leave ripple crests
 * parallel to it too, so the sand's strongest visual line runs *across* the fall line — and a planar
 * noise sampled in world XZ ignores that entirely, which is what the "zig-zag streaks" in the coastal
 * captures were: the tile's own diagonal ridges, following the tile grid rather than the water.
 *
 * The shore's direction is the fall line's horizontal component, which is the surface normal's own x/z
 * with y dropped: on a beach the normal points up-and-downhill, so its horizontal part points downhill,
 * and the ripples run perpendicular to that. Ripples are then a sine of the distance measured across
 * the fall line, modulated by a slow noise so the crest spacing wanders the way real ripples do, and
 * faded out where the beach is not a beach.
 */
const RIPPLE = {
  /** Crests per metre across the fall line. Real ripples are 5-20 cm apart; these read at 25 cm. */
  frequency: 4,
  /** How far the crests tilt the surface, and how much their spacing wanders. */
  strength: 0.26,
  wander: 1.4,
} as const;

function sandRipples(): Node<"vec3"> {
  // Downhill, in world xz. Normalised so the ripple amplitude does not change with the slope.
  const fall = vec2(normalWorldGeometry.x, normalWorldGeometry.z);
  const downhill = fall.length().max(float(0.0001));
  const across = vec2(fall.x.div(downhill), fall.y.div(downhill));
  // Distance across the shore, in metres, with a slow noise on the frequency so the crest spacing is
  // not a perfect comb.
  const phase = positionWorld.x
    .mul(across.x)
    .add(positionWorld.z.mul(across.y))
    .div(RIPPLE.frequency);
  const wobble = mx_noise_float(positionWorld.mul(0.09)).mul(RIPPLE.wander);
  const crest = phase.add(wobble).sin();
  // The tilt is along the fall line, so the crests face the sea.
  return vec3(across.x, 0, across.y).mul(crest).mul(RIPPLE.strength);
}

/**
 * One albedo map projected on all three axes, recombined by the surface's own normal.
 *
 * This is the same idea as {@link triplanarRelief} on the colour side, and it is what a hillside
 * needs: a planar projection stretches the map by the reciprocal of the cosine of the slope, so the
 * further off flat the ground gets the more the detail smears along the fall line. Sampling the three
 * world-axis planes and blending by `|n|` costs two extra taps and buys a hillside with detail on it
 * at every angle.
 *
 * The wall projections sample at a coarser spacing than the floor one, because a vertical face has no
 * floor projection to fall back on and at full density a nine-metre tile turns into fine stripes down
 * its own length.
 */
function triplanarAlbedo(source: Texture, key: LayerKey, scale = 1): Node<"vec4"> {
  const tile = float(GROUND_TILE[key] * scale);
  const axis = abs(normalWorldGeometry).pow(4);
  const weight = axis.div(axis.x.add(axis.y).add(axis.z));
  const x = texture(source, positionWorld.zy.div(tile));
  const y = texture(source, positionWorld.xz.div(tile));
  const z = texture(source, positionWorld.xy.div(tile));
  return weight.x.mul(x).add(weight.y.mul(y)).add(weight.z.mul(z)) as Node<"vec4">;
}

/**
 * A third of a metre of ground grain, as a tilt in world space.
 *
 * The last scale of detail on the ground is not a texture: it is the difference between a surface
 * that is *smooth* and one that is *smooth at a hundred metres*. One fractal noise field, differenced
 * into a gradient, gives it for the price of four instructions and no sampler at all — and the ground
 * material is already at eleven sampled textures, so a twelfth map is not available however much this
 * detail wants it.
 *
 * It is deliberately faint. This is a third of a metre of clumping between the blades, not the blades
 * themselves, and the capture that showed a speckled meadow is what happens when it is not: a normal
 * perturbation this high-frequency reads as static underfoot and as noise at any distance, and it
 * costs the eye the thing it was added for.
 */
function microGrain(): Node<"vec3"> {
  const field = (p: Node<"vec3">) => mx_fractal_noise_float(p.mul(2.6), 2, 2, 0.5);
  const here = field(positionWorld);
  const step = float(0.22);
  const dx = here.sub(field(positionWorld.add(vec3(step, 0, 0))));
  const dz = here.sub(field(positionWorld.add(vec3(0, 0, step))));
  return vec3(dx, 0, dz).div(step).mul(0.06);
}

/**
 * The ground material: one lit surface whose colour is a blend of six PBR layers, blended in weight
 * order outwards from the base surface.
 */
export function createGroundMaterial(
  data: IBakedWorld,
  maps: Partial<Record<LayerKey, ILayerMaps>>,
  curvature: IGroundCurvature,
  biome?: IBiome,
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.94 });
  material.userData.biome = biome?.world ?? "forest";
  const held = new Set<Texture>([curvature.texture]);
  const layer = (key: LayerKey): ILayerMaps => {
    const found = maps[key];
    if (!found?.diffuse) throw new RangeError(`Ground layer '${key}' has no diffuse texture`);
    return found;
  };

  const otherBiome = biome !== undefined && biome.world !== "forest" && biome.world !== "coastal";
  const macro = mx_fractal_noise_float(vec3(positionWorld.x, 0, positionWorld.z).mul(0.014), 3);
  const mottling = mx_noise_float(vec3(positionWorld.x, 0, positionWorld.z).mul(0.045));

  // --- where each surface sits -------------------------------------------------------------
  const slope = normalWorldGeometry.y.abs().oneMinus();
  const breakUp = mx_fractal_noise_float(positionWorld.mul(0.05), 3);
  const steep = clamp(slope.add(breakUp.mul(0.05)), 0, 1);
  // +1 in a hollow, -1 on a rib. The two ends of the ground's own shape, which slope cannot tell
  // apart: a gully and a nose are both steep, and they are not the same surface.
  const outside = max(abs(positionWorld.x), abs(positionWorld.z));
  const hollow = curvature.node.mul(
    oneMinus(smoothstep(data.size / 2, data.size / 2 + 28, outside)),
  );
  // Material placement follows the actual landform, never the bake's brown blob palette.
  const drainage = smoothstep(0.04, 0.3, hollow).mul(smoothstep(0.003, 0.05, steep));
  const rib = smoothstep(-0.02, -0.45, hollow);
  const alpine = smoothstep(38, 66, positionWorld.y.add(breakUp.mul(5)));
  // No recorded sea level means an inland world, and an inland world has no beach.
  const sand =
    data.waterLevel === null
      ? float(0)
      : smoothstep(float(SHORE.beach), float(SHORE.wet), positionWorld.y).mul(
          smoothstep(0.34, 0.1, steep),
        );
  /**
   * How wet the sand under this fragment is, 0..1: one at the sea surface, gone `WET_SAND.band`
   * metres above it.
   *
   * The band is broken by the same slow noise the litter uses so the high-water mark is a ragged edge
   * rather than a contour line — the same reason the foam's outer edge wanders in `ocean.ts`.
   */
  const wetness = (): Node<"float"> => {
    if (data.waterLevel === null) return float(0);
    const above = positionWorld.y.sub(float(data.waterLevel));
    const wander = mx_fractal_noise_float(positionWorld.mul(0.06), 3).mul(0.55).add(0.5);
    return float(1).sub(
      smoothstep(float(0), float(otherBiome ? 1.6 : WET_SAND.band), above.div(wander)),
    );
  };
  const weights: Record<LayerKey, Node<"float">> = {
    // The bake painted its beach in the same red-over-green as its dirt, so the height rule above
    // has to be the one that speaks for the shore; painted dirt steps aside where it does.
    dirt: max(
      drainage.mul(0.18),
      smoothstep(0.025, 0.18, steep)
        .mul(smoothstep(-0.12, 0.32, breakUp))
        .mul(0.48),
    ).mul(sand.oneMinus()),
    grass: float(1),
    moss: drainage.mul(smoothstep(0.02, 0.14, steep)).mul(0.24),
    sand,
    // Rock shows where the ground is steep *and* convex — the nose of a rib, the face of a scarp. On a
    // concave slope the ground is covered by what has fallen into it, which is the moss above, so the
    // steepness term is scaled down in a hollow rather than replaced: bare rock still shows at a
    // scarp's foot where the ground is steep and the debris has not arrived yet.
    // Soil holds on ordinary hills; only scarps expose bedrock (34–48 degrees).
    rock: smoothstep(0.12, 0.3, steep.add(rib.mul(0.04)).add(breakUp.mul(0.025)))
      .mul(mix(0.65, 1, smoothstep(12, 70, positionWorld.y)))
      .mul(oneMinus(smoothstep(0.15, 0.8, hollow).mul(0.25))),
    snow: smoothstep(float(SNOW.from), float(SNOW.to), positionWorld.y).mul(
      smoothstep(SNOW.sheds, 0.06, steep),
    ),
  };

  if (biome) Object.assign(weights, biomeWeights(biome, steep, hollow, breakUp));
  if (!otherBiome) {
    // Real surface patches survive the cover cull; colour noise alone left an uninterrupted lawn.
    const dry = smoothstep(0.14, 0.42, macro.add(mottling.mul(0.85)).sub(hollow.mul(0.12)));
    weights.dirt = max(weights.dirt, dry.mul(0.7)).mul(sand.oneMinus());
    weights.moss = max(
      weights.moss,
      smoothstep(-0.14, -0.38, macro.add(mottling.mul(0.4))).mul(0.42),
    )
      .mul(sand.oneMinus())
      .mul(oneMinus(weights.rock));
  }

  // --- how each surface looks -------------------------------------------------------------
  // The layers that cover most of a meadow take a second, larger scale faded in with distance: one
  // tile under the player's feet, a coarser one near the horizon, and no single lattice for the eye
  // to find anywhere between.
  const far = smoothstep(float(10), float(70), positionView.length());
  const patch = smoothstep(-0.35, 0.35, mx_noise_float(positionWorld.mul(0.025)));
  const tileBlend = mix(patch.mul(0.65), patch.mul(0.5).add(0.25), far);
  // How much of a layer is projected onto the ground plane and how much onto the walls. Zero on the
  // meadow, one on a cliff, and eased across the thirty-five degrees where a planar projection stops
  // being an approximation and becomes a smear.
  const planarShare = float(1).sub(
    smoothstep(float(TRIPLANAR_SLOPE * 0.55), float(TRIPLANAR_SLOPE * 1.6), steep),
  );

  /**
   * One layer's albedo: the ground plane near the camera, the walls on a slope, and a coarser tile
   * faded in with distance so the horizon is not a field of half-resolved texels.
   *
   * The two planar scales are what the last captures' "flat green tint" was not: a single scale at
   * 2.6 m is a dozen pixels wide from fifty metres away, and the middle distance goes to a wash. The
   * two are blended rather than switched so the crossover has no seam to find.
   */
  const flatLayer = (key: LayerKey): boolean => key !== "rock" && key !== "sand";

  // Keep colour and tangent relief on the same rotated projections and scales.
  const rockTap = (source: Texture, plane: Node<"vec2">, relief = false): Node<"vec4"> => {
    const tap = (scale: number, angle: number, offset: Node<"vec2">) => {
      const sampled = texture(
        source,
        rotateUV(plane.div(scale), float(angle), vec2(0)).add(offset),
      );
      if (!relief) return sampled;
      const tangent = rotateUV(sampled.xy.mul(2).sub(1), float(-angle), vec2(0));
      return vec4(tangent, sampled.z.mul(2).sub(1), 1);
    };
    return biome?.world === "alpine"
      ? mix(tap(3.8, 0.17, vec2(0)), tap(24, -0.21, vec2(0.37, 0.61)), patch.mul(0.3).add(0.2))
      : mix(tap(6.7, 0.57, vec2(0)), tap(11.3, -0.83, vec2(0.37, 0.61)), patch);
  };
  const albedoOf = (key: LayerKey): Node<"vec4"> => {
    const { diffuse } = layer(key);
    held.add(diffuse);
    const flat = mix(
      texture(diffuse, tiledUV(key)),
      texture(diffuse, tiledUV(key, 2.35)),
      tileBlend,
    );
    if (otherBiome && biome.world === "tundra" && key === "dirt")
      return vec4(flat.rgb.mul(vec3(0.7, 0.58, 0.42)), flat.a);
    if (otherBiome && biome.world === "tundra" && key === "moss")
      return vec4(flat.rgb.mul(vec3(0.85, 1.15, 0.48)), flat.a);
    if (flatLayer(key))
      return key === "snow" && biome ? vec4(flat.rgb.mul(vec3(...biome.snowTint)), flat.a) : flat;
    const walls =
      otherBiome && key === "rock"
        ? (() => {
            // Two rotated, incommensurate projections break the photographed tile lattice.
            const axis = abs(normalWorldGeometry).pow(4);
            const share = axis.div(axis.x.add(axis.y).add(axis.z));
            return share.x
              .mul(rockTap(diffuse, positionWorld.zy))
              .add(share.y.mul(rockTap(diffuse, positionWorld.xz)))
              .add(share.z.mul(rockTap(diffuse, positionWorld.xy))) as Node<"vec4">;
          })()
        : triplanarAlbedo(diffuse, key);
    const blended = key === "rock" ? walls : mix(walls, flat, planarShare);
    // The wet band, applied to the sand only. It belongs here rather than in the layer blend below
    // because it is a *height* fact about the water's last reach, not a weight another surface has.
    if (key === "rock") {
      const grey = dot(blended.rgb, vec3(0.2126, 0.7152, 0.0722));
      let stone = mix(blended.rgb, vec3(grey), otherBiome ? 0.25 : 0.35).mul(
        vec3(...(otherBiome ? biome.stoneTint : [0.44, 0.46, 0.42])),
      );
      if (otherBiome && biome.world === "desert") {
        const band = positionWorld.y
          .sub(2)
          .mul(Math.PI / 5.3)
          .add(mx_noise_float(positionWorld.mul(0.035)).mul(0.9))
          .sin()
          .mul(0.5)
          .add(0.5);
        stone = vec3(grey)
          .mul(vec3(1.65, 0.86, 0.43))
          .mul(mix(vec3(0.56, 0.39, 0.27), vec3(1.12, 1.02, 0.85), smoothstep(0.18, 0.62, band)));
      }
      if (otherBiome && biome.world === "alpine") {
        const seams = positionWorld.y
          .mul(0.34)
          .add(positionWorld.x.mul(0.11))
          .add(positionWorld.z.mul(0.07))
          .add(mx_fractal_noise_float(positionWorld.mul(0.075), 3).mul(5))
          .sin();
        stone = stone.mul(float(1).sub(smoothstep(0.85, 0.97, seams).mul(0.22)));
      }
      // Resolved stone underfoot; broad weathering once the photograph's repeats become visible.
      const weathering = mx_noise_float(positionWorld.mul(0.012)).mul(0.15).add(1);
      const distant = vec3(...(otherBiome ? biome.distantStone : [0.16, 0.17, 0.155])).mul(
        weathering,
      );
      return vec4(
        mix(
          stone,
          distant,
          smoothstep(35, 220, positionView.length()).mul(otherBiome ? 0.28 : 0.65),
        ),
        blended.a,
      );
    }
    if (key !== "sand" || data.waterLevel === null) return blended;
    const wet = wetness();
    const wrack = otherBiome
      ? float(0)
      : oneMinus(
          smoothstep(
            0.07,
            0.21,
            positionWorld.y
              .sub(2.1)
              .sub(mx_noise_float(positionWorld.mul(0.05)).mul(0.5))
              .abs(),
          ),
        ).mul(smoothstep(-0.1, 0.15, mx_noise_float(positionWorld.mul(0.65))));
    const sandColor = otherBiome
      ? blended.rgb
      : mix(blended.rgb, vec3(dot(blended.rgb, vec3(0.2126, 0.7152, 0.0722))), 0.55).mul(
          vec3(1.95, 1.82, 1.55),
        );
    return vec4(
      sandColor
        .mul(mix(vec3(1), vec3(0.45, 0.37, 0.24), wrack))
        .mul(mix(float(1), otherBiome ? vec3(0.52, 0.5, 0.55) : WET_SAND.darken, wet)),
      blended.a,
    );
  };

  // The relief takes the same scales as the colour, or the ground keeps its detail underfoot and goes
  // flat past twenty metres.
  const reliefOf = (key: LayerKey, strength: number): IRelief => {
    const source = layer(key).normal;
    if (source === undefined) return { crevice: float(1), tilt: vec3(0) };
    held.add(source);
    if (key === "rock") {
      const walls = otherBiome
        ? (() => {
            const axis = abs(normalWorldGeometry).pow(4);
            const share = axis.div(axis.x.add(axis.y).add(axis.z));
            const x = rockTap(source, positionWorld.zy, true);
            const y = rockTap(source, positionWorld.xz, true);
            const z = rockTap(source, positionWorld.xy, true);
            return {
              crevice: float(1),
              tilt: share.x
                .mul(vec3(0, x.y, x.x.mul(sign(normalWorldGeometry.x))))
                .add(share.y.mul(vec3(y.x, 0, y.y)))
                .add(share.z.mul(vec3(z.x.mul(sign(normalWorldGeometry.z)), z.y, 0))),
            };
          })()
        : triplanarRelief(source, key);
      return {
        crevice: walls.crevice,
        tilt: walls.tilt
          .mul(strength)
          .mul(mix(1, otherBiome ? 0.45 : 0.18, smoothstep(24, 160, positionView.length()))),
      };
    }
    const near = planarRelief(source, tiledUV(key), strength);
    const coarse = planarRelief(source, tiledUV(key, 2.35), strength * 0.6);
    const flat: IRelief = {
      crevice: mix(near.crevice, coarse.crevice, tileBlend),
      tilt: mix(near.tilt, coarse.tilt, tileBlend),
    };
    if (flatLayer(key)) return flat;
    // Rock's strata are metres across, so its wall projection samples at its own tile size; grass and
    // dirt sample at theirs, which is why a cliff's grass fringe keeps the same grain as the meadow.
    const walls = triplanarRelief(source, key, 0.55);
    const blended: IRelief = {
      crevice: mix(walls.crevice, flat.crevice, planarShare),
      tilt: mix(walls.tilt.mul(strength), flat.tilt, planarShare),
    };
    // Sand has no normal map at all, so its relief is entirely the ripple field below — and the
    // ripples flatten in the wet band, because wet sand is packed and the sea has ironed them out.
    return key === "sand"
      ? {
          ...blended,
          tilt: blended.tilt.add(sandRipples().mul(float(1).sub(wetness().mul(WET_SAND.calm)))),
        }
      : blended;
  };

  const grassRelief = reliefOf("grass", 0.38);
  // Metre-scale tufts survive the grass photograph's mips beyond individual blades.
  const cover = mx_fractal_noise_float(vec3(positionWorld.x, 0, positionWorld.z).mul(0.75), 2)
    .mul(0.55)
    .add(1);
  const meadowDry = smoothstep(-0.2, 0.24, macro.add(mottling.mul(0.6)).sub(hollow.mul(0.18)));
  const meadowValue = mix(0.62, 1.18, smoothstep(0.6, -0.6, hollow));
  const flowers = smoothstep(0.3, 0.47, mx_noise_float(positionWorld.mul(0.95))).mul(
    smoothstep(0.05, 0.3, mottling),
  );
  const farGrass = mix(vec3(0.025, 0.055, 0.013), vec3(0.12, 0.105, 0.035), meadowDry)
    .mul(cover)
    .mul(meadowValue)
    .add(vec3(0.11, 0.09, 0.04).mul(flowers));
  // Beyond readable blades, keep their green in the ground instead of exposing olive thatch.
  // Other biomes keep their own ground tint; the green far-field belongs to the temperate meadow.
  let albedo: Node<"vec4"> = otherBiome
    ? albedoOf("grass").mul(vec3(...biome.grassTint))
    : vec4(
        mix(
          albedoOf("grass").rgb.mul(MEADOW),
          farGrass,
          smoothstep(32, 115, positionView.length()).mul(0.86),
        ),
        1,
      );
  if (biome?.world === "alpine") {
    // Keep unresolved grass texels out of the alpine horizon.
    const distantCover = vec3(0.075, 0.12, 0.028)
      .mul(cover)
      .mul(mix(0.85, 1.12, patch));
    albedo = vec4(
      mix(albedo.rgb, distantCover, smoothstep(65, 160, positionView.length()).mul(0.85)),
      1,
    );
  }
  // Three scales of relief on the meadow, not two: a metre of detail normal under the player's feet,
  // the tile's own scale at reading distance, and a decimetre of grain so the ground nearest the eye
  // is not smooth between the blades. The finest is a noise field rather than a texture, because a
  // third sampler on the grass layer is a third of the budget for detail nobody can name.
  let normal = grassRelief.tilt
    .mul(weights.grass)
    .mul(biome?.world === "alpine" ? mix(1, 0.05, smoothstep(45, 130, positionView.length())) : 1)
    .add(microGrain().mul(oneMinus(smoothstep(12, 60, positionView.length()))));
  // The crevice term follows the surface the eye is actually looking at, so it is blended by the
  // same weights as the colour rather than applied to every layer at once.
  let snowCover: Node<"float"> = float(0);
  for (const key of LAYERS) {
    const weight = weights[key];
    // A surface takes the ground over once it *is* most of the ground. Blending every layer by a
    // share of the running total instead leaves a beach a third sand, a third grass and a third
    // dirt, which is mud with a texture on it.
    const surface = albedoOf(key);
    const relief = reliefOf(key, key === "rock" ? 0.52 : key === "snow" ? 0.18 : 0.32);
    // No displacement maps in these starter sets: normal relief breaks the blend edge,
    // while slope, elevation and curvature determine which surface belongs here.
    const reliefHeight = relief.crevice.sub(0.8).mul(0.12).add(breakUp.mul(0.045));
    // The photograph's relief and metre-scale breakup cut pockets into the soil/rock boundary.
    const rockHeight = dot(surface.rgb, vec3(0.2126, 0.7152, 0.0722))
      .sub(0.1)
      .mul(0.7)
      .add(mx_noise_float(positionWorld.mul(0.65)).mul(0.16));
    const over =
      key === "snow" && otherBiome
        ? weight.add(breakUp.mul(0.025)).clamp(0, 1)
        : key === "rock"
          ? smoothstep(0.34, 0.51, weight.add(rockHeight))
          : smoothstep(0.12, 0.82, weight.add(reliefHeight));
    if (key === "snow") snowCover = over;
    albedo = mix(albedo, surface, over);
    normal = mix(normal, relief.tilt, over);
  }
  // Concavity occludes sky bounce, leaving direct sunlight physically separate.
  material.aoNode = mix(float(1), float(0.88), smoothstep(0.2, 0.85, hollow));

  // 50–200 metre vegetation tones survive texture mipmapping in the overview.
  const dryness = otherBiome
    ? smoothstep(
        -0.18,
        0.22,
        mx_fractal_noise_float(positionWorld.mul(0.006), 3)
          .sub(hollow.mul(0.16))
          .add(alpine.mul(0.06)),
      )
    : smoothstep(
        -0.18,
        0.22,
        macro.add(mottling.mul(0.24)).sub(hollow.mul(0.035)).add(alpine.mul(0.06)),
      );
  const tone = otherBiome
    ? mix(vec3(0.92, 0.94, 0.91), vec3(1.08, 1.03, 0.95), dryness)
    : mix(vec3(0.72, 0.82, 0.63), vec3(1.08, 1.08, 0.88), dryness);
  const vegetation = oneMinus(max(max(weights.rock, weights.snow), weights.sand));
  const continuation = smoothstep(data.size / 2 + 60, data.size / 2 + 280, outside);
  const strata = mx_fractal_noise_float(positionWorld.mul(vec3(0.018, 0.035, 0.018)), 3);
  // Reuse the resident maps at massif scale: steep faces project onto their own axes.
  const forest = triplanarAlbedo(layer("grass").diffuse, "grass", 12)
    .rgb.mul(MEADOW)
    .mul(mix(0.5, 0.85, breakUp.add(0.5)));
  const crag = triplanarAlbedo(layer("rock").diffuse, "rock", 6)
    .rgb.mul(vec3(0.62, 0.66, 0.67))
    .mul(strata.mul(0.35).add(1));
  const treeline = smoothstep(110, 240, positionWorld.y.add(breakUp.mul(24)));
  const face = smoothstep(0.14, 0.3, steep.add(strata.mul(0.055)));
  const cap = smoothstep(225, 310, positionWorld.y.add(breakUp.mul(28))).mul(
    oneMinus(smoothstep(0.18, 0.42, steep)),
  );
  const snow = triplanarAlbedo(layer("snow").diffuse, "snow", 8).rgb;
  const mountain = mix(mix(forest, crag, max(treeline, face)), snow, cap);
  material.colorNode = mix(
    albedo.rgb.mul(mix(vec3(1), tone, vegetation)),
    otherBiome ? albedo.rgb : mountain,
    continuation,
  ).mul(mix(vec3(1), vec3(0.42, 0.46, 0.42), curvature.wetBank));
  material.roughnessNode = mix(
    otherBiome ? mix(0.94, 0.82, snowCover) : mix(0.84, 0.98, dryness),
    0.48,
    curvature.wetBank,
  );
  if (!otherBiome) {
    material.roughnessNode = mix(
      material.roughnessNode as Node<"float">,
      0.52,
      sand.mul(wetness()),
    );
    // A little albedo-coloured bounce keeps unlit rock faces legible without changing the sky rig.
    material.emissiveNode = (material.colorNode as Node<"vec3">).mul(
      weights.rock.max(continuation).mul(0.22),
    );
  }
  // Distant faces resolve broad rock strata, rather than subpixel meadow normals.
  const rockNormal = layer("rock").normal;
  const mountainTilt =
    rockNormal === undefined
      ? vec3(0)
      : triplanarRelief(rockNormal, "rock", 8).tilt.mul(face).mul(oneMinus(cap)).mul(0.32);
  const tilt = mix(normal, biome?.world === "alpine" ? vec3(0) : mountainTilt, continuation);
  // Detail is tangential; it must not rotate the whole hillside towards a fixed diagonal.
  const tangent = tilt.sub(normalWorldGeometry.mul(dot(normalWorldGeometry, tilt)));
  material.normalNode = transformNormalToView(normalize(normalWorldGeometry.add(tangent)));
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
  biome?: IBiome,
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
  const horizonGeometry = createHorizonGeometry(data, biome?.horizon);
  const edgePositions = horizonGeometry.getAttribute("position");
  const edgeNormals = horizonGeometry.getAttribute("normal");
  const groundNormals = geometry.getAttribute("normal");
  for (let vertex = 0; vertex < (data.resolution - 1) * 4; vertex++) {
    const column = Math.round(
      (edgePositions.getX(vertex) / data.size + 0.5) * (data.resolution - 1),
    );
    const row = Math.round((edgePositions.getZ(vertex) / data.size + 0.5) * (data.resolution - 1));
    const edge = row * data.resolution + column;
    edgeNormals.setXYZ(
      vertex,
      groundNormals.getX(edge),
      groundNormals.getY(edge),
      groundNormals.getZ(edge),
    );
  }
  const horizon: Mesh = new Mesh(horizonGeometry, material);
  horizon.name = "temperate-distant-ridges";
  horizon.receiveShadow = true;
  mesh.add(horizon);
  geometry.addEventListener("dispose", () => horizon.geometry.dispose());

  const curvature = buildCurvature(data, field);
  if (assets !== undefined)
    void loadGroundMaps(
      assets,
      biome?.world === "forest" || biome?.world === "coastal" || biome === undefined
        ? { ...(biome?.maps ?? GROUND_MAPS), rock: ROCKFACE_MAPS }
        : biome.maps,
    )
      .then((maps) => createGroundMaterial(data, maps, curvature, biome))
      .then((ground) => {
        // Anything but the flat placeholder means the scene already moved on; a material nothing
        // draws holds GPU memory until its textures are released.
        if (mesh.material !== material) return ground.dispose();
        mesh.material = ground;
        horizon.material = ground;
        material.dispose();
      })
      // A map that never arrives, or a set this material cannot bind, leaves the ground on its
      // baked vertex colours. It must still collide and still draw.
      .catch(() => undefined);
  return { field, mesh };
}

/**
 * Cook the heightfield's own curvature into a texture the ground material can read.
 *
 * A five-point Laplacian over the baked samples, evaluated once on the CPU and stored as half floats:
 * `h(-1) + h(+1) + h(-w) + h(+w) - 4h(0)`, which is positive in a hollow and negative on a rib. The
 * divisor is the sample spacing squared, so the number is in 1/m and does not change meaning when the
 * world's resolution does, and the gain is chosen so a valley a few metres deep reads near +1.
 *
 * Half float rather than byte because the range matters: a byte would quantise the sign of a
 * near-flat field into blocks, and the sign is the whole of the answer.
 *
 * One curvature binding plus six albedos, four normals and four shadow maps is fifteen.
 */
function buildCurvature(data: IBakedWorld, field: Heightfield): IGroundCurvature {
  const resolution = data.resolution;
  const heights = data.heights;
  const spacing = data.size / (resolution - 1);
  const at = (row: number, column: number): number =>
    heights[
      Math.min(resolution - 1, Math.max(0, row)) * resolution +
        Math.min(resolution - 1, Math.max(0, column))
    ] as number;
  const lakes = (data.lakes ?? []).map((lake) => ({
    ...lake,
    reach: waterlineRadius(field, lake.at, lake.level),
  }));
  const rivers = (data.rivers ?? []).flatMap((river) => {
    const levels = surfaceHeights(field, river.points);
    return river.points.map(([x = 0, , z = 0], index) => ({
      x,
      z,
      level: levels[index] as number,
    }));
  });
  // Both channels share one sampler: measured concavity and the water's actual wet margin.
  const pixels = new Uint16Array(resolution * resolution * 2);
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const laplacian =
        at(row, column - 4) +
        at(row, column + 4) +
        at(row - 4, column) +
        at(row + 4, column) -
        4 * at(row, column);
      // An eight-metre neighbourhood picks out channels and hollows, suppressing tiny baked bumps.
      const index = (row * resolution + column) * 2;
      pixels[index] = DataUtils.toHalfFloat(
        Math.max(-1, Math.min(1, (laplacian / (spacing * spacing * 16)) * 36)),
      );
      const x = column * spacing - data.size / 2;
      const z = row * spacing - data.size / 2;
      const height = at(row, column);
      const margin = (level: number): number =>
        Math.max(0, Math.min(1, (level + 1.1 - height) / 1.1));
      let wet = 0;
      for (const lake of lakes) {
        const distance = Math.hypot(x - (lake.at[0] ?? 0), z - (lake.at[1] ?? 0));
        if (distance <= lake.reach + 3) wet = Math.max(wet, margin(lake.level));
      }
      for (const station of rivers) {
        if (Math.hypot(x - station.x, z - station.z) <= 13)
          wet = Math.max(wet, margin(station.level));
      }
      pixels[index + 1] = DataUtils.toHalfFloat(wet);
    }
  }
  const cooked = new DataTexture(pixels, resolution, resolution, RGFormat, HalfFloatType);
  cooked.minFilter = LinearFilter;
  cooked.magFilter = LinearFilter;
  cooked.wrapS = ClampToEdgeWrapping;
  cooked.wrapT = ClampToEdgeWrapping;
  cooked.needsUpdate = true;
  const uv = vec2(
    positionWorld.x.div(float(data.size)).add(0.5),
    positionWorld.z.div(float(data.size)).add(0.5),
  );
  const sampled = texture(cooked, uv);
  // A clamped wet boundary texel must not become a stripe across the continuation mesh.
  const outside = max(abs(positionWorld.x), abs(positionWorld.z));
  const resident = oneMinus(smoothstep(data.size / 2 - spacing * 2, data.size / 2, outside));
  return { node: sampled.r, texture: cooked, wetBank: sampled.g.mul(resident) };
}

/**
 * Every starter map the ground binds, keyed by layer.
 *
 * Albedo is colour data and everything else is linear, so the loader is told which is each: a
 * normal map read as sRGB bends its own channels and the ground loses the relief it was cooked with.
 */
async function loadGroundMaps(
  assets: IAssetLoader,
  pathsByLayer = GROUND_MAPS,
): Promise<Partial<Record<LayerKey, ILayerMaps>>> {
  const layers = await Promise.all(
    Object.entries(pathsByLayer).map(async ([key, paths]) => {
      // A layer without its albedo has no place in the blend, so the set comes back without it.
      let diffuse = await get(assets, paths.diffuse, false);
      let chosen = paths;
      if (diffuse === undefined && paths.diffuse.startsWith("temperate/")) {
        chosen = GROUND_MAPS[key as LayerKey];
        diffuse = await get(assets, chosen.diffuse, false);
      }
      if (diffuse === undefined) return undefined;
      const maps: ILayerMaps = { diffuse };
      for (const [slot, path] of Object.entries(chosen)) {
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
