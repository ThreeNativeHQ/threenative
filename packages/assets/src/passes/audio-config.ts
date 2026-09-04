/**
 * The audio declarations a game writes in `threenative.config.ts`, validated here.
 *
 * **Declared, never guessed.** Which clips loop, which are positional, and what a clip is *for*
 * are facts only the game knows, and a pass that inferred them from a filename would be
 * confidently wrong on the first asset named against its convention. `texture.ts` takes codec
 * choice from an override, then a filename convention, then measured alpha — for audio there is no
 * honest middle rung, so there is only the override. A clip nobody declared is still measured and
 * still reported; what it does not get is an assertion about an intent nobody stated.
 *
 * Every key is checked here rather than deeper in the pass, because a silently-dropped `loop`
 * is a build that shipped a clicking bed while reporting success — which is the defect this pass
 * exists to stop.
 */

import type { AudioBand } from "./audio-dsp.js";
import { AUDIO_BANDS } from "./audio-dsp.js";

export type AudioConditioning = "none";
/** `"ceiling"` only ever attenuates; `"peak"` also lifts a quiet clip to the ceiling. */
export type AudioNormalisation = "ceiling" | "peak";

/**
 * What a clip is *for*, stated as a bound on where its energy sits.
 *
 * Both directions matter, and the two real defects this pass was built for are one of each. A chime
 * that came back a hum needed a floor — it had 83% of its energy in `low` and nothing in `high`,
 * where a struck bell lives. Fifteen footsteps needed a ceiling — they carried up to 45% of their
 * energy in `sub`, below 100 Hz, which a wood has nothing in and which costs a phone's speaker its
 * whole headroom for a sound nobody can hear.
 *
 * Percentages on the same 0-100 scale as the audio inspector's, and named bands from its
 * vocabulary, so a game declares one number in one language for both tools.
 */
export interface IAudioSpectrumExpectation {
  readonly band: AudioBand;
  /** Most of the clip's energy that may sit in the band. */
  readonly maxPercent?: number;
  /** Least of the clip's energy that must sit in the band. */
  readonly minPercent?: number;
}

export interface IAudioLoopOptions {
  /**
   * Equal-power cross-fade length in milliseconds. `0` keeps the clip's own length — a
   * bar-accurate musical loop cannot be shortened by a fade — and still has its seam asserted.
   */
  readonly crossFadeMs?: number;
  /** How far the splice may move to find a quiet seam, in milliseconds. */
  readonly spliceToleranceMs?: number;
}

export interface IAudioOverride {
  /** Ships these bytes as committed. Measurement, and a declared loop's assertion, still run. */
  readonly conditioning?: AudioConditioning;
  /** First matching override wins; matched against the logical path, e.g. `"audio/bed.ogg"`. */
  readonly glob: string;
  /** The clip repeats forever, so its seam is cross-faded and then asserted. */
  readonly loop?: boolean | IAudioLoopOptions;
  readonly normalise?: AudioNormalisation;
  /** Peak ceiling in dBFS; must be at or below 0. */
  readonly peakDb?: number;
  /** The clip plays from a place in the world, so it is downmixed to mono. */
  readonly positional?: boolean;
  /** Vorbis VBR quality, -1 to 10. */
  readonly quality?: number;
  /** The largest wrap-to-neighbourhood step ratio this loop may ship with. */
  readonly seamMaxRatio?: number;
  /** What the clip is for, stated as a band its energy must occupy. */
  readonly spectrum?: IAudioSpectrumExpectation;
}

export interface IAudioPassOptions {
  readonly normalise?: AudioNormalisation;
  readonly overrides?: readonly IAudioOverride[];
  readonly peakDb?: number;
  readonly quality?: number;
  readonly seamMaxRatio?: number;
}

export const DEFAULT_PEAK_DB = -1;
export const DEFAULT_QUALITY = 4;
export const DEFAULT_CROSS_FADE_MS = 250;
export const DEFAULT_SPLICE_TOLERANCE_MS = 25;
/**
 * How many times the neighbourhood's own largest ordinary step a wrap may be before it is a click.
 *
 * Not 1.0, which looks like the natural line and fails a flawless loop: a perfectly continuous wrap
 * whose join lands on the signal's steepest point *is* the largest step in its neighbourhood, so it
 * measures 1.0 and a looped pure sine scores 1.000000000000223 on float error alone. 1.5 keeps
 * every clean join and still catches the real thing, which overshoots by five times and up.
 *
 * The same default and the same measurement as the audio inspector in
 * `packages/playtest/src/runner/audio.ts`, so a clip that passes the build gate cannot fail the
 * inspector on the identical bytes.
 */
export const DEFAULT_SEAM_MAX_RATIO = 1.5;
/** Below this a declaration fails a flawless loop; above it, it admits an audible click. */
export const MIN_SEAM_MAX_RATIO = 1;
export const MAX_SEAM_MAX_RATIO = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const OVERRIDE_KEYS: readonly string[] = [
  "conditioning",
  "glob",
  "loop",
  "normalise",
  "peakDb",
  "positional",
  "quality",
  "seamMaxRatio",
  "spectrum",
];
const CONFIG_KEYS: readonly string[] = [
  "normalise",
  "overrides",
  "peakDb",
  "quality",
  "seamMaxRatio",
];
const LOOP_KEYS: readonly string[] = ["crossFadeMs", "spliceToleranceMs"];
const SPECTRUM_KEYS: readonly string[] = ["band", "maxPercent", "minPercent"];
const BAND_NAMES = Object.keys(AUDIO_BANDS);

function invalid(label: string, requirement: string): never {
  throw new Error(`TN_ASSETS_CONFIG_INVALID: ${label} must ${requirement}.`);
}

function rejectUnknownKeys(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      throw new Error(`TN_ASSETS_CONFIG_UNKNOWN_KEY: ${label}.${key} is not recognised.`);
    }
  }
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalid(label, "be a boolean");
  return value as boolean;
}

function nonNegativeMilliseconds(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    invalid(label, "be a non-negative number of milliseconds");
  }
  return value as number;
}

function quality(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -1 || value > 10) {
    invalid(label, "be a number between -1 and 10, the Vorbis VBR quality scale");
  }
  return value as number;
}

function peakDb(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value > 0 || value < -60) {
    invalid(label, "be a number between -60 and 0 dBFS");
  }
  return value as number;
}

function seamMaxRatio(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(label, "be a number");
  }
  if ((value as number) < MIN_SEAM_MAX_RATIO) {
    invalid(
      label,
      `be at least ${String(MIN_SEAM_MAX_RATIO)}; below it the bound fails a flawless loop, because a wrap that lands on the signal's steepest point is legitimately the largest step in its own neighbourhood`,
    );
  }
  if ((value as number) > MAX_SEAM_MAX_RATIO) {
    invalid(
      label,
      `be at most ${String(MAX_SEAM_MAX_RATIO)}; a real click overshoots its neighbourhood by five times and up, so a loop declared above that is not asserted at all. Declare loop: false for a clip that must ship such a wrap`,
    );
  }
  return value as number;
}

function normalisation(value: unknown, label: string): AudioNormalisation {
  if (value !== "ceiling" && value !== "peak") {
    invalid(label, 'be "ceiling" (attenuate only, keeping the game\'s relative mix) or "peak"');
  }
  return value as AudioNormalisation;
}

function parseLoop(raw: unknown, label: string): boolean | IAudioLoopOptions {
  if (typeof raw === "boolean") return raw;
  if (!isRecord(raw)) invalid(label, "be a boolean or an object");
  const loop = raw as Record<string, unknown>;
  rejectUnknownKeys(loop, LOOP_KEYS, label);
  return {
    ...(loop.crossFadeMs === undefined
      ? {}
      : { crossFadeMs: nonNegativeMilliseconds(loop.crossFadeMs, `${label}.crossFadeMs`) }),
    ...(loop.spliceToleranceMs === undefined
      ? {}
      : {
          spliceToleranceMs: nonNegativeMilliseconds(
            loop.spliceToleranceMs,
            `${label}.spliceToleranceMs`,
          ),
        }),
  };
}

function percent(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    invalid(label, "be a percentage between 0 and 100");
  }
  return value as number;
}

function parseSpectrum(raw: unknown, label: string): IAudioSpectrumExpectation {
  if (!isRecord(raw)) invalid(label, "be an object");
  const spectrum = raw as Record<string, unknown>;
  rejectUnknownKeys(spectrum, SPECTRUM_KEYS, label);
  if (typeof spectrum.band !== "string" || !BAND_NAMES.includes(spectrum.band)) {
    invalid(`${label}.band`, `be one of ${BAND_NAMES.join(", ")}`);
  }
  const maxPercent =
    spectrum.maxPercent === undefined
      ? undefined
      : percent(spectrum.maxPercent, `${label}.maxPercent`);
  const minPercent =
    spectrum.minPercent === undefined
      ? undefined
      : percent(spectrum.minPercent, `${label}.minPercent`);
  // A declaration that bounds nothing is the v1 harness failure in miniature: a check that runs,
  // reports, and can never fail. Fail closed on it rather than accepting an empty assertion.
  if (maxPercent === undefined && minPercent === undefined) {
    invalid(`${label}`, "declare minPercent, maxPercent, or both; neither bounds anything");
  }
  if (maxPercent !== undefined && minPercent !== undefined && minPercent > maxPercent) {
    invalid(`${label}`, "declare a minPercent at or below its maxPercent");
  }
  return {
    band: spectrum.band as AudioBand,
    ...(maxPercent === undefined ? {} : { maxPercent }),
    ...(minPercent === undefined ? {} : { minPercent }),
  };
}

function parseOverride(raw: unknown, index: number): IAudioOverride {
  const label = `assets.audio.overrides[${String(index)}]`;
  if (!isRecord(raw)) invalid(label, "be an object");
  const item = raw as Record<string, unknown>;
  rejectUnknownKeys(item, OVERRIDE_KEYS, "assets.audio.overrides");
  if (typeof item.glob !== "string" || item.glob.trim().length === 0) {
    invalid(`${label}.glob`, "be a non-empty string; an override with no glob matches nothing");
  }
  if (item.conditioning !== undefined && item.conditioning !== "none") {
    invalid(`${label}.conditioning`, 'be "none" when declared');
  }
  return {
    ...(item.conditioning === undefined ? {} : { conditioning: "none" as const }),
    glob: item.glob,
    ...(item.loop === undefined ? {} : { loop: parseLoop(item.loop, `${label}.loop`) }),
    ...(item.normalise === undefined
      ? {}
      : { normalise: normalisation(item.normalise, `${label}.normalise`) }),
    ...(item.peakDb === undefined ? {} : { peakDb: peakDb(item.peakDb, `${label}.peakDb`) }),
    ...(item.positional === undefined
      ? {}
      : { positional: boolean(item.positional, `${label}.positional`) }),
    ...(item.quality === undefined ? {} : { quality: quality(item.quality, `${label}.quality`) }),
    ...(item.seamMaxRatio === undefined
      ? {}
      : { seamMaxRatio: seamMaxRatio(item.seamMaxRatio, `${label}.seamMaxRatio`) }),
    ...(item.spectrum === undefined
      ? {}
      : { spectrum: parseSpectrum(item.spectrum, `${label}.spectrum`) }),
  };
}

/** `"none"` drops the pass; an object configures it; absent means the defaults run. */
export function parseAudioConfig(raw: unknown): IAudioPassOptions | undefined {
  if (raw === undefined) return {};
  if (raw === "none") return undefined;
  if (!isRecord(raw)) invalid("assets.audio", 'be "none" or an object');
  const config = raw as Record<string, unknown>;
  rejectUnknownKeys(config, CONFIG_KEYS, "assets.audio");
  if (config.overrides !== undefined && !Array.isArray(config.overrides)) {
    invalid("assets.audio.overrides", "be an array");
  }
  return {
    ...(config.normalise === undefined
      ? {}
      : { normalise: normalisation(config.normalise, "assets.audio.normalise") }),
    ...(config.overrides === undefined
      ? {}
      : { overrides: (config.overrides as unknown[]).map(parseOverride) }),
    ...(config.peakDb === undefined
      ? {}
      : { peakDb: peakDb(config.peakDb, "assets.audio.peakDb") }),
    ...(config.quality === undefined
      ? {}
      : { quality: quality(config.quality, "assets.audio.quality") }),
    ...(config.seamMaxRatio === undefined
      ? {}
      : { seamMaxRatio: seamMaxRatio(config.seamMaxRatio, "assets.audio.seamMaxRatio") }),
  };
}
