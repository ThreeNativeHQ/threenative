import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * The citation scanner (PRD-323 Phase 1). Every artifact under the evidence trees is classified
 * by what cites it — a round ledger, a done PRD, an open PRD, a script — or `uncited`. The
 * classifier is total: an artifact it cannot read or place throws rather than defaulting to
 * keep or delete, because a scanner that guesses is the classification wearing a script.
 *
 * Nothing is deleted here. The classes feed the generated retention index (Phase 2); the
 * deletion phases consume the index only after the owner's manual checkpoint.
 */

export type CitationClass =
  | "cited-by-done-prd"
  | "cited-by-open-prd"
  | "cited-by-round-ledger"
  | "cited-by-script"
  | "uncited";

export interface IArtifactClassification {
  readonly path: string;
  readonly bytes: number;
  readonly classification: CitationClass;
  /** Precedence order for reporting: the strongest citation that names the artifact. */
  readonly citedBy: readonly string[];
}

export interface ICitationScan {
  readonly artifacts: readonly IArtifactClassification[];
  readonly totals: Readonly<Record<CitationClass, number>>;
}

const ROUND_LEDGER_PATTERN = /round-\d+/u;

function trackedFiles(root: string, tree: string): string[] {
  const result = spawnSync("git", ["ls-files", tree], { encoding: "utf8", cwd: root });
  if (result.status !== 0 || result.stderr.length > 0) {
    throw new Error(`evidence citations: git ls-files failed for '${tree}': ${result.stderr}`);
  }
  return result.stdout.split("\n").filter((line) => line.length > 0);
}

/** The citation sources: the trees whose text can name an evidence artifact. */
async function citationSources(root: string): Promise<readonly { file: string; text: string }[]> {
  const sources = trackedFiles(root, "docs");
  const files: { file: string; text: string }[] = [];
  for (const file of sources) {
    if (!file.endsWith(".md") && !file.endsWith(".ts")) continue;
    // The evidence trees do not cite themselves: an artifact's own bytes are not a citation.
    if (file.startsWith("docs/verification/") || file.startsWith("docs/benchmark/")) {
      if (!ROUND_LEDGER_PATTERN.test(file)) continue;
    }
    try {
      files.push({ file, text: await readFile(path.join(root, file), "utf8") });
    } catch (error) {
      throw new Error(
        `evidence citations: cannot read citation source '${file}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const file of trackedFiles(root, "scripts")) {
    if (!file.endsWith(".ts")) continue;
    files.push({ file, text: await readFile(path.join(root, file), "utf8") });
  }
  return files;
}

function classOf(sourceFile: string): CitationClass {
  if (sourceFile.startsWith("docs/PRDs/done/")) return "cited-by-done-prd";
  if (sourceFile.startsWith("docs/PRDs/")) return "cited-by-open-prd";
  if (ROUND_LEDGER_PATTERN.test(sourceFile)) return "cited-by-round-ledger";
  return "cited-by-script";
}

const CLASS_ORDER: readonly CitationClass[] = [
  "cited-by-round-ledger",
  "cited-by-done-prd",
  "cited-by-open-prd",
  "cited-by-script",
];

export async function classifyEvidence(
  root: string,
): Promise<{ readonly scan: readonly IArtifactClassification[] }> {
  const sources = await citationSources(root);
  // One index pass per source file over the artifact-name set: each source records the
  // artifacts whose path or basename it names. Token-set lookup keeps this linear.
  const names: { basename: string; stem: string; path: string }[] = [];
  const trees = ["docs/verification", "docs/benchmark"];
  const artifacts: string[] = [];
  for (const tree of trees) artifacts.push(...trackedFiles(root, tree));
  for (const artifact of artifacts) {
    const basename = path.posix.basename(artifact);
    names.push({ basename, path: artifact, stem: basename.replace(/\.[a-z0-9]+$/iu, "") });
  }
  const citations = new Map<string, Set<string>>();
  for (const { file, text } of sources) {
    for (const name of names) {
      if (text.includes(name.basename) || text.includes(name.path)) {
        const set = citations.get(name.path) ?? new Set<string>();
        set.add(file);
        citations.set(name.path, set);
      }
    }
  }
  const scan: IArtifactClassification[] = [];
  const totals = Object.fromEntries(
    CLASS_ORDER.map((c) => [c, 0]).concat([["uncited", 0]]),
  ) as Record<CitationClass, number>;
  for (const artifact of artifacts) {
    let bytes: number;
    try {
      bytes = (await stat(path.join(root, artifact))).size;
    } catch (error) {
      // Fail closed: a listed-but-unreadable artifact is an unclassifiable artifact, and a
      // scanner that guesses is guesswork wearing a script. The gate fails instead.
      throw new Error(
        `evidence citations: artifact '${artifact}' cannot be classified — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const files = citations.get(artifact) ?? new Set<string>();
    const citedBy = CLASS_ORDER.filter((classification) =>
      [...files].some((file) => classOf(file) === classification),
    );
    const classification: CitationClass = citedBy[0] ?? "uncited";
    totals[classification] += 1;
    scan.push({
      path: artifact,
      bytes,
      classification,
      citedBy: files === undefined ? [] : [...files].sort(),
    });
  }
  return { scan };
}
