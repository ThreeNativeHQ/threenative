import { makeTempDir } from "../../../test-support/temp-dir.js";
import { createServer, type Server } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, beforeAll, afterAll } from "vitest";

import { loadPlaytestScenario } from "../src/index.js";
import { exitCodeForReport } from "../src/runner/cli.js";
import { runStandalonePlaytest } from "../src/runner/runner.js";

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
let fixtureServer: Server;
let origin: string;
let fixtureHtml: Buffer;

beforeAll(async () => {
  fixtureHtml = await readFile(join(fixtureDirectory, "app.html"));
  fixtureServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixtureHtml);
  });
  await new Promise<void>((ready) => fixtureServer.listen(0, "127.0.0.1", ready));
  const address = fixtureServer.address();
  if (address === null || typeof address === "string") throw new Error("Fixture server has no port.");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((closed) => fixtureServer.close(() => closed()));
});

async function run(mode: string, assert: unknown) {
  const projectPath = await makeTempDir("playtest-fails-closed-");
  await writeFile(join(projectPath, "scenario.json"), JSON.stringify({
    artifacts: { screenshots: false },
    assert,
    name: `fails-closed-${mode}`,
    schemaVersion: 1,
    steps: [{ release: true, waitFrames: 10 }],
    subject: "player",
    target: "web",
    viewport: { height: 360, width: 640 },
    warmupFrames: 2,
  }));
  return runStandalonePlaytest({
    artifactDirectory: join(projectPath, "artifacts"),
    headless: true,
    projectPath,
    scenarioPath: "scenario.json",
    timeoutMs: 15_000,
    trace: false,
    url: `${origin}/?mode=${mode}`,
  });
}

async function runFixture(mode: string, scenarioPath: string) {
  const artifactDirectory = await makeTempDir(`playtest-fails-closed-fixture-${mode}-`);
  return runStandalonePlaytest({
    artifactDirectory,
    headless: true,
    projectPath: fixtureDirectory,
    scenarioPath,
    timeoutMs: 15_000,
    trace: false,
    url: `${origin}/?mode=${mode}`,
  });
}

test("should fail when console errors are captured and the scenario is silent", async () => {
  const report = await runFixture("console-only", "permissive.playtest.json");

  expect(exitCodeForReport(report)).toBe(1);
  expect(report.pass).toBe(false);
  expect(report.assertionResults).toContainEqual(expect.objectContaining({ id: "diagnostics", pass: false }));
  expect(report.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_CONSOLE_ERROR");
  expect(report.observations?.runtimeDiagnostics).toMatchObject({ recentRuntimeErrors: [] });
});

test("should fail when network errors are captured and the scenario is silent", async () => {
  const report = await run("network-only", { movement: { entity: "player", minDistance: 0.1 } });

  expect(exitCodeForReport(report)).toBe(1);
  expect(report.pass).toBe(false);
  expect(report.assertionResults).toContainEqual(expect.objectContaining({ id: "diagnostics", pass: false }));
  expect(report.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_NETWORK_ERROR");
  expect(report.observations?.network.length).toBeGreaterThan(0);
});

test("should reject noConsoleErrors:false without a reason", async () => {
  const projectPath = await makeTempDir("playtest-invalid-diagnostics-");
  await writeFile(join(projectPath, "scenario.json"), JSON.stringify({
    assert: { diagnostics: { noConsoleErrors: false } },
    name: "invalid-console-opt-out",
    schemaVersion: 1,
    steps: [{ release: true, waitFrames: 1 }],
  }));

  await expect(loadPlaytestScenario(projectPath, "scenario.json")).rejects.toMatchObject({
    diagnostic: {
      code: "TN_PLAYTEST_SCENARIO_INVALID",
      message: expect.stringContaining("consoleErrorsOptOutReason"),
    },
  });
});

test("should reject noNetworkErrors:false without a reason", async () => {
  const projectPath = await makeTempDir("playtest-invalid-network-opt-out-");
  await writeFile(join(projectPath, "scenario.json"), JSON.stringify({
    assert: { diagnostics: { noNetworkErrors: false } },
    name: "invalid-network-opt-out",
    schemaVersion: 1,
    steps: [{ release: true, waitFrames: 1 }],
  }));

  await expect(loadPlaytestScenario(projectPath, "scenario.json")).rejects.toMatchObject({
    diagnostic: { message: expect.stringContaining("networkErrorsOptOutReason") },
  });
});

test("should record a diagnostics row even when everything is clean", async () => {
  const report = await run("good", {
    diagnostics: { noConsoleErrors: true, noNetworkErrors: true, noRuntimeDiagnostics: true },
  });

  expect(exitCodeForReport(report)).toBe(0);
  expect(report.pass).toBe(true);
  expect(report.assertionResults).toContainEqual({
    details: {
      consoleErrors: 0,
      networkErrors: 0,
      policy: { noConsoleErrors: true, noNetworkErrors: true, noRuntimeDiagnostics: true },
      runtimeDiagnostics: 0,
    },
    id: "diagnostics",
    pass: true,
  });
  expect(report.diagnosticsPolicy).toEqual({
    noConsoleErrors: true,
    noNetworkErrors: true,
    noRuntimeDiagnostics: true,
  });
});
