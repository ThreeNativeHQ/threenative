import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CULL_UPSTREAM_COMMIT,
  parseCullFixture,
} from "../../examples/engine-load-test/src/cull-fixture.js";
import { writeCampaignReport } from "./bundle.js";
import {
  CAMPAIGN_RECIPE,
  type IBuildComponent,
  MEASURED_FRAMES,
  SCHEDULED_WARMUP_FRAMES,
  SOFTWARE_ADAPTER,
  TN_BUILD_DEFINITION,
  TN_BUILD_RECIPE,
  archivedBuilds,
  canonicalDigest,
  count,
  fail,
  fileIdentity,
  hash,
  insideRoot,
  optional,
  seriesOf,
  sha256,
  text,
  v2RunRecord,
  writeEvidence,
} from "./collect-v2.js";
import { type ICullComparison, compareCullRuns, parseCullRun } from "./cull-compare.js";
import type { IPlannedCell } from "./plan.js";
import { validateRawTimingSeries } from "./raw-series.js";
import { type BuildType, type IV2RunRecord, parseV2RunRecord } from "./report-v2.js";
import { requireNumber, requireObject } from "./report.js";

/**
 * PRD-449's second v2 vertical slice: an archived `godot-culling.basic_cull` pair becomes two
 * immutable schema-2 records inside a real campaign bundle, with the existing comparator rerun and
 * every byte a record rests on copied in beside it under a SHA-256.
 *
 * It is the same honest narrow record City's intake writes, because the same two facts are missing:
 * the archived pair recorded no thermal or background preflight and no frozen `sources.lock.json`, so
 * `machine.preflight.passed` is false and `runStatus` is `invalid` with the reason attached. §11 admits
 * an attempt to publication only with both, and nothing here synthesises either. The comparator's
 * `qualified` comparability is kept beside that separately, and so are the two qualifications that
 * survive into the record verbatim rather than as a disclaimer.
 *
 * One adaptation is the family's own and has to be explicit, because it decides what the pair measured:
 * Godot's occlusion culling was switched off in a staged project (`occlusion_culling/
 * use_occlusion_culling=false`) so the upstream scene's 10,000 objects would cull by frustum alone and
 * be comparable with a renderer that has no occlusion culling to switch off. That is verified against
 * the staged project's bytes here, not taken on the record's word, and the counterpart arm carries no
 * field that could confirm or deny its own state — which the record says rather than assuming.
 *
 * Nothing else is declared that the records do not state. Arm order is the operator's word, because the
 * pair carries no timestamp that would order the arms and a plan's arm array is a plan. The Godot arm
 * names its engine version and the counterpart arm names none, so that side is `unrecorded` rather than
 * borrowed. Neither arm names a build type, so both are `unknown`, never `release`. No temperature,
 * clock or driver field is synthesised, and every field a record does not carry is a `null` or an
 * `unknown` with its reason beside it.
 *
 * The Godot arm's warmup is the one duration not read from the field its own source has always
 * published. Before the adapter timed the phase, `_warmup_us` held the clock reading taken when the
 * warmup began, and it was serialised as `warmupMs` — a start clock wearing a duration's name. The
 * adapter now times the warmup and publishes the elapsed time as `warmupDurationMs`, so the two
 * record shapes are distinguishable and a duration is read only from a field that means one. A raw
 * written before that field existed carries `null` and says why, rather than an absolute clock
 * reading presented as an elapsed time.
 */

export type CullArm = "godot-desktop" | "tn-desktop";
const ARMS: readonly CullArm[] = ["tn-desktop", "godot-desktop"];

const DERIVATION_VERSION = "collect-cull-v2-2";
/** The two arms expose the adapter in different shapes, so each names the field it recorded. */
const ADAPTER_DEVICE = { "godot-desktop": "name", "tn-desktop": "device" } as const;
/** The Godot adapter publishes its driver as an array of strings; the counterpart's is one string. */
const ADAPTER_DRIVER = { "godot-desktop": "driverInfo", "tn-desktop": "description" } as const;
const BUILD_COMPONENTS: Record<CullArm, readonly string[]> = {
  "godot-desktop": ["godotBinary"],
  "tn-desktop": ["nativeHost", "tnBundle"],
};
const ENGINE: Record<CullArm, string> = {
  "godot-desktop": "godot",
  "tn-desktop": "threenative",
};
const SOURCE_SCOPE =
  "sha256 of this run's own identity.source descriptor (its commit, fixture ref, and the adapter, occlusion and tn entries each arm recorded) only: not a repository tree hash, not a dependency lock, and no substitute for sources.lock.json";
/** The one line that makes this pair frustum-culling-only, named so a reader can re-grep the bytes. */
const OCCLUSION_OFF_LINE = "occlusion_culling/use_occlusion_culling=false";
const OCCLUSION_QUALIFICATION =
  "the Godot arm's occlusion culling was explicitly turned off in the staged project it ran, so this pair measures frustum culling alone; the counterpart arm's renderer has no occlusion culling to disable and its record carries no field that would confirm or deny its own state, so that half of the pair is unobserved rather than assumed off";
const MISSING_VERSION_BASIS =
  "this arm's archived record names no release version and no graphics backend field; its observed adapter and build components are in the flags beside it, and no version is borrowed from the counterpart arm";
/** `615.71.09` is a driver version, not an architecture or a product name, so compare versions. */
const DRIVER_VERSION = /\b\d+\.\d+\.\d+(?:\.\d+)?\b/gu;

export interface ICullIntake {
  block: number;
  bundleDir: string;
  campaignId?: string;
  /** Which arm ran first, declared by the operator. Never inferred: the plan's arm array is a plan. */
  firstArm: CullArm;
  godotRaw: string;
  machine: { id: string; os: string };
  /** Resolves the repo-relative refs the archived records carry: their build archives, fixture and
   *  staged Godot project. */
  root: string;
  session: number;
  tnRaw: string;
}

export interface ICullIntakeResult {
  bundleDir: string;
  campaignHash: string;
  cell: string;
  comparability: IV2RunRecord["comparability"];
  partial: boolean;
  runIds: string[];
}

interface ISourceIdentity {
  descriptor: Record<string, unknown>;
  digest: string;
  fixtureRef: string;
  identity: Record<string, unknown>;
}

/** The recorded source identity, and the only digest this intake may call a source hash. */
function armSource(raw: Record<string, unknown>, arm: CullArm): ISourceIdentity {
  const identity = requireObject(raw.identity, `${arm} raw record identity`);
  const descriptor = requireObject(identity.source, `${arm} identity.source`);
  if (text(descriptor, "commit", `${arm} identity.source.commit`) !== CULL_UPSTREAM_COMMIT)
    fail(
      "TN_BENCH_V2_SOURCE",
      `${arm} recorded upstream commit ${String(descriptor.commit)} rather than the pinned ${CULL_UPSTREAM_COMMIT}`,
    );
  if (arm === "tn-desktop") {
    const tn = requireObject(descriptor.tn, "tn-desktop identity.source.tn");
    if (tn.dirty !== false)
      fail(
        "TN_BENCH_V2_DIRTY_SOURCE",
        "tn-desktop recorded a dirty ThreeNative checkout; an intake will not present uncommitted sources as a measured build",
      );
    text(tn, "commit", "tn-desktop identity.source.tn.commit");
  } else {
    // The pinned adapter script is the upstream arm's own source, so its bytes are rehashed here.
    const adapter = requireObject(descriptor.adapter, "godot-desktop identity.source.adapter");
    hash(adapter, "sha256", "godot-desktop identity.source.adapter.sha256");
    text(adapter, "path", "godot-desktop identity.source.adapter.path");
  }
  return {
    descriptor,
    digest: sha256(JSON.stringify(descriptor)),
    // Both arms keep the fixture ref inside `identity.source` beside the commit it names, not at the
    // top of `identity` as the City's own writer did, so it is read from where these records put it.
    fixtureRef: text(descriptor, "fixture", `${arm} identity.source.fixture`),
    identity,
  };
}

/**
 * The Godot arm's staged project, re-hashed and read: a record claiming occlusion culling was disabled
 * is a claim, and the 840-byte project file is the claim's evidence. A pair whose Godot arm left
 * occlusion culling on measures occlusion-culled work that the counterpart renderer cannot produce, so
 * a mismatch refuses the import rather than qualifying it.
 */
async function occlusionOff(
  raw: Record<string, unknown>,
  root: string,
): Promise<Record<string, unknown>> {
  const label = "godot-desktop identity.source.occlusionCulling";
  const off = requireObject(
    requireObject(raw.identity, "godot-desktop raw record identity").source,
    "godot-desktop identity.source",
  ).occlusionCulling;
  const occlusion = requireObject(off, label);
  if (text(occlusion, "applied", `${label}.applied`) !== OCCLUSION_OFF_LINE)
    fail(
      "TN_BENCH_V2_OCCLUSION",
      `${label}.applied records another setting than ${OCCLUSION_OFF_LINE}`,
    );
  if (occlusion.effective !== false)
    fail(
      "TN_BENCH_V2_OCCLUSION",
      "godot-desktop recorded its occlusion culling as effective, so this pair measures occlusion-culled work the counterpart renderer cannot produce",
    );
  hash(occlusion, "projectSha256", `${label}.projectSha256`);
  hash(occlusion, "upstreamProjectSha256", `${label}.upstreamProjectSha256`);
  const project = await insideRoot(
    root,
    path.join(text(occlusion, "staged", `${label}.staged`), "project.godot"),
    `${label} staged project.godot`,
  );
  const actual = await fileIdentity(project);
  if (actual.sha256 !== (occlusion.projectSha256 as string))
    fail(
      "TN_BENCH_V2_SOURCE_CHANGED",
      `the staged Godot project ${project} no longer matches its recorded projectSha256, so the project that disabled occlusion culling is not here to check`,
    );
  if (!(await readFile(project, "utf8")).includes(OCCLUSION_OFF_LINE))
    fail(
      "TN_BENCH_V2_OCCLUSION",
      `the staged project ${project} hashes to its recorded digest but no longer sets ${OCCLUSION_OFF_LINE}`,
    );
  return occlusion;
}

/**
 * The observed adapter: the GPU the arm reached, and the driver stack it reached it through. Godot's
 * driver is an array and the counterpart's a string, so both are read into a set of dotted versions
 * and matched as versions — the shorter set must sit inside the longer, which is what "the same driver"
 * means when one side also reports a Windows sub-version.
 */
function armAdapter(
  adapter: Record<string, unknown>,
  arm: CullArm,
): { device: string; driver: string; observed: Record<string, unknown>; versions: Set<string> } {
  const reported = Object.values(adapter)
    .filter((value) => typeof value === "string")
    .join(" ");
  const software = reported.match(SOFTWARE_ADAPTER);
  if (software !== null)
    fail(
      "TN_BENCH_V2_SOFTWARE_ADAPTER",
      `${arm} reached ${software[0]}, a software adapter rather than hardware, so its mean is a CPU rasteriser's`,
    );
  const field = ADAPTER_DRIVER[arm];
  const raw = adapter[field];
  const driver = Array.isArray(raw) ? raw.join(" ") : ((raw as string | undefined) ?? "");
  const versions = new Set(driver.match(DRIVER_VERSION) ?? []);
  if (driver.trim().length === 0 || versions.size === 0)
    fail(
      "TN_BENCH_V2_ADAPTER",
      `${arm} recorded a device name and no dotted driver version in ${field}`,
    );
  return {
    device: text(adapter, ADAPTER_DEVICE[arm], `${arm} adapter device name`),
    driver,
    observed: adapter,
    versions,
  };
}

/** The plan's own cell for this variant and object count, so the pair lands in a planned experiment. */
function plannedCullCell(
  cells: readonly unknown[],
  variant: string,
  objects: number,
): IPlannedCell {
  const matches = cells.filter((entry) => {
    const cell = entry as IPlannedCell;
    return (
      cell.family === "godot-culling" &&
      cell.experiment?.variant === variant &&
      cell.experiment?.load === String(objects)
    );
  }) as IPlannedCell[];
  if (matches.length !== 1)
    fail(
      "TN_BENCH_V2_NO_CELL",
      `the plan holds ${matches.length} godot-culling cells for ${variant} at ${objects} objects; an intake will not guess which one this pair belongs to`,
    );
  const cell = matches[0] as IPlannedCell;
  for (const arm of ARMS)
    if (!cell.arms.includes(arm))
      fail("TN_BENCH_V2_NO_CELL", `planned cell ${cell.id} does not include the ${arm} arm`);
  return cell;
}

interface IArmFacts {
  adapter: Record<string, unknown>;
  adapterDriver: string;
  arm: CullArm;
  authoring: string;
  backend: string;
  block: number;
  buildComponents: IBuildComponent[];
  buildHash: string;
  buildType: BuildType;
  checksums: Record<string, string>;
  measure: number;
  occlusion: Record<string, unknown> | null;
  order: number;
  presentMode: string;
  runId: string;
  seriesRef: string;
  session: number;
  source: ISourceIdentity;
  version: string;
  wallSemantics: string;
  warmupFrames: number;
  warmupMs: number | null;
  warmupReason: string | null;
}

/**
 * The arm's timed warmup, or `null` with the reason a record has to carry beside it. The counterpart
 * arm measures its warmup and has always published the elapsed time as `warmupMs`; the Godot adapter
 * published the warmup's *start clock* under that same name until it began timing the phase, so its
 * duration is read only from the field the fixed adapter added, and an older raw has no verified
 * duration at all. An absent field is the only thing treated as absent: a field that is present and
 * not a number is a malformed record, refused rather than read as unmeasured.
 */
function armWarmupMs(
  raw: Record<string, unknown>,
  arm: CullArm,
): { reason: string | null; value: number | null } {
  const field = arm === "godot-desktop" ? "warmupDurationMs" : "warmupMs";
  if (raw[field] === undefined && arm === "godot-desktop")
    return {
      reason:
        "this raw predates the Godot adapter timing its warmup and publishes the warmup's start clock as `warmupMs` rather than an elapsed duration, so no verified warmup duration is recorded here",
      value: null,
    };
  return { reason: null, value: requireNumber(raw, field, `${arm} ${field}`) };
}

/** The record as written, including the explicit `null`s the contract requires beside real values. */
function buildRecord(
  facts: IArmFacts,
  shared: {
    campaignHash: string;
    campaignId: string;
    cell: IPlannedCell;
    comparability: IV2RunRecord["comparability"];
    comparabilityReason: string;
    firstArm: CullArm;
    fixture: { evidence: string; hash: string };
    gpu: string;
    machine: ICullIntake["machine"];
    planHash: string;
  },
): Record<string, unknown> {
  const { arm } = facts;
  return v2RunRecord({
    arm,
    backend: facts.backend,
    block: facts.block,
    buildHash: facts.buildHash,
    // Neither arm's record names a build type, so neither is `release`; §3.2 wants `unknown` to say so.
    buildType: facts.buildType,
    campaignHash: shared.campaignHash,
    campaignId: shared.campaignId,
    cell: shared.cell,
    checksums: facts.checksums,
    comparability: shared.comparability,
    comparabilityReason: shared.comparabilityReason,
    derivationVersion: DERIVATION_VERSION,
    durationMs: {
      measure: facts.measure,
      startup: null,
      startupReason:
        "this arm started timing inside a settled main loop and recorded no separate startup phase",
      // A real timed phase where the record's own arm measured one, and `null` with its reason where
      // the archived raw holds no duration this intake can vouch for.
      warmup: facts.warmupMs,
      warmupReason: facts.warmupReason,
    },
    engine: ENGINE[arm],
    flags: {
      adapter: JSON.stringify(facts.adapter),
      adapterDriver: facts.adapterDriver,
      authoring: facts.authoring,
      buildComponents: facts.buildComponents
        .map((component) => `${component.name}=${component.sha256}:${component.bytes}`)
        .join(","),
      // `profile` on these records is the measurement profile, not a build profile, and neither arm
      // names a build profile at all.
      buildProfile: "not recorded",
      display: text(facts.source.identity, "display", `${arm} identity.display`),
      executionOrderBasis: `operator-declared legacy smoke order: the operator states ${shared.firstArm} ran first in this archived pair, and neither arm's record carries a timestamp that would order them independently, so this order is declared and not independently observed`,
      ...(facts.occlusion === null
        ? {
            occlusionCulling:
              "this arm's record carries no occlusion-culling field: three.js has no occlusion culling to disable, and nothing here asserts a state the bytes do not state",
          }
        : {
            occlusionCulling: JSON.stringify({
              ...facts.occlusion,
              verifiedStagedProject:
                "the staged project.godot was re-hashed here and does set occlusion_culling/use_occlusion_culling=false",
            }),
          }),
      // The present mode the surface actually got is what the comparator's cadence rule turns on, so
      // the record carries the value or says the arm stated none.
      presentMode:
        facts.presentMode === "not recorded"
          ? "not recorded by this arm, so the comparator judged its frames on timing alone"
          : facts.presentMode,
      profile: "smoke",
      sourceHashScope: SOURCE_SCOPE,
      wallSemantics: facts.wallSemantics,
      warmupFramesBasis: `${facts.warmupFrames} frames discarded before the first scored frame as this arm recorded them, against the ${SCHEDULED_WARMUP_FRAMES} warmup frames the shared schedule preregistered`,
      ...(arm === "tn-desktop" ? { buildHashDefinition: TN_BUILD_DEFINITION } : {}),
      ...(facts.version === "unrecorded" || facts.backend === "unrecorded"
        ? { unrecordedBasis: MISSING_VERSION_BASIS }
        : {}),
    },
    fixture: shared.fixture,
    gpu: shared.gpu,
    machine: shared.machine,
    measure: facts.measure,
    order: facts.order,
    planHash: shared.planHash,
    runId: facts.runId,
    seriesRef: facts.seriesRef,
    session: facts.session,
    sourceDigest: facts.source.digest,
    timingDefinition: `completed work from the first retained frame boundary to the final completion observation, which this arm's own record reads as ${facts.wallSemantics}`,
    version: facts.version,
    warmupFrames: facts.warmupFrames,
  });
}

/** Import one archived culling pair as two immutable v2 records, and regenerate the bundle's report. */
export async function collectCullPair(intake: ICullIntake): Promise<ICullIntakeResult> {
  const planBytes = await readFile(path.join(intake.bundleDir, "plan.json"));
  const plan = requireObject(JSON.parse(planBytes.toString("utf8")), "plan.json");
  if (plan.status !== "draft" && plan.status !== "frozen")
    fail("TN_BENCH_V2_PLAN", "plan.json status must be draft or frozen");
  if (!Array.isArray(plan.cells)) fail("TN_BENCH_V2_PLAN", "plan.json cells must be an array");
  if (intake.firstArm !== "godot-desktop" && intake.firstArm !== "tn-desktop")
    fail(
      "TN_BENCH_V2_ORDER",
      `firstArm ${String(intake.firstArm)} is not one of godot-desktop|tn-desktop; arm order is the operator's declaration, so an intake will not read it from the plan's arm array`,
    );
  if (
    !Number.isInteger(intake.block) ||
    intake.block < 1 ||
    !Number.isInteger(intake.session) ||
    intake.session < 1
  )
    fail("TN_BENCH_V2_PLAN", "a session and a block are both 1-based positive integers");

  const godotBytes = await readFile(intake.godotRaw);
  const tnBytes = await readFile(intake.tnRaw);
  const godotRaw = requireObject(JSON.parse(godotBytes.toString("utf8")), "godot raw record");
  const tnRaw = requireObject(JSON.parse(tnBytes.toString("utf8")), "tn raw record");
  const godotRun = parseCullRun(godotRaw, "TN_BENCH_CULL_GODOT_RUN_MALFORMED");
  const tnRun = parseCullRun(tnRaw, "TN_BENCH_CULL_TN_RUN_MALFORMED");
  if (godotRun.variant !== tnRun.variant)
    fail(
      "TN_BENCH_V2_PAIR",
      `the two arms recorded different variants, ${godotRun.variant} and ${tnRun.variant}`,
    );
  if (godotRun.arm !== "godot-desktop" || tnRun.arm !== "tn-desktop")
    fail(
      "TN_BENCH_V2_PAIR",
      `this intake imports a godot-desktop/tn-desktop pair; the records name ${godotRun.arm} and ${tnRun.arm}`,
    );

  // The exporting arm names the fixture both arms read, and both must name the very same file. The
  // counterpart arm read the fixture's bytes and hashed them, so an identical pair means one fixture.
  const fixturePath = await insideRoot(
    intake.root,
    text(requireObject(godotRaw.fixture, "godot fixture"), "path", "godot raw record fixture.path"),
    "godot fixture path",
  );
  const fixtureBytes = await readFile(fixturePath);
  const fixture = parseCullFixture(fixtureBytes.toString("utf8"));
  const fixtureHash = sha256(fixtureBytes);
  for (const [arm, recorded] of [
    ["godot-desktop", godotRun.fixture.hash],
    ["tn-desktop", tnRun.fixture.hash],
  ] as const)
    if (recorded !== fixtureHash)
      fail(
        "TN_BENCH_V2_FIXTURE",
        `${arm} recorded fixture hash ${recorded} but ${fixturePath} hashes to ${fixtureHash}`,
      );

  const sources = {
    "godot-desktop": armSource(godotRaw, "godot-desktop"),
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
  // The upstream adapter script is re-hashed from the root the record's own ref names.
  const godotAdapter = requireObject(
    (sources["godot-desktop"] as ISourceIdentity).descriptor.adapter,
    "godot-desktop identity.source.adapter",
  );
  const adapterPath = await insideRoot(
    intake.root,
    text(godotAdapter, "path", "godot-desktop identity.source.adapter.path"),
    "godot-desktop identity.source.adapter.path",
  );
  const adapterActual = await fileIdentity(adapterPath);
  if (adapterActual.sha256 !== (godotAdapter.sha256 as string))
    fail(
      "TN_BENCH_V2_SOURCE_CHANGED",
      `the Godot adapter ${adapterPath} hashes to ${adapterActual.sha256}, not the recorded ${String(godotAdapter.sha256)}, so the upstream arm's source is not here to check`,
    );
  const occlusion = await occlusionOff(godotRaw, intake.root);

  const adapters = {
    "godot-desktop": armAdapter(godotRun.adapter, "godot-desktop"),
    "tn-desktop": armAdapter(tnRun.adapter, "tn-desktop"),
  };
  const gpu = (adapters["godot-desktop"] as { device: string }).device;
  const counterpart = adapters["tn-desktop"] as { device: string; versions: Set<string> };
  if (counterpart.device.toLowerCase() !== gpu.toLowerCase())
    fail(
      "TN_BENCH_V2_ADAPTER",
      `the two arms reached different adapters: ${gpu} and ${counterpart.device}`,
    );
  const godotVersions = (adapters["godot-desktop"] as { versions: Set<string> }).versions;
  const [narrow, wide] = [godotVersions, counterpart.versions].sort(
    (left, right) => left.size - right.size,
  );
  const missing = [...(narrow as Set<string>)].filter(
    (version) => !(wide as Set<string>).has(version),
  );
  if (missing.length > 0)
    fail(
      "TN_BENCH_V2_ADAPTER",
      `the two arms recorded different driver versions: ${[...godotVersions].join(",")} and ${[...counterpart.versions].join(",")}`,
    );

  const builds = {
    "godot-desktop": await archivedBuilds(
      godotRaw,
      "godot-desktop",
      BUILD_COMPONENTS["godot-desktop"],
      intake.root,
    ),
    "tn-desktop": await archivedBuilds(
      tnRaw,
      "tn-desktop",
      BUILD_COMPONENTS["tn-desktop"],
      intake.root,
    ),
  };
  const cell = plannedCullCell(plan.cells, godotRun.variant, fixture.objects);
  if (
    !cell.plannedBlocks.some(
      (entry) => entry.block === intake.block && entry.session === intake.session,
    )
  )
    fail(
      "TN_BENCH_V2_NO_BLOCK",
      `${cell.id} plans no session ${intake.session} block ${intake.block}; an attempt outside the plan is not a block of this campaign`,
    );

  const comparison: ICullComparison = compareCullRuns(tnRun, godotRun);
  const { comparability, comparabilityReasons, problems, valid } = comparison.outcome;
  if (!valid || comparability !== "qualified")
    fail(
      "TN_BENCH_V2_NON_COMPARABLE",
      `the comparator did not qualify this pair: ${problems.join(", ") || comparability}`,
    );
  // The comparator's own reasons — the RID authoring difference and the shaded environments — plus
  // the family's occlusion-off adaptation, kept as reasons rather than left as a reader's guess.
  const comparabilityReason = [...comparabilityReasons, OCCLUSION_QUALIFICATION].join(" ");

  const planHash = sha256(planBytes);
  const campaignId = intake.campaignId ?? `import-${planHash.slice(0, 12)}`;
  const campaignHash = canonicalDigest(CAMPAIGN_RECIPE, { campaignId, planHash });
  const comparisonBytes = Buffer.from(`${JSON.stringify(comparison, null, 2)}\n`, "utf8");
  const fixtureRef = `evidence/cull-fixture-${fixtureHash.slice(0, 12)}.json`;
  const comparisonRef = `evidence/cull-comparison-${sha256(comparisonBytes).slice(0, 12)}.json`;
  const evidence = new Map<string, Buffer>([
    [comparisonRef, comparisonBytes],
    [fixtureRef, fixtureBytes],
  ]);

  const records: { candidate: Record<string, unknown>; record: IV2RunRecord }[] = [];
  for (const arm of ARMS) {
    const raw = arm === "godot-desktop" ? godotRaw : tnRaw;
    const rawBytes = arm === "godot-desktop" ? godotBytes : tnBytes;
    const run = arm === "godot-desktop" ? godotRun : tnRun;
    const source = sources[arm] as ISourceIdentity;
    const components = builds[arm];
    // The upstream arm states its frame count; the counterpart's 601 boundaries are its count. A
    // stated count that disagrees with the admitted schedule is refused rather than read past.
    if (raw.frames !== undefined && count(raw, "frames", `${arm} frames`) !== MEASURED_FRAMES)
      fail(
        "TN_BENCH_V2_FRAMES",
        `${arm} recorded ${count(raw, "frames", `${arm} frames`)} frames; this intake admits only the ${MEASURED_FRAMES}-frame smoke schedule`,
      );
    const warmupFrames = count(raw, "warmupFrames", `${arm} warmupFrames`);
    if (warmupFrames < SCHEDULED_WARMUP_FRAMES)
      fail(
        "TN_BENCH_V2_FRAMES",
        `${arm} recorded ${warmupFrames} warmup frames, fewer than the ${SCHEDULED_WARMUP_FRAMES} its own schedule preregistered`,
      );
    const { measure, series } = seriesOf(raw, arm);
    // One raw execution has one identity even if an operator tries to assign it to another block.
    const runId = `${arm}-cull-${sha256(rawBytes)}`;
    const seriesBytes = Buffer.from(`${JSON.stringify(series, null, 2)}\n`, "utf8");
    const seriesRef = `raw/${runId}-series.json`;
    const rawRef = `raw/${runId}-run.json`;
    evidence.set(rawRef, rawBytes);
    evidence.set(seriesRef, seriesBytes);
    const single = components[0] as IBuildComponent;
    const recordedVersion = optional(
      requireObject(raw.engine ?? {}, `${arm} raw record engine`),
      "version",
    );
    const warmup = armWarmupMs(raw, arm);
    const candidate = buildRecord(
      {
        adapter: (adapters[arm] as { observed: Record<string, unknown> }).observed,
        adapterDriver: (adapters[arm] as { driver: string }).driver,
        arm,
        authoring: run.authoring,
        backend:
          optional(
            (adapters[arm] as { observed: Record<string, unknown> }).observed,
            "renderingDriver",
          ) ?? "unrecorded",
        block: intake.block,
        buildComponents: components,
        buildHash:
          arm === "godot-desktop"
            ? single.sha256
            : canonicalDigest(
                TN_BUILD_RECIPE,
                Object.fromEntries(
                  components.map((entry) => [entry.name, `${entry.sha256}:${entry.bytes}`]),
                ),
              ),
        buildType: "unknown",
        checksums: {
          [comparisonRef]: sha256(comparisonBytes),
          [fixtureRef]: fixtureHash,
          [rawRef]: sha256(rawBytes),
          [seriesRef]: sha256(seriesBytes),
        },
        measure,
        occlusion: arm === "godot-desktop" ? occlusion : null,
        order: intake.firstArm === arm ? 0 : 1,
        presentMode: run.presentMode ?? "not recorded",
        runId,
        seriesRef,
        session: intake.session,
        source,
        // Only the upstream arm names its engine version; the counterpart arm's is never borrowed.
        version: arm === "godot-desktop" ? (recordedVersion ?? "unrecorded") : "unrecorded",
        wallSemantics: run.wallSemantics as string,
        warmupFrames,
        warmupMs: warmup.value,
        warmupReason: warmup.reason,
      },
      {
        campaignHash,
        campaignId,
        cell,
        comparability,
        comparabilityReason,
        firstArm: intake.firstArm,
        fixture: { evidence: comparisonRef, hash: fixtureHash },
        gpu,
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
