import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const scenarioPath = path.join(repoRoot, "examples/abyss-framework/playtests/replay.playtest.json");

test("executes the checked-in 30-second replay scenario", async ({ baseURL }) => {
  test.setTimeout(120_000);
  const source = await readFile(scenarioPath, "utf8");
  const scenario = JSON.parse(source) as {
    assert?: { movement?: unknown };
    steps: Array<{ holdTicks?: number; waitTicks?: number }>;
  };
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
