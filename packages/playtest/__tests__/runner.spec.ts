import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { loadPlaytestScenario, type IPlaytestScenario } from "../src/index.js";
import type { IStandalonePlaytestConfig } from "../src/runner/config.js";
import { buildReport } from "../src/runner/runner.js";
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
