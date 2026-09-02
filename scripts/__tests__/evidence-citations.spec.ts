import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import { classifyEvidence } from "../evidence-citations.js";

/**
 * PRD-323 Phase 1: the citation scanner. An artifact is what cites it; an artifact the scanner
 * cannot read throws rather than defaulting. The fixtures pin the classification flip the
 * retention policy is built on: remove the citation, the classification flips.
 */

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function fixture(): Promise<string> {
  const root = await makeTempDir("evidence-citations-");
  roots.push(root);
  spawnSync("git", ["init"], { cwd: root });
  await mkdir(path.join(root, "docs/verification"), { recursive: true });
  await mkdir(path.join(root, "docs/PRDs/done"), { recursive: true });
  await mkdir(path.join(root, "scripts"), { recursive: true });
  return root;
}

async function track(root: string): Promise<void> {
  spawnSync("git", ["add", "-A"], { cwd: root });
}

describe("classifyEvidence", () => {
  it("should classify an artifact as cited by a done PRD that names it", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "docs/verification/run-1.md"), "evidence bytes");
    await writeFile(
      path.join(root, "docs/PRDs/done/PRD-001.md"),
      "see the record docs/verification/run-1.md",
    );
    await track(root);

    const { scan } = await classifyEvidence(root);
    const artifact = scan.find((entry) => entry.path === "docs/verification/run-1.md");
    expect(artifact?.classification).toBe("cited-by-done-prd");
  });

  it("should flip an artifact to uncited when the citation is removed", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "docs/verification/run-1.md"), "evidence bytes");
    await writeFile(
      path.join(root, "docs/PRDs/done/PRD-001.md"),
      "see the record docs/verification/run-1.md",
    );
    await track(root);
    const before = await classifyEvidence(root);
    expect(before.scan.find((a) => a.path === "docs/verification/run-1.md")?.classification).toBe(
      "cited-by-done-prd",
    );

    // Remove the citation; the classification must flip.
    await writeFile(path.join(root, "docs/PRDs/done/PRD-001.md"), "no citations remain");
    const after = await classifyEvidence(root);
    expect(after.scan.find((a) => a.path === "docs/verification/run-1.md")?.classification).toBe(
      "uncited",
    );
  });

  it("should throw when a citation source is unreadable rather than defaulting", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "scripts/gate.ts"), "const evidence = 'run-1.md';");
    await writeFile(path.join(root, "docs/verification/run-1.md"), "bytes");
    await track(root);
    // A source that vanishes between listing and reading must fail the scan, not skip silently.
    const original = classifyEvidence(root);
    await expect(original).resolves.toBeDefined();
    // Directly: a source file listed by git but deleted on disk makes the scanner throw.
    const { spawnSync: spawn } = await import("node:child_process");
    spawn("git", ["rm", "--cached", "-q", "docs/verification/run-1.md"], { cwd: root });
    await writeFile(path.join(root, "scripts/gate.ts"), "cites run-1.md");
    spawnSync("git", ["add", "-A"], { cwd: root });
    const { unlink } = await import("node:fs/promises");
    await unlink(path.join(root, "docs/verification/run-1.md"));
    // git ls-files still lists the deleted file; the scan must refuse to classify it.
    await expect(classifyEvidence(root)).rejects.toThrow(/cannot be classified/u);
  });
});
