import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { evaluateRichPlaytestAssertions, loadPlaytestScenario, type IPlaytestObservations } from "../src/index.js";

// Assertions that used to pass on an empty evidence channel.
//
// The runner is the only producer of IPlaytestObservations in this repo, and it
// populates five fields — `console`, `hud` (hardcoded `{}`), `network`,
// `resources`, `runtimeDiagnostics`. `effectLog`, `components`, and the various
// series are never set by any code path today. So "the observation is missing" is
// not an edge case here; it is the default state of a real run, and every
// assertion that reads one of those channels has to fail closed.
//
// Each test below was observed RED before the fix: the assertion returned
// pass:true against observations that contained nothing at all.

const EMPTY_OBSERVATIONS: IPlaytestObservations = {
  console: [],
  hud: {},
  network: [],
  resources: {},
};

async function evaluate(assert: unknown, report: Partial<Parameters<typeof evaluateRichPlaytestAssertions>[0]["report"]> = {}) {
  const projectPath = await mkdtemp(join(tmpdir(), "playtest-evidence-"));
  await writeFile(
    join(projectPath, "scenario.json"),
    JSON.stringify({
      assert,
      name: "evidence",
      schemaVersion: 1,
      steps: [{ release: true, waitFrames: 1 }],
      subject: "player",
    }),
  );
  const scenario = await loadPlaytestScenario(projectPath, "scenario.json");
  return evaluateRichPlaytestAssertions({
    report: {
      diagnostics: [],
      distance: 0,
      entity: "player",
      expectMoved: false,
      frames: 1,
      observations: EMPTY_OBSERVATIONS,
      ...report,
    },
    scenario,
  });
}

test("'changed: false' fails when the value was never observed at all", async () => {
  // jsonEqual(undefined, undefined) is true, because JSON.stringify(undefined) is
  // undefined on both sides. A HUD node that does not exist therefore satisfied
  // "this value did not change" — and `observations.hud` is always `{}`, so every
  // hud changed:false assertion in existence was green.
  const evaluated = await evaluate({ hud: [{ id: "score-label", changed: false }] });

  expect(evaluated.assertions.find(({ id }) => id === "hud.score-label")?.pass).toBe(false);
});

test("'changed: false' still passes for a value that exists and held steady", async () => {
  // Positive control for the guard above: failing closed must not mean failing
  // always. A held invariant is the entire point of changed:false.
  const evaluated = await evaluate(
    { resources: [{ id: "GameState", path: "lives", changed: false }] },
    { observations: { ...EMPTY_OBSERVATIONS, resources: { GameState: { before: { lives: 3 }, after: { lives: 3 } } } } },
  );

  expect(evaluated.assertions.find(({ id }) => id === "resource.GameState.lives")?.pass).toBe(true);
});

test("'changed: false' fails when the value did change", async () => {
  const evaluated = await evaluate(
    { resources: [{ id: "GameState", path: "lives", changed: false }] },
    { observations: { ...EMPTY_OBSERVATIONS, resources: { GameState: { before: { lives: 3 }, after: { lives: 2 } } } } },
  );

  expect(evaluated.assertions.find(({ id }) => id === "resource.GameState.lives")?.pass).toBe(false);
});

test("movement.maxDistance fails when the entity was never observed", async () => {
  // `distance` defaults to 0 when the entity is absent from the snapshot, so the
  // blocked-movement proof — the one assertion whose purpose is to show something
  // did NOT move — was satisfied by observing nothing. A typo in the entity id
  // was enough to make it green.
  const evaluated = await evaluate({ movement: { entity: "ghost", maxDistance: 0.2 } });

  expect(evaluated.assertions.find(({ id }) => id === "movement.maxDistance")?.pass).toBe(false);
});

test("movement.maxDistance still passes for an entity that was observed and stayed put", async () => {
  const evaluated = await evaluate(
    { movement: { entity: "player", maxDistance: 0.2 } },
    {
      after: { frame: 1, position: [0, 0, 0.05], tick: 1 },
      before: { frame: 0, position: [0, 0, 0], tick: 0 },
      distance: 0.05,
    },
  );

  expect(evaluated.assertions.find(({ id }) => id === "movement.maxDistance")?.pass).toBe(true);
});

test("movement.maxDistance still fails for an entity that moved too far", async () => {
  const evaluated = await evaluate(
    { movement: { entity: "player", maxDistance: 0.2 } },
    {
      after: { frame: 1, position: [0, 0, 5], tick: 1 },
      before: { frame: 0, position: [0, 0, 0], tick: 0 },
      distance: 5,
    },
  );

  expect(evaluated.assertions.find(({ id }) => id === "movement.maxDistance")?.pass).toBe(false);
});

test("movement.reachesPositionWithin considers the final observed position", async () => {
  const evaluated = await evaluate(
    { movement: { entity: "player", reachesPositionWithin: { maxDistance: 0.25, position: [9, 0, 0] } } },
    {
      after: { frame: 1, position: [8.9, 0, 0], tick: 1 },
      before: { frame: 0, position: [0, 0, 0], tick: 0 },
      effectLog: { entries: [{ kind: "service", payload: { result: { entity: "player", resolved: [0, 0, 0] } }, service: "character.move" }] },
    },
  );

  expect(evaluated.assertions.find(({ id }) => id === "movement.reachesPosition")?.pass).toBe(true);
});

test("an animation assertion requires matching evidence rather than defaulting to satisfied", async () => {
  // `minCount` was 0 unless `entered` or `advancedFrames` was set, so a bare
  // { entity, clip } assertion evaluated `0 >= 0` and passed with no effect log.
  const evaluated = await evaluate({ animation: [{ entity: "player", clip: "run" }] });

  expect(evaluated.assertions.find(({ id }) => id === "animation.player")?.pass).toBe(false);
  expect(evaluated.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_ANIMATION_NOT_OBSERVED");
});

test("advancedFrames requires that many matching entries, not merely one", async () => {
  const effectLog = {
    entries: [{ entity: "player", service: "animation.play", value: { clip: "run" } }],
  };

  const evaluated = await evaluate({ animation: [{ entity: "player", clip: "run", advancedFrames: 5 }] }, { effectLog });

  expect(evaluated.assertions.find(({ id }) => id === "animation.player")?.pass).toBe(false);
});

test("an animation assertion passes once its evidence is present", async () => {
  const effectLog = {
    entries: Array.from({ length: 5 }, () => ({ entity: "player", service: "animation.play", value: { clip: "run" } })),
  };

  const evaluated = await evaluate({ animation: [{ entity: "player", clip: "run", advancedFrames: 5 }] }, { effectLog });

  expect(evaluated.assertions.find(({ id }) => id === "animation.player")?.pass).toBe(true);
});

test("an animation assertion reads the runtime animation channel", async () => {
  const evaluated = await evaluate(
    { animation: [{ entity: "player", clip: "run", advancedFrames: 5 }] },
    {
      observations: {
        ...EMPTY_OBSERVATIONS,
        runtimeObservations: {
          gameplay: { animation: { player: { advancedFrames: 8, clip: "run" } }, states: {} },
        },
      } as IPlaytestObservations,
    },
  );

  expect(evaluated.assertions.find(({ id }) => id === "animation.player")?.pass).toBe(true);
});

test("a tag assertion must declare a count or a floor to be worth running", async () => {
  // `tags: [{ tag: "coin" }]` degenerated to "a numeric count exists", so it
  // passed on a count of zero — the exact opposite of what the author meant.
  const directory = await mkdtemp(join(tmpdir(), "playtest-evidence-tag-"));
  await writeFile(
    join(directory, "scenario.json"),
    JSON.stringify({
      assert: { tags: [{ tag: "coin" }] },
      name: "evidence",
      schemaVersion: 1,
      steps: [{ release: true, waitFrames: 1 }],
    }),
  );

  await expect(loadPlaytestScenario(directory, "scenario.json")).rejects.toThrow(/count.*gte|gte.*count/u);
});

test("a tag assertion with a floor still evaluates normally", async () => {
  const evaluated = await evaluate(
    { tags: [{ tag: "coin", gte: 3 }] },
    {
      observations: {
        ...EMPTY_OBSERVATIONS,
        runtimeObservations: { gameplay: { tags: { coin: { count: 4 } } } },
      } as IPlaytestObservations,
    },
  );

  expect(evaluated.assertions.find(({ id }) => id === "tags.coin")?.pass).toBe(true);
});

test("a contact assertion reads the runtime contact channel", async () => {
  const evaluated = await evaluate(
    { contacts: [{ entity: "fox", with: "coin.3", kind: "trigger", minCount: 1 }] },
    {
      observations: {
        ...EMPTY_OBSERVATIONS,
        runtimeObservations: {
          gameplay: {
            animation: {},
            contacts: [{ entity: "fox", kind: "trigger", with: "coin.3" }],
            states: {},
          },
        },
      } as IPlaytestObservations,
    },
  );

  expect(evaluated.assertions.find(({ id }) => id === "contact.fox")?.pass).toBe(true);
});
