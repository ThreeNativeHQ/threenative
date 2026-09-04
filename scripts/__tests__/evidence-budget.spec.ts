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

  it("should fail an evidence file over the line cap", async () => {
    // PRD-323 Phase 5. A result buried in a 4,050-line file nobody opens does not exist, the way
    // a gate result living only in a commit message does not. The cap makes that a gate.
    const root = await makeTempDir("evidence-budget-lines-");
    try {
      await mkdir(path.join(root, "docs/verification"), { recursive: true });
      await writeFile(
        path.join(root, "docs/verification/long-run.md"),
        `${Array.from({ length: 40 }, (_, i) => `line ${String(i)}`).join("\n")}\n`,
      );
      spawnSync("git", ["init"], { cwd: root });
      spawnSync("git", ["add", "-A"], { cwd: root });
      const report = await checkEvidenceBudget(
        root,
        { "docs/verification": { bytes: 1024 * 1024, files: 100 } },
        20,
      );
      expect(report.ok).toBe(false);
      // 40 lines, reported as 40. The trailing newline is a line terminator, not a line: an
      // earlier version counted 41 here and the cap therefore enforced 999 rather than 1,000.
      expect(report.findings.join("\n")).toMatch(
        /long-run\.md' is 40 lines, over the 20-line cap/u,
      );
      expect(report.findings.join("\n")).toMatch(/consolidate it in place/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("should not apply the line cap to an exempt file", async () => {
    // The negative control for the rule above. `PRD-251-phase0.md` is 3,922 lines of third-party
    // source pinned from imsarah/threejs-world@398320e9, and PRD-251's live borrow map addresses
    // line ranges into it. The exemption is what stops the cap from deleting a live dependency.
    const root = await makeTempDir("evidence-budget-exempt-");
    try {
      await mkdir(path.join(root, "docs/verification"), { recursive: true });
      const body = `${Array.from({ length: 40 }, (_, i) => `line ${String(i)}`).join("\n")}\n`;
      await writeFile(path.join(root, "docs/verification/PRD-251-phase0.md"), body);
      spawnSync("git", ["init"], { cwd: root });
      spawnSync("git", ["add", "-A"], { cwd: root });
      const report = await checkEvidenceBudget(
        root,
        { "docs/verification": { bytes: 1024 * 1024, files: 100 } },
        20,
      );
      expect(report.ok, report.findings.join("; ")).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("should throw when an evidence file cannot be read, rather than reporting ok", async () => {
    // The byte walk uses `stat`, which needs only directory-traverse permission and follows
    // symlinks; the line cap needs `readFile`. A review probe put a tracked evidence file at
    // chmod 000 and an earlier version of this gate returned `ok: true` — it cannot know the
    // length of a file it cannot read, so it must fail rather than pass.
    const root = await makeTempDir("evidence-budget-unreadable-");
    const file = path.join(root, "docs/verification/run.md");
    try {
      await mkdir(path.join(root, "docs/verification"), { recursive: true });
      await writeFile(file, "evidence\n");
      spawnSync("git", ["init"], { cwd: root });
      spawnSync("git", ["add", "-A"], { cwd: root });
      const { chmod, readFile } = await import("node:fs/promises");
      await chmod(file, 0o000);
      let readable = true;
      try {
        await readFile(file, "utf8");
      } catch {
        readable = false;
      }
      // Running as a user that can read anything makes the probe vacuous rather than false.
      if (!readable) {
        await expect(
          checkEvidenceBudget(root, { "docs/verification": { bytes: 1024 * 1024, files: 100 } }),
        ).rejects.toThrow(/cannot read evidence file/u);
      }
      await chmod(file, 0o644);
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
