// PRD-449 §10: the immutable campaign store. One attempt in, one run record plus its raw series
// retained under the campaign root, in the layout the monitor already reads: `runs/<runId>.json`
// and `raw/<runId>-<metric>.<ext>`. The series keep a non-`.json` extension so a sample file is
// never mistaken for an attempt, and every file is created exclusively, so a run id, a record or
// a series that already exists is refused rather than overwritten — the campaign history is the
// point (§7.3), and a rewritten attempt cannot be shown.
//
// This store decides nothing about a measurement: no metric, status, benchmark or default is
// invented here. The caller supplies a complete `ICampaignRunRecord` and the bytes of the series
// it names, and the store's whole job is the file-level claim: the bytes that land are the bytes
// the record's sha-256 covers, and what is published is exactly what `parseCampaignRun` accepts.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { type ICampaignRunRecord, parseCampaignRun } from "./campaign-report.js";
import { BenchError } from "./report.js";

const RUNS_SUBDIR = "runs";
const RAW_SUBDIR = "raw";

export interface ICampaignStoreInput {
  readonly campaignRoot: string;
  /** Campaign-relative series reference → the bytes it resolves to. Keys must be exactly the
   *  references `record.rawSeries` names, and every one of them must be present. */
  readonly rawSeries: Readonly<Record<string, Uint8Array | string>>;
  readonly record: ICampaignRunRecord;
}

export interface ICampaignStoreResult {
  readonly rawPaths: readonly string[];
  readonly runPath: string;
}

function bytesOf(value: Uint8Array | string): Buffer {
  return typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
}

function unsafe(detail: string): BenchError {
  return new BenchError("TN_BENCH_UNSAFE_ARTIFACT_REF", detail);
}

function malformed(detail: string): BenchError {
  return new BenchError("TN_BENCH_BAD_SHAPE", detail);
}

/** An id that becomes a filename must be one path segment: `runs/a/b.json` would file one attempt
 *  under another's name, and the monitor lists whatever it finds under `runs/`. */
function assertIdSegment(value: string, label: string): string {
  if (value.includes("/")) throw unsafe(`${label} must be a single path segment`);
  return value;
}

/** The store's own layout rule, checked before the reader's: a series lives under `raw/`, named
 *  for the attempt that wrote it, and never as `.json`, which the monitor would list as an attempt
 *  of its own. Traversal, absolute and scheme forms are refused by `parseCampaignRun` below. */
function assertRawRef(ref: string, runId: string): string {
  if (!ref.startsWith(`${RAW_SUBDIR}/${runId}-`) || ref.slice(RAW_SUBDIR.length + 1).includes("/"))
    throw unsafe(`${ref} must be a series under ${RAW_SUBDIR}/ named for run ${runId}`);
  if (ref.endsWith(".json")) throw unsafe(`${ref} must not use the .json an attempt record uses`);
  return ref;
}

async function writeExclusive(
  root: string,
  target: string,
  payload: Buffer | string,
): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const [realRoot, realParent] = await Promise.all([
    realpath(root),
    realpath(path.dirname(target)),
  ]);
  if (realParent !== path.join(realRoot, path.basename(path.dirname(target))))
    throw unsafe(`${target} resolves outside its campaign directory`);
  try {
    await writeFile(target, payload, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new BenchError(
      "TN_BENCH_OUTPUT_EXISTS",
      `${target} already exists; every attempt keeps its own bytes, so choose a new run id`,
    );
  }
}

/** Hash what was actually written and check it against what the record claims. A series the record
 *  does not name would be retained bytes the record cannot vouch for, and unnamed bytes are refused
 *  rather than written quietly. */
function checksumsFor(input: ICampaignStoreInput): Record<string, string> {
  const checksums: Record<string, string> = { ...input.record.checksums };
  const named = new Set(input.record.rawSeries.map((series) => series.path));
  for (const [ref, raw] of Object.entries(input.rawSeries)) {
    if (!named.has(ref)) throw malformed(`${ref} is not a series the record names`);
    if (raw.length === 0)
      throw malformed(
        `${ref} is empty, so it cannot back ${input.record.rawSeries.find((s) => s.path === ref)?.metric}`,
      );
    const digest = createHash("sha256").update(bytesOf(raw)).digest("hex");
    const claimed = checksums[ref];
    if (claimed !== undefined && claimed !== digest)
      throw malformed(`${ref} does not hash to the sha-256 the record claims`);
    checksums[ref] = digest;
  }
  for (const series of input.record.rawSeries)
    if (!(series.path in input.rawSeries))
      throw malformed(`no bytes supplied for the series the record names at ${series.path}`);
  return checksums;
}

/**
 * Retain one campaign run attempt: its raw series first, then the run record, each created
 * exclusively under `campaignRoot`. Everything is validated — ids, references, checksums and the
 * record itself — before a byte is written. A taken run id fails before writing raw bytes, leaving
 * the published attempt untouched; the caller must choose a fresh id.
 */
export async function storeCampaignRun(input: ICampaignStoreInput): Promise<ICampaignStoreResult> {
  const runId = assertIdSegment(input.record.runId, "run.runId");
  assertIdSegment(input.record.campaignId, "run.campaignId");
  for (const series of input.record.rawSeries) assertRawRef(series.path, runId);
  const checksums = checksumsFor(input);
  const parsed = parseCampaignRun({ ...input.record, checksums });
  const runPath = path.join(input.campaignRoot, RUNS_SUBDIR, `${runId}.json`);
  if (existsSync(runPath))
    throw new BenchError(
      "TN_BENCH_OUTPUT_EXISTS",
      `${runPath} already exists; choose a new run id`,
    );

  const rawPaths: string[] = [];
  for (const [ref, raw] of Object.entries(input.rawSeries)) {
    const target = path.join(input.campaignRoot, ref);
    await writeExclusive(input.campaignRoot, target, bytesOf(raw));
    rawPaths.push(target);
  }
  await writeExclusive(input.campaignRoot, runPath, `${JSON.stringify(parsed, null, 2)}\n`);
  return { rawPaths, runPath };
}
