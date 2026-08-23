import { makeTempDir } from "../../../test-support/temp-dir.js";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, beforeAll, afterAll, test } from "vitest";

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

async function runFixture(mode: string, scenarioPath: string) {
  const artifactRoot = await makeTempDir(`playtest-negative-${mode}-`);
  return runStandalonePlaytest({
    artifactDirectory: artifactRoot,
    headless: true,
    projectPath: fixtureDirectory,
    scenarioPath,
    timeoutMs: 15_000,
    trace: false,
    url: `${origin}/?mode=${mode}`,
  });
}

test.each([
  ["console error", "console-only", "console-error.playtest.json", "phase0-console-error"],
  ["network failure", "network-only", "permissive.playtest.json", "TN_PLAYTEST_NETWORK_ERROR"],
  ["runtime diagnostic", "runtime-diagnostic", "runtime-diagnostic.playtest.json", "runtime-seeded-error"],
  ["unhandled rejection", "unhandled-rejection", "unhandled-rejection.playtest.json", "phase2-unhandled-rejection"],
  ["page error", "page-error", "page-error.playtest.json", "phase2-page-error"],
  ["restart leak", "restart-leak", "restart-leak.playtest.json", "TN_PLAYTEST_WORLD_BODIES_LEAK"],
  ["stale scheduler callback", "scheduler-leak", "scheduler-leak.playtest.json", "TN_PLAYTEST_SCHEDULER_AFTER_SCENE_EXIT"],
  ["physics mismatch", "physics-mismatch", "physics-mismatch.playtest.json", "TN_PLAYTEST_PHYSICS_HASH_MISMATCH"],
] as const)("seeded %s fixture is observed red", async (_label, mode, scenarioPath, marker) => {
  const report = await runFixture(mode, scenarioPath);

  expect(exitCodeForReport(report)).toBe(1);
  expect(report.pass).toBe(false);
  if (mode === "network-only") {
    expect(report.observations?.network).toContainEqual({
      method: "GET",
      url: "http://127.0.0.1:1/missing-asset.js",
    });
    expect(report.assertionResults).toContainEqual(expect.objectContaining({
      details: expect.objectContaining({
        networkErrors: 1,
        policy: expect.objectContaining({ noNetworkErrors: true }),
      }),
      id: "diagnostics",
      pass: false,
    }));
    expect(report.diagnostics.map(({ code }) => code)).toContain(marker);
  } else if (mode === "restart-leak") {
    expect(report.observations?.runtimeDiagnostics).toMatchObject({
      recentRuntimeErrors: [expect.objectContaining({ code: marker, expectedWorldBodies: 2, worldBodies: 4 })],
    });
  } else if (mode === "scheduler-leak") {
    expect(report.observations?.runtimeDiagnostics).toMatchObject({
      recentRuntimeErrors: [expect.objectContaining({ callback: "stale-timer", code: marker, callbacks: 1 })],
    });
  } else if (mode === "physics-mismatch") {
    expect(report.observations?.runtimeDiagnostics).toMatchObject({
      recentRuntimeErrors: [expect.objectContaining({ code: marker, expectedHash: expect.any(String), observedHash: expect.any(String), seed: 90210 })],
    });
    const mismatch = (report.observations?.runtimeDiagnostics as { recentRuntimeErrors?: Array<{ code?: string; expectedHash?: string; observedHash?: string }> }).recentRuntimeErrors?.find(({ code }) => code === marker);
    expect(mismatch?.expectedHash).not.toBe(mismatch?.observedHash);
  } else {
    expect(JSON.stringify(report.observations)).toContain(marker);
  }
});

test("the clean lifecycle control exercises the fixture detector without a leak", async () => {
  const report = await runFixture("restart-leak-control", "restart-leak.playtest.json");

  expect(exitCodeForReport(report)).toBe(0);
  expect(report.pass).toBe(true);
  expect(report.observations?.runtimeDiagnostics).toMatchObject({ recentRuntimeErrors: [] });
});

test("seeded visual-capture failure is infrastructure-red and fails its visual rows", async () => {
  const report = await runFixture("good", "visual-capture-failure.playtest.json");

  expect(report.pass).toBe(false);
  expect(exitCodeForReport(report)).toBe(1);
  expect(report.capture).toBeDefined();
  expect(report.diagnostics.map(({ code }) => code)).toContain("TN_CAPTURE_BLANK");
  // Decided 2026-08-23: a capture failure is a missing observation, so the row fails closed
  // rather than landing green with a not-evaluated stamp.
  expect(report.assertionResults).toContainEqual(expect.objectContaining({
    details: expect.objectContaining({ reason: "not-evaluated" }),
    id: "visual.0",
    pass: false,
  }));
  expect(report.diagnostics.map(({ code }) => code)).toContain(
    "TN_PLAYTEST_ASSERTION_NOT_EVALUATED",
  );
  expect(report.diagnostics.map(({ code }) => code)).not.toContain("TN_PLAYTEST_REGION_BLANK");
});
