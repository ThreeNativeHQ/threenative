#!/usr/bin/env tsx
/**
 * Checks a parity ledger in `docs/verification/` against the conformance reports it names.
 *
 * A markdown ledger is a transcription, and a transcription drifts without anything going red:
 * `parity-2026-08-10-r2.md` records a desktop lane of 66 pass / 0 fail / 1 blocked at exit `0`,
 * which the runner cannot emit, because `blocked > 0` exits `2`. This checker recomputes every
 * exit cell from the runner's own rule instead of reading the number back, and then compares the
 * whole row against the report the command's `--out` points at.
 *
 * Fail closed everywhere: an unparseable table, an empty row set, a missing report and a
 * mismatched cell are all errors. There is no flag that turns one into a skip.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const runtimeRoot = join(repositoryRoot, "packages/runtime-native");
const runnerPath = join(runtimeRoot, "conformance/run-conformance.mjs");

const TARGET_HEADING = "## Target results";
const TARGET_COLUMNS = ["Target", "Command", "Pass", "Fail", "Blocked", "Exit", "Outcome"];

export interface ILedgerRow {
  target: string;
  command: string;
  pass: number;
  fail: number;
  blocked: number;
  exit: number;
}

export interface ILedgerFinding {
  target: string;
  cell: string;
  message: string;
}

interface ISummary {
  pass: number;
  fail: number;
  blocked: number;
}

interface ISupplemental {
  androidMultitouch?: { status?: string };
  expiredExclusions?: unknown[];
}

interface IExitReport {
  summary: ISummary;
  supplemental?: ISupplemental;
}

/** The runner's rule, loaded from the runner so the two can never drift apart. */
export async function loadReportExitCode(): Promise<(report: IExitReport) => number> {
  const module = (await import(pathToFileURL(runnerPath).href)) as Record<string, unknown>;
  const rule = module.reportExitCode;
  if (typeof rule !== "function") {
    const reason = "does not export reportExitCode, so no exit cell can be recomputed";
    throw new Error(`TN_PARITY_LEDGER_RULE_MISSING: ${runnerPath} ${reason}.`);
  }
  return rule as (report: IExitReport) => number;
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function targetSection(markdown: string): string {
  const index = markdown.indexOf(`${TARGET_HEADING}\n`);
  if (index === -1) {
    throw new Error(`TN_PARITY_LEDGER_UNPARSEABLE: no "${TARGET_HEADING}" section.`);
  }
  const remainder = markdown.slice(index + TARGET_HEADING.length);
  const next = remainder.search(/^## /mu);
  return next === -1 ? remainder : remainder.slice(0, next);
}

function count(cell: string | undefined, column: string, target: string): number {
  const value = Number((cell ?? "").replaceAll("*", "").replaceAll("`", "").trim());
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `TN_PARITY_LEDGER_UNPARSEABLE: ${target} column ${column} is not a count: "${cell}".`,
    );
  }
  return value;
}

export function parseLedger(markdown: string): ILedgerRow[] {
  const [headerLine, separatorLine, ...dataLines] = targetSection(markdown)
    .split(/\r?\n/u)
    .filter((line) => /^\s*\|.*\|\s*$/u.test(line));
  if (headerLine === undefined || separatorLine === undefined || dataLines.length === 0) {
    throw new Error(
      "TN_PARITY_LEDGER_UNPARSEABLE: the target table needs a header, a separator and at least " +
        "one row.",
    );
  }
  const header = tableCells(headerLine);
  if (JSON.stringify(header) !== JSON.stringify(TARGET_COLUMNS)) {
    throw new Error(
      `TN_PARITY_LEDGER_UNPARSEABLE: target table header is ${JSON.stringify(header)}, ` +
        `expected ${JSON.stringify(TARGET_COLUMNS)}.`,
    );
  }
  return dataLines.map((line) => {
    const cells = tableCells(line);
    const [target, command, pass, fail, blocked, exit] = cells;
    if (cells.length !== TARGET_COLUMNS.length || target === undefined) {
      throw new Error(`TN_PARITY_LEDGER_UNPARSEABLE: row width changed: ${line.trim()}`);
    }
    return {
      target,
      command: (command ?? "").replaceAll("`", "").trim(),
      pass: count(pass, "Pass", target),
      fail: count(fail, "Fail", target),
      blocked: count(blocked, "Blocked", target),
      exit: count(exit, "Exit", target),
    };
  });
}

function optionValue(command: string, flag: string): string | null {
  const tokens = command.split(/\s+/u).filter(Boolean);
  const index = tokens.indexOf(flag);
  if (index === -1) return null;
  const value = tokens[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

/** Mirrors the runner's `outputLayout`: a relative `--out` resolves against the package root. */
export function reportPathFor(command: string): string {
  const out = optionValue(command, "--out");
  const target = optionValue(command, "--target") ?? "all";
  const base = out ?? `artifacts/conformance/${target}`;
  const absolute = isAbsolute(base) ? base : resolve(runtimeRoot, base);
  return absolute.toLowerCase().endsWith(".json") ? absolute : join(absolute, "report.json");
}

function summaryOf(report: unknown, target: string, path: string): ISummary {
  const summary = (report as { summary?: Record<string, unknown> } | null)?.summary;
  const numbers: Record<string, number> = {};
  for (const key of ["pass", "fail", "blocked"]) {
    const value = summary?.[key];
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new Error(
        `TN_PARITY_LEDGER_REPORT_INVALID: ${target}: ${path} has no integer summary.${key}.`,
      );
    }
    numbers[key] = value;
  }
  return numbers as unknown as ISummary;
}

function supplementalOf(report: unknown): ISupplemental | undefined {
  return (report as { supplemental?: ISupplemental } | null)?.supplemental;
}

export function checkRow(
  row: ILedgerRow,
  exitRule: (report: IExitReport) => number,
  readReport: (path: string) => unknown | null,
): ILedgerFinding[] {
  const findings: ILedgerFinding[] = [];
  const path = reportPathFor(row.command);
  const report = readReport(path);
  const supplemental = supplementalOf(report);
  const recorded = { pass: row.pass, fail: row.fail, blocked: row.blocked };
  const recomputed = exitRule({ summary: recorded, supplemental });
  if (recomputed !== row.exit) {
    findings.push({
      target: row.target,
      cell: "Exit",
      message:
        `records exit ${row.exit}, but a summary of ${row.pass} pass / ${row.fail} fail / ` +
        `${row.blocked} blocked exits ${recomputed}. The runner cannot emit the recorded value.`,
    });
  }
  if (report === null) {
    findings.push({
      target: row.target,
      cell: "Command",
      message: `names --out report ${path}, which does not exist, so no cell in this row is traceable.`,
    });
    return findings;
  }
  const summary = summaryOf(report, row.target, path);
  for (const [key, cell] of [
    ["pass", "Pass"],
    ["fail", "Fail"],
    ["blocked", "Blocked"],
  ] as const) {
    if (summary[key] !== recorded[key]) {
      findings.push({
        target: row.target,
        cell,
        message: `records ${recorded[key]}, but ${path} reports ${summary[key]}.`,
      });
    }
  }
  const reportExit = exitRule({ summary, supplemental });
  if (reportExit !== row.exit) {
    findings.push({
      target: row.target,
      cell: "Exit",
      message: `records exit ${row.exit}, but ${path} recomputes to exit ${reportExit}.`,
    });
  }
  return findings;
}

function readReportFile(path: string): unknown | null {
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export async function checkLedger(
  markdown: string,
  readReport: (path: string) => unknown | null = readReportFile,
): Promise<ILedgerFinding[]> {
  const exitRule = await loadReportExitCode();
  return parseLedger(markdown).flatMap((row) => checkRow(row, exitRule, readReport));
}

async function main(argv: string[]): Promise<number> {
  const paths = argv
    .filter((argument) => !argument.startsWith("--"))
    .map((path) => resolve(process.cwd(), path));
  if (paths.length === 0) {
    process.stderr.write(
      "TN_PARITY_LEDGER_EMPTY: name at least one ledger to check, " +
        "e.g. pnpm parity:ledger docs/verification/parity-2026-08-10-r2.md\n",
    );
    return 1;
  }
  let failed = false;
  for (const path of paths) {
    if (!existsSync(path)) {
      process.stderr.write(`TN_PARITY_LEDGER_MISSING: ${path}\n`);
      failed = true;
      continue;
    }
    let findings: ILedgerFinding[];
    try {
      findings = await checkLedger(readFileSync(path, "utf8"));
    } catch (error) {
      process.stderr.write(`${path}: ${error instanceof Error ? error.message : String(error)}\n`);
      failed = true;
      continue;
    }
    if (findings.length === 0) {
      process.stdout.write(`ok  ${path}\n`);
      continue;
    }
    failed = true;
    process.stderr.write(`FAIL ${path}\n`);
    for (const finding of findings) {
      process.stderr.write(`  ${finding.target} / ${finding.cell}: ${finding.message}\n`);
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    });
}
