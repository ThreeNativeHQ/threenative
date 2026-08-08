import { expect, test } from "vitest";

import { recordToScenario, requireAssertions } from "../src/runner/recording.js";

function recording() {
  return {
    input: [
      { keys: ["KeyW"], tick: 0 },
      { keys: [], tick: 3 },
    ],
    randomState: 123,
    runtime: { agent: "node", core: "0.1.0", rapier: null, step: 1 / 60 },
    seed: 90210,
    ticks: 5,
    version: 1,
  };
}

test("should emit a scenario whose steps reproduce the recorded holds", () => {
  const scenario = recordToScenario(recording());

  expect(scenario.steps).toEqual([
    { holdTicks: 3, press: "KeyW", release: true },
    { release: true, waitTicks: 2 },
  ]);
  expect(scenario.steps.reduce((total, step) => total + (step.holdTicks ?? step.waitTicks ?? 0), 0)).toBe(5);
  expect(Object.keys(scenario.assert ?? {}).length).toBeGreaterThan(0);
});

test("should throw when the recording contains an unknown key", () => {
  expect(() => recordToScenario({ ...recording(), type: "entity" })).toThrow(/Unknown key/u);
});

test("should throw when the emitted scenario would carry zero assertions", () => {
  expect(() => requireAssertions(undefined, "recording.json")).toThrow(/zero assertions/u);
});

test("should be collected by the root runner", () => {
  expect(recordToScenario(recording()).name).toBe("replay");
});
