import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";

import {
  PLAYTEST_ASSERTION_REGISTRY,
  PLAYTEST_CAPABILITY_REGISTRY,
  PlaytestScenarioError,
  loadPlaytestScenario,
  requiredPlaytestCapabilities,
} from "../src/index.js";
import { PLAYTEST_SETUP_REGISTRY } from "../src/assertions.js";
import type { IPlaytestResourceAssertion } from "../src/scenario.js";

test("schema version 1 parser preserves a valid semantic scenario", async () => {
  const directory = await mkdtemp(join(tmpdir(), "playtest-core-"));
  const scenario = {
    artifacts: { screenshots: "before-after" },
    assert: {
      camera: { follows: "player", targetInViewport: true },
      movement: { entity: "player", minDistance: 0.5 },
    },
    name: "standalone-movement",
    schemaVersion: 1,
    setup: { entities: [{ entity: "player", position: [0, 0, 0] }] },
    steps: [{ holdFrames: 5, press: "KeyW", release: true }],
    subject: "player",
    target: "web",
    viewport: { height: 720, width: 1280 },
    warmupFrames: 2,
  };
  await writeFile(join(directory, "scenario.json"), JSON.stringify(scenario));

  const parsed = await loadPlaytestScenario(directory, "scenario.json");

  expect({ ...parsed, sourcePath: undefined }).toEqual({ ...scenario, inputDelivery: "deterministic", sourcePath: undefined });
});

test("scenario parser preserves complete held-pointer sets in arrival order", async () => {
  const directory = await mkdtemp(join(tmpdir(), "playtest-pointers-"));
  await writeFile(join(directory, "scenario.json"), JSON.stringify({
    assert: { diagnostics: { runtimeReady: true } },
    name: "two-pointers",
    schemaVersion: 1,
    steps: [
      { holdFrames: 2, pointers: [{ id: 7, x: 0.2, y: 0.8 }], release: false },
      {
        holdFrames: 8,
        pointers: [
          { id: 7, x: 0.25, y: 0.8 },
          { buttons: 1, id: 3, x: 0.8, y: 0.8 },
        ],
        release: true,
      },
    ],
  }));

  const parsed = await loadPlaytestScenario(directory, "scenario.json");

  expect(parsed.steps[1]?.pointers?.map(({ id }) => id)).toEqual([7, 3]);
});

test.each([
  ["non-array set", { pointers: {}, waitFrames: 1 }],
  ["duplicate ids", { pointers: [{ id: 1, x: 0.2, y: 0.8 }, { id: 1, x: 0.8, y: 0.8 }] }],
  ["unknown pointer field", { pointers: [{ id: 1, x: 0.2, y: 0.8, zone: "left" }] }],
  ["zero buttons", { pointers: [{ buttons: 0, id: 1, x: 0.2, y: 0.8 }] }],
  ["out-of-range coordinate", { pointers: [{ id: 1, x: 1.1, y: 0.8 }] }],
])("scenario parser rejects malformed multi-pointer input: %s", async (_label, step) => {
  const directory = await mkdtemp(join(tmpdir(), "playtest-pointers-invalid-"));
  await writeFile(join(directory, "scenario.json"), JSON.stringify({
    name: "invalid-pointers",
    schemaVersion: 1,
    steps: [step],
  }));

  await expect(loadPlaytestScenario(directory, "scenario.json")).rejects.toMatchObject({
    diagnostic: { code: expect.stringMatching(/^TN_PLAYTEST_SCENARIO_(?:INVALID|STEP_INVALID)$/u) },
  });
});

test("world assertions preserve and validate a deterministic runtime fingerprint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "playtest-world-runtime-"));
  const scenario = {
    assert: {
      world: {
        runtime: { agent: "browser", core: "0.1.0", randomState: 90210, rapier: null, step: 1 / 60 },
        seed: 90210,
      },
    },
    name: "world-runtime",
    schemaVersion: 1,
    steps: [{ release: true, waitFrames: 1 }],
  };
  await writeFile(join(directory, "scenario.json"), JSON.stringify(scenario));

  const parsed = await loadPlaytestScenario(directory, "scenario.json");

  expect(parsed.assert?.world).toEqual(scenario.assert.world);
});

test("world assertions reject unknown runtime fingerprint keys", async () => {
  const directory = await mkdtemp(join(tmpdir(), "playtest-world-runtime-invalid-"));
  await writeFile(join(directory, "scenario.json"), JSON.stringify({
    assert: { world: { runtime: { agent: "browser", core: "0.1.0", randomState: 1, rapier: null, step: 1 / 60, extra: true }, seed: 1 } },
    name: "invalid-world-runtime",
    schemaVersion: 1,
    steps: [{ release: true, waitFrames: 1 }],
  }));

  await expect(loadPlaytestScenario(directory, "scenario.json")).rejects.toMatchObject({
    diagnostic: { message: expect.stringMatching(/Unknown key 'extra'/u) },
  });
});

test("scenario loading rejects mixed frame and fixed timing", async () => {
  for (const [index, step] of [
    { holdTicks: 5, press: "KeyW", release: true, waitFrames: 5 },
    { holdFrames: 5, press: "KeyW", release: true, waitTicks: 5 },
  ].entries()) {
    const directory = await mkdtemp(join(tmpdir(), `playtest-mixed-timing-${index}-`));
    await writeFile(
      join(directory, "scenario.json"),
      JSON.stringify({ name: "mixed-timing", schemaVersion: 1, steps: [step] }),
    );

    await expect(loadPlaytestScenario(directory, "scenario.json")).rejects.toMatchObject({
      diagnostic: { message: expect.stringMatching(/frame timing or fixed ticks/) },
    });
  }
});

test("scenario loading rejects duplicate step labels", async () => {
  const directory = await mkdtemp(join(tmpdir(), "playtest-duplicate-label-"));
  await writeFile(join(directory, "scenario.json"), JSON.stringify({
    name: "duplicate-label",
    schemaVersion: 1,
    steps: [
      { label: "pickup", release: true, waitFrames: 1 },
      { label: "pickup", release: true, waitFrames: 1 },
    ],
  }));

  await expect(loadPlaytestScenario(directory, "scenario.json")).rejects.toMatchObject({
    diagnostic: { message: expect.stringMatching(/duplicate label 'pickup'/u) },
  });
});

test("scenario loading rejects a wrong-typed step label", async () => {
  const directory = await mkdtemp(join(tmpdir(), "playtest-wrong-label-"));
  await writeFile(join(directory, "scenario.json"), JSON.stringify({
    name: "wrong-label",
    schemaVersion: 1,
    steps: [{ label: 42, release: true, waitFrames: 1 }],
  }));

  await expect(loadPlaytestScenario(directory, "scenario.json")).rejects.toMatchObject({
    diagnostic: { message: expect.stringMatching(/label must be a non-empty string/u) },
  });
});

test("scenario loading rejects an atSteps label that was never sampled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "playtest-missing-label-"));
  await writeFile(join(directory, "scenario.json"), JSON.stringify({
    assert: { resources: [{ atSteps: [{ equals: 1, label: "missing" }], id: "GameState", path: "coins" }] },
    name: "missing-label",
    schemaVersion: 1,
    steps: [{ label: "present", release: true, waitFrames: 1 }],
  }));

  await expect(loadPlaytestScenario(directory, "scenario.json")).rejects.toMatchObject({
    diagnostic: { message: expect.stringMatching(/names step label 'missing'/u) },
  });
});

test("schema version 1 parser keeps stable diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "playtest-core-"));
  await writeFile(join(directory, "scenario.json"), JSON.stringify({
    name: "invalid",
    schemaVersion: 2,
    steps: [],
  }));

  // Faithful translation of node's assert.rejects(promise, validatorFn): assert the
  // promise rejects and that the thrown value satisfies every check in the validator.
  let caught: unknown;
  try {
    await loadPlaytestScenario(directory, "scenario.json");
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PlaytestScenarioError);
  const error = caught as PlaytestScenarioError;
  expect(error.diagnostic.code).toBe("TN_PLAYTEST_SCENARIO_INVALID");
  expect(error.diagnostic.severity).toBe("error");
  expect(error.diagnostic.message).toMatch(/schemaVersion must be 1/);
});

test("scenario loading rejects unknown assertion kinds instead of ignoring them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "playtest-core-"));
  await writeFile(join(directory, "scenario.json"), JSON.stringify({
    assert: { unknownKind: [] },
    name: "unknown-assertion",
    schemaVersion: 1,
    steps: [{ release: true, waitFrames: 1 }],
  }));

  // Faithful translation of node's assert.rejects(promise, validatorFn).
  let caught: unknown;
  try {
    await loadPlaytestScenario(directory, "scenario.json");
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PlaytestScenarioError);
  const error = caught as PlaytestScenarioError;
  expect(error.diagnostic.code).toBe("TN_PLAYTEST_SCENARIO_INVALID");
  expect(error.diagnostic.message).toMatch(/Unknown key 'unknownKind'/u);
});

test("scenario loading preserves a resource anyOf contract", async () => {
  const directory = await mkdtemp(join(tmpdir(), "playtest-resource-anyof-"));
  await writeFile(join(directory, "scenario.json"), JSON.stringify({
    assert: { resources: [{ id: "state", anyOf: [{ path: "jumps", gte: 1, changed: true }, { path: "peakRise", gte: 0.5, changed: true }] }] },
    name: "resource-anyof",
    schemaVersion: 1,
    steps: [{ release: true, waitFrames: 1 }],
  }));

  const parsed = await loadPlaytestScenario(directory, "scenario.json");

  expect(parsed.assert?.resources?.[0]).toEqual({
    id: "state",
    anyOf: [
      { path: "jumps", gte: 1, changed: true },
      { path: "peakRise", gte: 0.5, changed: true },
    ],
  });
});

test("resource assertion types reject mixed anyOf and normal path fields", () => {
  const normal: IPlaytestResourceAssertion = { gte: 1, id: "state", path: "jumps" };
  const alternatives: IPlaytestResourceAssertion = {
    anyOf: [{ gte: 1, path: "jumps" }],
    id: "state",
  };
  // @ts-expect-error anyOf is exclusive with normal path assertion fields.
  const mixed: IPlaytestResourceAssertion = {
    anyOf: [{ gte: 1, path: "jumps" }],
    equals: 1,
    id: "state",
  };
  expect(normal).toMatchObject({ id: "state", path: "jumps" });
  expect(alternatives).toMatchObject({ id: "state", anyOf: expect.any(Array) });
  expect(mixed).toMatchObject({ id: "state" });
});

test.each([
  ["empty", []],
  ["malformed", [{ path: "jumps" }]],
])("scenario loading rejects a %s resource anyOf", async (_label, anyOf) => {
  const directory = await mkdtemp(join(tmpdir(), "playtest-resource-anyof-invalid-"));
  await writeFile(join(directory, "scenario.json"), JSON.stringify({
    assert: { resources: [{ id: "state", anyOf }] },
    name: "invalid-resource-anyof",
    schemaVersion: 1,
    steps: [{ release: true, waitFrames: 1 }],
  }));

  await expect(loadPlaytestScenario(directory, "scenario.json")).rejects.toMatchObject({
    diagnostic: { code: "TN_PLAYTEST_SCENARIO_INVALID" },
  });
});

test("every assertion and setup operation owns known capability metadata", () => {
  const known = new Set(PLAYTEST_CAPABILITY_REGISTRY.map(({ name }) => name));
  for (const entry of [...PLAYTEST_ASSERTION_REGISTRY, ...PLAYTEST_SETUP_REGISTRY]) {
    // `${entry.kind} has no capability metadata`
    expect(entry.requiredCapabilities.length > 0).toBeTruthy();
    // `${entry.kind}: ${capability}`
    entry.requiredCapabilities.forEach((capability) => expect(known.has(capability)).toBeTruthy());
  }
});

test("preflight requirements derive from the registries", () => {
  const required = requiredPlaytestCapabilities({
    assert: { movement: { minDistance: 1 } },
    name: "move",
    schemaVersion: 1,
    setup: { entities: [{ entity: "player", position: [0, 0, 0] }] },
    steps: [{ press: "KeyW", release: true }],
    target: "web",
    viewport: { height: 720, width: 1280 },
    warmupFrames: 0,
  });

  expect(required).toEqual(["browser.input", "browser.screenshot", "entity.observe", "entity.setup"]);
});
