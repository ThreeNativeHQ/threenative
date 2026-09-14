import assert from "node:assert/strict";
import { test } from "vitest";
import { evaluateStepCost, measureStepCost, summarizeStepCost } from "../lib/step-cost.js";

const workload = { dt: 1 / 60, measuredTicks: 6, population: 4, seed: 42, warmupTicks: 3 };

function clockedFixture(cost: number) {
  let clock = 0;
  let calls = 0;
  const ticks: number[] = [];
  const result = measureStepCost(workload, () => {
    clock += 100;
    return {
      snapshot: () => calls,
      step: (tick: number, dt: number) => {
        assert.equal(dt, workload.dt);
        ticks.push(tick);
        calls += 1;
        clock += cost;
      },
    };
  }, () => clock);
  return { result, ticks };
}

test("setup and warmup do not enter the measured distribution", () => {
  const { result, ticks } = clockedFixture(2);
  assert.equal(result.setupMs, 100);
  assert.equal(result.warmupMs, 6);
  assert.deepEqual(result.samplesMs, [2, 2, 2, 2, 2, 2]);
  assert.equal(result.finalState, 9);
  assert.deepEqual(ticks, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(result.workload, workload);
});

test("the same workload's more expensive implementation trips the budget", () => {
  const baseline = clockedFixture(1).result;
  const candidate = clockedFixture(4).result;
  assert.deepEqual(baseline.workload, candidate.workload);
  assert.equal(baseline.finalState, candidate.finalState);
  assert.equal(evaluateStepCost(baseline.samplesMs, { maxMeanMs: 2, maxP95Ms: 2 }).pass, true);
  assert.equal(evaluateStepCost(candidate.samplesMs, { maxMeanMs: 2, maxP95Ms: 2 }).pass, false);
});

test("percentiles use the complete finite observed series", () => {
  assert.deepEqual(summarizeStepCost([5, 1, 2, 3, 4]), { count: 5, maxMs: 5, meanMs: 3, p50Ms: 3, p95Ms: 5 });
});

for (const samples of [[], [0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY]]) {
  test(`rejects unmeasured or malformed durations: ${JSON.stringify(samples)}`, () => {
    assert.throws(() => summarizeStepCost(samples), /TN_STEP_COST_SAMPLES_INVALID/);
  });
}

for (const patch of [{ population: 0 }, { measuredTicks: 0 }, { warmupTicks: -1 }, { seed: Number.NaN }, { dt: 0 }]) {
  test(`rejects invalid workload ${JSON.stringify(patch)} before setup`, () => {
    let entered = false;
    assert.throws(() => measureStepCost({ ...workload, ...patch }, () => {
      entered = true;
      return { snapshot: () => 0, step: () => undefined };
    }), /TN_STEP_COST_WORKLOAD_INVALID/);
    assert.equal(entered, false);
  });
}

test("an empty or malformed budget is not a passing assertion", () => {
  assert.throws(() => evaluateStepCost([1], {}), /TN_STEP_COST_BUDGET_INVALID/);
  assert.throws(() => evaluateStepCost([1], { maxMeanMs: Number.NaN }), /TN_STEP_COST_BUDGET_INVALID/);
});

test("a changing or backwards clock fails instead of producing negative setup time", () => {
  let clock = 10;
  assert.throws(() => measureStepCost(workload, () => ({
    snapshot: () => 0,
    step: () => undefined,
  }), () => clock--), /TN_STEP_COST_CLOCK_INVALID/);
});
