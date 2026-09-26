import { type IPlannedCell, buildDraftPlan } from "./plan.js";
import type { IRawTimingSummary } from "./raw-series.js";
import type { IV2RunRecord } from "./report-v2.js";
import { BenchError } from "./report.js";
import { type IPairedResult, analysePairedBlocks, pairCompletedWork } from "./stats.js";

export type ArmCoverageStatus =
  | "valid"
  | "qualified"
  | "invalid"
  | "failed"
  | "unsupported"
  | "not-run";

export interface IArmCoverage {
  attempts: number;
  id: string;
  reasons: string[];
  runIds: string[];
  status: ArmCoverageStatus;
}

export interface ICampaignRow {
  arms: IArmCoverage[];
  cell: IPlannedCell;
  comparisons: {
    comparability: "matched-task" | "qualified" | "non-comparable";
    left: string;
    reason: string | null;
    right: string;
    statistics: IPairedResult | null;
  }[];
}

export interface ICampaignDataset {
  coverage: {
    planned: number;
    attempted: number;
    valid: number;
    qualified: number;
    invalid: number;
    failed: number;
    unsupported: number;
    notRun: number;
  };
  partial: boolean;
  planStatus: "draft" | "frozen";
  publicationGaps: string[];
  publicationMachine: {
    cpu: string;
    date: string;
    driver: string;
    gpu: string;
    id: string;
    os: string;
  } | null;
  rawTiming: Record<string, IRawTimingSummary>;
  rows: ICampaignRow[];
  runs: IV2RunRecord[];
}

function fail(message: string): never {
  throw new BenchError("TN_BENCH_BAD_CAMPAIGN", message);
}

export function experimentKey(experiment: IV2RunRecord["experiment"]): string {
  return JSON.stringify([
    experiment.workload,
    experiment.fixtureRevision,
    experiment.variant,
    experiment.load,
    experiment.renderingProfile,
    experiment.optimizationClass,
    experiment.protocol,
  ]);
}

function matrixKey(experiment: IV2RunRecord["experiment"]): string {
  return JSON.stringify([
    experiment.workload,
    experiment.variant,
    experiment.load,
    experiment.renderingProfile,
    experiment.optimizationClass,
    experiment.protocol,
  ]);
}

function armCoverage(
  cell: IPlannedCell,
  id: string,
  records: readonly IV2RunRecord[],
): IArmCoverage {
  const runIds = records.map((record) => record.runId);
  if (records.length === 0)
    return { attempts: 0, id, reasons: ["not run"], runIds, status: "not-run" };
  const attempts = records.length;
  const base = { attempts, id, runIds };
  if (
    records.some((record) =>
      ["crashed", "timed-out", "resource-limited"].includes(record.outcome.runStatus),
    )
  ) {
    return { ...base, reasons: ["a required attempt failed"], status: "failed" };
  }
  if (records.every((record) => record.outcome.runStatus === "unsupported")) {
    return { ...base, reasons: ["capability unsupported"], status: "unsupported" };
  }
  if (
    records.some(
      (record) => record.outcome.runStatus !== "valid" || record.comparability === "non-comparable",
    )
  ) {
    return { ...base, reasons: ["invalid or non-comparable attempt"], status: "invalid" };
  }
  if (
    records.some(
      (record) =>
        record.machine.lane !== "physical-hardware" || record.arm.build.type !== "release",
    )
  ) {
    return {
      ...base,
      reasons: ["publication requires physical hardware and release builds"],
      status: "invalid",
    };
  }
  const planned = new Set(cell.plannedBlocks.map(({ session, block }) => `${session}:${block}`));
  const observed = new Set(records.map(({ session, block }) => `${session}:${block}`));
  if (
    records.length !== planned.size ||
    observed.size !== planned.size ||
    [...observed].some((key) => !planned.has(key))
  ) {
    return { ...base, reasons: ["missing, duplicate or unplanned block"], status: "invalid" };
  }
  return {
    ...base,
    reasons: [],
    status: records.some((record) => record.comparability === "qualified") ? "qualified" : "valid",
  };
}

function comparisonPairs(arms: readonly string[]): [string, string][] {
  const pairs: [string, string][] = [];
  if (arms.includes("tn-web") && arms.includes("plain-three-web"))
    pairs.push(["tn-web", "plain-three-web"]);
  if (arms.includes("tn-web") && arms.includes("tn-desktop")) pairs.push(["tn-web", "tn-desktop"]);
  for (const competitor of ["bevy-desktop", "godot-desktop"]) {
    if (arms.includes("tn-desktop") && arms.includes(competitor))
      pairs.push(["tn-desktop", competitor]);
  }
  return pairs;
}

/** One canonical dataset for HTML, JSON and CSV; absent cells stay present. */
export function deriveCampaign(
  plan: { status: "draft" | "frozen"; cells: readonly IPlannedCell[] },
  records: readonly IV2RunRecord[],
  options: {
    epsilonByCellId: Readonly<Record<string, number>>;
    seed: number;
    publicationGaps?: readonly string[];
    publicationMachine?: ICampaignDataset["publicationMachine"];
    rawTiming?: Readonly<Record<string, IRawTimingSummary>>;
  },
): ICampaignDataset {
  if (plan.cells.length === 0) fail("campaign plan has no cells");
  if (plan.status === "frozen") {
    const actual = new Map(plan.cells.map((cell) => [cell.id, cell]));
    for (const required of buildDraftPlan().cells) {
      const cell = actual.get(required.id);
      if (cell === undefined) fail(`frozen plan omitted required cell ${required.id}`);
      if (
        cell.family !== required.family ||
        matrixKey(cell.experiment) !== matrixKey(required.experiment)
      ) {
        fail(`frozen plan changed required experiment ${required.id}`);
      }
      for (const arm of required.arms) {
        if (!cell.arms.includes(arm))
          fail(`frozen plan omitted required arm ${arm} in ${required.id}`);
      }
      if (Object.values(cell.upstreamActual).some((count) => count === null)) {
        fail(`frozen plan has unresolved actual census in ${required.id}`);
      }
    }
  }
  const cellByKey = new Map<string, IPlannedCell>();
  const ids = new Set<string>();
  for (const cell of plan.cells) {
    if (ids.has(cell.id)) fail(`duplicate planned cell ${cell.id}`);
    ids.add(cell.id);
    const key = experimentKey(cell.experiment);
    if (cellByKey.has(key)) fail(`duplicate experiment key for ${cell.id}`);
    cellByKey.set(key, cell);
    if (cell.arms.length < 2 || new Set(cell.arms).size !== cell.arms.length) {
      fail(`${cell.id} needs distinct comparison arms`);
    }
    if (
      cell.plannedBlocks.length === 0 ||
      new Set(cell.plannedBlocks.map(({ session, block }) => `${session}:${block}`)).size !==
        cell.plannedBlocks.length
    ) {
      fail(`${cell.id} needs distinct planned blocks`);
    }
  }
  const grouped = new Map<string, IV2RunRecord[]>();
  const seenRuns = new Set<string>();
  const campaign = records[0];
  for (const record of records) {
    if (
      campaign !== undefined &&
      (record.campaignId !== campaign.campaignId ||
        record.campaignHash !== campaign.campaignHash ||
        record.planHash !== campaign.planHash ||
        record.machine.id !== campaign.machine.id ||
        record.machine.gpu !== campaign.machine.gpu ||
        record.machine.os !== campaign.machine.os)
    ) {
      fail(`run ${record.runId} changed campaign or machine identity`);
    }
    if (seenRuns.has(record.runId)) fail(`reused runId ${record.runId}`);
    seenRuns.add(record.runId);
    const cell = cellByKey.get(experimentKey(record.experiment));
    if (cell === undefined) fail(`run ${record.runId} has an unplanned experiment`);
    if (!cell.arms.includes(record.arm.id))
      fail(`run ${record.runId} has unplanned arm ${record.arm.id}`);
    const key = `${cell.id}:${record.arm.id}`;
    const group = grouped.get(key) ?? [];
    group.push(record);
    grouped.set(key, group);
  }

  const coverage = {
    planned: 0,
    attempted: 0,
    valid: 0,
    qualified: 0,
    invalid: 0,
    failed: 0,
    unsupported: 0,
    notRun: 0,
  };
  const rows = plan.cells.map((cell): ICampaignRow => {
    const arms = cell.arms.map((id) => {
      const outcome = armCoverage(cell, id, grouped.get(`${cell.id}:${id}`) ?? []);
      coverage.planned++;
      if (outcome.attempts > 0) coverage.attempted++;
      if (outcome.status === "not-run") coverage.notRun++;
      else coverage[outcome.status]++;
      return outcome;
    });
    const comparisons = comparisonPairs(cell.arms).map(([left, right]) => {
      const leftOutcome = arms.find((arm) => arm.id === left) as IArmCoverage;
      const rightOutcome = arms.find((arm) => arm.id === right) as IArmCoverage;
      const eligible = [leftOutcome, rightOutcome].every(
        (arm) => arm.status === "valid" || arm.status === "qualified",
      );
      if (!eligible)
        return {
          left,
          right,
          comparability: "non-comparable" as const,
          reason: "incomplete paired arm coverage",
          statistics: null,
        };
      const comparability =
        leftOutcome.status === "qualified" || rightOutcome.status === "qualified"
          ? ("qualified" as const)
          : ("matched-task" as const);
      try {
        const blocks = pairCompletedWork(
          [
            ...(grouped.get(`${cell.id}:${left}`) ?? []),
            ...(grouped.get(`${cell.id}:${right}`) ?? []),
          ],
          left,
          right,
          cell.plannedBlocks,
        );
        return {
          left,
          right,
          comparability,
          reason: null,
          statistics: analysePairedBlocks(blocks, {
            epsilon: plan.status === "frozen" ? (options.epsilonByCellId[cell.id] ?? null) : null,
            seed: options.seed,
          }),
        };
      } catch (error) {
        return {
          left,
          right,
          comparability: "non-comparable" as const,
          reason: error instanceof Error ? error.message : String(error),
          statistics: null,
        };
      }
    });
    return { arms, cell, comparisons };
  });
  const publicationGaps = [...(options.publicationGaps ?? ["publication metadata unverified"])];
  return {
    coverage,
    partial:
      plan.status !== "frozen" ||
      coverage.valid + coverage.qualified !== coverage.planned ||
      rows.some((row) =>
        row.comparisons.some(
          (comparison) =>
            comparison.statistics === null || comparison.statistics.verdict === "insufficient",
        ),
      ) ||
      publicationGaps.length > 0,
    planStatus: plan.status,
    publicationGaps,
    publicationMachine: options.publicationMachine ?? null,
    rawTiming: { ...options.rawTiming },
    rows,
    runs: [...records].sort((left, right) => left.runId.localeCompare(right.runId)),
  };
}
