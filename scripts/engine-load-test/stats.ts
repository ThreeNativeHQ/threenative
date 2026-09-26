import { type IV2RunRecord, PRIMARY_METRIC } from "./report-v2.js";
import { BenchError, percentile } from "./report.js";

export interface IPairedBlock {
  block: number;
  competitorMs: number;
  competitorRunId: string;
  session: number;
  tnMs: number;
  tnRunId: string;
}

export interface IPairedResult {
  bootstrapSeed: number;
  ci95: [number, number] | null;
  epsilon: number | null;
  ratio: number;
  resamples: 10000;
  sessionDrift: boolean | null;
  sessions: { session: number; blocks: number; ratio: number }[];
  timeReductionPercent: number;
  validBlocks: number;
  verdict: "faster" | "slower" | "equivalent" | "inconclusive" | "insufficient";
}

function fail(message: string): never {
  throw new BenchError("TN_BENCH_BAD_PAIR", message);
}

function experimentKey(record: IV2RunRecord): string {
  const key = record.experiment;
  return JSON.stringify([
    key.workload,
    key.fixtureRevision,
    key.variant,
    key.load,
    key.renderingProfile,
    key.optimizationClass,
    key.protocol,
  ]);
}

function completedWork(record: IV2RunRecord): number {
  const metrics = record.metrics.filter((metric) => metric.name === PRIMARY_METRIC);
  const value = metrics[0]?.value;
  if (metrics[0]?.unit !== "ms")
    fail(`${record.runId} must report ${PRIMARY_METRIC} in milliseconds`);
  if (metrics.length !== 1 || typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(`${record.runId} has no positive ${PRIMARY_METRIC}`);
  }
  return value;
}

/** Pair by planned session/block, never by measured speed or observed load. */
export function pairCompletedWork(
  records: readonly IV2RunRecord[],
  tnArmId: string,
  competitorArmId: string,
  expectedBlocks: readonly Pick<IPairedBlock, "session" | "block">[],
): IPairedBlock[] {
  if (tnArmId === competitorArmId) fail("comparison arms must differ");
  if (expectedBlocks.length === 0) fail("missing frozen block plan");
  const planned = new Set<string>();
  for (const { session, block } of expectedBlocks) {
    if (!Number.isInteger(session) || session < 1 || !Number.isInteger(block) || block < 1) {
      fail("planned session/block identifiers must be positive integers");
    }
    const blockKey = `${session}:${block}`;
    if (planned.has(blockKey)) fail(`duplicate planned block ${blockKey}`);
    planned.add(blockKey);
  }
  const selected = records.filter(
    (record) => record.arm.id === tnArmId || record.arm.id === competitorArmId,
  );
  if (selected.length === 0) fail("missing paired runs");
  const reference = selected[0] as IV2RunRecord;
  const key = experimentKey(reference);
  const seenRuns = new Set<string>();
  const byBlock = new Map<string, Map<string, IV2RunRecord>>();
  const armIdentity = new Map<string, string>();
  for (const record of selected) {
    if (seenRuns.has(record.runId)) fail(`reused runId ${record.runId}`);
    seenRuns.add(record.runId);
    if (record.outcome.runStatus !== "valid" || record.comparability === "non-comparable") {
      fail(`${record.runId} is not a valid comparable run`);
    }
    if (
      record.campaignId !== reference.campaignId ||
      record.campaignHash !== reference.campaignHash ||
      record.planHash !== reference.planHash ||
      experimentKey(record) !== key ||
      record.fixture.hash !== reference.fixture.hash ||
      record.machine.id !== reference.machine.id ||
      record.machine.gpu !== reference.machine.gpu ||
      record.machine.lane !== reference.machine.lane
    ) {
      fail(`${record.runId} has mismatched campaign, experiment, fixture or machine identity`);
    }
    completedWork(record);
    const identity = JSON.stringify([record.arm, record.sourceHash]);
    const priorIdentity = armIdentity.get(record.arm.id);
    if (priorIdentity !== undefined && priorIdentity !== identity) {
      fail(`${record.arm.id} changed build, flags or source identity between blocks`);
    }
    armIdentity.set(record.arm.id, identity);
    const blockKey = `${record.session}:${record.block}`;
    if (!planned.has(blockKey)) fail(`unplanned block ${blockKey}`);
    const arms = byBlock.get(blockKey) ?? new Map<string, IV2RunRecord>();
    if (arms.has(record.arm.id)) fail(`duplicate ${record.arm.id} run in block ${blockKey}`);
    arms.set(record.arm.id, record);
    byBlock.set(blockKey, arms);
  }
  for (const blockKey of planned) {
    if (!byBlock.has(blockKey)) fail(`missing planned block ${blockKey}`);
  }
  const paired: IPairedBlock[] = [];
  for (const [blockKey, arms] of byBlock) {
    const tn = arms.get(tnArmId);
    const competitor = arms.get(competitorArmId);
    if (tn === undefined || competitor === undefined) fail(`missing arm in block ${blockKey}`);
    if (tn.order === competitor.order) fail(`duplicate execution order in block ${blockKey}`);
    paired.push({
      block: tn.block,
      competitorMs: completedWork(competitor),
      competitorRunId: competitor.runId,
      session: tn.session,
      tnMs: completedWork(tn),
      tnRunId: tn.runId,
    });
  }
  return paired.sort((left, right) => left.block - right.block || left.session - right.session);
}

/** Nearest-rank 95th percentile of absolute A/A relative differences, with a 3% floor. */
export function calibrateEpsilon(pairs: readonly (readonly [number, number])[]): number {
  if (pairs.length < 7) fail("A/A calibration needs at least seven paired blocks");
  const differences = pairs.map(([a, b]) => {
    if (![a, b].every((value) => Number.isFinite(value) && value > 0)) {
      fail("A/A calibration requires positive finite completed-work means");
    }
    const difference = Math.abs(b / a - 1);
    if (!Number.isFinite(difference)) fail("A/A relative difference overflowed");
    return difference;
  });
  return Math.max(0.03, percentile(differences, 0.95));
}

function geometricRatio(blocks: readonly IPairedBlock[]): number {
  if (blocks.length === 0) fail("no paired blocks");
  const logMean =
    blocks.reduce((sum, block) => {
      if (![block.tnMs, block.competitorMs].every((value) => Number.isFinite(value) && value > 0)) {
        fail("paired completed-work means must be positive and finite");
      }
      return sum + Math.log(block.competitorMs) - Math.log(block.tnMs);
    }, 0) / blocks.length;
  const ratio = Math.exp(logMean);
  if (!Number.isFinite(ratio) || ratio <= 0) fail("paired ratio overflowed");
  return ratio;
}

/** Fixed-seed whole-block bootstrap; a frame is never treated as an independent sample. */
export function analysePairedBlocks(
  blocks: readonly IPairedBlock[],
  options: { epsilon: number | null; seed: number },
): IPairedResult {
  const { epsilon, seed } = options;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    fail("bootstrap seed must be a uint32");
  if (epsilon !== null && (!Number.isFinite(epsilon) || epsilon < 0.03)) {
    fail("calibrated epsilon must be finite and at least 3%");
  }
  const ratio = geometricRatio(blocks);
  const bySession = new Map<number, IPairedBlock[]>();
  for (const block of blocks) {
    const group = bySession.get(block.session) ?? [];
    group.push(block);
    bySession.set(block.session, group);
  }
  const sessions = [...bySession]
    .map(([session, group]) => ({
      session,
      blocks: group.length,
      ratio: geometricRatio(group),
    }))
    .sort((a, b) => a.session - b.session);
  const enoughEvidence = blocks.length >= 7 && sessions.length >= 2;
  const sessionDrift =
    epsilon === null || sessions.length < 2
      ? null
      : Math.max(...sessions.map((entry) => Math.log(entry.ratio))) -
          Math.min(...sessions.map((entry) => Math.log(entry.ratio))) >
        Math.log1p(epsilon);
  let ci95: [number, number] | null = null;
  if (enoughEvidence) {
    let state = seed >>> 0;
    const next = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = Math.imul(state ^ (state >>> 15), state | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    const resamples: number[] = [];
    for (let repetition = 0; repetition < 10000; repetition++) {
      const sample: IPairedBlock[] = [];
      for (let index = 0; index < blocks.length; index++) {
        sample.push(blocks[Math.floor(next() * blocks.length)] as IPairedBlock);
      }
      resamples.push(geometricRatio(sample));
    }
    ci95 = [percentile(resamples, 0.025), percentile(resamples, 0.975)];
  }
  let verdict: IPairedResult["verdict"] = "insufficient";
  if (ci95 !== null && epsilon !== null && sessionDrift === false) {
    const lowerBand = 1 / (1 + epsilon);
    const upperBand = 1 + epsilon;
    if (ci95[0] > upperBand) verdict = "faster";
    else if (ci95[1] < lowerBand) verdict = "slower";
    else if (ci95[0] >= lowerBand && ci95[1] <= upperBand) verdict = "equivalent";
    else verdict = "inconclusive";
  }
  return {
    bootstrapSeed: seed,
    ci95,
    epsilon,
    ratio,
    resamples: 10000,
    sessionDrift,
    sessions,
    timeReductionPercent: 100 * (1 - 1 / ratio),
    validBlocks: blocks.length,
    verdict,
  };
}
