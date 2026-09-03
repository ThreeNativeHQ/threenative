#!/usr/bin/env tsx
/**
 * `pnpm alpha:bar` — the alpha bar, computed instead of typed.
 *
 * The bar it replaces was seven markdown rows with ✅ and ⚠️ typed into them by whoever last
 * edited the file. Nothing recomputed it, so nothing could contradict it, and nothing noticed
 * when a row became true. This recomputes every row from the file it reads or the command it
 * runs, and regenerates that table between markers so a hand edit is reverted on the next run.
 *
 * Fail closed everywhere:
 *  - a row that can name neither a file nor a command is refused at construction, not printed;
 *  - a row whose evidence is absent prints `unmeasured` and exits `2` — never `pass`, never `0`;
 *  - a malformed evidence block throws rather than emitting a partial row;
 *  - an empty row set is an error, because a bar that asserts nothing is the defect this file
 *    exists to prevent.
 *
 * One exception, and it is narrow. A row may be declared `deferred`: it is printed with its
 * requirement and a stated reason it cannot be measured yet, and it counts toward neither tally.
 * A deferral is never a verdict — it is only what the bar says in place of `unmeasured` when the
 * evidence is absent *and* the reason for its absence is a dependency this bar itself gates. Any
 * real evidence block for that row outranks the deferral and is graded `pass` or `fail` normally,
 * so a deferral can never overrule a run somebody actually made. Deleting the row instead would
 * destroy the same information the `unmeasured` state exists to preserve, which is why it stays.
 *
 * Exit `0` alpha, `1` a row is red, `2` a row could not be measured. `2` outranks `1`: not
 * knowing is worse than knowing the answer is no.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkLedger } from "./check-parity-ledger.js";
import { type RoundLedger, readRoundLedger } from "./round-ledger.js";

const REPO = path.resolve(import.meta.dirname, "..");

/**
 * Where A7 writes the generated table and reads it back.
 *
 * This was `docs/PRDs/alpha-readiness/README.md` until that batch was archived and its README
 * deleted, at which point A7 reported `unmeasured` on every run — the bar had quietly stopped
 * proving it was runnable rather than transcribed, which is the one thing A7 exists to prove.
 * It lives in the evidence record now, because that is what a generated verdict table is, and
 * because a batch folder is a thing rounds archive while this file has to outlive all of them.
 */
export const ALPHA_TABLE_FILE = "docs/verification/alpha-bar.md";
export const TABLE_BEGIN = "<!-- BEGIN GENERATED: alpha-bar -->";
export const TABLE_END = "<!-- END GENERATED: alpha-bar -->";

/**
 * Every parity ledger in the repository, newest first by filename date.
 *
 * This row used to name the two 2026-08-10 ledgers directly, which made it permanently red: they
 * are historical evidence, one of them contains a cell the runner could not have emitted, and
 * evidence is not edited to match a later state. A row that cannot move is the resting-state
 * failure this bar's own risks warn about.
 *
 * What the row actually asks is *"is every platform claim checkable, and do the ledgers agree"*,
 * and that is answerable: the current ledger must pass the checker, and any older ledger that
 * fails it must carry a SUPERSEDED banner saying so. A failing ledger nobody has superseded is an
 * unresolved disagreement; a failing ledger that is marked superseded is a resolved one.
 */
const PARITY_LEDGER_PATTERN = /^(?:tier-1|parity)-\d{4}-\d{2}-\d{2}.*\.md$/u;
const SUPERSEDED = /\bSUPERSEDED\b/u;

export type AlphaRowStatus = "deferred" | "fail" | "pass" | "unmeasured";

export interface IAlphaRowResult {
  /** One line of what was actually read, including the numbers that decided it. */
  readonly detail: string;
  /** The file this row read or the command it ran. Never a PRD status line. */
  readonly evidence: string;
  readonly id: string;
  readonly requirement: string;
  readonly status: AlphaRowStatus;
}

export interface IAlphaBarReport {
  readonly deferred: number;
  readonly exitCode: 0 | 1 | 2;
  readonly failed: number;
  readonly passed: number;
  readonly rows: readonly IAlphaRowResult[];
  readonly unmeasured: number;
}

/**
 * A row sourced from a PRD document is the hand-typed table with extra steps: the `**Status:**`
 * line it would read is the same sentence somebody typed. Rejected by path, at construction.
 *
 * The batch README is not a PRD document and is not rejected: A7 reads the table this file
 * generated, which is the opposite of reading a claim somebody typed.
 */
export const PRD_DOCUMENT = /docs\/PRDs\/(?:[^\s]*\/)?PRD-\d+[^\s]*\.md/u;

function assertEvidenceSource(row: IAlphaRowResult): void {
  const evidence = row.evidence.trim();
  if (evidence.length === 0)
    throw new Error(`TN_ALPHA_ROW_NO_EVIDENCE: row ${row.id} names no file and no command.`);
  if (PRD_DOCUMENT.test(evidence))
    throw new Error(
      `TN_ALPHA_ROW_PRD_SOURCED: row ${row.id} reads ${evidence}. A PRD status line is not evidence.`,
    );
  if (row.detail.trim().length === 0)
    throw new Error(`TN_ALPHA_ROW_NO_DETAIL: row ${row.id} reported no observation.`);
}

/** Turns rows into a report. An empty set is an error, not an alpha. */
export function summariseAlphaBar(rows: readonly IAlphaRowResult[]): IAlphaBarReport {
  if (rows.length === 0)
    throw new Error("TN_ALPHA_BAR_EMPTY: the alpha bar asserted nothing. Name at least one row.");
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error(`TN_ALPHA_ROW_DUPLICATE: row ${row.id} appears twice.`);
    seen.add(row.id);
    assertEvidenceSource(row);
  }
  const unmeasured = rows.filter((row) => row.status === "unmeasured").length;
  const failed = rows.filter((row) => row.status === "fail").length;
  // A deferred row decides nothing, so it moves neither tally and cannot move the exit code.
  return {
    deferred: rows.filter((row) => row.status === "deferred").length,
    exitCode: unmeasured > 0 ? 2 : failed > 0 ? 1 : 0,
    failed,
    passed: rows.filter((row) => row.status === "pass").length,
    rows,
    unmeasured,
  };
}

/* ------------------------------------------------------------------ evidence blocks */

export interface IEvidenceBlock {
  readonly detail: string;
  readonly file: string;
  readonly row: string;
  readonly source: string;
  readonly status: "fail" | "pass";
}

const BLOCK = /```alpha-bar\r?\n([\s\S]*?)```/gu;

function blockField(body: string, key: string, file: string): string {
  const match = body.match(new RegExp(`^${key}:[ \\t]*(.+)$`, "mu"));
  const value = match?.[1]?.trim();
  if (value === undefined || value.length === 0)
    throw new Error(
      `TN_ALPHA_EVIDENCE_MALFORMED: ${file} has an alpha-bar block without '${key}'.`,
    );
  return value;
}

/**
 * Reads every `alpha-bar` evidence block under a directory. A block that is missing a field, or
 * carries a status this file does not know, throws — a partially-read block is exactly the
 * dropped-assertion failure the repository's harness rules exist to prevent.
 */
export function readEvidenceBlocks(directory: string): readonly IEvidenceBlock[] {
  if (!fs.existsSync(directory)) return [];
  const blocks: IEvidenceBlock[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const file = path.join(directory, entry.name);
    const markdown = fs.readFileSync(file, "utf8");
    for (const match of markdown.matchAll(BLOCK)) {
      const body = match[1] ?? "";
      const row = blockField(body, "row", file);
      const status = blockField(body, "status", file);
      if (status !== "pass" && status !== "fail")
        throw new Error(
          `TN_ALPHA_EVIDENCE_MALFORMED: ${file} block for ${row} has status '${status}'. Use pass or fail; absence is unmeasured and is expressed by having no block.`,
        );
      const source = blockField(body, "source", file);
      if (PRD_DOCUMENT.test(source))
        throw new Error(
          `TN_ALPHA_EVIDENCE_PRD_SOURCED: ${file} block for ${row} names ${source} as its source. A PRD is not a run.`,
        );
      blocks.push({ detail: blockField(body, "detail", file), file, row, source, status });
    }
  }
  return blocks;
}

/**
 * `deferral`, when given, replaces only the *absent evidence* branch. Every other branch is
 * untouched: a filed block still grades pass or fail, and two blocks that disagree are still
 * unmeasured, because a disagreement is evidence that exists rather than evidence that is missing.
 */
function evidenceRow(
  id: string,
  requirement: string,
  blocks: readonly IEvidenceBlock[],
  repo: string,
  deferral?: string,
): IAlphaRowResult {
  const evidence = `an alpha-bar evidence block for ${id} in docs/verification/`;
  const mine = blocks.filter((block) => block.row === id);
  if (mine.length === 0)
    return deferral === undefined
      ? {
          detail: `No alpha-bar evidence block for ${id} was found in docs/verification/.`,
          evidence,
          id,
          requirement,
          status: "unmeasured",
        }
      : {
          detail: `${deferral} No alpha-bar evidence block for ${id} was found in docs/verification/; filing one grades this row normally and ends the deferral.`,
          evidence,
          id,
          requirement,
          status: "deferred",
        };
  // Two runs disagreeing is not a tie to be broken by ordering; it is an unanswered question.
  const statuses = new Set(mine.map((block) => block.status));
  if (statuses.size > 1)
    return {
      detail: `${mine.length} evidence blocks for ${id} disagree: ${mine
        .map((block) => `${path.relative(repo, block.file)}=${block.status}`)
        .join(", ")}.`,
      evidence,
      id,
      requirement,
      status: "unmeasured",
    };
  const latest = [...mine].sort((left, right) => left.file.localeCompare(right.file)).at(-1);
  if (latest === undefined) throw new Error(`TN_ALPHA_EVIDENCE_MALFORMED: no block for ${id}.`);
  return {
    detail: `${latest.detail} (${path.relative(repo, latest.file)}, produced by: ${latest.source})`,
    evidence,
    id,
    requirement,
    status: latest.status,
  };
}

/* ------------------------------------------------------------------ A1: the registry */

export type RegistryProbe = (packageName: string) => readonly string[] | "absent" | "unreachable";

/** Every workspace package a stranger would have to install. `private` packages are not shipped. */
export function publishablePackages(repo: string): readonly { name: string; version: string }[] {
  const root = path.join(repo, "packages");
  if (!fs.existsSync(root)) return [];
  const packages: { name: string; version: string }[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestFile = path.join(root, entry.name, "package.json");
    if (!fs.existsSync(manifestFile)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as {
      name?: unknown;
      private?: unknown;
      version?: unknown;
    };
    if (manifest.private === true) continue;
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string")
      throw new Error(`TN_ALPHA_MANIFEST_MALFORMED: ${manifestFile} has no name or version.`);
    packages.push({ name: manifest.name, version: manifest.version });
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The registry, asked directly. `--userconfig .npmrc` keeps the repository-local registry config
 * out of the environment and out of this file; its contents are never read here and never printed.
 */
function parseVersions(stdout: string, packageName: string): readonly string[] {
  const parsed = JSON.parse(stdout) as unknown;
  if (typeof parsed === "string") return [parsed];
  if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed;
  throw new Error(`npm view ${packageName} returned ${stdout.slice(0, 80)}`);
}

/**
 * A 404 is an answer: the package is not there, and the row is red. Anything else — a timeout, a
 * DNS failure, an auth error — means the question never reached the registry, which is unmeasured.
 */
function registryAnswer(error: unknown): "absent" | "unreachable" {
  const text = `${(error as { stderr?: unknown }).stderr ?? ""}${
    (error as { stdout?: unknown }).stdout ?? ""
  }${error instanceof Error ? error.message : String(error)}`;
  return /E404|404 Not Found|is not in this registry/u.test(text) ? "absent" : "unreachable";
}

export function npmRegistryProbe(repo: string): RegistryProbe {
  const userconfig = path.join(repo, ".npmrc");
  const config = fs.existsSync(userconfig) ? ["--userconfig", userconfig] : [];
  return (packageName) => {
    try {
      return parseVersions(
        execFileSync("npm", [...config, "view", packageName, "versions", "--json"], {
          cwd: repo,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 30_000,
        }),
        packageName,
      );
    } catch (error) {
      return registryAnswer(error);
    }
  };
}

export function registryRow(repo: string, probe: RegistryProbe): IAlphaRowResult {
  const id = "A1";
  const requirement = "A stranger can install it from the public registry";
  const evidence = "npm view <package> versions --json";
  const packages = publishablePackages(repo);
  if (packages.length === 0)
    return {
      detail: `No publishable package was found under ${path.join(repo, "packages")}.`,
      evidence,
      id,
      requirement,
      status: "unmeasured",
    };
  const absent: string[] = [];
  const stale: string[] = [];
  const unreachable: string[] = [];
  for (const item of packages) {
    const versions = probe(item.name);
    if (versions === "unreachable") unreachable.push(item.name);
    else if (versions === "absent") absent.push(item.name);
    else if (!versions.includes(item.version)) stale.push(`${item.name} ${item.version}`);
  }
  if (unreachable.length > 0)
    return {
      detail: `The registry could not be reached for ${unreachable.length} of ${packages.length} package(s): ${unreachable.join(", ")}.`,
      evidence,
      id,
      requirement,
      status: "unmeasured",
    };
  if (absent.length > 0 || stale.length > 0)
    return {
      detail: [
        absent.length > 0
          ? `${absent.length} of ${packages.length} publishable package(s) are absent from the registry: ${absent.join(", ")}.`
          : "",
        stale.length > 0 ? `Unpublished workspace version(s): ${stale.join(", ")}.` : "",
      ]
        .filter((part) => part.length > 0)
        .join(" "),
      evidence,
      id,
      requirement,
      status: "fail",
    };
  return {
    detail: `All ${packages.length} publishable package(s) are on the registry at their workspace versions.`,
    evidence,
    id,
    requirement,
    status: "pass",
  };
}

/* ------------------------------------------------------------------ A4: a paired round */

function ledgerFiles(repo: string): readonly string[] {
  const directory = path.join(repo, "docs", "verification");
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((file) => /^round-\d+-\d{4}-\d{2}-\d{2}\.md$/u.test(file))
    .map((file) => path.join(directory, file));
}

function pairedAndMeasured(ledger: RoundLedger): string | undefined {
  if (ledger.declaresVisualOnly)
    return `round ${ledger.round} is visual-only, not a framework-versus-vanilla value claim`;
  if (ledger.stopCondition === "void") return `round ${ledger.round} is VOID`;
  const genres = new Map<string, number>();
  for (const arm of ledger.arms) genres.set(arm.genre, (genres.get(arm.genre) ?? 0) + 1);
  const paired = [...genres.entries()].filter(([, count]) => count === 2).map(([genre]) => genre);
  if (paired.length === 0) return `round ${ledger.round} names no paired genre`;
  const unmeasuredArm = ledger.arms.find(
    (arm) =>
      paired.includes(arm.genre) &&
      (arm.archive === "unmeasured" ||
        arm.archive === "pending" ||
        arm.proofResult === "unmeasured" ||
        arm.instrumentVisual === "unmeasured"),
  );
  if (unmeasuredArm !== undefined)
    return `round ${ledger.round}'s ${unmeasuredArm.arm} ${unmeasuredArm.genre} arm is unmeasured`;
  const unmeasuredColumn = ledger.columns.find(
    (row) =>
      paired.includes(row.genre) &&
      [row.cost, row.functional, row.visual].some((cell) => cell === "unmeasured"),
  );
  if (unmeasuredColumn !== undefined)
    return `round ${ledger.round}'s ${unmeasuredColumn.genre} columns are not all measured`;
  return undefined;
}

export function pairedRoundRow(repo: string): IAlphaRowResult {
  const id = "A4";
  const requirement = "The value claim rests on one measured paired round";
  const evidence = "docs/verification/round-*.md";
  const files = ledgerFiles(repo);
  if (files.length === 0)
    return {
      detail: "No round ledger exists under docs/verification/.",
      evidence,
      id,
      requirement,
      status: "unmeasured",
    };
  // A ledger this repository's own parser cannot read is not a round that failed the bar; it is
  // a round the bar could not see. Recorded, and it makes the row unmeasured rather than red.
  const unreadable: string[] = [];
  const ledgers: RoundLedger[] = [];
  for (const file of files) {
    try {
      ledgers.push(readRoundLedger(file));
    } catch (error) {
      unreadable.push(
        `${path.relative(repo, file)} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
  ledgers.sort((left, right) => left.round - right.round);
  // Fail closed before searching, not after: a bar that found its pass among the ledgers it could
  // read, and stayed quiet about the one it could not, is claiming to have read evidence it never
  // opened. Today this is what reports that `round-10` broke `pnpm round:next`.
  if (unreadable.length > 0)
    return {
      detail: `${unreadable.length} of ${files.length} round ledger(s) could not be parsed, so the current state is unknown: ${unreadable.join("; ")}.`,
      evidence,
      id,
      requirement,
      status: "unmeasured",
    };
  const reasons: string[] = [];
  for (const ledger of [...ledgers].reverse()) {
    const reason = pairedAndMeasured(ledger);
    if (reason === undefined)
      return {
        detail: `Round ${ledger.round} (${ledger.date}) records a measured paired round: ${ledger.arms
          .map((arm) => `${arm.genre}/${arm.arm} ${arm.proofResult}`)
          .join(", ")}.`,
        evidence,
        id,
        requirement,
        status: "pass",
      };
    reasons.push(reason);
  }
  return {
    detail: `No round ledger records a measured paired round across ${ledgers.length} ledger(s). Most recent first: ${reasons.slice(0, 3).join("; ")}.`,
    evidence,
    id,
    requirement,
    status: "fail",
  };
}

/* ------------------------------------------------------------------ A5: the parity ledgers */

export async function parityRow(repo: string): Promise<IAlphaRowResult> {
  const id = "A5";
  const requirement = "Every platform claim is checkable and the ledgers agree";
  const evidence = "pnpm parity:ledger docs/verification/{tier-1,parity}-*.md";
  const directory = path.join(repo, "docs", "verification");
  const files = fs.existsSync(directory)
    ? fs
        .readdirSync(directory)
        .filter((file) => PARITY_LEDGER_PATTERN.test(file))
        .sort()
    : [];
  if (files.length === 0)
    return {
      detail: "No parity ledger exists under docs/verification/.",
      evidence,
      id,
      requirement,
      status: "unmeasured",
    };
  // Newest by filename date. Ledgers are dated in their names by convention, which is the same
  // ordering a reader uses; nothing here infers currency from file mtime, which a checkout resets.
  const current = files.at(-1) as string;
  const unresolved: string[] = [];
  let currentFindings = 0;
  for (const file of files) {
    const markdown = fs.readFileSync(path.join(directory, file), "utf8");
    let findings: readonly unknown[];
    try {
      findings = await checkLedger(markdown);
    } catch (error) {
      return {
        detail: `The parity checker could not read ${file}: ${error instanceof Error ? error.message : String(error)}`,
        evidence,
        id,
        requirement,
        status: "unmeasured",
      };
    }
    if (file === current) currentFindings = findings.length;
    // An older ledger that fails the checker is fine *if* somebody has said it is superseded.
    // One that fails and claims to still be current is an open contradiction.
    else if (findings.length > 0 && !SUPERSEDED.test(markdown)) unresolved.push(file);
  }
  if (currentFindings > 0)
    return {
      detail: `The current ledger ${current} has ${currentFindings} finding(s): a cell it records cannot be recomputed from the report it names.`,
      evidence,
      id,
      requirement,
      status: "fail",
    };
  if (unresolved.length > 0)
    return {
      detail: `${unresolved.length} superseded-but-unmarked ledger(s) still contradict the current one: ${unresolved.join(", ")}. Mark them SUPERSEDED or reconcile them.`,
      evidence,
      id,
      requirement,
      status: "fail",
    };
  return {
    detail: `${current} recomputes to the exit codes it records, and every older ledger that does not is marked SUPERSEDED (${files.length} ledger(s) checked).`,
    evidence,
    id,
    requirement,
    status: "pass",
  };
}

/* ------------------------------------------------------------------ A7: the generated table */

export function renderTable(rows: readonly IAlphaRowResult[]): string {
  const glyph: Record<AlphaRowStatus, string> = {
    deferred: "deferred",
    fail: "red",
    pass: "green",
    unmeasured: "unmeasured",
  };
  return [
    TABLE_BEGIN,
    "",
    "<!-- Generated by `pnpm alpha:bar --write`. A hand edit here is reverted on the next run. -->",
    "",
    "| # | Alpha requirement | State | What the bar read, and what it said |",
    "|---|---|---|---|",
    ...rows.map(
      (row) =>
        `| ${row.id} | ${row.requirement} | **${glyph[row.status]}** | \`${row.evidence}\` — ${row.detail.replaceAll("|", "\\|")} |`,
    ),
    // A7 reports on the six above, so it cannot be one of them: rendering its own status would
    // need that status before it has one. It is stated as the invariant the generator makes
    // true, and a hand edit to this line fails the whole-file comparison like any other.
    `| A7 | The bar is runnable, not transcribed | **green** | \`${ALPHA_TABLE_FILE}\` — this table is \`pnpm alpha:bar --write\` output; the command re-reads it and goes red if it drifts. |`,
    "",
    TABLE_END,
  ].join("\n");
}

export function writeTable(markdown: string, table: string, file: string): string {
  const begin = markdown.indexOf(TABLE_BEGIN);
  const end = markdown.indexOf(TABLE_END);
  if (begin === -1 || end === -1 || end < begin)
    throw new Error(
      `TN_ALPHA_TABLE_MARKERS_MISSING: ${file} has no ${TABLE_BEGIN} … ${TABLE_END} pair to generate into.`,
    );
  return `${markdown.slice(0, begin)}${table}${markdown.slice(end + TABLE_END.length)}`;
}

export function writeGeneratedTableFile(file: string, table: string): void {
  const markdown = fs.existsSync(file)
    ? fs.readFileSync(file, "utf8")
    : `${TABLE_BEGIN}\n${TABLE_END}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, writeTable(markdown, table, file));
}

function generatedTableRow(repo: string, rows: readonly IAlphaRowResult[]): IAlphaRowResult {
  const id = "A7";
  const requirement = "The bar is runnable, not transcribed";
  const evidence = ALPHA_TABLE_FILE;
  const file = path.join(repo, ALPHA_TABLE_FILE);
  if (!fs.existsSync(file))
    return {
      detail: `${ALPHA_TABLE_FILE} is missing, so the generated table cannot be compared.`,
      evidence,
      id,
      requirement,
      status: "unmeasured",
    };
  const markdown = fs.readFileSync(file, "utf8");
  // A7 reports on the other six rows, so it renders them without itself: including its own row
  // would need its own result before it has one.
  let expected: string;
  try {
    expected = writeTable(markdown, renderTable(rows), file);
  } catch (error) {
    return {
      detail: error instanceof Error ? error.message : String(error),
      evidence,
      id,
      requirement,
      status: "unmeasured",
    };
  }
  return expected === markdown
    ? {
        detail: `The generated table in ${ALPHA_TABLE_FILE} is byte-identical to this run.`,
        evidence,
        id,
        requirement,
        status: "pass",
      }
    : {
        detail: `The generated table in ${ALPHA_TABLE_FILE} does not match this run. Rerun pnpm alpha:bar --write.`,
        evidence,
        id,
        requirement,
        status: "fail",
      };
}

/* ------------------------------------------------------------------ the bar */

/**
 * Owner decision, 2026-08-29: A6 stops blocking the verdict, because the question it asks cannot
 * be answered in the order the bar is run. A stranger installs from the public registry, which is
 * A1; A1 is red until the packages are published; and publication is gated on this bar going
 * green. The row would therefore be permanently unmeasured for a reason no amount of work inside
 * the repository can change, which is the resting-state failure this file was written to end.
 * Recorded in docs/verification/alpha-a6-deferred-2026-08-29.md.
 */
const A6_DEFERRAL =
  "Deferred: this row depends on A1 — a stranger cannot use what is not published, and publication is gated on this bar, so it is measured after publication and not before.";

export interface IAlphaBarOptions {
  readonly registry?: RegistryProbe;
  readonly repo?: string;
}

export async function alphaBar(options: IAlphaBarOptions = {}): Promise<IAlphaBarReport> {
  const repo = options.repo ?? REPO;
  const blocks = readEvidenceBlocks(path.join(repo, "docs", "verification"));
  const rows: IAlphaRowResult[] = [
    registryRow(repo, options.registry ?? npmRegistryProbe(repo)),
    evidenceRow("A2", "The golden path completes from published artifacts", blocks, repo),
    evidenceRow("A3", "Verification cannot report green while asserting nothing", blocks, repo),
    pairedRoundRow(repo),
    await parityRow(repo),
    evidenceRow("A6", "One stranger has actually used it", blocks, repo, A6_DEFERRAL),
  ];
  rows.push(generatedTableRow(repo, rows));
  return summariseAlphaBar(rows);
}

export function formatReport(report: IAlphaBarReport): string {
  const lines = report.rows.flatMap((row) => [
    `${row.id}  ${row.status.padEnd(10)}  ${row.requirement}`,
    `    ${row.detail}`,
    `    evidence: ${row.evidence}`,
  ]);
  // A verdict that did not mention its deferred rows would be a green with a silent asterisk.
  const deferred = report.deferred > 0 ? `, ${report.deferred} deferred` : "";
  lines.push(
    report.exitCode === 0
      ? `${report.passed} of ${report.rows.length} rows pass${deferred}. Alpha.`
      : `${report.unmeasured} of ${report.rows.length} rows unmeasured, ${report.failed} failed${deferred}. Not alpha.`,
  );
  return `${lines.join("\n")}\n`;
}

async function main(argv: readonly string[]): Promise<void> {
  const json = argv.includes("--json");
  const write = argv.includes("--write");
  const unknown = argv.filter((arg) => arg !== "--json" && arg !== "--write");
  if (unknown.length > 0) {
    process.stderr.write(`TN_ALPHA_BAR_UNKNOWN_FLAG: ${unknown.join(", ")}\n`);
    process.exitCode = 2;
    return;
  }
  let report = await alphaBar();
  if (write) {
    const file = path.join(REPO, ALPHA_TABLE_FILE);
    const rows = report.rows.filter((row) => row.id !== "A7");
    writeGeneratedTableFile(file, renderTable(rows));
    // Re-measure A7 against what is now on disk rather than assuming the write took. Writing the
    // table never launders another row: A1 red before --write is A1 red after it.
    report = summariseAlphaBar([...rows, generatedTableRow(REPO, rows)]);
  }
  process.stdout.write(json ? `${JSON.stringify(report, undefined, 2)}\n` : formatReport(report));
  process.exitCode = report.exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
