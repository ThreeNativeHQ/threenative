import type { IFrameStats } from "../examples/engine-load-test/src/ladder.js";
import { CAPTURE_GUARD_LIMITS } from "../packages/playtest/src/capture.js";
import type { ICaptureFrameStats } from "../packages/playtest/src/capture.js";

export {
  CAPTURE_GUARD_LIMITS,
  CaptureGuardError,
  assertCaptureNotBlank,
  assertFrameShowsSomething,
  inspectFrame,
} from "../packages/playtest/src/capture.js";
export type { ICaptureFrameStats };
export type CaptureFrameStats = ICaptureFrameStats;

/**
 * Why a frame read straight off a GPU surface counts as blank, in `assertCaptureNotBlank`'s own
 * terms and with its own limits — so a benchmark rung that drew nothing is refused by the same
 * definition a playtest screenshot is, instead of a second one written next to it.
 *
 * The dark-frame allowance is kept because a scene lit only by a dim sun is legitimately dark: what
 * fails is a frame with no variation in it, not a dark one.
 * @situation fail a benchmark run whose rung rendered a blank or uniform frame
 * @constraint returns a reason when the frame is blank, and null when it is not
 * @example blankFrameReason({ distinctColors: 1, luminanceStdDev: 0, maxLuminance: 0.3, sampledPixels: 32400 });
 */
export function blankFrameReason(stats: IFrameStats): string | null {
  if (stats.sampledPixels === 0) return "read-back returned no pixels";
  if (stats.distinctColors < CAPTURE_GUARD_LIMITS.minDistinctColors)
    return `only ${stats.distinctColors} distinct colour(s) across ${stats.sampledPixels} sampled pixels`;
  if (stats.luminanceStdDev < CAPTURE_GUARD_LIMITS.minLuminanceStdDev)
    return `luminance standard deviation ${stats.luminanceStdDev.toFixed(5)} is below ${CAPTURE_GUARD_LIMITS.minLuminanceStdDev}`;
  const hasDarkFrameVariation =
    stats.distinctColors >= CAPTURE_GUARD_LIMITS.darkFrameMinDistinctColors &&
    stats.luminanceStdDev >= CAPTURE_GUARD_LIMITS.darkFrameMinLuminanceStdDev &&
    stats.maxLuminance <= CAPTURE_GUARD_LIMITS.darkFrameMaxLuminance;
  if (!hasDarkFrameVariation && stats.maxLuminance < CAPTURE_GUARD_LIMITS.darkFrameMaxLuminance)
    return `frame is dark but not varied enough: ${stats.distinctColors} colours, luminance standard deviation ${stats.luminanceStdDev.toFixed(5)}, max luminance ${stats.maxLuminance.toFixed(3)}`;
  return null;
}
