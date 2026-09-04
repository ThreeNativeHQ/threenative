import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

  it("should classify a tree a script opens as a directory root as cited by that reader", async () => {
    // PRD-323 Phase 3. `scripts/visual-gate.ts` opens `docs/verification/visuals` as a root and
    // resolves what is inside at run time, so no source ever names those files. A by-name scan
    // called all 40 of them uncited, and deleting them would have destroyed every visual
    // baseline `pnpm visuals` compares against while the gate stayed green.
    const root = await fixture();
    await mkdir(path.join(root, "docs/verification/visuals"), { recursive: true });
    await writeFile(path.join(root, "docs/verification/visuals/starter.png"), "pixels");
    // Nothing names the file — the reader globs the directory.
    await writeFile(path.join(root, "docs/PRDs/done/PRD-001.md"), "no citations remain");
    await track(root);

    const { scan } = await classifyEvidence(root);
    const baseline = scan.find((a) => a.path === "docs/verification/visuals/starter.png");
    expect(baseline?.classification).toBe("cited-by-script");
    expect(baseline?.citedBy).toContain("scripts/visual-gate.ts");
  });

  it("should claim only the reader's own glob when a walked root names a basename pattern", async () => {
    // `sweep-delta.ts` globs `docs/verification/sweep-*.md` and matches each one's `Archive:`
    // field. Deleting one made `sweep-delta.spec.ts` throw "missing verification ledger for the
    // archive" — so the ledger is cited. But the root is `docs/verification` itself, so an entry
    // without the pattern would exempt the entire tree and gut the policy.
    const root = await fixture();
    await writeFile(path.join(root, "docs/verification/sweep-platformer-2026-08-05-r2.md"), "x");
    await writeFile(path.join(root, "docs/verification/some-other-run.md"), "x");
    await writeFile(path.join(root, "docs/PRDs/done/PRD-001.md"), "no citations remain");
    await track(root);

    const { scan } = await classifyEvidence(root);
    expect(
      scan.find((a) => a.path === "docs/verification/sweep-platformer-2026-08-05-r2.md")
        ?.classification,
    ).toBe("cited-by-script");
    expect(scan.find((a) => a.path === "docs/verification/some-other-run.md")?.classification).toBe(
      "uncited",
    );
  });

  it("should claim a measurement component inside every sweep archive, and nothing else", async () => {
    // A review probe found 282 artifacts (72.3 MB) under `docs/benchmark/sweeps` classified
    // `uncited` — captures, playtests, screenshots — the `docs/verification/visuals` bug one tree
    // over. `sweep-evidence.ts:84-94` names these components; each is opened as a root by a real
    // script and never named file-by-file. The archive name is a wildcard, which is why neither a
    // plain root nor a basename pattern expresses it.
    const root = await fixture();
    const archive = "docs/benchmark/sweeps/platformer-2026-08-06";
    await mkdir(path.join(root, archive, "captures"), { recursive: true });
    await mkdir(path.join(root, archive, "src"), { recursive: true });
    await writeFile(path.join(root, archive, "captures/frame-0.png"), "pixels");
    await writeFile(path.join(root, archive, "src/main.ts"), "// generated arm source");
    await writeFile(path.join(root, "docs/PRDs/done/PRD-001.md"), "no citations remain");
    await track(root);

    const { scan } = await classifyEvidence(root);
    expect(scan.find((a) => a.path === `${archive}/captures/frame-0.png`)?.classification).toBe(
      "cited-by-script",
    );
    // The negative control: an arm source is not a measurement. It is normally untracked, but if
    // one is force-added the entry must not shelter it — otherwise the rule claims the whole tree.
    expect(scan.find((a) => a.path === `${archive}/src/main.ts`)?.classification).toBe("uncited");
  });

  it("should throw when an evidence write-up cannot be read, rather than losing its links", async () => {
    // A review probe disproved the original justification for skipping here: `stat` follows
    // symlinks and needs only directory-traverse permission, so `classifyEvidence`'s byte walk
    // succeeds on a file `readFile` cannot open. The scan returned no error and the write-up's
    // attachment classified `uncited` — a live artifact marked deletable.
    const root = await fixture();
    await mkdir(path.join(root, "docs/verification/prd-999-run"), { recursive: true });
    await writeFile(path.join(root, "docs/verification/prd-999-run/brief.txt"), "the brief");
    const report = path.join(root, "docs/verification/prd-999.md");
    await writeFile(report, "the report: [brief](prd-999-run/brief.txt)");
    await track(root);
    await chmod(report, 0o000);
    try {
      // Running as a user that can read anything (root, or a permissive filesystem) makes the
      // probe vacuous rather than failing; skip instead of asserting something untrue.
      let readable = true;
      try {
        await readFile(report, "utf8");
      } catch {
        readable = false;
      }
      if (readable) return;
      await expect(classifyEvidence(root)).rejects.toThrow(/cannot be classified/u);
    } finally {
      await chmod(report, 0o644);
    }
  });

  it("should leave an artifact outside every walked root uncited", async () => {
    // The negative control for the rule above: the root rescues what is inside it and nothing
    // else, so a sibling that no source names still classifies uncited and stays deletable.
    const root = await fixture();
    await mkdir(path.join(root, "docs/verification/visuals"), { recursive: true });
    await writeFile(path.join(root, "docs/verification/visuals/starter.png"), "pixels");
    await writeFile(path.join(root, "docs/verification/stray.png"), "pixels");
    await writeFile(path.join(root, "docs/PRDs/done/PRD-001.md"), "no citations remain");
    await track(root);

    const { scan } = await classifyEvidence(root);
    expect(
      scan.find((a) => a.path === "docs/verification/visuals/starter.png")?.classification,
    ).toBe("cited-by-script");
    expect(scan.find((a) => a.path === "docs/verification/stray.png")?.classification).toBe(
      "uncited",
    );
  });

  it("should classify an artifact a sibling evidence write-up links to as cited", async () => {
    // PRD-323 Phase 3. An evidence file is not a citation source for its own tree — its prose
    // mentioning another run is not a reason to keep that run's bytes. A Markdown *link* is
    // different: `check-doc-links` enforces it, so deleting the target breaks a live document.
    // The first deletion pass broke 42 links across six write-ups for exactly this reason,
    // because a report's attachments are named only by a relative link from the report.
    const root = await fixture();
    await mkdir(path.join(root, "docs/verification/prd-999-run"), { recursive: true });
    await writeFile(path.join(root, "docs/verification/prd-999-run/brief.txt"), "the brief");
    await writeFile(
      path.join(root, "docs/verification/prd-999.md"),
      "the report: [brief](prd-999-run/brief.txt)",
    );
    await writeFile(path.join(root, "docs/PRDs/done/PRD-001.md"), "no citations remain");
    await track(root);

    const { scan } = await classifyEvidence(root);
    const attachment = scan.find((a) => a.path === "docs/verification/prd-999-run/brief.txt");
    expect(attachment?.classification).not.toBe("uncited");
    expect(attachment?.citedBy).toContain("docs/verification/prd-999.md");
  });

  it("should leave an artifact only mentioned in evidence prose uncited", async () => {
    // The negative control: prose is not a link. Loosening the rule to any mention would make
    // every write-up that names another run keep that run's bytes forever, which is the state
    // PRD-323 exists to end.
    const root = await fixture();
    await writeFile(path.join(root, "docs/verification/orphan.png"), "pixels");
    await writeFile(
      path.join(root, "docs/verification/prd-999.md"),
      "we also looked at orphan.png during this run",
    );
    await writeFile(path.join(root, "docs/PRDs/done/PRD-001.md"), "no citations remain");
    await track(root);

    const { scan } = await classifyEvidence(root);
    expect(scan.find((a) => a.path === "docs/verification/orphan.png")?.classification).toBe(
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
