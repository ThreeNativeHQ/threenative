import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import { checkEvidenceBudget } from "../check-evidence-budget.js";

/**
 * PRD-323 Phase 0: the evidence budget. The gate bounds tracked bytes and file counts under
 * the evidence trees so growth fails at the commit that causes it. The unit tests pin the
 * failure shape on fixtures; the real-tree assertion pins the shipped caps against the actual
 * measurement, so a silent cap raise cannot hide a growth step.
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
        "docs/verification": { bytes: 1024, files: 100 },
      });
      expect(report.ok).toBe(false);
      expect(report.findings.join("\n")).toMatch(/docs\/verification/u);
      expect(report.findings.join("\n")).toMatch(/MB budget/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("should fail on the file cap before the byte cap matters", async () => {
    const root = await makeTempDir("evidence-budget-files-");
    try {
      await mkdir(path.join(root, "docs/verification"), { recursive: true });
      for (let index = 0; index < 3; index += 1) {
        await writeFile(path.join(root, "docs/verification", `run-${String(index)}.md`), "x");
      }
      spawnSync("git", ["init"], { cwd: root });
      spawnSync("git", ["add", "-A"], { cwd: root });
      const report = await checkEvidenceBudget(root, {
        "docs/verification": { bytes: 1024 * 1024, files: 2 },
      });
      expect(report.ok).toBe(false);
      expect(report.findings.join("\n")).toMatch(/tracks 3 file\(s\), over the 2 cap/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
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
