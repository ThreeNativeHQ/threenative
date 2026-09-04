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

/**
 * Evidence trees a script opens as a **directory root**, resolving the files inside at run time.
 *
 * Nothing in these trees can ever be cited by name, because no source names them — the reader
 * globs the directory and works with whatever is in it. A by-name citation scan therefore
 * reports every one of them `uncited`, which is the scanner being wrong rather than the tree
 * being dead: `docs/verification/visuals` is the visual-baseline store `pnpm visuals` compares
 * against, and deleting it would silently destroy every baseline while the gate stayed green.
 *
 * Each entry names the root and the non-test reader that walks it. A root is admitted here only
 * when a real script — not a spec working inside a temporary directory — resolves it.
 */
export interface IWalkedRoot {
  /** The directory the reader opens. */
  readonly root: string;
  /** The non-test script that walks it. */
  reader: string;
  /**
   * When present, the reader takes only the files directly inside `root` whose basename starts
   * with this prefix — `sweep-delta.ts` globs `docs/verification/sweep-*.md`, so the root alone
   * would over-claim the entire tree.
   */
  readonly basenamePrefix?: string;
  /** As `basenamePrefix`, for the extension the reader filters on. */
  readonly basenameSuffix?: string;
}

export const SCRIPT_WALKED_ROOTS: readonly IWalkedRoot[] = [
  { reader: "scripts/visual-gate.ts", root: "docs/verification/visuals" },
  { reader: "scripts/template-baseline.ts", root: "docs/verification/visuals" },
  { reader: "scripts/exposure-ab.ts", root: "docs/verification/exposure-ab-2026-08-30" },
  { reader: "scripts/__tests__/sealed-proof-tokens.spec.ts", root: "docs/benchmark/genres" },
  // `ledgerFiles` in sweep-delta.ts reads every `sweep-*.md` directly under docs/verification and
  // matches each one's `Archive:` field against the archive being compared. No source names them,
  // so deleting one turns `pnpm sweep:delta` — and `sweep-delta.spec.ts` — into a hard error:
  // "missing verification ledger for the archive".
  {
    basenamePrefix: "sweep-",
    basenameSuffix: ".md",
    reader: "scripts/sweep-delta.ts",
    root: "docs/verification",
  },
  // `roundLedgerFiles` and `roundCloseFile` in round-ledger.ts glob `round-*.md` here and parse
  // each one. The self-improvement loop resumes from these; `pnpm round:next` computes its single
  // next action out of them.
  {
    basenamePrefix: "round-",
    basenameSuffix: ".md",
    reader: "scripts/round-ledger.ts",
    root: "docs/verification",
  },
];

/**
 * `scripts/alpha-bar.ts` is a fourth walker and is deliberately **not** in that list.
 *
 * `readEvidenceBlocks` opens `docs/verification` and reads every `.md` in it, but only acts on the
 * ones carrying an `alpha-bar` block — so the dependency is on content, not on a path shape, and
 * an entry here would exempt every Markdown file in the tree from retention and gut the policy.
 * What guards it instead is PRD-323's AC3: `pnpm alpha:bar` must print byte-identical output
 * either side of any deletion, which catches a removed block directly rather than by proxy.
 */

function matchesRoot(artifact: string, entry: IWalkedRoot): boolean {
  if (!artifact.startsWith(`${entry.root}/`)) return false;
  if (entry.basenamePrefix === undefined && entry.basenameSuffix === undefined) return true;
  // A prefix/suffix entry claims only the reader's own glob, and only directly inside the root.
  const rest = artifact.slice(entry.root.length + 1);
  if (rest.includes("/")) return false;
  if (entry.basenamePrefix !== undefined && !rest.startsWith(entry.basenamePrefix)) return false;
  if (entry.basenameSuffix !== undefined && !rest.endsWith(entry.basenameSuffix)) return false;
  return true;
}

/** The reader that walks the tree holding `artifact`, or undefined when nothing walks it. */
function walkedBy(artifact: string): string | undefined {
  return SCRIPT_WALKED_ROOTS.find((entry) => matchesRoot(artifact, entry))?.reader;
}

/**
 * The artifacts an evidence write-up **links** to, as repository-relative paths.
 *
 * An evidence file is not a citation source for the tree it lives in — its prose mentioning
 * another run is not a reason to keep that run's bytes. A Markdown *link* is different: it is a
 * dependency `scripts/check-doc-links.ts` enforces, so deleting its target turns a live document
 * into a broken one. Phase 3 learned this the loud way — 42 links across six write-ups broke,
 * because a report's own attachments (`prd-032-rerun-2026-08-30/brief.txt`,
 * `assets/prd-316-vfx-gallery/page-1.png`) are named only by a relative link from the report.
 *
 * Only inline `](target)` destinations count, and only ones that resolve inside the evidence
 * trees. Anchors, absolute paths and URLs are ignored.
 */
function linkedArtifacts(file: string, text: string): readonly string[] {
  const directory = path.posix.dirname(file);
  const linked: string[] = [];
  const pattern = /\]\(\s*<?([^)>\s]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gu;
  for (const match of text.matchAll(pattern)) {
    const target = match[1];
    if (target === undefined) continue;
    if (target.startsWith("#") || target.startsWith("/") || target.includes("://")) continue;
    const withoutAnchor = target.split("#")[0];
    if (withoutAnchor === undefined || withoutAnchor.length === 0) continue;
    const resolved = path.posix.normalize(path.posix.join(directory, withoutAnchor));
    if (resolved.startsWith("docs/verification/") || resolved.startsWith("docs/benchmark/")) {
      linked.push(resolved);
    }
  }
  return linked;
}

function trackedFiles(root: string, tree: string): string[] {
  const result = spawnSync("git", ["ls-files", tree], { encoding: "utf8", cwd: root });
  if (result.status !== 0 || result.stderr.length > 0) {
    throw new Error(`evidence citations: git ls-files failed for '${tree}': ${result.stderr}`);
  }
  return result.stdout.split("\n").filter((line) => line.length > 0);
}

/**
 * Every artifact linked from an evidence write-up, mapped to the write-ups that link it.
 *
 * This is the second pass `citationSources` deliberately cannot do: it reads the evidence `.md`
 * files that pass excludes, and takes only their Markdown links rather than their prose.
 */
async function linkCitations(root: string): Promise<ReadonlyMap<string, Set<string>>> {
  const links = new Map<string, Set<string>>();
  for (const tree of ["docs/verification", "docs/benchmark"]) {
    for (const file of trackedFiles(root, tree)) {
      if (!file.endsWith(".md")) continue;
      let text: string;
      try {
        text = await readFile(path.join(root, file), "utf8");
      } catch {
        // Still fail-closed, just not here: an artifact git lists but cannot be read is caught by
        // the stat walk in `classifyEvidence`, which owns the "cannot be classified" error. This
        // pass only adds citations, so throwing a second, different message for the same file
        // would replace that contract rather than strengthen it.
        continue;
      }
      for (const target of linkedArtifacts(file, text)) {
        // A document linking itself is not a citation of itself.
        if (target === file) continue;
        const set = links.get(target) ?? new Set<string>();
        set.add(file);
        links.set(target, set);
      }
    }
  }
  return links;
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
  const links = await linkCitations(root);
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
    // A tree a script opens as a directory root cites everything inside it: the reader never
    // names the files, so a by-name scan cannot see the dependency it would be deleting.
    const walker = walkedBy(artifact);
    if (walker !== undefined) files.add(walker);
    // A Markdown link from an evidence write-up to its own attachment is a dependency
    // `check-doc-links` enforces: delete the target and the live document breaks.
    for (const linker of links.get(artifact) ?? []) files.add(linker);
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
