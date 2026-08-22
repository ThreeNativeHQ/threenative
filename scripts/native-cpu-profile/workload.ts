export type DirtyRatio = 0 | 0.1 | 1;
export type Hierarchy = "deep" | "flat";
/**
 * `scene-projection` is PRD-152's shipping implementation and runs the same code `defineGame`
 * ships. The superseded `SceneCollapse` incumbent it was differentially measured against was
 * deleted with the technical-debt audit; the comparison lives in that PRD's archived evidence.
 */
export type RenderMode =
  | "bundled"
  | "bundled-dynamic"
  | "distinct-materials"
  | "independent"
  | "instanced"
  | "merged"
  | "scene-projection";
export type Visibility = "all-visible" | "mostly-culled";
export type Vector3Tuple = readonly [number, number, number];

export type ScenarioPreset = "fox-scale";

export interface IWorkloadConfig {
  readonly dirtyRatio: DirtyRatio;
  readonly hierarchy: Hierarchy;
  readonly objectCount: number;
  readonly passes?: 1 | 2;
  readonly renderMode?: RenderMode;
  readonly seed: number;
  readonly scenario?: ScenarioPreset;
  readonly visibility: Visibility;
}

export interface IObjectTransform {
  readonly position: Vector3Tuple;
  readonly rotation: Vector3Tuple;
  readonly scale: Vector3Tuple;
}

export interface IWorkloadObject {
  readonly id: number;
  readonly parentId: number | null;
  readonly transform: IObjectTransform;
}

export interface IWorkload {
  readonly config: IWorkloadConfig;
  readonly dirtyIds: readonly number[];
  readonly objects: readonly IWorkloadObject[];
}

export interface ISampleSummary {
  readonly count: number;
  readonly mean: number;
  readonly median: number;
  readonly p95: number;
  readonly p99: number;
  readonly stddev: number;
}

export interface IKernelDecision {
  readonly actionable: boolean;
  readonly baselineNoiseRatio: number;
  readonly gainRatio: number;
  readonly synchronizedCandidateMedian: number;
}

const UINT32_MAX = 0xffff_ffff;
const DEEP_CHAIN_LENGTH = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateWorkloadConfig(config: unknown): IWorkloadConfig {
  if (!isRecord(config)) throw new Error("Workload config must be an object.");
  const { dirtyRatio, hierarchy, objectCount, passes, renderMode, scenario, seed, visibility } =
    config;
  if (!Number.isSafeInteger(objectCount) || (objectCount as number) <= 0)
    throw new Error("objectCount must be a positive safe integer.");
  if (hierarchy !== "flat" && hierarchy !== "deep")
    throw new Error("hierarchy must be flat or deep.");
  if (dirtyRatio !== 0 && dirtyRatio !== 0.1 && dirtyRatio !== 1)
    throw new Error("dirtyRatio must be 0, 0.1, or 1.");
  if (visibility !== "all-visible" && visibility !== "mostly-culled")
    throw new Error("visibility must be all-visible or mostly-culled.");
  if (
    renderMode !== undefined &&
    !["independent", "distinct-materials", "instanced", "merged", "scene-projection"].includes(
      renderMode as string,
    )
  )
    throw new Error("renderMode is unsupported.");
  if (passes !== undefined && passes !== 1 && passes !== 2)
    throw new Error("passes must be 1 or 2.");
  if (scenario !== undefined && scenario !== "fox-scale")
    throw new Error("scenario is unsupported.");
  if (!Number.isSafeInteger(seed) || (seed as number) < 0 || (seed as number) > UINT32_MAX)
    throw new Error("seed must be an unsigned 32-bit integer.");
  return {
    dirtyRatio,
    hierarchy,
    objectCount,
    passes,
    renderMode,
    scenario,
    seed,
    visibility,
  } as IWorkloadConfig;
}

export function createFoxScaleWorkloadConfig(seed = 90210): IWorkloadConfig {
  return {
    dirtyRatio: 0.1,
    hierarchy: "flat",
    objectCount: 1_850,
    passes: 1,
    renderMode: "independent",
    scenario: "fox-scale",
    seed,
    visibility: "all-visible",
  };
}

function hash(seed: number, id: number, channel: number): number {
  let value = (seed ^ Math.imul(id + 1, 0x9e37_79b1) ^ Math.imul(channel, 0x85eb_ca6b)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb_352d);
  value = Math.imul(value ^ (value >>> 15), 0x846c_a68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function unit(seed: number, id: number, channel: number): number {
  return hash(seed, id, channel) / (UINT32_MAX + 1);
}

function parentId(id: number, hierarchy: Hierarchy, seed: number): number | null {
  if (hierarchy === "flat" || id % DEEP_CHAIN_LENGTH === 0) return null;
  const offsetInChain = id % DEEP_CHAIN_LENGTH;
  return id - 1 - Math.floor(unit(seed, id, 0) * Math.min(offsetInChain, 4));
}

function transformFor(config: IWorkloadConfig, id: number): IObjectTransform {
  const columns = Math.ceil(Math.sqrt(config.objectCount));
  const column = id % columns;
  const row = Math.floor(id / columns);
  const x = (column - (columns - 1) / 2) * 2 + (unit(config.seed, id, 1) - 0.5) * 0.3;
  const y = (row - (Math.ceil(config.objectCount / columns) - 1) / 2) * 2;
  const culledOffset = config.visibility === "mostly-culled" && id % 10 !== 0 ? 10_000 : 0;
  const scale = 0.75 + unit(config.seed, id, 5) * 0.5;
  return {
    position: [x + culledOffset, y, (unit(config.seed, id, 2) - 0.5) * 8],
    rotation: [unit(config.seed, id, 3) * 0.4, unit(config.seed, id, 4) * Math.PI * 2, 0],
    scale: [scale, scale, scale],
  };
}

export function createWorkload(input: IWorkloadConfig): IWorkload {
  const config = validateWorkloadConfig(input);
  const objects = Array.from(
    { length: config.objectCount },
    (_, id): IWorkloadObject => ({
      id,
      parentId: parentId(id, config.hierarchy, config.seed),
      transform: transformFor(config, id),
    }),
  );
  const dirtyCount = Math.round(config.objectCount * config.dirtyRatio);
  const dirtyIds = objects
    .map(({ id }) => ({ id, rank: hash(config.seed, id, 17) }))
    .sort((left, right) => left.rank - right.rank || left.id - right.id)
    .slice(0, dirtyCount)
    .map(({ id }) => id)
    .sort((left, right) => left - right);
  return { config, dirtyIds, objects };
}

function nearestRank(sorted: readonly number[], fraction: number): number {
  return sorted[Math.ceil(sorted.length * fraction) - 1] as number;
}

export function summarizeSamples(samples: readonly number[]): ISampleSummary {
  if (samples.length === 0 || samples.some((sample) => !Number.isFinite(sample) || sample < 0))
    throw new Error("Timing samples must be non-empty, finite, and non-negative.");
  const sorted = [...samples].sort((left, right) => left - right);
  const mean = sorted.reduce((sum, sample) => sum + sample, 0) / sorted.length;
  const variance = sorted.reduce((sum, sample) => sum + (sample - mean) ** 2, 0) / sorted.length;
  return {
    count: sorted.length,
    mean,
    median: nearestRank(sorted, 0.5),
    p95: nearestRank(sorted, 0.95),
    p99: nearestRank(sorted, 0.99),
    stddev: Math.sqrt(variance),
  };
}

export function evaluateKernelDecision(
  baselineRunMedians: readonly number[],
  candidateRunMedians: readonly number[],
  synchronizationMs: number,
): IKernelDecision {
  if (!Number.isFinite(synchronizationMs) || synchronizationMs < 0)
    throw new Error("Synchronization cost must be finite and non-negative.");
  const baseline = summarizeSamples(baselineRunMedians);
  const candidate = summarizeSamples(candidateRunMedians);
  if (baseline.median === 0) throw new Error("Baseline median must be greater than zero.");
  const synchronizedCandidateMedian = candidate.median + synchronizationMs;
  const gainRatio = (baseline.median - synchronizedCandidateMedian) / baseline.median;
  const baselineNoiseRatio =
    (Math.max(...baselineRunMedians) - Math.min(...baselineRunMedians)) / baseline.median;
  return {
    actionable: gainRatio >= 0.1 && gainRatio > baselineNoiseRatio,
    baselineNoiseRatio,
    gainRatio,
    synchronizedCandidateMedian,
  };
}
