import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * The evidence budget (PRD-323): tracked bytes, file counts and per-file lines under the evidence
 * trees are bounded, so the next 369 MB fails at the commit that causes it instead of being
 * discovered in six months. This script never deletes anything; it only refuses growth.
 *
 * The caps are set just above the measured size after Phases 3 and 4 ran on 2026-09-04 with the
 * owner's checkpoint — they are growth stops, not reclamation targets. Raising one needs its own
 * commit saying why, and `should pass the real tree under the shipped caps` in the spec is what
 * stops a silent raise from hiding a growth step.
 */

export const EVIDENCE_BUDGETS = {
  // 2026-09-04, after Phase 3 deleted 147 uncited artifacts: 65.9 MB over 654 tracked files.
  // Was 80 MB / 800 files at the 2026-09-02 growth-stop setting.
  "docs/verification": { bytes: 72 * 1024 * 1024, files: 700 },
  // 2026-09-04, after Phase 4 untracked docs/benchmark/sweeps and Phase 3 deleted 15 uncited
  // artifacts: 17.5 MB over 55 tracked files. Was 300 MB / 5,400 files.
  "docs/benchmark": { bytes: 25 * 1024 * 1024, files: 80 },
} as const;

/**
 * The line cap (PRD-323 Phase 5). A result buried in a 4,050-line file that nobody opens does not
 * exist, the same way `docs/PRDs/AGENTS.md` says a gate result living only in a commit message
 * does not. An evidence file past this cap consolidates in place — the general form of the
 * `runtime-perf-state.md` exception the owner granted on 2026-08-27.
 *
 * 1,000 lines with the third-largest evidence file at 910: a growth stop, not a reclamation
 * target.
 */
export const EVIDENCE_LINE_CAP = 1000;

/**
 * Files the line cap does not reach, each with the reason it outranks the cap.
 *
 * This list is the whole escape hatch and it is deliberately short. "It is long because the run
 * was long" is not a reason — that is the case the cap exists for.
 */
export const LINE_CAP_EXEMPT: Readonly<Record<string, string>> = {
  // 128 lines of evidence plus 3,922 lines of third-party source pinned from
  // imsarah/threejs-world@398320e9 under MIT. PRD-251 is at PHASE 1 COMPLETE with phases 2-6
  // unexecuted, and its §5 borrow map addresses line ranges *into* this dump
  // (`Heightfield.ts:49-194`, `TerrainTiles.ts:55-493`, …) — "the complete files are preserved in
  // the Phase 0 verification record". Upstream is a third-party repository; this snapshot is the
  // only copy under this repository's control. Consolidating it would break a live PRD's borrow
  // map to reclaim lines that are not narrative in the first place.
  "docs/verification/PRD-251-phase0.md": "pinned third-party source snapshot a live PRD addresses",
  // The consolidation target itself. The owner's 2026-08-27 decision routes every new runtime
  // performance finding into this file instead of opening another perf report, which keeps the
  // frame ledger, the lever graveyard and the method rules in one place. Capping the file the
  // policy consolidates *into* would invert the policy.
  "docs/verification/runtime-perf-state.md": "the consolidation target of the 2026-08-27 exception",
};

export interface IEvidenceBudgetReport {
  readonly findings: readonly string[];
  readonly ok: boolean;
  readonly trees: readonly {
    readonly bytes: number;
    readonly files: number;
    readonly tree: string;
  }[];
}

function trackedFiles(root: string, tree: string): string[] {
  const result = spawnSync("git", ["ls-files", tree], { encoding: "utf8", cwd: root });
  if (result.status !== 0 || result.stderr.length > 0) {
    throw new Error(`evidence budget: git ls-files failed for '${tree}': ${result.stderr}`);
  }
  return result.stdout.split("\n").filter((line) => line.length > 0);
}

export async function checkEvidenceBudget(
  root: string,
  budgets: Readonly<Record<string, { bytes: number; files: number }>> = EVIDENCE_BUDGETS,
  lineCap: number = EVIDENCE_LINE_CAP,
): Promise<IEvidenceBudgetReport> {
  const findings: string[] = [];
  const trees: Array<{ readonly bytes: number; readonly files: number; readonly tree: string }> =
    [];
  for (const [tree, budget] of Object.entries(budgets)) {
    const files = trackedFiles(root, tree);
    let bytes = 0;
    for (const file of files) {
      const info = await stat(path.join(root, file));
      if (info.isFile()) bytes += info.size;
    }
    trees.push({ bytes, files: files.length, tree });
    if (bytes > budget.bytes) {
      findings.push(
        `evidence tree '${tree}' holds ${(bytes / 1024 / 1024).toFixed(1)} MB tracked, over the ${(budget.bytes / 1024 / 1024).toFixed(0)} MB budget — stop the growth at the commit that causes it, do not raise the cap`,
      );
    }
    if (files.length > budget.files) {
      findings.push(
        `evidence tree '${tree}' tracks ${files.length} file(s), over the ${String(budget.files)} cap`,
      );
    }
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      if (LINE_CAP_EXEMPT[file] !== undefined) continue;
      let text: string;
      try {
        text = await readFile(path.join(root, file), "utf8");
      } catch {
        // A tracked-but-unreadable evidence file is unclassifiable; the trees' byte walk above
        // already fails on it, so skip rather than double-report.
        continue;
      }
      const lines = text.split("\n").length;
      if (lines > lineCap) {
        findings.push(
          `evidence file '${file}' is ${String(lines)} lines, over the ${String(lineCap)}-line cap — consolidate it in place, keeping every result a round ledger or a done PRD cites`,
        );
      }
    }
  }
  return { findings, ok: findings.length === 0, trees };
}

function format(report: IEvidenceBudgetReport): readonly string[] {
  const lines = report.trees.map(
    (tree) =>
      `evidence ${tree.tree}: ${tree.files} tracked file(s), ${(tree.bytes / 1024 / 1024).toFixed(1)} MB`,
  );
  return report.ok ? [...lines, "evidence budget: ok"] : [...lines, ...report.findings];
}

async function main(): Promise<void> {
  const root = process.cwd();
  const report = await checkEvidenceBudget(root);
  for (const line of format(report)) console.log(line);
  if (!report.ok) process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  void main();
}
