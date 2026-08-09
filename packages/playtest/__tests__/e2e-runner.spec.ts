import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";

import { exitCodeForReport } from "../src/runner/cli.js";
import { runStandalonePlaytest } from "../src/runner/runner.js";
import type { IStandalonePlaytestReport } from "../src/runner/runner.js";

// End-to-end verdict tests. Every other suite in this package checks a part in
// isolation; these drive the real runner against a real browser and assert the
// only thing a playtest harness is actually trusted for: `pass` is true when the
// application works and false when it does not.
//
// The distinction that matters here is a false NEGATIVE — reporting pass on an
// app that is broken, or on a run where nothing was ever observed. A harness
// that cannot fail is worse than no harness, because CI treats it as evidence.

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

let server: Server;
let origin: string;

beforeAll(async () => {
  const html = await readFile(join(fixtureDirectory, "app.html"), "utf8");
  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Fixture server has no port.");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((closed) => server.close(() => closed()));
});

async function run(mode: string, assert: unknown): Promise<IStandalonePlaytestReport> {
  const projectPath = await mkdtemp(join(tmpdir(), "playtest-e2e-"));
  await writeFile(
    join(projectPath, "scenario.json"),
    JSON.stringify({
      artifacts: { screenshots: false },
      assert,
      name: `e2e-${mode}`,
      schemaVersion: 1,
      steps: [{ holdFrames: 30, press: "KeyW", release: true }],
      subject: "player",
      target: "web",
      viewport: { height: 360, width: 640 },
      warmupFrames: 2,
    }),
  );
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

const MOVES = { movement: { entity: "player", minDistance: 0.5 } };

test("true negative: a working application passes and reports the distance it measured", async () => {
  const report = await run("good", MOVES);

  expect(report.pass).toBe(true);
  expect(report.distance).toBeGreaterThan(0.5);
  expect(report.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
  expect(report.assertionResults?.map(({ id, pass }) => ({ id, pass }))).toEqual([
    { id: "movement.distance", pass: true },
  ]);
}, 60_000);

test("true positive: an application that ignores input fails with a movement diagnostic", async () => {
  const report = await run("broken", MOVES);

  expect(report.pass).toBe(false);
  expect(report.distance).toBe(0);
  expect(report.assertionResults?.find(({ id }) => id === "movement.distance")?.pass).toBe(false);
  expect(report.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_MOVEMENT_ASSERTION_FAILED");
}, 60_000);

test("true positive: movement without input is not accepted as a working control scheme", async () => {
  // `drift` moves on its own, so a minDistance assertion alone would pass it. The
  // maxDistance bound is what separates "responded to input" from "was already
  // moving", and it must fire.
  const report = await run("drift", { movement: { entity: "player", maxDistance: 0.2 } });

  expect(report.pass).toBe(false);
  expect(report.assertionResults?.find(({ id }) => id === "movement.maxDistance")?.pass).toBe(false);
}, 60_000);

test("true positive: a bridge that returns no observations fails instead of passing vacuously", async () => {
  // The worst failure mode: the run completes, the browser is green, and nothing
  // was ever measured. `distance` defaults to 0 and the verdict must follow it.
  const report = await run("silent-drop", MOVES);

  expect(report.pass).toBe(false);
  expect(report.before).toBeUndefined();
  expect(report.after).toBeUndefined();
}, 60_000);

test("true positive: a scenario that asserts nothing does not report pass", async () => {
  // The application here is the working one. The run still has to fail: `pass` is
  // computed with `.every()`, which is true over an empty list, so an empty verdict
  // would be indistinguishable in CI from a fully verified feature.
  const report = await run("good", {});

  expect(report.pass).toBe(false);
  expect(report.assertionResults).toEqual([
    { details: { reason: "no-evaluated-assertions" }, id: "scenario.assertions", pass: false },
  ]);
  expect(report.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_SCENARIO_NO_ASSERTIONS");
}, 60_000);

test("true positive: a missing bridge fails the run rather than skipping the assertion", async () => {
  const report = await run("no-bridge", MOVES);

  expect(report.pass).toBe(false);
  expect(report.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_BRIDGE_MISSING");
}, 60_000);

test("transport-only browser errors reach runtime diagnostics without a bridge", async () => {
  const report = await run("no-bridge-error", {
    diagnostics: { noConsoleErrors: false, noRuntimeDiagnostics: true },
  });

  expect(report.assertionResults).toContainEqual({
    details: { consoleErrors: 1, networkErrors: 0, runtimeDiagnostics: 1 },
    id: "diagnostics",
    pass: false,
  });
  expect(report.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_RUNTIME_DIAGNOSTIC");
  expect(report.diagnostics.map(({ code }) => code)).not.toContain("TN_PLAYTEST_BRIDGE_MISSING");
  expect(exitCodeForReport(report)).toBe(1);
}, 60_000);

test("true positive: a bridge that reports itself unready fails with its own reason", async () => {
  const report = await run("not-ready", MOVES);

  expect(report.pass).toBe(false);
  expect(report.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_BRIDGE_NOT_READY");
  expect(report.diagnostics[0]?.message).toMatch(/scene still loading/u);
}, 60_000);

test("true positive: an incompatible protocol version fails instead of being interpreted", async () => {
  const report = await run("wrong-protocol", MOVES);

  expect(report.pass).toBe(false);
  expect(report.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_BRIDGE_INCOMPATIBLE");
}, 60_000);

test("browser args reach the launched chromium", async () => {
  // A WebGPU target needs --enable-unsafe-webgpu to start at all, and there was no
  // way to reach chromium.launch from the config. Asserted through a flag with an
  // observable effect, since WebGPU itself is unavailable in this environment.
  const projectPath = await mkdtemp(join(tmpdir(), "playtest-e2e-args-"));
  await writeFile(
    join(projectPath, "scenario.json"),
    JSON.stringify({
      artifacts: { screenshots: false },
      assert: MOVES,
      name: "e2e-args",
      schemaVersion: 1,
      steps: [{ holdFrames: 30, press: "KeyW", release: true }],
      subject: "player",
      target: "web",
      viewport: { height: 360, width: 640 },
      warmupFrames: 2,
    }),
  );

  const report = await runStandalonePlaytest({
    artifactDirectory: join(projectPath, "artifacts"),
    browserArgs: ["--user-agent=playtest-arg-probe"],
    headless: true,
    projectPath,
    scenarioPath: "scenario.json",
    timeoutMs: 15_000,
    trace: false,
    url: `${origin}/?mode=good&report=ua`,
  });

  // The fixture echoes its user agent; only the launch flag can set it.
  expect(report.observations?.console.map(({ text }) => text)).toContain("playtest-ua:playtest-arg-probe");
  expect(report.pass).toBe(true);
}, 60_000);

test("normalized pointer coordinates reach the declared viewport position", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "playtest-e2e-pointer-"));
  await writeFile(
    join(projectPath, "scenario.json"),
    JSON.stringify({
      artifacts: { screenshots: false },
      assert: { movement: { entity: "player", maxDistance: 0.2 } },
      name: "e2e-pointer",
      schemaVersion: 1,
      steps: [{ kind: "input", pointerPosition: { x: 0.7, y: 0.5 }, waitFrames: 1, release: true }],
      subject: "player",
      target: "web",
      viewport: { height: 360, width: 640 },
      warmupFrames: 2,
    }),
  );

  const report = await runStandalonePlaytest({
    artifactDirectory: join(projectPath, "artifacts"),
    headless: true,
    projectPath,
    scenarioPath: "scenario.json",
    timeoutMs: 15_000,
    trace: false,
    url: `${origin}/?mode=good`,
  });

  expect(report.pass).toBe(true);
  expect(report.observations?.console.map(({ text }) => text)).toContain("playtest-pointer:448,180");
}, 60_000);

test("setup positions the entity before the run so movement is measured from it", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "playtest-e2e-setup-"));
  await writeFile(
    join(projectPath, "scenario.json"),
    JSON.stringify({
      artifacts: { screenshots: false },
      assert: MOVES,
      name: "e2e-setup",
      schemaVersion: 1,
      setup: { entities: [{ entity: "player", position: [0, 0, 10] }] },
      steps: [{ holdFrames: 30, press: "KeyW", release: true }],
      subject: "player",
      target: "web",
      viewport: { height: 360, width: 640 },
      warmupFrames: 2,
    }),
  );

  const report = await runStandalonePlaytest({
    artifactDirectory: join(projectPath, "artifacts"),
    headless: true,
    projectPath,
    scenarioPath: "scenario.json",
    timeoutMs: 15_000,
    trace: false,
    url: `${origin}/?mode=good`,
  });

  expect(report.before?.position[2]).toBeGreaterThanOrEqual(10);
  expect(report.pass).toBe(true);
}, 60_000);
