/**
 * One rule for what `display.maxFps` means when a game does not say.
 *
 * A template that shipped `maxFps: 60` taught every agent to copy the line, and every 120 Hz
 * desktop then ran its game at half the panel it was sitting on — a default that is a constant the
 * author is told to revisit later is a bug, not an option. So the default follows the display,
 * capped at 120 on desktop and web, and stays 60 on mobile where the ceiling is power and heat
 * rather than pixels. An explicit number still wins and `0` still removes the ceiling.
 *
 * **A browser has no refresh-rate API**, so "follows the display" is a measurement: the median
 * interval between presented frames over the frame budget's first window is the panel's period,
 * because on the web one rAF callback is one vblank. A native host says its own rate through the
 * present counter, which is the only series there that counts displays rather than loop
 * iterations. Both arrive as `measuredRefreshHz`; until one does, the answer is 60 and says so.
 */

import type { IPlatformInfo } from "./platform.js";

/** What a game gets before anything has been measured, and all a mobile gets. */
export const DEFAULT_TARGET_FPS = 60;
/** The desktop and web ceiling, whatever the panel runs at. */
export const MAX_TARGET_FPS = 120;

/**
 * The rates a display actually ships at, nearest one wins. 144 and 165 exist in the list and are
 * then capped, because a 144 Hz gaming monitor is exactly the case where a player expects the
 * panel to be used.
 */
const COMMON_REFRESH_RATES = [60, 75, 90, 120, 144, 165] as const;

/**
 * Where a resolved target came from, so a harness can assert the *rule* and not just the number:
 * `"config"` is the game naming it, `"display"` a measured panel rate, `"mobile-default"` the
 * mobile power ceiling, and `"fallback"` the 60 held until a measurement exists. An unmeasured 60
 * is not the display's rate and does not report as one.
 */
export type TargetFpsSource = "config" | "display" | "fallback" | "mobile-default";

/** A resolved frame budget: the rate the loop holds, and what decided it. */
export interface ITargetFps {
  readonly targetFps: number;
  readonly source: TargetFpsSource;
}

/** Whatever holds `display.maxFps` — `IGameConfig`, `IThreeNativeConfig`, or a bare object. */
export interface ITargetFpsConfig {
  readonly display?: { readonly maxFps?: number | undefined } | undefined;
}

/** Only the one field the rule reads, so a caller need not hold a whole `IPlatformInfo`. */
export type ITargetFpsPlatform = Pick<IPlatformInfo, "formFactor">;

/**
 * The nearest common refresh rate, never above `MAX_TARGET_FPS`.
 *
 * A measured 59.94 Hz panel and a measured 60 Hz one are the same panel, and a value the engine
 * invents rather than reads is a value no display can be asked to hold.
 */
export function snapRefreshRate(refreshHz: number): number {
  if (!Number.isFinite(refreshHz) || refreshHz <= 0) return DEFAULT_TARGET_FPS;
  let nearest: number = COMMON_REFRESH_RATES[0];
  for (const rate of COMMON_REFRESH_RATES)
    if (Math.abs(rate - refreshHz) < Math.abs(nearest - refreshHz)) nearest = rate;
  return Math.min(nearest, MAX_TARGET_FPS);
}

/**
 * The single reader of `display.maxFps`, used by the loop, the resolution scaler, the scene-shape
 * warning, the frame-budget marker and the templates.
 *
 * `measuredRefreshHz` is the display's own rate when the platform can say it, and is what turns
 * `"fallback"` into `"display"`. A negative or non-finite configured rate throws rather than
 * quietly falling back: a config the engine ignored is worse than a config it rejected.
 */
export function resolveTargetFps(
  config: ITargetFpsConfig | undefined,
  platform: ITargetFpsPlatform | undefined,
  measuredRefreshHz?: number,
): ITargetFps {
  const configured = config?.display?.maxFps;
  if (configured !== undefined) {
    if (!Number.isFinite(configured) || configured < 0)
      throw new Error(
        `display.maxFps must be a finite number of at least zero, received ${String(configured)}.`,
      );
    return { source: "config", targetFps: configured };
  }
  if (platform?.formFactor === "mobile")
    return { source: "mobile-default", targetFps: DEFAULT_TARGET_FPS };
  if (measuredRefreshHz === undefined) return { source: "fallback", targetFps: DEFAULT_TARGET_FPS };
  return { source: "display", targetFps: snapRefreshRate(measuredRefreshHz) };
}
