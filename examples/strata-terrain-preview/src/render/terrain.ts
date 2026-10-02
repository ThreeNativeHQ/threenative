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
  RedFormat,
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
import { createHorizonGeometry } from "./horizon.js";

export interface IBakedWorld {
  size: number;
  resolution: number;
  heights: number[];
  colors: number[];
  waterLevel: number | null;
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
  band: 1.6,
  /** How much darker and how much more saturated the wet sand is. */
  darken: vec3(0.52, 0.5, 0.55),
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
const MEADOW = vec3(0.43, 0.76, 0.38);

/** Continuous stochastic warp: no hard cell boundaries in colour or normals. */
function tiledUV(key: LayerKey, scale = 1): Node<"vec2"> {
  const base = positionWorld.xz.div(TILE[key] * scale);
  const warp = vec2(
    mx_noise_float(positionWorld.mul(0.035)),
    mx_noise_float(positionWorld.mul(0.035).add(vec3(17, 0, 29))),
  );
  return rotateUV(base, float(0.38), vec2(0)).add(warp.mul(0.7));
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
  const tile = float(TILE[key]).mul(roughnessScale);
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
function triplanarAlbedo(source: Texture, key: LayerKey): Node<"vec4"> {
  const tile = float(TILE[key]);
  const wall = tile.mul(0.7);
  const axis = abs(normalWorldGeometry).pow(4);
  const weight = axis.div(axis.x.add(axis.y).add(axis.z));
  const x = texture(source, positionWorld.zy.div(wall));
  const y = texture(source, positionWorld.xz.div(tile));
  const z = texture(source, positionWorld.xy.div(wall));
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
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ metalness: 0, roughness: 0.94 });
  const held = new Set<Texture>([curvature.texture]);
  const layer = (key: LayerKey): ILayerMaps => {
    const found = maps[key];
    if (!found?.diffuse) throw new RangeError(`Ground layer '${key}' has no diffuse texture`);
    return found;
  };

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
    return float(1).sub(smoothstep(float(0), float(WET_SAND.band), above.div(wander)));
  };
  const weights: Record<LayerKey, Node<"float">> = {
    // The bake painted its beach in the same red-over-green as its dirt, so the height rule above
    // has to be the one that speaks for the shore; painted dirt steps aside where it does.
    dirt: drainage.mul(0.4).mul(sand.oneMinus()),
    grass: float(1),
    moss: drainage.mul(smoothstep(0.02, 0.14, steep)).mul(0.48),
    sand,
    // Rock shows where the ground is steep *and* convex — the nose of a rib, the face of a scarp. On a
    // concave slope the ground is covered by what has fallen into it, which is the moss above, so the
    // steepness term is scaled down in a hollow rather than replaced: bare rock still shows at a
    // scarp's foot where the ground is steep and the debris has not arrived yet.
    rock: max(
      smoothstep(0.065, 0.25, steep.add(rib.mul(0.035))),
      alpine.mul(smoothstep(0.018, 0.13, steep)).mul(0.8),
    ),
    snow: smoothstep(float(SNOW.from), float(SNOW.to), positionWorld.y).mul(
      smoothstep(SNOW.sheds, 0.06, steep),
    ),
  };

  // --- how each surface looks -------------------------------------------------------------
  // The layers that cover most of a meadow take a second, larger scale faded in with distance: one
  // tile under the player's feet, a coarser one near the horizon, and no single lattice for the eye
  // to find anywhere between.
  const far = smoothstep(float(14), float(52), positionView.length()).mul(0.35);
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
  const flatLayer = (key: LayerKey): boolean => key === "snow";

  const albedoOf = (key: LayerKey): Node<"vec4"> => {
    const { diffuse } = layer(key);
    held.add(diffuse);
    const flat = mix(texture(diffuse, tiledUV(key)), texture(diffuse, tiledUV(key, 2.35)), far);
    if (flatLayer(key)) return flat;
    const walls = triplanarAlbedo(diffuse, key);
    const blended = mix(walls, flat, planarShare);
    // The wet band, applied to the sand only. It belongs here rather than in the layer blend below
    // because it is a *height* fact about the water's last reach, not a weight another surface has.
    if (key === "rock") {
      const grey = dot(blended.rgb, vec3(0.2126, 0.7152, 0.0722));
      return vec4(mix(blended.rgb, vec3(grey), 0.65).mul(vec3(0.85, 0.9, 0.94)), blended.a);
    }
    if (key !== "sand" || data.waterLevel === null) return blended;
    const wet = wetness();
    return vec4(blended.rgb.mul(mix(float(1), WET_SAND.darken, wet)), blended.a);
  };

  // The relief takes the same scales as the colour, or the ground keeps its detail underfoot and goes
  // flat past twenty metres.
  const reliefOf = (key: LayerKey, strength: number): IRelief => {
    const source = layer(key).normal;
    if (source === undefined) return { crevice: float(1), tilt: vec3(0) };
    held.add(source);
    const near = planarRelief(source, tiledUV(key), strength);
    const coarse = planarRelief(source, tiledUV(key, 2.35), strength * 0.6);
    const flat: IRelief = {
      crevice: mix(near.crevice, coarse.crevice, far),
      tilt: mix(near.tilt, coarse.tilt, far),
    };
    if (flatLayer(key)) return flat;
    // Rock's strata are metres across, so its wall projection samples at its own tile size; grass and
    // dirt sample at theirs, which is why a cliff's grass fringe keeps the same grain as the meadow.
    const walls = triplanarRelief(source, key, key === "rock" ? 1 : 0.55);
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
  let albedo = albedoOf("grass").mul(MEADOW);
  // Three scales of relief on the meadow, not two: a metre of detail normal under the player's feet,
  // the tile's own scale at reading distance, and a decimetre of grain so the ground nearest the eye
  // is not smooth between the blades. The finest is a noise field rather than a texture, because a
  // third sampler on the grass layer is a third of the budget for detail nobody can name.
  let normal = grassRelief.tilt.mul(weights.grass).add(microGrain().mul(weights.grass));
  // The crevice term follows the surface the eye is actually looking at, so it is blended by the
  // same weights as the colour rather than applied to every layer at once.
  for (const key of LAYERS) {
    const weight = weights[key];
    // A surface takes the ground over once it *is* most of the ground. Blending every layer by a
    // share of the running total instead leaves a beach a third sand, a third grass and a third
    // dirt, which is mud with a texture on it.
    const surface = albedoOf(key);
    const relief = reliefOf(key, key === "rock" ? 0.52 : 0.32);
    // No displacement maps in these starter sets: normal relief breaks the blend edge,
    // while slope, elevation and curvature determine which surface belongs here.
    const reliefHeight = relief.crevice.sub(0.8).mul(0.12).add(breakUp.mul(0.045));
    const over = smoothstep(0.12, 0.82, weight.add(reliefHeight));
    albedo = mix(albedo, surface, over);
    normal = mix(normal, relief.tilt, over);
  }
  // Concavity occludes sky bounce, leaving direct sunlight physically separate.
  material.aoNode = mix(float(1), float(0.65), smoothstep(0.12, 0.8, hollow));

  // 50–200 metre vegetation tones survive texture mipmapping in the overview.
  const macro = mx_fractal_noise_float(positionWorld.mul(0.006), 3);
  const dryness = smoothstep(-0.18, 0.22, macro.sub(hollow.mul(0.16)).add(alpine.mul(0.06)));
  const tone = mix(vec3(0.52, 0.82, 0.46), vec3(1.23, 1.06, 0.83), dryness);
  const vegetation = oneMinus(max(max(weights.rock, weights.snow), weights.sand));
  material.colorNode = albedo.rgb.mul(mix(vec3(1), tone, vegetation));
  // Detail is tangential; it must not rotate the whole hillside towards a fixed diagonal.
  const tangent = normal.sub(normalWorldGeometry.mul(dot(normalWorldGeometry, normal)));
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
  const horizonGeometry = createHorizonGeometry(data);
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

  const curvature = buildCurvature(data);
  if (assets !== undefined)
    void loadGroundMaps(assets)
      .then((maps) => createGroundMaterial(data, maps, curvature))
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
 * This costs one sampler. That is the seventeenth the ground material would like and the sixteenth it
 * gets — it binds six albedos and four normal maps already — so it is paid for by giving up the
 * second planar albedo scale on the two layers that never need it, below.
 */
function buildCurvature(data: IBakedWorld): IGroundCurvature {
  const resolution = data.resolution;
  const heights = data.heights;
  const spacing = data.size / (resolution - 1);
  const at = (row: number, column: number): number =>
    heights[
      Math.min(resolution - 1, Math.max(0, row)) * resolution +
        Math.min(resolution - 1, Math.max(0, column))
    ] as number;
  const pixels = new Uint16Array(resolution * resolution);
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const laplacian =
        at(row, column - 4) +
        at(row, column + 4) +
        at(row - 4, column) +
        at(row + 4, column) -
        4 * at(row, column);
      // An eight-metre neighbourhood picks out channels and hollows, suppressing tiny baked bumps.
      pixels[row * resolution + column] = DataUtils.toHalfFloat(
        Math.max(-1, Math.min(1, (laplacian / (spacing * spacing * 16)) * 36)),
      );
    }
  }
  const cooked = new DataTexture(pixels, resolution, resolution, RedFormat, HalfFloatType);
  cooked.minFilter = LinearFilter;
  cooked.magFilter = LinearFilter;
  cooked.wrapS = ClampToEdgeWrapping;
  cooked.wrapT = ClampToEdgeWrapping;
  cooked.needsUpdate = true;
  const uv = vec2(
    positionWorld.x.div(float(data.size)).add(0.5),
    positionWorld.z.div(float(data.size)).add(0.5),
  );
  return { node: texture(cooked, uv).r, texture: cooked };
}

/**
 * Every starter map the ground binds, keyed by layer.
 *
 * Albedo is colour data and everything else is linear, so the loader is told which is each: a
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
