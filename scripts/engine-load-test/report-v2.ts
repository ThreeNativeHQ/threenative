// PRD-449 §10: the versioned v2 result contract, beside `report.ts` and not inside it — v1 parse,
// compare, knee and baseline meaning stay exactly as they were, and nothing here changes how a v1
// report is read or compared. A v2 record is one immutable attempt under a campaign: never an
// overwrite of `tn-desktop.json`, always a new `runId`.
//
// The contract's one hard idea is that `absent`, `null` and `0` are three different claims. Absent
// is a record that did not say what it measured, and it is refused. `null` is a measurement the
// platform never exposed, and it owes an observer a reason. `0` is a number somebody watched happen
// and is kept. A reason attached to a real value is the missing-GPU-sample trap in a zero's
// clothes, so it is refused too.

import {
  BenchError,
  type IRunReport,
  parseRunReport,
  requireBoolean,
  requireNumber,
  requireObject,
  requireString,
} from "./report.js";

export const RUN_STATUSES = [
  "valid",
  "invalid",
  "crashed",
  "timed-out",
  "resource-limited",
  "unsupported",
  "not-run",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const COMPARABILITIES = ["matched-task", "qualified", "non-comparable"] as const;
export type Comparability = (typeof COMPARABILITIES)[number];

export const OPTIMIZATION_CLASSES = [
  "default",
  "independent-diagnostic",
  "explicit-instancing",
] as const;
export type OptimizationClass = (typeof OPTIMIZATION_CLASSES)[number];

export const EXECUTION_PROTOCOLS = ["deterministic-throughput", "realtime-presentation"] as const;
export type ExecutionProtocol = (typeof EXECUTION_PROTOCOLS)[number];

export const LANE_PROVISIONING = [
  "physical-hardware",
  "simulator",
  "hosted-software",
  "unprovisioned",
] as const;
export type LaneProvisioning = (typeof LANE_PROVISIONING)[number];

/** §3: two arms may only be joined into a ratio under the same key. */
export interface IExperimentKey {
  fixtureRevision: string;
  load: string;
  optimizationClass: OptimizationClass;
  protocol: ExecutionProtocol;
  renderingProfile: string;
  variant: string;
  workload: string;
}

export interface IV2Arm {
  backend: string;
  build: { hash: string; type: "release" | "debug" };
  engine: string;
  /** Effective switches, disclosed rather than trusted (§3.1). */
  flags: Record<string, string>;
  id: string;
  version: string;
}

export interface IV2Metric {
  name: string;
  /** Present exactly when `value` is `null`. */
  reason?: string;
  unit: string;
  /** `null` means the platform never exposed this metric. Zero is a real observation. */
  value: number | null;
}

export interface IV2RunRecord {
  arm: IV2Arm;
  /** 1-based paired block (§7.3). */
  block: number;
  campaignHash: string;
  campaignId: string;
  /**
   * §9.2 artifact integrity: a safe relative bundle ref to the SHA-256 of the file it names, which
   * must cover `timing.rawSeries` when one is supplied. The v2 record's own digest is deliberately
   * not here — a file cannot state the checksum of the bytes that contain it, and inventing one is
   * how a bundle ends up attesting to itself. That digest belongs to the bundle's `checksums.sha256`.
   */
  checksums: Record<string, string>;
  comparability: Comparability;
  /** Why this comparison is not matched-task; absent when it is. */
  comparabilityReason?: string;
  derivationVersion: string;
  /**
   * §7.4: startup and footprint are secondary, so a phase nobody timed separately is `null` plus a
   * reason rather than a fake zero. `measure` stays the one duration every `valid` run owes, so it
   * keeps a plain number with nothing to explain.
   */
  durationMs: {
    measure: number;
    /** `null` means the phase was not timed separately. Zero is a real observation. */
    startup: number | null;
    /** Always written: non-empty exactly when `startup` is `null`, else `null` beside a real number. */
    startupReason: string | null;
    warmup: number | null;
    /** Always written: non-empty exactly when `warmup` is `null`, else `null` beside a real number. */
    warmupReason: string | null;
  };
  experiment: IExperimentKey;
  fixture: { conformance: "pass" | "fail" | "not-run"; evidence: string | null; hash: string };
  machine: {
    gpu: string;
    id: string;
    lane: LaneProvisioning;
    os: string;
    preflight: { passed: boolean; reason: string | null };
  };
  metrics: IV2Metric[];
  /** 0-based arm order within the block, from the recorded randomization seed. */
  order: number;
  outcome: { reason: string | null; runStatus: RunStatus };
  planHash: string;
  runId: string;
  schemaVersion: 2;
  /** 1-based session; seven paired blocks are distributed across at least two. */
  session: number;
  sourceHash: string;
  timing: {
    definition: string;
    measuredFrames: number;
    /** `null` when the attempt produced no samples at all; paired with `rawSeriesReason`, never invented. */
    rawSeries: string | null;
    /** Present exactly when `rawSeries` is `null`. */
    rawSeriesReason: string | null;
    warmupFrames: number;
  };
}

export type ResultRecord =
  | { report: IRunReport; schemaVersion: 1 }
  | { record: IV2RunRecord; schemaVersion: 2 };

/** §7.4: the primary throughput metric every v2 record has to carry or explain. */
export const PRIMARY_METRIC = "completed-work-mean-ms";

const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/u;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9._-]+)*$/u;

function fail(path: string, detail: string): never {
  throw new BenchError("TN_BENCH_BAD_SHAPE", `${path} ${detail}`);
}

function requireIdentifier(source: Record<string, unknown>, key: string, path: string): string {
  const value = requireString(source, key, path);
  if (!IDENTIFIER.test(value)) fail(`${path}.${key}`, "must be a plain identifier");
  return value;
}

function requireHash(source: Record<string, unknown>, key: string, path: string): string {
  const value = requireString(source, key, path);
  if (!SHA256.test(value)) fail(`${path}.${key}`, "must be SHA-256 hex");
  return value;
}

/** A relative ref inside the campaign bundle: no absolute path, no traversal, no backslash (§9.2). */
function isSafeRef(value: string): boolean {
  const segments = value.split("/");
  return SAFE_REF.test(value) && !segments.some((segment) => segment === "." || segment === "..");
}

function requireArtifactRef(source: Record<string, unknown>, key: string, path: string): string {
  const value = requireString(source, key, path);
  if (!isSafeRef(value)) fail(`${path}.${key}`, "must be a safe relative artifact ref");
  return value;
}

function requireEnum<T extends string>(
  source: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly T[],
): T {
  const value = requireString(source, key, path);
  if (!(allowed as readonly string[]).includes(value)) {
    fail(`${path}.${key}`, `${value} is not one of ${allowed.join("|")}`);
  }
  return value as T;
}

function requireNonNegative(source: Record<string, unknown>, key: string, path: string): number {
  const value = requireNumber(source, key, path);
  if (value < 0) fail(`${path}.${key}`, "must be a finite non-negative number");
  return value;
}

function requireCount(
  source: Record<string, unknown>,
  key: string,
  path: string,
  min: number,
): number {
  const value = requireNonNegative(source, key, path);
  if (!Number.isInteger(value) || value < min)
    fail(`${path}.${key}`, `must be an integer >= ${min}`);
  return value;
}

/** `null` is an explicit "none here"; an absent key is a record that did not fill the field in. */
function requireNullableString(
  source: Record<string, unknown>,
  key: string,
  path: string,
): string | null {
  const value = source[key];
  if (value === undefined) fail(`${path}.${key}`, "is absent; use null instead");
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    fail(`${path}.${key}`, "must be a non-empty string or null");
  }
  return value;
}

function requireFlags(value: unknown, path: string): Record<string, string> {
  const source = requireObject(value, path);
  const flags: Record<string, string> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (!IDENTIFIER.test(key) || typeof entry !== "string" || entry.length === 0) {
      fail(path, `flag ${key} must be a non-empty string under a plain name`);
    }
    flags[key] = entry;
  }
  return flags;
}

/** `null` plus a reason, or a real value with no reason attached. There is no third option. */
function parseMetric(value: unknown, path: string): IV2Metric {
  const source = requireObject(value, path);
  const name = requireIdentifier(source, "name", path);
  const unit = requireIdentifier(source, "unit", path);
  const raw = source.value;
  if (raw === undefined) fail(`${path}.value`, `is absent; ${name} must be measured or null`);
  const reason = requireNullableString(source, "reason", path);
  if (raw === null) {
    if (reason === null) fail(`${path}.value`, `is null for ${name} without a reason`);
    return { name, reason, unit, value: null };
  }
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    fail(`${path}.value`, `for ${name} must be a finite non-negative number or null`);
  }
  if (reason !== null) {
    fail(`${path}.reason`, `contradicts a real value for ${name}; unmeasured is null, not zero`);
  }
  return { name, unit, value: raw };
}

/**
 * A secondary duration carries the same three-way claim as a metric, and both halves are always
 * written: `null` is a phase the lane never timed separately and it owes an observer a reason, a
 * real number — zero included — is kept, and a reason beside a real number is refused. An omitted
 * reason is refused like an omitted metric is, because there is no v2 record in the wild to keep
 * working; only synthetic fixtures ever wrote one.
 */
function parseSecondaryDuration(
  source: Record<string, unknown>,
  key: "startup" | "warmup",
  path: string,
): { reason: string | null; value: number | null } {
  const raw = source[key];
  if (raw === undefined) fail(`${path}.${key}`, "is absent; use null instead");
  const reason = requireNullableString(source, `${key}Reason`, path);
  if (raw === null) {
    if (reason === null) {
      fail(`${path}.${key}Reason`, `is required when ${key} is null; unmeasured is null, not zero`);
    }
    return { reason, value: null };
  }
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    fail(`${path}.${key}`, "must be a finite non-negative number or null");
  }
  if (reason !== null) {
    fail(`${path}.${key}Reason`, `contradicts a real ${key}; unmeasured is null, not zero`);
  }
  return { reason: null, value: raw };
}

/**
 * §9.2: a ref to digest map over the bundle's artifacts, so a reader can check each named file
 * without the record having to guess a byte scope for a checksum of itself. An empty map is legal —
 * an attempt that produced no artifact cites none.
 */
function parseChecksums(value: unknown): Record<string, string> {
  const source = requireObject(value, "v2RunRecord.checksums");
  const checksums: Record<string, string> = {};
  for (const ref of Object.keys(source)) {
    if (!isSafeRef(ref))
      fail("v2RunRecord.checksums", `${ref} must be a safe relative artifact ref`);
    checksums[ref] = requireHash(source, ref, "v2RunRecord.checksums");
  }
  return checksums;
}

/** The primary metric has to be there by name, exactly once — a duplicate name has no single value. */
function parseMetrics(value: unknown): { metrics: IV2Metric[]; primary: IV2Metric } {
  if (!Array.isArray(value) || value.length === 0) {
    fail("v2RunRecord.metrics", "must list at least the primary metric");
  }
  const metrics = value.map((entry, index) => parseMetric(entry, `v2RunRecord.metrics[${index}]`));
  const names = new Set<string>();
  for (const metric of metrics) {
    if (names.has(metric.name)) fail("v2RunRecord.metrics", `duplicate metric name ${metric.name}`);
    names.add(metric.name);
  }
  const primary = metrics.find((metric) => metric.name === PRIMARY_METRIC);
  if (primary === undefined) fail("v2RunRecord.metrics", `must carry ${PRIMARY_METRIC}`);
  if (primary.unit !== "ms") fail("v2RunRecord.metrics", `${PRIMARY_METRIC} must use milliseconds`);
  return { metrics, primary };
}

/** Everything a `valid` run has to have actually done, as opposed to claimed (§10, §11). */
interface IValidRunFacts {
  conformance: "pass" | "fail" | "not-run";
  evidence: string | null;
  measure: number;
  measuredFrames: number;
  preflightPassed: boolean;
  primaryValue: number | null;
}

/**
 * `valid` is the only status that promises a measurement, so it is the only one that owes evidence.
 * Without this gate a run reported zero frames, zero milliseconds, a failed preflight and no
 * conformance evidence, and still parsed as valid — the exact record PRD-449's honest-failure rule
 * exists to refuse. A non-valid attempt owes no such thing: `0` frames and `0` ms are the honest
 * shape of a run that measured nothing, and it says so through `runStatus` and its reason.
 */
function requireValidRunFacts(facts: IValidRunFacts): void {
  if (facts.primaryValue === null) {
    fail("v2RunRecord.metrics", `a valid run owes a measured ${PRIMARY_METRIC}, not null`);
  }
  if (facts.primaryValue === 0) {
    fail(
      "v2RunRecord.metrics",
      `a valid run owes completed work; ${PRIMARY_METRIC} of 0 means no frame completed`,
    );
  }
  if (facts.measuredFrames < 1) {
    fail("v2RunRecord.timing.measuredFrames", "a valid run owes at least one measured frame");
  }
  if (facts.measure <= 0) {
    fail("v2RunRecord.durationMs.measure", "a valid run owes a positive measure duration");
  }
  if (!facts.preflightPassed) {
    fail("v2RunRecord.machine.preflight", "a valid run owes a passing preflight");
  }
  if (facts.conformance !== "pass" || facts.evidence === null) {
    fail("v2RunRecord.fixture", "a valid run owes fixture conformance pass with its evidence");
  }
}

/** §3.2: status and comparability are separate questions, and neither is free of explanation. */
function parseOutcome(
  source: Record<string, unknown>,
  facts: IValidRunFacts,
): {
  comparability: Comparability;
  comparabilityReason: string | null;
  outcome: IV2RunRecord["outcome"];
} {
  const outcomeSource = requireObject(source.outcome, "v2RunRecord.outcome");
  const reason = requireNullableString(outcomeSource, "reason", "v2RunRecord.outcome");
  const runStatus = requireEnum(outcomeSource, "runStatus", "v2RunRecord.outcome", RUN_STATUSES);
  if (runStatus === "valid" && reason !== null) {
    fail("v2RunRecord.outcome", "a valid run cannot carry a failure reason");
  }
  if (runStatus !== "valid" && reason === null) {
    fail("v2RunRecord.outcome", `runStatus ${runStatus} owes a reason`);
  }
  if (runStatus === "valid") requireValidRunFacts(facts);
  const comparability = requireEnum(source, "comparability", "v2RunRecord", COMPARABILITIES);
  const comparabilityReason = requireNullableString(source, "comparabilityReason", "v2RunRecord");
  if (comparability !== "matched-task" && comparabilityReason === null) {
    fail("v2RunRecord.comparability", `${comparability} owes a comparabilityReason`);
  }
  if (comparability === "matched-task" && comparabilityReason !== null) {
    fail("v2RunRecord.comparabilityReason", "contradicts a matched-task comparison");
  }
  return {
    comparability,
    comparabilityReason,
    outcome: { reason, runStatus },
  };
}

export function parseV2RunRecord(value: unknown): IV2RunRecord {
  const source = requireObject(value, "v2RunRecord");
  const version = source.schemaVersion;
  if (version !== 2) fail("v2RunRecord.schemaVersion", "must be 2");
  const derivationVersion = requireIdentifier(source, "derivationVersion", "v2RunRecord");

  const armSource = requireObject(source.arm, "v2RunRecord.arm");
  const buildSource = requireObject(armSource.build, "v2RunRecord.arm.build");
  const arm: IV2Arm = {
    backend: requireIdentifier(armSource, "backend", "v2RunRecord.arm"),
    build: {
      hash: requireHash(buildSource, "hash", "v2RunRecord.arm.build"),
      type: requireEnum(buildSource, "type", "v2RunRecord.arm.build", ["release", "debug"]),
    },
    engine: requireIdentifier(armSource, "engine", "v2RunRecord.arm"),
    flags: requireFlags(armSource.flags, "v2RunRecord.arm.flags"),
    id: requireIdentifier(armSource, "id", "v2RunRecord.arm"),
    version: requireIdentifier(armSource, "version", "v2RunRecord.arm"),
  };

  const experimentSource = requireObject(source.experiment, "v2RunRecord.experiment");
  const experiment: IExperimentKey = {
    fixtureRevision: requireIdentifier(
      experimentSource,
      "fixtureRevision",
      "v2RunRecord.experiment",
    ),
    load: requireIdentifier(experimentSource, "load", "v2RunRecord.experiment"),
    optimizationClass: requireEnum(
      experimentSource,
      "optimizationClass",
      "v2RunRecord.experiment",
      OPTIMIZATION_CLASSES,
    ),
    protocol: requireEnum(
      experimentSource,
      "protocol",
      "v2RunRecord.experiment",
      EXECUTION_PROTOCOLS,
    ),
    renderingProfile: requireIdentifier(
      experimentSource,
      "renderingProfile",
      "v2RunRecord.experiment",
    ),
    variant: requireIdentifier(experimentSource, "variant", "v2RunRecord.experiment"),
    workload: requireIdentifier(experimentSource, "workload", "v2RunRecord.experiment"),
  };

  const fixtureSource = requireObject(source.fixture, "v2RunRecord.fixture");
  const fixtureConformance = requireEnum(fixtureSource, "conformance", "v2RunRecord.fixture", [
    "pass",
    "fail",
    "not-run",
  ]);
  const evidence = fixtureSource.evidence;
  if (evidence === undefined) fail("v2RunRecord.fixture.evidence", "is absent; use null instead");
  if (evidence !== null) requireArtifactRef(fixtureSource, "evidence", "v2RunRecord.fixture");

  const machineSource = requireObject(source.machine, "v2RunRecord.machine");
  const preflightSource = requireObject(machineSource.preflight, "v2RunRecord.machine.preflight");
  const preflightPassed = requireBoolean(
    preflightSource,
    "passed",
    "v2RunRecord.machine.preflight",
  );
  const preflightReason = requireNullableString(
    preflightSource,
    "reason",
    "v2RunRecord.machine.preflight",
  );
  if (!preflightPassed && preflightReason === null) {
    fail("v2RunRecord.machine.preflight", "failed without a reason");
  }

  const timingSource = requireObject(source.timing, "v2RunRecord.timing");
  if (timingSource.rawSeries === undefined) {
    fail("v2RunRecord.timing.rawSeries", "is absent; use null instead");
  }
  const rawSeries =
    timingSource.rawSeries === null
      ? null
      : requireArtifactRef(timingSource, "rawSeries", "v2RunRecord.timing");
  const rawSeriesReason = requireNullableString(
    timingSource,
    "rawSeriesReason",
    "v2RunRecord.timing",
  );
  if (rawSeries === null && rawSeriesReason === null) {
    fail("v2RunRecord.timing.rawSeriesReason", "a null raw series owes a reason");
  }
  if (rawSeries !== null && rawSeriesReason !== null) {
    fail("v2RunRecord.timing.rawSeriesReason", "contradicts a supplied raw series");
  }
  const timing: IV2RunRecord["timing"] = {
    definition: requireString(timingSource, "definition", "v2RunRecord.timing"),
    measuredFrames: requireCount(timingSource, "measuredFrames", "v2RunRecord.timing", 0),
    rawSeries,
    rawSeriesReason,
    warmupFrames: requireCount(timingSource, "warmupFrames", "v2RunRecord.timing", 0),
  };

  const checksums = parseChecksums(source.checksums);
  if (rawSeries !== null && checksums[rawSeries] === undefined) {
    fail("v2RunRecord.checksums", `must cover the raw series ${rawSeries}`);
  }
  if (evidence !== null && checksums[evidence as string] === undefined) {
    fail("v2RunRecord.checksums", `must cover fixture evidence ${evidence}`);
  }

  const durationSource = requireObject(source.durationMs, "v2RunRecord.durationMs");
  const startup = parseSecondaryDuration(durationSource, "startup", "v2RunRecord.durationMs");
  const warmup = parseSecondaryDuration(durationSource, "warmup", "v2RunRecord.durationMs");
  const durationMs: IV2RunRecord["durationMs"] = {
    measure: requireNonNegative(durationSource, "measure", "v2RunRecord.durationMs"),
    startup: startup.value,
    startupReason: startup.reason,
    warmup: warmup.value,
    warmupReason: warmup.reason,
  };

  const { metrics, primary } = parseMetrics(source.metrics);
  const { comparability, comparabilityReason, outcome } = parseOutcome(source, {
    conformance: fixtureConformance,
    evidence: evidence as string | null,
    measure: durationMs.measure,
    measuredFrames: timing.measuredFrames,
    preflightPassed,
    primaryValue: primary.value,
  });
  if (outcome.runStatus === "valid" && rawSeries === null) {
    fail("v2RunRecord.timing.rawSeries", "a valid run owes a downloadable timing series");
  }

  return {
    arm,
    block: requireCount(source, "block", "v2RunRecord", 1),
    campaignHash: requireHash(source, "campaignHash", "v2RunRecord"),
    campaignId: requireIdentifier(source, "campaignId", "v2RunRecord"),
    checksums,
    comparability,
    ...(comparabilityReason === null ? {} : { comparabilityReason }),
    derivationVersion,
    durationMs,
    experiment,
    fixture: {
      conformance: fixtureConformance,
      evidence: evidence as string | null,
      hash: requireHash(fixtureSource, "hash", "v2RunRecord.fixture"),
    },
    machine: {
      gpu: requireString(machineSource, "gpu", "v2RunRecord.machine"),
      id: requireIdentifier(machineSource, "id", "v2RunRecord.machine"),
      lane: requireEnum(machineSource, "lane", "v2RunRecord.machine", LANE_PROVISIONING),
      os: requireString(machineSource, "os", "v2RunRecord.machine"),
      preflight: { passed: preflightPassed, reason: preflightReason ?? null },
    },
    metrics,
    order: requireCount(source, "order", "v2RunRecord", 0),
    outcome,
    planHash: requireHash(source, "planHash", "v2RunRecord"),
    runId: requireIdentifier(source, "runId", "v2RunRecord"),
    schemaVersion: 2,
    session: requireCount(source, "session", "v2RunRecord", 1),
    sourceHash: requireHash(source, "sourceHash", "v2RunRecord"),
    timing,
  };
}

/**
 * Reads either contract from one entry point, so a mixed bundle is readable without every caller
 * growing a version branch. A record that declares no `schemaVersion` is a v1 report, which is
 * exactly what every report written before v2 is; a record that declares one this build does not
 * implement is an error rather than a guess, because a misread v3 is a silently wrong measurement.
 */
export function readResultRecord(value: unknown): ResultRecord {
  const declared =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>).schemaVersion
      : undefined;
  if (declared === undefined) return { report: parseRunReport(value), schemaVersion: 1 };
  if (declared === 1) return { report: parseRunReport(value), schemaVersion: 1 };
  if (declared === 2) return { record: parseV2RunRecord(value), schemaVersion: 2 };
  throw new BenchError(
    "TN_BENCH_BAD_V2_VERSION",
    `result record declares schemaVersion ${String(declared)}, which this build does not implement`,
  );
}
