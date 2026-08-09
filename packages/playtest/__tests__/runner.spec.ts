import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { loadPlaytestScenario, type IPlaytestObservationSnapshot, type IPlaytestScenario } from "../src/index.js";
import type { IStandalonePlaytestConfig } from "../src/runner/config.js";
import { buildReport, STANDALONE_PLAYTEST_OBSERVATION_FIELDS } from "../src/runner/runner.js";
import { playtestStepHoldTicks, playtestStepWaitTicks } from "../src/scenario.js";

const CONFIG: IStandalonePlaytestConfig = {
  artifactDirectory: "artifacts/playtest",
  headless: true,
  projectPath: ".",
  scenarioPath: "playtests/play.playtest.json",
  timeoutMs: 1_000,
  trace: false,
  url: "http://127.0.0.1:5173",
};

function scenario(assert: IPlaytestScenario["assert"]): IPlaytestScenario {
  return {
    ...(assert === undefined ? {} : { assert }),
    name: "runner-proof",
    schemaVersion: 1,
    steps: [{ release: true, waitFrames: 1 }],
    target: "web",
    viewport: { height: 720, width: 1280 },
    warmupFrames: 0,
  };
}

function report(
  currentScenario: IPlaytestScenario,
  hud: Record<string, { after?: unknown; before?: unknown }> = {},
  options: {
    consoleEntries?: Array<{ text: string; type: string }>;
    runtimeReady?: boolean;
  } = {},
) {
  return buildReport(
    CONFIG,
    currentScenario,
    undefined,
    undefined,
    options.consoleEntries ?? [],
    [],
    undefined,
    hud,
    options.runtimeReady,
  );
}

test("runner carries a supplied HUD observation into the evaluated report", () => {
  const result = report(
    scenario({ hud: [{ id: "score", path: "#root", textIncludes: "1" }] }),
    { score: { after: { "#root": "Score: 1" } } },
  );

  expect(result.observations?.hud.score).toBeDefined();
  expect(result.assertionResults).toContainEqual({
    details: expect.objectContaining({ after: "Score: 1" }),
    id: "hud.score.#root",
    pass: true,
  });
  expect(result.pass).toBe(true);
});

test("visibility can prove a streamed entity is absent or present", () => {
  const currentScenario = scenario({
    visibility: [
      { entity: "chunk.0", present: false },
      { entity: "chunk.7", minProjectedPixels: 1, present: true },
    ],
  });
  const snapshot: IPlaytestObservationSnapshot = {
    clock: { mode: "fixed-step", tick: 1 },
    entities: [{ bounds: { height: 100, width: 100, x: 100, y: 100 }, id: "chunk.7", visible: true }],
  };

  const result = buildReport(CONFIG, currentScenario, snapshot, snapshot, [], []);

  expect(result.assertionResults).toContainEqual(expect.objectContaining({ id: "visibility.chunk.0", pass: true }));
  expect(result.assertionResults).toContainEqual(expect.objectContaining({ id: "visibility.chunk.7", pass: true }));
  expect(result.pass).toBe(true);
});

test("visibility presence fails when an unloaded entity remains registered", () => {
  const currentScenario = scenario({ visibility: [{ entity: "chunk.0", present: false }] });
  const snapshot: IPlaytestObservationSnapshot = {
    clock: { mode: "fixed-step", tick: 1 },
    entities: [{ id: "chunk.0", visible: false }],
  };

  const result = buildReport(CONFIG, currentScenario, snapshot, snapshot, [], []);

  expect(result.assertionResults).toContainEqual(expect.objectContaining({ id: "visibility.chunk.0", pass: false }));
  expect(result.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_VISIBILITY_FAILED");
  expect(result.pass).toBe(false);
});

test("visibility evaluates projected pixels when present is also asserted", () => {
  const currentScenario = scenario({
    visibility: [{ entity: "chunk.7", minProjectedPixels: 1_000_000_000, present: true }],
  });
  const snapshot: IPlaytestObservationSnapshot = {
    clock: { mode: "fixed-step", tick: 1 },
    entities: [{ bounds: { height: 100, width: 100, x: 100, y: 100 }, id: "chunk.7", visible: true }],
  };

  const result = buildReport(CONFIG, currentScenario, snapshot, snapshot, [], []);

  expect(result.assertionResults).toContainEqual(expect.objectContaining({
    id: "visibility.chunk.7",
    pass: false,
  }));
  expect(result.pass).toBe(false);
});

test("rotationChanged falls back to before/after bridge quaternions", () => {
  const currentScenario = scenario({ movement: { entity: "player", rotationChanged: true } });
  const snapshot = (rotation: [number, number, number, number]): IPlaytestObservationSnapshot => ({
    clock: { mode: "fixed-step", tick: 1 },
    entities: [{ id: "player", transform: { position: [0, 0, 0], rotation } }],
    resources: {},
  });

  const result = buildReport(
    CONFIG,
    currentScenario,
    snapshot([0, 0, 0, 1]),
    snapshot([0, 0.3826834, 0, 0.9238795]),
    [],
    [],
  );

  expect(result.assertionResults).toContainEqual(expect.objectContaining({ id: "movement.rotation", pass: true }));
  expect(result.pass).toBe(true);
});

test("a missing HUD id fails changed:false instead of passing on absent values", () => {
  const result = report(scenario({ hud: [{ id: "missing", changed: false }] }));

  expect(result.pass).toBe(false);
  expect(result.assertionResults).toContainEqual(expect.objectContaining({ id: "hud.missing", pass: false }));
  expect(result.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_HUD_ASSERTION_FAILED");
});

test("an empty assertion set remains a failed report", () => {
  const result = report(scenario(undefined));

  expect(result.pass).toBe(false);
  expect(result.assertionResults).toContainEqual({
    details: { reason: "no-evaluated-assertions" },
    id: "scenario.assertions",
    pass: false,
  });
  expect(result.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_SCENARIO_NO_ASSERTIONS");
});

test("the legacy TypeScript scenario is rejected by the JSON loader", async () => {
  const directory = await mkdtemp(join(tmpdir(), "playtest-legacy-scenario-"));
  await writeFile(join(directory, "play.playtest.ts"), "export const playScenario = {};\n");

  await expect(loadPlaytestScenario(directory, "play.playtest.ts")).rejects.toMatchObject({
    diagnostic: { code: "TN_PLAYTEST_SCENARIO_INVALID" },
  });
});

test("a browser pageerror fails noConsoleErrors", () => {
  const result = report(
    scenario({ diagnostics: { noConsoleErrors: true } }),
    {},
    { consoleEntries: [{ text: "boom", type: "pageerror" }] },
  );

  expect(result.pass).toBe(false);
  expect(result.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_CONSOLE_ERROR");
});

test("runtimeReady fails when the page never exposes a canvas", () => {
  const result = report(
    scenario({ diagnostics: { runtimeReady: true } }),
    {},
    { runtimeReady: false },
  );

  expect(result.pass).toBe(false);
  expect(result.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_RUNTIME_NOT_READY");
  expect(result.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_RUNTIME_DIAGNOSTIC");
});

test("frame-timed steps stay on the live browser loop", () => {
  expect(playtestStepHoldTicks({ holdFrames: 5, press: "KeyW", release: true }, 0)).toBe(0);
  expect(playtestStepWaitTicks({ release: true, waitFrames: 5 })).toBe(0);
  expect(playtestStepHoldTicks({ holdTicks: 5, press: "KeyW", release: true }, 0)).toBe(5);
  expect(playtestStepWaitTicks({ release: true, waitTicks: 5 })).toBe(5);
});

test("runner derives semantic series from labeled snapshots and the exported field list", () => {
  const currentScenario: IPlaytestScenario = {
    assert: {
      components: [{ atSteps: [{ equals: 2, label: "last" }], changed: true, component: "health", entity: "player", gte: 2 }],
      resources: [{ atSteps: [{ equals: 1, label: "first" }, { equals: 3, label: "last" }], id: "GameState", path: "coins", equals: 3 }],
      signals: [{ entity: "player", minCount: 2, name: "collected" }],
    },
    name: "semantic-series",
    schemaVersion: 1,
    steps: [
      { label: "first", release: true, waitFrames: 1 },
      { label: "last", release: true, waitFrames: 1 },
    ],
    target: "web",
    viewport: { height: 720, width: 1280 },
    warmupFrames: 0,
  };
  const snapshot = (coins: number, health: number, tick: number): IPlaytestObservationSnapshot => ({
    clock: { mode: "fixed-step", tick },
    components: { player: { health } },
    entities: [],
    resources: { GameState: { coins } },
  });

  const result = buildReport(
    CONFIG,
    currentScenario,
    snapshot(0, 1, 0),
    snapshot(3, 2, 2),
    [],
    [],
    undefined,
    {},
    true,
    undefined,
    [
      { label: "first", signals: [{ entity: "player", name: "collected" }], snapshot: snapshot(1, 3, 1) },
      { label: "last", signals: [{ entity: "player", name: "collected" }], snapshot: snapshot(3, 2, 2) },
    ],
  );

  expect(STANDALONE_PLAYTEST_OBSERVATION_FIELDS).toContain("resourceSeries");
  expect(result.observations?.resourceSeries).toHaveLength(2);
  expect(result.observations?.componentSeries?.[1]?.snapshots.player?.health).toBe(2);
  expect(result.observations?.signals).toHaveLength(2);
  expect(result.pass).toBe(true);
});
