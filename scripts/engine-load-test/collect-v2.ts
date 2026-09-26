import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CITY_UPSTREAM_COMMIT,
  parseCityFixture,
} from "../../examples/engine-load-test/src/city-fixture.js";
import { writeCampaignReport } from "./bundle.js";
import { type ICityComparison, compareCityRuns, parseCityRun } from "./city-compare.js";
import type { IPlannedCell } from "./plan.js";
import { validateRawTimingSeries } from "./raw-series.js";
import {
  type BuildType,
  type IV2RunRecord,
  PRIMARY_METRIC,
  parseV2RunRecord,
} from "./report-v2.js";
import { BenchError, requireNumber, requireObject } from "./report.js";

/**
 * PRD-449 §10's one vertical slice: an archived `bevy-city` smoke pair becomes two immutable v2 run
 * records inside a real campaign bundle, with the comparator rerun and every byte a record rests on
 * copied in beside it under a SHA-256.
 *
 * These runs predate the v2 contract, so the honest record is a narrow one and this intake refuses to
 * widen it. The pair recorded no thermal or background preflight and no frozen `sources.lock.json`, so
 * `machine.preflight.passed` is false and `runStatus` is `invalid` with the reason attached: §11 admits
 * an attempt to publication only with a passing preflight and a frozen source lock, and nothing here
 * synthesises either. The comparator's qualified comparability is kept separately, because "these two
 * ran the same task" and "this attempt may be published" are different questions. A build hash is a
 * digest of archived bytes — the Bevy binary's own, and for the two-file native arm a named canonical
 * digest over both components with each component's SHA-256 disclosed beside it.
 *
 * Two facts the raw records never wrote are declared rather than guessed, and each says so in a flag.
 * Arm order is the operator's word: the pair carries no timestamp that would order the two arms
 * independently, and the plan's arm array is a plan, not an observation, so it is never used. A build
 * type the record did not state is `unknown`, never `release` — which is why this intake always lands
 * `invalid` regardless, and why only the Bevy arm carries a nameable build at all.
 */

export type CityArm = "bevy-desktop" | "tn-desktop";
const ARMS: readonly CityArm[] = ["tn-desktop", "bevy-desktop"];

const MEASURED_FRAMES = 600;
const SCHEDULED_WARMUP_FRAMES = 120;
/** Chromium answers from SwiftShader without erroring, and a software rasteriser's mean is not a GPU's. */
const SOFTWARE_ADAPTER =
  /swiftshader|llvmpipe|lavapipe|softwarerasterizer|software adapter|basic render/i;
const PREFLIGHT_REASON =
  "the archived pair recorded no thermal or background-load preflight and no frozen source lock, so no quiet-machine observation exists to stand behind this attempt";
const OUTCOME_REASON =
  "PRD-449 §11 admits an attempt to publication only with a passing preflight and a frozen sources.lock.json; this archived smoke pair recorded neither, so it is retained as an invalid observation and claims no verdict";
const SOURCE_SCOPE =
  "sha256 of this run's own identity.source descriptor (its adapter, bevy and tn entries) only: not a repository tree hash, not a dependency lock, and no substitute for sources.lock.json";
const CAMPAIGN_RECIPE = "prd449-v2-campaign-1";
const TN_BUILD_RECIPE = "prd449-tn-desktop-build-1";

export {
  CAMPAIGN_RECIPE,
  MEASURED_FRAMES,
  OUTCOME_REASON,
  PREFLIGHT_REASON,
  SCHEDULED_WARMUP_FRAMES,
  SOFTWARE_ADAPTER,
  SOURCE_SCOPE,
  TN_BUILD_DEFINITION,
  TN_BUILD_RECIPE,
};
const TN_BUILD_DEFINITION = `sha256 of the line "${TN_BUILD_RECIPE}", then one "name=sha256:byteCount" line per archived build component in name order, each line newline-terminated`;
const DERIVATION_VERSION = "collect-city-v2-1";
/** The two arms expose the adapter in different shapes, so each names the field it recorded. */
const ADAPTER_DEVICE = { "bevy-desktop": "name", "tn-desktop": "device" } as const;
const BUILD_COMPONENTS: Record<CityArm, readonly string[]> = {
  "bevy-desktop": ["bevyBinary"],
  "tn-desktop": ["nativeHost", "tnBundle"],
};

export interface ICityIntake {
  bevyRaw: string;
  block: number;
  bundleDir: string;
  campaignId?: string;
  /** Which arm ran first, declared by the operator. Never inferred: the plan's arm array is a plan. */
  firstArm: CityArm;
  machine: { id: string; os: string };
  /** Resolves the repo-relative refs the archived records carry, such as their build archives. */
  root: string;
  session: number;
  tnRaw: string;
}

export interface ICityIntakeResult {
  bundleDir: string;
  campaignHash: string;
  cell: string;
  comparability: IV2RunRecord["comparability"];
  partial: boolean;
  runIds: string[];
}

export function fail(code: string, detail: string): never {
  throw new BenchError(code, detail);
}

export const sha256 = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");

/** A named recipe over named components, so a reader can recompute the digest by hand. */
export function canonicalDigest(recipe: string, components: Record<string, string>): string {
  const body = Object.keys(components)
    .sort()
    .map((name) => `${name}=${components[name]}`)
    .join("\n");
  return sha256(`${recipe}\n${body}\n`);
}

export function text(source: Record<string, unknown>, key: string, label: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim().length === 0)
    fail("TN_BENCH_V2_SHAPE", `${label} must be a non-empty string`);
  return value;
}

export function hash(source: Record<string, unknown>, key: string, label: string): string {
  const value = text(source, key, label);
  if (!/^[0-9a-f]{64}$/u.test(value)) fail("TN_BENCH_V2_SHAPE", `${label} must be SHA-256 hex`);
  return value;
}

export function count(source: Record<string, unknown>, key: string, label: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    fail("TN_BENCH_V2_SHAPE", `${label} must be a non-negative integer`);
  return value;
}

/**
 * A timestamp is any finite non-negative number, because a raw monotonic clock carries fractions and
 * §7.4's completed work is their difference. `count` still guards every frame count.
 */
export function timestamp(source: Record<string, unknown>, key: string, label: string): number {
  const value = requireNumber(source, key, label);
  if (value < 0) fail("TN_BENCH_V2_SHAPE", `${label} must be a finite non-negative number`);
  return value;
}

export function optional(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function readObject(file: string, label: string): Promise<Record<string, unknown>> {
  return requireObject(JSON.parse(await readFile(file, "utf8")), label);
}

/** Streamed, because an archived Bevy binary is a hundred megabytes. */
export async function fileIdentity(file: string): Promise<{ bytes: number; sha256: string }> {
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    digest.update(chunk);
  }
  return { bytes, sha256: digest.digest("hex") };
}

/**
 * A ref out of an archived record, resolved against the supplied root and admitted only when the
 * bytes it names really live inside it. Legacy raw wrote absolute paths, so an absolute ref is not
 * itself the violation; a `..` that walks out, a path outside the root, or a symlink whose target
 * leaves it are. The check runs on the real path before the read, so nothing outside is ever opened.
 */
export async function insideRoot(root: string, ref: string, label: string): Promise<string> {
  const base = await realpath(root);
  const resolved = path.resolve(base, ref);
  const target = await realpath(resolved);
  if (!target.startsWith(`${base}${path.sep}`))
    fail(
      "TN_BENCH_V2_PATH",
      `${label} ${ref} resolves to ${target}, which is outside the supplied root ${base}`,
    );
  return resolved;
}

/** A stable machine identity, named by the operator. Nothing here infers one from the host. */
export async function resolveMachineIdentity(options: {
  machineId?: string;
  machineJson?: string;
  machineOs?: string;
}): Promise<{ id: string; os: string }> {
  if (options.machineJson !== undefined) {
    const source = await readObject(options.machineJson, "machine.json");
    return { id: text(source, "id", "machine.json.id"), os: text(source, "os", "machine.json.os") };
  }
  const { machineId, machineOs } = options;
  if (machineId === undefined || machineOs === undefined)
    fail(
      "TN_BENCH_V2_MACHINE",
      "this intake needs a stable machine identity: pass --machine-id with --machine-os, or --machine-json with both, rather than have one inferred from the host",
    );
  return { id: machineId, os: machineOs };
}

interface ISourceIdentity {
  descriptor: Record<string, unknown>;
  digest: string;
  fixtureRef: string;
  identity: Record<string, unknown>;
}

/** The recorded source identity, and the only digest this intake may call a source hash. */
function armSource(raw: Record<string, unknown>, arm: CityArm): ISourceIdentity {
  const identity = requireObject(raw.identity, `${arm} raw record identity`);
  const descriptor = requireObject(identity.source, `${arm} identity.source`);
  const tn = requireObject(descriptor.tn, `${arm} identity.source.tn`);
  if (tn.dirty !== false)
    fail(
      "TN_BENCH_V2_DIRTY_SOURCE",
      `${arm} recorded a dirty ThreeNative checkout; an intake will not present uncommitted sources as a measured build`,
    );
  text(tn, "commit", `${arm} identity.source.tn.commit`);
  const bevy = requireObject(descriptor.bevy, `${arm} identity.source.bevy`);
  if (text(bevy, "commit", `${arm} identity.source.bevy.commit`) !== CITY_UPSTREAM_COMMIT)
    fail("TN_BENCH_V2_SOURCE", `${arm} recorded a Bevy commit other than the pinned one`);
  hash(bevy, "sha256", `${arm} identity.source.bevy.sha256`);
  hash(
    requireObject(descriptor.adapter, `${arm} identity.source.adapter`),
    "sha256",
    `${arm} identity.source.adapter.sha256`,
  );
  return {
    descriptor,
    digest: sha256(JSON.stringify(descriptor)),
    fixtureRef: text(identity, "fixture", `${arm} identity.fixture`),
    identity,
  };
}

export interface IBuildComponent {
  bytes: number;
  name: string;
  sha256: string;
}

/** The archived bytes a run measured, re-hashed here: a lock is only a lock while the file is there. */
export async function archivedBuilds(
  raw: Record<string, unknown>,
  arm: string,
  names: readonly string[],
  root: string,
): Promise<IBuildComponent[]> {
  const identity = requireObject(raw.identity, `${arm} raw record identity`);
  const build = requireObject(identity.build, `${arm} identity.build`);
  const components: IBuildComponent[] = [];
  for (const name of names) {
    const entry = requireObject(build[name], `${arm} identity.build.${name}`);
    const sha256 = hash(entry, "sha256", `${arm} identity.build.${name}.sha256`);
    const bytes = count(entry, "bytes", `${arm} identity.build.${name}.bytes`);
    const archived = text(entry, "archived", `${arm} identity.build.${name}.archived`);
    if (!path.basename(archived).startsWith(sha256))
      fail(
        "TN_BENCH_V2_BUILD_ADDRESS",
        `${arm} ${name} archive ${archived} does not sit at its own content address`,
      );
    let actual: { bytes: number; sha256: string };
    try {
      actual = await fileIdentity(await insideRoot(root, archived, `${arm} ${name} archive`));
    } catch (error) {
      if (error instanceof BenchError) throw error;
      fail("TN_BENCH_V2_BUILD_MISSING", `${arm} archived build ${archived} is gone`);
    }
    if (actual.sha256 !== sha256 || actual.bytes !== bytes)
      fail(
        "TN_BENCH_V2_BUILD_CHANGED",
        `${arm} archived build ${archived} no longer matches the recorded ${bytes} bytes / ${sha256}, so the bytes this run measured are not here to check`,
      );
    components.push({ bytes, name, sha256 });
  }
  return components;
}

/** The observed adapter: the GPU the arm reached, and the driver stack it reached it through. */
function armAdapter(
  adapter: Record<string, unknown> | null,
  arm: CityArm,
): { device: string; driver: string; observed: Record<string, unknown> } {
  const observed = requireObject(adapter, `${arm} adapter`);
  const reported = Object.values(observed)
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const software = reported.match(SOFTWARE_ADAPTER);
  if (software !== null)
    fail(
      "TN_BENCH_V2_SOFTWARE_ADAPTER",
      `${arm} reached ${software[0]}, a software adapter rather than hardware, so its mean is a CPU rasteriser's`,
    );
  const driver = optional(observed, "driverInfo") ?? optional(observed, "description") ?? "";
  if (driver.length === 0)
    fail("TN_BENCH_V2_ADAPTER", `${arm} recorded a device name and no driver version`);
  return {
    device: text(observed, ADAPTER_DEVICE[arm], `${arm} adapter device name`),
    driver,
    observed,
  };
}

/** The plan's own cell for this size and motion, so the pair lands in a planned experiment. */
function plannedCityCell(cells: readonly unknown[], motion: string, size: number): IPlannedCell {
  const matches = cells.filter((entry) => {
    const cell = entry as IPlannedCell;
    return (
      cell.family === "bevy-city" &&
      cell.experiment?.load === String(size) &&
      cell.experiment?.variant.endsWith(`-${motion}`)
    );
  }) as IPlannedCell[];
  if (matches.length !== 1)
    fail(
      "TN_BENCH_V2_NO_CELL",
      `the plan holds ${matches.length} bevy-city cells for ${motion} at size ${size}; an intake will not guess which one this pair belongs to`,
    );
  const cell = matches[0] as IPlannedCell;
  for (const arm of ARMS)
    if (!cell.arms.includes(arm))
      fail("TN_BENCH_V2_NO_CELL", `planned cell ${cell.id} does not include the ${arm} arm`);
  return cell;
}

/** The retained frame boundaries and the completed work they span, boundaries + 1 for the drain. */
export function seriesOf(
  raw: Record<string, unknown>,
  arm: string,
): { measure: number; series: Record<string, unknown> } {
  const series = requireObject(raw.rawSeries, `${arm} raw record rawSeries`);
  const boundaries = series.boundaries;
  if (!Array.isArray(boundaries) || boundaries.length !== MEASURED_FRAMES + 1)
    fail(
      "TN_BENCH_V2_FRAMES",
      `${arm} kept ${Array.isArray(boundaries) ? boundaries.length : 0} frame boundaries; this intake admits only the ${MEASURED_FRAMES}-frame smoke schedule`,
    );
  const measure =
    timestamp(series, "finalCompletionMs", `${arm} finalCompletionMs`) -
    timestamp(
      requireObject(boundaries[0], `${arm} first boundary`),
      "monotonicMs",
      `${arm} first boundary monotonicMs`,
    );
  if (measure <= 0)
    fail(
      "TN_BENCH_V2_FRAMES",
      `${arm} completed no work: its final completion precedes its first boundary`,
    );
  return { measure, series };
}

/** The record layout every v2 intake writes, before a family's own flags are folded in. */
export interface IV2RecordInput {
  arm: string;
  backend: string;
  block: number;
  buildHash: string;
  buildType: BuildType;
  campaignHash: string;
  campaignId: string;
  cell: IPlannedCell;
  checksums: Record<string, string>;
  comparability: IV2RunRecord["comparability"];
  comparabilityReason: string;
  derivationVersion: string;
  durationMs: IV2RunRecord["durationMs"];
  engine: string;
  flags: Record<string, string>;
  fixture: { evidence: string; hash: string };
  gpu: string;
  machine: { id: string; os: string };
  measure: number;
  order: number;
  planHash: string;
  runId: string;
  seriesRef: string;
  session: number;
  sourceDigest: string;
  timingDefinition: string;
  version: string;
  warmupFrames: number;
}

/**
 * The whole schema-2 record, including the explicit `null`s the contract requires beside real values.
 * Each family supplies its own flags and its own phase durations; the skeleton holds the parts two
 * intakes would otherwise drift apart on: the preflight and outcome reasons are the same §11 argument
 * for both, and the primary metric is always completed work over the retained boundaries.
 */
export function v2RunRecord(input: IV2RecordInput): Record<string, unknown> {
  return {
    arm: {
      backend: input.backend,
      build: { hash: input.buildHash, type: input.buildType },
      engine: input.engine,
      flags: input.flags,
      id: input.arm,
      version: input.version,
    },
    block: input.block,
    campaignHash: input.campaignHash,
    campaignId: input.campaignId,
    checksums: input.checksums,
    comparability: input.comparability,
    comparabilityReason: input.comparabilityReason,
    derivationVersion: input.derivationVersion,
    durationMs: input.durationMs,
    experiment: input.cell.experiment,
    fixture: {
      conformance: "pass",
      evidence: input.fixture.evidence,
      hash: input.fixture.hash,
    },
    machine: {
      gpu: input.gpu,
      id: input.machine.id,
      lane: "physical-hardware",
      os: input.machine.os,
      preflight: { passed: false, reason: PREFLIGHT_REASON },
    },
    metrics: [
      { name: PRIMARY_METRIC, reason: null, unit: "ms", value: input.measure / MEASURED_FRAMES },
      {
        name: "gpu-ms",
        reason: "this arm retained no per-frame GPU timestamp samples",
        unit: "ms",
        value: null,
      },
    ],
    order: input.order,
    outcome: { reason: OUTCOME_REASON, runStatus: "invalid" },
    planHash: input.planHash,
    runId: input.runId,
    schemaVersion: 2,
    session: input.session,
    sourceHash: input.sourceDigest,
    timing: {
      definition: input.timingDefinition,
      measuredFrames: MEASURED_FRAMES,
      rawSeries: input.seriesRef,
      rawSeriesReason: null,
      warmupFrames: input.warmupFrames,
    },
  };
}

interface IArmFacts {
  adapter: Record<string, unknown>;
  adapterDriver: string;
  arm: CityArm;
  backend: string;
  block: number;
  buildComponents: IBuildComponent[];
  buildHash: string;
  buildProfile: string;
  buildType: BuildType;
  cell: IPlannedCell;
  checksums: Record<string, string>;
  gpu: string;
  identity: Record<string, unknown>;
  measure: number;
  order: number;
  raw: Record<string, unknown>;
  runId: string;
  series: Record<string, unknown>;
  seriesRef: string;
  session: number;
  source: ISourceIdentity;
  version: string;
  warmupFrames: number;
}

/** The City arm's own flags and phase durations, over the shared record layout. */
function buildRecord(
  facts: IArmFacts,
  shared: {
    campaignHash: string;
    campaignId: string;
    comparability: IV2RunRecord["comparability"];
    comparabilityReason: string;
    firstArm: CityArm;
    fixture: { evidence: string; hash: string };
    machine: ICityIntake["machine"];
    planHash: string;
  },
): Record<string, unknown> {
  const { arm, cell, raw } = facts;
  const flags: Record<string, string> = {
    adapter: JSON.stringify(facts.adapter),
    adapterDriver: facts.adapterDriver,
    authoring:
      optional(raw, "authoring") ?? optional(facts.identity, "authoring") ?? "not recorded",
    buildComponents: facts.buildComponents
      .map((component) => `${component.name}=${component.sha256}:${component.bytes}`)
      .join(","),
    buildProfile: facts.buildProfile,
    display: text(facts.identity, "display", `${arm} identity.display`),
    executionOrderBasis: `operator-declared legacy smoke order: the operator states ${shared.firstArm} ran first in this archived pair, and neither arm's record carries a timestamp that would order them independently, so this order is declared and not independently observed`,
    profile: optional(raw, "profile") ?? "not recorded",
    settings:
      raw.settings === null || raw.settings === undefined
        ? "not recorded"
        : JSON.stringify(raw.settings),
    sourceHashScope: SOURCE_SCOPE,
    warmupFramesBasis: `${facts.warmupFrames} frames discarded before the first scored frame as this arm recorded them, against the ${SCHEDULED_WARMUP_FRAMES} warmup frames the shared schedule preregistered`,
    ...(arm === "tn-desktop" ? { buildHashDefinition: TN_BUILD_DEFINITION } : {}),
    ...(facts.version === "unrecorded" || facts.backend === "unrecorded"
      ? {
          unrecordedBasis:
            "this arm's archived record carries no release version and no graphics backend field; its observed adapter and build components are in the flags beside it",
        }
      : {}),
  };
  return v2RunRecord({
    arm,
    backend: facts.backend,
    block: facts.block,
    buildHash: facts.buildHash,
    buildType: facts.buildType,
    campaignHash: shared.campaignHash,
    campaignId: shared.campaignId,
    cell,
    checksums: facts.checksums,
    comparability: shared.comparability,
    comparabilityReason: shared.comparabilityReason,
    derivationVersion: DERIVATION_VERSION,
    durationMs: {
      measure: facts.measure,
      startup: null,
      startupReason:
        "this arm started timing inside a settled main loop and recorded no separate startup phase",
      warmup: null,
      warmupReason: `this arm recorded ${facts.warmupFrames} discarded warmup frames and no separately timed warmup duration`,
    },
    engine: arm === "bevy-desktop" ? "bevy" : "threenative",
    flags,
    fixture: shared.fixture,
    gpu: facts.gpu,
    machine: shared.machine,
    measure: facts.measure,
    order: facts.order,
    planHash: shared.planHash,
    runId: facts.runId,
    seriesRef: facts.seriesRef,
    session: facts.session,
    sourceDigest: facts.source.digest,
    timingDefinition: `completed work from the first retained frame boundary to the final completion observation; ${optional(raw, "boundarySemantics") ?? "boundary semantics not recorded"}`,
    version: facts.version,
    warmupFrames: facts.warmupFrames,
  });
}

/** A content-addressed evidence copy: same ref, same bytes, so a second collector dedupes. */
export async function writeEvidence(root: string, ref: string, bytes: Buffer): Promise<void> {
  const target = path.join(root, ref);
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(target, bytes, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (sha256(await readFile(target)) !== sha256(bytes))
      fail(
        "TN_BENCH_V2_EVIDENCE_CONFLICT",
        `${ref} already holds bytes that are not the content its name states`,
      );
  }
}

/** Import one archived pair as two immutable v2 records, and regenerate the bundle's report. */
export async function collectCityPair(intake: ICityIntake): Promise<ICityIntakeResult> {
  const planBytes = await readFile(path.join(intake.bundleDir, "plan.json"));
  const plan = requireObject(JSON.parse(planBytes.toString("utf8")), "plan.json");
  if (plan.status !== "draft" && plan.status !== "frozen")
    fail("TN_BENCH_V2_PLAN", "plan.json status must be draft or frozen");
  if (!Array.isArray(plan.cells)) fail("TN_BENCH_V2_PLAN", "plan.json cells must be an array");
  if (intake.firstArm !== "bevy-desktop" && intake.firstArm !== "tn-desktop")
    fail(
      "TN_BENCH_V2_ORDER",
      `firstArm ${String(intake.firstArm)} is not one of bevy-desktop|tn-desktop; arm order is the operator's declaration, so an intake will not read it from the plan's arm array`,
    );
  if (
    !Number.isInteger(intake.block) ||
    intake.block < 1 ||
    !Number.isInteger(intake.session) ||
    intake.session < 1
  )
    fail("TN_BENCH_V2_PLAN", "a session and a block are both 1-based positive integers");

  const bevyBytes = await readFile(intake.bevyRaw);
  const tnBytes = await readFile(intake.tnRaw);
  const bevyRaw = requireObject(JSON.parse(bevyBytes.toString("utf8")), "bevy raw record");
  const tnRaw = requireObject(JSON.parse(tnBytes.toString("utf8")), "tn raw record");
  const bevyRun = parseCityRun(bevyRaw);
  const tnRun = parseCityRun(tnRaw);
  if (bevyRun.variant !== tnRun.variant)
    fail(
      "TN_BENCH_V2_PAIR",
      `the two arms recorded different variants, ${bevyRun.variant} and ${tnRun.variant}`,
    );

  // The exporting arm names the fixture both arms read, and both must name the very same file.
  const fixturePath = await insideRoot(
    intake.root,
    text(requireObject(bevyRaw.fixture, "bevy fixture"), "path", "bevy raw record fixture.path"),
    "bevy fixture path",
  );
  const fixtureBytes = await readFile(fixturePath);
  const fixture = parseCityFixture(fixtureBytes.toString("utf8"));
  const fixtureHash = sha256(fixtureBytes);
  if (fixture.variant !== bevyRun.variant)
    fail(
      "TN_BENCH_V2_PAIR",
      `the fixture exports the ${fixture.variant} scene but the pair recorded ${bevyRun.variant}`,
    );
  if (
    fixture.frameSchedule.measuredFrames !== MEASURED_FRAMES ||
    fixture.frameSchedule.warmupFrames !== SCHEDULED_WARMUP_FRAMES
  )
    fail(
      "TN_BENCH_V2_FRAMES",
      `the fixture schedule is ${fixture.frameSchedule.measuredFrames} frames over ${fixture.frameSchedule.warmupFrames} warmup; this intake admits only ${MEASURED_FRAMES} frames over ${SCHEDULED_WARMUP_FRAMES}`,
    );
  const sources = {
    "bevy-desktop": armSource(bevyRaw, "bevy-desktop"),
    "tn-desktop": armSource(tnRaw, "tn-desktop"),
  };
  // The fixture path resolved against the same real root, so an absolute legacy ref to that very file
  // matches while a ref that walks out of the root cannot.
  const realRoot = await realpath(intake.root);
  for (const arm of ARMS)
    if (path.resolve(realRoot, (sources[arm] as ISourceIdentity).fixtureRef) !== fixturePath)
      fail(
        "TN_BENCH_V2_FIXTURE",
        `${arm} names ${(sources[arm] as ISourceIdentity).fixtureRef} while the exporting arm read ${fixturePath}`,
      );
  // The counterpart arm read the fixture's bytes and hashed them; an identical pair means one fixture.
  if (tnRun.fixture.hash !== fixtureHash)
    fail(
      "TN_BENCH_V2_FIXTURE",
      `tn-desktop recorded fixture hash ${String(tnRun.fixture.hash)} but ${fixturePath} hashes to ${fixtureHash}`,
    );

  const adapters = {
    "bevy-desktop": armAdapter(bevyRun.adapter, "bevy-desktop"),
    "tn-desktop": armAdapter(tnRun.adapter, "tn-desktop"),
  };
  const gpu = (adapters["bevy-desktop"] as { device: string }).device;
  const counterpart = adapters["tn-desktop"] as { device: string; driver: string };
  if (counterpart.device.toLowerCase() !== gpu.toLowerCase())
    fail(
      "TN_BENCH_V2_ADAPTER",
      `the two arms reached different adapters: ${gpu} and ${counterpart.device}`,
    );
  const bevyDriver = (adapters["bevy-desktop"] as { driver: string }).driver.toLowerCase();
  if (
    !bevyDriver.includes(counterpart.driver.toLowerCase()) &&
    !counterpart.driver.toLowerCase().includes(bevyDriver)
  )
    fail(
      "TN_BENCH_V2_ADAPTER",
      `the two arms recorded different driver versions: ${bevyDriver} and ${counterpart.driver}`,
    );

  const builds = {
    "bevy-desktop": await archivedBuilds(
      bevyRaw,
      "bevy-desktop",
      BUILD_COMPONENTS["bevy-desktop"],
      intake.root,
    ),
    "tn-desktop": await archivedBuilds(
      tnRaw,
      "tn-desktop",
      BUILD_COMPONENTS["tn-desktop"],
      intake.root,
    ),
  };
  const cell = plannedCityCell(plan.cells, bevyRun.variant, fixture.size);
  if (
    !cell.plannedBlocks.some(
      (entry) => entry.block === intake.block && entry.session === intake.session,
    )
  )
    fail(
      "TN_BENCH_V2_NO_BLOCK",
      `${cell.id} plans no session ${intake.session} block ${intake.block}; an attempt outside the plan is not a block of this campaign`,
    );

  const comparison: ICityComparison = compareCityRuns(fixture, bevyRun, tnRun);
  const { comparability, comparabilityReason } = comparison.outcome;
  if (
    !comparison.outcome.valid ||
    comparabilityReason === null ||
    (comparability !== "qualified" && comparability !== "matched-task")
  )
    fail(
      "TN_BENCH_V2_NON_COMPARABLE",
      `the comparator did not qualify this pair: ${comparison.outcome.problems.join(", ") || comparability}`,
    );

  const planHash = sha256(planBytes);
  const campaignId = intake.campaignId ?? `import-${planHash.slice(0, 12)}`;
  const campaignHash = canonicalDigest(CAMPAIGN_RECIPE, { campaignId, planHash });
  const comparisonBytes = Buffer.from(`${JSON.stringify(comparison, null, 2)}\n`, "utf8");
  const fixtureRef = `evidence/city-fixture-${fixtureHash.slice(0, 12)}.json`;
  const comparisonRef = `evidence/city-comparison-${sha256(comparisonBytes).slice(0, 12)}.json`;
  const evidence = new Map<string, Buffer>([
    [comparisonRef, comparisonBytes],
    [fixtureRef, fixtureBytes],
  ]);

  const records: { candidate: Record<string, unknown>; record: IV2RunRecord }[] = [];
  for (const arm of ARMS) {
    const raw = arm === "bevy-desktop" ? bevyRaw : tnRaw;
    const rawBytes = arm === "bevy-desktop" ? bevyBytes : tnBytes;
    const source = sources[arm] as ISourceIdentity;
    const components = builds[arm];
    const schedule = requireObject(raw.frameSchedule, `${arm} raw record frameSchedule`);
    const declared = count(schedule, "measuredFrames", `${arm} frameSchedule.measuredFrames`);
    if (declared !== MEASURED_FRAMES)
      fail(
        "TN_BENCH_V2_FRAMES",
        `${arm} recorded ${declared} measured frames; this intake admits only the ${MEASURED_FRAMES}-frame smoke schedule`,
      );
    if (
      count(schedule, "warmupFrames", `${arm} frameSchedule.warmupFrames`) !==
      SCHEDULED_WARMUP_FRAMES
    )
      fail(
        "TN_BENCH_V2_FRAMES",
        `${arm} recorded a ${count(schedule, "warmupFrames", `${arm} frameSchedule.warmupFrames`)}-frame warmup schedule; this intake admits only ${SCHEDULED_WARMUP_FRAMES}`,
      );
    const warmupFrames = count(raw, "warmupFrames", `${arm} raw record warmupFrames`);
    if (warmupFrames < SCHEDULED_WARMUP_FRAMES)
      fail(
        "TN_BENCH_V2_FRAMES",
        `${arm} recorded ${warmupFrames} warmup frames, fewer than the ${SCHEDULED_WARMUP_FRAMES} its own schedule preregistered`,
      );
    const { measure, series } = seriesOf(raw, arm);
    const recordedProfile = optional(
      requireObject(raw.build ?? {}, `${arm} raw record build`),
      "profile",
    );
    const recordedVersion = optional(
      requireObject(raw.engine ?? {}, `${arm} raw record engine`),
      "version",
    );
    // One raw execution has one identity even if an operator tries to assign it to another block.
    const runId = `${arm}-city-${sha256(rawBytes)}`;
    const seriesBytes = Buffer.from(`${JSON.stringify(series, null, 2)}\n`, "utf8");
    const seriesRef = `raw/${runId}-series.json`;
    const rawRef = `raw/${runId}-run.json`;
    evidence.set(rawRef, rawBytes);
    evidence.set(seriesRef, seriesBytes);
    const single = components[0] as IBuildComponent;
    const candidate = buildRecord(
      {
        adapter: (adapters[arm] as { observed: Record<string, unknown> }).observed,
        adapterDriver: (adapters[arm] as { driver: string }).driver,
        arm,
        backend:
          optional((adapters[arm] as { observed: Record<string, unknown> }).observed, "backend") ??
          "unrecorded",
        block: intake.block,
        buildComponents: components,
        buildHash:
          arm === "bevy-desktop"
            ? single.sha256
            : canonicalDigest(
                TN_BUILD_RECIPE,
                Object.fromEntries(
                  components.map((entry) => [entry.name, `${entry.sha256}:${entry.bytes}`]),
                ),
              ),
        buildProfile: recordedProfile ?? "not recorded",
        // Only the Bevy arm's raw record names a profile. An absent one is `unknown`, never
        // `release`, and the buildProfile flag beside it reads "not recorded".
        buildType:
          recordedProfile === null
            ? "unknown"
            : recordedProfile === "release"
              ? "release"
              : "debug",
        cell,
        checksums: {
          [comparisonRef]: sha256(comparisonBytes),
          [fixtureRef]: fixtureHash,
          [rawRef]: sha256(rawBytes),
          [seriesRef]: sha256(seriesBytes),
        },
        gpu,
        identity: source.identity,
        measure,
        order: intake.firstArm === arm ? 0 : 1,
        raw,
        runId,
        series,
        seriesRef,
        session: intake.session,
        source,
        version: arm === "bevy-desktop" ? (recordedVersion ?? "unrecorded") : "unrecorded",
        warmupFrames,
      },
      {
        campaignHash,
        campaignId,
        comparability,
        comparabilityReason,
        firstArm: intake.firstArm,
        fixture: { evidence: comparisonRef, hash: fixtureHash },
        machine: intake.machine,
        planHash,
      },
    );
    // The contract's own reader, before anything is written: a record that cannot be re-read is not
    // evidence, and a series that contradicts its record's measure is not a measurement.
    const record = parseV2RunRecord(candidate);
    validateRawTimingSeries(record, series);
    records.push({ candidate, record });
  }

  for (const { record } of records) {
    const target = path.join(intake.bundleDir, "runs", `${record.runId}.json`);
    if (existsSync(target))
      fail(
        "TN_BENCH_V2_RUN_EXISTS",
        `${intake.bundleDir} already holds run ${record.runId}; a v2 record is immutable, so import this pair under its own session and block rather than over it`,
      );
  }
  for (const [ref, bytes] of evidence) await writeEvidence(intake.bundleDir, ref, bytes);
  await mkdir(path.join(intake.bundleDir, "runs"), { recursive: true });
  for (const { candidate, record } of records)
    await writeFile(
      path.join(intake.bundleDir, "runs", `${record.runId}.json`),
      `${JSON.stringify(candidate, null, 2)}\n`,
      { flag: "wx" },
    );
  const report = await writeCampaignReport(intake.bundleDir);
  return {
    bundleDir: intake.bundleDir,
    campaignHash,
    cell: cell.id,
    comparability,
    partial: report.partial,
    runIds: records.map(({ record }) => record.runId),
  };
}
