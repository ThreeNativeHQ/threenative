import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { LABS_TOOL_DIR } from "../performance-regression/cpu.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cpuArtifactRoot = path.join(repoRoot, "artifacts/engine-load-test/cpu");
const integration = process.env.TN_CPU_BENCH_INTEGRATION === "1";
const createdRuns: string[] = [];
const temporary: string[] = [];

interface ICliResult {
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}

async function runCli(args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<ICliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "pnpm",
      ["exec", "tsx", "scripts/engine-load-test/cli.ts", ...args],
      {
        cwd: repoRoot,
        env: { ...process.env, ...env },
        maxBuffer: 32 * 1024 * 1024,
        timeout: 240_000,
      },
    );
    return { code: 0, stderr, stdout };
  } catch (error) {
    const failure = error as { code?: unknown; killed?: boolean; stderr?: string; stdout?: string };
    return {
      code: failure.killed === true ? 124 : typeof failure.code === "number" ? failure.code : 1,
      stderr: failure.stderr ?? "",
      stdout: failure.stdout ?? "",
    };
  }
}

function major(version: string): number {
  return Number(version.replace(/^v/, "").split(".")[0]);
}

async function compatibleNodeVersion(executable: string): Promise<string | undefined> {
  if (path.resolve(executable) === path.resolve(process.execPath)) return process.versions.node;
  try {
    const { stdout } = await execFileAsync(executable, ["--version"]);
    return stdout.trim().replace(/^v/, "");
  } catch {
    return undefined;
  }
}

/** Test-only locator so the fixed proof command runs on a machine whose default Node is 20. */
async function discoverLabsNode(): Promise<string | undefined> {
  const candidates = [process.env.TN_CPU_BENCH_NODE, process.execPath].filter(
    (value): value is string => value !== undefined && value.length > 0,
  );
  try {
    const nvm = path.join(homedir(), ".nvm/versions/node");
    for (const entry of await readdir(nvm)) candidates.push(path.join(nvm, entry, "bin/node"));
  } catch {
    // No nvm layout on this machine; the two explicit candidates above are the whole search.
  }
  for (const candidate of candidates) {
    const version = await compatibleNodeVersion(candidate);
    if (version !== undefined && major(version) >= 22) return candidate;
  }
  return undefined;
}

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "tn-cpu-cli-"));
  temporary.push(directory);
  return directory;
}

/**
 * A smoke workload must sit under the isolated profile so it can resolve `@pmndrs/labs`, but
 * outside `node_modules` so tsx transforms it and keeps one module graph with the worker.
 */
async function tempBenchDirectory(): Promise<string> {
  const cache = path.join(LABS_TOOL_DIR, ".labs");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(path.join(cache, "tn-cpu-bench-"));
  temporary.push(directory);
  return directory;
}

async function writeProbeWorkload(directory: string): Promise<void> {
  await writeFile(
    path.join(directory, "probe.bench.ts"),
    [
      'import { bench } from "@pmndrs/labs";',
      "",
      'bench("probe", () => {',
      "  let sum = 0;",
      "  for (let index = 0; index < 1000; index++) sum += index;",
      "  return sum;",
      "});",
      "",
    ].join("\n"),
  );
}

async function latestRun(suffix: string): Promise<string | undefined> {
  const entries = await readdir(cpuArtifactRoot).catch(() => [] as string[]);
  const matches = entries.filter((entry) => entry.endsWith(suffix)).sort();
  const last = matches.at(-1);
  if (last === undefined) return undefined;
  const directory = path.join(cpuArtifactRoot, last);
  createdRuns.push(directory);
  return directory;
}

afterAll(async () => {
  await Promise.all([
    ...temporary.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    ...createdRuns.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  ]);
});

describe("compatibility", () => {
  it("keeps the ordinary hardware usage output", async () => {
    const result = await runCli([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("usage: pnpm bench:engines --arm");
  });

  it("fails closed before Labs when --cpu omits its source", async () => {
    const result = await runCli(["--cpu"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("TN_CPU_BENCH_SOURCE_REQUIRED");
  });

  it("fails closed when the selected Node is below the Labs floor", async () => {
    const result = await runCli(["--cpu", "--source", repoRoot, "--name", "compat"], {
      TN_CPU_BENCH_NODE: path.join(repoRoot, "does-not-exist-node"),
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("TN_CPU_BENCH_NODE_UNSUPPORTED");
  });
});

describe.skipIf(!integration)("integration", () => {
  it("launches the installed worker and records a result", async () => {
    const node = await discoverLabsNode();
    if (node === undefined) throw new Error("no Node >= 22 executable found for the Labs worker");
    const benches = await tempBenchDirectory();
    await writeProbeWorkload(benches);
    const result = await runCli(["--cpu", "--source", repoRoot, "--name", "integration-smoke"], {
      TN_CPU_BENCH_BENCH_DIR: benches,
      TN_CPU_BENCH_BLOCK_TIME: "0.05",
      TN_CPU_BENCH_BLOCKS: "2",
      TN_CPU_BENCH_INTEGRATION: "1",
      TN_CPU_BENCH_MIN_SAMPLES: "5",
      TN_CPU_BENCH_NODE: node,
    });
    expect(result.stderr).not.toContain("TN_CPU_BENCH");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("CPU capture recorded");

    const runDirectory = await latestRun("-integration-smoke");
    expect(runDirectory).toBeDefined();
    const provenance = JSON.parse(
      await readFile(path.join(runDirectory as string, "provenance.json"), "utf8"),
    ) as {
      benchmarkCount: number;
      labsVersion: string;
      resultFile: string;
      source: { path: string };
    };
    expect(provenance.benchmarkCount).toBeGreaterThan(0);
    expect(provenance.labsVersion).toBe("0.9.0");
    expect(provenance.source.path).toBe(repoRoot);
    expect(existsSync(path.join(repoRoot, provenance.resultFile))).toBe(true);
  });

  it("returns a specific actionable failure when no workload is discovered", async () => {
    const node = await discoverLabsNode();
    if (node === undefined) throw new Error("no Node >= 22 executable found for the Labs worker");
    const empty = await tempDirectory();
    const result = await runCli(["--cpu", "--source", repoRoot, "--name", "integration-empty"], {
      TN_CPU_BENCH_BENCH_DIR: empty,
      TN_CPU_BENCH_NODE: node,
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/TN_CPU_BENCH_(RUN_FAILED|NO_RESULT|EMPTY_RESULT)/);
    const runDirectory = await latestRun("-integration-empty");
    if (runDirectory !== undefined) {
      expect(existsSync(path.join(runDirectory, "provenance.json"))).toBe(false);
    }
  });
});
