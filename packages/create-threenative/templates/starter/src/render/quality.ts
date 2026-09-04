// Generated for you: ordinary Three.js; ThreeNative does not read this file. Delete or rewrite
// it freely — the tiers below are a starting point, not a framework look.
//
// This is the one place this game decides how expensive it looks. `postprocessing.ts` reads
// `qualityPreset(resolveQualityTier(...))` and nothing else, so "make it run on a phone" is one
// file to edit rather than a hunt through anonymous literals.
//
// **Where the numbers come from.** Every millisecond below is GPU time from the per-stage
// ablation recorded in the engine repository's `docs/verification/runtime-perf-state.md`: Chrome
// on an RTX 2080, 1600x900, static build, `gpuMs` read from three's `timestamp-query`. In that
// scene the whole five-stage chain costs **12.5 ms of a 14.7 ms GPU frame**, and the same frame
// with every stage off costs **2.2 ms**. The per-stage figures oversum — removing SSGI also
// removes the denoise passes the later stages sample — so read each as *what turning this one off
// gave back*, not as a share of a partition. A stage nobody has ablated on its own says
// `unmeasured` rather than guessing, and your scene is not that scene: read `TN_FRAME_BUDGET`
// back after you change a tier.
//
// One cost that is **not** a stage here and outweighs most of them: the prefiltered reflection
// probe on `scene.environment`, measured at **~6.3 ms of an 18-19 ms Pixel 8 frame**. It is set
// in `sky.ts`, not in this file.
//
import type { IPainterlyOptions } from "./painterly.js";
import type { IWorldEnvironmentOptions } from "./worldEnvironment.js";

/**
 * A preset is the framework's chain options plus this kit's own painterly knobs. The two are
 * separate types because they belong to different layers: `worldEnvironment.ts` is shared with
 * every other kit and must not know what a watercolour is.
 */
type QualitySettings = IWorldEnvironmentOptions & IPainterlyOptions;

/**
 * The three names this game's look comes in.
 *
 * `low` is what a phone gets and `high` what a desktop gets — those two are this template's
 * shipped looks, unchanged. `medium` is the rung in between for a machine that is neither: a
 * laptop iGPU, a handheld, a desktop that is dropping frames. Nothing outside this file decides
 * what any of them mean.
 */
export type QualityTier = "low" | "medium" | "high";

const QUALITY_TIERS: readonly QualityTier[] = ["low", "medium", "high"];

/**
 * Narrows an arbitrary string — a URL parameter, a saved setting — to a tier name. Not exported:
 * `resolveQualityTier` is the one door in, so an unknown name cannot be waved past the throw.
 */
function isQualityTier(value: string): value is QualityTier {
  return (QUALITY_TIERS as readonly string[]).includes(value);
}

/**
 * Picks the tier: an explicit `tier` always wins, otherwise the platform decides.
 *
 * Fails closed. An unrecognised tier name throws with the value it was handed rather than
 * quietly rendering the default, because a silent fallback here looks exactly like a tier that
 * turned out to have no effect.
 */
export function resolveQualityTier(
  request: { readonly mobile?: boolean; readonly tier?: string } = {},
): QualityTier {
  const requested = request.tier;
  if (requested !== undefined) {
    if (!isQualityTier(requested)) {
      throw new Error(
        `Unknown quality tier ${JSON.stringify(requested)} — expected one of ${QUALITY_TIERS.join(", ")}.`,
      );
    }
    return requested;
  }
  return request.mobile === true ? "low" : "high";
}

/**
 * What a desktop gets: a clean coastal look with restrained painterly treatment. The expensive
 * screen-space gathers are deliberately off here: on a small water scene they muddy the grass and
 * turn the water glint into a halo instead of adding useful depth.
 */
const high: QualitySettings = {
  // Bloom cost: unmeasured for this authored scene; the low strength keeps water glints alive
  // without washing the scene in orange.
  bloomEnabled: true,
  bloomRadius: 0.34,
  bloomStrength: 0.26,
  bloomThreshold: 0.64,
  denoiseEnabled: false,
  exposure: 1.04,
  ssgiEnabled: false,
  ssrEnabled: false,
  sharpenEnabled: false,
  // Outline cost: unmeasured; it is intentionally a soft blue-green edge, not a black
  // comic-book stroke.
  outlineEnabled: true,
  outlineDepthWeight: 0.32,
  outlineInkColor: 0x173c4a,
  outlineSoftness: 0.08,
  outlineStrength: 0.3,
  outlineThreshold: 0.2,
  // Kuwahara cost: unmeasured; the half-resolution scratch and restrained strength preserve
  // readable grass silhouettes.
  kuwaharaEnabled: true,
  kuwaharaRadius: 5,
  kuwaharaResolutionScale: 0.5,
  kuwaharaStrength: 0.2,
  // Watercolour cost: unmeasured; the low mix keeps the paper grouping from flattening the coast.
  watercolorEnabled: true,
  watercolorPaperStrength: 0.05,
  watercolorShadowStrength: 0.04,
  watercolorShadowTint: 0x7d6b62,
  watercolorStrength: 0.26,
  renderChainTier: "high",
  tonemapMode: "aces",
};

/**
 * Medium keeps the same readable coast, with a smaller paint radius and a little less colour
 * grouping for machines that need a cheaper frame.
 */
const medium: QualitySettings = {
  // Bloom cost: unmeasured for this authored scene; keep only a small highlight lift.
  bloomEnabled: true,
  bloomRadius: 0.3,
  bloomStrength: 0.22,
  bloomThreshold: 0.68,
  denoiseEnabled: false,
  exposure: 1.03,
  ssgiEnabled: false,
  ssrEnabled: false,
  sharpenEnabled: false,
  // Outline cost: unmeasured; keep its edge narrow on the cheaper tier.
  outlineEnabled: true,
  outlineDepthWeight: 0.28,
  outlineInkColor: 0x173c4a,
  outlineSoftness: 0.08,
  outlineStrength: 0.26,
  outlineThreshold: 0.22,
  // Kuwahara cost: unmeasured; radius three keeps the water and grass readable.
  kuwaharaEnabled: true,
  kuwaharaRadius: 3,
  kuwaharaResolutionScale: 0.5,
  kuwaharaStrength: 0.16,
  // Watercolour cost: unmeasured; fewer bands and a low mix preserve the coast's value steps.
  watercolorEnabled: true,
  watercolorLevels: 6,
  watercolorPaperStrength: 0.04,
  watercolorShadowStrength: 0.03,
  watercolorShadowTint: 0x7d6b62,
  watercolorStrength: 0.22,
  renderChainTier: "medium",
  tonemapMode: "aces",
};

/**
 * What a phone gets: the cleanest version of the coastal look. Authored paint is omitted to keep
 * the water mesh and touch controls responsive.
 */
const low: QualitySettings = {
  // Bloom cost: unmeasured for this authored scene; this is the phone-safe highlight lift.
  bloomEnabled: true,
  bloomRadius: 0.28,
  bloomStrength: 0.18,
  bloomThreshold: 0.72,
  exposure: 1.02,
  sharpenEnabled: false,
  // The low tier omits authored paint by name: no outline, scratch target, or paper graph is
  // built on the phone path.
  outlineEnabled: false,
  kuwaharaEnabled: false,
  watercolorEnabled: false,
  renderChainTier: "low",
  tonemapMode: "aces",
};

const QUALITY_PRESETS: Record<QualityTier, QualitySettings> = { high, low, medium };

/** The stages and strengths a tier turns on. Throws on a name that is not a tier. */
export function qualityPreset(tier: string): QualitySettings {
  const preset = QUALITY_PRESETS[tier as QualityTier];
  if (preset === undefined) {
    throw new Error(
      `Unknown quality tier ${JSON.stringify(tier)} — expected one of ${QUALITY_TIERS.join(", ")}.`,
    );
  }
  return preset;
}
