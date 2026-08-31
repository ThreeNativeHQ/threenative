import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  publicWorkspacePackages,
  publishSetComment,
  workspaceBuildOrder,
  workspacePackages,
} from "../workspace-packages.js";

const repo = path.resolve(import.meta.dirname, "../..");

describe("workspace package lists", () => {
  it("keeps the release comment equal to the publishable manifests", async () => {
    const workflow = await readFile(path.join(repo, ".github/workflows/npm-release.yml"), "utf8");
    const block = workflow
      .match(
        /# BEGIN GENERATED WORKSPACE PUBLISH SET\n([\s\S]*?)# END GENERATED WORKSPACE PUBLISH SET/u,
      )?.[1]
      ?.replace(/^ {6}/gmu, "")
      .trim();
    expect(block).toBe(publishSetComment(repo));
  });

  it("makes CI and browser packing consume the manifest-driven list", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const playwright = await readFile(path.join(repo, "playwright.config.ts"), "utf8");
    expect(ci).toContain("pnpm tsx scripts/workspace-packages.ts build");
    expect(ci).not.toMatch(/pnpm --filter [^\n]+ run build/u);
    expect(ci).not.toContain("pnpm -r build");
    expect(playwright).toContain("localPackageEntries(repoRoot)");
    expect(playwright).not.toMatch(/const localPackages = \[/u);
    expect(workspaceBuildOrder(repo).map(({ name }) => name)).toContain("@threenative/assets");
    expect(workspaceBuildOrder(repo).map(({ name }) => name)).toContain("threenative-engine-mcp");
  });

  it("does not run unrelated root vitest paths from a package test script", async () => {
    const offenders: string[] = [];
    for (const item of workspacePackages(repo)) {
      const script = item.scripts.test ?? "";
      if (
        /pnpm\s+--dir\s+\.\.\/\.\.\s+exec\s+vitest|vitest\s+run[^\n]*\bpackages\//u.test(script)
      ) {
        offenders.push(item.name);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("builds a package's bundled workspace dependencies before the package itself", async () => {
    const order = workspaceBuildOrder(repo);
    const position = new Map(order.map((item, index) => [item.name, index]));
    const names = new Set(order.map(({ name }) => name));
    const inversions: string[] = [];
    for (const item of order) {
      const build = item.scripts.build ?? "";
      if (build.length === 0) continue;
      const sources = [build];
      for (const match of build.matchAll(/(?:^|\s)node\s+(\S+\.mjs)/gu)) {
        const script = path.join(item.directory, match[1] ?? "");
        sources.push(await readFile(script, "utf8").catch(() => ""));
      }
      const referenced = new Set(
        sources
          .join("\n")
          .match(/@threenative\/[a-z0-9-]+|create-threenative|threenative-engine-mcp/gu) ?? [],
      );
      for (const dependency of referenced) {
        if (dependency === item.name || !names.has(dependency)) continue;
        const before = position.get(dependency) ?? -1;
        const after = position.get(item.name) ?? -1;
        if (before > after) inversions.push(`${dependency} builds after ${item.name}`);
      }
    }
    expect(inversions).toEqual([]);
  });

  it("keeps the publishable set non-empty and unique", () => {
    const packages = publicWorkspacePackages(repo);
    expect(packages.length).toBeGreaterThan(0);
    expect(new Set(packages.map(({ name }) => name)).size).toBe(packages.length);
  });
});
