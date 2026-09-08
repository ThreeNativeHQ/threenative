import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  type IPerformanceLane,
  type IPerformanceLaneManifest,
  parsePerformanceLaneManifest,
  parseRunReport,
  percentile,
  summarize,
} from "../engine-load-test/report.js";
import {
  DEFAULT_PERFORMANCE_POLICY,
  type IPerformancePair,
  type IPerformanceRun,
  type PairOrder,
  evaluatePairedComparison,
  parsePerformanceRun,
  renderRegressionMarkdown,
} from "./compare.js";

const execFileAsync = promisify(execFile);
const REQUIRED_ORDERS: readonly PairOrder[] = [
  "baseline-first",
  "candidate-first",
  "baseline-first",
];
const PHYSICAL_PROVENANCE = "physical-hardware";
export const PERFORMANCE_QUICK_SUITE_BUDGET_MS = 15 * 60_000;

export function collectorTimeoutMs(
  deadline = Date.now() + PERFORMANCE_QUICK_SUITE_BUDGET_MS,
  now = Date.now(),
): number {
  const remainingMs = deadline - now;
  if (remainingMs <= 0)
    throw new PerformanceLaneRunError("hardware quick-suite exceeded its 15-minute budget");
  return remainingMs;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type HardwareRunStatus = "PASS" | "FAIL" | "BLOCKED" | "UNVERIFIED";

export interface IPlannedPerformancePair {
  readonly candidateCommand: string;
  readonly baselineCommand: string;
  readonly index: number;
  readonly order: PairOrder;
}

export interface IPerformanceLaneRunResult {
  readonly artifactHash?: string;
  readonly attempts: readonly IPlannedPerformancePair[];
  readonly candidateSourceSha: string;
  readonly exitCode: 0 | 1 | 2;
  readonly lane: string;
  readonly orders: readonly PairOrder[];
  readonly provenance: string;
  readonly reason?: string;
  readonly sourceSha: string;
  readonly status: HardwareRunStatus;
  readonly summary?: ReturnType<typeof evaluatePairedComparison>;
}

export interface IPerformanceCollectorOptions {
  readonly workload?: string;
  readonly deadline?: number;
  readonly device?: string;
  readonly physicalEvidence?: string;
}

export interface IPerformanceLaneRunOptions {
  readonly baselineArtifact?: string;
  readonly baselineSourceSha: string;
  readonly baselineWorktree?: string;
  readonly candidateArtifact?: string;
  readonly candidateSourceSha: string;
  readonly candidateWorktree?: string;
  readonly device?: string;
  readonly dryRun?: boolean;
  readonly eventName?: string;
  readonly lane: string;
  readonly leaseDirectory?: string;
  readonly manifestPath: string;
  readonly owner?: string;
  readonly outputPath?: string;
  readonly physicalEvidence?: string;
  readonly required?: boolean;
  readonly trusted?: boolean;
}

export class PerformanceLaneRunError extends Error {
  readonly exitCode = 2;

  constructor(message: string) {
    super(message);
    this.name = "PerformanceLaneRunError";
  }
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PerformanceLaneRunError(`${field} must be a non-empty string`);
  }
  return value;
}

function finitePositive(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new PerformanceLaneRunError(`${field} must be finite and positive`);
  }
  return value;
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PerformanceLaneRunError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function plannedPerformancePairs(
  lane: string,
  baselineWorktree: string,
  candidateWorktree: string,
  collectorOptions: IPerformanceCollectorOptions = {},
): IPlannedPerformancePair[] {
  const target = lane.startsWith("browser-")
    ? "web"
    : lane === "native-android"
      ? "android-physical"
      : lane === "native-ios"
        ? "ios-physical"
        : "desktop";
  return REQUIRED_ORDERS.map((order, index) => ({
    baselineCommand: collectorCommand(
      baselineWorktree,
      target,
      "<baseline-source>",
      `<pair-${index + 1}-baseline>`,
      undefined,
      collectorOptions,
    ),
    candidateCommand: collectorCommand(
      candidateWorktree,
      target,
      "<candidate-source>",
      `<pair-${index + 1}-candidate>`,
      undefined,
      collectorOptions,
    ),
    index,
    order,
  }));
}

export function collectorCommand(
  worktree: string,
  target: string,
  sourceSha: string,
  outputDirectory: string,
  prebuiltArtifact?: string,
  collectorOptions: IPerformanceCollectorOptions = {},
): string {
  if (collectorOptions.workload === "moving-l2-l3-16384") {
    return `pnpm tsx scripts/engine-load-test/cli.ts --arm tn-web --modes L2,L3 --ladder 16384 --repeats 1 --frames 1800 --source-sha ${sourceSha} --skip-baseline # cwd=${worktree}`;
  }
  return [
    "node",
    "packages/runtime-native/scripts/profile-production.mjs",
    ...collectorArguments(target, sourceSha, outputDirectory, prebuiltArtifact, collectorOptions),
    `# cwd=${worktree}`,
  ].join(" ");
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function collectorArguments(
  target: string,
  sourceSha: string,
  outputDirectory: string,
  prebuiltArtifact: string | undefined,
  collectorOptions: IPerformanceCollectorOptions,
): string[] {
  return [
    "--profile",
    "regression",
    "--target",
    target,
    ...(hasText(collectorOptions.device) ? ["--device", collectorOptions.device] : []),
    ...(hasText(collectorOptions.physicalEvidence)
      ? ["--physical-evidence", collectorOptions.physicalEvidence]
      : []),
    "--source-sha",
    sourceSha,
    "--out",
    outputDirectory,
    ...(prebuiltArtifact === undefined ? [] : ["--prebuilt-artifact", prebuiltArtifact]),
  ];
}

export function validatePerformanceDispatch(input: {
  readonly dryRun?: boolean;
  readonly eventName: string;
  readonly trusted: boolean;
}): void {
  if (input.dryRun) return;
  if (input.eventName !== "schedule" && input.eventName !== "workflow_dispatch") {
    throw new PerformanceLaneRunError(
      `hardware performance lanes reject ${input.eventName}; only schedule and trusted manual dispatch are allowed`,
    );
  }
  if (!input.trusted) {
    throw new PerformanceLaneRunError(
      "hardware performance lanes require a trusted dispatch; untrusted source cannot reach a device",
    );
  }
}

export function validateArtifactIdentity(input: {
  readonly artifactHash?: unknown;
  readonly expectedSourceSha: string;
  readonly lane: string;
  readonly nativeBinaryHash?: unknown;
  readonly provenance?: unknown;
  readonly sourceSha?: unknown;
}): void {
  if (input.sourceSha !== input.expectedSourceSha) {
    throw new PerformanceLaneRunError(
      `${input.lane} artifact has source SHA ${String(input.sourceSha ?? "<missing>")}; expected ${input.expectedSourceSha}`,
    );
  }
  if (typeof input.artifactHash !== "string" || input.artifactHash.length === 0) {
    throw new PerformanceLaneRunError(`${input.lane} artifact hash is missing`);
  }
  if (
    input.lane.startsWith("native-") &&
    (typeof input.nativeBinaryHash !== "string" || input.nativeBinaryHash.length === 0)
  ) {
    throw new PerformanceLaneRunError(`${input.lane} native binary hash is missing`);
  }
  if (
    (input.lane === "native-android" || input.lane === "native-ios") &&
    input.provenance !== PHYSICAL_PROVENANCE
  ) {
    throw new PerformanceLaneRunError(
      `${input.lane} requires physical-hardware provenance; ${String(input.provenance ?? "<missing>")} is not a phone run`,
    );
  }
}

export function validateThermalEvidence(input: {
  readonly lane: string;
  readonly metrics?: unknown;
}): void {
  if (input.lane !== "native-android" && input.lane !== "native-ios") return;
  const metrics = objectValue(input.metrics, `${input.lane} metrics`);
  const thermal = objectValue(metrics.thermal, `${input.lane} metrics.thermal`);
  if (thermal.complete !== true || thermal.thermallyConfounded === true) {
    throw new PerformanceLaneRunError(
      `${input.lane} run has incomplete or thermally confounded resource evidence`,
    );
  }
}

interface ILeaseHandle {
  readonly directory: string;
  readonly release: () => Promise<void>;
}

function safeLeaseKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/gu, "_");
}

export async function acquirePerformanceLease(
  directory: string,
  key: string,
  owner: string,
  options: { readonly staleAfterMs?: number } = {},
): Promise<ILeaseHandle> {
  const leaseDirectory = path.join(directory, safeLeaseKey(key));
  const staleAfterMs = options.staleAfterMs ?? 15 * 60_000;
  await mkdir(directory, { recursive: true });
  try {
    await mkdir(leaseDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const details = await stat(leaseDirectory).catch(() => undefined);
    if (details !== undefined && Date.now() - details.mtimeMs > staleAfterMs) {
      await rm(leaseDirectory, { force: true, recursive: true });
      await mkdir(leaseDirectory);
    } else {
      throw new PerformanceLaneRunError(`performance resource ${key} is already leased`);
    }
  }
  await writeFile(
    path.join(leaseDirectory, "owner.json"),
    `${JSON.stringify({ owner, startedAt: new Date().toISOString() })}\n`,
    { flag: "wx" },
  ).catch(async (error: unknown) => {
    await rm(leaseDirectory, { force: true, recursive: true });
    throw error;
  });
  let released = false;
  return {
    directory: leaseDirectory,
    release: async () => {
      if (released) return;
      released = true;
      await rm(leaseDirectory, { force: true, recursive: true });
    },
  };
}

export async function withPerformanceLease<T>(
  directory: string,
  key: string,
  owner: string,
  work: (lease: ILeaseHandle) => Promise<T>,
): Promise<T> {
  const lease = await acquirePerformanceLease(directory, key, owner);
  try {
    return await work(lease);
  } finally {
    await lease.release();
  }
}

function laneProvisioning(lane: IPerformanceLane): string {
  return lane.provisioning !== undefined
    ? lane.provisioning
    : lane.platform.startsWith("native-")
      ? "unprovisioned"
      : "hosted-software";
}

function laneRequired(lane: IPerformanceLane, requested: boolean | undefined): boolean {
  return requested === true || lane.required === true;
}

async function readManifest(
  file: string,
): Promise<{ readonly manifest: IPerformanceLaneManifest; readonly raw: unknown }> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
    return { manifest: parsePerformanceLaneManifest(raw), raw };
  } catch (error) {
    if (error instanceof PerformanceLaneRunError) throw error;
    throw new PerformanceLaneRunError(
      `could not read lane manifest ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function unavailableResult(
  lane: IPerformanceLane,
  sourceSha: string,
  candidateSourceSha: string,
  required: boolean,
  reason: string,
  attempts: readonly IPlannedPerformancePair[],
): IPerformanceLaneRunResult {
  const status: HardwareRunStatus = required ? "BLOCKED" : "UNVERIFIED";
  return {
    attempts,
    candidateSourceSha,
    exitCode: status === "BLOCKED" ? 2 : 0,
    lane: lane.id,
    orders: REQUIRED_ORDERS,
    provenance: laneProvisioning(lane),
    reason,
    sourceSha,
    status,
  };
}

function targetForLane(lane: IPerformanceLane): string {
  if (lane.platform === "browser-webgpu") return "web";
  if (lane.platform === "native-android") return "android-physical";
  if (lane.platform === "native-ios") return "ios-physical";
  return "desktop";
}

async function findPrebuiltArtifact(worktree: string, target: string): Promise<string | undefined> {
  if (target === "web") return undefined;
  const candidates = target.startsWith("ios")
    ? [
        path.join(worktree, "packages/runtime-native/build/tn-ios-simulator/threenative-ios.app"),
        path.join(worktree, "packages/runtime-native/build/tn-ios/threenative-ios.app"),
      ]
    : target.startsWith("android")
      ? [
          path.join(
            worktree,
            "packages/runtime-native/android/app/build/outputs/apk/release/app-release.apk",
          ),
          path.join(
            worktree,
            "packages/runtime-native/android/app/build/outputs/apk/debug/app-debug.apk",
          ),
        ]
      : [
          path.join(worktree, "packages/runtime-native/build/tn-linux/mystral"),
          path.join(worktree, "packages/runtime-native/build/tn-linux-quickjs/mystral"),
        ];
  for (const candidate of candidates) {
    if (
      await stat(candidate)
        .then(() => true)
        .catch(() => false)
    )
      return candidate;
  }
  return undefined;
}

async function runCollector(
  worktree: string,
  target: string,
  sourceSha: string,
  outputDirectory: string,
  prebuiltArtifact?: string,
  collectorOptions: IPerformanceCollectorOptions = {},
): Promise<{ readonly command: string; readonly evidence: Record<string, unknown> }> {
  const remainingMs = collectorTimeoutMs(collectorOptions.deadline);
  if (collectorOptions.workload === "moving-l2-l3-16384") {
    await execFileAsync(
      "pnpm",
      [
        "tsx",
        "scripts/engine-load-test/cli.ts",
        "--arm",
        "tn-web",
        "--modes",
        "L2,L3",
        "--ladder",
        "16384",
        "--repeats",
        "1",
        "--frames",
        "1800",
        "--source-sha",
        sourceSha,
        "--skip-baseline",
      ],
      { cwd: worktree, timeout: remainingMs, maxBuffer: 32 * 1024 * 1024 },
    );
    const report = JSON.parse(
      await readFile(path.join(worktree, "artifacts/engine-load-test/tn-web.json"), "utf8"),
    );
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(path.join(outputDirectory, "ladder-report.json"), JSON.stringify(report));
    return {
      command: collectorCommand(
        worktree,
        target,
        sourceSha,
        outputDirectory,
        undefined,
        collectorOptions,
      ),
      evidence: report,
    };
  }
  const args = [
    "packages/runtime-native/scripts/profile-production.mjs",
    ...collectorArguments(target, sourceSha, outputDirectory, prebuiltArtifact, collectorOptions),
  ];
  const command = collectorCommand(
    worktree,
    target,
    sourceSha,
    outputDirectory,
    prebuiltArtifact,
    collectorOptions,
  );
  try {
    await execFileAsync(process.execPath, args, {
      cwd: worktree,
      maxBuffer: 32 * 1024 * 1024,
      timeout: remainingMs,
    });
    const file = path.join(outputDirectory, "production-evidence.json");
    return { command, evidence: objectValue(JSON.parse(await readFile(file, "utf8")), file) };
  } catch (error) {
    throw new PerformanceLaneRunError(
      `${command} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function metricValue(metrics: Record<string, unknown>, key: string): number | undefined {
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function metricSamples(metrics: Record<string, unknown>, key: string): number[] | undefined {
  const value = metrics[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new PerformanceLaneRunError(`evidence.metrics.${key} must contain samples`);
  }
  return value.map((sample, index) => finitePositive(sample, `evidence.metrics.${key}[${index}]`));
}

function observedIdentity(value: unknown, field: string): string {
  const text = nonEmpty(value, `evidence.identity.${field}`);
  if (
    /unknown|synthetic|fixture|default-target|selected-target|software|swiftshader|llvmpipe/i.test(
      text,
    )
  ) {
    throw new PerformanceLaneRunError(
      `evidence.identity.${field} is not observed hardware: ${text}`,
    );
  }
  return text;
}

export function validateApprovedBaseline(approved: object, observed: object): void {
  for (const [field, expected] of Object.entries(approved)) {
    if (expected === undefined || (observed as Record<string, unknown>)[field] !== expected) {
      throw new PerformanceLaneRunError(
        `approved baseline ${field} does not match collected identity`,
      );
    }
  }
}

export function productionEvidenceToPerformanceRun(
  evidence: Record<string, unknown>,
  lane: Pick<IPerformanceLane, "id" | "platform" | "workload">,
  expectedSourceSha?: string,
): IPerformanceRun {
  if (lane.workload === "moving-l2-l3-16384") {
    const report = parseRunReport(evidence);
    if (report.identity?.sourceSha !== expectedSourceSha)
      throw new PerformanceLaneRunError("ladder identity source does not match selected build");
    for (const [field, value] of Object.entries(report.identity ?? {}))
      observedIdentity(value, field);
    const metrics = Object.fromEntries(
      summarize(report).flatMap((row) => [
        [`frameP95Ms.${row.mode}`, { value: row.p95, samples: [row.p95], unit: "ms" }],
        [
          `drawCalls.${row.mode}`,
          { value: row.drawCalls, samples: [row.drawCalls], unit: "count" },
        ],
        [
          `triangles.${row.mode}`,
          { value: row.triangles, samples: [row.triangles], unit: "count" },
        ],
      ]),
    );
    return parsePerformanceRun({
      lane: lane.id,
      workload: lane.workload,
      identity: report.identity,
      reportHash: sha256(JSON.stringify(report)),
      metrics,
    });
  }
  const source = objectValue(evidence.source, "evidence.source");
  const artifact = objectValue(evidence.artifact, "evidence.artifact");
  const identity = objectValue(evidence.identity, "evidence.identity");
  const metrics = objectValue(evidence.metrics, "evidence.metrics");
  const requiredSourceSha = expectedSourceSha ?? nonEmpty(source.sha, "evidence.source.sha");
  const nativeBinaryHash = lane.platform.startsWith("native-")
    ? nonEmpty(identity.nativeBinarySha256, "evidence.identity.nativeBinarySha256")
    : String(identity.nativeBinarySha256 ?? artifact.sha256);
  const evidenceIdentity = {
    architecture: observedIdentity(identity.architecture ?? identity.hostClass, "architecture"),
    artifactHash: nonEmpty(artifact.sha256, "evidence.artifact.sha256"),
    browser:
      lane.platform === "browser-webgpu"
        ? observedIdentity(identity.browserClass, "browserClass")
        : "none",
    device: observedIdentity(identity.deviceClass, "deviceClass"),
    graphicsBackend: observedIdentity(identity.graphicsBackend, "graphicsBackend"),
    gpu: observedIdentity(identity.gpuClass, "gpuClass"),
    instrumentationRevision: "productionEvidenceV1",
    jsRuntime: observedIdentity(identity.jsRuntime, "jsRuntime"),
    nativeBinaryHash,
    operatingSystem: observedIdentity(identity.osClass, "osClass"),
    presentMode: observedIdentity(identity.presentMode, "presentMode"),
    resolution: `${finitePositive(identity.renderWidth, "identity.renderWidth")}x${finitePositive(identity.renderHeight, "identity.renderHeight")}`,
    sourceSha: nonEmpty(source.sha, "evidence.source.sha"),
    workloadHash: observedIdentity(identity.workloadHash, "workloadHash"),
  };
  validateArtifactIdentity({
    artifactHash: evidenceIdentity.artifactHash,
    expectedSourceSha: requiredSourceSha,
    lane: lane.id,
    nativeBinaryHash: evidenceIdentity.nativeBinaryHash,
    provenance: objectValue(evidence.physical ?? {}, "evidence.physical").provenance,
    sourceSha: evidenceIdentity.sourceSha,
  });
  validateThermalEvidence({ lane: lane.id, metrics });
  const mapped: Record<string, number> = {};
  const mappings: readonly [string, string][] = [
    ["drawCalls", "drawCalls"],
    ["triangles", "triangles"],
    ["frameP95Ms", "p95FrameMs"],
    ["phaseP95Ms", "phaseP95Ms"],
    ["startupP95Ms", "startupP95Ms"],
  ];
  for (const [metric, sourceMetric] of mappings) {
    const value = metricValue(metrics, sourceMetric);
    if (value !== undefined) mapped[metric] = value;
  }
  const memory = metrics.memory;
  if (typeof memory === "object" && memory !== null && !Array.isArray(memory)) {
    const highWaterBytes = metricValue(memory as Record<string, unknown>, "highWaterBytes");
    if (highWaterBytes !== undefined) mapped.memoryHighWaterMiB = highWaterBytes / (1024 * 1024);
  }
  const startupSamples = metricSamples(metrics, "startupSamplesMs");
  const runId = nonEmpty(evidence.runId, "evidence.runId");
  const timestamps = objectValue(evidence.timestamps, "evidence.timestamps");
  const execution = objectValue(evidence.execution ?? {}, "evidence.execution");
  const mappedMetrics: Record<
    string,
    { readonly samples: readonly number[]; readonly unit: string; readonly value: number }
  > = Object.fromEntries(
    Object.entries(mapped).map(([metric, value]) => [
      metric,
      {
        samples: [value],
        unit: metric.endsWith("Ms") ? "ms" : metric === "memoryHighWaterMiB" ? "MiB" : "count",
        value,
      },
    ]),
  );
  if (startupSamples !== undefined) {
    mappedMetrics.startupP95Ms = {
      samples: startupSamples,
      unit: "ms",
      value: metricValue(metrics, "startupP95Ms") ?? percentile(startupSamples, 0.95),
    };
  }
  return {
    command: nonEmpty(evidence.command, "evidence.command"),
    durationSeconds: metricValue(metrics, "durationSeconds"),
    identity: evidenceIdentity,
    lane: lane.id,
    metrics: mappedMetrics,
    reportHash: sha256(JSON.stringify({ runId, timestamps, evidence })),
    sampleCount: metricValue(metrics, "sampleCount") ?? metricValue(metrics, "frameSampleCount"),
    workload: lane.workload,
    ...("execution" in evidence
      ? {
          command: `${String(evidence.command)}; profile=${String(execution.profile ?? "unknown")}`,
        }
      : {}),
  } as IPerformanceRun;
}

export async function runPerformanceLane(
  options: IPerformanceLaneRunOptions,
): Promise<IPerformanceLaneRunResult> {
  const { manifest, raw } = await readManifest(options.manifestPath);
  const lane = manifest.lanes.find(({ id }) => id === options.lane);
  if (lane === undefined)
    throw new PerformanceLaneRunError(
      `lane ${options.lane} is not declared by ${options.manifestPath}`,
    );
  const required = laneRequired(lane, options.required);
  const baselineWorktree = options.baselineWorktree ?? process.cwd();
  const candidateWorktree = options.candidateWorktree ?? process.cwd();
  const collectorOptions: IPerformanceCollectorOptions = {
    workload: lane.workload,
    deadline: Date.now() + PERFORMANCE_QUICK_SUITE_BUDGET_MS,
    ...(options.device === undefined ? {} : { device: options.device }),
    ...(options.physicalEvidence === undefined
      ? {}
      : { physicalEvidence: options.physicalEvidence }),
  };
  const attempts = plannedPerformancePairs(
    lane.id,
    baselineWorktree,
    candidateWorktree,
    collectorOptions,
  );
  validatePerformanceDispatch({
    dryRun: options.dryRun,
    eventName: options.eventName ?? process.env.GITHUB_EVENT_NAME ?? "workflow_dispatch",
    trusted: options.trusted ?? process.env.TN_PERF_TRUSTED === "1",
  });
  const provisioning = laneProvisioning(lane);
  if (lane.arms.length === 0 || provisioning === "unprovisioned" || provisioning === "simulator") {
    return unavailableResult(
      lane,
      options.baselineSourceSha,
      options.candidateSourceSha,
      required,
      provisioning === "simulator"
        ? "simulator evidence is advisory and cannot satisfy a physical-device lane"
        : "requested lane is not provisioned; no collector ran",
      attempts,
    );
  }
  if (options.dryRun) {
    return unavailableResult(
      lane,
      options.baselineSourceSha,
      options.candidateSourceSha,
      required,
      "dry run planned the independent hardware pairs; no device claim was made",
      attempts,
    );
  }
  if (options.baselineSourceSha === options.candidateSourceSha) {
    throw new PerformanceLaneRunError(
      "baseline and candidate source SHA must differ outside calibration",
    );
  }
  if (lane.baseline.status !== "accepted") {
    return unavailableResult(
      lane,
      options.baselineSourceSha,
      options.candidateSourceSha,
      required,
      `lane baseline is ${lane.baseline.status}; accepted baseline approval is required before comparison`,
      attempts,
    );
  }
  const leaseDirectory =
    options.leaseDirectory ?? path.join(process.cwd(), ".runtime/performance-leases");
  const owner = options.owner ?? `${process.pid}-${Date.now()}`;
  const target = targetForLane(lane);
  if (target === "android-physical" || target === "ios-physical") {
    const missing = [];
    if (!hasText(options.device)) missing.push("device");
    if (!hasText(options.physicalEvidence)) missing.push("physical-evidence");
    if (missing.length === 0) {
      const exists = await stat(options.physicalEvidence as string)
        .then((details) => details.isFile())
        .catch(() => false);
      if (!exists) missing.push("physical-evidence file");
    }
    if (missing.length > 0) {
      return unavailableResult(
        lane,
        options.baselineSourceSha,
        options.candidateSourceSha,
        required,
        `physical collector input missing: ${missing.join(", ")}; no collector ran`,
        attempts,
      );
    }
  }
  const baselineArtifact =
    options.baselineArtifact ?? (await findPrebuiltArtifact(baselineWorktree, target));
  const candidateArtifact =
    options.candidateArtifact ?? (await findPrebuiltArtifact(candidateWorktree, target));
  if (lane.baseline.identity?.sourceSha !== options.baselineSourceSha) {
    throw new PerformanceLaneRunError("requested source SHA does not match approved baseline");
  }
  const rawPairs: IPerformancePair[] = [];
  return withPerformanceLease(leaseDirectory, lane.id, owner, async () => {
    for (const attempt of attempts) {
      const baselineOut = path.join(
        options.outputPath ?? path.join(process.cwd(), "artifacts/performance-regression"),
        `${lane.id}-pair-${attempt.index + 1}-baseline`,
      );
      const candidateOut = path.join(
        options.outputPath ?? path.join(process.cwd(), "artifacts/performance-regression"),
        `${lane.id}-pair-${attempt.index + 1}-candidate`,
      );
      const first =
        attempt.order === "baseline-first"
          ? await runCollector(
              baselineWorktree,
              target,
              options.baselineSourceSha,
              baselineOut,
              baselineArtifact,
              collectorOptions,
            )
          : await runCollector(
              candidateWorktree,
              target,
              options.candidateSourceSha,
              candidateOut,
              candidateArtifact,
              collectorOptions,
            );
      const second =
        attempt.order === "baseline-first"
          ? await runCollector(
              candidateWorktree,
              target,
              options.candidateSourceSha,
              candidateOut,
              candidateArtifact,
              collectorOptions,
            )
          : await runCollector(
              baselineWorktree,
              target,
              options.baselineSourceSha,
              baselineOut,
              baselineArtifact,
              collectorOptions,
            );
      const baseline = attempt.order === "baseline-first" ? first : second;
      const candidate = attempt.order === "baseline-first" ? second : first;
      const approvedRun = productionEvidenceToPerformanceRun(
        baseline.evidence,
        lane,
        options.baselineSourceSha,
      );
      validateApprovedBaseline(lane.baseline.identity ?? {}, approvedRun.identity);
      rawPairs.push({
        baseline: approvedRun,
        candidate: productionEvidenceToPerformanceRun(
          candidate.evidence,
          lane,
          options.candidateSourceSha,
        ),
        order: attempt.order,
      });
    }
    const summary = evaluatePairedComparison(
      {
        lane: lane.id,
        laneManifest: raw,
        pairs: rawPairs,
        requiredMetrics: lane.requiredMetrics,
        workload: lane.workload,
      },
      DEFAULT_PERFORMANCE_POLICY,
    );
    return {
      attempts,
      candidateSourceSha: options.candidateSourceSha,
      exitCode: summary.exitCode,
      lane: lane.id,
      orders: REQUIRED_ORDERS,
      provenance: provisioning,
      sourceSha: options.baselineSourceSha,
      status: summary.verdict,
      summary,
      artifactHash: summary.pairs[0]?.candidateArtifactHash,
    };
  });
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const manifestPath =
    argument("manifest") ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "lanes.json");
  const lane = nonEmpty(argument("lane"), "--lane");
  const baselineSourceSha = nonEmpty(
    argument("baseline-source-sha") ?? argument("source-sha"),
    "--baseline-source-sha",
  );
  const candidateSourceSha = nonEmpty(argument("candidate-source-sha"), "--candidate-source-sha");
  const outputPath =
    argument("out") ?? path.join(process.cwd(), "artifacts/performance-regression", `${lane}.json`);
  const result = await runPerformanceLane({
    baselineSourceSha,
    baselineArtifact: argument("baseline-artifact"),
    baselineWorktree: argument("baseline-worktree"),
    candidateSourceSha,
    candidateArtifact: argument("candidate-artifact"),
    candidateWorktree: argument("candidate-worktree"),
    device: argument("device") ?? process.env.TN_PERF_DEVICE,
    dryRun: process.argv.includes("--dry-run"),
    eventName: process.env.GITHUB_EVENT_NAME,
    lane,
    leaseDirectory: argument("lease-dir"),
    manifestPath,
    outputPath: path.dirname(outputPath),
    owner: process.env.GITHUB_RUN_ID,
    physicalEvidence: argument("physical-evidence") ?? process.env.TN_PERF_PHYSICAL_EVIDENCE,
    required: process.argv.includes("--required"),
    trusted: process.argv.includes("--trusted"),
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(
    `${result.summary === undefined ? JSON.stringify(result, null, 2) : renderRegressionMarkdown(result.summary)}\n`,
  );
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof PerformanceLaneRunError ? error.exitCode : 2;
  });
}
