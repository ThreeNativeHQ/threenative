import type { IThreeNativeConfig } from "./config.js";
import type { PlatformOS } from "./platform.js";

type RendererConfig = NonNullable<IThreeNativeConfig["renderer"]>;

/** Internal config-to-renderer seam; platform selection never leaks into game source. */
export function resolveRendererResolutionScale(
  config: RendererConfig | undefined,
  fallback: number | undefined,
  os: PlatformOS,
): number | undefined {
  if (os === "android" && config?.android?.resolutionScale !== undefined) {
    return config.android.resolutionScale;
  }
  return config?.resolutionScale ?? fallback;
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
