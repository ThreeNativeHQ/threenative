import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { type ICampaignDataset, deriveCampaign, experimentKey } from "./campaign.js";
import type { IPlannedCell } from "./plan.js";
import { type IRawTimingSummary, validateRawTimingSeries } from "./raw-series.js";
import { renderCampaignReport } from "./report-html.js";
import { type IV2RunRecord, parseV2RunRecord } from "./report-v2.js";
import { BenchError, requireObject } from "./report.js";

function fail(message: string): never {
  throw new BenchError("TN_BENCH_BAD_BUNDLE", message);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function containedFile(root: string, ref: string): Promise<Buffer> {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9._-]+)*$/u.test(ref) ||
    ref.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    fail(`unsafe bundle ref ${ref}`);
  }
  const resolved = await realpath(path.join(root, ref));
  const prefix = `${await realpath(root)}${path.sep}`;
  if (!resolved.startsWith(prefix)) fail(`bundle ref escapes root: ${ref}`);
  return readFile(resolved);
}

async function optionalFile(root: string, ref: string): Promise<Buffer | null> {
  try {
    return await containedFile(root, ref);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function textField(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 200)
    fail(`${name} must be a non-empty string of at most 200 characters`);
  return value;
}

function hashField(value: unknown, name: string, length = 64): string {
  const result = textField(value, name);
  if (!new RegExp(`^[0-9a-f]{${length}}$`, "u").test(result)) fail(`${name} must be a hash`);
  return result;
}

async function publicationMetadata(
  root: string,
  cells: readonly IPlannedCell[],
  runs: readonly IV2RunRecord[],
): Promise<{
  gaps: string[];
  machine: {
    cpu: string;
    date: string;
    driver: string;
    gpu: string;
    id: string;
    os: string;
  } | null;
  refs: string[];
}> {
  const gaps: string[] = [];
  const refs: string[] = [];
  const sourceBytes = await optionalFile(root, "sources.lock.json");
  if (sourceBytes === null) gaps.push("sources.lock.json");
  else {
    refs.push("sources.lock.json");
    const lock = requireObject(JSON.parse(sourceBytes.toString("utf8")), "sources.lock.json");
    if (lock.schemaVersion !== 1) fail("sources.lock.json needs schemaVersion 1");
    if (
      lock.bevyCommit !== "c6f634ca9f406d68ba5109d921247b654cb42c10" ||
      lock.godotBenchmarkCommit !== "b059e38a81230a87293828bbf65ab247b6b2d2a8"
    )
      fail("sources.lock.json changed the pinned upstream commits");
    hashField(lock.threenativeCommit, "sources.lock.json.threenativeCommit", 40);
    hashField(lock.threePackageSha256, "sources.lock.json.threePackageSha256");
    hashField(lock.godotEngineBinarySha256, "sources.lock.json.godotEngineBinarySha256");
    hashField(lock.foxAssetSha256, "sources.lock.json.foxAssetSha256");
    textField(lock.foxAssetLicense, "sources.lock.json.foxAssetLicense");
    textField(lock.foxAssetAttribution, "sources.lock.json.foxAssetAttribution");
    const lockedCells = requireObject(lock.cells, "sources.lock.json.cells");
    const byExperiment = new Map(cells.map((cell) => [experimentKey(cell.experiment), cell]));
    for (const cell of cells) {
      const arms = requireObject(lockedCells[cell.id], `sources.lock.json.cells.${cell.id}`);
      for (const id of cell.arms) {
        const arm = requireObject(arms[id], `sources.lock.json.cells.${cell.id}.${id}`);
        hashField(arm.sourceHash, `${cell.id}.${id}.sourceHash`);
        hashField(arm.buildHash, `${cell.id}.${id}.buildHash`);
        hashField(arm.dependencyLockSha256, `${cell.id}.${id}.dependencyLockSha256`);
        textField(arm.version, `${cell.id}.${id}.version`);
        textField(arm.backend, `${cell.id}.${id}.backend`);
        textField(arm.compiler, `${cell.id}.${id}.compiler`);
        textField(arm.buildFlags, `${cell.id}.${id}.buildFlags`);
        if (arm.patchSha256 !== null) hashField(arm.patchSha256, `${cell.id}.${id}.patchSha256`);
      }
    }
    for (const run of runs) {
      const cell = byExperiment.get(experimentKey(run.experiment));
      if (cell === undefined) fail(`${run.runId} has no planned source/build lock`);
      const arms = requireObject(lockedCells[cell.id], `sources.lock.json.cells.${cell.id}`);
      const arm = requireObject(
        arms[run.arm.id],
        `sources.lock.json.cells.${cell.id}.${run.arm.id}`,
      );
      if (
        run.sourceHash !== arm.sourceHash ||
        run.arm.build.hash !== arm.buildHash ||
        run.arm.version !== arm.version ||
        run.arm.backend !== arm.backend
      )
        fail(`${run.runId} differs from sources.lock.json`);
    }
  }
  const machineBytes = await optionalFile(root, "machine.json");
  let machine: ICampaignDataset["publicationMachine"] = null;
  if (machineBytes === null) gaps.push("machine.json");
  else {
    refs.push("machine.json");
    const value = requireObject(JSON.parse(machineBytes.toString("utf8")), "machine.json");
    if (value.schemaVersion !== 1) fail("machine.json needs schemaVersion 1");
    const id = textField(value.id, "machine.json.id");
    const os = textField(value.os, "machine.json.os");
    const gpu = textField(value.gpu, "machine.json.gpu");
    const driver = textField(value.driver, "machine.json.driver");
    const cpu = textField(value.cpu, "machine.json.cpu");
    const date = textField(value.date, "machine.json.date");
    if (
      !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
      Number.isNaN(Date.parse(date)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
    )
      fail("machine.json.date must be YYYY-MM-DD");
    if (value.lane !== "physical-hardware") gaps.push("machine.json is not physical hardware");
    for (const run of runs) {
      if (run.machine.id !== id || run.machine.os !== os || run.machine.gpu !== gpu)
        fail(`${run.runId} differs from machine.json`);
    }
    machine = { cpu, date, driver, gpu, id, os };
  }
  return { gaps, machine, refs };
}

/** Regenerate a partial or complete offline report from retained plan and immutable run files. */
export async function writeCampaignReport(
  bundleDir: string,
): Promise<{ partial: boolean; runs: number }> {
  const root = await realpath(bundleDir);
  const planBytes = await containedFile(root, "plan.json");
  const plan = requireObject(JSON.parse(planBytes.toString("utf8")), "campaignPlan");
  if (plan.status !== "draft" && plan.status !== "frozen")
    fail("plan.status must be draft or frozen");
  if (!Array.isArray(plan.cells)) fail("plan.cells must be an array");
  const epsilonSource =
    plan.epsilonByCellId === undefined
      ? {}
      : requireObject(plan.epsilonByCellId, "campaignPlan.epsilonByCellId");
  const epsilonByCellId: Record<string, number> = {};
  for (const [id, value] of Object.entries(epsilonSource)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0.03) {
      fail(`invalid A/A epsilon for ${id}`);
    }
    epsilonByCellId[id] = value;
  }
  const seed = plan.bootstrapSeed ?? 449;
  if (!Number.isInteger(seed) || (seed as number) < 0 || (seed as number) > 0xffffffff)
    fail("plan.bootstrapSeed must be a uint32");
  if (plan.status === "frozen" && plan.bootstrapSeed === undefined)
    fail("frozen plan needs a recorded bootstrapSeed");
  const planHash = sha256(planBytes);
  const runDir = path.join(root, "runs");
  const entries = await readdir(runDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const records = [];
  const rawTiming: Record<string, IRawTimingSummary> = {};
  const refs = ["plan.json"];
  for (const name of entries.sort()) {
    if (!name.endsWith(".json")) continue;
    const ref = `runs/${name}`;
    const record = parseV2RunRecord(JSON.parse((await containedFile(root, ref)).toString("utf8")));
    if (name !== `${record.runId}.json`) fail(`${ref} does not match runId ${record.runId}`);
    if (plan.status === "frozen" && record.planHash !== planHash)
      fail(`${ref} has a planHash different from plan.json`);
    for (const [artifact, hash] of Object.entries(record.checksums)) {
      if (sha256(await containedFile(root, artifact)) !== hash) {
        fail(`${ref} has a checksum mismatch for ${artifact}`);
      }
      refs.push(artifact);
    }
    if (record.timing.rawSeries !== null) {
      const bytes = await containedFile(root, record.timing.rawSeries);
      const summary = validateRawTimingSeries(record, JSON.parse(bytes.toString("utf8")));
      if (summary !== null) rawTiming[record.runId] = summary;
    }
    records.push(record);
    refs.push(ref);
  }
  const publication = await publicationMetadata(root, plan.cells as IPlannedCell[], records);
  refs.push(...publication.refs);
  const dataset = deriveCampaign(
    { status: plan.status, cells: plan.cells as IPlannedCell[] },
    records,
    {
      seed: seed as number,
      epsilonByCellId,
      publicationGaps: publication.gaps,
      publicationMachine: publication.machine,
      rawTiming,
    },
  );
  const output = renderCampaignReport(dataset);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "results.json"), output.json);
  await writeFile(path.join(root, "results.csv"), output.csv);
  await writeFile(path.join(root, "report.html"), output.html);
  const checksums = [...new Set([...refs, "results.json", "results.csv", "report.html"])]
    .sort()
    .map(async (ref) => `${sha256(await containedFile(root, ref))}  ${ref}`);
  await writeFile(
    path.join(root, "checksums.sha256"),
    `${(await Promise.all(checksums)).join("\n")}\n`,
  );
  return { partial: dataset.partial, runs: records.length };
}
