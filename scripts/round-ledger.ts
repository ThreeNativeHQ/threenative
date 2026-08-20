import fs from "node:fs";
import path from "node:path";

export type RoundDisposition = "framework change" | "user space" | "rejected";
export type RoundArmName = "framework" | "vanilla";

export interface RoundArm {
  readonly archive: string;
  readonly arm: RoundArmName;
  readonly briefHash: string;
  readonly genre: string;
  readonly instrumentVisual: string;
  readonly proofHash: string;
  readonly proofResult: string;
}

export interface RoundColumnVerdict {
  readonly cost: string;
  readonly functional: string;
  readonly genre: string;
  readonly visual: string;
}

export interface RoundGap {
  readonly column: string;
  readonly evidence: string;
  readonly genre: string;
  readonly number: string;
  readonly what: string;
}

export interface RoundDispositionRow {
  readonly caller: string;
  readonly disposition: string;
  readonly gap: string;
  readonly prd: string;
}

export interface RoundGate {
  readonly name: string;
  readonly result: string;
}

/**
 * One row of a round's before/after visual comparison, and the verdict the round drew from it.
 *
 * Optional: a round that ran no visual comparison has no such section and nothing here applies.
 * A round that *did* run one must state the resolution the comparison was read against, because
 * round 10 published seven deltas and only afterwards discovered that four of them were smaller
 * than the instrument could resolve.
 */
export interface RoundVisualDelta {
  readonly after: number;
  readonly before: number;
  readonly delta: number;
  readonly template: string;
  readonly verdict: string;
}

export interface RoundLedger {
  readonly arms: readonly RoundArm[];
  readonly columns: readonly RoundColumnVerdict[];
  readonly date: string;
  /** True only when the ledger's `Genres` field explicitly declares a no-arms round. */
  readonly declaresNoArms: boolean;
  readonly dispositions: readonly RoundDispositionRow[];
  readonly gaps: readonly RoundGap[];
  readonly gates: readonly RoundGate[];
  readonly nextAction: string;
  readonly notes: string;
  readonly path?: string;
  readonly round: number;
  readonly stopCondition: string;
  /** `null` when the round declares no visual comparison. */
  readonly visualMde: number | null;
  readonly visualDeltas: readonly RoundVisualDelta[];
}

/**
 * The two spellings of "no stop condition has been met". Round ledgers have been written with
 * both — the template says `none yet` and round 10 says `none` — and the difference is not a
 * difference in meaning. Anything outside this set is a real stop that halts the loop, so the
 * two must be recognised in one place rather than compared by string at each call site.
 */
export const NO_STOP_CONDITION = new Set(["none yet", "none"]);

const STOP_CONDITIONS = new Set([
  ...NO_STOP_CONDITION,
  "parity",
  "budget",
  "plateau",
  "blocked",
  "kill switch",
  "void",
]);
const PLACEHOLDER = /(?:^|\s)(?:TBD|<[^>]+>)(?:\s|$)/iu;

function hasSection(markdown: string, title: string): boolean {
  return markdown.indexOf(`## ${title}`) >= 0;
}

/**
 * Whether this ledger declares that it has no paired build.
 *
 * Round 10 opened on the template visual floor rather than on a framework/vanilla pair, so it
 * carries no `## Arms` and no `## Column verdicts`. `parseRoundLedger` demanded both,
 * `latestRoundFile` picks the newest ledger, and `pnpm round:next` — the loop's own "what next"
 * command — threw before it computed anything.
 *
 * The absence has to be **declared**, which is what keeps this fail-closed. A ledger that simply
 * lost its `## Arms` heading to a bad edit still throws; only one whose `Genres` field says it
 * has none may omit the sections that describe a pair. Inferring "no arms" from "no Arms
 * section" would turn a damaged ledger into a round that measured nothing and said so calmly.
 */
function declaresNoGenres(markdown: string): boolean {
  return /^none\b/iu.test(value(markdown, "Genres"));
}

function section(markdown: string, title: string): string {
  const start = markdown.indexOf(`## ${title}`);
  if (start < 0) throw new Error(`Round ledger is missing '## ${title}'.`);
  const rest = markdown.slice(start + title.length + 3);
  const end = rest.search(/\n## /u);
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * Splits a markdown table row on its *unescaped* pipes.
 *
 * `\|` is how markdown writes a literal pipe inside a cell, and round 5's gap list uses it for a
 * regex alternation: `applyImpulse\|applyForce\|setLinvel\|addForce`. Splitting on every pipe
 * shattered that one cell into five, so the row read ten cells against a six-column header and
 * every column after the third was silently read from the wrong place. Nothing reported it,
 * because the extra cells were simply ignored.
 */
function cells(line: string): string[] {
  return line
    .trim()
    .split(/(?<!\\)\|/u)
    .slice(1, -1)
    .map((cell) => cell.replaceAll("\\|", "|").trim());
}

/**
 * The first table in a section, and only that one.
 *
 * Every pipe line in the section used to be collected, so a section carrying a second table
 * silently merged it into the first. Round 10's `## Dispositions` records the dispositions and
 * then a two-shape comparison for an owner decision; its 3-cell rows were parsed as dispositions
 * and `pnpm round:next` died on a row "missing 'Named live caller'".
 *
 * A blank line or a line of prose ends the table. Rows are then required to match the header's
 * width: stopping early means a foreign row can no longer arrive from a neighbour, and the width
 * check means a malformed row inside the table still throws instead of yielding an undefined
 * cell that reads as an empty one.
 */
function table(markdown: string, title: string): { header: string[]; rows: string[][] } {
  const lines: string[] = [];
  for (const raw of section(markdown, title).split(/\r?\n/u)) {
    const line = raw.trim();
    const isRow = line.startsWith("|") && line.endsWith("|");
    if (isRow) lines.push(line);
    else if (lines.length > 0) break;
  }
  if (lines.length < 2) throw new Error(`Round ledger section '${title}' has no table.`);
  const first = lines[0];
  if (first === undefined) throw new Error(`Round ledger section '${title}' has no header.`);
  const header = cells(first);
  const rows = lines
    .slice(2)
    .map(cells)
    .filter((row) => row.some((cell) => !/^[-:]+$/u.test(cell)));
  for (const [index, row] of rows.entries())
    if (row.length !== header.length)
      throw new Error(
        `Round ledger section '${title}' row ${index + 1} has the wrong number of cells: expected ${header.length}, found ${row.length}.`,
      );
  return { header, rows };
}

function column(header: readonly string[], name: string): number {
  const index = header.indexOf(name);
  if (index < 0) throw new Error(`Round ledger table is missing column '${name}'.`);
  return index;
}

function rowValue(row: readonly string[], index: number, label: string): string {
  const result = row[index];
  if (result === undefined) throw new Error(`Round ledger row is missing '${label}'.`);
  return result;
}

function value(markdown: string, label: string): string {
  const line = markdown.split(/\r?\n/u).find((candidate) => candidate.startsWith(`${label}:`));
  if (line === undefined) throw new Error(`Round ledger is missing required field '${label}'.`);
  return line
    .slice(label.length + 1)
    .trim()
    .replaceAll("`", "");
}

function required(markdown: string, label: string): string {
  const result = value(markdown, label);
  if (result.length === 0 || PLACEHOLDER.test(result))
    throw new Error(`Round ledger field '${label}' is blank or still a placeholder.`);
  return result;
}

function parseArms(markdown: string): RoundArm[] {
  if (!hasSection(markdown, "Arms") && declaresNoGenres(markdown)) return [];
  const parsed = table(markdown, "Arms");
  const genre = column(parsed.header, "Genre");
  const armIndex = column(parsed.header, "Arm");
  const archive = column(parsed.header, "Archive");
  const briefHash = column(parsed.header, "Brief SHA-256");
  const proofHash = column(parsed.header, "Proof SHA-256");
  const proofResult = column(parsed.header, "Proof passed/total");
  const instrumentVisual = column(parsed.header, "Instrument visual");
  return parsed.rows.map((row, index) => {
    if (row.length !== parsed.header.length)
      throw new Error(`Round ledger Arms row ${index + 1} has the wrong number of cells.`);
    const arm = rowValue(row, armIndex, "Arm");
    if (arm !== "framework" && arm !== "vanilla")
      throw new Error(`Round ledger Arms row ${index + 1} has invalid arm '${arm}'.`);
    return {
      archive: rowValue(row, archive, "Archive"),
      arm,
      briefHash: rowValue(row, briefHash, "Brief SHA-256"),
      genre: rowValue(row, genre, "Genre"),
      instrumentVisual: rowValue(row, instrumentVisual, "Instrument visual"),
      proofHash: rowValue(row, proofHash, "Proof SHA-256"),
      proofResult: rowValue(row, proofResult, "Proof passed/total"),
    };
  });
}

function parseColumns(markdown: string): RoundColumnVerdict[] {
  if (!hasSection(markdown, "Column verdicts") && declaresNoGenres(markdown)) return [];
  const parsed = table(markdown, "Column verdicts");
  const cost = column(parsed.header, "Cost");
  const functional = column(parsed.header, "Functional");
  const genre = column(parsed.header, "Genre");
  const visual = column(parsed.header, "Visual");
  return parsed.rows.map((row) => ({
    cost: rowValue(row, cost, "Cost"),
    functional: rowValue(row, functional, "Functional"),
    genre: rowValue(row, genre, "Genre"),
    visual: rowValue(row, visual, "Visual"),
  }));
}

/**
 * A baseline round's gap list has a different shape, and honestly so: with no vanilla arm there
 * is no genre to attribute a gap to and nothing "vanilla did better", so round 10 writes
 * `| # | Column | Defect | Evidence | Smallest change |`. The paired columns are required as
 * before whenever the ledger names a genre — the alternative shape is unlocked by the same
 * declaration that unlocks the missing Arms section, not by a column simply being absent.
 */
function parseGaps(markdown: string): RoundGap[] {
  const parsed = table(markdown, "Gap list");
  const baseline = declaresNoGenres(markdown);
  const number = column(parsed.header, "#");
  const columnName = column(parsed.header, "Column");
  const evidence = column(parsed.header, "Evidence");
  const genre = baseline && !parsed.header.includes("Genre") ? -1 : column(parsed.header, "Genre");
  const what =
    baseline && !parsed.header.includes("What vanilla did better")
      ? column(parsed.header, "Defect")
      : column(parsed.header, "What vanilla did better");
  return parsed.rows
    .filter((row) => rowValue(row, number, "#") !== "None")
    .map((row) => ({
      column: rowValue(row, columnName, "Column"),
      evidence: rowValue(row, evidence, "Evidence"),
      genre: genre < 0 ? "none" : rowValue(row, genre, "Genre"),
      number: rowValue(row, number, "#"),
      what: rowValue(row, what, baseline ? "Defect" : "What vanilla did better"),
    }));
}

function parseDispositions(markdown: string): RoundDispositionRow[] {
  const parsed = table(markdown, "Dispositions");
  const gap = column(parsed.header, "Gap #");
  const disposition = column(parsed.header, "Disposition");
  const caller = column(parsed.header, "Named live caller");
  const prd = column(parsed.header, "PRD");
  return parsed.rows
    .filter((row) => rowValue(row, gap, "Gap #") !== "None")
    .map((row) => ({
      caller: rowValue(row, caller, "Named live caller"),
      disposition: rowValue(row, disposition, "Disposition"),
      gap: rowValue(row, gap, "Gap #"),
      prd: rowValue(row, prd, "PRD"),
    }));
}

function parseGates(markdown: string): RoundGate[] {
  const parsed = table(markdown, "Gates");
  const result = column(parsed.header, "Result");
  return parsed.rows.map((row) => ({
    name: rowValue(row, 0, "Gate"),
    result: rowValue(row, result, "Result"),
  }));
}

/**
 * The visual deltas a round reports, and the resolution it read them against.
 *
 * Absent by default, because most rounds run no visual comparison. Present, it is validated hard:
 * a delta at or under the stated minimum detectable effect may only be recorded `INDETERMINATE`.
 * Round 10 is the reason. It reported `+1`, `−1`, `−1` and `−1` as results, spent a day of work
 * acting on one of them, and its own calibration row — a template nobody touched moving a full
 * point — says none of the four carried information. Prose said so; the table did not, and the
 * table is what gets quoted.
 */
function parseVisualDeltas(markdown: string): RoundVisualDelta[] {
  if (!hasSection(markdown, "Visual deltas")) return [];
  const parsed = table(markdown, "Visual deltas");
  const template = column(parsed.header, "Template");
  const before = column(parsed.header, "Before");
  const after = column(parsed.header, "After");
  const delta = column(parsed.header, "Δ");
  const verdict = column(parsed.header, "Verdict");
  return parsed.rows.map((row) => ({
    after: Number(rowValue(row, after, "After")),
    before: Number(rowValue(row, before, "Before")),
    // `−` U+2212 is what a markdown table gets typed with, and `Number("−1")` is NaN.
    delta: Number(rowValue(row, delta, "Δ").replaceAll("−", "-").replace(/^\+/u, "")),
    template: rowValue(row, template, "Template"),
    verdict: rowValue(row, verdict, "Verdict").toUpperCase(),
  }));
}

function parseVisualMde(markdown: string): number | null {
  const line = markdown.split(/\r?\n/u).find((candidate) => candidate.startsWith("Visual MDE:"));
  if (line === undefined) return null;
  const raw = line.slice("Visual MDE:".length).trim().replaceAll("`", "");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`Round ledger field 'Visual MDE' is not a non-negative number: '${raw}'.`);
  return parsed;
}

export function parseRoundLedger(markdown: string, ledgerPath?: string): RoundLedger {
  const notes = section(markdown, "Notes").trim();
  const round = Number.parseInt(value(markdown, "Round"), 10);
  if (!Number.isInteger(round)) throw new Error("Round ledger field 'Round' is not an integer.");
  const declaresNoArms = declaresNoGenres(markdown);
  return {
    visualDeltas: parseVisualDeltas(markdown),
    visualMde: parseVisualMde(markdown),
    arms: parseArms(markdown),
    columns: parseColumns(markdown),
    date: value(markdown, "Date"),
    declaresNoArms,
    dispositions: parseDispositions(markdown),
    gaps: parseGaps(markdown),
    gates: parseGates(markdown),
    nextAction: value(markdown, "Next action"),
    notes,
    ...(ledgerPath === undefined ? {} : { path: ledgerPath }),
    round,
    stopCondition: value(markdown, "Stop condition met").toLowerCase(),
  };
}

function validMeasurement(valueToCheck: string, pattern: RegExp, label: string): void {
  if (valueToCheck !== "unmeasured" && !pattern.test(valueToCheck))
    throw new Error(`Round ledger ${label} is invalid: '${valueToCheck}'.`);
}

export function validateRoundLedger(markdown: string, filename = "round.md"): RoundLedger {
  const requiredFields = [
    "Round",
    "Date",
    "Framework commit",
    "Framework version",
    "Genres",
    "Budget",
    "Stop condition met",
    "Next action",
  ];
  for (const label of requiredFields) required(markdown, label);
  const ledger = parseRoundLedger(markdown, filename);
  if (ledger.round < 1) throw new Error(`${filename}: Round must be positive.`);
  if (!STOP_CONDITIONS.has(ledger.stopCondition))
    throw new Error(`${filename}: invalid stop condition '${ledger.stopCondition}'.`);
  if (ledger.nextAction.length === 0 || PLACEHOLDER.test(ledger.nextAction))
    throw new Error(`${filename}: Next action is blank or a placeholder.`);
  if (ledger.arms.length === 0) throw new Error(`${filename}: Arms table has no rows.`);

  const genres = new Set(ledger.arms.map((arm) => arm.genre));
  for (const genre of genres) {
    const arms = ledger.arms.filter((arm) => arm.genre === genre);
    if (arms.length !== 2 || new Set(arms.map((arm) => arm.arm)).size !== 2)
      throw new Error(`${filename}: genre '${genre}' must have framework and vanilla arms.`);
    if (new Set(arms.map((arm) => arm.briefHash)).size !== 1)
      throw new Error(`${filename}: genre '${genre}' has mismatched brief hashes.`);
    if (new Set(arms.map((arm) => arm.proofHash)).size !== 1)
      throw new Error(`${filename}: genre '${genre}' has mismatched proof hashes.`);
  }
  for (const arm of ledger.arms) {
    if (PLACEHOLDER.test(Object.values(arm).join(" ")))
      throw new Error(`${filename}: Arms contains a placeholder.`);
    validMeasurement(arm.proofResult, /^\d+\/\d+$/u, "proof result");
    validMeasurement(arm.instrumentVisual, /^[1-5]$/u, "instrument visual");
    validMeasurement(arm.archive, /^.+$/u, "archive");
  }

  if (ledger.columns.length !== genres.size)
    throw new Error(`${filename}: Column verdicts must have one row per genre.`);
  for (const row of ledger.columns) {
    if (
      ![row.functional, row.visual, row.cost].every((item) => ["win", "tie", "loss"].includes(item))
    )
      throw new Error(`${filename}: column verdicts must be win, tie, or loss.`);
  }

  const gapNumbers = new Set(ledger.gaps.map((gap) => gap.number));
  if (gapNumbers.size !== ledger.gaps.length)
    throw new Error(`${filename}: Gap list contains duplicate numbers.`);
  for (const gap of ledger.gaps) {
    if (
      !/^\d+$/u.test(gap.number) ||
      Object.values(gap).some((item) => item.length === 0 || PLACEHOLDER.test(item))
    )
      throw new Error(`${filename}: Gap list contains an incomplete row.`);
  }
  const dispositionMap = new Map(ledger.dispositions.map((row) => [row.gap, row]));
  if (dispositionMap.size !== ledger.dispositions.length || dispositionMap.size !== gapNumbers.size)
    throw new Error(`${filename}: every gap must have exactly one disposition.`);
  for (const row of ledger.dispositions) {
    if (!["framework change", "user space", "rejected"].includes(row.disposition))
      throw new Error(`${filename}: invalid disposition '${row.disposition}'.`);
    if (
      row.disposition === "framework change" &&
      (row.caller === "n/a" || !/^PRD-\d+$/u.test(row.prd))
    )
      throw new Error(`${filename}: framework changes need a live caller and PRD.`);
    if (Object.values(row).some((item) => item.length === 0 || PLACEHOLDER.test(item)))
      throw new Error(`${filename}: Dispositions contains a placeholder.`);
  }

  const gates = table(markdown, "Gates");
  const gateNames = new Set(gates.rows.map((row) => row[0]));
  if (!["Typecheck", "Lint", "Test", "Budgets"].every((name) => gateNames.has(name)))
    throw new Error(`${filename}: Gates must contain typecheck, lint, test, and budgets.`);
  if (gates.rows.some((row) => !["pass", "fail", "unmeasured"].includes(row[2] ?? "")))
    throw new Error(`${filename}: gate results must be pass, fail, or unmeasured.`);

  const firewall = table(markdown, "Firewall attestation");
  if (
    firewall.rows.length !== 4 ||
    firewall.rows.some((row) => !["yes", "no"].includes(row[1] ?? ""))
  )
    throw new Error(`${filename}: Firewall attestation must have four yes/no rows.`);
  if (firewall.rows.some((row) => row[1] === "no") && ledger.stopCondition !== "void")
    throw new Error(`${filename}: a failed firewall requires Stop condition met: void.`);
  if (
    /\bunmeasured\b/iu.test(markdown) &&
    (ledger.notes.length < 10 || PLACEHOLDER.test(ledger.notes))
  )
    throw new Error(`${filename}: unmeasured evidence needs an explanatory Notes section.`);

  assertVisualDeltasResolvable(ledger, filename);
  return ledger;
}

/**
 * A visual comparison may not report a delta its own instrument could not resolve.
 *
 * Split out of `validateRoundLedger` so `readRoundLedger` can enforce it too. `pnpm round:next`
 * reads without validating — turning full validation on there would reject historical ledgers for
 * reasons unrelated to this rule — but a sub-resolution delta recorded as a result is precisely
 * the thing the loop must not be allowed to act on, and `round:next` is what tells it what to do
 * next.
 */
export function assertVisualDeltasResolvable(ledger: RoundLedger, filename: string): void {
  // A visual comparison with no stated resolution is round 10 again: seven deltas, four of them
  // smaller than the instrument could tell apart, and no field in the ledger saying so.
  if (ledger.visualDeltas.length > 0 && ledger.visualMde === null)
    throw new Error(
      `${filename}: a Visual deltas table needs a 'Visual MDE:' field stating the resolution it was read against.`,
    );
  for (const row of ledger.visualDeltas) {
    if (!["WIN", "LOSS", "INDETERMINATE"].includes(row.verdict))
      throw new Error(
        `${filename}: visual delta for '${row.template}' has verdict '${row.verdict}'; expected WIN, LOSS or INDETERMINATE.`,
      );
    if (!Number.isFinite(row.delta) || row.delta !== row.after - row.before)
      throw new Error(
        `${filename}: visual delta for '${row.template}' is ${row.delta}, which is not ${row.after} − ${row.before}.`,
      );
    if (Math.abs(row.delta) <= (ledger.visualMde as number) && row.verdict !== "INDETERMINATE")
      throw new Error(
        `${filename}: visual delta for '${row.template}' is ${row.delta} against a measured MDE of ${String(ledger.visualMde)}; the instrument cannot resolve it, so it may only be recorded INDETERMINATE, not '${row.verdict}'.`,
      );
  }
}

export function readRoundLedger(file: string): RoundLedger {
  const ledger = parseRoundLedger(fs.readFileSync(file, "utf8"), file);
  assertVisualDeltasResolvable(ledger, file);
  return ledger;
}

export function latestRoundFile(repo: string): string {
  const directory = path.join(repo, "docs", "verification");
  const files = fs.readdirSync(directory).flatMap((file) => {
    const match = /^round-(\d+)-.+\.md$/u.exec(file);
    return match === null ? [] : [{ file: path.join(directory, file), number: Number(match[1]) }];
  });
  if (files.length === 0) throw new Error(`No round ledger found in ${directory}.`);
  const latest = files.sort(
    (left, right) => right.number - left.number || left.file.localeCompare(right.file),
  )[0];
  if (latest === undefined) throw new Error(`No round ledger found in ${directory}.`);
  return latest.file;
}
