import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const goldenPath = path.join(repoRoot, "tests/browser-replay/replay.golden.json");
const scenarioPath = path.join(repoRoot, "examples/abyss-framework/playtests/replay.playtest.json");

interface ReplayProofStep {
  holdTicks?: number;
  press?: string;
  release?: boolean;
  waitTicks?: number;
}

interface ReplayScenario {
  assert?: { movement?: unknown };
  steps: ReplayProofStep[];
}

interface ReplayProofResult {
  recordTrace: Array<[number, number, number]>;
  recording: { input: Array<{ keys: string[]; tick: number }>; ticks: number };
  replayTrace: Array<[number, number, number]>;
}

interface ReplayGolden {
  playerX: number;
  tick: number;
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
    return replay?.recording !== undefined && typeof replay.recordAndReplay === "function";
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
  expect(Math.abs(observed[0] - golden.playerX)).toBeLessThanOrEqual(golden.tolerance);
});

async function readReplayScenario(): Promise<ReplayScenario> {
  return JSON.parse(await readFile(scenarioPath, "utf8")) as ReplayScenario;
}

function runReplayScenario(
  artifacts: string,
  url: string,
): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const runner = spawn(
      process.execPath,
      [
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
        "--headed",
        "--timeout",
        "120000",
      ],
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
