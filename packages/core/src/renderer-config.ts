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
