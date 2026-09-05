import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BenchError,
  type IPerformanceLane,
  laneForId,
  parsePerformanceLaneManifest,
  percentile,
} from "../engine-load-test/report.js";

export { parsePerformanceLaneManifest } from "../engine-load-test/report.js";

export const PERFORMANCE_POLICY_REVISION = "prd-358-v1";
export const DEFAULT_REQUIRED_PAIRS = 3;
export const DEFAULT_MAX_INVALID_PAIRS = 1;

export type RegressionVerdict = "PASS" | "FAIL" | "BLOCKED";
export type PairOrder = "baseline-first" | "candidate-first";

export interface IAbsoluteFloor {
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface IMetricPolicy {
  readonly unit: string;
  readonly relativeLimit: number;
  readonly absoluteLimit: number;
  readonly exact?: boolean;
  readonly direction?: "higher-is-worse" | "lower-is-worse";
  readonly minimumSamples?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly absoluteFloor?: IAbsoluteFloor;
}

export interface IPerformancePolicy {
  readonly policyRevision: string;
  readonly metrics: Readonly<Record<string, IMetricPolicy>>;
  readonly requiredMetrics?: readonly string[];
  readonly absoluteFloors?: Readonly<Record<string, IAbsoluteFloor>>;
  readonly minimumValidPairs?: number;
  readonly maxInvalidPairs?: number;
  readonly requireAlternatingOrder?: boolean;
}

export const DEFAULT_PERFORMANCE_POLICY: IPerformancePolicy = {
  policyRevision: PERFORMANCE_POLICY_REVISION,
  metrics: {
    drawCalls: {
      absoluteLimit: 1,
      exact: true,
      relativeLimit: 0.01,
      unit: "count",
    },
    frameP95Ms: { absoluteLimit: 1, direction: "higher-is-worse", relativeLimit: 0.1, unit: "ms" },
    phaseP95Ms: { absoluteLimit: 1, direction: "higher-is-worse", relativeLimit: 0.1, unit: "ms" },
    startupP95Ms: {
      absoluteLimit: 250,
      direction: "higher-is-worse",
      minimumSamples: 5,
      relativeLimit: 0.15,
      unit: "ms",
    },
    memoryHighWaterMiB: {
      absoluteLimit: 16,
      direction: "higher-is-worse",
      relativeLimit: 0.1,
      unit: "MiB",
    },
    triangles: {
      absoluteLimit: 1,
      exact: true,
      relativeLimit: 0.01,
      unit: "count",
    },
  },
  requiredMetrics: ["frameP95Ms"],
  minimumValidPairs: DEFAULT_REQUIRED_PAIRS,
  maxInvalidPairs: DEFAULT_MAX_INVALID_PAIRS,
  requireAlternatingOrder: true,
};

export interface IPerformanceIdentity {
  readonly architecture: string;
  readonly artifactHash: string;
  readonly browser: string;
  readonly device: string;
  readonly graphicsBackend: string;
  readonly gpu: string;
  readonly instrumentationRevision: string;
  readonly jsRuntime: string;
  readonly operatingSystem: string;
  readonly presentMode: string;
  readonly resolution: string;
  readonly sourceSha: string;
  readonly workloadHash: string;
  /** Required for every collected arm; web collectors use their immutable bundle identity here. */
  readonly nativeBinaryHash: string;
}

export interface IMetricObservation {
  readonly unit: string;
  readonly value: number;
  readonly samples: readonly number[];
}

export interface IPerformanceRun {
  readonly reportHash: string;
  readonly lane: string;
  readonly workload: string;
  readonly identity: IPerformanceIdentity;
  readonly metrics: Readonly<Record<string, IMetricObservation>>;
  readonly command?: string;
  readonly durationSeconds?: number;
  readonly sampleCount?: number;
}

export interface IPerformancePair {
  readonly baseline?: unknown;
  readonly candidate?: unknown;
  readonly order?: PairOrder;
  readonly valid?: boolean;
  readonly reason?: string;
}

export interface IPerformanceComparisonInput {
  readonly lane?: string;
  /** Parsed by the comparator so a caller cannot narrow a selected lane's metric contract. */
  readonly laneManifest?: unknown;
  readonly workload?: string;
  readonly requiredMetrics?: readonly string[];
  readonly calibration?: boolean;
  readonly comparisonKind?: "regression" | "calibration";
  readonly pairs: readonly IPerformancePair[];
}

export interface IInvalidAttempt {
  readonly index: number;
  readonly reason: string;
}

export interface IMetricPairResult {
  readonly metric: string;
  readonly unit: string;
  readonly baselineMedian: number;
  readonly candidateMedian: number;
  readonly medianDelta: number;
  readonly medianRelativeDelta: number;
  readonly absoluteLimit: number;
  readonly relativeLimit: number;
  readonly pairBreaches: number;
  readonly regression: boolean;
  readonly floorBreaches: readonly number[];
  readonly pairs: readonly {
    readonly baseline: number;
    readonly candidate: number;
    readonly delta: number;
    readonly relativeDelta: number;
    readonly breaches: boolean;
  }[];
}

export interface IValidPairSummary {
  readonly index: number;
  readonly order: PairOrder;
  readonly baselineReportHash: string;
  readonly candidateReportHash: string;
  readonly baselineArtifactHash: string;
  readonly candidateArtifactHash: string;
  readonly baselineNativeBinaryHash: string;
  readonly candidateNativeBinaryHash: string;
  readonly baselineDurationSeconds?: number;
  readonly candidateDurationSeconds?: number;
  readonly baselineSampleCount?: number;
  readonly candidateSampleCount?: number;
}

export interface IRegressionComparison {
  readonly verdict: RegressionVerdict;
  readonly exitCode: 0 | 1 | 2;
  readonly policyRevision: string;
  readonly lane: string | null;
  readonly workload: string | null;
  readonly calibration: boolean;
  readonly attemptedPairs: number;
  readonly validPairs: number;
  readonly invalidAttempts: readonly IInvalidAttempt[];
  readonly reasons: readonly string[];
  readonly pairs: readonly IValidPairSummary[];
  readonly metrics: readonly IMetricPairResult[];
}

export interface IPerformanceRegressionCliResult {
  readonly exitCode: 0 | 1 | 2;
  readonly markdown: string;
  readonly summary: IRegressionComparison;
}

export class PerformanceRegressionError extends Error {
  readonly code: string;
  readonly exitCode = 2;

  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = code;
    this.code = code;
  }
}

const IDENTITY_FIELDS: readonly (keyof IPerformanceIdentity)[] = [
  "architecture",
  "artifactHash",
  "browser",
  "device",
  "graphicsBackend",
  "gpu",
  "instrumentationRevision",
  "jsRuntime",
  "operatingSystem",
  "presentMode",
  "resolution",
  "sourceSha",
  "workloadHash",
];

const COMPARABLE_IDENTITY_FIELDS = IDENTITY_FIELDS.filter(
  (field) => field !== "artifactHash" && field !== "sourceSha",
);

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PerformanceRegressionError("TN_PERF_BAD_SHAPE", `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PerformanceRegressionError(
      "TN_PERF_BAD_SHAPE",
      `${field} must be a non-empty string`,
    );
  }
  return value;
}

function finitePositive(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new PerformanceRegressionError(
      "TN_PERF_BAD_METRIC",
      `${field} must be finite and positive`,
    );
  }
  return value;
}

function alias(source: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key];
  }
  return undefined;
}

function identityField(
  source: Record<string, unknown>,
  identity: Record<string, unknown>,
  field: keyof IPerformanceIdentity,
): string {
  const aliases: Record<keyof IPerformanceIdentity, readonly string[]> = {
    architecture: ["architecture", "arch"],
    artifactHash: ["artifactHash", "bundleHash", "artifact"],
    browser: ["browser"],
    device: ["device", "deviceId", "serial"],
    graphicsBackend: ["graphicsBackend", "backend", "renderer"],
    gpu: ["gpu", "adapter"],
    instrumentationRevision: ["instrumentationRevision", "instrumentation"],
    jsRuntime: ["jsRuntime", "runtime", "javascriptRuntime"],
    nativeBinaryHash: ["nativeBinaryHash", "binaryHash"],
    operatingSystem: ["operatingSystem", "os"],
    presentMode: ["presentMode", "presentationMode"],
    resolution: ["resolution"],
    sourceSha: ["sourceSha", "sourceSHA", "sha"],
    workloadHash: ["workloadHash", "workloadSHA"],
  };
  const value = alias(identity, aliases[field]) ?? alias(source, aliases[field]);
  return nonEmptyString(value, `identity.${field}`);
}

function parseIdentity(source: Record<string, unknown>, field: string): IPerformanceIdentity {
  const nested =
    source.identity === undefined ? {} : objectValue(source.identity, `${field}.identity`);
  const identity = {} as Record<keyof IPerformanceIdentity, string>;
  for (const identityFieldName of IDENTITY_FIELDS) {
    identity[identityFieldName] = identityField(source, nested, identityFieldName);
  }
  const nativeBinaryHash =
    alias(nested, ["nativeBinaryHash", "binaryHash"]) ?? source.nativeBinaryHash;
  identity.nativeBinaryHash = nonEmptyString(
    nativeBinaryHash,
    `${field}.identity.nativeBinaryHash`,
  );
  return identity as IPerformanceIdentity;
}

function parseMetricSamples(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PerformanceRegressionError("TN_PERF_MISSING_OBSERVATION", `${field} has no samples`);
  }
  return value.map((sample, index) => finitePositive(sample, `${field}[${index}]`));
}

function parseMetric(value: unknown, field: string, policy: IMetricPolicy): IMetricObservation {
  let unit = policy.unit;
  let samples: number[];
  if (typeof value === "number") {
    samples = [finitePositive(value, field)];
  } else if (Array.isArray(value)) {
    samples = parseMetricSamples(value, field);
  } else {
    const source = objectValue(value, field);
    const explicitUnit = source.unit;
    if (explicitUnit !== undefined) unit = nonEmptyString(explicitUnit, `${field}.unit`);
    if (unit !== policy.unit) {
      throw new PerformanceRegressionError(
        "TN_PERF_UNIT_MISMATCH",
        `${field} uses ${unit}; policy requires ${policy.unit}`,
      );
    }
    samples = parseMetricSamples(
      source.samples ?? source.values ?? [source.value ?? source.p95],
      field,
    );
  }
  if (unit !== policy.unit) {
    throw new PerformanceRegressionError(
      "TN_PERF_UNIT_MISMATCH",
      `${field} uses ${unit}; policy requires ${policy.unit}`,
    );
  }
  if (policy.minimumSamples !== undefined && samples.length < policy.minimumSamples) {
    throw new PerformanceRegressionError(
      "TN_PERF_SHORT_SAMPLE_WINDOW",
      `${field} has ${samples.length} sample(s); policy requires at least ${policy.minimumSamples}`,
    );
  }
  return { samples, unit, value: percentile(samples, 0.95) };
}

function expandMetricValues(source: Record<string, unknown>): Record<string, unknown> {
  if (source.metrics !== undefined) return objectValue(source.metrics, "run.metrics");
  const values: Record<string, unknown> = {};
  for (const metric of [
    "drawCalls",
    "triangles",
    "frameP95Ms",
    "phaseP95Ms",
    "startupP95Ms",
    "memoryHighWaterMiB",
  ]) {
    if (source[metric] !== undefined) values[metric] = source[metric];
  }
  return values;
}

export function parsePerformanceRun(
  value: unknown,
  policy: IPerformancePolicy = DEFAULT_PERFORMANCE_POLICY,
): IPerformanceRun {
  const root = objectValue(value, "run");
  const source = root.report === undefined ? root : objectValue(root.report, "run.report");
  const reportHash = nonEmptyString(
    alias(root, ["reportHash", "hash"]) ?? source.reportHash ?? source.hash,
    "run.reportHash",
  );
  const lane = nonEmptyString(
    alias(root, ["lane", "laneId"]) ?? source.lane ?? source.laneId,
    "run.lane",
  );
  const workload = nonEmptyString(
    alias(root, ["workload", "workloadId"]) ?? source.workload ?? source.workloadId,
    "run.workload",
  );
  const rawMetrics = expandMetricValues(source);
  if (Object.keys(rawMetrics).length === 0) {
    throw new PerformanceRegressionError("TN_PERF_MISSING_OBSERVATION", "run.metrics is empty");
  }
  const metrics: Record<string, IMetricObservation> = {};
  for (const [metric, rawValue] of Object.entries(rawMetrics)) {
    const policyMetric = policy.metrics[metric] ?? policy.metrics[metric.split(".")[0] as string];
    if (policyMetric === undefined) {
      throw new PerformanceRegressionError(
        "TN_PERF_UNKNOWN_METRIC",
        `${metric} is not in the policy`,
      );
    }
    metrics[metric] = parseMetric(rawValue, `run.metrics.${metric}`, policyMetric);
  }
  const command = alias(root, ["command"]) ?? source.command;
  const duration = alias(root, ["durationSeconds", "durationSec"]) ?? source.durationSeconds;
  const sampleCount = alias(root, ["sampleCount", "samples"]) ?? source.sampleCount;
  const identitySource =
    root.identity === undefined ? source : { ...source, identity: root.identity };
  return {
    ...(command === undefined ? {} : { command: nonEmptyString(command, "run.command") }),
    ...(duration === undefined
      ? {}
      : { durationSeconds: finitePositive(duration, "run.durationSeconds") }),
    identity: parseIdentity(identitySource, "run"),
    lane,
    metrics,
    ...(sampleCount === undefined
      ? {}
      : { sampleCount: finitePositive(sampleCount, "run.sampleCount") }),
    reportHash,
    workload,
  };
}

function parseMetricPolicy(value: unknown, field: string): IMetricPolicy {
  const source = objectValue(value, field);
  const unit = nonEmptyString(source.unit, `${field}.unit`);
  const relativeLimit = finitePositive(
    source.relativeLimit ?? source.relative,
    `${field}.relativeLimit`,
  );
  const absoluteLimit = finitePositive(
    source.absoluteLimit ?? source.absolute,
    `${field}.absoluteLimit`,
  );
  const exact = source.exact;
  if (exact !== undefined && typeof exact !== "boolean") {
    throw new PerformanceRegressionError("TN_PERF_BAD_POLICY", `${field}.exact must be boolean`);
  }
  const direction = source.direction;
  if (
    direction !== undefined &&
    direction !== "higher-is-worse" &&
    direction !== "lower-is-worse"
  ) {
    throw new PerformanceRegressionError("TN_PERF_BAD_POLICY", `${field}.direction is unknown`);
  }
  const minimum = source.minimum;
  const maximum = source.maximum;
  const minimumSamples = source.minimumSamples;
  if (
    minimumSamples !== undefined &&
    (typeof minimumSamples !== "number" || !Number.isInteger(minimumSamples) || minimumSamples <= 0)
  ) {
    throw new PerformanceRegressionError(
      "TN_PERF_BAD_POLICY",
      `${field}.minimumSamples must be a positive integer`,
    );
  }
  if (minimum !== undefined) finitePositive(minimum, `${field}.minimum`);
  if (maximum !== undefined) finitePositive(maximum, `${field}.maximum`);
  const absoluteFloor =
    source.absoluteFloor === undefined
      ? undefined
      : parseFloor(source.absoluteFloor, `${field}.absoluteFloor`);
  return {
    absoluteLimit,
    ...(absoluteFloor === undefined ? {} : { absoluteFloor }),
    ...(direction === undefined ? {} : { direction }),
    ...(exact === undefined ? {} : { exact }),
    ...(minimumSamples === undefined ? {} : { minimumSamples }),
    ...(maximum === undefined ? {} : { maximum: finitePositive(maximum, `${field}.maximum`) }),
    ...(minimum === undefined ? {} : { minimum: finitePositive(minimum, `${field}.minimum`) }),
    relativeLimit,
    unit,
  };
}

function parseFloor(value: unknown, field: string): IAbsoluteFloor {
  const source = objectValue(value, field);
  const minimum = source.minimum;
  const maximum = source.maximum;
  if (minimum === undefined && maximum === undefined) {
    throw new PerformanceRegressionError(
      "TN_PERF_BAD_POLICY",
      `${field} must define minimum or maximum`,
    );
  }
  return {
    ...(minimum === undefined ? {} : { minimum: finitePositive(minimum, `${field}.minimum`) }),
    ...(maximum === undefined ? {} : { maximum: finitePositive(maximum, `${field}.maximum`) }),
  };
}

function parseFloors(value: unknown): Record<string, IAbsoluteFloor> | undefined {
  if (value === undefined) return undefined;
  const source = objectValue(value, "policy.absoluteFloors");
  const floors: Record<string, IAbsoluteFloor> = {};
  for (const [metric, rawFloor] of Object.entries(source)) {
    floors[metric] = parseFloor(rawFloor, `policy.absoluteFloors.${metric}`);
  }
  return floors;
}

export function parsePerformancePolicy(
  value: unknown = DEFAULT_PERFORMANCE_POLICY,
): IPerformancePolicy {
  const source = objectValue(value, "policy");
  const policyRevision = nonEmptyString(source.policyRevision, "policy.policyRevision");
  const rawMetrics = objectValue(source.metrics, "policy.metrics");
  if (Object.keys(rawMetrics).length === 0) {
    throw new PerformanceRegressionError("TN_PERF_BAD_POLICY", "policy.metrics is empty");
  }
  const metrics: Record<string, IMetricPolicy> = {};
  for (const [metric, metricValue] of Object.entries(rawMetrics)) {
    metrics[metric] = parseMetricPolicy(metricValue, `policy.metrics.${metric}`);
  }
  const requiredMetricsValue = source.requiredMetrics;
  const requiredMetrics =
    requiredMetricsValue === undefined
      ? undefined
      : parseStringList(requiredMetricsValue, "policy.requiredMetrics");
  for (const metric of requiredMetrics ?? []) {
    if (metrics[metric] === undefined && metrics[metric.split(".")[0] as string] === undefined) {
      throw new PerformanceRegressionError(
        "TN_PERF_UNKNOWN_METRIC",
        `${metric} is required but absent from policy`,
      );
    }
  }
  const minimumValidPairs = optionalPositiveInteger(
    source.minimumValidPairs,
    "policy.minimumValidPairs",
    DEFAULT_REQUIRED_PAIRS,
  );
  const maxInvalidPairs = optionalNonNegativeInteger(
    source.maxInvalidPairs,
    "policy.maxInvalidPairs",
    DEFAULT_MAX_INVALID_PAIRS,
  );
  if (maxInvalidPairs > DEFAULT_MAX_INVALID_PAIRS) {
    throw new PerformanceRegressionError(
      "TN_PERF_BAD_POLICY",
      `policy.maxInvalidPairs cannot exceed ${DEFAULT_MAX_INVALID_PAIRS}; retries cannot replace a valid comparison`,
    );
  }
  const requireAlternatingOrder =
    source.requireAlternatingOrder === undefined ? true : source.requireAlternatingOrder;
  if (requireAlternatingOrder !== true) {
    throw new PerformanceRegressionError(
      "TN_PERF_BAD_POLICY",
      "policy.requireAlternatingOrder must remain true for paired regression evidence",
    );
  }
  const absoluteFloors = parseFloors(source.absoluteFloors);
  return {
    ...(absoluteFloors === undefined ? {} : { absoluteFloors }),
    maxInvalidPairs,
    metrics,
    minimumValidPairs,
    policyRevision,
    ...(requiredMetrics === undefined ? {} : { requiredMetrics }),
    requireAlternatingOrder,
  };
}

function parseStringList(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new PerformanceRegressionError(
      "TN_PERF_BAD_SHAPE",
      `${field} must be a non-empty string array`,
    );
  }
  return [...value];
}

function optionalPositiveInteger(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new PerformanceRegressionError(
      "TN_PERF_BAD_POLICY",
      `${field} must be a positive integer`,
    );
  }
  return value;
}

function optionalNonNegativeInteger(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new PerformanceRegressionError(
      "TN_PERF_BAD_POLICY",
      `${field} must be a non-negative integer`,
    );
  }
  return value;
}

function parseInput(value: unknown): IPerformanceComparisonInput {
  if (Array.isArray(value)) return { pairs: value as IPerformancePair[] };
  const source = objectValue(value, "comparison");
  if (!Array.isArray(source.pairs)) {
    throw new PerformanceRegressionError(
      "TN_PERF_MISSING_PAIRS",
      "comparison.pairs is missing or empty",
    );
  }
  const calibration = source.calibration === true || source.comparisonKind === "calibration";
  if (source.calibration !== undefined && typeof source.calibration !== "boolean") {
    throw new PerformanceRegressionError(
      "TN_PERF_BAD_SHAPE",
      "comparison.calibration must be boolean",
    );
  }
  if (
    source.comparisonKind !== undefined &&
    source.comparisonKind !== "regression" &&
    source.comparisonKind !== "calibration"
  ) {
    throw new PerformanceRegressionError(
      "TN_PERF_BAD_SHAPE",
      "comparison.comparisonKind must be regression or calibration",
    );
  }
  return {
    ...(source.calibration === undefined ? {} : { calibration }),
    ...(source.comparisonKind === undefined
      ? {}
      : { comparisonKind: source.comparisonKind as "regression" | "calibration" }),
    ...(source.lane === undefined ? {} : { lane: nonEmptyString(source.lane, "comparison.lane") }),
    pairs: source.pairs as IPerformancePair[],
    ...(source.requiredMetrics === undefined
      ? {}
      : { requiredMetrics: parseStringList(source.requiredMetrics, "comparison.requiredMetrics") }),
    ...(source.workload === undefined
      ? {}
      : { workload: nonEmptyString(source.workload, "comparison.workload") }),
    ...(source.laneManifest === undefined ? {} : { laneManifest: source.laneManifest }),
  };
}

function invalidAttempt(pair: Record<string, unknown>, index: number): IInvalidAttempt | undefined {
  const valid = pair.valid;
  const status = pair.status;
  if (valid === false || status === "invalid" || status === "blocked") {
    const reason = pair.reason ?? pair.invalidReason;
    return { index, reason: nonEmptyString(reason, `comparison.pairs[${index}].reason`) };
  }
  if (valid !== undefined && valid !== true) {
    throw new PerformanceRegressionError(
      "TN_PERF_BAD_SHAPE",
      `comparison.pairs[${index}].valid must be boolean`,
    );
  }
  return undefined;
}

function compareIdentity(
  baseline: IPerformanceRun,
  candidate: IPerformanceRun,
  calibration: boolean,
): string[] {
  const failures: string[] = [];
  if (baseline.lane !== candidate.lane)
    failures.push(`pair lane differs (${baseline.lane} vs ${candidate.lane})`);
  if (baseline.workload !== candidate.workload)
    failures.push(`pair workload differs (${baseline.workload} vs ${candidate.workload})`);
  if (baseline.reportHash === candidate.reportHash)
    failures.push("baseline and candidate report hashes are identical");
  if (baseline.identity.device !== candidate.identity.device)
    failures.push("baseline and candidate use different devices");
  if (baseline.identity.sourceSha === candidate.identity.sourceSha && !calibration) {
    failures.push("candidate source SHA must differ from baseline outside calibration");
  }
  if (baseline.identity.artifactHash === candidate.identity.artifactHash && !calibration) {
    failures.push("baseline and candidate artifact hashes are identical");
  }
  for (const field of IDENTITY_FIELDS) {
    if (field === "sourceSha" || field === "artifactHash" || field === "device") continue;
    if (baseline.identity[field] !== candidate.identity[field]) {
      failures.push(
        `${field} differs (${baseline.identity[field]} vs ${candidate.identity[field]})`,
      );
    }
  }
  return failures;
}

function comparableIdentityKey(identity: IPerformanceIdentity): string {
  // Native baseline/candidate binaries are independently built. Their hashes are preserved in the
  // arm summaries, but are not part of the comparable device identity.
  return JSON.stringify(COMPARABLE_IDENTITY_FIELDS.map((field) => identity[field]));
}

function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

function blockedSummary(
  policyRevision: string,
  attemptedPairs: number,
  invalidAttempts: readonly IInvalidAttempt[],
  reasons: readonly string[],
  lane: string | null = null,
  workload: string | null = null,
  calibration = false,
  validPairs = 0,
  pairs: readonly IValidPairSummary[] = [],
): IRegressionComparison {
  return {
    attemptedPairs,
    calibration,
    exitCode: 2,
    invalidAttempts,
    lane,
    metrics: [],
    pairs,
    policyRevision,
    reasons,
    validPairs,
    verdict: "BLOCKED",
    workload,
  };
}

function pairSummaries(
  pairs: readonly {
    readonly baseline: IPerformanceRun;
    readonly candidate: IPerformanceRun;
    readonly order: PairOrder;
    readonly index: number;
  }[],
): IValidPairSummary[] {
  return pairs.map(({ baseline, candidate, index, order }) => ({
    baselineArtifactHash: baseline.identity.artifactHash,
    baselineNativeBinaryHash: baseline.identity.nativeBinaryHash,
    ...(baseline.durationSeconds === undefined
      ? {}
      : { baselineDurationSeconds: baseline.durationSeconds }),
    ...(baseline.sampleCount === undefined ? {} : { baselineSampleCount: baseline.sampleCount }),
    baselineReportHash: baseline.reportHash,
    candidateArtifactHash: candidate.identity.artifactHash,
    candidateNativeBinaryHash: candidate.identity.nativeBinaryHash,
    ...(candidate.durationSeconds === undefined
      ? {}
      : { candidateDurationSeconds: candidate.durationSeconds }),
    ...(candidate.sampleCount === undefined ? {} : { candidateSampleCount: candidate.sampleCount }),
    candidateReportHash: candidate.reportHash,
    index,
    order,
  }));
}

interface IParsedPair {
  readonly baseline: IPerformanceRun;
  readonly candidate: IPerformanceRun;
  readonly order: PairOrder;
  readonly index: number;
}

function evaluateMetric(
  metric: string,
  policy: IPerformancePolicy,
  policyMetric: IMetricPolicy,
  pairs: readonly IParsedPair[],
): IMetricPairResult {
  const observations = pairs.map(({ baseline, candidate }, index) => {
    const baselineMetric = baseline.metrics[metric];
    const candidateMetric = candidate.metrics[metric];
    if (baselineMetric === undefined || candidateMetric === undefined) {
      throw new PerformanceRegressionError(
        "TN_PERF_MISSING_OBSERVATION",
        `metric ${metric} is missing in pair ${index + 1}`,
      );
    }
    if (baselineMetric.unit !== policyMetric.unit || candidateMetric.unit !== policyMetric.unit) {
      throw new PerformanceRegressionError(
        "TN_PERF_UNIT_MISMATCH",
        `metric ${metric} does not use ${policyMetric.unit}`,
      );
    }
    const rawDelta = candidateMetric.value - baselineMetric.value;
    const delta = policyMetric.direction === "lower-is-worse" ? -rawDelta : rawDelta;
    const relativeDelta = delta / baselineMetric.value;
    const breaches = policyMetric.exact
      ? candidateMetric.value !== baselineMetric.value
      : delta > policyMetric.absoluteLimit && relativeDelta > policyMetric.relativeLimit;
    const floorBreaches: number[] = [];
    const floor = policy.absoluteFloors?.[metric] ??
      policyMetric.absoluteFloor ?? {
        ...(policyMetric.maximum === undefined ? {} : { maximum: policyMetric.maximum }),
        ...(policyMetric.minimum === undefined ? {} : { minimum: policyMetric.minimum }),
      };
    if (floor?.maximum !== undefined && candidateMetric.value > floor.maximum)
      floorBreaches.push(index);
    if (floor?.minimum !== undefined && candidateMetric.value < floor.minimum)
      floorBreaches.push(index);
    return {
      baseline: baselineMetric.value,
      candidate: candidateMetric.value,
      delta,
      relativeDelta,
      breaches,
      floorBreaches,
    };
  });
  const medianDelta = median(observations.map((observation) => observation.delta));
  const baselineMedian = median(observations.map((observation) => observation.baseline));
  const candidateMedian = median(observations.map((observation) => observation.candidate));
  const medianRelativeDelta = medianDelta / baselineMedian;
  const pairBreaches = observations.filter((observation) => observation.breaches).length;
  const floorBreaches = observations.flatMap((observation) => observation.floorBreaches);
  return {
    absoluteLimit: policyMetric.absoluteLimit,
    baselineMedian,
    candidateMedian,
    floorBreaches,
    medianDelta,
    medianRelativeDelta,
    metric,
    pairBreaches,
    pairs: observations.map(({ baseline, candidate, delta, relativeDelta, breaches }) => ({
      baseline,
      candidate,
      delta,
      relativeDelta,
      breaches,
    })),
    regression:
      floorBreaches.length > 0 ||
      (policyMetric.exact
        ? pairBreaches > 0
        : medianDelta > policyMetric.absoluteLimit &&
          medianRelativeDelta > policyMetric.relativeLimit &&
          pairBreaches >= 2),
    relativeLimit: policyMetric.relativeLimit,
    unit: policyMetric.unit,
  };
}

function evaluateParsed(
  input: IPerformanceComparisonInput,
  policy: IPerformancePolicy,
): IRegressionComparison {
  const attemptedPairs = input.pairs.length;
  const calibration = input.calibration === true || input.comparisonKind === "calibration";
  if (attemptedPairs === 0)
    return blockedSummary(policy.policyRevision, 0, [], ["comparison contains no pair attempts"]);
  const invalidAttempts: IInvalidAttempt[] = [];
  const valid: IParsedPair[] = [];
  const reasons: string[] = [];
  const seenReportHashes = new Set<string>();
  const baselineArtifacts = new Set<string>();
  const candidateArtifacts = new Set<string>();
  const baselineNativeBinaries = new Set<string>();
  const candidateNativeBinaries = new Set<string>();
  const baselineSources = new Set<string>();
  const candidateSources = new Set<string>();
  const comparableIdentities = new Set<string>();
  let lane = input.lane ?? null;
  let workload = input.workload ?? null;
  let manifestLane: IPerformanceLane | undefined;

  if (input.laneManifest !== undefined) {
    const manifest = parsePerformanceLaneManifest(input.laneManifest);
    if (lane === null) {
      reasons.push("a selected lane is required when a lane manifest is supplied");
    } else {
      manifestLane = laneForId(manifest, lane);
      if (manifestLane === undefined) {
        reasons.push(`selected lane ${lane} is not declared by the lane manifest`);
      } else {
        if (workload === null) workload = manifestLane.workload;
        if (input.workload !== undefined && input.workload !== manifestLane.workload) {
          reasons.push(
            `selected lane ${lane} requires workload ${manifestLane.workload}, received ${input.workload}`,
          );
        }
        const omittedMetrics =
          input.requiredMetrics === undefined
            ? []
            : manifestLane.requiredMetrics.filter(
                (metric) => !input.requiredMetrics?.includes(metric),
              );
        if (omittedMetrics.length > 0) {
          reasons.push(
            `requested metrics omit lane-required metrics: ${omittedMetrics.join(", ")}`,
          );
        }
        for (const metric of manifestLane.requiredMetrics) {
          if (
            policy.metrics[metric] === undefined &&
            policy.metrics[metric.split(".")[0] as string] === undefined
          ) {
            reasons.push(`lane-required metric ${metric} is unknown to policy`);
          }
        }
      }
    }
  }

  input.pairs.forEach((rawPair, index) => {
    const pair = objectValue(rawPair, `comparison.pairs[${index}]`);
    const invalid = invalidAttempt(pair, index);
    if (invalid !== undefined) {
      invalidAttempts.push(invalid);
      return;
    }
    const order = pair.order;
    if (order !== "baseline-first" && order !== "candidate-first") {
      reasons.push(`pair ${index + 1} does not declare baseline-first or candidate-first order`);
      return;
    }
    try {
      const baseline = parsePerformanceRun(pair.baseline, policy);
      const candidate = parsePerformanceRun(pair.candidate, policy);
      const pairFailures = compareIdentity(baseline, candidate, calibration);
      if (pairFailures.length > 0) {
        reasons.push(`pair ${index + 1}: ${pairFailures.join("; ")}`);
        return;
      }
      if (lane === null) lane = baseline.lane;
      if (workload === null) workload = baseline.workload;
      if (baseline.lane !== lane || candidate.lane !== lane) {
        reasons.push(`pair ${index + 1}: lane does not match the requested lane ${lane}`);
        return;
      }
      if (baseline.workload !== workload || candidate.workload !== workload) {
        reasons.push(
          `pair ${index + 1}: workload does not match the requested workload ${workload}`,
        );
        return;
      }
      for (const hash of [baseline.reportHash, candidate.reportHash]) {
        if (seenReportHashes.has(hash))
          reasons.push(`pair ${index + 1}: identical report hash ${hash} was reused`);
        seenReportHashes.add(hash);
      }
      baselineArtifacts.add(baseline.identity.artifactHash);
      candidateArtifacts.add(candidate.identity.artifactHash);
      baselineNativeBinaries.add(baseline.identity.nativeBinaryHash);
      candidateNativeBinaries.add(candidate.identity.nativeBinaryHash);
      baselineSources.add(baseline.identity.sourceSha);
      candidateSources.add(candidate.identity.sourceSha);
      comparableIdentities.add(comparableIdentityKey(baseline.identity));
      comparableIdentities.add(comparableIdentityKey(candidate.identity));
      valid.push({ baseline, candidate, index, order });
    } catch (error) {
      reasons.push(`pair ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const maxInvalid = policy.maxInvalidPairs ?? DEFAULT_MAX_INVALID_PAIRS;
  const minimumValid = policy.minimumValidPairs ?? DEFAULT_REQUIRED_PAIRS;
  if (invalidAttempts.length > maxInvalid) {
    reasons.push(`invalid pair attempts ${invalidAttempts.length} exceed the limit ${maxInvalid}`);
  }
  if (valid.length < minimumValid) {
    reasons.push(`only ${valid.length} valid pair(s); ${minimumValid} are required`);
  }
  if (valid.length !== DEFAULT_REQUIRED_PAIRS) {
    reasons.push(
      `exactly three valid pair(s) are required; received ${valid.length}; retries cannot replace the median`,
    );
  }
  if (valid.length >= 2) {
    const firstOrder = valid[0]?.order;
    const alternating = valid.every(
      (pair, index) =>
        pair.order ===
        (index % 2 === 0
          ? firstOrder
          : firstOrder === "baseline-first"
            ? "candidate-first"
            : "baseline-first"),
    );
    if (!alternating) {
      reasons.push(
        "valid pair initial orders must alternate baseline-first/candidate-first/baseline-first or the reverse",
      );
    }
  }
  if (seenReportHashes.size !== valid.length * 2) {
    reasons.push("identical report hashes make the attempt set non-independent");
  }
  if (baselineArtifacts.size > 1 || candidateArtifacts.size > 1) {
    reasons.push("baseline or candidate artifact identity changed between pair attempts");
  }
  if (baselineNativeBinaries.size > 1 || candidateNativeBinaries.size > 1) {
    reasons.push("baseline or candidate native binary identity changed between pair attempts");
  }
  if (baselineSources.size > 1 || candidateSources.size > 1) {
    reasons.push("baseline or candidate source identity changed between pair attempts");
  }
  if (comparableIdentities.size > 1) {
    reasons.push("device or comparable hardware identity changed between pair attempts");
  }
  if (reasons.length > 0) {
    return blockedSummary(
      policy.policyRevision,
      attemptedPairs,
      invalidAttempts,
      reasons,
      lane,
      workload,
      calibration,
      valid.length,
      pairSummaries(valid),
    );
  }

  const requestedMetrics =
    manifestLane?.requiredMetrics ??
    input.requiredMetrics ??
    policy.requiredMetrics ??
    Object.keys(policy.metrics);
  const metrics: IMetricPairResult[] = [];
  for (const metric of requestedMetrics) {
    const policyMetric = policy.metrics[metric] ?? policy.metrics[metric.split(".")[0] as string];
    if (policyMetric === undefined) {
      reasons.push(`requested metric ${metric} is unknown to policy`);
      continue;
    }
    try {
      metrics.push(evaluateMetric(metric, policy, policyMetric, valid));
    } catch (error) {
      reasons.push(`metric ${metric}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (reasons.length > 0) {
    return blockedSummary(
      policy.policyRevision,
      attemptedPairs,
      invalidAttempts,
      reasons,
      lane,
      workload,
      calibration,
      valid.length,
      pairSummaries(valid),
    );
  }
  const failingMetrics = metrics.filter((metric) => metric.regression);
  return {
    attemptedPairs,
    calibration,
    exitCode: failingMetrics.length > 0 ? 1 : 0,
    invalidAttempts,
    lane,
    metrics,
    pairs: pairSummaries(valid),
    policyRevision: policy.policyRevision,
    reasons: failingMetrics.map(
      (metric) => `${metric.metric} exceeded its paired regression policy`,
    ),
    validPairs: valid.length,
    verdict: failingMetrics.length > 0 ? "FAIL" : "PASS",
    workload,
  };
}

/** Evaluate all pairs without pooling frames or converting a missing observation into a pass. */
export function evaluatePairedComparison(
  input: unknown,
  policy: unknown = DEFAULT_PERFORMANCE_POLICY,
): IRegressionComparison {
  try {
    const parsedPolicy = parsePerformancePolicy(policy);
    return evaluateParsed(parseInput(input), parsedPolicy);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof PerformanceRegressionError ? error.code : "TN_PERF_BAD_INPUT";
    const policyRevision =
      typeof policy === "object" &&
      policy !== null &&
      "policyRevision" in policy &&
      typeof policy.policyRevision === "string"
        ? policy.policyRevision
        : PERFORMANCE_POLICY_REVISION;
    return blockedSummary(policyRevision, 0, [], [`${code}: ${message}`]);
  }
}

/** Short aliases for callers that treat the comparator as a pure policy function. */
export const comparePerformance = evaluatePairedComparison;
export const comparePaired = evaluatePairedComparison;
export const compare = evaluatePairedComparison;

/** Throws only for blocked evidence; a measured regression remains a structured FAIL result. */
export function assertPairedComparison(
  input: unknown,
  policy: unknown = DEFAULT_PERFORMANCE_POLICY,
): IRegressionComparison {
  const result = evaluatePairedComparison(input, policy);
  if (result.verdict === "BLOCKED") {
    throw new PerformanceRegressionError("TN_PERF_BLOCKED", result.reasons.join("; "));
  }
  return result;
}

export function renderRegressionMarkdown(result: IRegressionComparison): string {
  const lines = [
    `## Performance regression ${result.verdict}`,
    "",
    `- lane: ${result.lane ?? "unknown"}`,
    `- workload: ${result.workload ?? "unknown"}`,
    `- policy: ${result.policyRevision}`,
    `- comparison: ${result.calibration ? "A/A calibration" : "baseline/candidate"}`,
    `- pairs: ${result.validPairs}/${result.attemptedPairs} valid${result.invalidAttempts.length === 0 ? "" : `; ${result.invalidAttempts.length} invalid retained`}`,
    "",
  ];
  if (result.reasons.length > 0) {
    lines.push("### Reasons", "", ...result.reasons.map((reason) => `- ${reason}`), "");
  }
  if (result.metrics.length > 0) {
    lines.push(
      "| Metric | Baseline median | Candidate median | Median delta | Limits | Pair breaches | Verdict |",
      "| --- | ---: | ---: | ---: | --- | ---: | --- |",
      ...result.metrics.map(
        (metric) =>
          `| ${metric.metric} | ${metric.baselineMedian.toFixed(2)} ${metric.unit} | ${metric.candidateMedian.toFixed(2)} ${metric.unit} | ${metric.medianDelta.toFixed(2)} ${metric.unit} (${(metric.medianRelativeDelta * 100).toFixed(1)}%) | +${metric.absoluteLimit} ${metric.unit} and +${(metric.relativeLimit * 100).toFixed(0)}% | ${metric.pairBreaches}/${result.validPairs} | ${metric.regression ? "FAIL" : "PASS"} |`,
      ),
      "",
    );
  }
  if (result.pairs.length > 0) {
    lines.push(
      "### Pair identities",
      "",
      "| Pair | Initial order | Baseline report | Candidate report | Baseline artifact | Candidate artifact | Baseline native binary | Candidate native binary |",
      "| ---: | --- | --- | --- | --- | --- | --- | --- |",
      ...result.pairs.map(
        (pair) =>
          `| ${pair.index + 1} | ${pair.order} | ${pair.baselineReportHash} | ${pair.candidateReportHash} | ${pair.baselineArtifactHash} | ${pair.candidateArtifactHash} | ${pair.baselineNativeBinaryHash} | ${pair.candidateNativeBinaryHash} |`,
      ),
    );
  }
  return lines.join("\n");
}

export async function runPerformanceRegressionCli(options: {
  readonly input?: string;
  readonly lane?: string;
  readonly lanes?: string;
  readonly policy?: string;
  readonly output?: string;
}): Promise<IPerformanceRegressionCliResult> {
  if (options.input === undefined) {
    throw new PerformanceRegressionError(
      "TN_PERF_MISSING_INPUT",
      "--input report.json is required",
    );
  }
  let input: unknown;
  let policy: unknown = DEFAULT_PERFORMANCE_POLICY;
  try {
    input = JSON.parse(await readFile(options.input, "utf8")) as unknown;
    if (options.policy !== undefined) {
      policy = JSON.parse(await readFile(options.policy, "utf8")) as unknown;
    }
  } catch (error) {
    throw new PerformanceRegressionError(
      "TN_PERF_BAD_INPUT",
      `could not read or parse comparison input: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const inputObject =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : undefined;
  const inputLane =
    options.lane ?? (typeof inputObject?.lane === "string" ? inputObject.lane : undefined);
  if (options.lanes !== undefined || inputLane !== undefined) {
    const manifestFile =
      options.lanes ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "lanes.json");
    let laneManifest: unknown;
    try {
      laneManifest = JSON.parse(await readFile(manifestFile, "utf8")) as unknown;
      parsePerformanceLaneManifest(laneManifest);
    } catch (error) {
      if (error instanceof BenchError) {
        throw new PerformanceRegressionError(error.code, error.message);
      }
      throw new PerformanceRegressionError(
        "TN_PERF_BAD_LANE_MANIFEST",
        `could not read or parse ${manifestFile}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    input = {
      ...(inputObject ?? { pairs: Array.isArray(input) ? input : [] }),
      ...(inputLane === undefined ? {} : { lane: inputLane }),
      laneManifest,
    };
  }
  const summary = evaluatePairedComparison(input, policy);
  if (options.output !== undefined) {
    await writeFile(options.output, `${JSON.stringify(summary, null, 2)}\n`);
  }
  return { exitCode: summary.exitCode, markdown: renderRegressionMarkdown(summary), summary };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const result = await runPerformanceRegressionCli({
    input: argument("input"),
    lane: argument("lane"),
    lanes: argument("lanes"),
    output: argument("out"),
    policy: argument("policy"),
  });
  process.stdout.write(`${result.markdown}\n`);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode =
      error instanceof PerformanceRegressionError || error instanceof BenchError
        ? error.exitCode
        : 2;
  });
}
