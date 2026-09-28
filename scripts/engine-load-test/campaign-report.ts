// PRD-449 §10: the v2 campaign-run result contract and its fail-closed reader, alongside the legacy
// `parseRunReport` it leaves exactly as it was. A legacy report answers "what did this arm measure
// on this ladder"; a v2 record answers "which experiment, on which arm and build, in which block of
// which session, did what, with which evidence, and what could not be observed". Nothing here times a
// frame, writes a record or renders a report — the frozen plan, the CLI writer and the HTML report
// are later phases.
//
// Three states of a measured field are three different facts, so the reader keeps them apart: an
// absent key was never recorded, `null` was not observable and carries a reason, and `0` is a value
// somebody measured. A missing observation is never turned into a zero (§7.4, §9.1), and a reason
// never rides on a value that was observed.

import {
  BenchError,
  requireBoolean,
  requireNumber,
  requireObject,
  requireString,
} from "./report.js";

/** §10. Two versions, both bumped by hand: the record's own shape, and the derivation of every
 *  value derived from it. A reader that does not know a version must refuse the record. */
export const CAMPAIGN_SCHEMA_VERSION = 2;
export const CAMPAIGN_DERIVATION_VERSION = 1;

/** §3.2. A valid slower result is still valid; `inconclusive` is a comparison verdict, not a run
 *  state, and an unimplemented adapter is `not-run` rather than `unsupported`. */
export const CAMPAIGN_RUN_STATUSES = [
  "valid",
  "invalid",
  "crashed",
  "timed-out",
  "resource-limited",
  "unsupported",
  "not-run",
] as const;
export type CampaignRunStatus = (typeof CAMPAIGN_RUN_STATUSES)[number];

/** §7.4. The primary throughput metric is accounted for on every record: present with a value, or
 *  present as `null` plus a reason. Absent is not an option for it. */
export const PRIMARY_CAMPAIGN_METRIC = "completedWorkMeanMsPerFrame";
export const REQUIRED_CAMPAIGN_METRICS = [PRIMARY_CAMPAIGN_METRIC] as const;

/** §3.1. A label must not outlive the switches that produced it, so every arm carries its own. */
export const OPTIMIZATION_CLASSES = [
  "default",
  "independent-diagnostic",
  "explicit-instancing",
] as const;
export type OptimizationClass = (typeof OPTIMIZATION_CLASSES)[number];

/** §7.2. Two protocols whose scores are never combined. */
export const EXECUTION_PROTOCOLS = ["deterministic-throughput", "realtime-presentation"] as const;
export type ExecutionProtocol = (typeof EXECUTION_PROTOCOLS)[number];

export type ConformanceStatus = "failed" | "not-run" | "passed";

export interface ICampaignMeasurement {
  /** Present only when `value` is `null`: why the observation is missing. */
  readonly reason?: string;
  readonly unit: string;
  readonly value: number | null;
}

export interface ICampaignArm {
  readonly arm: string;
  readonly backend: string;
  readonly build: string;
  readonly buildSha256: string;
  readonly engineVersion: string;
  readonly flags: Readonly<Record<string, boolean | number | string>>;
}

/** §3. An experiment key is these seven components and nothing else; two records that differ in any
 *  one of them are two different experiments and must never be joined into one speedup. */
export interface ICampaignExperimentKey {
  readonly executionProtocol: ExecutionProtocol;
  readonly fixtureRevision: string;
  readonly load: string;
  readonly optimizationClass: OptimizationClass;
  readonly renderingProfile: string;
  readonly variant: string;
  readonly workload: string;
}

/** A reference to a raw series kept in the campaign bundle, so every displayed number resolves to
 *  the samples it came from (§9.1). */
export interface ICampaignRawSeries {
  readonly metric: string;
  readonly path: string;
  readonly sampleCount: number;
}

export interface ICampaignConformance {
  readonly evidencePath: string | null;
  readonly reason: string | null;
  readonly status: ConformanceStatus;
}

export interface ICampaignMachine {
  readonly cpu: string;
  readonly gpu: string;
  readonly operatingSystem: string;
  readonly preflight: {
    /** §7.1. Competing GPU work makes an environmental comparison invalid, not faster. */
    readonly competingGpuWork: boolean;
    readonly powerMode: string;
  };
}

export interface ICampaignRunRecord {
  readonly arm: ICampaignArm;
  readonly block: number;
  readonly campaignId: string;
  /** Campaign-relative artifact path → sha-256 of its bytes. Integrity, not authenticity (§9.2).
   *  Must cover every path in `rawSeries`: an unhashed sample file is not traceable. */
  readonly checksums: Readonly<Record<string, string>>;
  readonly conformance: ICampaignConformance;
  readonly derivationVersion: number;
  readonly durations: {
    readonly measured: ICampaignMeasurement;
    readonly startup: ICampaignMeasurement;
    readonly warmup: ICampaignMeasurement;
  };
  readonly experiment: ICampaignExperimentKey;
  readonly fixtureSha256: string;
  readonly machine: ICampaignMachine;
  readonly metrics: Readonly<Record<string, ICampaignMeasurement>>;
  readonly order: number;
  readonly planSha256: string;
  /** Empty is honest for a run that produced no samples — a crash, a timeout, a `not-run` arm — and
   *  is refused on a `valid` run, whose numbers have to resolve to samples. */
  readonly rawSeries: readonly ICampaignRawSeries[];
  /** Why this run is not `valid`. Null exactly when the run is valid. */
  readonly reason: string | null;
  /** Immutable attempt identity: every attempt keeps its own, so no attempt overwrites another. */
  readonly runId: string;
  readonly schemaVersion: number;
  /** §7.3. Blocks are distributed across sessions, so a session id is part of the attempt's place. */
  readonly session: string;
  readonly sourceSha256: string;
  readonly status: CampaignRunStatus;
  /** §7.4. What was timed, in words the report can print: scope, drain policy, sample count. */
  readonly timingDefinition: string;
}

const SHA256 = /^[0-9a-f]{64}$/u;

function requireEnum<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  path: string,
): T {
  const value = requireString(source, key, path);
  if (!(allowed as readonly string[]).includes(value))
    throw new BenchError(
      "TN_BENCH_BAD_SHAPE",
      `${path}.${key} ${value} is not one of ${allowed.join(", ")}`,
    );
  return value as T;
}

function requireSha256(source: Record<string, unknown>, key: string, path: string): string {
  const value = requireString(source, key, path);
  if (!SHA256.test(value))
    throw new BenchError("TN_BENCH_BAD_SHAPE", `${path}.${key} must be a sha-256 hex digest`);
  return value;
}

function requireOrderIndex(source: Record<string, unknown>, key: string, path: string): number {
  const value = requireNumber(source, key, path);
  if (!Number.isInteger(value) || value < 1)
    throw new BenchError("TN_BENCH_BAD_SHAPE", `${path}.${key} must be a whole number from 1 up`);
  return value;
}

function requirePositiveCount(source: Record<string, unknown>, key: string, path: string): number {
  const value = requireNumber(source, key, path);
  if (!Number.isInteger(value) || value < 1)
    throw new BenchError("TN_BENCH_BAD_SHAPE", `${path}.${key} must be a whole count from 1 up`);
  return value;
}

/** An artifact reference stays inside the campaign root: no scheme, no backslash, and no empty or
 *  dotted segment — a leading `/` is an empty first segment, so absolute paths fall out too. The
 *  report renders and later opens these links, so traversal and absolute paths are rejected here
 *  rather than escaped there (§9.2). Campaign and run ids are single path segments in the immutable
 *  store and pass the same rule. */
function assertSafeRef(value: string, label: string): string {
  const unsafe =
    value.includes("\\") ||
    value.includes(":") ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
  if (unsafe)
    throw new BenchError(
      "TN_BENCH_UNSAFE_ARTIFACT_REF",
      `${label} must be a relative path inside the campaign root`,
    );
  return value;
}

function requireArtifactRef(source: Record<string, unknown>, key: string, path: string): string {
  return assertSafeRef(requireString(source, key, path), `${path}.${key}`);
}

function optionalText(source: Record<string, unknown>, key: string, path: string): string | null {
  return source[key] === null ? null : requireString(source, key, path);
}

function parseMeasurement(value: unknown, path: string): ICampaignMeasurement {
  const source = requireObject(value, path);
  const unit = requireString(source, "unit", path);
  if (source.value === null) {
    const reason = requireString(source, "reason", path);
    return { reason, unit, value: null };
  }
  const measured = requireNumber(source, "value", path);
  if (measured < 0)
    throw new BenchError("TN_BENCH_BAD_SHAPE", `${path}.value must not be negative`);
  // A reason belongs to a missing measurement; carrying one on a measured value would make the
  // record's own third state (observed, and objected to) unreadable.
  if (source.reason !== undefined)
    throw new BenchError("TN_BENCH_BAD_SHAPE", `${path}.reason is for a null measurement only`);
  // A measured zero keeps its zero: only an unobservable measurement is `null`.
  return { unit, value: measured };
}

function parseMetrics(value: unknown): Record<string, ICampaignMeasurement> {
  const source = requireObject(value, "run.metrics");
  const metrics: Record<string, ICampaignMeasurement> = {};
  for (const [name, entry] of Object.entries(source))
    metrics[name] = parseMeasurement(entry, `run.metrics.${name}`);
  for (const required of REQUIRED_CAMPAIGN_METRICS) {
    if (!(required in metrics))
      throw new BenchError("TN_BENCH_BAD_SHAPE", `run.metrics.${required} is absent`);
  }
  return metrics;
}

function parseDurations(value: unknown): ICampaignRunRecord["durations"] {
  const source = requireObject(value, "run.durations");
  return {
    measured: parseMeasurement(source.measured, "run.durations.measured"),
    startup: parseMeasurement(source.startup, "run.durations.startup"),
    warmup: parseMeasurement(source.warmup, "run.durations.warmup"),
  };
}

function parseArm(value: unknown): ICampaignArm {
  const path = "run.arm";
  const source = requireObject(value, path);
  const flagsPath = `${path}.flags`;
  const flags: Record<string, boolean | number | string> = {};
  for (const [name, entry] of Object.entries(requireObject(source.flags, flagsPath))) {
    if (typeof entry === "boolean" || typeof entry === "string") flags[name] = entry;
    else if (typeof entry === "number" && Number.isFinite(entry)) flags[name] = entry;
    else
      throw new BenchError(
        "TN_BENCH_BAD_SHAPE",
        `${flagsPath}.${name} must be a boolean, a finite number or a string`,
      );
  }
  return {
    arm: requireString(source, "arm", path),
    backend: requireString(source, "backend", path),
    build: requireString(source, "build", path),
    buildSha256: requireSha256(source, "buildSha256", path),
    engineVersion: requireString(source, "engineVersion", path),
    flags,
  };
}

function parseExperiment(value: unknown): ICampaignExperimentKey {
  const path = "run.experiment";
  const source = requireObject(value, path);
  return {
    executionProtocol: requireEnum(source, "executionProtocol", EXECUTION_PROTOCOLS, path),
    fixtureRevision: requireString(source, "fixtureRevision", path),
    load: requireString(source, "load", path),
    optimizationClass: requireEnum(source, "optimizationClass", OPTIMIZATION_CLASSES, path),
    renderingProfile: requireString(source, "renderingProfile", path),
    variant: requireString(source, "variant", path),
    workload: requireString(source, "workload", path),
  };
}

/** Narrows the metric map for the `valid` gate. `parseMetrics` has already refused a record without
 *  it, so this is the fail-closed path if the required list ever stops naming the primary metric. */
function primaryMetric(metrics: Record<string, ICampaignMeasurement>): ICampaignMeasurement {
  const primary = metrics[PRIMARY_CAMPAIGN_METRIC];
  if (primary === undefined)
    throw new BenchError("TN_BENCH_BAD_SHAPE", `run.metrics.${PRIMARY_CAMPAIGN_METRIC} is absent`);
  return primary;
}

function parseRawSeries(value: unknown): ICampaignRawSeries[] {
  if (!Array.isArray(value))
    throw new BenchError("TN_BENCH_BAD_SHAPE", "run.rawSeries must be an array");
  return value.map((entry, index) => {
    const path = `run.rawSeries[${index}]`;
    const source = requireObject(entry, path);
    return {
      metric: requireString(source, "metric", path),
      path: requireArtifactRef(source, "path", path),
      sampleCount: requirePositiveCount(source, "sampleCount", path),
    };
  });
}

function parseConformance(value: unknown): ICampaignConformance {
  const path = "run.conformance";
  const source = requireObject(value, path);
  const status = requireEnum<ConformanceStatus>(
    source,
    "status",
    ["failed", "not-run", "passed"],
    path,
  );
  const reason = optionalText(source, "reason", path);
  const evidencePath =
    source.evidencePath === null ? null : requireArtifactRef(source, "evidencePath", path);
  if (status === "passed") {
    // §6.1: hash equality is not execution, so a passed conformance names the evidence and carries
    // no outstanding objection.
    if (evidencePath === null)
      throw new BenchError("TN_BENCH_BAD_SHAPE", `${path}.evidencePath is absent for a pass`);
    if (reason !== null)
      throw new BenchError("TN_BENCH_BAD_SHAPE", `${path} is passed and cannot carry a reason`);
  } else if (reason === null) {
    throw new BenchError("TN_BENCH_BAD_SHAPE", `${path}.reason must say why it is ${status}`);
  }
  return { evidencePath, reason, status };
}

function parseMachine(value: unknown): ICampaignMachine {
  const path = "run.machine";
  const source = requireObject(value, path);
  const preflightPath = `${path}.preflight`;
  const preflight = requireObject(source.preflight, preflightPath);
  return {
    cpu: requireString(source, "cpu", path),
    gpu: requireString(source, "gpu", path),
    operatingSystem: requireString(source, "operatingSystem", path),
    preflight: {
      competingGpuWork: requireBoolean(preflight, "competingGpuWork", preflightPath),
      powerMode: requireString(preflight, "powerMode", preflightPath),
    },
  };
}

function parseChecksums(value: unknown): Record<string, string> {
  const source = requireObject(value, "run.checksums");
  const checksums: Record<string, string> = {};
  for (const [ref, digest] of Object.entries(source)) {
    assertSafeRef(ref, "run.checksums key");
    if (typeof digest !== "string" || !SHA256.test(digest))
      throw new BenchError(
        "TN_BENCH_BAD_SHAPE",
        `run.checksums.${ref} must be a sha-256 hex digest`,
      );
    checksums[ref] = digest;
  }
  return checksums;
}

/** §7.4. A `valid` run is a measured claim, so it must carry the measurement, a positive measured
 *  duration, the conformance evidence and the samples it came from. A run missing any of those is
 *  some other status, and the record has to name it rather than dress the gap up as a result. */
function assertValidRun(
  conformance: ICampaignConformance,
  measured: ICampaignMeasurement,
  primary: ICampaignMeasurement,
  rawSeries: readonly ICampaignRawSeries[],
): void {
  if (conformance.status !== "passed")
    throw new BenchError("TN_BENCH_BAD_SHAPE", "run.conformance must be passed on a valid run");
  if (rawSeries.length === 0)
    throw new BenchError("TN_BENCH_BAD_SHAPE", "run.rawSeries is empty on a valid run");
  for (const [label, measurement] of [
    [`run.metrics.${PRIMARY_CAMPAIGN_METRIC}`, primary],
    ["run.durations.measured", measured],
  ] as const) {
    if (measurement.value === null)
      throw new BenchError("TN_BENCH_BAD_SHAPE", `${label} is null on a valid run`);
    if (measurement.value <= 0)
      throw new BenchError(
        "TN_BENCH_BAD_SHAPE",
        `${label} must be greater than zero on a valid run`,
      );
  }
}

/**
 * Read one v2 campaign run record, or fail closed. Every required identity is required: a record
 * that cannot name its campaign, plan, source, build and experiment is not evidence, whatever it
 * measured.
 */
export function parseCampaignRun(value: unknown): ICampaignRunRecord {
  const root = requireObject(value, "run");

  const schemaVersion = requireNumber(root, "schemaVersion", "run");
  if (schemaVersion !== CAMPAIGN_SCHEMA_VERSION)
    throw new BenchError(
      "TN_BENCH_BAD_SCHEMA",
      `run.schemaVersion ${schemaVersion} is not ${CAMPAIGN_SCHEMA_VERSION}`,
    );
  const derivationVersion = requireNumber(root, "derivationVersion", "run");
  if (derivationVersion !== CAMPAIGN_DERIVATION_VERSION)
    throw new BenchError(
      "TN_BENCH_BAD_SCHEMA",
      `run.derivationVersion ${derivationVersion} is not ${CAMPAIGN_DERIVATION_VERSION}`,
    );

  const status = requireEnum(root, "status", CAMPAIGN_RUN_STATUSES, "run");
  const reason = optionalText(root, "reason", "run");
  if (status === "valid" && reason !== null)
    throw new BenchError("TN_BENCH_BAD_SHAPE", "run.reason is set on a valid run");
  if (status !== "valid" && reason === null)
    throw new BenchError("TN_BENCH_BAD_SHAPE", `run.reason must say why the run is ${status}`);

  const checksums = parseChecksums(root.checksums);
  const conformance = parseConformance(root.conformance);
  const durations = parseDurations(root.durations);
  const metrics = parseMetrics(root.metrics);
  const primary = primaryMetric(metrics);
  const rawSeries = parseRawSeries(root.rawSeries);
  // A number with no samples behind it is fabricated evidence: either the run kept raw samples, or
  // the primary metric is null plus the reason it could not be observed. This is what lets a crash
  // or a `not-run` arm be written at all.
  if (rawSeries.length === 0 && primary.value !== null)
    throw new BenchError(
      "TN_BENCH_BAD_SHAPE",
      `run.rawSeries is empty, so run.metrics.${PRIMARY_CAMPAIGN_METRIC} must be null with a reason`,
    );
  // §9.2 integrity: a referenced sample file whose bytes are not checksummed cannot be verified, and
  // the writer hashes the series it writes anyway.
  for (const series of rawSeries)
    if (!(series.path in checksums))
      throw new BenchError("TN_BENCH_BAD_SHAPE", `run.checksums has no entry for ${series.path}`);
  if (status === "valid") assertValidRun(conformance, durations.measured, primary, rawSeries);

  return {
    arm: parseArm(root.arm),
    block: requireOrderIndex(root, "block", "run"),
    campaignId: assertSafeRef(requireString(root, "campaignId", "run"), "run.campaignId"),
    checksums,
    conformance,
    derivationVersion,
    durations,
    experiment: parseExperiment(root.experiment),
    fixtureSha256: requireSha256(root, "fixtureSha256", "run"),
    machine: parseMachine(root.machine),
    metrics,
    order: requireOrderIndex(root, "order", "run"),
    planSha256: requireSha256(root, "planSha256", "run"),
    rawSeries,
    reason,
    runId: assertSafeRef(requireString(root, "runId", "run"), "run.runId"),
    schemaVersion,
    session: assertSafeRef(requireString(root, "session", "run"), "run.session"),
    sourceSha256: requireSha256(root, "sourceSha256", "run"),
    status,
    timingDefinition: requireString(root, "timingDefinition", "run"),
  };
}
