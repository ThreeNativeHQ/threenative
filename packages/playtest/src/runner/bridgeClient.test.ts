import { makeTempDir } from "../../../../test-support/temp-dir.js";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";

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

test("scenario flags accumulate and expand a project glob in sorted order", async () => {
  const projectPath = await makeTempDir("playtest-scenarios-");
  await mkdir(join(projectPath, "playtests"));
  await writeFile(join(projectPath, "playtests/b.playtest.json"), "{}");
  await writeFile(join(projectPath, "playtests/a.playtest.json"), "{}");
  await writeFile(join(projectPath, "playtests/terminal-menu.playtest.json"), "{}");

  const repeated = parseStandalonePlaytestArgs([
    "--scenario", "first.playtest.json",
    "--scenario", "second.playtest.json",
  ], projectPath);
  assert.deepEqual(repeated.scenarioPaths, ["first.playtest.json", "second.playtest.json"]);

  const glob = parseStandalonePlaytestArgs(["--scenario", "playtests/*.playtest.json"], projectPath);
  assert.deepEqual(glob.scenarioPaths, [
    "playtests/a.playtest.json",
    "playtests/b.playtest.json",
    "playtests/terminal-menu.playtest.json",
  ]);

  const hyphenatedGlob = parseStandalonePlaytestArgs(
    ["--scenario", "playtests/terminal-*.playtest.json"],
    projectPath,
  );
  assert.deepEqual(hyphenatedGlob.scenarioPaths, ["playtests/terminal-menu.playtest.json"]);
});

test("a scenario glob that matches nothing fails closed", async () => {
  const projectPath = await makeTempDir("playtest-empty-glob-");
  assert.throws(
    () => parseStandalonePlaytestArgs(["--scenario", "playtests/*.playtest.json"], projectPath),
    /matched no files/u,
  );
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
