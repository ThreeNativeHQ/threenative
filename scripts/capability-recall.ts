import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ICapabilitySearchResult,
  loadCapabilityManifest,
  searchCapabilities,
} from "../packages/engine-mcp/src/index.js";

export type CapabilityRecallScope = "request" | "mechanic";

export interface ICapabilityRecallRow {
  readonly id: string;
  readonly query: string;
  readonly scope: CapabilityRecallScope;
  readonly source: string;
  readonly expect: readonly string[];
  readonly reject: readonly string[];
}

export interface ICapabilityRecallCorpus {
  readonly version: 1;
  readonly rows: readonly ICapabilityRecallRow[];
}

export interface ICapabilityRecallBudget {
  readonly version: 1;
  readonly zeroResultRate: number;
  readonly recallAtK: number;
  readonly rejectHits: number;
  readonly rowCount: number;
  readonly rowIds: readonly string[];
  readonly recalledRows: readonly string[];
}

export interface IRecallRowResult {
  readonly id: string;
  readonly query: string;
  readonly scope: CapabilityRecallScope;
  readonly source: string;
  readonly returned: readonly string[];
  readonly expected: readonly string[];
  readonly rejected: readonly string[];
  readonly zeroResult: boolean;
  readonly recalled: boolean;
  readonly rejectHit: boolean;
}

export interface IRecallMetrics {
  readonly rowCount: number;
  readonly zeroResults: number;
  readonly zeroResultRate: number;
  readonly recalled: number;
  readonly recallAtK: number;
  readonly rejectHits: number;
}

export interface IRecallRegression {
  readonly metric:
    | "zeroResultRate"
    | "recallAtK"
    | "rejectHits"
    | "rowCount"
    | "rowIds"
    | "recalledRows";
  readonly message: string;
  readonly rowIds: readonly string[];
}

export interface IRecallReport {
  readonly metrics: IRecallMetrics;
  readonly rows: readonly IRecallRowResult[];
  readonly budget: ICapabilityRecallBudget;
  readonly regressions: readonly IRecallRegression[];
}

export class CapabilityRecallError extends Error {
  constructor(message: string) {
    super(`TN_CAPABILITY_RECALL: ${message}`);
    this.name = "CapabilityRecallError";
  }
}

const CORPUS_FILE = "scripts/fixtures/capability-recall/corpus.json";
const BUDGET_FILE = "scripts/fixtures/capability-recall/budget.json";
const MANIFEST_FILE = "packages/create-threenative/capabilities.json";

function fail(message: string): never {
  throw new CapabilityRecallError(message);
}

function readJson<T>(file: string): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (error) {
    return fail(`${file} cannot be read as JSON: ${String(error)}`);
  }
}

function validateCorpus(value: unknown, file: string): ICapabilityRecallCorpus {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { version?: unknown }).version !== 1 ||
    !Array.isArray((value as { rows?: unknown }).rows)
  ) {
    return fail(`${file} must contain version 1 and a rows array`);
  }
  const rows = (value as { rows: unknown[] }).rows.map((row, index) => {
    if (
      typeof row !== "object" ||
      row === null ||
      typeof (row as { id?: unknown }).id !== "string" ||
      typeof (row as { query?: unknown }).query !== "string" ||
      !["mechanic", "request"].includes((row as { scope?: unknown }).scope as string) ||
      typeof (row as { source?: unknown }).source !== "string" ||
      !Array.isArray((row as { expect?: unknown }).expect) ||
      !Array.isArray((row as { reject?: unknown }).reject)
    ) {
      return fail(`${file} row ${index} is malformed`);
    }
    const candidate = row as ICapabilityRecallRow;
    if (
      candidate.id.trim().length === 0 ||
      candidate.query.trim().length === 0 ||
      candidate.source.trim().length === 0 ||
      candidate.expect.length === 0 ||
      candidate.expect.some((symbol) => typeof symbol !== "string") ||
      candidate.reject.some((symbol) => typeof symbol !== "string")
    ) {
      return fail(`${file} row ${index} has an empty or malformed field`);
    }
    return candidate;
  });
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) fail(`${file} contains duplicate row id '${row.id}'`);
    ids.add(row.id);
  }
  if (rows.length === 0) fail(`${file} cannot contain an empty corpus`);
  return { rows, version: 1 };
}

function validateBudget(value: unknown, file: string): ICapabilityRecallBudget {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { version?: unknown }).version !== 1
  ) {
    return fail(`${file} must contain budget version 1`);
  }
  const budget = value as ICapabilityRecallBudget;
  if (
    !Number.isFinite(budget.zeroResultRate) ||
    !Number.isFinite(budget.recallAtK) ||
    !Number.isInteger(budget.rejectHits) ||
    !Number.isInteger(budget.rowCount) ||
    !Array.isArray(budget.rowIds) ||
    !Array.isArray(budget.recalledRows)
  ) {
    return fail(`${file} has malformed metric floors`);
  }
  return budget;
}

function checkedSymbols(
  results: readonly ICapabilitySearchResult[],
  row: ICapabilityRecallRow,
): readonly string[] {
  const symbols = results.map((result) => result.symbol);
  if (symbols.some((symbol) => symbol.trim().length === 0)) {
    fail(`${row.id}: search returned a result without a symbol`);
  }
  return symbols;
}

export function measureRecall(
  rows: readonly ICapabilityRecallRow[],
  manifestFile: string,
): { readonly metrics: IRecallMetrics; readonly rows: readonly IRecallRowResult[] } {
  const manifest = loadCapabilityManifest(manifestFile);
  const symbols = new Set(manifest.entries.map((entry) => entry.symbol));
  for (const row of rows) {
    for (const symbol of [...row.expect, ...row.reject]) {
      if (!symbols.has(symbol)) fail(`${row.id}: symbol '${symbol}' is absent from the manifest`);
    }
  }
  const results = rows.map((row): IRecallRowResult => {
    let response: ReturnType<typeof searchCapabilities>;
    try {
      response = searchCapabilities(row.query, manifestFile, row.scope);
    } catch (error) {
      fail(`${row.id}: search failed: ${String(error)}`);
    }
    const returned = checkedSymbols(response.results, row);
    const expected = row.expect.filter((symbol) => returned.includes(symbol));
    const rejected = row.reject.filter((symbol) => returned.includes(symbol));
    return {
      expected,
      id: row.id,
      query: row.query,
      rejected,
      rejectHit: rejected.length > 0,
      recalled: expected.length > 0,
      returned,
      scope: row.scope,
      source: row.source,
      zeroResult: returned.length === 0,
    };
  });
  const rowCount = results.length;
  if (rowCount === 0) fail("cannot score an empty corpus");
  const zeroResults = results.filter((row) => row.zeroResult).length;
  const recalled = results.filter((row) => row.recalled).length;
  return {
    metrics: {
      recalled,
      recallAtK: recalled / rowCount,
      rejectHits: results.filter((row) => row.rejectHit).length,
      rowCount,
      zeroResultRate: zeroResults / rowCount,
      zeroResults,
    },
    rows: results,
  };
}

function compareBudget(
  measurement: ReturnType<typeof measureRecall>,
  budget: ICapabilityRecallBudget,
): readonly IRecallRegression[] {
  const regressions: IRecallRegression[] = [];
  const actualIds = measurement.rows.map((row) => row.id);
  const missingIds = budget.rowIds.filter((id) => !actualIds.includes(id));
  const addedIds = actualIds.filter((id) => !budget.rowIds.includes(id));
  if (measurement.metrics.zeroResultRate > budget.zeroResultRate + Number.EPSILON)
    regressions.push({
      message: `zeroResultRate ${measurement.metrics.zeroResultRate} exceeds ${budget.zeroResultRate}`,
      metric: "zeroResultRate",
      rowIds: measurement.rows.filter((row) => row.zeroResult).map((row) => row.id),
    });
  if (measurement.metrics.recallAtK + Number.EPSILON < budget.recallAtK)
    regressions.push({
      message: `recallAtK ${measurement.metrics.recallAtK} is below ${budget.recallAtK}`,
      metric: "recallAtK",
      rowIds: measurement.rows.filter((row) => !row.recalled).map((row) => row.id),
    });
  if (measurement.metrics.rejectHits > budget.rejectHits)
    regressions.push({
      message: `rejectHits ${measurement.metrics.rejectHits} exceeds ${budget.rejectHits}`,
      metric: "rejectHits",
      rowIds: measurement.rows.filter((row) => row.rejectHit).map((row) => row.id),
    });
  if (
    measurement.metrics.rowCount < budget.rowCount ||
    missingIds.length > 0 ||
    addedIds.length > 0
  )
    regressions.push({
      message: `corpus identity changed; missing ${missingIds.join(", ") || "(none)"}; added ${addedIds.join(", ") || "(none)"}`,
      metric: "rowIds",
      rowIds: [...missingIds, ...addedIds],
    });
  const recalled = new Map(measurement.rows.map((row) => [row.id, row.recalled]));
  const recalledRegressions = budget.recalledRows.filter((id) => recalled.get(id) !== true);
  if (recalledRegressions.length > 0)
    regressions.push({
      message: `previously recalled rows regressed: ${recalledRegressions.join(", ")}`,
      metric: "recalledRows",
      rowIds: recalledRegressions,
    });
  return regressions;
}

export function runRecall(root = process.cwd()): IRecallReport {
  const corpus = validateCorpus(readJson(path.join(root, CORPUS_FILE)), CORPUS_FILE);
  const budget = validateBudget(readJson(path.join(root, BUDGET_FILE)), BUDGET_FILE);
  const manifestFile = path.join(root, MANIFEST_FILE);
  const measurement = measureRecall(corpus.rows, manifestFile);
  return { ...measurement, budget, regressions: compareBudget(measurement, budget) };
}

function formatReport(report: IRecallReport): string {
  const { metrics } = report;
  const misses = report.rows.filter((row) => !row.recalled).map((row) => `${row.id}: ${row.query}`);
  return [
    `Capability recall (${metrics.rowCount} rows)`,
    `zeroResultRate: ${metrics.zeroResultRate.toFixed(6)} (${metrics.zeroResults}/${metrics.rowCount})`,
    `recallAtK: ${metrics.recallAtK.toFixed(6)} (${metrics.recalled}/${metrics.rowCount})`,
    `rejectHits: ${metrics.rejectHits}`,
    "",
    `Misses (${misses.length})`,
    ...misses.map((miss) => `- ${miss}`),
    ...(report.regressions.length === 0
      ? []
      : [
          "",
          "Regressions",
          ...report.regressions.map((item) => `- ${item.metric}: ${item.message}`),
        ]),
    "",
  ].join("\n");
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  path.resolve(entryPath) === path.resolve(fileURLToPath(import.meta.url))
) {
  try {
    const report = runRecall();
    process.stdout.write(
      process.argv.includes("--json")
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatReport(report),
    );
    if (report.regressions.length > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
