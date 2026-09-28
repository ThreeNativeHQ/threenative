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
 * shipped looks. `medium` is the rung in between for a machine that is neither: a laptop iGPU, a
 * handheld, a desktop that is dropping frames. Nothing outside this file decides what any of them
 * mean.
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
 * The look every tier shares: a wide, faint glow on what is genuinely brighter than white — the
 * sun disk, a water glint — rather than a haze over the frame (a threshold under 1 blooms lit
 * grass and flattens contrast), and a corner falloff. Antialiasing is on in every tier that
 * installs a chain; see `screenSpaceAA` in `worldEnvironment.ts`.
 *
 * No screen-space reflections and no sharpen here, on purpose. Every surface already reflects the
 * captured sky (`sky.ts`), which is what puts the sun's own highlight on the water; SSR on a
 * rippled sea traced speckle into the swell, and RCAS then rang the smooth sky gradient into
 * visible bands. Both are one line to turn back on.
 *
 * **The three authored paint stages are off, and the wiring stays.** `outline.ts`, `kuwahara.ts`
 * and `watercolor.ts` are still in `src/render/`, still collected by `painterly.ts`, and still
 * handed to the chain; they are simply not requested. Re-enabling one is flipping its single
 * `xxxEnabled` line here from `false` to `true` — its every other knob already has a default in
 * `painterly.ts` — so the option is a choice rather than a rewrite. They are off by default
 * because a real sun and a real sky already carry the shading: the ink outline read as a comic
 * stroke over a photograph, the Kuwahara smear ate the grass, and the watercolour wash grouped
 * the coast's value steps into bands.
 */
const shared: QualitySettings = {
  // Bloom cost: ~4.6 ms in the reference ablation — the second most expensive stage there.
  bloomEnabled: true,
  bloomRadius: 0.6,
  bloomStrength: 0.22,
  bloomThreshold: 1,
  denoiseEnabled: false,
  exposure: 0.62,
  sharpenEnabled: false,
  ssgiEnabled: false,
  ssrEnabled: false,
  // The three authored stages, off. One line each; see the note above.
  outlineEnabled: false,
  kuwaharaEnabled: false,
  watercolorEnabled: false,
  tonemapMode: "aces",
  vignetteAmount: 0.22,
};

/**
 * What a desktop gets: contact occlusion on top — the dark line where a foot meets the grass and
 * a boulder meets the ground, most of what separates "objects in a world" from "objects pasted on
 * a background". Gathered at full resolution and denoised: at half, the upsample left a grain
 * around every foot.
 */
const high: QualitySettings = {
  ...shared,
  // GTAO, full resolution plus denoise: unmeasured on its own here; read `TN_FRAME_BUDGET`.
  gtaoEnabled: true,
  gtaoRadius: 0.35,
  renderChainTier: "high",
};

/**
 * The rung in between: the same occlusion at half the directions. Saving unmeasured, and the
 * chain's own antialiasing one notch cheaper.
 */
const medium: QualitySettings = { ...high, gtaoSamples: 8, renderChainTier: "medium" };

/** What a phone gets: bloom, vignette and the tone curve, nothing screen-space. */
const low: QualitySettings = { ...shared, renderChainTier: "low" };

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
