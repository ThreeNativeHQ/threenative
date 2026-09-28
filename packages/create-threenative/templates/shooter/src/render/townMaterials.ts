// Bayview's surfaces: white-washed plaster, weathered render, blue corrugated
// joinery, flagged stone lanes, concrete trim, quay masonry and plank decking.
//
// ## Why every surface is world-projected
//
// town.ts builds each solid as `new BoxGeometry(w, h, d)` and hands it ONE
// material. A box's UVs run 0..1 on every face, so a texture `repeat` of (n, n)
// puts n tiles across a face whatever that face actually measures. The old
// "pre-tiled variant" scheme picked n from the building's longest side, which
// made two errors at once:
//
//   * Across faces. The 30 x 14 x 6.4 m south block took n = 6 from its 30 m
//     side, so its 30 m wall got a 5 m tile (right) and its 14 m return got a
//     2.3 m tile — the same plaster at two scales on one building, and a third
//     scale on the neighbour that happened to round to a different variant.
//   * Across the vertical. The variant's V repeat was
//     `round(repeats * tileMetres / tileMetres)`, which is just `repeats`. Wall
//     height never entered it, so that 6.4 m-tall wall also got 6 tiles top to
//     bottom: a 1.07 m tile vertically against a 5 m tile horizontally, i.e.
//     the plaster photo stretched to a 4.7:1 aspect. Stretched-out stucco with
//     no relief is exactly what "the texture looks really odd" describes, and
//     it applied to all thirty buildings, both plazas and the quay.
//
// A `repeat` cannot express "one tile per N metres" on a box, so this file does
// not try. Every textured surface is a `MeshStandardNodeMaterial` whose maps are
// sampled triplanar from WORLD position, at a fixed metres-per-tile. Face size,
// building size and mesh orientation drop out of the result: one metre of wall
// is one metre of texture everywhere in the town, and neighbouring buildings
// agree because they read the same world-space field. The `plaster(size)` /
// `brick(size)` signature is kept so town.ts is untouched; the argument is now
// ignored, because there is nothing left for it to select.
//
// ## Constraints this file has to respect
//
//   * `CanvasTexture` samples BLACK under `WebGPURenderer`, so no map here is
//     ever painted procedurally. Variation comes from TSL noise instead, which
//     is evaluated in the shader and never touches a 2D canvas.
//   * Node materials need the WebGPU renderer. The framework's WebGL2 fallback
//     cannot draw them — the same is already true of `renderer.setOutputNode`,
//     which `@threenative/core` refuses on any other backend.
//   * A `THREE.Line` cannot take a node material here, so the mast/wire material
//     stays a plain `MeshStandardMaterial`.
//   * `{ normalMap: undefined }` is not the same as omitting the key: Three logs
//     "parameter 'normalMap' has value of undefined" for the explicit one. The
//     old crate and deck materials passed it that way and printed the warning
//     twice on every boot; nothing here passes a key it does not have a map for.
import {
  DoubleSide,
  FrontSide,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Material,
  type Texture,
} from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  Fn,
  max,
  min,
  select,
  vec4,
} from "three/tsl";
import {
  color,
  float,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalMap,
  normalWorldGeometry,
  pmremTexture,
  positionWorld,
  saturate,
  saturation,
  smoothstep,
  texture,
  triplanarTexture,
  vec2,
  vec3,
} from "three/tsl";

/** A colour map with the optional linear-space maps that dress it. */
export type SurfaceMaps = {
  readonly map: Texture;
  readonly normal?: Texture;
  readonly rough?: Texture;
  /**
   * Baked occlusion, multiplied straight into the albedo rather than routed
   * through `aoNode`. Under a midday key the joints between paving flags get
   * almost as much light as the flags do, so a correct AO term — which only
   * touches indirect light — barely darkens them and the whole lane reads as
   * one smooth sheet. Darkening the colour is the cheat that puts the joints
   * back, and on a surface this rough nobody can tell.
   */
  readonly ao?: Texture;
};

export type TownTextures = {
  /** Whitewashed stucco: every lane-facing wall in the town. */
  readonly plaster: SurfaceMaps;
  /** Weathered render over brick: the aged accent buildings. */
  readonly brick: SurfaceMaps;
  /** Flagged stone paving: the plazas and the quay walk. */
  readonly floor: SurfaceMaps;
  /**
   * Fan-pattern granite setts for the streets. The maps are 2:1, so this set
   * is optional only until `Play.ts` loads it — the street material falls back
   * to the flagstone until then.
   */
  readonly paving?: SurfaceMaps;
  /** Poured concrete: parapets, copings, sills, doorsteps, stair treads. */
  readonly concrete: SurfaceMaps;
  /** Coursed rubble masonry: the east quay wall. */
  readonly quaystone: SurfaceMaps;
  /** Painted corrugated steel: doors, shutters and roller shutters. */
  readonly steel: SurfaceMaps;
  /** Weathered planks: crates, deck boards and the pier. */
  readonly wood: SurfaceMaps;
};

export type TownMaterials = {
  /**
   * Street deck under the whole town — fan-pattern granite setts, cooler and
   * darker than the flagged plazas that slab over it.
   */
  readonly ground: Material;
  /**
   * Washed building walls. The metre argument is vestigial: the wall is world-
   * projected, so its scale no longer depends on the building it lands on.
   */
  readonly plaster: (longestSideMetres: number) => Material;
  /** Weathered render over brick, on the aged accent buildings. */
  readonly brick: (longestSideMetres: number) => Material;
  /**
   * Painted blue-grey dado along the foot of a lane wall. World-projected like
   * every other surface, so the band reads as weathered paint on render rather
   * than as a plastic skirt; `facade.ts` reads this instead of owning a flat
   * material of its own.
   */
  readonly dadoBand: Material;
  /** Parapet capping course over plaster / brick walls. */
  readonly plasterTrim: Material;
  readonly brickTrim: Material;
  /** Blue doors and window shutters. */
  readonly doorBlue: Material;
  readonly shutter: Material;
  /**
   * Roller shutters over the garages and lock-ups. Same painted steel as the
   * shutters at a third of the tile, so the ribs read as a roller door's
   * rather than as a window shutter's louvres. `facade.ts` looks for this name
   * and falls back to `shutter` when it is absent.
   */
  readonly rollerSteel: Material;
  /** Striped / plain canvas awnings over some doors. */
  readonly awningCanvas: Material;
  readonly awningStripe: Material;
  /** Sea water east of the town, plus the pale shallows by the quay. */
  readonly water: Material;
  readonly shallow: Material;
  /** Wooden crates, dock planks and deck boards. */
  readonly crate: Material;
  readonly deckWood: Material;
  /** Oil drums. */
  readonly barrel: Material;
  /** Palm trunk and drooping fronds. */
  readonly palmTrunk: Material;
  readonly frond: Material;
  /** Painted site rings and letters. */
  readonly siteMark: Material;
  /** Scoring plates: salmon face, struck face, dark frame. */
  readonly plateFace: Material;
  readonly plateHit: Material;
  readonly plateFrame: Material;
  /** Steel posts, braces, dock hardware and rooftop clutter. */
  readonly steel: Material;
  readonly steelPost: Material;
  readonly steelMast: Material;
  readonly tankDark: Material;
  /** East quay wall. */
  readonly quay: Material;
  /** Plaza tints: subtly warmer or cooler than the lanes, never painted-on. */
  readonly plazaWarm: Material;
  readonly plazaCool: Material;
  readonly plazaPale: Material;
};

/**
 * How many metres of world one texture tile covers. These are the only numbers
 * that set texture scale anywhere in the town; nothing derives from mesh size.
 */
const TILE_METRES = {
  /** Plaster007's stucco grain reads as a wall at roughly three metres. */
  plaster: 3.0,
  /** The peeling render's patches want a slightly larger module than stucco. */
  brick: 3.4,
  /** Tiles098's flags measure 185 cm; two metres keeps them near life size. */
  floor: 2.0,
  /**
   * PavingStones150's fan-pattern setts ship as a 2:1 image covering a 2:1
   * patch of ground — about 30 setts across 1.8 m, per the asset manifest's
   * measurement notes. The U/V pair is load-bearing: a square repeat stretches
   * every sett into an ellipse.
   */
  pavingU: 1.8,
  pavingV: 0.9,
  concrete: 2.4,
  quaystone: 2.0,
  /** Corrugated ribs land near ten centimetres apart at this tile. */
  steel: 0.9,
  /** Eight boards per tile, so a plank reads about twenty centimetres wide. */
  wood: 1.6,
} as const;

/**
 * Wrap and colour-space a map for triplanar sampling, in place. Nothing here
 * clones: the old code had to, because each variant carried its own `repeat`,
 * and every clone is a second upload of the same megabyte to the GPU. Tiling is
 * now a shader constant, so one texture object serves every material that reads
 * it — including the whitewash relief the aged render borrows.
 */
function prepare(map: Texture, srgb: boolean): Texture {
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;
  // Normal and roughness carry linear data; sRGB here would invert the relief
  // and lift every gloss value.
  if (srgb) map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
}

type WorldSurfaceOptions = {
  /**
   * Metres of world per repeat along the projection's V axis, for non-square
   * tiles. Only the up-facing projection lands on anything that uses this, and
   * there U runs along world Z and V along world X — so a 2:1 image wants
   * `tileMetres` 2× `tileMetresV`, or its pattern stretches into ellipses.
   */
  readonly tileMetresV?: number;
  /** Multiplied over the sampled colour; this is the surface's paint. */
  readonly tint?: number;
  /**
   * A second tint the large-scale noise mixes toward, so a run of buildings
   * reads as many hands of whitewash rather than one bucket.
   */
  readonly tintAlt?: number;
  /** How strongly the ground-up grime darkens the base of a wall, 0..1. */
  readonly grime?: number;
  /** Depth of the low-frequency patchiness, 0..1. */
  readonly patch?: number;
  /**
   * Depth of the metre-scale wear, 0..1. Pulling a photograph toward its own
   * luminance also flattens it, and flat is what makes paving read as lino: the
   * flags keep their joints but lose the light-and-dark that says some have
   * been walked on for two hundred years. This puts that variation back as
   * value, at roughly the size of one flag, without touching hue.
   */
  readonly mottle?: number;
  /**
   * How much of the photograph's own colour survives, 0..1. Every one of these
   * maps was shot on a different day under a different sky, so at 1 the town is
   * a collage: Plaster007's green mildew fights the flagstone's ochre and no
   * tint can reconcile them. Pulling each sample toward its own luminance first
   * and colouring it with `tint` afterwards is what puts them in one palette.
   */
  readonly saturation?: number;
  /** How deep the baked occlusion cuts, 0..1. Ignored without an `ao` map. */
  readonly occlusion?: number;

  readonly roughness?: [number, number];
  readonly metalness?: number;
  readonly normalScale?: number;
  readonly side?: typeof FrontSide | typeof DoubleSide;
};

/**
 * Triplanar sampling that fetches only the two dominant axes.
 *
 * `triplanarTexture` issues three fetches per sample and multiplies two of them
 * by ~zero here: this town is axis-aligned boxes, whose face normals are exact
 * axes, so three's blend weights are (1, 0, 0) on every wall and the two extra
 * fetches multiply into nothing — at up to 24 fetches a fragment they were the
 * whole GPU frame on a phone. This keeps three's exact blend (abs world normal,
 * L1-normalised), drops the smallest axis, and renormalises the pair it keeps:
 * the retained pair carry their exact relative mix, axis-aligned faces are
 * pixel-identical, and curved props give up only the smallest contributor at
 * their 45° bands.
 */
const triTop2 = (
  mapNode: ReturnType<typeof texture>,
  // A uniform scale (float) or an anisotropic one (vec2), as `triplanarTexture` takes.
  scaleNode: any,
  positionNode = positionWorld,
  normalNode = normalWorldGeometry,
): any => {
  const b = normalNode.abs().normalize();
  const floorW = min(b.x, min(b.y, b.z));
  const keepSum = max(
    b.x.sub(floorW).add(b.y.sub(floorW)).add(b.z.sub(floorW)),
    1e-4,
  );
  const uvX = positionNode.yz.mul(scaleNode);
  const uvY = positionNode.zx.mul(scaleNode);
  const uvZ = positionNode.xy.mul(scaleNode);
  const xFirst = b.x.greaterThanEqual(b.y);
  const uv1 = select(xFirst, uvX, uvY);
  const uv2 = select(b.z.greaterThanEqual(min(b.x, b.y)), uvZ, select(xFirst, uvY, uvX));
  const w1 = max(b.x, b.y).sub(floorW).div(keepSum);
  const w2 = max(b.z, min(b.x, b.y)).sub(floorW).div(keepSum);
  return texture(mapNode.value, uv1).mul(w1).add(texture(mapNode.value, uv2).mul(w2));
};

/**
 * A surface sampled triplanar from world position. Two meshes of any size or
 * orientation that share one of these show the texture at the same scale, and
 * meshes that abut in world space continue each other's pattern.
 */
function worldSurface(
  maps: SurfaceMaps,
  tileMetres: number,
  options: WorldSurfaceOptions = {},
): MeshStandardNodeMaterial {
  const project = (source: Texture, srgb: boolean, metresU: number, metresV = metresU) =>
    triTop2(
      texture(prepare(source, srgb)),
      options.tileMetresV === undefined
        ? float(1 / metresU)
        : vec2(float(1 / metresU), float(1 / metresV)),
      positionWorld,
      // The GEOMETRIC world normal, not `normalWorld`: that one is the shaded
      // normal, so feeding it the blend that feeds `normalNode` would close a
      // loop through the very map this is sampling.
      normalWorldGeometry,
    );
  // One projection tiles perfectly, and a perfect tile is exactly what the eye
  // catches: a 30 m wall showed the plaster photograph's horizontal streaks
  // repeating on a visible 3 m grid. Sampling the same map a second time at
  // 1.618x the tile and crossfading on slow noise breaks the period without a
  // second texture — the two scales share no common multiple, so the combined
  // pattern does not close, and the blend weight drifts over ~15 m so the seam
  // between them is never a line.
  const BREAKUP = 1.618;
  const blend = mx_noise_float(positionWorld.mul(0.065)).mul(0.5).add(0.5);
  // The breakup crossfade exists to hide a visible repeat in the COLOUR map; a
  // normal or roughness repeat never reads at these scales, so those maps take
  // one projection and half the fetches.
  const sample = (source: Texture, srgb: boolean, breakup = true) =>
    breakup
      ? mix(
          project(source, srgb, tileMetres, options.tileMetresV ?? tileMetres),
          project(
            source,
            srgb,
            tileMetres * BREAKUP,
            (options.tileMetresV ?? tileMetres) * BREAKUP,
          ),
          smoothstep(0.35, 0.65, blend),
        )
      : project(source, srgb, tileMetres, options.tileMetresV ?? tileMetres);

  const material = new MeshStandardNodeMaterial({
    side: options.side ?? FrontSide,
    metalness: options.metalness ?? 0.02,
  });
  if (globalThis.localStorage?.getItem("TN_FLAT_TOWN") === "1") {
    material.colorNode = color(0xbbbbbb);
    material.roughnessNode = float(0.9);
    return material;
  }

  // Two noise fields, both in world space so they cross building boundaries the
  // way real weather does rather than stopping at a mesh edge.
  //  - `patch` is slow (about a twenty-metre wavelength): whole facades drift
  //    warm or cool, which is what stops thirty boxes reading as one paint job.
  //  - `streak` is stretched vertically, so it runs down walls like rain dirt.
  const patch = mx_fractal_noise_float(positionWorld.mul(0.05), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const streak = mx_noise_float(positionWorld.mul(vec3(0.8, 0.06, 0.8))).mul(0.5).add(0.5);
  // Grime climbs off the pavement and fades out at head height.
  const rise = smoothstep(0.0, 3.0, positionWorld.y);
  //  - `wear` is about a metre across: one flag, one patch of render.
  const wear = mx_noise_float(positionWorld.mul(0.9)).mul(0.5).add(0.5);

  const base = options.tint ?? 0xffffff;
  const paint = mix(color(base), color(options.tintAlt ?? base), saturate(patch));
  const patchDepth = options.patch ?? 0.16;
  const value = mix(float(1 - patchDepth), float(1 + patchDepth), saturate(patch));
  const grimeDepth = options.grime ?? 0.0;
  const dirt = mix(float(1 - grimeDepth), float(1), rise);
  const wash = mix(float(1 - grimeDepth * 0.45), float(1), saturate(streak));

  const wearDepth = options.mottle ?? 0.0;
  const worn = mix(float(1 - wearDepth), float(1 + wearDepth), saturate(wear));

  const photo = saturation(vec3(sample(maps.map, true)), float(options.saturation ?? 1));
  const shaded =
    maps.ao === undefined
      ? photo
      : photo.mul(
          mix(float(1 - (options.occlusion ?? 0.55)), float(1), sample(maps.ao, false, false).r),
        );
  material.colorNode = shaded.mul(paint).mul(value).mul(worn).mul(dirt).mul(wash);

  if (maps.normal !== undefined) {
    const relief = options.normalScale ?? 1;
    material.normalNode = normalMap(vec3(sample(maps.normal, false, false)), vec2(relief, relief));
  }
  const [low, high] = options.roughness ?? [0.68, 0.96];
  material.roughnessNode =
    maps.rough === undefined
      ? float((low + high) / 2)
      : mix(float(low), float(high), saturate(sample(maps.rough, false, false).r));
  return material;
}

export function createTownMaterials(textures: TownTextures, environment?: Texture): TownMaterials {
  // Whitewash: bright, but a step under paper so the sun has somewhere to go.
  // The alt tint is the sandy hand of render the reference frames alternate
  // with the cold white one; `patch` decides which facade gets which.
  const plaster = worldSurface(textures.plaster, TILE_METRES.plaster, {
    tint: 0xf7f0dd,
    tintAlt: 0xefdfbe,
    grime: 0.32,
    patch: 0.1,
    mottle: 0.07,
    saturation: 0.42,
    roughness: [0.74, 0.98],
    normalScale: 0.85,
  });
  const brick = worldSurface(textures.brick, TILE_METRES.brick, {
    tint: 0xe0d3ba,
    tintAlt: 0xc5a884,
    grime: 0.28,
    patch: 0.12,
    mottle: 0.09,
    saturation: 0.55,
    roughness: [0.76, 0.99],
    normalScale: 0.9,
  });
  // The lanes take the full key on an upward face, so the paving tint sits two
  // steps under whitewash or the whole floor clips to white paper.
  const paving = (tint: number, tintAlt: number) =>
    worldSurface(textures.floor, TILE_METRES.floor, {
      tint,
      tintAlt,
      patch: 0.13,
      mottle: 0.12,
      saturation: 0.46,
      occlusion: 0.6,
      roughness: [0.72, 0.97],
      normalScale: 0.7,
    });
  // Streets take the fan-pattern granite setts — cooler and a step darker than
  // any plaza flag — so a lane and a plaza read as two paving jobs rather than
  // one continuous beige deck. The set's image is 2:1 and so is its world
  // footprint; see TILE_METRES.pavingU/V. Until `Play.ts` loads the set, the
  // street falls back to the flagstone at a cooler tint than it used to wear,
  // which already breaks the uniform-warmth problem halfway.
  const street =
    textures.paving === undefined
      ? paving(0x9fa29c, 0xaaada5)
      : worldSurface(textures.paving, TILE_METRES.pavingU, {
          tileMetresV: TILE_METRES.pavingV,
          tint: 0xa8aba9,
          tintAlt: 0x999f9d,
          patch: 0.13,
          mottle: 0.14,
          saturation: 0.42,
          occlusion: 0.55,
          roughness: [0.7, 0.96],
          normalScale: 0.8,
        });
  const concreteTrim = (tint: number) =>
    worldSurface(textures.concrete, TILE_METRES.concrete, {
      tint,
      grime: 0.24,
      patch: 0.09,
      mottle: 0.07,
      saturation: 0.5,
      roughness: [0.7, 0.95],
      normalScale: 0.6,
    });
  // Painted corrugated steel. The ribs come entirely from the normal map, so
  // the tile is small enough to put them a hand's width apart.
  const painted = (tint: number) =>
    worldSurface(textures.steel, TILE_METRES.steel, {
      tint,
      grime: 0.18,
      patch: 0.07,
      saturation: 0.25,
      roughness: [0.36, 0.72],
      metalness: 0.35,
      normalScale: 1.15,
    });
  const planks = (tint: number, tintAlt: number) =>
    worldSurface(textures.wood, TILE_METRES.wood, {
      tint,
      tintAlt,
      patch: 0.1,
      saturation: 0.45,
      roughness: [0.62, 0.92],
      metalness: 0.02,
      normalScale: 0.9,
    });

  const anySize = (material: Material) => (): Material => material;

  const materials: TownMaterials = {
    ground: street,
    plaster: anySize(plaster),
    brick: anySize(brick),
    // The painted dado rides the same world-projected field as the wall it is
    // painted on, so paint grain and plaster grain agree instead of the band
    // reading as a plastic skirt glued to the foot of the wall.
    dadoBand: worldSurface(textures.plaster, TILE_METRES.plaster, {
      tint: 0x93aebc,
      tintAlt: 0x7e97a5,
      grime: 0.34,
      patch: 0.12,
      mottle: 0.08,
      saturation: 0.28,
      roughness: [0.78, 0.98],
      normalScale: 0.75,
    }),
    plasterTrim: concreteTrim(0xdedacd),
    brickTrim: concreteTrim(0xc0a184),
    // The reference doors are blue-painted roller shutters and blue joinery,
    // not flat slabs: the corrugation is what makes them read as metal.
    doorBlue: painted(0x3f6b96),
    shutter: painted(0x5081a8),
    rollerSteel: worldSurface(textures.steel, TILE_METRES.steel / 2.6, {
      tint: 0x6f8ea6,
      grime: 0.24,
      patch: 0.06,
      saturation: 0.3,
      roughness: [0.34, 0.7],
      metalness: 0.42,
      normalScale: 1.3,
    }),
    awningCanvas: new MeshStandardMaterial({ color: 0xe9dfc4, roughness: 0.82 }),
    awningStripe: new MeshStandardMaterial({ color: 0xa8403a, roughness: 0.8 }),
    // Deep water keeps some metalness so it takes the sky gradient, but the
    // roughness stays high enough that it reads navy, not mirror-cyan; the
    // shallows hug the quay a step lighter without going turquoise.
    water: new MeshStandardMaterial({ color: 0x1f5f88, roughness: 0.24, metalness: 0.34 }),
    shallow: new MeshStandardMaterial({ color: 0x3a7f97, roughness: 0.45, metalness: 0.1 }),
    // Crates are warm sun-dried timber in the reference, not the grey the raw
    // plank photograph starts at, so the tint carries most of the colour.
    crate: planks(0xc79a68, 0xb0824f),
    deckWood: planks(0xb18f68, 0x9c7c58),
    barrel: worldSurface(textures.steel, 0.42, {
      tint: 0x5c7a5e,
      tintAlt: 0x7a5a3e,
      grime: 0.3,
      patch: 0.2,
      saturation: 0.3,
      roughness: [0.4, 0.85],
      metalness: 0.45,
      normalScale: 0.9,
    }),
    palmTrunk: new MeshStandardMaterial({ color: 0x7a5c38, roughness: 0.9 }),
    frond: new MeshStandardMaterial({ color: 0x4a803c, roughness: 0.78, side: DoubleSide }),
    // Site paint is worn into the stone in the reference, not a lit decal.
    siteMark: new MeshStandardMaterial({
      color: 0xb8483a,
      roughness: 0.92,
      metalness: 0.0,
      transparent: true,
      opacity: 0.72,
    }),
    // Scoring plates read as flat salmon paper at every distance, like the
    // reference site paint; the struck face swaps in lighter so the hit reads.
    plateFace: new MeshStandardMaterial({
      color: 0xff5252,
      emissive: 0xff0000,
      emissiveIntensity: 0.16,
      roughness: 0.9,
      side: DoubleSide,
    }),
    plateHit: new MeshStandardMaterial({ color: 0xff8d7f, roughness: 0.9, side: DoubleSide }),
    plateFrame: new MeshStandardMaterial({
      color: 0x2a2e33,
      roughness: 0.7,
      metalness: 0.3,
      side: DoubleSide,
    }),
    steel: new MeshStandardMaterial({ color: 0xb9bec3, roughness: 0.4, metalness: 0.7 }),
    steelPost: new MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.5, metalness: 0.6 }),
    // Kept a plain material on purpose: town.ts draws the overhead wires with
    // this, and a THREE.Line cannot take a node material.
    steelMast: new MeshStandardMaterial({ color: 0x8a8f95, roughness: 0.45, metalness: 0.65 }),
    tankDark: new MeshStandardMaterial({ color: 0x30363c, roughness: 0.55, metalness: 0.25 }),
    quay: worldSurface(textures.quaystone, TILE_METRES.quaystone, {
      tint: 0xc9c0aa,
      grime: 0.22,
      patch: 0.1,
      saturation: 0.5,
      roughness: [0.74, 0.98],
      normalScale: 0.8,
    }),
    // Plazas share the paving field, so their slabs continue the lane's stone
    // instead of restarting it; only the tint separates them, by warmth.
    plazaWarm: paving(0xbcae93, 0xc6b99c),
    plazaCool: paving(0xacb0a6, 0xb7bab0),
    plazaPale: paving(0xc4bfb1, 0xcec9bb),
  };

  if (environment !== undefined) {
    // These surfaces are overwhelmingly rough. Their live roughness values land between PMREM
    // levels and make every radiance lookup blend two texels. Roughness 0.8 is an authored PMREM
    // boundary, so each town IBL lookup needs one fetch while keeping directional sky light.
    const townEnvironment = pmremTexture(environment, undefined, float(0.8));
    for (const entry of Object.values(materials)) {
      const material = typeof entry === "function" ? entry(1) : entry;
      if (material instanceof MeshStandardNodeMaterial) material.envNode = townEnvironment;
    }
  }

  return materials;
}
