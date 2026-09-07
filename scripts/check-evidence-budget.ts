import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

/**
 * The evidence budget (PRD-323): tracked bytes under the evidence trees are bounded, so the next
 * 369 MB fails at the commit that causes it instead of being discovered in six months. File and
 * duplicate measurements remain visible for cleanup reports, but they are not arbitrary blockers.
 * This script never deletes anything; it only refuses growth and generated sweep instructions.
 *
 * The caps are growth stops, not reclamation targets. Raising one needs its own commit saying why.
 */

export const EVIDENCE_BUDGETS = {
  // 2026-09-04, after Phase 3 deleted the uncited artifacts: 65.9 MB over 664 tracked files.
  // Was 80 MB / 800 files at the 2026-09-02 growth-stop setting. The byte cap remains hard;
  // file and duplicate counts are reported measurements for cleanup work.
  "docs/verification": { bytes: 72 * 1024 * 1024 },
  // 2026-09-04, after Phase 3 and Phase 4: 180.9 MB over 1,849 tracked files, down from
  // 203.3 MB over 5,362. Phase 4 untracked the generated arm sources under
  // docs/benchmark/sweeps but kept every measurement artifact, and kept the source of the 13
  // archives a `sweep-*.md` ledger names because two specs recompute their measurement from it.
  // So the file count fell by two thirds while the bytes barely moved — the sweep record is
  // mostly PNG frames a blind judge scored, and those are the benchmark, not its build output.
  // C3's 26 generated sweep instruction files are untracked. The byte cap remains hard; file and
  // duplicate counts are reported measurements for cleanup work.
  "docs/benchmark": { bytes: 200 * 1024 * 1024 },
} as const;

/** Reject generated sweep instruction files if one returns to the Git index. */
export const SWEEP_INSTRUCTION_FILE = /^docs\/benchmark\/sweeps\/[^/]+\/(AGENTS|CLAUDE)\.md$/u;

export interface IEvidenceBudgetReport {
  readonly findings: readonly string[];
  readonly ok: boolean;
  readonly trees: readonly {
    readonly bytes: number;
    readonly duplicateBytes: number;
    readonly duplicateGroups: number;
    readonly files: number;
    readonly tree: string;
  }[];
}

interface ITrackedBlob {
  readonly file: string;
  readonly sha: string;
}

export interface IDuplicateGroup {
  readonly copies: number;
  readonly files: readonly string[];
  readonly redundantBytes: number;
  readonly sha: string;
  readonly size: number;
}

export interface IDuplicateInventory {
  readonly bytes: number;
  readonly groups: readonly IDuplicateGroup[];
}

/** Read indexed paths and blob IDs; duplicate content is one blob behind multiple paths. */
function trackedBlobs(root: string, tree: string): ITrackedBlob[] {
  const result = spawnSync("git", ["ls-files", "-s", tree], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  });
  if (result.status !== 0 || result.stderr.length > 0) {
    throw new Error(`evidence budget: git ls-files failed for '${tree}': ${result.stderr}`);
  }
  return result.stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [meta, file] = line.split("\t");
      const sha = (meta ?? "").split(/\s+/u)[1] ?? "";
      if (file === undefined || sha.length === 0) {
        throw new Error(`evidence budget: cannot parse git ls-files entry '${line}'`);
      }
      return { file, sha };
    });
}

/** Read blob sizes from Git so dirty working files cannot change duplicate arithmetic. */
function blobSizes(root: string, shas: readonly string[]): Map<string, number> {
  const sizes = new Map<string, number>();
  if (shas.length === 0) return sizes;
  const result = spawnSync("git", ["cat-file", "--batch-check=%(objectname) %(objectsize)"], {
    cwd: root,
    encoding: "utf8",
    input: `${shas.join("\n")}\n`,
    maxBuffer: 1024 * 1024 * 64,
  });
  if (result.status !== 0) {
    throw new Error(`evidence budget: git cat-file failed: ${result.stderr}`);
  }
  for (const line of result.stdout.split("\n")) {
    const [sha, size] = line.split(" ");
    if (sha === undefined || size === undefined) continue;
    if (!/^\d+$/u.test(size)) {
      throw new Error(`evidence budget: git cat-file could not size blob '${sha}'`);
    }
    sizes.set(sha, Number(size));
  }
  return sizes;
}

function duplicateInventoryForBlobs(
  root: string,
  blobs: readonly ITrackedBlob[],
): IDuplicateInventory {
  const groups = new Map<string, string[]>();
  for (const blob of blobs) {
    const paths = groups.get(blob.sha);
    if (paths === undefined) groups.set(blob.sha, [blob.file]);
    else paths.push(blob.file);
  }
  const sizes = blobSizes(root, [...groups.keys()]);
  const duplicateGroups: IDuplicateGroup[] = [];
  for (const [sha, paths] of groups) {
    if (paths.length < 2) continue;
    const size = sizes.get(sha);
    if (size === undefined) {
      throw new Error(`evidence budget: no size for tracked blob '${sha}' (${paths[0] ?? "?"})`);
    }
    duplicateGroups.push({
      copies: paths.length,
      files: [...paths].sort(),
      redundantBytes: size * (paths.length - 1),
      sha,
      size,
    });
  }
  duplicateGroups.sort((a, b) => b.redundantBytes - a.redundantBytes || a.sha.localeCompare(b.sha));
  return {
    bytes: duplicateGroups.reduce((total, group) => total + group.redundantBytes, 0),
    groups: duplicateGroups,
  };
}

function summariseDuplicates(inventory: IDuplicateInventory): {
  readonly bytes: number;
  readonly groups: number;
  /** The worst group, included so a failure names a concrete path. */
  readonly largest:
    | { readonly bytes: number; readonly count: number; readonly file: string }
    | undefined;
} {
  const largest = inventory.groups[0];
  return {
    bytes: inventory.bytes,
    groups: inventory.groups.length,
    largest:
      largest === undefined
        ? undefined
        : {
            bytes: largest.redundantBytes,
            count: largest.copies,
            file: largest.files[0] ?? "",
          },
  };
}

interface ITreeBudgetResult {
  readonly findings: readonly string[];
  readonly tree: IEvidenceBudgetReport["trees"][number];
}

function sizeFindings(tree: string, bytes: number, byteBudget: number): readonly string[] {
  const findings: string[] = [];
  if (bytes > byteBudget) {
    findings.push(
      `evidence tree '${tree}' holds ${(bytes / 1024 / 1024).toFixed(1)} MB tracked, over the ${(byteBudget / 1024 / 1024).toFixed(0)} MB budget — stop the growth at the commit that causes it, do not raise the cap`,
    );
  }
  return findings;
}

async function inspectTree(
  root: string,
  tree: string,
  budget: { readonly bytes: number },
): Promise<ITreeBudgetResult> {
  const blobs = trackedBlobs(root, tree);
  const files = blobs.map((blob) => blob.file);
  let bytes = 0;
  for (const file of files) {
    const info = await stat(path.join(root, file));
    if (info.isFile()) bytes += info.size;
  }
  const duplicates = summariseDuplicates(duplicateInventoryForBlobs(root, blobs));
  const findings = [...sizeFindings(tree, bytes, budget.bytes)];
  const sweepInstructions = files.filter((file) => SWEEP_INSTRUCTION_FILE.test(file));
  if (sweepInstructions.length > 0) {
    findings.unshift(
      `evidence tree '${tree}' tracks ${String(sweepInstructions.length)} scaffolded sweep instruction file(s) — ${sweepInstructions.slice(0, 3).join(", ")}${sweepInstructions.length > 3 ? ", …" : ""}. They are generated scaffold output describing a game that no longer exists, and a "closest AGENTS.md" walk reads one as binding; untrack them (PRD-357 F3)`,
    );
  }
  return {
    findings,
    tree: {
      bytes,
      duplicateBytes: duplicates.bytes,
      duplicateGroups: duplicates.groups,
      files: files.length,
      tree,
    },
  };
}

export async function checkEvidenceBudget(
  root: string,
  budgets: Readonly<Record<string, { bytes: number }>> = EVIDENCE_BUDGETS,
): Promise<IEvidenceBudgetReport> {
  const inspected = await Promise.all(
    Object.entries(budgets).map(([tree, budget]) => inspectTree(root, tree, budget)),
  );
  const findings = inspected.flatMap((result) => result.findings);
  return {
    findings,
    ok: findings.length === 0,
    trees: inspected.map((result) => result.tree),
  };
}

function format(report: IEvidenceBudgetReport): readonly string[] {
  const lines = report.trees.map(
    (tree) =>
      `evidence ${tree.tree}: ${tree.files} tracked file(s), ${(tree.bytes / 1024 / 1024).toFixed(1)} MB, ${(tree.duplicateBytes / 1024 / 1024).toFixed(1)} MB duplicate across ${tree.duplicateGroups} group(s)`,
  );
  return report.ok ? [...lines, "evidence budget: ok"] : [...lines, ...report.findings];
}

/** Return every per-tree duplicate group, largest redundancy first. */
export function duplicateInventory(
  root: string,
  trees: readonly string[] = Object.keys(EVIDENCE_BUDGETS),
): readonly (IDuplicateInventory & {
  readonly tree: string;
})[] {
  return trees.map((tree) => {
    const blobs = trackedBlobs(root, tree);
    const inventory = duplicateInventoryForBlobs(root, blobs);
    return {
      ...inventory,
      tree,
    };
  });
}

const IMAGE_FILE = /\.(?:png|jpe?g|webp|gif)$/iu;

function isImageFile(file: string): boolean {
  return IMAGE_FILE.test(file);
}

function canonicalImagePath(files: readonly string[]): string {
  const genreReference = files.find((file) =>
    /^docs\/benchmark\/genres\/[^/]+\/reference\.png$/u.test(file),
  );
  return genreReference ?? [...files].sort()[0] ?? "";
}

const ALL_TRACKED_PATHSPEC = ["."] as const;

/** Global image grouping keeps the cleanup inventory broader than the per-tree budget caps. */
export function duplicateImageInventory(
  root: string,
  trees: readonly string[] = ALL_TRACKED_PATHSPEC,
): IDuplicateInventory & {
  readonly groups: readonly (IDuplicateGroup & {
    readonly canonical: string;
    readonly remove: readonly string[];
  })[];
} {
  const blobs = trees
    .flatMap((tree) => trackedBlobs(root, tree))
    .filter((blob) => isImageFile(blob.file));
  const inventory = duplicateInventoryForBlobs(root, blobs);
  return {
    bytes: inventory.bytes,
    groups: inventory.groups.map((group) => {
      const canonical = canonicalImagePath(group.files);
      return { ...group, canonical, remove: group.files.filter((file) => file !== canonical) };
    }),
  };
}

function formatJsonArray(items: readonly unknown[]): string {
  return `[\n${items.map((item) => JSON.stringify(item)).join(",\n")}\n]\n`;
}

function formatImageInventory(
  inventory: ReturnType<typeof duplicateImageInventory>,
  pathspecs: readonly string[],
): string {
  const groups = inventory.groups.map((group) => `    ${JSON.stringify(group)}`).join(",\n");
  const groupBlock = groups.length === 0 ? "" : `\n${groups}\n`;
  return `{
  "generatedFrom": "git index",
  "pathspecs": ${JSON.stringify(pathspecs)},
  "bytes": ${String(inventory.bytes)},
  "groups": [${groupBlock}
  ]
}\n`;
}

async function main(): Promise<void> {
  const root = process.cwd();
  if (process.argv.includes("--duplicates")) {
    process.stdout.write(formatJsonArray(duplicateInventory(root)));
    return;
  }
  if (process.argv.includes("--image-duplicates")) {
    process.stdout.write(formatImageInventory(duplicateImageInventory(root), ALL_TRACKED_PATHSPEC));
    return;
  }
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
