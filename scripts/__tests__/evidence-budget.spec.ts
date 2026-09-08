import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import { checkEvidenceBudget, duplicateImageInventory } from "../check-evidence-budget.js";

/**
 * The evidence budget keeps tracked-byte limits and generated-instruction protection hard while
 * reporting file and duplicate measurements for cleanup. The real CLI fixtures below ensure
 * adding long or numerous evidence records does not require bookkeeping repairs first.
 */

describe("checkEvidenceBudget", () => {
  it("should fail when tracked evidence exceeds the budget, naming the tree", async () => {
    const root = await makeTempDir("evidence-budget-over-");
    try {
      await mkdir(path.join(root, "docs/verification"), { recursive: true });
      await writeFile(
        path.join(root, "docs/verification/big.png"),
        Buffer.alloc(64 * 1024 * 1024, 1),
      );
      // The gate reads `git ls-files`, so the fixture needs a repository.
      spawnSync("git", ["init"], { cwd: root });
      spawnSync("git", ["add", "-A"], { cwd: root });
      const report = await checkEvidenceBudget(root, {
        "docs/verification": { bytes: 1024 },
      });
      expect(report.ok).toBe(false);
      expect(report.findings.join("\n")).toMatch(/docs\/verification/u);
      expect(report.findings.join("\n")).toMatch(/MB budget/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("should accept a long evidence record when total bytes remain within the cap", async () => {
    const root = await makeTempDir("evidence-budget-files-");
    try {
      await mkdir(path.join(root, "docs/verification"), { recursive: true });
      await writeFile(
        path.join(root, "docs/verification", "long-run.md"),
        `${Array.from({ length: 1200 }, (_, index) => `evidence line ${String(index)}`).join("\n")}\n`,
      );
      spawnSync("git", ["init"], { cwd: root });
      spawnSync("git", ["add", "-A"], { cwd: root });
      const result = runEvidenceCli(root);
      expect(result.status, result.output).toBe(0);
      expect(result.output).toMatch(/1 tracked file\(s\)/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("should accept many small files when total bytes remain within the cap", async () => {
    const root = await makeTempDir("evidence-budget-many-");
    try {
      await mkdir(path.join(root, "docs/verification"), { recursive: true });
      for (let index = 0; index < 701; index += 1) {
        await writeFile(
          path.join(root, "docs/verification", `run-${String(index)}.md`),
          "evidence\n",
        );
      }
      spawnSync("git", ["init"], { cwd: root });
      spawnSync("git", ["add", "-A"], { cwd: root });
      const result = runEvidenceCli(root);
      expect(result.status, result.output).toBe(0);
      expect(result.output).toMatch(/701 tracked file\(s\)/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("should fail when a scaffolded sweep instruction file is tracked", async () => {
    // PRD-357 F3. `git ls-files` does not say what a spec reads, so the untracking was proven by
    // running the suite inside `git archive HEAD`; this is what stops one coming back. A sweep
    // arm's `AGENTS.md` describes a game that no longer exists, and a "closest AGENTS.md" walk
    // that lands on it reads it as binding.
    const root = await makeTempDir("evidence-budget-sweep-");
    try {
      await mkdir(path.join(root, "docs/benchmark/sweeps/fps-2026-08-17"), { recursive: true });
      await writeFile(
        path.join(root, "docs/benchmark/sweeps/fps-2026-08-17/AGENTS.md"),
        "# AGENTS.md — fps-framework\n",
      );
      spawnSync("git", ["init"], { cwd: root });
      spawnSync("git", ["add", "-Af"], { cwd: root });
      const report = await checkEvidenceBudget(root, {
        "docs/benchmark": { bytes: 1024 * 1024 },
      });
      expect(report.ok).toBe(false);
      expect(report.findings.join("\n")).toMatch(
        /tracks 1 scaffolded sweep instruction file\(s\) — docs\/benchmark\/sweeps\/fps-2026-08-17\/AGENTS\.md/u,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("should report duplicate tracked bytes without applying a duplicate cap", async () => {
    // PRD-357 F4. Duplicate content remains visible to cleanup tooling, but it no longer blocks
    // an otherwise byte-compliant evidence change.
    const root = await makeTempDir("evidence-budget-duplicates-");
    try {
      await mkdir(path.join(root, "docs/benchmark/a"), { recursive: true });
      await mkdir(path.join(root, "docs/benchmark/b"), { recursive: true });
      const blob = Buffer.alloc(4096, 7);
      await writeFile(path.join(root, "docs/benchmark/a/reference.png"), blob);
      await writeFile(path.join(root, "docs/benchmark/b/reference.png"), blob);
      await writeFile(path.join(root, "docs/benchmark/b/unique.png"), Buffer.alloc(4096, 9));
      spawnSync("git", ["init"], { cwd: root });
      spawnSync("git", ["add", "-A"], { cwd: root });

      const report = await checkEvidenceBudget(root, {
        "docs/benchmark": { bytes: 1024 * 1024 },
      });
      expect(report.ok, report.findings.join("; ")).toBe(true);

      // The redundant copy, not the content: one 4,096-byte blob at two paths is 4,096 bytes
      // duplicate, not 8,192.
      const [tree] = report.trees;
      expect(tree?.duplicateBytes).toBe(4096);
      expect(tree?.duplicateGroups).toBe(1);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("should include duplicate images that cross evidence trees in the inventory", async () => {
    const root = await makeTempDir("evidence-budget-cross-tree-");
    try {
      await mkdir(path.join(root, "docs/verification"), { recursive: true });
      await mkdir(path.join(root, "docs/benchmark"), { recursive: true });
      const blob = Buffer.alloc(4096, 7);
      await writeFile(path.join(root, "docs/verification/proof.png"), blob);
      await writeFile(path.join(root, "docs/benchmark/proof.png"), blob);
      spawnSync("git", ["init"], { cwd: root });
      spawnSync("git", ["add", "-A"], { cwd: root });

      const inventory = duplicateImageInventory(root, ["docs/verification", "docs/benchmark"]);
      expect(inventory.bytes).toBe(4096);
      expect(inventory.groups).toHaveLength(1);
      expect(inventory.groups[0]).toMatchObject({
        canonical: "docs/benchmark/proof.png",
        copies: 2,
        remove: ["docs/verification/proof.png"],
        size: 4096,
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("should default the image inventory to every tracked path", async () => {
    const root = await makeTempDir("evidence-budget-global-images-");
    try {
      await mkdir(path.join(root, "docs/verification"), { recursive: true });
      await mkdir(path.join(root, "packages/create-threenative/templates/starter"), {
        recursive: true,
      });
      const blob = Buffer.alloc(4096, 7);
      await writeFile(path.join(root, "docs/verification/proof.png"), blob);
      await writeFile(
        path.join(root, "packages/create-threenative/templates/starter/icon.png"),
        blob,
      );
      spawnSync("git", ["init"], { cwd: root });
      spawnSync("git", ["add", "-A"], { cwd: root });

      const inventory = duplicateImageInventory(root);
      expect(inventory.groups).toHaveLength(1);
      expect(inventory.groups[0]?.files).toEqual([
        "docs/verification/proof.png",
        "packages/create-threenative/templates/starter/icon.png",
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("should track no scaffolded sweep instruction file in the real tree", async () => {
    // PRD-357 A4's mutation runs against this: `git add -f` one of the 26 files back and the
    // gate fails. They stay on disk and stay ignored.
    const tracked = spawnSync(
      "git",
      ["ls-files", "docs/benchmark/sweeps/*/AGENTS.md", "docs/benchmark/sweeps/*/CLAUDE.md"],
      { encoding: "utf8" },
    );
    expect(tracked.stdout.trim()).toBe("");
  });

  it("should pass the real tree under the shipped caps", async () => {
    // The shipped caps are growth stops set at the 2026-09-02 measurement with headroom; this
    // is the assertion that runs in pnpm budgets. A cap raise needs its own commit saying why.
    const { execSync } = await import("node:child_process");
    const tracked = spawnSync("git", ["ls-files", "docs"], { encoding: "utf8" });
    if (tracked.stdout.trim().length === 0) return; // not a git checkout; skip
    void execSync;
    const report = await checkEvidenceBudget(process.cwd());
    expect(report.ok, report.findings.join("; ")).toBe(true);
  });
});

function runEvidenceCli(root: string): { readonly output: string; readonly status: number | null } {
  const repositoryRoot = process.cwd();
  const result = spawnSync(
    path.join(repositoryRoot, "node_modules/.bin/tsx"),
    [path.join(repositoryRoot, "scripts/check-evidence-budget.ts")],
    { cwd: root, encoding: "utf8" },
  );
  return {
    output: `${result.stdout}\n${result.stderr}`,
    status: result.status,
  };
}
