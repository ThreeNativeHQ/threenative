import { makeTempDir } from "../../../test-support/temp-dir.js";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  PLAYTEST_ASSERTION_REGISTRY,
  PLAYTEST_CAPABILITY_REGISTRY,
  PlaytestScenarioError,
  loadPlaytestScenario,
  requiredPlaytestCapabilities,
} from "./index.js";
import { PLAYTEST_SETUP_REGISTRY } from "./assertions.js";

test("schema version 1 parser preserves a valid semantic scenario", async () => {
  const directory = await makeTempDir("playtest-core-");
  const scenario = {
    artifacts: { screenshots: "before-after" },
    assert: {
      camera: { follows: "player", targetInViewport: true },
      movement: { entity: "player", minDistance: 0.5 },
    },
    name: "standalone-movement",
    schemaVersion: 1,
    setup: { entities: [{ entity: "player", position: [0, 0, 0] }] },
    steps: [{ holdTicks: 5, press: "KeyW", release: true }],
    subject: "player",
    target: "web",
    viewport: { height: 720, width: 1280 },
    warmupFrames: 2,
  };
  await writeFile(join(directory, "scenario.json"), JSON.stringify(scenario));

  const parsed = await loadPlaytestScenario(directory, "scenario.json");

  assert.deepEqual({ ...parsed, sourcePath: undefined }, { ...scenario, inputDelivery: "deterministic", sourcePath: undefined });
});

test("schema version 1 parser keeps stable diagnostics", async () => {
  const directory = await makeTempDir("playtest-core-");
  await writeFile(join(directory, "scenario.json"), JSON.stringify({
    name: "invalid",
    schemaVersion: 2,
    steps: [],
  }));

  await assert.rejects(
    loadPlaytestScenario(directory, "scenario.json"),
    (error: unknown) => {
      assert.ok(error instanceof PlaytestScenarioError);
      assert.equal(error.diagnostic.code, "TN_PLAYTEST_SCENARIO_INVALID");
      assert.equal(error.diagnostic.severity, "error");
      assert.match(error.diagnostic.message, /schemaVersion must be 1/);
      return true;
    },
  );
});

test("scenario loading rejects unknown assertion kinds instead of ignoring them", async () => {
  const directory = await makeTempDir("playtest-core-");
  await writeFile(join(directory, "scenario.json"), JSON.stringify({
    assert: { unknownKind: [] },
    name: "unknown-assertion",
    schemaVersion: 1,
    steps: [{ release: true, waitTicks: 1 }],
  }));

  await assert.rejects(
    loadPlaytestScenario(directory, "scenario.json"),
    (error: unknown) => {
      assert.ok(error instanceof PlaytestScenarioError);
      assert.equal(error.diagnostic.code, "TN_PLAYTEST_SCENARIO_INVALID");
      assert.match(error.diagnostic.message, /Unknown key 'unknownKind'/u);
      return true;
    },
  );
});

test("every assertion and setup operation owns known capability metadata", () => {
  const known = new Set(PLAYTEST_CAPABILITY_REGISTRY.map(({ name }) => name));
  for (const entry of [...PLAYTEST_ASSERTION_REGISTRY, ...PLAYTEST_SETUP_REGISTRY]) {
    assert.ok(entry.requiredCapabilities.length > 0, `${entry.kind} has no capability metadata`);
    entry.requiredCapabilities.forEach((capability) => assert.ok(known.has(capability), `${entry.kind}: ${capability}`));
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

  assert.deepEqual(required, ["browser.input", "browser.screenshot", "entity.observe", "entity.setup"]);
});
