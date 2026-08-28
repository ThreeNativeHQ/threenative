import type { IThreeNativeConfig } from "./config.js";
import type { PlatformOS } from "./platform.js";

type RendererConfig = NonNullable<IThreeNativeConfig["renderer"]>;

/** How the active drawing-buffer scale was arrived at, reported beside every fps number. */
export type ScaleSource = "pinned" | "auto";

export interface IResolvedScale {
  readonly resolutionScale: number;
  readonly scaleSource: ScaleSource;
}

/** Where an `"auto"` scale starts before the controller has seen a frame-budget window. */
export const AUTO_SCALE_START = 1;

function requireScale(
  value: number | "auto" | undefined,
  key: string,
): number | "auto" | undefined {
  if (value === undefined || value === "auto") return value;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1)
    throw new Error(
      `${key} must be "auto" or a number within (0, 1], received ${JSON.stringify(value)}.`,
    );
  return value;
}

/**
 * The one place a configured scale becomes a number the renderer can apply, and the one place
 * that says whether the game chose it or the engine did.
 *
 * Validation lives here rather than in the renderer because the renderer only ever sees the
 * resolved number: a game that writes `renderer.android.resolutionScale: 2` has to be told which
 * key it got wrong, not that some scale somewhere was out of range.
 */
export function resolveRendererScaleSetting(
  config: RendererConfig | undefined,
  fallback: number | undefined,
  os: PlatformOS,
): IResolvedScale {
  const android = requireScale(
    config?.android?.resolutionScale,
    "renderer.android.resolutionScale",
  );
  const portable = requireScale(config?.resolutionScale, "renderer.resolutionScale");
  const selected = os === "android" && android !== undefined ? android : (portable ?? fallback);
  if (selected === "auto") return { resolutionScale: AUTO_SCALE_START, scaleSource: "auto" };
  if (selected === undefined) return { resolutionScale: 1, scaleSource: "pinned" };
  return {
    resolutionScale: requireScale(selected, "renderer.resolutionScale") as number,
    scaleSource: "pinned",
  };
}

/**
 * Internal config-to-renderer seam for multisampling, resolved exactly as the scale is.
 *
 * Separate from the scale resolver rather than folded into one call because the two values have
 * different types and different fallbacks, and a combined resolver would have to invent a shape
 * for "this platform overrides one of them".
 */
export function resolveRendererAntialias(
  config: RendererConfig | undefined,
  fallback: boolean | undefined,
  os: PlatformOS,
): boolean | undefined {
  if (os === "android" && config?.android?.antialias !== undefined) {
    return config.android.antialias;
  }
  return config?.antialias ?? fallback;
}
