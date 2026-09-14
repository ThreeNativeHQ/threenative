import assert from "node:assert/strict";
import { test } from "vitest";
import { measureStepCost } from "../../../scripts/lib/step-cost.js";
import { createFlightCostFixture, FLIGHT_COST_WORKLOAD } from "./fixtures/flight-cost.js";

test("FlightModel cost fixture replays the same seed to the same finite state", () => {
  const workload = { ...FLIGHT_COST_WORKLOAD, measuredTicks: 30, population: 4, warmupTicks: 10 };
  let clock = 0;
  const run = () => measureStepCost(workload, () => createFlightCostFixture(workload), () => clock++);
  const first = run();
  const second = run();
  assert.deepEqual(first.finalState, second.finalState);
  assert.equal(first.finalState.length, workload.population);
  assert.equal(first.samplesMs.length, workload.measuredTicks);
  assert.ok(first.finalState.flat().every(Number.isFinite));
  const alternate = { ...workload, seed: workload.seed + 1 };
  assert.notDeepEqual(measureStepCost(alternate, () => createFlightCostFixture(alternate), () => clock++).finalState, first.finalState);
});
