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
// **This template runs neither SSGI nor SSR at any tier.** Its frame cost is the water — a
// displaced 96x96 plane with its own material — not the post chain, and a screen-space reflection
// over moving water reads as smear. That is a template decision recorded here, not an omission:
// the two most expensive stages in the reference ablation are off on a desktop as well as on a
// phone, which is also why the rung between the tiers is bloom strength and nothing else.
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
 */
const high: IWorldEnvironmentOptions = {
  // Strength, radius and threshold are a look decision already tuned to this scene's palette.
  // Bloom: ~4.6 ms — the second most expensive stage in the chain, and the one nobody expects
  // to be.
  bloomEnabled: true,
  bloomStrength: 0.38,
  // No SSGI runs here, so there is nothing for the denoiser to clean up. Off, explicitly.
  denoiseEnabled: false,
  exposure: 1.12,
  // Off at every tier — see the note at the top of this file.
  ssgiEnabled: false,
  // Off at every tier — see the note at the top of this file.
  ssrEnabled: false,
  tonemapMode: "aces",
};

/**
 * The rung in between. With no screen-space stage to drop at any tier, the only thing left to
 * move is how hard the sun blooms off the water, so that is what the three tiers differ by.
 * The saving is **unmeasured** and small by construction — if this template needs to be cheaper,
 * the water material is where the frame actually goes.
 */
const medium: IWorldEnvironmentOptions = {
  // Strength, radius and threshold are a look decision already tuned to this scene's palette.
  // Bloom: ~4.6 ms — the second most expensive stage in the chain, and the one nobody expects
  // to be.
  bloomEnabled: true,
  bloomStrength: 0.33,
  // No SSGI runs here, so there is nothing for the denoiser to clean up. Off, explicitly.
  denoiseEnabled: false,
  exposure: 1.12,
  // Off at every tier — see the note at the top of this file.
  ssgiEnabled: false,
  // Off at every tier — see the note at the top of this file.
  ssrEnabled: false,
  tonemapMode: "aces",
};

/**
 * What a phone gets: this template's shipped mobile look, unchanged.
 */
const low: IWorldEnvironmentOptions = {
  // Strength, radius and threshold are a look decision already tuned to this scene's palette.
  // Bloom: ~4.6 ms — the second most expensive stage in the chain, and the one nobody expects
  // to be.
  bloomEnabled: true,
  bloomStrength: 0.28,
  exposure: 1.12,
  // Off at every tier — see the note at the top of this file.
  ssgiEnabled: false,
  // Off at every tier — see the note at the top of this file.
  ssrEnabled: false,
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
