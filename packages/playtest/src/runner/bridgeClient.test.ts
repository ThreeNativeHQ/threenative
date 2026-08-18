import { makeTempDir } from "../../../../test-support/temp-dir.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseStandalonePlaytestArgs } from "./config.js";
import { initStandalonePlaytest } from "./init.js";

test("standalone args support existing-server and managed-server flows", () => {
  const existing = parseStandalonePlaytestArgs(["playtests/move.json", "--url", "http://localhost:4173"], "/project");
  assert.equal(existing.scenarioPath, "playtests/move.json");
  assert.equal(existing.url, "http://localhost:4173");
  assert.equal(existing.server, undefined);

  const managed = parseStandalonePlaytestArgs([
    "--scenario", "playtests/move.json",
    "--server-command", "pnpm dev",
    "--server-timeout", "20000",
  ], "/project");
  assert.equal(managed.server?.command, "pnpm dev");
  assert.equal(managed.server?.timeoutMs, 20_000);
});

test("standalone args fail with a concrete first command", () => {
  assert.throws(
    () => parseStandalonePlaytestArgs([], "/project"),
    /threenative-playtest --scenario/,
  );
});

test("init creates only config scenario and adapter examples", async () => {
  const projectPath = await makeTempDir("playtest-init-");

  const result = await initStandalonePlaytest(projectPath);

  assert.deepEqual(result.created.sort(), [
    "playtest.adapter.example.ts",
    "playtest.config.json",
    "playtests/smoke.playtest.json",
  ]);
  const scenario = JSON.parse(await readFile(join(projectPath, "playtests/smoke.playtest.json"), "utf8"));
  assert.equal(scenario.schemaVersion, 1);
  await assert.rejects(initStandalonePlaytest(projectPath), /Refusing to overwrite/);
});
