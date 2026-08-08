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

function oracle() {
  return {
    movement: { entity: "player", position: [0, 0, 0], tolerance: 0.001 },
  };
}

test("should emit a scenario whose steps reproduce the recorded holds", () => {
  const scenario = recordToScenario(recording(), "recording.json", oracle());

  expect(scenario.steps).toEqual([
    { holdTicks: 3, press: ["KeyW"], release: false },
    { holdTicks: 2, press: [], release: true },
  ]);
  expect(scenario.steps.reduce((total, step) => total + (step.holdTicks ?? step.waitTicks ?? 0), 0)).toBe(5);
  expect(Object.keys(scenario.assert ?? {}).length).toBeGreaterThan(0);
  expect(scenario.assert?.movement).toEqual({
    entity: "player",
    minDistance: 0.05,
    pathLength: 0.05,
    reachesPositionWithin: { maxDistance: 0.001, position: [0, 0, 0] },
  });
  expect(scenario.assert?.world).toEqual({
    runtime: { agent: "node", core: "0.1.0", randomState: 123, rapier: null, step: 1 / 60 },
    seed: 90210,
  });
});

test("should preserve simultaneous keys as a held-key-set step", () => {
  const scenario = recordToScenario({
    ...recording(),
    input: [
      { keys: ["KeyW", "KeyD"], tick: 0 },
      { keys: [], tick: 2 },
    ],
    ticks: 3,
  }, "recording.json", oracle());

  expect(scenario.steps).toEqual([
    { holdTicks: 2, press: ["KeyW", "KeyD"], release: false },
    { holdTicks: 1, press: [], release: true },
  ]);
});

test("should preserve pointer position and button transitions", () => {
  const scenario = recordToScenario({
    ...recording(),
    input: [
      { keys: [], pointer: [640, 360, 1, 1280, 720], tick: 0 },
      { keys: [], pointer: [640, 360, 0, 1280, 720], tick: 2 },
    ],
    ticks: 3,
  }, "recording.json", oracle());

  expect(scenario.steps).toEqual([
    { holdTicks: 2, pointerPosition: { buttons: 1, x: 0.5, y: 0.5 }, press: [], release: false },
    { holdTicks: 1, pointerPosition: { buttons: 0, x: 0.5, y: 0.5 }, press: [], release: true },
  ]);
});

test("should normalize pointer coordinates against the recording viewport", () => {
  const scenario = recordToScenario({
    ...recording(),
    input: [
      { keys: [], pointer: [960, 540, 1, 1920, 1080], tick: 0 },
      { keys: [], pointer: [960, 540, 0, 1920, 1080], tick: 2 },
    ],
  }, "recording.json", oracle());

  expect(scenario.steps[0]).toMatchObject({
    pointerPosition: { buttons: 1, x: 0.5, y: 0.5 },
  });
});

test("should throw when the recording contains an unknown key", () => {
  expect(() => recordToScenario({ ...recording(), type: "entity" }, "recording.json", oracle())).toThrow(/Unknown key/u);
});

test("should throw when the emitted scenario would carry zero assertions", () => {
  expect(() => requireAssertions(undefined, "recording.json")).toThrow(/zero assertions/u);
});

test("should throw when the recording contains no behavior to assert", () => {
  expect(() => recordToScenario({ ...recording(), input: [{ keys: [], tick: 0 }] }, "recording.json", oracle())).toThrow(
    /meaningful behavior assertions/u,
  );
});

test("should require a final-position oracle for regression scenarios", () => {
  expect(() => recordToScenario(recording())).toThrow(/final-position oracle/u);
});

test("should reject unknown oracle keys", () => {
  expect(() =>
    recordToScenario(
      recording(),
      "recording.json",
      { ...oracle(), metadata: "not a movement oracle" },
    ),
  ).toThrow(/Unknown key/u);
});

test("should be collected by the root runner", () => {
  expect(recordToScenario(recording(), "recording.json", oracle()).name).toBe("replay");
});
