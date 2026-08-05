import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type SweepManifest, readManifest } from "./make-sandbox.js";
import { type SweepMeasurement, measureSandbox } from "./measure-sandbox.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface FrictionRow {
  readonly apiOrSurface: string;
  readonly whatBlocked: string;
  readonly workaround: string;
  readonly evidence: string;
}

export interface SweepLedger {
  readonly archive: string;
  readonly round: number;
  readonly frictionRows: readonly FrictionRow[];
}

interface SweepSnapshot {
  readonly archive: string;
  readonly round: number;
  readonly frameworkVersion: string;
  readonly reachRate: number;
}

export interface SweepDelta {
  readonly genre: string;
  readonly briefHash: string;
  readonly before: SweepSnapshot;
  readonly after: SweepSnapshot;
  readonly reachRate: {
    readonly before: number;
    readonly after: number;
    readonly delta: number;
  };
  readonly movedToUsed: readonly string[];
  readonly stillUntouched: readonly string[];
  readonly frictionRowsCarriedOver: readonly FrictionRow[];
}

function requiredField(markdown: string, label: string, file: string): string {
  const line = markdown.split(/\r?\n/).find((candidate) => candidate.startsWith(`${label}:`));
  if (line === undefined) throw new Error(`${file}: missing required field ${label}.`);
  const value = line
    .slice(label.length + 1)
    .trim()
    .replaceAll("`", "");
  if (value.length === 0 || /TBD/i.test(value) || /^<.*>$/.test(value))
    throw new Error(`${file}: required field ${label} is blank.`);
  return value;
}

function tableCells(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function parseFrictionRows(markdown: string, file: string): FrictionRow[] {
  const heading = markdown.indexOf("## Friction ledger");
  if (heading < 0) throw new Error(`${file}: missing friction ledger.`);
  const rows = markdown
    .slice(heading)
    .split(/\r?\n/)
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .map(tableCells)
    .filter((cells) => cells.length > 0 && !cells.every((cell) => /^-+$/.test(cell)));
  const dataRows = rows.filter((cells) => cells[0] !== "API or surface");
  if (dataRows.length === 0) throw new Error(`${file}: friction ledger has no observation row.`);
  return dataRows.map((cells, index) => {
    if (
      cells.length !== 4 ||
      cells.some((cell) => cell.length === 0 || /TBD/i.test(cell) || /^<.*>$/.test(cell))
    )
      throw new Error(`${file}: friction row ${index + 1} is incomplete.`);
    return {
      apiOrSurface: cells[0] as string,
      whatBlocked: cells[1] as string,
      workaround: cells[2] as string,
      evidence: cells[3] as string,
    };
  });
}

function ledgerFiles(repo: string): string[] {
  const directory = path.join(repo, "docs", "verification");
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((file) => file.startsWith("sweep-") && file.endsWith(".md"))
    .map((file) => path.join(directory, file));
}

export function readSweepLedger(archiveDirectory: string, repo = REPO): SweepLedger {
  const archive = path.resolve(archiveDirectory);
  const matches = ledgerFiles(repo).filter((file) => {
    const markdown = fs.readFileSync(file, "utf8");
    try {
      return path.resolve(repo, requiredField(markdown, "Archive", file)) === archive;
    } catch {
      return false;
    }
  });
  if (matches.length === 0)
    throw new Error(`Cannot compare '${archive}': missing verification ledger for the archive.`);
  if (matches.length > 1)
    throw new Error(`Cannot compare '${archive}': multiple verification ledgers name the archive.`);
  const file = matches[0] as string;
  const markdown = fs.readFileSync(file, "utf8");
  const round = Number(requiredField(markdown, "Round", file));
  if (!Number.isInteger(round) || round < 1)
    throw new Error(`${file}: Round must be a positive integer.`);
  return {
    archive,
    round,
    frictionRows: parseFrictionRows(markdown, file),
  };
}

function snapshot(
  archive: string,
  manifest: SweepManifest,
  measurement: SweepMeasurement,
  ledger: SweepLedger,
): SweepSnapshot {
  return {
    archive,
    round: ledger.round,
    frameworkVersion: manifest.frameworkVersion,
    reachRate: measurement.reachRate,
  };
}

function rowKey(row: FrictionRow): string {
  return row.apiOrSurface.replaceAll("`", "").trim().toLowerCase();
}

function relativeArchive(archive: string, repo: string): string {
  const relative = path.relative(repo, archive);
  return relative.length === 0 ? "." : relative;
}

export function compareSweeps(
  beforeDirectory: string,
  afterDirectory: string,
  repo = REPO,
): SweepDelta {
  const before = path.resolve(beforeDirectory);
  const after = path.resolve(afterDirectory);
  if (before === after) throw new Error("Cannot compare a sweep archive with itself.");

  const beforeManifest = readManifest(path.join(before, "sweep.json"));
  const afterManifest = readManifest(path.join(after, "sweep.json"));
  if (beforeManifest.genre !== afterManifest.genre)
    throw new Error(
      `Cannot compare sweeps from different genres: '${beforeManifest.genre}' and '${afterManifest.genre}'.`,
    );
  if (beforeManifest.briefHash !== afterManifest.briefHash)
    throw new Error("Cannot compare sweeps with different brief hashes.");

  const beforeMeasurement = measureSandbox(before);
  const afterMeasurement = measureSandbox(after);
  const beforeLedger = readSweepLedger(before, repo);
  const afterLedger = readSweepLedger(after, repo);
  const movedToUsed = beforeMeasurement.unusedExports.filter((name) =>
    afterMeasurement.usedExports.includes(name),
  );
  const stillUntouched = beforeMeasurement.unusedExports.filter((name) =>
    afterMeasurement.unusedExports.includes(name),
  );
  const afterRows = new Map(afterLedger.frictionRows.map((row) => [rowKey(row), row]));
  const frictionRowsCarriedOver = beforeLedger.frictionRows
    .filter((row) => rowKey(row) !== "none")
    .flatMap((row) => {
      const carried = afterRows.get(rowKey(row));
      return carried === undefined ? [] : [carried];
    });
  const beforeSnapshot = snapshot(
    relativeArchive(before, repo),
    beforeManifest,
    beforeMeasurement,
    beforeLedger,
  );
  const afterSnapshot = snapshot(
    relativeArchive(after, repo),
    afterManifest,
    afterMeasurement,
    afterLedger,
  );
  return {
    genre: beforeManifest.genre,
    briefHash: beforeManifest.briefHash,
    before: beforeSnapshot,
    after: afterSnapshot,
    reachRate: {
      before: beforeMeasurement.reachRate,
      after: afterMeasurement.reachRate,
      delta: afterMeasurement.reachRate - beforeMeasurement.reachRate,
    },
    movedToUsed: movedToUsed.sort(),
    stillUntouched: stillUntouched.sort(),
    frictionRowsCarriedOver,
  };
}

function main(): void {
  const before = process.argv[2];
  const after = process.argv[3];
  if (before === undefined || after === undefined)
    throw new Error("Usage: pnpm sweep:delta <before-archive> <after-archive>.");
  process.stdout.write(`${JSON.stringify(compareSweeps(before, after), null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
