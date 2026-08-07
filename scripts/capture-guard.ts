import { PNG } from "pngjs";

export const CAPTURE_GUARD_LIMITS = {
  brightLuminance: 0.05,
  minBrightPixelRatio: 0.05,
  minDistinctColors: 8,
  minLuminanceStdDev: 0.01,
} as const;

export interface CaptureFrameStats {
  readonly distinctColors: number;
  readonly brightPixelRatio: number;
  readonly height: number;
  readonly luminanceStdDev: number;
  readonly width: number;
}

export class CaptureGuardError extends Error {
  readonly code = "TN_CAPTURE_BLANK";

  constructor(label: string, reason: string) {
    super(`TN_CAPTURE_BLANK: ${label}: ${reason}`);
    this.name = "CaptureGuardError";
  }
}

export function inspectFrame(png: Buffer): CaptureFrameStats {
  const image = PNG.sync.read(png);
  const colors = new Set<number>();
  let luminanceTotal = 0;
  let luminanceSquaredTotal = 0;
  let brightPixels = 0;
  let visiblePixels = 0;

  for (let offset = 0; offset < image.data.length; offset += 4) {
    const red = image.data[offset] ?? 0;
    const green = image.data[offset + 1] ?? 0;
    const blue = image.data[offset + 2] ?? 0;
    const alpha = image.data[offset + 3] ?? 0;
    colors.add(((red << 24) | (green << 16) | (blue << 8) | alpha) >>> 0);
    if (alpha === 0) continue;
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    visiblePixels += 1;
    if (luminance > CAPTURE_GUARD_LIMITS.brightLuminance) brightPixels += 1;
    luminanceTotal += luminance;
    luminanceSquaredTotal += luminance * luminance;
  }

  const mean = visiblePixels === 0 ? 0 : luminanceTotal / visiblePixels;
  const variance = visiblePixels === 0 ? 0 : luminanceSquaredTotal / visiblePixels - mean * mean;
  return {
    distinctColors: colors.size,
    brightPixelRatio: image.data.length === 0 ? 0 : brightPixels / (image.data.length / 4),
    height: image.height,
    luminanceStdDev: Math.sqrt(Math.max(0, variance)),
    width: image.width,
  };
}

export function assertFrameShowsSomething(png: Buffer, label: string): CaptureFrameStats {
  const stats = inspectFrame(png);
  if (stats.distinctColors < CAPTURE_GUARD_LIMITS.minDistinctColors) {
    throw new CaptureGuardError(
      label,
      `only ${stats.distinctColors} distinct color(s); capture is likely uniform or blank`,
    );
  }
  if (stats.luminanceStdDev < CAPTURE_GUARD_LIMITS.minLuminanceStdDev) {
    throw new CaptureGuardError(
      label,
      `luminance standard deviation ${stats.luminanceStdDev.toFixed(5)} is below ${CAPTURE_GUARD_LIMITS.minLuminanceStdDev}`,
    );
  }
  if (stats.brightPixelRatio < CAPTURE_GUARD_LIMITS.minBrightPixelRatio) {
    throw new CaptureGuardError(
      label,
      `bright pixel ratio ${stats.brightPixelRatio.toFixed(5)} is below ${CAPTURE_GUARD_LIMITS.minBrightPixelRatio}`,
    );
  }
  return stats;
}
