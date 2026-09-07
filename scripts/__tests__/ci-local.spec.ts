import { spawnSync } from "node:child_process";
import { access, chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";

const repo = path.resolve(import.meta.dirname, "../..");
const localRunner = path.join(repo, "scripts", "ci-local.sh");
const suiteRunner = path.join(repo, "scripts", "run-test-suite.sh");

async function prebuiltOutputTargets(): Promise<readonly string[]> {
  const packageDirectories = await readdir(path.join(repo, "packages"), {
    withFileTypes: true,
  });
  const targets: string[] = [];
  for (const entry of packageDirectories) {
    if (!entry.isDirectory()) continue;
    const config = path.join(repo, "packages", entry.name, "tsup.config.ts");
    if (
      await access(config)
        .then(() => true)
        .catch(() => false)
    ) {
      targets.push(path.join(repo, "packages", entry.name, "dist", "index.js"));
    }
  }
  return [
    ...targets,
    path.join(repo, "packages/playtest/dist/runner/cli.js"),
    path.join(repo, "site/dist/client/index.html"),
  ];
}

async function recorderRoot(): Promise<{
  readonly bin: string;
  readonly root: string;
  readonly trace: string;
}> {
  const root = await makeTempDir("ci-local-recorder-");
  const bin = path.join(root, "bin");
  const trace = path.join(root, "trace.log");
  await mkdir(bin, { recursive: true });
  await writeFile(
    path.join(bin, "pnpm"),
    [
      "#!/bin/sh",
      'printf \'%s\\t%s\\t%s\\n\' "$*" "${TN_SUITE_PREBUILT:-0}" "${TN_SUITE_PHASES:-}" >> "$TN_CI_LOCAL_TRACE"',
      'if [ "${TN_CI_LOCAL_FAIL:-}" = "$1" ]; then exit 19; fi',
      "exit 0",
      "",
    ].join("\n"),
  );
  await chmod(path.join(bin, "pnpm"), 0o755);
  return { bin, root, trace };
}

async function runLocal(
  only = "",
  failCommand = "",
): Promise<{
  readonly output: string;
  readonly status: number | null;
  readonly trace: readonly string[];
  readonly root: string;
}> {
  const fixture = await recorderRoot();
  const logRoot = path.join(fixture.root, "logs");
  const result = spawnSync(localRunner, only.length === 0 ? [] : [only], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture.bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      TN_CI_LOCAL_FAIL: failCommand,
      TN_CI_LOCAL_LOGS: logRoot,
      TN_CI_LOCAL_TRACE: fixture.trace,
    },
  });
  const trace = (await readFile(fixture.trace, "utf8").catch(() => ""))
    .split("\n")
    .filter((line) => line.length > 0);
  return {
    output: `${result.stdout}\n${result.stderr}`,
    root: fixture.root,
    status: result.status,
    trace,
  };
}

describe("ci-local build contract", () => {
  it("should build once before the prebuilt suite in the full local board", async () => {
    const source = await readFile(localRunner, "utf8");
    const result = await runLocal();
    try {
      expect(result.status, result.output).toBe(0);
      expect(result.trace[0]).toMatch(/^build\t/u);
      expect(result.trace.find((line) => line.startsWith("test\t"))).toContain(
        "\t1\tdocs,package-test,unit",
      );
      expect(source).toContain("pnpm build");
      expect(source).toContain(
        "TN_SUITE_PREBUILT=1 TN_SUITE_PHASES=docs,package-test,unit pnpm test",
      );
    } finally {
      await rm(result.root, { force: true, recursive: true });
    }
  });

  it("should build prerequisites when only test is selected", async () => {
    const result = await runLocal("test");
    try {
      expect(result.status, result.output).toBe(0);
      expect(result.trace.map((line) => line.split("\t", 1)[0])).toEqual([
        "build",
        "exec tsx scripts/check-core-boundary.ts",
        "test",
      ]);
    } finally {
      await rm(result.root, { force: true, recursive: true });
    }
  });

  it("should fail when the prerequisite build fails", async () => {
    const result = await runLocal("test", "build");
    try {
      expect(result.status, result.output).not.toBe(0);
      expect(result.trace.map((line) => line.split("\t", 1)[0])).toEqual(["build"]);
      expect(result.output).toContain("test             skipped (build failed)");
    } finally {
      await rm(result.root, { force: true, recursive: true });
    }
  });

  it("should reject an unknown local job rather than reporting an empty pass", async () => {
    const result = await runLocal("not-a-job");
    try {
      expect(result.status).toBe(2);
      expect(result.output).toContain("TN_CI_LOCAL_UNKNOWN_JOB");
      expect(result.trace).toEqual([]);
    } finally {
      await rm(result.root, { force: true, recursive: true });
    }
  });

  it("should reject prebuilt execution when required outputs are missing", async () => {
    const fixture = await recorderRoot();
    const statusPath = path.join(fixture.root, "status.json");
    const hidden: { readonly original: string; readonly stashed: string }[] = [];
    try {
      for (const [index, original] of (await prebuiltOutputTargets()).entries()) {
        try {
          const stashed = `${original}.ci-local-hidden-${String(process.pid)}-${String(index)}`;
          await rename(original, stashed);
          hidden.push({ original, stashed });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      const result = spawnSync(
        "bash",
        [suiteRunner, "--status-path", statusPath, "--run-id", "ci-local-test"],
        {
          cwd: repo,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${fixture.bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
            TN_CI_LOCAL_TRACE: fixture.trace,
            TN_SUITE_PHASES: "package-test",
            TN_SUITE_PREBUILT: "1",
          },
        },
      );
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("TN_SUITE_PREBUILT_MISSING");
    } finally {
      for (const { original, stashed } of hidden.reverse()) await rename(stashed, original);
      await rm(fixture.root, { force: true, recursive: true });
    }
  });
});
