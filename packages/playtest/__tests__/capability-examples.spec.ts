import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { invalidScenario, loadPlaytestScenario, PlaytestScenarioError, playtestStepHoldTicks, playtestStepWaitTicks, rejectUnknownKeys } from "../src/index.js";
import { reconcileBrowserPointers, resolveBrowserArguments, softwareAdapterName, WEBGPU_BROWSER_ARGS } from "../src/runner/index.js";

test("the browser capability examples invoke the advertised public operations", () => {
  const args = resolveBrowserArguments(WEBGPU_BROWSER_ARGS);
  assert.ok(args.includes("--enable-features=Vulkan"));
  assert.notEqual(args, WEBGPU_BROWSER_ARGS);
  assert.deepEqual(resolveBrowserArguments(undefined), []);
  assert.equal(softwareAdapterName({ architecture: "swiftshader" }), "swiftshader");
  const changes = reconcileBrowserPointers(new Map(), [{ id: 1, x: 20, y: 30 }]);
  assert.equal(changes[0]?.type, "pointerdown");
  assert.equal(changes[0]?.pointer.id, 1);
});

test("loader and tick examples work through the public entry, not the error factory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tn-capability-example-"));
  try {
    await writeFile(join(directory, "smoke.playtest.json"), JSON.stringify({
      schemaVersion: 1, name: "capability-example", target: "web",
      viewport: { width: 640, height: 480 }, warmupFrames: 0,
      assert: { diagnostics: { runtimeReady: true } },
      steps: [{ kind: "input", press: "KeyW", holdTicks: 30, release: true }, { kind: "wait", waitTicks: 30 }],
    }));
    const scenario = await loadPlaytestScenario(directory, "smoke.playtest.json");
    const hold = scenario.steps[0];
    const wait = scenario.steps[1];
    assert.ok(hold !== undefined && wait !== undefined);
    assert.equal(playtestStepHoldTicks(hold), 30);
    assert.equal(playtestStepWaitTicks(wait), 30);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("error and validation examples do not perform a playtest", () => {
  const error = invalidScenario("smoke.playtest.json", "Expected an assertion");
  assert.ok(error instanceof PlaytestScenarioError);
  assert.equal(error.diagnostic.code, "TN_PLAYTEST_SCENARIO_INVALID");
  rejectUnknownKeys({ name: "smoke" }, ["name"], "smoke.playtest.json", "scenario");
  assert.throws(() => rejectUnknownKeys({ typo: true }, ["name"], "smoke.playtest.json", "scenario"), PlaytestScenarioError);
});
