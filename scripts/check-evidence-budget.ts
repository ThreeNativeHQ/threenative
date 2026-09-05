import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * The evidence budget (PRD-323): tracked bytes, file counts and per-file lines under the evidence
 * trees are bounded, so the next 369 MB fails at the commit that causes it instead of being
 * discovered in six months. This script never deletes anything; it only refuses growth.
 *
 * The caps are growth stops, not reclamation targets. Raising one needs its own commit saying why.
 */

export const EVIDENCE_BUDGETS = {
  // 2026-09-04, after Phase 3 deleted the uncited artifacts: 65.9 MB over 664 tracked files.
  // Was 80 MB / 800 files at the 2026-09-02 growth-stop setting.
  // PRD-357 C4 residual cap: only non-image duplicates remain after canonicalization.
  "docs/verification": { bytes: 72 * 1024 * 1024, duplicateBytes: 3_073, files: 700 },
  // 2026-09-04, after Phase 3 and Phase 4: 180.9 MB over 1,849 tracked files, down from
  // 203.3 MB over 5,362. Phase 4 untracked the generated arm sources under
  // docs/benchmark/sweeps but kept every measurement artifact, and kept the source of the 13
  // archives a `sweep-*.md` ledger names because two specs recompute their measurement from it.
  // So the file count fell by two thirds while the bytes barely moved — the sweep record is
  // mostly PNG frames a blind judge scored, and those are the benchmark, not its build output.
  // C3's 26 generated sweep instruction files are untracked; the byte/file caps remain fixed.
  // PRD-357 C4 residual cap: only non-image duplicates remain after canonicalization.
  "docs/benchmark": { bytes: 200 * 1024 * 1024, duplicateBytes: 1_007_187, files: 1950 },
} as const;

/** Reject generated sweep instruction files if one returns to the Git index. */
export const SWEEP_INSTRUCTION_FILE = /^docs\/benchmark\/sweeps\/[^/]+\/(AGENTS|CLAUDE)\.md$/u;

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

function sizeFindings(
  tree: string,
  bytes: number,
  byteBudget: number,
  files: readonly string[],
  fileBudget: number,
): readonly string[] {
  const findings: string[] = [];
  if (bytes > byteBudget) {
    findings.push(
      `evidence tree '${tree}' holds ${(bytes / 1024 / 1024).toFixed(1)} MB tracked, over the ${(byteBudget / 1024 / 1024).toFixed(0)} MB budget — stop the growth at the commit that causes it, do not raise the cap`,
    );
  }
  if (files.length > fileBudget) {
    findings.push(
      `evidence tree '${tree}' tracks ${files.length} file(s), over the ${String(fileBudget)} cap`,
    );
  }
  return findings;
}

function duplicateFindings(
  tree: string,
  duplicates: ReturnType<typeof summariseDuplicates>,
  duplicateByteBudget: number | undefined,
): readonly string[] {
  if (duplicateByteBudget === undefined || duplicates.bytes <= duplicateByteBudget) return [];
  const largest = duplicates.largest;
  const group =
    largest === undefined
      ? "no group"
      : `largest group: '${largest.file}' stored ${String(largest.count)} times, ${(largest.bytes / 1024 / 1024).toFixed(1)} MB redundant`;
  return [
    `evidence tree '${tree}' holds ${(duplicates.bytes / 1024 / 1024).toFixed(1)} MB of byte-identical tracked content across ${String(duplicates.groups)} group(s), over the ${(duplicateByteBudget / 1024 / 1024).toFixed(1)} MB duplicate budget — ${group}. Store it once and cite it; do not raise the cap`,
  ];
}

async function readEvidenceText(root: string, file: string): Promise<string> {
  try {
    return await readFile(path.join(root, file), "utf8");
  } catch (error) {
    // Fail closed. An earlier version skipped here, claiming the byte walk above "already fails
    // on it" — it does not. That walk uses `stat`, which needs only directory-traverse permission
    // and follows symlinks; `readFile` needs read permission on the file itself. A review probe put
    // a tracked evidence file at chmod 000 and this gate returned ok. An evidence file the gate
    // cannot read is a file whose length it does not know.
    throw new Error(
      `evidence budget: cannot read evidence file '${file}' — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function countEvidenceLines(text: string): number {
  // A file ending in a newline splits to one extra empty element, so the naive count was one too
  // high: the 1,000-line cap enforced 999 and the message told an author to trim a file whose
  // length it was misreporting. Found by review; the spec had baked the wrong number in.
  return text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

async function lineFinding(
  root: string,
  file: string,
  lineCap: number,
): Promise<string | undefined> {
  if (!file.endsWith(".md") || LINE_CAP_EXEMPT[file] !== undefined) return undefined;
  const lines = countEvidenceLines(await readEvidenceText(root, file));
  if (lines <= lineCap) return undefined;
  return `evidence file '${file}' is ${String(lines)} lines, over the ${String(lineCap)}-line cap — consolidate it in place, keeping every result a round ledger or a done PRD cites`;
}

async function lineFindings(
  root: string,
  files: readonly string[],
  lineCap: number,
): Promise<readonly string[]> {
  const findings: string[] = [];
  for (const file of files) {
    const finding = await lineFinding(root, file, lineCap);
    if (finding !== undefined) findings.push(finding);
  }
  return findings;
}

async function inspectTree(
  root: string,
  tree: string,
  budget: { readonly bytes: number; readonly duplicateBytes?: number; readonly files: number },
  lineCap: number,
): Promise<ITreeBudgetResult> {
  const blobs = trackedBlobs(root, tree);
  const files = blobs.map((blob) => blob.file);
  let bytes = 0;
  for (const file of files) {
    const info = await stat(path.join(root, file));
    if (info.isFile()) bytes += info.size;
  }
  const duplicates = summariseDuplicates(duplicateInventoryForBlobs(root, blobs));
  const findings = [
    ...sizeFindings(tree, bytes, budget.bytes, files, budget.files),
    ...duplicateFindings(tree, duplicates, budget.duplicateBytes),
    ...(await lineFindings(root, files, lineCap)),
  ];
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
  budgets: Readonly<
    Record<string, { bytes: number; duplicateBytes?: number; files: number }>
  > = EVIDENCE_BUDGETS,
  lineCap: number = EVIDENCE_LINE_CAP,
): Promise<IEvidenceBudgetReport> {
  const inspected = await Promise.all(
    Object.entries(budgets).map(([tree, budget]) => inspectTree(root, tree, budget, lineCap)),
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
