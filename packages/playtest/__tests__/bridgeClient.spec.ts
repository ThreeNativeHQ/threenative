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

test("device args select Android and preserve an explicit endpoint", () => {
  const config = parseStandalonePlaytestArgs([
    "playtests/move.json",
    "--target", "android",
    "--endpoint", "http://127.0.0.1:43123/playtest",
    "--device", "emulator-5554",
  ], "/project");

  expect(config.target).toBe("android");
  expect(config.endpoint).toBe("http://127.0.0.1:43123/playtest");
  expect(config.device).toBe("emulator-5554");
});

test("device args select iOS simulator or physical devicectl transport", () => {
  const simulator = parseStandalonePlaytestArgs([
    "scenario.json", "--target", "ios", "--app", "build/ThreeNative.app",
    "--bundle-id", "dev.example.game", "--device", "SIM-123",
  ], "/project");
  expect(simulator.target).toBe("ios");
  expect(simulator.ios).toEqual({
    appPath: "/project/build/ThreeNative.app",
    bundleId: "dev.example.game",
    transport: "simulator",
  });
  expect(simulator.device).toBe("SIM-123");

  const physical = parseStandalonePlaytestArgs([
    "scenario.json", "--target", "ios", "--app", "game.app", "--ios-transport", "device",
  ], "/project");
  expect(physical.ios?.transport).toBe("device");
});

test("browser args are repeatable and absent when unused", () => {
  // A WebGPU target needs several chromium flags at once, so one flag per
  // occurrence rather than a delimited string.
  const withArgs = parseStandalonePlaytestArgs([
    "--scenario", "playtests/move.json",
    "--browser-arg", "--enable-unsafe-webgpu",
    "--browser-arg", "--enable-features=Vulkan",
  ], "/project");
  expect(withArgs.browserArgs).toEqual(["--enable-unsafe-webgpu", "--enable-features=Vulkan"]);

  expect(parseStandalonePlaytestArgs(["playtests/move.json"], "/project").browserArgs).toBe(undefined);
});

test("the WebGPU browser recipe expands to the sealed Chromium flags", () => {
  expect(
    parseStandalonePlaytestArgs(["playtests/move.json", "--browser-recipe", "webgpu"], "/project")
      .browserArgs,
  ).toEqual([
    "--ozone-platform=x11",
    "--enable-unsafe-webgpu",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
  ]);
  expect(() =>
    parseStandalonePlaytestArgs(["playtests/move.json", "--browser-recipe", "unknown"], "/project"),
  ).toThrow(/Unknown browser recipe/);
});

test("a browser arg with no value fails instead of swallowing the next flag", () => {
  // `--browser-arg --headed` would otherwise consume `--headed` as the value and
  // silently drop the mode the author asked for.
  expect(
    () => parseStandalonePlaytestArgs(["playtests/move.json", "--browser-arg", "--headed"], "/project"),
  ).toThrow(/requires a value/u);
});

test("a value-taking flag cannot swallow the next playtest flag", () => {
  expect(() => parseStandalonePlaytestArgs(["--scenario", "--url", "http://127.0.0.1:5173"], "/project"))
    .toThrow(/Flag '--scenario' requires a value/u);
});

test("unknown flags fail as CLI usage instead of being ignored", () => {
  expect(() => parseStandalonePlaytestArgs(["playtests/move.json", "--future-flag"], "/project"))
    .toThrow(/Unknown flag '--future-flag'/u);
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
