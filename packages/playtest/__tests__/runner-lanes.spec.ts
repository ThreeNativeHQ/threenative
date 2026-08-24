import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

import { makeTempDir } from "../../../test-support/temp-dir.js";
import { runDevicePlaytest } from "../src/runner/androidRunner.js";
import type { IStandalonePlaytestConfig } from "../src/runner/config.js";
import {
  accumulatedPathLength,
  failureReport,
  throwIfAborted,
} from "../src/runner/shared.js";
import type { IPlaytestProtocolDiagnostic, IPlaytestScenario, PlaytestVec3 } from "../src/index.js";

const runnerDirectory = fileURLToPath(new URL("../src/runner/", import.meta.url));

async function runnerSource(name: string): Promise<string> {
  return readFile(`${runnerDirectory}${name}`, "utf8");
}

test("runner lane helpers have one implementation", async () => {
  const steps = await runnerSource("steps.ts");
  const android = await runnerSource("androidRunner.ts");
  const runner = await runnerSource("runner.ts");

  expect(steps).toMatch(/from "\.\/shared\.js"/u);
  expect(android).toMatch(/from "\.\/shared\.js"/u);
  expect(runner).toMatch(/accumulatedPathLength/u);
  expect(android).toMatch(/accumulatedPathLength/u);
  expect(steps).not.toMatch(/function setupRequest\(/u);
  expect(android).not.toMatch(/function setupRequest\(/u);
  expect(android).not.toMatch(/function observedEntityIds\(/u);
  expect(android).not.toMatch(/function observedResourceIds\(/u);
  expect(android).not.toMatch(/function appendPosition\(/u);
  expect(android).not.toMatch(/function accumulatedPathLength\(/u);
  expect(android).not.toMatch(/function safePart\(/u);
  expect(android).not.toMatch(/function failureReport\(/u);
  expect(android).not.toMatch(/Math\.hypot/u);
});

test("sampling.ts contains sampling concerns only", async () => {
  const sampling = await runnerSource("sampling.ts");

  expect(sampling).not.toMatch(/function startManagedServer\(/u);
  expect(sampling).not.toMatch(/function evaluateCamera\(/u);
  expect(sampling).not.toMatch(/function length\(/u);
  expect(sampling).not.toMatch(/PAGE_NAVIGATED_PATTERN/u);
});

test("browser and device lanes report the same shared path length", async () => {
  const points: PlaytestVec3[] = [
    [0, 0, 0],
    [1e308, 1e308, 0],
    [1e308, 1e308, 3],
  ];
  const browserLength = accumulatedPathLength(points);
  const deviceLength = accumulatedPathLength(points);

  expect(browserLength).toBe(deviceLength);
  expect(browserLength).toBe(Math.hypot(1e308, 1e308, 0) + 3);
});

test("browser and native failure reports expose the same field set", () => {
  const scenario = {
    name: "failure-fields",
    schemaVersion: 1,
    steps: [{ release: true, waitTicks: 1 }],
    subject: "player",
    target: "web",
    viewport: { height: 100, width: 100 },
    warmupFrames: 0,
  } as unknown as IPlaytestScenario;
  const diagnostic = {
    code: "TN_PLAYTEST_BRIDGE_MISSING",
    fix: { instruction: "install the bridge" },
    message: "bridge missing",
    severity: "error",
  } as IPlaytestProtocolDiagnostic;
  const web = failureReport({ artifactDirectory: "/tmp/web", headless: true, url: "http://web" } as IStandalonePlaytestConfig, scenario, diagnostic);
  const android = failureReport({ artifactDirectory: "/tmp/android", endpoint: "http://android", headless: true, url: "http://web" } as IStandalonePlaytestConfig, scenario, diagnostic, "android");

  expect(Object.keys(android).sort()).toEqual(Object.keys(web).sort());
  expect(android.runtime).toBe("native");
  expect(android.target).toBe("android");
});

test.each([
  ["browser", "Browser"],
  ["android", "Android"],
  ["desktop", "Desktop"],
  ["ios", "iOS"],
] as const)("abort messages name the %s target", async (target, label) => {
  await expect(throwIfAborted({ abortSignal: AbortSignal.abort(), name: target }))
    .rejects.toThrow(`${label} playtest interrupted by signal.`);
});

test("an interrupted Android run names Android", async () => {
  const projectPath = await makeTempDir("playtest-runner-lanes-");
  const scenarioPath = `${projectPath}/abort.playtest.json`;
  const scenario = {
    name: "abort",
    schemaVersion: 1,
    target: "web",
    steps: [{ release: true, waitTicks: 1 }],
    viewport: { height: 100, width: 100 },
    warmupFrames: 0,
  };
  await writeFile(scenarioPath, JSON.stringify(scenario));

  const config = {
    artifactDirectory: `${projectPath}/artifacts`,
    endpoint: "http://127.0.0.1:41777/playtest",
    headless: true,
    projectPath,
    scenarioPath,
    target: "android",
    timeoutMs: 1000,
    trace: false,
    url: "http://127.0.0.1:5173",
  } as IStandalonePlaytestConfig;
  const target = {
    abortSignal: AbortSignal.abort(),
    driver: {} as never,
    mailboxPaths: {} as never,
    name: "android" as const,
    processName: "com.example.game",
  };

  await expect(runDevicePlaytest(config, target)).rejects.toThrow("Android playtest interrupted by signal.");
});
