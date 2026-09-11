import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
    expect(producer).toContain("needs.scope.outputs.selection != 'prose'");
    expect(producer).not.toContain("needs.native-platforms");
    expect(producer).toContain("uses: ./.github/actions/workspace-dist");
    expect(producer).toContain("pnpm --filter abyss-framework build");
    expect(producer).toContain("pnpm exec tsx scripts/check-core-boundary.ts");
    expect(producer).toContain("pnpm tsx scripts/workspace-packages.ts --archives");
    expect(producer).toContain("name: workspace-packages");
    expect(producer).toContain("if-no-files-found: error");
  });

  it("keeps the protected build context as a fail-closed join, not a second build", () => {
    const gate = job("build");
    expect(declaredNeeds(gate)).toEqual(["scope", "build-artifacts", "native-platforms"]);
    expect(gate).toContain("!cancelled() && needs.scope.outputs.selection != 'prose'");
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
