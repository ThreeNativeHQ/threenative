import fs from "node:fs";
import path from "node:path";
import { readManifest } from "./make-sandbox.js";
import { measureSandbox } from "./measure-sandbox.js";
import { type RoundArm, type RoundLedger, readRoundLedger } from "./round-ledger.js";

const REPO = path.resolve(import.meta.dirname, "..");
const ARCHIVE_PLACEHOLDERS = new Set(["pending", "unmeasured", "None", "n/a"]);

export interface DeletionArchive {
  readonly archive: string;
  readonly arm: "framework";
  readonly genre: string;
  readonly round: number;
  readonly unusedExports: readonly string[];
}

export interface PersistentUnusedExport {
  readonly archives: readonly string[];
  readonly exportName: string;
  readonly roundsUnreached: number;
}

export interface RoundDeletionReport {
  readonly archivesChecked: readonly DeletionArchive[];
  readonly candidates: readonly PersistentUnusedExport[];
  readonly currentRound: number;
  readonly noFrameworkArms: readonly number[];
  readonly previousRound: number;
  readonly visualOnlyRounds: readonly number[];
}

interface RoundFile {
  readonly file: string;
  readonly number: number;
}

function isDirectory(directory: string): boolean {
  return fs.existsSync(directory) && fs.statSync(directory).isDirectory();
}

function archivePath(archive: string, repo: string): string {
  if (ARCHIVE_PLACEHOLDERS.has(archive))
    throw new Error(`Round deletion report cannot measure placeholder archive '${archive}'.`);
  return path.isAbsolute(archive) ? archive : path.resolve(repo, archive);
}

function roundFiles(repo: string): RoundFile[] {
  const directory = path.join(repo, "docs", "verification");
  if (!isDirectory(directory)) throw new Error(`Missing round ledger directory: ${directory}`);
  return fs
    .readdirSync(directory)
    .flatMap((name) => {
      const match = /^round-(\d+)-.+\.md$/u.exec(name);
      return match === null
        ? []
        : [{ file: path.join(directory, name), number: Number.parseInt(match[1] as string, 10) }];
    })
    .sort((left, right) => right.number - left.number || left.file.localeCompare(right.file));
}

function currentAndPreviousLedgers(repo: string): { current: RoundLedger; previous: RoundLedger } {
  const files = roundFiles(repo);
  const currentFile = files[0];
  if (currentFile === undefined)
    throw new Error(`No round ledger found in ${path.join(repo, "docs/verification")}.`);
  const previousFile = files.find(({ number }) => number < currentFile.number);
  if (previousFile === undefined)
    throw new Error(`Round ${currentFile.number} has no previous round ledger.`);
  if (previousFile.number !== currentFile.number - 1)
    throw new Error(`Round ${currentFile.number} has no consecutive previous round ledger.`);
  const current = readRoundLedger(currentFile.file);
  const previous = readRoundLedger(previousFile.file);
  if (current.round !== currentFile.number || previous.round !== previousFile.number)
    throw new Error("Round ledger filename and Round field disagree.");
  return { current, previous };
}

function frameworkArms(ledger: RoundLedger, round: number, repo: string): DeletionArchive[] {
  if (ledger.declaresVisualOnly) return [];
  const arms = ledger.arms.filter(
    (arm): arm is RoundArm & { arm: "framework" } => arm.arm === "framework",
  );
  if (arms.length === 0) {
    if (ledger.declaresNoArms && ledger.arms.length === 0) return [];
    throw new Error(`Round ${round} has no framework archive rows.`);
  }
  return arms.map((arm) => {
    const archive = archivePath(arm.archive, repo);
    if (!isDirectory(archive))
      throw new Error(`Round ${round} names missing archive '${archive}'.`);
    const manifestFile = path.join(archive, "sweep.json");
    if (!fs.existsSync(manifestFile))
      throw new Error(`Round archive is missing sweep.json: ${archive}`);
    const manifest = readManifest(manifestFile);
    if (manifest.arm !== "framework" || manifest.genre !== arm.genre)
      throw new Error(`Round archive '${archive}' contradicts its framework ledger row.`);
    const measurement = measureSandbox(archive);
    return {
      archive: path.relative(repo, archive) || ".",
      arm: "framework",
      genre: manifest.genre,
      round,
      unusedExports: measurement.unusedExports,
    };
  });
}

function intersection(values: readonly (readonly string[])[]): Set<string> {
  const first = values[0];
  if (first === undefined) return new Set();
  const result = new Set(first);
  for (const value of values.slice(1)) {
    const next = new Set(value);
    for (const item of result) if (!next.has(item)) result.delete(item);
  }
  return result;
}

export function findPersistentUnusedExports(repo = REPO): RoundDeletionReport {
  const { current, previous } = currentAndPreviousLedgers(repo);
  const archivesChecked = [
    ...frameworkArms(current, current.round, repo),
    ...frameworkArms(previous, previous.round, repo),
  ];
  const currentArchives = archivesChecked.filter((archive) => archive.round === current.round);
  const previousArchives = archivesChecked.filter((archive) => archive.round === previous.round);
  const currentUnused = intersection(currentArchives.map((archive) => archive.unusedExports));
  const previousUnused = intersection(previousArchives.map((archive) => archive.unusedExports));
  const persistent = [...intersection([[...currentUnused], [...previousUnused]])].sort();
  const noFrameworkArms = [current, previous]
    .filter(
      (ledger) => (ledger.declaresNoArms && ledger.arms.length === 0) || ledger.declaresVisualOnly,
    )
    .map((ledger) => ledger.round);
  const visualOnlyRounds = [current, previous]
    .filter((ledger) => ledger.declaresVisualOnly)
    .map((ledger) => ledger.round);
  const candidates = persistent.map((exportName) => ({
    archives: archivesChecked
      .filter((archive) => archive.unusedExports.includes(exportName))
      .map((archive) => archive.archive),
    exportName,
    roundsUnreached: 2,
  }));
  return {
    archivesChecked,
    candidates,
    currentRound: current.round,
    noFrameworkArms,
    previousRound: previous.round,
    visualOnlyRounds,
  };
}

export function renderDeletionTable(report: RoundDeletionReport): string {
  const lines = [
    `Persistent unused exports: rounds ${report.previousRound} and ${report.currentRound}`,
    ...report.visualOnlyRounds.map(
      (round) =>
        `Round ${round}: visual-only round contributes no deletion candidates; no framework archive rows are measured.`,
    ),
    ...report.noFrameworkArms
      .filter((round) => !report.visualOnlyRounds.includes(round))
      .map(
        (round) =>
          `Round ${round}: declared no-arms round; no framework archive rows, so no deletion candidate can be supported from it.`,
      ),
    "| Export | Rounds unreached | Archives checked |",
    "| --- | ---: | --- |",
  ];
  if (report.candidates.length === 0) {
    lines.push("| None | 0 | no export survived both rounds |");
  } else {
    for (const candidate of report.candidates)
      lines.push(
        `| ${candidate.exportName} | ${candidate.roundsUnreached} | ${candidate.archives.join(", ")} |`,
      );
  }
  return lines.join("\n");
}

function main(): void {
  const report = findPersistentUnusedExports();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n${renderDeletionTable(report)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
