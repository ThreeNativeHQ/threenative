export function absoluteErrorRatio(rawValue, pixels, imageMagickVersion) {
  const value = Number.parseFloat(rawValue);
  if (!Number.isFinite(value) || !Number.isFinite(pixels) || pixels <= 0) return Number.NaN;
  if (value <= pixels) return value / pixels;
  const quantumBits = Number.parseInt(/\bQ(\d+)\b/u.exec(imageMagickVersion)?.[1] ?? '', 10);
  if (!Number.isInteger(quantumBits) || quantumBits < 8 || quantumBits > 32) return Number.NaN;
  return value / ((2 ** quantumBits) - 1) / pixels;
}
