// PRD-117 §5.1/§5.2: parse both arms' run reports fail-closed, refuse to compare two scenes that
// were not the same scene, and only then compute a knee. A missing field, a wrong type, or an
// empty sample array is an error here — never a default, never a skip.

export const KNEE_THRESHOLD_MS = 20;
export const ARMS = [
  "tn-web",
  "tn-android",
  "tn-desktop",
  "godot-web",
  "godot-android",
  "godot-desktop",
] as const;

export type Arm = (typeof ARMS)[number];
export type RenderMode = "L1" | "L2" | "L3";
export type BuildType = "release" | "debug";
export type BenchExitCode = 1 | 2;

export const REQUIRED_PLATFORM_LANES = [
  "browser-webgpu",
  "native-linux",
  "native-windows",
  "native-macos",
  "native-android",
  "native-ios",
] as const;

export type RequiredPlatformLane = (typeof REQUIRED_PLATFORM_LANES)[number];

export type PerformanceLaneProvisioning =
  | "hosted-software"
  | "physical-hardware"
  | "simulator"
  | "unprovisioned";

export interface IPerformancePromotionPolicy {
  readonly accuracyRuns: number;
  readonly baselineRegeneration: "separate-reviewed-change";
  readonly calibrationStatus: "accepted" | "unverified";
  readonly calibrationPairs: number;
  readonly ciCostRuns: number;
  readonly maxIncrementalRunnerMinutes: number;
  readonly maxQueueSeconds: number;
  readonly minimumCalibrationSessions: number;
  readonly requiredCheckPromotion: "maintainer-review";
}

export interface IRunReportRung {
  drawCalls: number;
  frameMs: number[];
  mode: RenderMode;
  objectCount: number;
  positionHash: string;
  repeat: number;
  triangles: number;
  visibleObjects: number;
}

export interface IDeviceCondition {
  batteryPercent: number;
  charging: boolean;
  chargingSource: string;
  provisional: string[];
  screenOn: boolean;
  serial: string;
  thermalStatus: string;
  thermalStatusCode: number;
}

export interface IRunReport {
  arm: Arm;
  build: { notes: string; type: BuildType };
  device: { battery: number | null; label: string };
  deviceCondition?: IDeviceCondition;
  display: { height: number; refreshHz: number; vsync: boolean; width: number };
  driver: { adapter: string; renderer: string };
  engine: { name: "threenative" | "godot"; version: string };
  identity?: IPerformanceIdentity;
  provisional?: string[];
  rungs: IRunReportRung[];
}

/** Identity fields that make a timed result comparable to its accepted baseline. */
export interface IPerformanceIdentity {
  readonly architecture?: string;
  readonly artifactHash?: string;
  readonly browser?: string;
  readonly device?: string;
  readonly graphicsBackend?: string;
  readonly gpu?: string;
  readonly instrumentationRevision?: string;
  readonly jsRuntime?: string;
  readonly nativeBinaryHash?: string;
  readonly operatingSystem?: string;
  readonly presentMode?: string;
  readonly resolution?: string;
  readonly sourceSha?: string;
  readonly workloadHash?: string;
}

export interface IRungSummary {
  drawCalls: number;
  mode: RenderMode;
  objectCount: number;
  p50: number;
  p95: number;
  repeats: number;
  sampleCount: number;
  triangles: number;
  visibleObjects: number;
}

export interface IEquivalenceFailure {
  field: string;
  left: string;
  right: string;
  rung: string;
}

export interface IComparison {
  left: IRunReport;
  leftKnee: Record<RenderMode, number | null>;
  leftSummaries: IRungSummary[];
  right: IRunReport;
  rightKnee: Record<RenderMode, number | null>;
  rightSummaries: IRungSummary[];
}

export class BenchError extends Error {
  readonly code: string;
  readonly exitCode: BenchExitCode;

  constructor(code: string, detail: string, exitCode: BenchExitCode = 2) {
    super(`${code}: ${detail}`);
    this.name = code;
    this.code = code;
    this.exitCode = exitCode;
  }
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new BenchError("TN_BENCH_BAD_SHAPE", `${path} must be an object`);
  return value as Record<string, unknown>;
}

function requireString(source: Record<string, unknown>, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0)
    throw new BenchError("TN_BENCH_BAD_SHAPE", `${path}.${key} must be a non-empty string`);
  return value;
}

function requireNumber(source: Record<string, unknown>, key: string, path: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new BenchError("TN_BENCH_BAD_SHAPE", `${path}.${key} must be a finite number`);
  return value;
}

function requireBoolean(source: Record<string, unknown>, key: string, path: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean")
    throw new BenchError("TN_BENCH_BAD_SHAPE", `${path}.${key} must be a boolean`);
  return value;
}

function parseProvisional(value: unknown, path: string, required: boolean): string[] | undefined {
  if (value === undefined && !required) return undefined;
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new BenchError("TN_BENCH_BAD_SHAPE", `${path} must be an array of non-empty strings`);
  }
  return value;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function parseDeviceCondition(
  value: unknown,
  arm: Arm,
  provisional: string[] | undefined,
): IDeviceCondition | undefined {
  const required = arm.endsWith("-android");
  if (value === undefined && !required) return undefined;
  const condition = requireObject(value, "report.deviceCondition");
  if (provisional === undefined) {
    throw new BenchError("TN_BENCH_MISSING_DEVICE_CONDITION", "report.provisional is absent");
  }
  if (required && condition.provisional === undefined) {
    throw new BenchError(
      "TN_BENCH_MISSING_DEVICE_CONDITION",
      "report.deviceCondition.provisional is absent",
    );
  }
  const conditionProvisional = parseProvisional(
    condition.provisional,
    "report.deviceCondition.provisional",
    required,
  );
  if (conditionProvisional !== undefined && !sameStringArray(provisional, conditionProvisional)) {
    throw new BenchError(
      "TN_BENCH_BAD_SHAPE",
      "report.provisional must match report.deviceCondition.provisional",
    );
  }
  return {
    batteryPercent: requireNumber(condition, "batteryPercent", "report.deviceCondition"),
    charging: requireBoolean(condition, "charging", "report.deviceCondition"),
    chargingSource: requireString(condition, "chargingSource", "report.deviceCondition"),
    provisional: conditionProvisional ?? provisional,
    screenOn: requireBoolean(condition, "screenOn", "report.deviceCondition"),
    serial: requireString(condition, "serial", "report.deviceCondition"),
    thermalStatus: requireString(condition, "thermalStatus", "report.deviceCondition"),
    thermalStatusCode: requireNumber(condition, "thermalStatusCode", "report.deviceCondition"),
  };
}

export function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) throw new BenchError("TN_BENCH_EMPTY_SERIES", "no frame samples");
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[rank] as number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new BenchError("TN_BENCH_EMPTY_SERIES", "no values to median");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return (((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2) as number;
}

function parseReportIdentity(value: unknown): IPerformanceIdentity | undefined {
  if (value === undefined) return undefined;
  const source = requireObject(value, "report.identity");
  const fields: readonly (keyof IPerformanceIdentity)[] = [
    "architecture",
    "artifactHash",
    "browser",
    "device",
    "graphicsBackend",
    "gpu",
    "instrumentationRevision",
    "jsRuntime",
    "nativeBinaryHash",
    "operatingSystem",
    "presentMode",
    "resolution",
    "sourceSha",
    "workloadHash",
  ];
  const identity: Partial<Record<keyof IPerformanceIdentity, string>> = {};
  for (const field of fields) {
    const fieldValue = source[field];
    if (fieldValue !== undefined) {
      if (typeof fieldValue !== "string" || fieldValue.length === 0) {
        throw new BenchError(
          "TN_BENCH_BAD_SHAPE",
          `report.identity.${field} must be a non-empty string`,
        );
      }
      identity[field] = fieldValue;
    }
  }
  return identity;
}

export function parseRunReport(value: unknown): IRunReport {
  const root = requireObject(value, "report");
  const arm = requireString(root, "arm", "report");
  if (!(ARMS as readonly string[]).includes(arm))
    throw new BenchError("TN_BENCH_BAD_ARM", `unknown arm ${arm}`);
  const typedArm = arm as Arm;
  const provisional = parseProvisional(
    root.provisional,
    "report.provisional",
    typedArm.endsWith("-android"),
  );
  const deviceCondition = parseDeviceCondition(root.deviceCondition, typedArm, provisional);

  const engine = requireObject(root.engine, "report.engine");
  const engineName = requireString(engine, "name", "report.engine");
  if (engineName !== "threenative" && engineName !== "godot")
    throw new BenchError("TN_BENCH_BAD_SHAPE", `report.engine.name ${engineName} is not an engine`);

  const build = requireObject(root.build, "report.build");
  const buildType = requireString(build, "type", "report.build");
  if (buildType !== "release" && buildType !== "debug")
    throw new BenchError(
      "TN_BENCH_BAD_SHAPE",
      `report.build.type ${buildType} is not a build type`,
    );

  const display = requireObject(root.display, "report.display");
  // A report that cannot name the backend the engine actually chose is not comparable: a web
  // export that silently fell back would otherwise be published as that engine's result (§4.5).
  const driverSource = root.driver;
  if (typeof driverSource !== "object" || driverSource === null)
    throw new BenchError("TN_BENCH_MISSING_DRIVER", "report.driver is absent");
  const driver = requireObject(driverSource, "report.driver");
  let renderer: string;
  let adapter: string;
  try {
    renderer = requireString(driver, "renderer", "report.driver");
    adapter = requireString(driver, "adapter", "report.driver");
  } catch {
    throw new BenchError("TN_BENCH_MISSING_DRIVER", "report.driver is missing renderer or adapter");
  }

  const device = requireObject(root.device, "report.device");
  const battery = device.battery;
  if (battery !== null && (typeof battery !== "number" || !Number.isFinite(battery)))
    throw new BenchError("TN_BENCH_BAD_SHAPE", "report.device.battery must be a number or null");

  const rawRungs = root.rungs;
  if (!Array.isArray(rawRungs) || rawRungs.length === 0)
    throw new BenchError("TN_BENCH_NO_RUNGS", "report.rungs is empty");

  const rungs = rawRungs.map((rawRung, index) => {
    const path = `report.rungs[${index}]`;
    const rung = requireObject(rawRung, path);
    const mode = requireString(rung, "mode", path);
    if (mode !== "L1" && mode !== "L2" && mode !== "L3")
      throw new BenchError("TN_BENCH_BAD_SHAPE", `${path}.mode ${mode} is not a render mode`);
    const frameMs = rung.frameMs;
    if (!Array.isArray(frameMs) || frameMs.length === 0)
      throw new BenchError("TN_BENCH_EMPTY_SERIES", `${path}.frameMs carries no samples`);
    for (const sample of frameMs) {
      if (typeof sample !== "number" || !Number.isFinite(sample) || sample < 0)
        throw new BenchError("TN_BENCH_BAD_SHAPE", `${path}.frameMs holds a non-finite sample`);
    }
    return {
      drawCalls: requireNumber(rung, "drawCalls", path),
      frameMs: frameMs as number[],
      mode: mode as RenderMode,
      objectCount: requireNumber(rung, "objectCount", path),
      positionHash: requireString(rung, "positionHash", path),
      repeat: requireNumber(rung, "repeat", path),
      triangles: requireNumber(rung, "triangles", path),
      visibleObjects: requireNumber(rung, "visibleObjects", path),
    };
  });

  return {
    arm: arm as Arm,
    build: { notes: typeof build.notes === "string" ? build.notes : "", type: buildType },
    device: {
      battery: (battery as number | null) ?? null,
      label: requireString(device, "label", "report.device"),
    },
    display: {
      height: requireNumber(display, "height", "report.display"),
      refreshHz: requireNumber(display, "refreshHz", "report.display"),
      vsync: requireBoolean(display, "vsync", "report.display"),
      width: requireNumber(display, "width", "report.display"),
    },
    driver: { adapter, renderer },
    ...(deviceCondition === undefined ? {} : { deviceCondition }),
    engine: { name: engineName, version: requireString(engine, "version", "report.engine") },
    ...(root.identity === undefined ? {} : { identity: parseReportIdentity(root.identity) }),
    ...(provisional === undefined ? {} : { provisional }),
    rungs,
  };
}

export function rungKey(mode: RenderMode, objectCount: number): string {
  return `${mode}@${objectCount}`;
}

export function summarize(report: IRunReport): IRungSummary[] {
  const groups = new Map<string, IRunReportRung[]>();
  for (const rung of report.rungs) {
    const key = rungKey(rung.mode, rung.objectCount);
    const bucket = groups.get(key) ?? [];
    bucket.push(rung);
    groups.set(key, bucket);
  }
  const summaries: IRungSummary[] = [];
  for (const bucket of groups.values()) {
    const first = bucket[0] as IRunReportRung;
    summaries.push({
      drawCalls: median(bucket.map((rung) => rung.drawCalls)),
      mode: first.mode,
      objectCount: first.objectCount,
      p50: median(bucket.map((rung) => percentile(rung.frameMs, 0.5))),
      p95: median(bucket.map((rung) => percentile(rung.frameMs, 0.95))),
      repeats: bucket.length,
      sampleCount: first.frameMs.length,
      triangles: median(bucket.map((rung) => rung.triangles)),
      visibleObjects: median(bucket.map((rung) => rung.visibleObjects)),
    });
  }
  return summaries.sort((left, right) =>
    left.mode === right.mode
      ? left.objectCount - right.objectCount
      : left.mode.localeCompare(right.mode),
  );
}

// The knee is the last ladder rung before the first crossing of the threshold — not the largest
// rung that happens to sit under it, which a noisy non-monotone curve would misreport.
export function knee(
  summaries: readonly IRungSummary[],
  mode: RenderMode,
  thresholdMs: number = KNEE_THRESHOLD_MS,
): number | null {
  const ladder = summaries
    .filter((summary) => summary.mode === mode)
    .sort((left, right) => left.objectCount - right.objectCount);
  let best: number | null = null;
  for (const summary of ladder) {
    if (summary.p95 > thresholdMs) return best;
    best = summary.objectCount;
  }
  return best;
}

/**
 * The performance a device run is required to keep, per arm.
 *
 * Recorded, not computed: each entry is a number some named device actually produced, and the file
 * that produced it is cited so a reader can check the conditions rather than trust the figure.
 *
 * **Why a baseline at all.** The realistic regression here is not drift, it is a *cliff*: the
 * Android engine default reverting to QuickJS takes the top rung from 8.34 ms to 101.24 ms. That is
 * 12x, and it is invisible without a comparison because the build still succeeds, the APK still
 * installs, and the frames still render. `--expect-engine` catches it when a gate asks; this catches
 * it when a benchmark runs.
 */
export const PERFORMANCE_BASELINES: Readonly<Record<string, IPerformanceBaseline>> = {
  // The emulator canary, keyed separately because it measures something else. Its numbers are 8x the
  // phone's for identical work — swiftshader is a CPU rasteriser, so software rendering dominates the
  // frame and squeezes the engine ratio from 12.1x to 2.4x. Still catchable, which is the point: this
  // is the only Android performance gate that can run without a phone attached.
  //
  // **Never quote these as performance figures.** They are a tripwire, not a measurement.
  "tn-android@emulator": {
    status: "diagnostic",
    evidence: "docs/verification/prd-130-emulator-canary-2026-08-17.md",
    rungs: { "L2@4096": 75.17, "L2@16384": 204.08, "L3@4096": 48.03, "L3@16384": 65.76 },
  },
  "tn-android": {
    status: "diagnostic",
    // docs/verification/prd-130-phase-6-2026-08-16.md — Pixel 8 `37251FDJH0037Z`, V8, vsync on at
    // 120 Hz. Every rung is at the frame interval, so these are ceilings on V8's real cost.
    evidence: "docs/verification/prd-130-phase-6-2026-08-16.md",
    rungs: { "L2@4096": 8.27, "L2@16384": 8.21, "L3@4096": 8.29, "L3@16384": 8.34 },
  },
};

export type PerformanceBaselineStatus = "accepted" | "diagnostic" | "unavailable";

export interface IPerformanceBaselineIdentity extends IPerformanceIdentity {
  readonly device: string;
}

export interface IPerformanceBaseline {
  readonly evidence: string;
  /** p50 milliseconds, keyed `<mode>@<objectCount>`. */
  readonly rungs: Readonly<Record<string, number>>;
  /** Accepted baselines are eligible for required gates; old entries remain diagnostic by default. */
  readonly status?: PerformanceBaselineStatus;
  readonly reason?: string;
  readonly lane?: string;
  readonly workload?: string;
  readonly device?: string;
  readonly identity?: IPerformanceBaselineIdentity;
}

export interface IPerformanceLaneBaseline {
  readonly status: PerformanceBaselineStatus;
  readonly evidence?: string;
  readonly provenance?: string;
  readonly reason?: string;
  readonly rungs?: Readonly<Record<string, number>>;
  readonly identity?: IPerformanceBaselineIdentity;
}

export interface IPerformanceLane {
  readonly id: string;
  readonly platform: RequiredPlatformLane;
  readonly arms: readonly Arm[];
  readonly workload: string;
  readonly requiredMetrics: readonly string[];
  readonly producer: string;
  readonly evidenceClass: string;
  readonly baseline: IPerformanceLaneBaseline;
  readonly deviceResource?: string;
  readonly provisioning?: PerformanceLaneProvisioning;
  readonly required?: boolean;
}

export interface IPerformanceLaneManifest {
  readonly schemaVersion: 1;
  readonly policyRevision: string;
  readonly lanes: readonly IPerformanceLane[];
  readonly promotionPolicy?: IPerformancePromotionPolicy;
}

function parseStringArray(value: unknown, field: string, allowEmpty = false): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new BenchError(
      "TN_BENCH_BAD_LANE_MANIFEST",
      `${field} must be an array of non-empty strings`,
    );
  }
  if (!allowEmpty && value.length === 0) {
    throw new BenchError("TN_BENCH_BAD_LANE_MANIFEST", `${field} must not be empty`);
  }
  return [...value];
}

function optionalString(
  source: Record<string, unknown>,
  key: string,
  field: string,
): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new BenchError(
      "TN_BENCH_BAD_LANE_MANIFEST",
      `${field}.${key} must be a non-empty string`,
    );
  }
  return value;
}

function optionalBoolean(
  source: Record<string, unknown>,
  key: string,
  field: string,
): boolean | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new BenchError("TN_BENCH_BAD_LANE_MANIFEST", `${field}.${key} must be boolean`);
  }
  return value;
}

function optionalProvisioning(
  source: Record<string, unknown>,
  field: string,
): PerformanceLaneProvisioning | undefined {
  const value = optionalString(source, "provisioning", field);
  if (value === undefined) return undefined;
  if (
    value !== "hosted-software" &&
    value !== "physical-hardware" &&
    value !== "simulator" &&
    value !== "unprovisioned"
  ) {
    throw new BenchError("TN_BENCH_BAD_LANE_MANIFEST", `${field}.provisioning is unknown`);
  }
  return value;
}

function positiveInteger(source: Record<string, unknown>, key: string, field: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BenchError(
      "TN_BENCH_BAD_LANE_MANIFEST",
      `${field}.${key} must be a positive integer`,
    );
  }
  return value;
}

function nonNegativeNumber(source: Record<string, unknown>, key: string, field: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new BenchError(
      "TN_BENCH_BAD_LANE_MANIFEST",
      `${field}.${key} must be a finite non-negative number`,
    );
  }
  return value;
}

function parsePromotionPolicy(value: unknown): IPerformancePromotionPolicy | undefined {
  if (value === undefined) return undefined;
  const field = "lane manifest.promotionPolicy";
  const source = requireObject(value, field);
  const requiredCheckPromotion = requireString(source, "requiredCheckPromotion", field);
  const baselineRegeneration = requireString(source, "baselineRegeneration", field);
  const calibrationStatus = requireString(source, "calibrationStatus", field);
  if (requiredCheckPromotion !== "maintainer-review") {
    throw new BenchError(
      "TN_BENCH_BAD_LANE_MANIFEST",
      `${field}.requiredCheckPromotion must be maintainer-review`,
    );
  }
  if (baselineRegeneration !== "separate-reviewed-change") {
    throw new BenchError(
      "TN_BENCH_BAD_LANE_MANIFEST",
      `${field}.baselineRegeneration must be separate-reviewed-change`,
    );
  }
  if (calibrationStatus !== "accepted" && calibrationStatus !== "unverified") {
    throw new BenchError(
      "TN_BENCH_BAD_LANE_MANIFEST",
      `${field}.calibrationStatus must be accepted or unverified`,
    );
  }
  const requiredCounts = {
    accuracyRuns: 20,
    calibrationPairs: 10,
    ciCostRuns: 20,
    maxIncrementalRunnerMinutes: 6,
    maxQueueSeconds: 120,
    minimumCalibrationSessions: 3,
  } as const;
  for (const [key, expected] of Object.entries(requiredCounts)) {
    if (source[key] !== expected) {
      throw new BenchError(
        "TN_BENCH_BAD_LANE_MANIFEST",
        `${field}.${key} must remain ${expected} until measured promotion evidence is reviewed`,
      );
    }
  }
  return {
    accuracyRuns: positiveInteger(source, "accuracyRuns", field),
    baselineRegeneration,
    calibrationStatus,
    calibrationPairs: positiveInteger(source, "calibrationPairs", field),
    ciCostRuns: positiveInteger(source, "ciCostRuns", field),
    maxIncrementalRunnerMinutes: nonNegativeNumber(source, "maxIncrementalRunnerMinutes", field),
    maxQueueSeconds: nonNegativeNumber(source, "maxQueueSeconds", field),
    minimumCalibrationSessions: positiveInteger(source, "minimumCalibrationSessions", field),
    requiredCheckPromotion,
  };
}

function parseIdentity(
  value: unknown,
  field: string,
  required: boolean,
): IPerformanceBaselineIdentity | undefined {
  if (value === undefined) {
    if (required)
      throw new BenchError(
        "TN_BENCH_BAD_LANE_MANIFEST",
        `${field} is required for an accepted baseline`,
      );
    return undefined;
  }
  const source = requireObject(value, field);
  const device = optionalString(source, "device", field);
  if (required && device === undefined) {
    throw new BenchError(
      "TN_BENCH_BAD_LANE_MANIFEST",
      `${field}.device is required for an accepted baseline`,
    );
  }
  const identity = {
    architecture: optionalString(source, "architecture", field),
    artifactHash: optionalString(source, "artifactHash", field),
    browser: optionalString(source, "browser", field),
    device: device ?? "",
    graphicsBackend: optionalString(source, "graphicsBackend", field),
    gpu: optionalString(source, "gpu", field),
    instrumentationRevision: optionalString(source, "instrumentationRevision", field),
    jsRuntime: optionalString(source, "jsRuntime", field),
    nativeBinaryHash: optionalString(source, "nativeBinaryHash", field),
    operatingSystem: optionalString(source, "operatingSystem", field),
    presentMode: optionalString(source, "presentMode", field),
    resolution: optionalString(source, "resolution", field),
    sourceSha: optionalString(source, "sourceSha", field),
    workloadHash: optionalString(source, "workloadHash", field),
  };
  if (required) {
    const missing = [
      "architecture",
      "artifactHash",
      "browser",
      "graphicsBackend",
      "gpu",
      "instrumentationRevision",
      "jsRuntime",
      "nativeBinaryHash",
      "operatingSystem",
      "presentMode",
      "resolution",
      "sourceSha",
      "workloadHash",
    ].filter((key) => identity[key as keyof typeof identity] === undefined);
    if (missing.length > 0) {
      throw new BenchError(
        "TN_BENCH_BAD_LANE_MANIFEST",
        `${field} is missing identity fields: ${missing.join(", ")}`,
      );
    }
  }
  return identity as IPerformanceBaselineIdentity;
}

function parseLaneBaseline(value: unknown, field: string): IPerformanceLaneBaseline {
  const source = requireObject(value, field);
  const status = optionalString(source, "status", field);
  if (status !== "accepted" && status !== "diagnostic" && status !== "unavailable") {
    throw new BenchError(
      "TN_BENCH_BAD_LANE_MANIFEST",
      `${field}.status must be accepted, diagnostic, or unavailable`,
    );
  }
  const reason = optionalString(source, "reason", field);
  const evidence = optionalString(source, "evidence", field);
  const provenance = optionalString(source, "provenance", field);
  const rawRungs = source.rungs;
  let rungs: Record<string, number> | undefined;
  if (rawRungs !== undefined) {
    const parsed = requireObject(rawRungs, `${field}.rungs`);
    rungs = {};
    for (const [rung, valueForRung] of Object.entries(parsed)) {
      if (
        rung.length === 0 ||
        typeof valueForRung !== "number" ||
        !Number.isFinite(valueForRung) ||
        valueForRung <= 0
      ) {
        throw new BenchError(
          "TN_BENCH_BAD_LANE_MANIFEST",
          `${field}.rungs must contain finite positive numbers keyed by rung`,
        );
      }
      rungs[rung] = valueForRung;
    }
  }
  if (status === "unavailable") {
    if (reason === undefined) {
      throw new BenchError(
        "TN_BENCH_BAD_LANE_MANIFEST",
        `${field}.reason is required when unavailable`,
      );
    }
    if (rungs !== undefined || evidence !== undefined || provenance !== undefined) {
      throw new BenchError(
        "TN_BENCH_BAD_LANE_MANIFEST",
        `${field} unavailable baselines cannot carry accepted evidence or rung values`,
      );
    }
    return { reason, status };
  }
  const evidencePath = evidence ?? provenance;
  if (evidencePath === undefined) {
    throw new BenchError(
      "TN_BENCH_BAD_LANE_MANIFEST",
      `${field} must name evidence or provenance when status is ${status}`,
    );
  }
  if (rungs === undefined || Object.keys(rungs).length === 0) {
    throw new BenchError("TN_BENCH_BAD_LANE_MANIFEST", `${field}.rungs must not be empty`);
  }
  const identity = parseIdentity(source.identity, `${field}.identity`, status === "accepted");
  return {
    evidence: evidencePath,
    ...(provenance === undefined ? {} : { provenance }),
    ...(reason === undefined ? {} : { reason }),
    rungs,
    ...(identity === undefined ? {} : { identity }),
    status,
  };
}

/** Parse the checked-in lane contract; missing observations are data, not an implicit pass. */
export function parsePerformanceLaneManifest(value: unknown): IPerformanceLaneManifest {
  const root = requireObject(value, "lane manifest");
  if (root.schemaVersion !== 1) {
    throw new BenchError("TN_BENCH_BAD_LANE_MANIFEST", "schemaVersion must be 1");
  }
  const policyRevision = requireString(root, "policyRevision", "lane manifest");
  const rawLanes = root.lanes;
  if (!Array.isArray(rawLanes) || rawLanes.length === 0) {
    throw new BenchError("TN_BENCH_BAD_LANE_MANIFEST", "lanes must not be empty");
  }
  const seenIds = new Set<string>();
  const seenPlatforms = new Set<string>();
  const seenWorkloads = new Set<string>();
  const lanes = rawLanes.map((valueForLane, index) => {
    const field = `lane manifest.lanes[${index}]`;
    const source = requireObject(valueForLane, field);
    const id = requireString(source, "id", field);
    const platform = requireString(source, "platform", field);
    if (!(REQUIRED_PLATFORM_LANES as readonly string[]).includes(platform)) {
      throw new BenchError(
        "TN_BENCH_BAD_LANE_MANIFEST",
        `${field}.platform ${platform} is unknown`,
      );
    }
    const workloadKey = `${platform}:${requireString(source, "workload", field)}`;
    if (seenIds.has(id) || seenWorkloads.has(workloadKey)) {
      throw new BenchError("TN_BENCH_BAD_LANE_MANIFEST", `${field} duplicates lane id or platform`);
    }
    seenIds.add(id);
    seenWorkloads.add(workloadKey);
    seenPlatforms.add(platform);
    const arms = parseStringArray(source.arms, `${field}.arms`, true).map((arm) => {
      if (!(ARMS as readonly string[]).includes(arm)) {
        throw new BenchError(
          "TN_BENCH_BAD_LANE_MANIFEST",
          `${field}.arms contains unknown arm ${arm}`,
        );
      }
      return arm as Arm;
    });
    const deviceResource = optionalString(source, "deviceResource", field);
    const provisioning = optionalProvisioning(source, field);
    const required = optionalBoolean(source, "required", field);
    return {
      arms,
      baseline: parseLaneBaseline(source.baseline, `${field}.baseline`),
      ...(deviceResource === undefined ? {} : { deviceResource }),
      evidenceClass: requireString(source, "evidenceClass", field),
      id,
      platform: platform as RequiredPlatformLane,
      producer: requireString(source, "producer", field),
      ...(provisioning === undefined ? {} : { provisioning }),
      requiredMetrics: parseStringArray(source.requiredMetrics, `${field}.requiredMetrics`),
      ...(required === undefined ? {} : { required }),
      workload: requireString(source, "workload", field),
    };
  });
  const missingPlatforms = REQUIRED_PLATFORM_LANES.filter(
    (platform) => !seenPlatforms.has(platform),
  );
  if (missingPlatforms.length > 0) {
    throw new BenchError(
      "TN_BENCH_BAD_LANE_MANIFEST",
      `missing required platform lanes: ${missingPlatforms.join(", ")}`,
    );
  }
  const promotionPolicy = parsePromotionPolicy(root.promotionPolicy);
  if (
    promotionPolicy?.calibrationStatus !== "accepted" &&
    lanes.some((lane) => lane.required === true)
  ) {
    throw new BenchError(
      "TN_BENCH_BAD_LANE_MANIFEST",
      "required performance lanes need accepted calibration evidence before promotion",
    );
  }
  const unapprovedRequiredLanes = lanes.filter(
    (lane) => lane.required === true && lane.baseline.status !== "accepted",
  );
  if (unapprovedRequiredLanes.length > 0) {
    throw new BenchError(
      "TN_BENCH_BAD_LANE_MANIFEST",
      `required performance lanes need accepted baselines: ${unapprovedRequiredLanes.map((lane) => lane.id).join(", ")}`,
    );
  }
  return {
    lanes,
    policyRevision,
    ...(promotionPolicy === undefined ? {} : { promotionPolicy }),
    schemaVersion: 1,
  };
}

export function laneForArm(
  manifest: IPerformanceLaneManifest,
  arm: Arm,
): IPerformanceLane | undefined {
  const matches = manifest.lanes.filter((lane) => lane.arms.includes(arm));
  if (matches.length > 1) {
    throw new BenchError(
      "TN_BENCH_AMBIGUOUS_LANE",
      `${arm} is assigned to multiple lanes: ${matches.map((lane) => lane.id).join(", ")}`,
    );
  }
  return matches[0];
}

export function laneForId(
  manifest: IPerformanceLaneManifest,
  id: string,
): IPerformanceLane | undefined {
  return manifest.lanes.find((lane) => lane.id === id);
}

export function baselineForLane(lane: IPerformanceLane): IPerformanceBaseline | undefined {
  if (lane.baseline.status !== "accepted") return undefined;
  const evidence = lane.baseline.evidence ?? lane.baseline.provenance;
  const rungs = lane.baseline.rungs;
  if (evidence === undefined || rungs === undefined || lane.baseline.identity === undefined) {
    throw new BenchError(
      "TN_BENCH_BAD_LANE_MANIFEST",
      `${lane.id} accepted baseline is missing evidence, rungs, or identity`,
    );
  }
  return {
    evidence,
    identity: lane.baseline.identity,
    lane: lane.id,
    rungs,
    status: lane.baseline.status,
    workload: lane.workload,
  };
}

/**
 * How much slower than its baseline a rung may read before it is a regression.
 *
 * Deliberately loose. Device frame timings swing with thermal state and machine load, and a tight
 * bound turns this into a false-alarm generator that people learn to ignore — which is worse than no
 * gate. It is set to catch the cliff described above, not to police a few per cent: at 0.25 a 12x
 * engine revert trips it forty-odd times over, while an ordinary noisy afternoon does not.
 */
export const PERFORMANCE_REGRESSION_TOLERANCE = 0.25;

export interface IPerformanceRegression {
  readonly allowedMs: number;
  readonly baselineMs: number;
  readonly measuredMs: number;
  readonly rung: string;
}

export interface IPerformanceCheck {
  readonly arm: Arm;
  readonly checked: readonly string[];
  readonly evidence: string;
  readonly regressions: readonly IPerformanceRegression[];
  readonly tolerance: number;
}

export interface IPerformanceCheckOptions {
  /** Required lanes fail with exit-code 2 when no accepted baseline is available. */
  readonly required?: boolean;
  /** Manifest lane identity expected by the caller. */
  readonly laneId?: string;
}

function reportDeviceIdentity(report: IRunReport): string {
  return report.deviceCondition?.serial ?? report.identity?.device ?? report.device.label;
}

function validateBaseline(
  report: IRunReport,
  baseline: IPerformanceBaseline,
  options: IPerformanceCheckOptions,
): void {
  if (options.required && (baseline.status === "diagnostic" || baseline.status === "unavailable")) {
    throw new BenchError(
      "TN_BENCH_BASELINE_MISSING",
      `${report.arm} has no accepted baseline${baseline.reason === undefined ? "" : `: ${baseline.reason}`}`,
    );
  }
  if (
    typeof baseline.evidence !== "string" ||
    baseline.evidence.length === 0 ||
    /TBD|UNVERIFIED|missing/i.test(baseline.evidence)
  ) {
    throw new BenchError(
      "TN_BENCH_BASELINE_EVIDENCE_MISSING",
      `${report.arm} baseline evidence is empty or not an accepted record: ${String(baseline.evidence)}`,
    );
  }
  if (
    typeof baseline.rungs !== "object" ||
    baseline.rungs === null ||
    Array.isArray(baseline.rungs)
  ) {
    throw new BenchError(
      "TN_BENCH_BASELINE_EMPTY",
      `${report.arm} baseline evidence has no rung map; an empty baseline cannot pass`,
    );
  }
  const rungEntries = Object.entries(baseline.rungs);
  if (rungEntries.length === 0) {
    throw new BenchError(
      "TN_BENCH_BASELINE_EMPTY",
      `${report.arm} baseline evidence names no rungs; an empty baseline cannot pass`,
    );
  }
  for (const [rung, value] of rungEntries) {
    if (!/^L[123]@[1-9][0-9]*$/u.test(rung) || !Number.isFinite(value) || value <= 0) {
      throw new BenchError(
        "TN_BENCH_BASELINE_BAD_RUNG",
        `${report.arm} baseline rung ${rung} must carry a finite positive timing`,
      );
    }
  }
  if (
    options.laneId !== undefined &&
    baseline.lane !== undefined &&
    baseline.lane !== options.laneId
  ) {
    throw new BenchError(
      "TN_BENCH_BASELINE_IDENTITY_MISMATCH",
      `${report.arm} baseline belongs to lane ${baseline.lane}, requested ${options.laneId}`,
    );
  }
  const identity = baseline.identity;
  const expectedDevice = baseline.device ?? identity?.device;
  if (expectedDevice !== undefined && expectedDevice !== reportDeviceIdentity(report)) {
    throw new BenchError(
      "TN_BENCH_BASELINE_IDENTITY_MISMATCH",
      `${report.arm} baseline device ${expectedDevice} does not match run device ${reportDeviceIdentity(report)}`,
    );
  }
  if (identity === undefined) return;
  const reportIdentity = report.identity;
  if (reportIdentity === undefined) {
    if (options.required) {
      throw new BenchError(
        "TN_BENCH_BASELINE_IDENTITY_MISSING",
        `${report.arm} required run has no source/artifact identity to compare with its baseline`,
      );
    }
    return;
  }
  if (options.required) {
    const missingProvenance = ["sourceSha", "artifactHash", "nativeBinaryHash"].filter((field) => {
      const value = reportIdentity[field as keyof IPerformanceIdentity];
      return typeof value !== "string" || value.length === 0;
    });
    if (missingProvenance.length > 0) {
      throw new BenchError(
        "TN_BENCH_BASELINE_IDENTITY_MISSING",
        `${report.arm} required run is missing provenance fields: ${missingProvenance.join(", ")}`,
      );
    }
  }
  const identityFields: readonly (keyof IPerformanceIdentity)[] = [
    "architecture",
    "browser",
    "graphicsBackend",
    "gpu",
    "instrumentationRevision",
    "jsRuntime",
    "operatingSystem",
    "presentMode",
    "resolution",
    "workloadHash",
  ];
  for (const field of identityFields) {
    const baselineValue = identity[field];
    const reportValue = reportIdentity[field];
    if (baselineValue !== undefined && reportValue !== baselineValue) {
      throw new BenchError(
        "TN_BENCH_BASELINE_IDENTITY_MISMATCH",
        `${report.arm} baseline ${field} ${baselineValue} does not match run ${reportValue ?? "missing"}`,
      );
    }
  }
}

/**
 * Compares a run against its arm's recorded baseline. Fails closed in every direction.
 *
 * A rung the baseline names and the report does not is a **failure**, never a skip: a benchmark that
 * silently stops measuring the top rung is exactly how a regression hides, and it is the same defect
 * class as v1's harness reporting pass on a scenario that asserted nothing. A provisional report is
 * refused for the same reason `compare` refuses one — a number taken outside its declared conditions
 * cannot clear a bar.
 */
export function checkPerformance(
  report: IRunReport,
  baselines: Readonly<Record<string, IPerformanceBaseline>> = PERFORMANCE_BASELINES,
  tolerance: number = PERFORMANCE_REGRESSION_TOLERANCE,
  options: IPerformanceCheckOptions = {},
): IPerformanceCheck | undefined {
  // An emulator run is compared against the emulator baseline, never the phone's: the same arm on
  // software rendering is 8x slower for identical work, so crossing them would report a regression on
  // every emulator run and a pass on nothing.
  const serial = report.deviceCondition?.serial ?? "";
  const key = /^emulator-/u.test(serial) ? `${report.arm}@emulator` : report.arm;
  const baseline = baselines[key];
  if (baseline === undefined) {
    if (options.required) {
      throw new BenchError(
        "TN_BENCH_BASELINE_MISSING",
        `${report.arm} has no accepted baseline for requested lane${options.laneId === undefined ? "" : ` ${options.laneId}`}`,
      );
    }
    return undefined;
  }
  validateBaseline(report, baseline, options);
  if (report.provisional !== undefined && report.provisional.length > 0) {
    throw new BenchError(
      "TN_BENCH_PROVISIONAL_BASELINE",
      `${report.arm} report is provisional (${report.provisional.join(", ")}); a provisional number cannot clear a performance baseline.`,
    );
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new BenchError(
      "TN_BENCH_BAD_TOLERANCE",
      `tolerance must be a non-negative number, received ${String(tolerance)}.`,
    );
  }

  const measured = new Map(
    summarize(report).map((entry) => [rungKey(entry.mode, entry.objectCount), entry.p50]),
  );
  const regressions: IPerformanceRegression[] = [];
  const checked: string[] = [];
  for (const [rung, baselineMs] of Object.entries(baseline.rungs)) {
    const measuredMs = measured.get(rung);
    if (measuredMs === undefined) {
      throw new BenchError(
        "TN_BENCH_BASELINE_RUNG_MISSING",
        `${report.arm} baseline names ${rung} and the run did not measure it. A run that stops measuring a rung cannot clear its baseline.`,
      );
    }
    checked.push(rung);
    const allowedMs = baselineMs * (1 + tolerance);
    if (measuredMs > allowedMs) regressions.push({ allowedMs, baselineMs, measuredMs, rung });
  }
  return { arm: key as Arm, checked, evidence: baseline.evidence, regressions, tolerance };
}

export function renderPerformanceCheck(check: IPerformanceCheck): string {
  const head = `**Performance baseline** — ${check.arm}, tolerance +${Math.round(check.tolerance * 100)}%, from \`${check.evidence}\`.`;
  if (check.regressions.length === 0) {
    return `${head} ${check.checked.length} rung(s) within budget.`;
  }
  return [
    head,
    "",
    "| Rung | Baseline p50 | Measured p50 | Allowed |",
    "| --- | ---: | ---: | ---: |",
    ...check.regressions.map(
      (row) =>
        `| ${row.rung} | ${row.baselineMs.toFixed(2)} ms | **${row.measuredMs.toFixed(2)} ms** | ${row.allowedMs.toFixed(2)} ms |`,
    ),
  ].join("\n");
}

function drawCallFailure(
  mode: RenderMode,
  objectCount: number,
  left: IRungSummary,
  right: IRungSummary,
): IEquivalenceFailure | undefined {
  if (mode === "L1") {
    // An arm reporting one draw where the other reports N has silently auto-batched and is not
    // running L1 at all — the single most likely way this comparison gets published wrong (§5.2).
    for (const [side, summary] of [
      ["left", left],
      ["right", right],
    ] as const) {
      const expected = Math.max(0, summary.visibleObjects);
      if (Math.abs(summary.drawCalls - expected) > 2 && summary.drawCalls < objectCount * 0.5) {
        return {
          field: `drawCalls (${side} arm auto-batched L1)`,
          left: String(left.drawCalls),
          right: String(right.drawCalls),
          rung: rungKey(mode, objectCount),
        };
      }
    }
    const ratio =
      Math.max(left.drawCalls, right.drawCalls) /
      Math.max(1, Math.min(left.drawCalls, right.drawCalls));
    if (ratio > 1.25) {
      return {
        field: "drawCalls",
        left: String(left.drawCalls),
        right: String(right.drawCalls),
        rung: rungKey(mode, objectCount),
      };
    }
    return undefined;
  }
  if (left.drawCalls > 8 || right.drawCalls > 8 || Math.abs(left.drawCalls - right.drawCalls) > 4) {
    return {
      field: "drawCalls (L2 must be a small, comparable batch)",
      left: String(left.drawCalls),
      right: String(right.drawCalls),
      rung: rungKey(mode, objectCount),
    };
  }
  return undefined;
}

function groupRungs(report: IRunReport): Map<string, IRunReportRung[]> {
  const groups = new Map<string, IRunReportRung[]>();
  for (const rung of report.rungs) {
    const key = rungKey(rung.mode, rung.objectCount);
    const bucket = groups.get(key) ?? [];
    bucket.push(rung);
    groups.set(key, bucket);
  }
  return groups;
}

// A frame interval that barely moves while the object count grows 16x is the display pacing the
// arm, not the engine costing anything. Godot's Android export ignores VSYNC_DISABLED and reported
// ~19 ms at every rung of a 16x ladder; the requested `display.vsync` said false and the gate let
// it through, so the flatness is detected from the samples instead of taken on trust.
export function looksVsyncPinned(summaries: readonly IRungSummary[], mode: RenderMode): boolean {
  const ladder = summaries
    .filter((summary) => summary.mode === mode)
    .sort((left, right) => left.objectCount - right.objectCount);
  if (ladder.length < 3) return false;
  const first = ladder[0] as IRungSummary;
  const last = ladder[ladder.length - 1] as IRungSummary;
  const objectGrowth = last.objectCount / Math.max(1, first.objectCount);
  if (objectGrowth < 4) return false;
  const costGrowth = last.p95 / Math.max(0.001, first.p95);
  return costGrowth < 1.25;
}

export function isSoftwareRasteriser(adapter: string): boolean {
  return /swiftshader|llvmpipe|softwarerasterizer|software adapter/i.test(adapter);
}

export function checkEquivalence(left: IRunReport, right: IRunReport): IEquivalenceFailure[] {
  const failures: IEquivalenceFailure[] = [];
  const push = (field: string, a: unknown, b: unknown, rung = "-"): void => {
    failures.push({ field, left: String(a), right: String(b), rung });
  };

  if (left.build.type !== right.build.type) push("build.type", left.build.type, right.build.type);
  // A hardware arm against a software-rasterised one is the same class of mistake as release
  // against debug: both would publish a ratio that is about the fallback, not about the engine.
  if (isSoftwareRasteriser(left.driver.adapter) !== isSoftwareRasteriser(right.driver.adapter))
    push(
      "driver.adapter (software rasteriser on one arm only)",
      left.driver.adapter,
      right.driver.adapter,
    );
  if (left.display.refreshHz !== right.display.refreshHz)
    push("display.refreshHz", left.display.refreshHz, right.display.refreshHz);
  if (left.display.vsync !== right.display.vsync)
    push("display.vsync", left.display.vsync, right.display.vsync);
  if (left.display.width !== right.display.width || left.display.height !== right.display.height) {
    push(
      "display.viewport",
      `${left.display.width}x${left.display.height}`,
      `${right.display.width}x${right.display.height}`,
    );
  }

  // Grouped, never last-wins: a hash that diverges on a single repeat is exactly the failure this
  // gate exists to catch, and keying one rung per ladder step would hide every repeat but the last.
  const leftHashes = groupRungs(left);
  const rightHashes = groupRungs(right);
  for (const key of leftHashes.keys()) {
    if (!rightHashes.has(key)) push("rung present on one arm only", key, "absent", key);
  }
  for (const key of rightHashes.keys()) {
    if (!leftHashes.has(key)) push("rung present on one arm only", "absent", key, key);
  }

  const leftSummaries = summarize(left);
  const rightSummaries = summarize(right);
  for (const mode of ["L1", "L2", "L3"] as const) {
    const leftPinned = looksVsyncPinned(leftSummaries, mode);
    const rightPinned = looksVsyncPinned(rightSummaries, mode);
    if (leftPinned !== rightPinned) {
      push(
        `${mode} frame interval is display-pinned on one arm only`,
        leftPinned ? "pinned" : "load-following",
        rightPinned ? "pinned" : "load-following",
        mode,
      );
    }
  }
  for (const leftSummary of leftSummaries) {
    const key = rungKey(leftSummary.mode, leftSummary.objectCount);
    const rightSummary = rightSummaries.find(
      (summary) => rungKey(summary.mode, summary.objectCount) === key,
    );
    if (rightSummary === undefined) continue;

    const leftRungs = leftHashes.get(key) ?? [];
    const rightRungs = rightHashes.get(key) ?? [];
    const leftHashSet = new Set(leftRungs.map((entry) => entry.positionHash));
    const rightHashSet = new Set(rightRungs.map((entry) => entry.positionHash));
    // Every repeat of every rung must hash the same scene, within an arm and across the two.
    if (leftHashSet.size > 1 || rightHashSet.size > 1) {
      push(
        "positionHash (repeats disagree within an arm)",
        [...leftHashSet],
        [...rightHashSet],
        key,
      );
    } else if ([...leftHashSet][0] !== [...rightHashSet][0]) {
      push("positionHash", [...leftHashSet][0], [...rightHashSet][0], key);
    }
    if (leftSummary.sampleCount !== rightSummary.sampleCount)
      push("sampleCount", leftSummary.sampleCount, rightSummary.sampleCount, key);
    if (leftSummary.repeats !== rightSummary.repeats)
      push("repeats", leftSummary.repeats, rightSummary.repeats, key);

    const drawFailure = drawCallFailure(
      leftSummary.mode,
      leftSummary.objectCount,
      leftSummary,
      rightSummary,
    );
    if (drawFailure !== undefined) failures.push(drawFailure);

    const maxTriangles = Math.max(leftSummary.triangles, rightSummary.triangles);
    if (maxTriangles > 0) {
      const delta = Math.abs(leftSummary.triangles - rightSummary.triangles) / maxTriangles;
      if (delta > 0.05)
        push("triangles (>5% apart)", leftSummary.triangles, rightSummary.triangles, key);
    }
  }
  return failures;
}

export function compare(left: IRunReport, right: IRunReport): IComparison {
  for (const [label, report] of [
    ["left", left],
    ["right", right],
  ] as const) {
    if (report.arm.endsWith("-android")) {
      const nestedProvisional = report.deviceCondition?.provisional;
      if (
        !Array.isArray(report.provisional) ||
        report.provisional.some((entry) => typeof entry !== "string" || entry.length === 0) ||
        !Array.isArray(nestedProvisional) ||
        nestedProvisional.some((entry) => typeof entry !== "string" || entry.length === 0)
      ) {
        throw new BenchError(
          "TN_BENCH_BAD_SHAPE",
          `${label} Android report must carry both provisional arrays`,
        );
      }
      if (!sameStringArray(report.provisional, nestedProvisional)) {
        throw new BenchError(
          "TN_BENCH_BAD_SHAPE",
          `${label} Android report provisional arrays disagree`,
        );
      }
    }
    if (report.provisional !== undefined && report.provisional.length > 0) {
      throw new BenchError(
        "TN_BENCH_PROVISIONAL_COMPARISON",
        `${label} report is provisional: ${report.provisional.join(", ")}`,
      );
    }
  }
  const failures = checkEquivalence(left, right);
  if (failures.length > 0) {
    const detail = failures
      .map(
        (failure) =>
          `${failure.rung} ${failure.field}: ${left.arm}=${failure.left} ${right.arm}=${failure.right}`,
      )
      .join("; ");
    throw new BenchError("TN_BENCH_NOT_EQUIVALENT", detail);
  }
  const leftSummaries = summarize(left);
  const rightSummaries = summarize(right);
  return {
    left,
    leftKnee: {
      L1: knee(leftSummaries, "L1"),
      L2: knee(leftSummaries, "L2"),
      L3: knee(leftSummaries, "L3"),
    },
    leftSummaries,
    right,
    rightKnee: {
      L1: knee(rightSummaries, "L1"),
      L2: knee(rightSummaries, "L2"),
      L3: knee(rightSummaries, "L3"),
    },
    rightSummaries,
  };
}

export function renderArmMarkdown(report: IRunReport): string {
  const summaries = summarize(report);
  const lines = [
    `### Arm \`${report.arm}\``,
    "",
    `- engine: ${report.engine.name} ${report.engine.version}`,
    `- build: ${report.build.type}${report.build.notes.length > 0 ? ` — ${report.build.notes}` : ""}`,
    `- driver: ${report.driver.renderer}`,
    `- adapter: ${report.driver.adapter}`,
    `- device: ${report.device.label}, ${report.display.width}×${report.display.height} @ ${report.display.refreshHz} Hz, vsync ${report.display.vsync ? "on" : "off"}`,
    "",
    "| mode | N | p50 ms | p95 ms | draws | tris | visible | repeats × samples |",
    "|---|---|---|---|---|---|---|---|",
  ];
  if (report.deviceCondition !== undefined) {
    lines.splice(
      6,
      0,
      `- device condition: battery ${report.deviceCondition.batteryPercent}%, ${report.deviceCondition.charging ? "charging" : "discharging"}, thermal ${report.deviceCondition.thermalStatus}, screen ${report.deviceCondition.screenOn ? "on" : "off"}`,
    );
  }
  if (report.provisional !== undefined && report.provisional.length > 0) {
    lines.splice(7, 0, `- provisional: ${report.provisional.join(", ")}`);
  }
  for (const summary of summaries) {
    lines.push(
      `| ${summary.mode} | ${summary.objectCount} | ${summary.p50.toFixed(2)} | ${summary.p95.toFixed(2)} | ${summary.drawCalls} | ${summary.triangles} | ${summary.visibleObjects} | ${summary.repeats} × ${summary.sampleCount} |`,
    );
  }
  lines.push(
    "",
    `**Knee at ≤ ${KNEE_THRESHOLD_MS} ms p95** — L1: ${formatKnee(knee(summaries, "L1"))}, L2: ${formatKnee(knee(summaries, "L2"))}, L3: ${formatKnee(knee(summaries, "L3"))}`,
  );
  return lines.join("\n");
}

export function formatKnee(value: number | null): string {
  return value === null ? "below the first rung" : String(value);
}

export function renderComparisonMarkdown(comparison: IComparison): string {
  const lines = [
    `## ${comparison.left.arm} vs ${comparison.right.arm}`,
    "",
    "Product-to-product. Each arm is what that engine actually ships to this surface; the two run",
    "different rendering backends by construction and no line below is a graphics-API claim.",
    "",
    `| mode | knee — ${comparison.left.arm} | knee — ${comparison.right.arm} |`,
    "|---|---|---|",
  ];
  for (const mode of ["L1", "L2", "L3"] as const) {
    lines.push(
      `| ${mode} | ${formatKnee(comparison.leftKnee[mode])} | ${formatKnee(comparison.rightKnee[mode])} |`,
    );
  }
  lines.push(
    "",
    `| mode | N | ${comparison.left.arm} p95 ms | ${comparison.right.arm} p95 ms | ratio |`,
    "|---|---|---|---|---|",
  );
  for (const leftSummary of comparison.leftSummaries) {
    const rightSummary = comparison.rightSummaries.find(
      (summary) =>
        summary.mode === leftSummary.mode && summary.objectCount === leftSummary.objectCount,
    );
    if (rightSummary === undefined) continue;
    const ratio = leftSummary.p95 / rightSummary.p95;
    lines.push(
      `| ${leftSummary.mode} | ${leftSummary.objectCount} | ${leftSummary.p95.toFixed(2)} | ${rightSummary.p95.toFixed(2)} | ${ratio.toFixed(2)}× |`,
    );
  }
  lines.push("", renderArmMarkdown(comparison.left), "", renderArmMarkdown(comparison.right));
  return lines.join("\n");
}
