import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { LABS_TOOL_DIR, labsChildEnv } from "../performance-regression/cpu.js";
import {
  LOOP_CASES,
  LOOP_FRAMES,
  LOOP_SMALL,
  createLoopWorkload,
} from "../performance-regression/labs/workloads/loop-workload.js";
import {
  STATE_CASES,
  STATE_ONE,
  createStateWorkload,
} from "../performance-regression/labs/workloads/state-workload.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cpuArtifactRoot = path.join(repoRoot, "artifacts/engine-load-test/cpu");
const integration = process.env.TN_CPU_BENCH_INTEGRATION === "1";
const temporary: string[] = [];
const createdRuns: string[] = [];

function benchEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TN_CPU_BENCH_SOURCE: process.env.TN_CPU_BENCH_SOURCE ?? repoRoot,
    ...overrides,
  };
}

async function stubCheckout(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "tn-cpu-source-"));
  temporary.push(directory);
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(directory, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return directory;
}

afterAll(async () => {
  await Promise.all([
    ...temporary.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    ...createdRuns.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  ]);
});

describe("loop", () => {
  it("runs the selected checkout's fixed-step dispatch for 0, 32 and 256 callbacks", async () => {
    for (const loopCase of LOOP_CASES) {
      const workload = await createLoopWorkload(loopCase, benchEnv());
      try {
        expect(workload.run()).toBe(LOOP_FRAMES);
        expect(() => workload.verify()).not.toThrow();
      } finally {
        workload.dispose();
      }
    }
  });

  it("fails when the selected checkout never dispatches after physics", async () => {
    const stub = await stubCheckout({ "packages/core/src/loop.ts": WRONG_LOOP });
    const workload = await createLoopWorkload(LOOP_SMALL, {
      ...process.env,
      TN_CPU_BENCH_SOURCE: stub,
    });
    try {
      workload.run();
      expect(() => workload.verify()).toThrow();
    } finally {
      workload.dispose();
    }
  });
});

describe("state", () => {
  it("measures the selected checkout's coalesced writes for 0, 1 and 32 subscribers", async () => {
    for (const stateCase of STATE_CASES) {
      const workload = await createStateWorkload(stateCase, benchEnv());
      try {
        workload.run();
        expect(() => workload.verify()).not.toThrow();
      } finally {
        workload.dispose();
      }
    }
  });

  it("fails when the selected checkout never publishes coalesced writes", async () => {
    const stub = await stubCheckout({ "packages/core/src/state.ts": WRONG_STATE });
    const workload = await createStateWorkload(STATE_ONE, {
      ...process.env,
      TN_CPU_BENCH_SOURCE: stub,
    });
    try {
      workload.run();
      expect(() => workload.verify()).toThrow();
    } finally {
      workload.dispose();
    }
  });
});

describe("child environment", () => {
  it("keeps runtime basics and drops credentials, hooks and sentinels", () => {
    const env = labsChildEnv(
      {
        PATH: "/usr/bin:/bin",
        HOME: "/home/dev",
        TMPDIR: "/tmp",
        LANG: "en_US.UTF-8",
        TERM: "xterm-256color",
        TN_CPU_BENCH_BLOCKS: "2",
        TN_CPU_BENCH_SOURCE: "/repo",
        AWS_SECRET_ACCESS_KEY: "secret",
        GITHUB_TOKEN: "secret",
        NODE_OPTIONS: "--require /tmp/evil.cjs",
        NPM_TOKEN: "secret",
        SSH_AUTH_SOCK: "/tmp/agent.sock",
        TN_CPU_BENCH_SENTINEL: "secret",
      },
      { TN_CPU_BENCH_RESULTS_DIR: "labs/results", TN_CPU_BENCH_SOURCE: "/repo" },
    );
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.HOME).toBe("/home/dev");
    expect(env.TMPDIR).toBe("/tmp");
    expect(env.LANG).toBe("en_US.UTF-8");
    expect(env.TERM).toBe("xterm-256color");
    expect(env.TN_CPU_BENCH_BLOCKS).toBe("2");
    expect(env.TN_CPU_BENCH_SOURCE).toBe("/repo");
    expect(env.TN_CPU_BENCH_RESULTS_DIR).toBe("labs/results");
    for (const key of [
      "AWS_SECRET_ACCESS_KEY",
      "GITHUB_TOKEN",
      "NODE_OPTIONS",
      "NPM_TOKEN",
      "SSH_AUTH_SOCK",
      "TN_CPU_BENCH_SENTINEL",
    ]) {
      expect(env[key]).toBeUndefined();
    }
  });
});

const PROBE_BENCH = [
  'import { bench } from "@pmndrs/labs";',
  'import { writeFileSync } from "node:fs";',
  'import path from "node:path";',
  'import { fileURLToPath } from "node:url";',
  "",
  'const output = path.join(path.dirname(fileURLToPath(import.meta.url)), "env-probe.json");',
  "",
  'bench("env probe", function* () {',
  "  writeFileSync(",
  "    output,",
  "    JSON.stringify({",
  "      nodeOptions: process.env.NODE_OPTIONS ?? null,",
  "      npmToken: process.env.NPM_TOKEN ?? null,",
  "      sentinel: process.env.TN_CPU_BENCH_SENTINEL ?? null,",
  "      sshAgent: process.env.SSH_AUTH_SOCK ?? null,",
  "    }),",
  "  );",
  "  yield () => 1;",
  "});",
  "",
].join("\n");

const WRONG_LOOP = [
  "export function createAfterPhysicsPhase() {",
  "  const callbacks = new Set();",
  "  return {",
  "    clear() { callbacks.clear(); },",
  "    register(callback) { callbacks.add(callback); return () => callbacks.delete(callback); },",
  "    run(dt) {",
  '      if (!Number.isFinite(dt) || dt <= 0) throw new Error("bad dt");',
  "      for (const callback of callbacks) callback(dt);",
  "    },",
  "  };",
  "}",
  "",
  "export class FixedStepLoop {",
  "  constructor(options) { this.options = options; this.ticks = 0; }",
  "  tick() { return this.ticks; }",
  "  start() {}",
  "  stop() {}",
  "  stepFrame() {",
  "    this.ticks += 1;",
  "    this.options.onUpdate(this.options.step);",
  "    return 1;",
  "  }",
  "}",
  "",
].join("\n");

const WRONG_STATE = [
  "export function createGameStore(initial) {",
  "  const state = { ...initial };",
  "  return {",
  "    flush() {},",
  "    getPublishedState() { return state; },",
  "    getState() { return state; },",
  "    set() {},",
  "    stop() {},",
  "    subscribe() { return () => {}; },",
  "  };",
  "}",
  "",
].join("\n");

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

async function compatibleNode(executable: string): Promise<string | undefined> {
  if (path.resolve(executable) === path.resolve(process.execPath)) return process.versions.node;
  try {
    const { stdout } = await execFileAsync(executable, ["--version"]);
    return stdout.trim().replace(/^v/, "");
  } catch {
    return undefined;
  }
}

async function discoverLabsNode(): Promise<string | undefined> {
  const candidates = [process.env.TN_CPU_BENCH_NODE, process.execPath].filter(
    (value): value is string => value !== undefined && value.length > 0,
  );
  try {
    const nvm = path.join(homedir(), ".nvm/versions/node");
    for (const entry of await readdir(nvm)) candidates.push(path.join(nvm, entry, "bin/node"));
  } catch {
    // No nvm layout: the two explicit candidates above are the whole search.
  }
  for (const candidate of candidates) {
    const version = await compatibleNode(candidate);
    if (version !== undefined && Number(version.split(".")[0]) >= 22) return candidate;
  }
  return undefined;
}

async function tempBenchDirectory(): Promise<string> {
  const cache = path.join(LABS_TOOL_DIR, ".labs");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(path.join(cache, "tn-cpu-workloads-"));
  temporary.push(directory);
  return directory;
}

describe.skipIf(!integration)("child environment integration", () => {
  it("never passes an injected secret or hook to the real benchmark worker", async () => {
    const node = await discoverLabsNode();
    if (node === undefined) throw new Error("no Node >= 22 executable found for the Labs worker");
    const benches = await tempBenchDirectory();
    await writeFile(path.join(benches, "env-probe.bench.ts"), PROBE_BENCH);
    const result = await runCli(["--cpu", "--source", repoRoot, "--name", "env-probe"], {
      NODE_OPTIONS: "--max-old-space-size=2048",
      NPM_TOKEN: "npm-secret",
      SSH_AUTH_SOCK: "/tmp/tn-agent.sock",
      TN_CPU_BENCH_BENCH_DIR: benches,
      TN_CPU_BENCH_BLOCK_TIME: "0.05",
      TN_CPU_BENCH_BLOCKS: "1",
      TN_CPU_BENCH_MIN_SAMPLES: "2",
      TN_CPU_BENCH_NODE: node,
      TN_CPU_BENCH_SENTINEL: "sentinel-secret",
    });
    expect(result.stderr).not.toContain("TN_CPU_BENCH");
    expect(result.code).toBe(0);

    const entries = await readdir(cpuArtifactRoot).catch(() => [] as string[]);
    const last = entries
      .filter((entry) => entry.endsWith("-env-probe"))
      .sort()
      .at(-1);
    if (last !== undefined) createdRuns.push(path.join(cpuArtifactRoot, last));

    const probe = JSON.parse(await readFile(path.join(benches, "env-probe.json"), "utf8")) as {
      nodeOptions: string | null;
      npmToken: string | null;
      sentinel: string | null;
      sshAgent: string | null;
    };
    expect(probe.sentinel).toBeNull();
    expect(probe.npmToken).toBeNull();
    expect(probe.sshAgent).toBeNull();
    expect(probe.nodeOptions).toBeNull();
  });
});
