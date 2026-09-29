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
// This kit runs no SSGI at any tier: the mist and shafts already own the frame's mood, and the gather
// would add a second, noisier bounce on top of a fill the sky already provides. Turn it on and read
// the p95 out of `TN_FRAME_BUDGET` before you keep it.
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
 * The look every tier shares: a soft bloom on what is genuinely brighter than white — the sun through
 * the trunks, the fairy, the sigils — a gentle vignette, and the tone curve. Antialiasing is on in
 * every tier that installs a chain; see `screenSpaceAA` in `worldEnvironment.ts`.
 *
 * `exposure` is what makes the mist read as mist: the reference is bright and low in contrast, so
 * the frame is exposed up and the tone curve does the rolling-off.
 */
const shared: IWorldEnvironmentOptions = {
  // Bloom: ~4.6 ms in the reference ablation — the second most expensive stage there.
  bloomEnabled: true,
  bloomRadius: 0.75,
  bloomStrength: 0.5,
  bloomThreshold: 0.9,
  exposure: 1.0,
  tonemapMode: "aces",
  vignetteAmount: 0.3,
};

/**
 * What a desktop gets: contact occlusion under every root and boot, and the god-rays — raymarched
 * against the sun's shadow map, so the canopy's own holes cut the shafts. The band is the one the
 * engine measured for a lit interior; the outdoor mist wants it lower because the fog already
 * carries the haze.
 */
const high: IWorldEnvironmentOptions = {
  ...shared,
  godraysDensity: 0.8,
  // Godrays: unmeasured on its own here; the 48 raymarch steps are the knob, read `TN_FRAME_BUDGET`.
  godraysEnabled: true,
  godraysFloor: 0.06,
  godraysIntensity: 7,
  godraysMaxDensity: 0.5,
  godraysSteps: 48,
  // GTAO, full resolution plus denoise: unmeasured on its own here; read `TN_FRAME_BUDGET`.
  gtaoEnabled: true,
  gtaoRadius: 0.5,
};

/** The rung in between: the same, at half the occlusion directions and half the shaft steps. */
const medium: IWorldEnvironmentOptions = { ...high, godraysSteps: 24, gtaoSamples: 8 };

/** What a phone gets: bloom, vignette and the tone curve, nothing screen-space. */
const low: IWorldEnvironmentOptions = shared;

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
