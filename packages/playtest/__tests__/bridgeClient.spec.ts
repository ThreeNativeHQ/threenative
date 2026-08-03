import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";

import { parseStandalonePlaytestArgs } from "../src/runner/config.js";
import { initStandalonePlaytest } from "../src/runner/init.js";

test("standalone args support existing-server and managed-server flows", () => {
  const existing = parseStandalonePlaytestArgs(["playtests/move.json", "--url", "http://localhost:4173"], "/project");
  expect(existing.scenarioPath).toBe("playtests/move.json");
  expect(existing.url).toBe("http://localhost:4173");
  expect(existing.server).toBe(undefined);

  const managed = parseStandalonePlaytestArgs([
    "--scenario", "playtests/move.json",
    "--server-command", "pnpm dev",
    "--server-timeout", "20000",
  ], "/project");
  expect(managed.server?.command).toBe("pnpm dev");
  expect(managed.server?.timeoutMs).toBe(20_000);
});

test("standalone args fail with a concrete first command", () => {
  expect(
    () => parseStandalonePlaytestArgs([], "/project"),
  ).toThrow(/threenative-playtest --scenario/);
});

test("init creates only config scenario and adapter examples", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "playtest-init-"));

  const result = await initStandalonePlaytest(projectPath);

  expect(result.created.sort()).toEqual([
    "playtest.adapter.example.ts",
    "playtest.config.json",
    "playtests/smoke.playtest.json",
  ]);
  const scenario = JSON.parse(await readFile(join(projectPath, "playtests/smoke.playtest.json"), "utf8"));
  expect(scenario.schemaVersion).toBe(1);
  await expect(initStandalonePlaytest(projectPath)).rejects.toThrow(/Refusing to overwrite/);
});
