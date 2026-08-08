import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const goldenPath = path.join(repoRoot, "tests/browser-replay/replay.golden.json");
const scenarioPath = path.join(repoRoot, "examples/abyss-framework/playtests/replay.playtest.json");
const nestedVirtualDisplay = process.platform === "linux" && process.env.DISPLAY === undefined;
const nestedBrowserMode =
  nestedVirtualDisplay || process.env.DISPLAY !== undefined ? ["--headed"] : [];

interface ReplayProofStep {
  holdTicks?: number;
  press?: string | string[];
  release?: boolean;
  waitTicks?: number;
}

interface ReplayScenario {
  assert?: { movement?: unknown };
  steps: ReplayProofStep[];
}

interface ReplayProofResult {
  recordTrace: Array<{ position: [number, number, number]; score: number }>;
  recording: { input: Array<{ keys: string[]; tick: number }>; ticks: number };
  replayTrace: Array<{ position: [number, number, number]; score: number }>;
}

interface ReplayGolden {
  playerX: number;
  tick: number;
  finalPlayerX: number;
  finalScore: number;
  tolerance: number;
}

test("executes the checked-in 30-second replay scenario", async ({ baseURL }) => {
  test.setTimeout(120_000);
  const scenario = await readReplayScenario();
  const ticks = scenario.steps.reduce(
    (total, step) => total + (step.holdTicks ?? step.waitTicks ?? 0),
    0,
  );
  expect(ticks).toBe(1_800);
  expect(scenario.assert?.movement).toBeDefined();
  expect(
    (scenario.assert?.movement as { reachesPositionWithin?: unknown } | undefined)
      ?.reachesPositionWithin,
  ).toBeDefined();

  const artifacts = await mkdtemp(path.join(tmpdir(), "threenative-replay-test-"));
  try {
    const result = await runReplayScenario(artifacts, baseURL ?? "http://127.0.0.1:4178");
    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(0);
  } finally {
    await rm(artifacts, { force: true, recursive: true });
  }
});

test("compares a real Abyss record/replay trace against golden movement", async ({ page }) => {
  test.setTimeout(120_000);
  const scenario = await readReplayScenario();
  const golden = JSON.parse(await readFile(goldenPath, "utf8")) as ReplayGolden;

  await page.goto("/");
  await page.waitForFunction(() => {
    const replay = (
      globalThis as typeof globalThis & {
        __THREENATIVE_REPLAY__?: { recording?: unknown; recordAndReplay?: unknown };
      }
    ).__THREENATIVE_REPLAY__;
    const devTools = (
      globalThis as typeof globalThis & {
        __THREENATIVE__?: { snapshot?: () => Record<string, unknown> };
      }
    ).__THREENATIVE__;
    return (
      replay?.recording !== undefined &&
      typeof replay.recordAndReplay === "function" &&
      typeof devTools?.snapshot === "function" &&
      devTools.snapshot().player !== undefined
    );
  });
  const result = await page.evaluate(async (steps) => {
    const replay = (
      globalThis as typeof globalThis & {
        __THREENATIVE_REPLAY__?: {
          recordAndReplay?: (value: readonly ReplayProofStep[]) => Promise<ReplayProofResult>;
        };
      }
    ).__THREENATIVE_REPLAY__;
    if (replay?.recordAndReplay === undefined)
      throw new Error("Abyss replay consumer proof hook is unavailable.");
    return replay.recordAndReplay(steps);
  }, scenario.steps);

  const ticks = scenario.steps.reduce(
    (total, step) => total + (step.holdTicks ?? step.waitTicks ?? 0),
    0,
  );
  expect(result.recording.ticks).toBe(ticks);
  expect(result.recording.ticks).toBe(1_800);
  expect(result.recordTrace).toEqual(result.replayTrace);

  const observed = result.recordTrace[golden.tick];
  if (observed === undefined) throw new Error(`Golden tick ${golden.tick} was not observed.`);
  expect(Math.abs(observed.position[0] - golden.playerX)).toBeLessThanOrEqual(golden.tolerance);

  const finalRecorded = result.recordTrace.at(-1);
  const finalReplayed = result.replayTrace.at(-1);
  if (finalRecorded === undefined || finalReplayed === undefined)
    throw new Error("Replay proof did not observe a final player state.");
  expect(golden.finalScore).toBeGreaterThan(0);
  expect(finalRecorded.score).toBe(golden.finalScore);
  expect(finalReplayed.score).toBe(finalRecorded.score);
  expect(Math.abs(finalRecorded.position[0] - golden.finalPlayerX)).toBeLessThanOrEqual(
    golden.tolerance,
  );
});

async function readReplayScenario(): Promise<ReplayScenario> {
  return JSON.parse(await readFile(scenarioPath, "utf8")) as ReplayScenario;
}

function runReplayScenario(
  artifacts: string,
  url: string,
): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const runnerArgs = [
      path.join(repoRoot, "packages/playtest/dist/runner/cli.js"),
      scenarioPath,
      "--project",
      repoRoot,
      "--url",
      url,
      "--artifacts",
      artifacts,
      "--browser-recipe",
      "webgpu",
      ...nestedBrowserMode,
      "--timeout",
      "120000",
    ];
    const runner = spawn(
      nestedVirtualDisplay ? "xvfb-run" : process.execPath,
      nestedVirtualDisplay
        ? ["-a", "-s", "-screen 0 1600x900x24", process.execPath, ...runnerArgs]
        : runnerArgs,
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    const stdout: string[] = [];
    const stderr: string[] = [];
    runner.stdout?.on("data", (chunk) => stdout.push(String(chunk)));
    runner.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
    runner.once("close", (code) =>
      resolve({ code: code ?? 2, stderr: stderr.join(""), stdout: stdout.join("") }),
    );
  });
}
