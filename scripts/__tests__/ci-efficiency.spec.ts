import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ciJobGraph, declaredNeeds, jobSections } from "../ci-workflow.js";

const repo = path.resolve(import.meta.dirname, "../..");
const source = readFileSync(path.join(repo, ".github/workflows/ci.yml"), "utf8");
const jobs = new Map(jobSections(source));

function job(name: string): string {
  const section = jobs.get(name);
  if (section === undefined) throw new Error(`Missing CI job: ${name}`);
  return section;
}

function ancestors(name: string, visited = new Set<string>()): Set<string> {
  for (const upstream of declaredNeeds(job(name))) {
    if (visited.has(upstream)) continue;
    visited.add(upstream);
    ancestors(upstream, visited);
  }
  return visited;
}

function gateScript(): string {
  const match = /^ {8}run: \|\n((?:^ {10}.*\n|^\n)+)/mu.exec(job("build"));
  if (match?.[1] === undefined) throw new Error("build has no executable verdict assertion");
  return match[1].replace(/^ {10}/gmu, "");
}

function runGate(overrides: Record<string, string> = {}) {
  return spawnSync("bash", ["-c", gateScript()], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      CI_SCOPE_RESULT: "success",
      NATIVE_PLATFORM_RESULT: "success",
      WORKSPACE_BUILD_RESULT: "success",
      ...overrides,
    },
    timeout: 5_000,
  });
}

describe("CI efficiency without lost evidence", () => {
  it("produces workspace artifacts without waiting for native evidence", () => {
    const producer = job("build-artifacts");
    expect(declaredNeeds(producer)).toEqual(["scope"]);
    expect(producer).toContain("needs.scope.outputs.selection == 'full'");
    expect(producer).not.toContain("needs.native-platforms");
    expect(producer).toContain("uses: ./.github/actions/workspace-dist");
    expect(producer).toContain("pnpm --filter abyss-framework build");
    expect(producer).toContain("pnpm exec tsx scripts/check-core-boundary.ts");
    expect(producer).not.toContain("pnpm tsx scripts/workspace-packages.ts --archives");
    expect(
      readFileSync(path.join(repo, ".github/actions/workspace-dist/action.yml"), "utf8"),
    ).toContain("pnpm tsx scripts/workspace-packages.ts --archives");
    expect(producer).toContain("name: workspace-packages");
    expect(producer).toContain("if-no-files-found: error");
  });

  it("keeps the protected build context as a fail-closed join, not a second build", () => {
    const gate = job("build");
    expect(declaredNeeds(gate)).toEqual(["scope", "build-artifacts", "native-platforms"]);
    expect(gate).toContain("!cancelled() && needs.scope.outputs.selection == 'full'");
    expect(gate).toContain("CI_SCOPE_RESULT: ${{ needs.scope.result }}");
    expect(gate).toContain("WORKSPACE_BUILD_RESULT: ${{ needs.build-artifacts.result }}");
    expect(gate).toContain("NATIVE_PLATFORM_RESULT: ${{ needs.native-platforms.result }}");
    expect(gate).not.toMatch(/^ {4}name:/mu);
    expect(gate).not.toContain("continue-on-error");
    expect(gate).not.toContain("pnpm install");
    expect(gate).not.toContain("uses:");
  });

  it("accepts only a successful scope, workspace build, and native lane", () => {
    const result = runGate();
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  for (const variable of ["CI_SCOPE_RESULT", "WORKSPACE_BUILD_RESULT", "NATIVE_PLATFORM_RESULT"]) {
    it.each(["failure", "cancelled", "skipped", "neutral", "timed_out", ""])(
      `rejects ${variable}=%s instead of letting a skipped required check pass`,
      (result) => {
        const execution = runGate({ [variable]: result });
        expect(execution.error).toBeUndefined();
        expect(execution.status).not.toBe(0);
        expect(execution.status).not.toBeNull();
      },
    );
  }

  it.each(["golden-path-template", "template-nonvisual"])(
    "%s consumes this run's artifacts without a transitive native gate",
    (name) => {
      const consumer = job(name);
      expect(declaredNeeds(consumer)).toEqual(["scope", "build-artifacts"]);
      expect(consumer).toContain("actions/download-artifact");
      expect(consumer).toContain("name: workspace-packages");
      expect(ancestors(name).has("native-platforms")).toBe(false);
      expect(ancestors(name).has("build")).toBe(false);
    },
  );

  it.each(["benchmark", "budgets", "performance-contracts"])(
    "%s starts after scope rather than waiting for artifacts it never downloads",
    (name) => {
      expect(declaredNeeds(job(name))).toEqual(["scope"]);
      expect(ancestors(name).has("native-platforms")).toBe(false);
      if (name !== "performance-contracts") {
        expect(job(name)).toContain("uses: ./.github/actions/workspace-dist");
      }
    },
  );

  it("reports the new producer as well as every pre-existing job", () => {
    const graph = ciJobGraph(source);
    expect([...declaredNeeds(job("run-summary"))].sort()).toEqual(
      graph
        .map(({ name }) => name)
        .filter((name) => name !== "run-summary")
        .sort(),
    );
  });

  it.each(["android-emulator-parity", "desktop-parity"])(
    "%s restores the verified JS build without caching a native test verdict",
    (name) => {
      const native = new Map(
        jobSections(
          readFileSync(path.join(repo, ".github/workflows/native-platforms.yml"), "utf8"),
        ),
      );
      const section = native.get(name);
      if (section === undefined) throw new Error(`Missing native job: ${name}`);
      expect(section).toContain("uses: ./.github/actions/workspace-dist");
      expect(section).not.toContain("pnpm tsx scripts/workspace-packages.ts build");
      expect(section.indexOf("uses: ./.github/actions/workspace-dist")).toBeLessThan(
        section.indexOf("name: Capture browser references"),
      );
      expect(section).toContain("conformance/run-conformance.mjs");
      expect(section).toContain("check-lane-blocks.mjs");
    },
  );
});

describe("PRD-373 fail-closed required verdict", () => {
  function fullPlan(): Record<string, unknown> {
    const result = spawnSync(
      process.execPath,
      ["scripts/ci-change-scope.mjs", "--event", "push", "--format", "json"],
      { cwd: repo, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout) as Record<string, unknown>;
  }

  function verify(
    plan: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
    environment: Record<string, string> = {},
  ) {
    const jobs = plan.jobs as Record<string, { required: boolean }> | undefined;
    const needs: Record<string, unknown> = {
      scope: { result: "success", outputs: { plan: JSON.stringify(plan) } },
      ...Object.fromEntries(
        Object.entries(jobs ?? {}).map(([name, value]) => [
          name,
          { result: value.required ? "success" : "skipped" },
        ]),
      ),
      ...overrides,
    };
    return spawnSync(process.execPath, ["scripts/ci-required.mjs"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, TN_CI_NEEDS: JSON.stringify(needs), ...environment },
    });
  }

  it("accepts only a validated classifier and all selected successful jobs", () => {
    const result = verify(fullPlan());
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it.each(["failure", "cancelled", "skipped", "neutral", "timed_out", ""])(
    'rejects a selected job reporting "%s"',
    (result) => {
      const execution = verify(fullPlan(), { "test-native": { result } });
      expect(execution.status).toBe(1);
      expect(execution.stderr).toContain("CI_REQUIRED_JOB_NOT_SUCCESS: test-native");
    },
  );

  it("rejects a missing job, a failed classifier and an empty or forged plan", () => {
    expect(verify(fullPlan(), { "test-native": undefined }).stderr).toContain(
      "CI_REQUIRED_JOB_NOT_SUCCESS: test-native",
    );
    expect(verify(fullPlan(), { scope: { result: "failure" } }).stderr).toContain(
      "CI_REQUIRED_SCOPE_NOT_SUCCESS",
    );
    expect(verify({}).stderr).toContain("CI_SCOPE_INVALID_PLAN");
    const plan = fullPlan();
    plan.jobs = {};
    expect(verify(plan).stderr).toContain("CI_SCOPE_INVALID_PLAN");
  });

  it("rejects a PR verdict not checked out at the proposed head/base merge", () => {
    const result = verify(
      fullPlan(),
      {},
      {
        TN_CI_EVENT: "pull_request",
        TN_CI_BASE_SHA: "a".repeat(40),
        TN_CI_HEAD_SHA: "b".repeat(40),
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CI_REQUIRED_PR_CANDIDATE_MISMATCH");
  });

  it("requires frozen promotion refs or explicit hotfix refs after cutover", () => {
    const environment = {
      TN_CI_EVENT: "pull_request",
      TN_CI_CUTOVER: "true",
      TN_CI_BASE_REF: "main",
      TN_CI_HEAD_SHA: "a".repeat(40),
    };
    const feature = verify(
      fullPlan(),
      {},
      { ...environment, TN_CI_HEAD_REF: "feature/direct-main" },
    );
    expect(feature.status).toBe(1);
    expect(feature.stderr).toContain("CI_REQUIRED_PROMOTION_REF");
    const changedCandidate = verify(
      fullPlan(),
      {},
      { ...environment, TN_CI_HEAD_REF: `promotion/${"b".repeat(40)}` },
    );
    expect(changedCandidate.status).toBe(1);
    expect(changedCandidate.stderr).toContain("CI_REQUIRED_PROMOTION_REF");
  });

  it("maps every coverage job to the required verdict and rejects unregistered additions", () => {
    const coverage = ciJobGraph(source)
      .map(({ name }) => name)
      .filter((name) => !["scope", "ci-required", "run-summary"].includes(name))
      .sort();
    expect(Object.keys(fullPlan().jobs as object).sort()).toEqual(coverage);
    expect(
      declaredNeeds(job("ci-required"))
        .filter((name) => name !== "scope")
        .sort(),
    ).toEqual(coverage);
  });

  it("always evaluates and does not depend on advisory summary work", () => {
    const gate = job("ci-required");
    expect(gate).toContain("if: ${{ always() }}");
    expect(gate).toContain("toJSON(needs)");
    expect(gate).toContain("node scripts/ci-required.mjs");
    expect(gate).not.toContain("continue-on-error");
    expect(declaredNeeds(gate)).not.toContain("run-summary");
    expect(gate).not.toContain("pnpm install");
  });

  it.each(["typecheck", "test-unit", "benchmark", "budgets"])(
    "%s reuses bundles without repacking archives it does not consume",
    (name) => {
      expect(job(name)).toContain('pack-archives: "false"');
      expect(job("build-artifacts")).not.toContain('pack-archives: "false"');
    },
  );

  it("keeps the package-test build phase independent from cached workspace products", () => {
    expect(job("test")).toContain('TN_SUITE_PHASES: "docs,build,package-test"');
    expect(job("test")).not.toContain("uses: ./.github/actions/workspace-dist");
  });

  it("caches compiled bundles but always repacks and verifies shipped templates", () => {
    const action = readFileSync(
      path.join(repo, ".github/actions/workspace-dist/action.yml"),
      "utf8",
    );
    const cache = action.slice(
      action.indexOf("uses: actions/cache"),
      action.indexOf("- name:", action.indexOf("uses: actions/cache") + 1),
    );
    expect(cache).not.toContain("artifacts/workspace-packages");
    expect(cache).toContain("tsconfig.base.json");
    expect(cache).toContain("pnpm-workspace.yaml");
    const pack = action.slice(
      action.indexOf("- name: Pack current workspace files"),
      action.indexOf("- name: Check every bundling package"),
    );
    expect(pack).toContain("pnpm --filter");
    expect(pack).not.toContain("cache-hit");
    expect(action).toContain("bundle-engine-mcp.mjs");
  });
});

describe("PRD-373 fixed full candidates and current package products", () => {
  it("pins every worker checkout to the captured candidate, including reusable native jobs", () => {
    expect(job("scope")).toContain("vars.TN_DEVELOP_CI_ENABLED == 'true' && 'develop'");
    expect(source).toContain("github.event_name == 'pull_request' && 'latest' || github.run_id");
    for (const relative of [".github/workflows/ci.yml", ".github/workflows/native-platforms.yml"]) {
      const workflow = readFileSync(path.join(repo, relative), "utf8");
      for (const [name, section] of jobSections(workflow)) {
        if (name === "scope") continue;
        for (const checkout of section.split("uses: actions/checkout@").slice(1)) {
          const step = checkout.split(/^ {6}- /mu)[0] ?? "";
          expect(step, `${relative}: ${name}`).toContain(
            "ref: ${{ needs.scope.outputs.candidate_sha",
          );
        }
      }
    }
    const native = readFileSync(path.join(repo, ".github/workflows/native-platforms.yml"), "utf8");
    const scope = new Map(jobSections(native)).get("scope") ?? "";
    expect(scope).toContain('--validate-plan "$TN_CI_PLAN"');
    expect(scope).not.toContain("--base");
    expect(scope).toContain('--full --candidate-sha "$candidate"');
    expect(scope).toContain('grep -Fx "candidate_sha=$candidate"');
  });

  it("accepts a real frozen promotion merge and rejects a changed base", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ci-promotion-"));
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    try {
      git("init", "-q", "--initial-branch=main");
      git("config", "user.email", "ci@example.invalid");
      git("config", "user.name", "CI fixture");
      writeFileSync(path.join(root, "seed"), "seed");
      git("add", ".");
      git("commit", "-qm", "seed");
      git("checkout", "-qb", "develop");
      writeFileSync(path.join(root, "feature"), "feature");
      git("add", ".");
      git("commit", "-qm", "feature");
      const head = git("rev-parse", "HEAD");
      git("checkout", "-q", "main");
      writeFileSync(path.join(root, "base"), "base");
      git("add", ".");
      git("commit", "-qm", "base");
      const base = git("rev-parse", "HEAD");
      git("merge", "--no-ff", "-qm", "candidate", "develop");
      const scope = spawnSync(
        process.execPath,
        [path.join(repo, "scripts/ci-change-scope.mjs"), "--full", "--format", "json"],
        { cwd: root, encoding: "utf8" },
      );
      expect(scope.status, scope.stderr).toBe(0);
      const plan = JSON.parse(scope.stdout) as { jobs: Record<string, { required: boolean }> };
      const needs = {
        scope: { result: "success", outputs: { plan: scope.stdout } },
        ...Object.fromEntries(
          Object.entries(plan.jobs).map(([name, entry]) => [
            name,
            { result: entry.required ? "success" : "skipped" },
          ]),
        ),
      };
      const check = (baseSha: string) =>
        spawnSync(process.execPath, [path.join(repo, "scripts/ci-required.mjs")], {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            TN_CI_NEEDS: JSON.stringify(needs),
            TN_CI_EVENT: "pull_request",
            TN_CI_CUTOVER: "true",
            TN_CI_BASE_REF: "main",
            TN_CI_HEAD_REF: `promotion/${head}`,
            TN_CI_HEAD_SHA: head,
            TN_CI_BASE_SHA: baseSha,
          },
        });
      const valid = check(base);
      expect(valid.status, valid.stderr).toBe(0);
      const stale = check("d".repeat(40));
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain("CI_REQUIRED_PR_CANDIDATE_MISMATCH");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not label-exempt desktop parity after selecting the full family", () => {
    const native = readFileSync(path.join(repo, ".github/workflows/native-platforms.yml"), "utf8");
    const parity = new Map(jobSections(native)).get("desktop-parity") ?? "";
    expect(
      parity
        .split("\n")
        .filter((line) => !line.trim().startsWith("#"))
        .join("\n"),
    ).not.toContain("labels.*.name");
  });

  it("invalidates complete native products when the compiler image or dependency build inputs change", () => {
    const native = job("test-native");
    const cache =
      native.split("- name: Restore the compiled native tree")[1]?.split("\n      - ")[0] ?? "";
    expect(cache).toContain("steps.native-toolchain.outputs.identity");
    expect(cache).toContain("packages/runtime-native/scripts/**");
    expect(native).toContain("$ImageVersion");
    expect(native).toContain("c++ --version");
    expect(cache).not.toContain("restore-keys:");
  });

  it("repacks changed template bytes even when compiled bundles remain unchanged", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ci-repack-"));
    try {
      const actualPnpm = spawnSync("bash", ["-c", "command -v pnpm"], {
        encoding: "utf8",
      }).stdout.trim();
      expect(actualPnpm).not.toBe("");
      mkdirSync(path.join(root, "bin"));
      mkdirSync(path.join(root, "packages/starter/dist"), { recursive: true });
      mkdirSync(path.join(root, "packages/starter/templates"), { recursive: true });
      writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ private: true, packageManager: "pnpm@10.25.0" }),
      );
      writeFileSync(
        path.join(root, "packages/starter/package.json"),
        JSON.stringify({
          name: "@fixture/starter",
          version: "1.0.0",
          files: ["dist", "templates"],
        }),
      );
      writeFileSync(path.join(root, "packages/starter/dist/index.js"), "// unchanged bundle\n");
      writeFileSync(
        path.join(root, "bin/pnpm"),
        '#!/bin/sh\nif [ "$1" = tsx ]; then printf "@fixture/starter\\tfixture-starter-\\n"; else exec "$TN_REAL_PNPM" "$@"; fi\n',
      );
      chmodSync(path.join(root, "bin/pnpm"), 0o755);
      const action = readFileSync(
        path.join(repo, ".github/actions/workspace-dist/action.yml"),
        "utf8",
      );
      const step = action.slice(
        action.indexOf("- name: Pack current workspace files"),
        action.indexOf("- name: Check every bundling package"),
      );
      const shell = step.split("      run: |\n")[1]?.replace(/^ {8}/gmu, "");
      expect(shell).toBeDefined();
      for (const bytes of ["old template", "current template"]) {
        writeFileSync(path.join(root, "packages/starter/templates/main.ts"), bytes);
        const result = spawnSync("bash", ["-c", shell ?? "exit 1"], {
          cwd: root,
          encoding: "utf8",
          timeout: 20_000,
          env: {
            ...process.env,
            PATH: `${root}/bin:${process.env.PATH}`,
            TN_REAL_PNPM: actualPnpm,
          },
        });
        expect(result.status, result.stdout + result.stderr).toBe(0);
        const unpacked = spawnSync(
          "tar",
          [
            "-xOf",
            "artifacts/workspace-packages/fixture-starter-1.0.0.tgz",
            "package/templates/main.ts",
          ],
          { cwd: root, encoding: "utf8" },
        );
        expect(unpacked.status, unpacked.stderr).toBe(0);
        expect(unpacked.stdout).toBe(bytes);
      }
      expect(readFileSync(path.join(root, "packages/starter/dist/index.js"), "utf8")).toBe(
        "// unchanged bundle\n",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
