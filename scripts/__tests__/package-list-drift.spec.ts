import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { packageNameFromFlag } from "../../packages/create-threenative/src/index.js";
import {
  publicWorkspacePackages,
  publishSetComment,
  workspaceBuildOrder,
  workspacePackageSourceFlag,
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
    // The build moved behind `.github/actions/workspace-dist`, which is where the derived list is
    // now consumed and where the cache key that stands in for it is written. The point of this
    // assertion is that CI never enumerates packages by hand, and that holds wherever the single
    // call lives — so it follows the call rather than pinning the file it used to sit in.
    const workspaceDist = await readFile(
      path.join(repo, ".github/actions/workspace-dist/action.yml"),
      "utf8",
    );
    expect(`${ci}\n${workspaceDist}`).toContain("pnpm tsx scripts/workspace-packages.ts build");
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
          .match(/@threenative\/[a-z0-9-]+|create-threenative|threenative-[a-z0-9-]+-mcp/gu) ?? [],
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

  // Four places used to spell the same alias by hand: the CLI's flag map, the CLI's inverse, this
  // script's derivation, and CI's tarball action. A lane that added a package to three of them
  // failed in the fourth with TN_WORKSPACE_PACKAGE_FLAG_UNSUPPORTED, from a spec that had nothing
  // to do with packaging. The two code sides now round-trip, so they cannot disagree again.
  it("round-trips every workspace package through the scaffold source flag", () => {
    for (const { name } of workspacePackages(path.join(repo, "packages"))) {
      const flag = workspacePackageSourceFlag(name);
      expect(packageNameFromFlag(flag), `${name} -> ${flag}`).toBe(name);
    }
  });

  // CI derives the same flags in bash. A case statement that does not cover a workspace package
  // exits 1 with "unsupported workspace package" in a job that packs every tarball.
  it("teaches CI's tarball action every unscoped workspace package", async () => {
    const action = await readFile(
      path.join(repo, ".github/actions/scaffold-from-tarballs/action.yml"),
      "utf8",
    );
    for (const { name } of workspacePackages(path.join(repo, "packages"))) {
      if (name.startsWith("@threenative/")) continue;
      expect(action, name).toContain(`${name}) package_flag="${workspacePackageSourceFlag(name)}"`);
    }
  });

  it("keeps the publishable set non-empty and unique", () => {
    const packages = publicWorkspacePackages(repo);
    expect(packages.length).toBeGreaterThan(0);
    expect(new Set(packages.map(({ name }) => name)).size).toBe(packages.length);
  });
});
