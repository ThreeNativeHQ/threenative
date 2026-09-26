import type { IV2Metric, IV2RunRecord } from "./report-v2.js";
import { PRIMARY_METRIC } from "./report-v2.js";
import { BenchError, percentile, requireObject } from "./report.js";

export const FRAME_INTERVAL_BINS_MS = [4, 8, 1000 / 60, 1000 / 30, 1000 / 15] as const;

export interface IRawTimingSummary {
  finalDrainMs: number;
  frameCount: number;
  gpuMissingFrames: number;
  gpuSampleCount: number;
  histogram: number[];
  hitchCount: number;
  intervalMaxMs: number;
  intervalP50Ms: number;
  intervalP95Ms: number;
  intervalP99Ms: number;
}

function fail(message: string): never {
  throw new BenchError("TN_BENCH_BAD_RAW_SERIES", message);
}

function matchesMetric(metric: IV2Metric | undefined, expected: number, name: string): void {
  if (metric === undefined || metric.value === null) return;
  if (metric.unit !== "ms") fail(`${name} must use milliseconds`);
  if (Math.abs(metric.value - expected) > Math.max(0.000001, expected * 0.000001)) {
    fail(
      `${name === PRIMARY_METRIC ? "completed-work mean" : name} mismatch: record ${metric.value} ms, raw ${expected} ms`,
    );
  }
}

function validateGpuSamples(
  runId: string,
  input: unknown,
  frameCount: number,
  metric: IV2Metric | undefined,
): number {
  const numeric = metric !== undefined && metric.value !== null;
  if (input === undefined) {
    if (numeric) fail(`${runId} numeric gpu-ms lacks per-frame GPU samples`);
    return 0;
  }
  if (!Array.isArray(input)) fail(`${runId} gpuSamples must be an array`);
  if (numeric && (frameCount === 0 || input.length !== frameCount))
    fail(`${runId} numeric gpu-ms lacks per-frame GPU samples`);
  let previousFrameId = -1;
  const samples = input.map((entry, index) => {
    const sample = requireObject(entry, `rawTimingSeries.gpuSamples[${index}]`);
    if (
      !Number.isInteger(sample.frameId) ||
      (sample.frameId as number) <= previousFrameId ||
      (sample.frameId as number) >= frameCount
    )
      fail(`${runId} GPU frame ID mismatch at ${index}`);
    previousFrameId = sample.frameId as number;
    if (sample.passId !== "frame") fail(`${runId} GPU sample needs passId frame`);
    const elapsed = sample.elapsedMs;
    if (typeof elapsed !== "number" || !Number.isFinite(elapsed) || elapsed < 0)
      fail(`${runId} GPU sample ${index} needs a finite non-negative elapsedMs`);
    return elapsed;
  });
  if (numeric)
    matchesMetric(metric, samples.reduce((sum, value) => sum + value, 0) / frameCount, "gpu-ms");
  return samples.length;
}

/** N+1 CPU submission boundaries plus one final GPU drain: no per-frame fence is implied. */
export function validateRawTimingSeries(
  record: IV2RunRecord,
  input: unknown,
): IRawTimingSummary | null {
  const series = requireObject(input, "rawTimingSeries");
  if (series.schemaVersion !== 1 || series.unit !== "ms")
    fail("raw timing series needs schemaVersion 1 and unit ms");
  const frameCount = record.timing.measuredFrames;
  if (!Array.isArray(series.boundaries) || series.boundaries.length !== frameCount + 1)
    fail(`${record.runId} raw boundary count must be measuredFrames + 1`);
  const boundaries = series.boundaries.map((entry, index) => {
    const boundary = requireObject(entry, `rawTimingSeries.boundaries[${index}]`);
    if (boundary.frameId !== index) fail(`${record.runId} frame ID mismatch at ${index}`);
    const time = boundary.monotonicMs;
    if (typeof time !== "number" || !Number.isFinite(time) || time < 0)
      fail(`${record.runId} boundary ${index} needs a finite non-negative monotonicMs`);
    return time;
  });
  const intervals: number[] = [];
  for (let index = 1; index < boundaries.length; index++) {
    const interval = (boundaries[index] as number) - (boundaries[index - 1] as number);
    if (interval <= 0) fail(`${record.runId} boundary timestamps must increase`);
    intervals.push(interval);
  }
  const first = boundaries[0] as number;
  const last = boundaries[boundaries.length - 1] as number;
  const final = series.finalCompletionMs;
  if (typeof final !== "number" || !Number.isFinite(final) || final < last)
    fail(`${record.runId} final completion must follow the last frame submission`);
  const completedWorkMs = final - first;
  const metrics = new Map(record.metrics.map((metric) => [metric.name, metric]));
  const gpuSampleCount = validateGpuSamples(
    record.runId,
    series.gpuSamples,
    frameCount,
    metrics.get("gpu-ms"),
  );
  if (frameCount === 0) {
    if (record.outcome.runStatus === "valid") fail(`${record.runId} valid run has no raw frames`);
    return null;
  }
  matchesMetric(metrics.get(PRIMARY_METRIC), completedWorkMs / frameCount, PRIMARY_METRIC);
  if (
    Math.abs(record.durationMs.measure - completedWorkMs) >
    Math.max(0.001, completedWorkMs * 0.000001)
  )
    fail(`${record.runId} measure duration mismatch`);
  for (const [name, fraction] of [
    ["frame-p50-ms", 0.5],
    ["frame-p95-ms", 0.95],
    ["frame-p99-ms", 0.99],
  ] as const) {
    matchesMetric(metrics.get(name), percentile(intervals, fraction), name);
  }
  const intervalP50Ms = percentile(intervals, 0.5);
  const histogram = Array.from({ length: FRAME_INTERVAL_BINS_MS.length + 1 }, () => 0);
  for (const interval of intervals) {
    const index = FRAME_INTERVAL_BINS_MS.findIndex((edge) => interval < edge);
    const bin = index === -1 ? histogram.length - 1 : index;
    histogram[bin] = (histogram[bin] ?? 0) + 1;
  }
  return {
    finalDrainMs: final - last,
    frameCount,
    gpuMissingFrames: frameCount - gpuSampleCount,
    gpuSampleCount,
    histogram,
    hitchCount: intervals.filter((interval) => interval > 2 * intervalP50Ms).length,
    intervalMaxMs: intervals.reduce((maximum, interval) => Math.max(maximum, interval), 0),
    intervalP50Ms,
    intervalP95Ms: percentile(intervals, 0.95),
    intervalP99Ms: percentile(intervals, 0.99),
  };
}
