/** Historical evidence inspected for this page. Updating the snapshot requires a source review. */
export const EVIDENCE_REF = "8c182343fe0be71131420dc79bd80bd6c7c8c17c";
export const EVIDENCE_REVIEWED = "2026-09-16";

export function evidenceUrl(path: string): string {
  return `https://github.com/ThreeNativeHQ/threenative/blob/${EVIDENCE_REF}/${path}`;
}

export const locCensus = {
  framework: { total: 441, plumbing: 74, game: 367 },
  vanilla: { total: 473, plumbing: 138, game: 335 },
  source: "docs/benchmark/LOC.md",
} as const;

/** The final column combines two treatments; it is not the isolated buffer-naming effect. */
export const shaderCensus = [
  { target: "Browser · NVIDIA/Turing", original: 79, tint: 71, stable: 52 },
  { target: "Native desktop", original: 84, tint: 76, stable: 56 },
  { target: "Pixel 8", original: 92, tint: 86, stable: 63 },
] as const;

export const lodCensus = [
  { target: "Browser WebGPU", near: 8192, far: 369 },
  { target: "Linux native desktop", near: 8192, far: 368 },
] as const;

function ratio(measured: number, baseline: number): number {
  if (!Number.isFinite(measured) || measured < 0 || !Number.isFinite(baseline) || baseline <= 0) {
    throw new Error(
      "TN_SITE_BENCHMARK_VALUE: finite non-negative observation and positive baseline required.",
    );
  }
  const result = measured / baseline;
  if (!Number.isFinite(result)) throw new Error("TN_SITE_BENCHMARK_VALUE: ratio overflow.");
  return result;
}

/** Percent of the control, not percent saved. */
export function percentageOf(measured: number, baseline: number): string {
  return `${(ratio(measured, baseline) * 100).toFixed(1)}%`;
}

/** A negative reduction is a regression, not a value to clamp to zero. */
export function percentageReduction(baseline: number, measured: number): string {
  return `${((1 - ratio(measured, baseline)) * 100).toFixed(1)}%`;
}
