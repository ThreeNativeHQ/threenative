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
import type { IWorldEnvironmentOptions } from "./worldEnvironment.js";

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

/** Narrows an arbitrary string — a URL parameter, a saved setting — to a tier name. */
export function isQualityTier(value: string): value is QualityTier {
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
 * What a desktop gets: this template's shipped desktop look, unchanged.
 *
 * The whole chain measured 12.5 ms of a 14.7 ms GPU frame in the reference ablation, and SSGI
 * with its denoiser is ~9.2 ms of that.
 */
const high: IWorldEnvironmentOptions = {
  // Strength, radius and threshold are a look decision already tuned to this scene's palette.
  // Bloom: ~4.6 ms — the second most expensive stage in the chain, and the one nobody expects
  // to be.
  bloomEnabled: true,
  bloomStrength: 0.7,
  exposure: 1.15,
  // The two full-resolution denoise passes over the AO and GI terms: ~1.9 ms. Only worth running
  // when SSGI is on — its noise is what they clean up.
  denoiseEnabled: true,
  // SSGI, the screen-space indirect-light gather: ~7.3 ms alone, ~9.2 ms with the two denoise
  // passes it feeds. The largest stage in the chain by a factor of two, of a 14.7 ms frame.
  // Dropping this pair is what `medium` is.
  ssgiEnabled: true,
  ssgiQuality: "medium",
  // Screen-space reflections: ~4.1 ms.
  ssrEnabled: true,
  // A reflection carries almost no high-frequency detail, so half resolution costs a quarter of
  // the rays and is very hard to see in the result.
  ssrResolutionScale: 0.5,
  // RCAS sharpen: unmeasured — never ablated on its own here. It puts back the micro-detail the
  // denoiser and the half-resolution reflection take out, so it earns its cost only on a tier
  // that runs one of them.
  sharpenEnabled: true,
  // **0 is maximum sharpening and 2 is none** — it is a radius, not a gain.
  sharpenStrength: 0.28,
  tonemapMode: "aces",
};

/**
 * `high` minus the gather and its denoiser — the single change in this chain measured to give
 * back most of the frame: **14.7 ms -> 5.5 ms of GPU** in the reference ablation. Reflections,
 * bloom and the sharpener stay, so it is recognisably the same look.
 */
const medium: IWorldEnvironmentOptions = {
  // Strength, radius and threshold are a look decision already tuned to this scene's palette.
  // Bloom: ~4.6 ms — the second most expensive stage in the chain, and the one nobody expects
  // to be.
  bloomEnabled: true,
  bloomStrength: 0.7,
  exposure: 1.15,
  // Screen-space reflections: ~4.1 ms.
  ssrEnabled: true,
  // A reflection carries almost no high-frequency detail, so half resolution costs a quarter of
  // the rays and is very hard to see in the result.
  ssrResolutionScale: 0.5,
  // RCAS sharpen: unmeasured — never ablated on its own here. It puts back the micro-detail the
  // denoiser and the half-resolution reflection take out, so it earns its cost only on a tier
  // that runs one of them.
  sharpenEnabled: true,
  // **0 is maximum sharpening and 2 is none** — it is a radius, not a gain.
  sharpenStrength: 0.28,
  tonemapMode: "aces",
};

/**
 * What a phone gets: this template's shipped mobile look, unchanged. The sharpener stays on
 * because it shipped on — nothing upstream of it blurs at this tier, so it is doing very little,
 * and its cost here is unmeasured.
 */
const low: IWorldEnvironmentOptions = {
  // Strength, radius and threshold are a look decision already tuned to this scene's palette.
  // Bloom: ~4.6 ms — the second most expensive stage in the chain, and the one nobody expects
  // to be.
  bloomEnabled: true,
  bloomStrength: 0.7,
  exposure: 1.15,
  // RCAS sharpen: unmeasured — never ablated on its own here. It puts back the micro-detail the
  // denoiser and the half-resolution reflection take out, so it earns its cost only on a tier
  // that runs one of them.
  sharpenEnabled: true,
  // **0 is maximum sharpening and 2 is none** — it is a radius, not a gain.
  sharpenStrength: 0.28,
  tonemapMode: "aces",
};

const QUALITY_PRESETS: Record<QualityTier, IWorldEnvironmentOptions> = { high, low, medium };

/** The stages and strengths a tier turns on. Throws on a name that is not a tier. */
export function qualityPreset(tier: string): IWorldEnvironmentOptions {
  const preset = QUALITY_PRESETS[tier as QualityTier];
  if (preset === undefined) {
    throw new Error(
      `Unknown quality tier ${JSON.stringify(tier)} — expected one of ${QUALITY_TIERS.join(", ")}.`,
    );
  }
  return preset;
}
