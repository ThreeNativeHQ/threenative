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
    { holdTicks: 3, press: ["KeyW"], release: false },
    { holdTicks: 2, press: [], release: true },
  ]);
  expect(scenario.steps.reduce((total, step) => total + (step.holdTicks ?? step.waitTicks ?? 0), 0)).toBe(5);
  expect(Object.keys(scenario.assert ?? {}).length).toBeGreaterThan(0);
  expect(scenario.assert?.movement).toEqual({ entity: "player", minDistance: 0.05, pathLength: 0.05 });
});

test("should preserve simultaneous keys as a held-key-set step", () => {
  const scenario = recordToScenario({
    ...recording(),
    input: [
      { keys: ["KeyW", "KeyD"], tick: 0 },
      { keys: [], tick: 2 },
    ],
    ticks: 3,
  });

  expect(scenario.steps).toEqual([
    { holdTicks: 2, press: ["KeyW", "KeyD"], release: false },
    { holdTicks: 1, press: [], release: true },
  ]);
});

test("should preserve pointer position and button transitions", () => {
  const scenario = recordToScenario({
    ...recording(),
    input: [
      { keys: [], pointer: [640, 360, 1], tick: 0 },
      { keys: [], pointer: [640, 360, 0], tick: 2 },
    ],
    ticks: 3,
  });

  expect(scenario.steps).toEqual([
    { holdTicks: 2, pointerPosition: { buttons: 1, x: 0.5, y: 0.5 }, press: [], release: false },
    { holdTicks: 1, pointerPosition: { buttons: 0, x: 0.5, y: 0.5 }, press: [], release: true },
  ]);
});

test("should throw when the recording contains an unknown key", () => {
  expect(() => recordToScenario({ ...recording(), type: "entity" })).toThrow(/Unknown key/u);
});

test("should throw when the emitted scenario would carry zero assertions", () => {
  expect(() => requireAssertions(undefined, "recording.json")).toThrow(/zero assertions/u);
});

test("should throw when the recording contains no behavior to assert", () => {
  expect(() => recordToScenario({ ...recording(), input: [{ keys: [], tick: 0 }] })).toThrow(
    /meaningful behavior assertions/u,
  );
});

test("should be collected by the root runner", () => {
  expect(recordToScenario(recording()).name).toBe("replay");
});
