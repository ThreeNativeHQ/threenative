// PRD-449's independent-mesh smoke pairing. Two retained arm files in, one qualified summary out.
// Deliberately not the publication statistic: `stats.ts` owns the seven-block paired bootstrap and
// its verdicts, and a single block cannot support one. What this adds is the fail-closed check
// that the two runs measured the same task on the same GPU — the comparison is meaningless without
// it, and joining two unrelated means is exactly the silent error the PRD's §3.1 forbids.
import { readFile } from "node:fs/promises";
import { BenchError } from "./report.js";

export interface IMeshArmSummary {
  arm: string;
  capture: string | null;
  display: string | null;
  drawCalls: number | null;
  frameP50Ms: number | null;
  frameP95Ms: number | null;
  frameP99Ms: number | null;
  meanMs: number;
  result: string;
  triangles: number | null;
}

export interface IMeshComparison {
  adapter: Record<string, string | null>;
  arms: { baseline: IMeshArmSummary; candidate: IMeshArmSummary };
  blocks: 1;
  count: number;
  fixtureHash: string;
  meanRatioBaselineOverCandidate: number;
  profile: "smoke";
  qualifications: string[];
  threeRevision: string;
  variant: string;
}

/**
 * Standing limits of this lane, retained in the artifact so a number cannot be read past them.
 * `stats.ts` owns the seven-block bootstrap that replaces the first one; the second is a property
 * of the metric itself — the two arms present through different display paths, so a difference in
 * that path is inside the ratio rather than something the ratio has removed.
 */
const QUALIFICATIONS = [
  "one smoke block with no A/A calibration: no faster/slower verdict is supported",
  "each completed-work mean includes its own arm's presentation path, so a difference in that path sits inside the ratio",
] as const;

function positive(run: unknown, name: string, label: string): number {
  if (typeof run !== "object" || run === null)
    throw new BenchError("TN_BENCH_MESH_MISSING_MEASUREMENT", `${label} is not a run record`);
  const value = (run as Record<string, unknown>)[name];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new BenchError(
      "TN_BENCH_MESH_MISSING_MEASUREMENT",
      `${label} reported no ${name}; an unmeasured frame is not a fast one`,
    );
  return value;
}

function text(run: Record<string, unknown>, name: string, label: string): string {
  const value = run[name];
  if (typeof value !== "string" || value.length === 0)
    throw new BenchError(
      "TN_BENCH_MESH_MISSING_MEASUREMENT",
      `${label} reported no ${name}; an unidentified run cannot be compared`,
    );
  return value;
}

function optionalNumber(run: Record<string, unknown>, name: string): number | null {
  const value = run[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalText(run: Record<string, unknown>, name: string): string | null {
  const value = run[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function adapterOf(run: Record<string, unknown>, label: string): Record<string, string | null> {
  const adapter = run.adapter;
  if (typeof adapter !== "object" || adapter === null)
    throw new BenchError(
      "TN_BENCH_MESH_MISSING_MEASUREMENT",
      `${label} reported no adapter; a run that cannot name its GPU is unmeasured`,
    );
  return adapter as Record<string, string | null>;
}

function summarize(
  run: unknown,
  label: string,
  result: string,
): IMeshArmSummary & {
  adapter: Record<string, string | null>;
  count: number;
  fixtureHash: string;
  threeRevision: string;
  variant: string;
} {
  if (typeof run !== "object" || run === null)
    throw new BenchError("TN_BENCH_MESH_MISSING_MEASUREMENT", `${label} is not a run record`);
  const record = run as Record<string, unknown>;
  const stats =
    typeof record.stats === "object" && record.stats !== null
      ? (record.stats as Record<string, unknown>)
      : {};
  return {
    adapter: adapterOf(record, label),
    arm: text(record, "arm", label),
    capture: optionalText(record, "capture"),
    count: positive(record, "count", label),
    display: optionalText(
      typeof record.identity === "object" && record.identity !== null
        ? (record.identity as Record<string, unknown>)
        : {},
      "display",
    ),
    drawCalls: optionalNumber(stats, "drawCalls"),
    fixtureHash: text(record, "fixtureHash", label),
    frameP50Ms: optionalNumber(record, "frameP50Ms"),
    frameP95Ms: optionalNumber(record, "frameP95Ms"),
    frameP99Ms: optionalNumber(record, "frameP99Ms"),
    meanMs: positive(record, "meanMs", label),
    result,
    threeRevision: text(record, "threeRevision", label),
    triangles: optionalNumber(stats, "triangles"),
    variant: text(record, "variant", label),
  };
}

/** Greater than one means the candidate arm completed the shared workload in less time. */
export function compareMeshRuns(
  baseline: unknown,
  candidate: unknown,
  paths: { baseline: string; candidate: string } = { baseline: "", candidate: "" },
): IMeshComparison {
  const left = summarize(baseline, "the baseline arm", paths.baseline);
  const right = summarize(candidate, "the candidate arm", paths.candidate);
  if (left.arm === right.arm)
    throw new BenchError("TN_BENCH_MESH_SAME_ARM", `both sides reported ${left.arm}`);
  if (left.count !== right.count || left.variant !== right.variant)
    throw new BenchError(
      "TN_BENCH_MESH_NOT_COMPARABLE",
      `compared ${left.arm}@${left.count}/${left.variant} against ${right.arm}@${right.count}/${right.variant}`,
    );
  if (left.fixtureHash !== right.fixtureHash)
    throw new BenchError(
      "TN_BENCH_MESH_FIXTURE_MISMATCH",
      `${left.fixtureHash} against ${right.fixtureHash}`,
    );
  if (left.threeRevision !== right.threeRevision)
    throw new BenchError(
      "TN_BENCH_MESH_THREE_MISMATCH",
      `three r${left.threeRevision} against r${right.threeRevision}`,
    );
  if (
    left.adapter.vendor !== right.adapter.vendor ||
    left.adapter.architecture !== right.adapter.architecture
  )
    throw new BenchError(
      "TN_BENCH_MESH_ADAPTER_MISMATCH",
      `${left.adapter.vendor}/${left.adapter.architecture} against ${right.adapter.vendor}/${right.adapter.architecture}`,
    );
  const { adapter: _left, fixtureHash, threeRevision, ...leftArm } = left;
  const { adapter: _right, ...rightArm } = right;
  return {
    adapter: left.adapter,
    arms: { baseline: leftArm, candidate: rightArm },
    blocks: 1,
    count: positive(baseline, "count", "the baseline arm"),
    fixtureHash,
    meanRatioBaselineOverCandidate: left.meanMs / right.meanMs,
    profile: "smoke",
    qualifications: [...QUALIFICATIONS],
    threeRevision,
    variant: left.variant,
  };
}

export async function readMeshRun(file: string): Promise<unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new BenchError(
      "TN_BENCH_MESH_RUN_UNREADABLE",
      `${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parsed;
}
