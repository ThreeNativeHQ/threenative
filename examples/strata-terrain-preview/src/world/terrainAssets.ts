// Every starter file this game can ask for, in one table.
//
// The names live here and nowhere else so that replacing the starter art is one edit in one file:
// a game that ships its own models and maps rewrites these paths, or points them at a directory it
// owns, and nothing under `packages/terrain` changes. Nothing in this file loads anything — the
// loaders in `src/render/` ask for the paths, and a path that is absent leaves the surface on its
// own colours rather than failing the world.
//
// Two kinds of entry, and the difference is the caller's: a `map` is a PBR image the game binds,
// and a `model` is a placement asset a variant resolves to. Neither carries a scale, a material or
// a role decision; those are the render modules' business.

/** The surfaces that can cover ground. Order is the blend order in `src/render/terrain.ts`. */
export type LayerKey = "grass" | "dirt" | "rock" | "moss" | "sand" | "snow";

/** One ground layer's PBR images: an albedo, and relief where the surface shows it. */
export interface IGroundMaps {
  readonly diffuse: string;
  readonly normal?: string;
}

/** The ground's layers, and the file each one draws with. */
export const GROUND_MAPS: Record<LayerKey, IGroundMaps> = {
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

/** Metres one ground tile spans, per layer. The size of a pattern, not of the file. */
export const GROUND_TILE: Record<LayerKey, number> = {
  dirt: 3.4,
  grass: 2.6,
  moss: 3.6,
  rock: 9,
  sand: 3.2,
  snow: 12,
};

/** One mapped prop surface's albedo, tangent-space normal and roughness. */
export interface ISurfaceMaps {
  readonly diffuse: string;
  readonly normal: string;
  readonly roughness: string;
}

/** The bark and stone the props bind, and the soil the bases of both fade into. */
export const PROP_MAPS: Record<"bark" | "stone", ISurfaceMaps> = {
  bark: {
    diffuse: "bark_brown_02/bark_brown_02_diff_1k.jpg",
    normal: "bark_brown_02/bark_brown_02_nor_gl_1k.jpg",
    roughness: "bark_brown_02/bark_brown_02_rough_1k.jpg",
  },
  stone: {
    diffuse: "mossy_rock/mossy_rock_diff_1k.jpg",
    normal: "mossy_rock/mossy_rock_nor_gl_1k.jpg",
    roughness: "mossy_rock/mossy_rock_rough_1k.jpg",
  },
};

/** The forest floor the props' bases blend into. */
export const SOIL_MAP = "forest_ground_04/forest_ground_04_diff_1k.jpg";

/** The generated needle atlas, and the relief it carries in RG with occlusion in B. */
export const NEEDLE_ATLAS = "needle-atlas.png";
export const NEEDLE_SURFACE = "needle-surface.png";

/** The prepared fir's twig atlas: colour, tangent-space normal, and the packed arms map. */
export const FIR_MAPS = {
  arms: "fir_tree_01/fir_tree_01_twig_arm_1k.jpg",
  normal: "fir_tree_01/fir_tree_01_twig_nor_gl_1k.jpg",
  surface: "fir_tree_01/fir_tree_01_twig_diff_1k.jpg",
} as const;

/** The fern's own atlas: a photographed frond and its separate cut-out alpha. */
export const FERN_MAPS = {
  alpha: "fern_02/fern_02_alpha_512.png",
  diffuse: "fern_02/fern_02_diff_512.jpg",
} as const;

/** The licensed Fab pine's cut from its crown atlas, and the far card baked from the uncut one. */
export const PINE_ATLAS = "prepared/pine-tall-atlas.png";
export const IMPOSTOR_CARD = "prepared/pine-tall-impostor.png";

/** One prepared placement file: what it is, which variant it fills, and which detail level it is. */
export interface IPreparedFile {
  readonly asset: string;
  readonly level: number;
  readonly path: string;
  readonly variant: number;
}

/** Where the prepared CC0 art is served from. */
export const PREPARED_ROOTS = { fir: "fir_tree_01", rocks: "rocks" } as const;

/**
 * The licensed Fab pine, served from a second static root.
 *
 * A separate root rather than a copy of the first: the bytes are licensed, cannot sit in the
 * committed CC0 folder, and live in a gitignored directory that only exists on the machine that ran
 * `scripts/prep-fab-pines.py`.
 */
export const PREPARED_PINE_ROOT = "prepared";

/**
 * Whether the prepared fir is scattered, or only prepared.
 *
 * `false`, and the reason is a measurement rather than a preference. `scripts/prep-trees.py`
 * rasterises the front view of what it cut and reports the coverage: fir_tree_01's crown is 437,376
 * needle cards about a centimetre across, the six-thousand-triangle near budget buys four hundred
 * of them, and that is 0.3% of the silhouette — a bare tree with a haze on it. At the mid level's
 * fifteen hundred triangles it is 2.2% even with the cards enlarged twenty-four times, which is
 * still a bare tree at forty metres. So the starter keeps its procedural spruce, the prepared fir
 * ships as prepared art with its credits, and this is the one constant that puts it in the world.
 */
export const SCATTER_PREPARED_FIR = false;

/**
 * Whether the licensed Fab pine is scattered on a machine that prepared it.
 *
 * `false` after three judged rounds: cut to the six-thousand-triangle budget, its crown of small
 * sparse leaf cards reads as a bare tree with confetti, a dark inner cone reads as a cone, and the
 * cross-card reads as a striped tower at distance. The preparation and the loader stay, because
 * they are how the next source is measured; this constant is what keeps the meadow on the spruce.
 */
export const SCATTER_FAB_PINE = false;

/**
 * The prepared files, in the order they are asked for.
 *
 * Three rocks at both of their levels, the two firs behind the constant above, and the pine at all
 * three of its levels. Every level of one variant is asked for together, because a variant with a
 * near level and no mid level is a variant whose middle distance pops. Three rocks, because a
 * fourth is a tenth draw for a boulder the eye cannot tell from the other three at meadow distance,
 * and the starter's draw budget is a playtest assertion rather than a preference.
 *
 * The pine's three levels are near, mid and the far cross-card, and the bands that pick between
 * them are `LOD_BANDS` in `props.ts`. The pine is the only variant with three, which is why the
 * other two variants are the procedural spruce: a pine at three levels is five draws, a procedural
 * spruce at one is two, and the starter's ceiling is twenty-four prop draws for the whole meadow.
 */
export const PREPARED: readonly IPreparedFile[] = [
  { asset: "boulder", level: 0, path: `${PREPARED_ROOTS.rocks}/rock01-near.glb`, variant: 0 },
  { asset: "boulder", level: 1, path: `${PREPARED_ROOTS.rocks}/rock01-mid.glb`, variant: 0 },
  { asset: "boulder", level: 0, path: `${PREPARED_ROOTS.rocks}/rock04-near.glb`, variant: 1 },
  { asset: "boulder", level: 1, path: `${PREPARED_ROOTS.rocks}/rock04-mid.glb`, variant: 1 },
  { asset: "boulder", level: 0, path: `${PREPARED_ROOTS.rocks}/boulder-near.glb`, variant: 2 },
  { asset: "boulder", level: 1, path: `${PREPARED_ROOTS.rocks}/boulder-mid.glb`, variant: 2 },
  // ScotsPineTall_01, prepared by `scripts/prep-fab-pines.py`. The other prepared pine is not
  // scattered, and the measurement is in that script's own summary: ScotsPine_01's crown is 18.3 m
  // across on a 7.5 m spacing, which is a closed canopy rather than a meadow, and scattering it
  // would also cost the five draws the draw ceiling does not have.
  ...(SCATTER_FAB_PINE
    ? [
        {
          asset: "spruce",
          level: 0,
          path: `${PREPARED_PINE_ROOT}/pine-tall-near.glb`,
          variant: 0,
        },
        {
          asset: "spruce",
          level: 1,
          path: `${PREPARED_PINE_ROOT}/pine-tall-mid.glb`,
          variant: 0,
        },
        {
          asset: "spruce",
          level: 2,
          path: `${PREPARED_PINE_ROOT}/pine-tall-impostor.glb`,
          variant: 0,
        },
      ]
    : []),
  ...(SCATTER_PREPARED_FIR
    ? [
        {
          asset: "spruce",
          level: 0,
          path: `${PREPARED_ROOTS.fir}/fir-b-near.glb`,
          variant: 1,
        },
        { asset: "spruce", level: 1, path: `${PREPARED_ROOTS.fir}/fir-b-mid.glb`, variant: 1 },
        { asset: "spruce", level: 0, path: `${PREPARED_ROOTS.fir}/fir-c-near.glb`, variant: 2 },
        { asset: "spruce", level: 1, path: `${PREPARED_ROOTS.fir}/fir-c-mid.glb`, variant: 2 },
      ]
    : []),
];