/** A deterministic CPU fixture, not a renderer benchmark or a profiler. */
export interface IStepCostWorkload {
  readonly dt: number;
  readonly measuredTicks: number;
  readonly population: number;
  readonly seed: number;
  readonly warmupTicks: number;
}

export interface IStepCostFixture<T> {
  step(tick: number, dt: number): void;
  snapshot(): T;
}

export interface IStepCostSummary {
  readonly count: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
}

export interface IStepCostResult<T> {
  readonly finalState: T;
  readonly samplesMs: readonly number[];
  readonly setupMs: number;
  readonly summary: IStepCostSummary;
  readonly warmupMs: number;
  readonly workload: IStepCostWorkload;
}

function validateWorkload(workload: IStepCostWorkload): void {
  if (
    !Number.isSafeInteger(workload.population) ||
    workload.population <= 0 ||
    !Number.isSafeInteger(workload.measuredTicks) ||
    workload.measuredTicks <= 0 ||
    !Number.isSafeInteger(workload.warmupTicks) ||
    workload.warmupTicks < 0 ||
    !Number.isSafeInteger(workload.seed) ||
    !Number.isFinite(workload.dt) ||
    workload.dt <= 0 ||
    !Number.isSafeInteger(workload.warmupTicks + workload.measuredTicks)
  ) {
    throw new Error(
      "TN_STEP_COST_WORKLOAD_INVALID: positive population/ticks/dt, integer seed and non-negative warmup are required.",
    );
  }
}

function elapsed(now: () => number, started: number): number {
  const duration = now() - started;
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error(
      "TN_STEP_COST_CLOCK_INVALID: expected a finite monotonic clock in milliseconds.",
    );
  }
  return duration;
}

export function summarizeStepCost(samplesMs: readonly number[]): IStepCostSummary {
  if (
    samplesMs.length === 0 ||
    samplesMs.some((sample) => !Number.isFinite(sample) || sample <= 0)
  ) {
    throw new Error(
      "TN_STEP_COST_SAMPLES_INVALID: every measured tick needs a finite positive duration.",
    );
  }
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const count = sorted.length;
  const maxMs = sorted[count - 1];
  const p50Ms = sorted[Math.ceil(count * 0.5) - 1];
  const p95Ms = sorted[Math.ceil(count * 0.95) - 1];
  const meanMs = samplesMs.reduce((sum, sample) => sum + sample / count, 0);
  if (
    maxMs === undefined ||
    p50Ms === undefined ||
    p95Ms === undefined ||
    !Number.isFinite(meanMs) ||
    meanMs <= 0
  ) {
    throw new Error("TN_STEP_COST_SAMPLES_INVALID: the observed distribution is not measurable.");
  }
  return { count, maxMs, meanMs, p50Ms, p95Ms };
}

/** Set up once, advance the same fixed ticks, and time only the population step itself. */
export function measureStepCost<T>(
  workload: IStepCostWorkload,
  setup: () => IStepCostFixture<T>,
  now: () => number = () => performance.now(),
): IStepCostResult<T> {
  validateWorkload(workload);
  // Freeze our copy: a setup callback must not silently change the declared workload.
  const fixed = Object.freeze({ ...workload });
  const samples = new Float64Array(fixed.measuredTicks);
  const setupStarted = now();
  const fixture = setup();
  const setupMs = elapsed(now, setupStarted);
  const warmupStarted = now();
  for (let tick = 0; tick < fixed.warmupTicks; tick += 1) fixture.step(tick, fixed.dt);
  const warmupMs = elapsed(now, warmupStarted);
  for (let tick = 0; tick < fixed.measuredTicks; tick += 1) {
    const started = now();
    fixture.step(fixed.warmupTicks + tick, fixed.dt);
    samples[tick] = elapsed(now, started);
  }
  // Array growth, sorting and state inspection are outside the timed interval.
  const samplesMs = Array.from(samples);
  return {
    finalState: fixture.snapshot(),
    samplesMs,
    setupMs,
    summary: summarizeStepCost(samplesMs),
    warmupMs,
    workload: fixed,
  };
}

export function evaluateStepCost(
  samplesMs: readonly number[],
  budget: { readonly maxMeanMs?: number; readonly maxP95Ms?: number },
): { readonly pass: boolean; readonly summary: IStepCostSummary } {
  const limits = [budget.maxMeanMs, budget.maxP95Ms];
  if (
    limits.every((limit) => limit === undefined) ||
    limits.some((limit) => limit !== undefined && (!Number.isFinite(limit) || limit <= 0))
  ) {
    throw new Error("TN_STEP_COST_BUDGET_INVALID: declare at least one finite positive bound.");
  }
  const summary = summarizeStepCost(samplesMs);
  return {
    pass:
      (budget.maxMeanMs === undefined || summary.meanMs <= budget.maxMeanMs) &&
      (budget.maxP95Ms === undefined || summary.p95Ms <= budget.maxP95Ms),
    summary,
  };
}
