import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { PlaytestScenarioError, loadPlaytestScenario } from "../src/index.js";

// DESIGN.md §8. A wrong-typed assertion value used to be dropped on the floor:
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
