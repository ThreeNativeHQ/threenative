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

export interface RoundLedger {
  readonly arms: readonly RoundArm[];
  readonly columns: readonly RoundColumnVerdict[];
  readonly date: string;
  readonly dispositions: readonly RoundDispositionRow[];
  readonly gaps: readonly RoundGap[];
  readonly gates: readonly RoundGate[];
  readonly nextAction: string;
  readonly notes: string;
  readonly path?: string;
  readonly round: number;
  readonly stopCondition: string;
}

const STOP_CONDITIONS = new Set([
  "none yet",
  "parity",
  "budget",
  "plateau",
  "blocked",
  "kill switch",
  "void",
]);
const PLACEHOLDER = /(?:^|\s)(?:TBD|<[^>]+>)(?:\s|$)/iu;

function section(markdown: string, title: string): string {
  const start = markdown.indexOf(`## ${title}`);
  if (start < 0) throw new Error(`Round ledger is missing '## ${title}'.`);
  const rest = markdown.slice(start + title.length + 3);
  const end = rest.search(/\n## /u);
  return end < 0 ? rest : rest.slice(0, end);
}

function cells(line: string): string[] {
  return line
    .trim()
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function table(markdown: string, title: string): { header: string[]; rows: string[][] } {
  const lines = section(markdown, title)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));
  if (lines.length < 2) throw new Error(`Round ledger section '${title}' has no table.`);
  const first = lines[0];
  if (first === undefined) throw new Error(`Round ledger section '${title}' has no header.`);
  const header = cells(first);
  const rows = lines
    .slice(2)
    .map(cells)
    .filter((row) => row.some((cell) => !/^[-:]+$/u.test(cell)));
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

function parseGaps(markdown: string): RoundGap[] {
  const parsed = table(markdown, "Gap list");
  const number = column(parsed.header, "#");
  const genre = column(parsed.header, "Genre");
  const columnName = column(parsed.header, "Column");
  const what = column(parsed.header, "What vanilla did better");
  const evidence = column(parsed.header, "Evidence");
  return parsed.rows
    .filter((row) => rowValue(row, number, "#") !== "None")
    .map((row) => ({
      column: rowValue(row, columnName, "Column"),
      evidence: rowValue(row, evidence, "Evidence"),
      genre: rowValue(row, genre, "Genre"),
      number: rowValue(row, number, "#"),
      what: rowValue(row, what, "What vanilla did better"),
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

export function parseRoundLedger(markdown: string, ledgerPath?: string): RoundLedger {
  const notes = section(markdown, "Notes").trim();
  const round = Number.parseInt(value(markdown, "Round"), 10);
  if (!Number.isInteger(round)) throw new Error("Round ledger field 'Round' is not an integer.");
  return {
    arms: parseArms(markdown),
    columns: parseColumns(markdown),
    date: value(markdown, "Date"),
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
  return ledger;
}

export function readRoundLedger(file: string): RoundLedger {
  return parseRoundLedger(fs.readFileSync(file, "utf8"), file);
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
