import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { Page } from "playwright";

import {
  PLAYTEST_PROTOCOL_LIMITS,
  PLAYTEST_PROTOCOL_VERSION,
  PlaytestScenarioError,
  loadPlaytestScenario,
} from "../src/index.js";
import { connectPlaytestBridge, PlaytestBridgeError } from "../src/runner/bridgeClient.js";

// CHARTER.md §8. A wrong-typed assertion value used to be dropped on the floor:
// the validator returned undefined and the caller filtered it out. The scenario
// then ran with zero assertions of that kind and reported green. A harness that
// silently asserts nothing is worse than no harness, because it is trusted.
//
// These tests were observed RED against the pre-fix parser: loadPlaytestScenario
// resolved instead of throwing for the first three.

async function writeScenario(assert: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "playtest-silent-drop-"));
  await writeFile(
    join(directory, "scenario.json"),
    JSON.stringify({
      assert,
      name: "silent-drop",
      schemaVersion: 1,
      steps: [{ release: true, waitFrames: 1 }],
    }),
  );
  return directory;
}

async function loadError(assert: unknown): Promise<unknown> {
  const directory = await writeScenario(assert);
  try {
    await loadPlaytestScenario(directory, "scenario.json");
  } catch (error) {
    return error;
  }
  return undefined;
}

function fakePage(capabilities: readonly string[]): Page {
  return {
    evaluate: async (_callback: unknown, input: { method: string }) => {
      if (input.method === "describe") {
        return { capabilities, limits: PLAYTEST_PROTOCOL_LIMITS, name: "test-bridge", protocolVersion: PLAYTEST_PROTOCOL_VERSION };
      }
      if (input.method === "ready") return { ready: true };
      throw new Error(`Unexpected bridge call '${input.method}'.`);
    },
    waitForFunction: async () => undefined,
  } as unknown as Page;
}

test("rejects a whole assertion whose required value is wrong-typed", async () => {
  // `equals` must be a string. As a boolean the entry was silently discarded and
  // `assert.states` became [], so the scenario proved nothing about the player.
  const error = await loadError({ states: [{ entity: "player", equals: true }] });

  expect(error).toBeInstanceOf(PlaytestScenarioError);
  expect((error as PlaytestScenarioError).diagnostic.code).toBe("TN_PLAYTEST_SCENARIO_INVALID");
  expect((error as PlaytestScenarioError).diagnostic.message).toMatch(/states\[0\]\.equals/u);
});

test("rejects an empty entity reference rather than asserting nothing about it", async () => {
  const error = await loadError({ states: [{ entity: "", equals: "alive" }] });

  expect(error).toBeInstanceOf(PlaytestScenarioError);
  expect((error as PlaytestScenarioError).diagnostic.message).toMatch(/states\[0\]\.entity/u);
});

test("rejects an optional key that is present but wrong-typed", async () => {
  // The per-key variant, which §8 never counted: the assertion object survives
  // and only the malformed key vanishes. Here `tags[0]` kept its `tag` check and
  // silently lost its `count` check.
  const error = await loadError({ tags: [{ tag: "enemy", count: "three" }] });

  expect(error).toBeInstanceOf(PlaytestScenarioError);
  expect((error as PlaytestScenarioError).diagnostic.message).toMatch(/tags\[0\]\.count/u);
});

test("still accepts a valid assertion unchanged", async () => {
  // Positive control. Without this, making every validator throw would satisfy the
  // three tests above while breaking every real scenario.
  const directory = await writeScenario({
    states: [{ entity: "player", equals: "alive" }],
    tags: [{ tag: "enemy", count: 3 }],
  });

  const parsed = await loadPlaytestScenario(directory, "scenario.json");

  expect(parsed.assert?.states).toEqual([{ entity: "player", equals: "alive" }]);
  expect(parsed.assert?.tags).toEqual([{ tag: "enemy", count: 3 }]);
});

test("an absent optional key stays absent rather than throwing", async () => {
  // The other half of the absent-vs-wrong-typed distinction. If optionalX threw on
  // absence too, every scenario that omits an optional key would break.
  //
  // `gte` is now pinned here because a tag assertion carrying neither `count` nor
  // `gte` is rejected at load time — boundless, it passed on a count of zero (see
  // evidence-required.spec.ts). `count` is still the absent optional key under
  // test, so what this case proves is unchanged.
  const directory = await writeScenario({ tags: [{ tag: "enemy", gte: 1 }] });

  const parsed = await loadPlaytestScenario(directory, "scenario.json");

  expect(parsed.assert?.tags).toEqual([{ tag: "enemy", gte: 1 }]);
});

test("rejects a wrong-typed signal name at load instead of coercing it", async () => {
  const error = await loadError({ signals: [{ name: 42 }] });

  expect(error).toBeInstanceOf(PlaytestScenarioError);
  expect((error as PlaytestScenarioError).diagnostic.message).toMatch(/signals\[0\]\.name/u);
});

test("refuses a scenario whose observation this runner cannot produce", async () => {
  const directory = await writeScenario({ movement: { entity: "player", notFacing: { entity: "patrol", minDegrees: 20 } } });
  const scenario = await loadPlaytestScenario(directory, "scenario.json");
  let caught: unknown;
  try {
    await connectPlaytestBridge(fakePage(["entity.observe"]), scenario);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(PlaytestBridgeError);
  const error = caught as PlaytestBridgeError;
  expect(error.diagnostic.code).toBe("TN_PLAYTEST_OBSERVATION_UNAVAILABLE");
  expect(error.diagnostic.path).toBe("effectLog");
  expect(error.diagnostic.message).toContain("movement.notFacing");
  expect(error.diagnostic.message).not.toContain("patrol yaw");
});

test("keeps a supported observation kind connected", async () => {
  const directory = await writeScenario({ resources: [{ id: "GameState", path: "coins", gte: 1 }] });
  const scenario = await loadPlaytestScenario(directory, "scenario.json");

  const client = await connectPlaytestBridge(fakePage(["browser.screenshot", "runtime.resources"]), scenario);

  expect(client?.description.capabilities).toContain("runtime.resources");
});

test("reports a missing component observation as a capability defect", async () => {
  const directory = await writeScenario({ components: [{ component: "health", entity: "player", gte: 1 }] });
  const scenario = await loadPlaytestScenario(directory, "scenario.json");
  let caught: unknown;
  try {
    await connectPlaytestBridge(fakePage(["browser.screenshot"]), scenario);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(PlaytestBridgeError);
  expect((caught as PlaytestBridgeError).diagnostic.code).toBe("TN_PLAYTEST_CAPABILITY_MISSING");
  expect((caught as PlaytestBridgeError).diagnostic.capability).toBe("runtime.components");
});

test("reports a missing signal drain as a capability defect", async () => {
  const directory = await writeScenario({ signals: [{ name: "collected", minCount: 1 }] });
  const scenario = await loadPlaytestScenario(directory, "scenario.json");
  let caught: unknown;
  try {
    await connectPlaytestBridge(fakePage(["browser.screenshot"]), scenario);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(PlaytestBridgeError);
  expect((caught as PlaytestBridgeError).diagnostic.code).toBe("TN_PLAYTEST_CAPABILITY_MISSING");
  expect((caught as PlaytestBridgeError).diagnostic.capability).toBe("runtime.events");
});

test("rejects a bridge advertising an unregistered capability", async () => {
  const directory = await writeScenario({ movement: { entity: "player", minDistance: 0.1 } });
  const scenario = await loadPlaytestScenario(directory, "scenario.json");
  let caught: unknown;
  try {
    await connectPlaytestBridge(fakePage(["entity.observe", "runtime.audio.fake"]), scenario);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(PlaytestBridgeError);
  expect((caught as PlaytestBridgeError).diagnostic.code).toBe("TN_PLAYTEST_BRIDGE_CAPABILITY_UNKNOWN");
  expect((caught as PlaytestBridgeError).diagnostic.capability).toBe("runtime.audio.fake");
});
