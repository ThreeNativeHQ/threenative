import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * The evidence budget (PRD-323 Phase 0): tracked bytes and file counts under the evidence trees
 * are bounded, so the next 369 MB fails at the commit that causes it instead of being
 * discovered in six months. Deletion policy lives elsewhere; this gate only bounds growth.
 *
 * The caps are set at the measured 2026-09-02 size with a small headroom — they are growth
 * stops, not reclamation targets. Tightening them is Phase 3's job, by deletion, with the
 * owner's manual checkpoint; this script never deletes anything.
 */

export const EVIDENCE_BUDGETS = {
  // 2026-09-02 measurement: docs/verification is 73 MB on disk over 779 tracked files.
  "docs/verification": { bytes: 80 * 1024 * 1024, files: 800 },
  // 2026-09-02: docs/benchmark is 287 MB on disk over 5,362 tracked files, of which
  // docs/benchmark/sweeps is 268 MB of generated sweep-arm sources pending Phase 4.
  "docs/benchmark": { bytes: 300 * 1024 * 1024, files: 5400 },
} as const;

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
): Promise<IEvidenceBudgetReport> {
  const findings: string[] = [];
  const trees: IEvidenceBudgetReport["trees"] = [];
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
