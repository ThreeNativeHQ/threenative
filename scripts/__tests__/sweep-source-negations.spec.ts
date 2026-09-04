import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PRD-323 Phase 4: the `.gitignore` negations that keep a measured sweep archive's source in git.
 *
 * `sweep-delta.spec.ts` and `sweep-ledger.spec.ts` do not read a recorded measurement — they
 * **recompute** it with `measureSandbox`, which throws without the archive's `src/` (`:306`), its
 * frozen `starter-baseline/src/` (`:216`) and its `framework-types/` declarations (`:102`). So
 * every archive named by a `docs/verification/sweep-*.md` ledger must have those directories
 * tracked, and the `.gitignore` carries one hand-written negation triple per archive.
 *
 * Nothing kept that list in step with the ledgers. This does. The failure it prevents is one this
 * repository has already paid for twice: the specs go red in CI, on a clean checkout, while
 * passing on any machine where the untracked files happen to still be on disk — so it reproduces
 * nowhere locally and looks like a CI fault.
 *
 * The equality is asserted in both directions on purpose. A missing negation is the CI red; an
 * extra one silently re-tracks arm sources the phase exists to remove.
 */

const MEASURED_DIRECTORIES = ["src", "starter-baseline", "framework-types"] as const;

function repoRoot(): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return result.stdout.trim();
}

function trackedFiles(root: string, pathspec: string): string[] {
  const result = spawnSync("git", ["ls-files", pathspec], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ls-files failed for '${pathspec}'`);
  return result.stdout.split("\n").filter((line) => line.length > 0);
}

/** The archives a sweep ledger names, read from each ledger's `Archive:` field. */
function ledgerArchives(root: string): string[] {
  const archives = new Set<string>();
  for (const ledger of trackedFiles(root, "docs/verification/sweep-*.md")) {
    const text = readFileSync(path.join(root, ledger), "utf8");
    const match = /^Archive:\s*(\S+)\s*$/mu.exec(text);
    if (match?.[1] === undefined) continue;
    archives.add(path.posix.basename(match[1]));
  }
  return [...archives].sort();
}

/** The archives whose measurable source is actually carried by git. */
function archivesWithTrackedSource(root: string): string[] {
  const archives = new Set<string>();
  for (const file of trackedFiles(root, "docs/benchmark/sweeps")) {
    const segments = file.split("/");
    const archive = segments[3];
    const component = segments[4];
    if (archive === undefined || component === undefined) continue;
    if ((MEASURED_DIRECTORIES as readonly string[]).includes(component)) archives.add(archive);
  }
  return [...archives].sort();
}

describe("sweep archive source negations", () => {
  it("should track measurable source for exactly the archives a ledger names", () => {
    const root = repoRoot();
    if (root.length === 0) return; // not a git checkout; nothing to compare

    const named = ledgerArchives(root);
    const tracked = archivesWithTrackedSource(root);
    expect(
      named.length,
      "no sweep-*.md ledgers found — the fixture is wrong, not the tree",
    ).toBeGreaterThan(0);

    const missing = named.filter((archive) => !tracked.includes(archive));
    const extra = tracked.filter((archive) => !named.includes(archive));

    // A ledger without tracked source is the CI red: measureSandbox throws on a clean clone.
    expect(
      missing,
      `a sweep ledger names ${missing.join(", ")}, but git does not carry its source — add the .gitignore negation triple, or sweep-delta/sweep-ledger will fail on a clean checkout while passing here`,
    ).toEqual([]);

    // Tracked source with no ledger is the opposite failure: arm sources Phase 4 meant to drop.
    expect(
      extra,
      `git carries source for ${extra.join(", ")}, which no sweep ledger names — remove the stale .gitignore negation triple`,
    ).toEqual([]);
  });

  it("should track every measurable directory a named archive actually has", () => {
    // Not all three always exist: only a framework-arm archive has a frozen `starter-baseline/`,
    // and four of the thirteen have none. Requiring all three was a rule this test invented, and
    // it went red against a tree the real specs pass on. The invariant is narrower and truer —
    // whatever the archive holds on disk, git must carry, because `measureSandbox` reads the disk
    // and a clean clone only has what git carried.
    const root = repoRoot();
    if (root.length === 0) return;

    const tracked = trackedFiles(root, "docs/benchmark/sweeps");
    const untracked: string[] = [];
    for (const archive of ledgerArchives(root)) {
      for (const directory of MEASURED_DIRECTORIES) {
        const relative = `docs/benchmark/sweeps/${archive}/${directory}`;
        if (!existsSync(path.join(root, relative))) continue;
        if (!tracked.some((file) => file.startsWith(`${relative}/`))) untracked.push(relative);
      }
    }
    expect(
      untracked,
      `these exist on disk but git does not carry them, so a clean clone loses them and measureSandbox throws — src/ at measure-sandbox.ts:306, starter-baseline/ at :216, framework-types/ at :102: ${untracked.join(", ")}`,
    ).toEqual([]);
  });
});
