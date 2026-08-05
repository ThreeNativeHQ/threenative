import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";

import {
  PLAYTEST_ASSERTION_REGISTRY,
  PLAYTEST_CAPABILITY_REGISTRY,
  PLAYTEST_SETUP_REGISTRY,
  PlaytestScenarioError,
  loadPlaytestScenario,
  requiredPlaytestCapabilities,
} from "../src/index.js";

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
