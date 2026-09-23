import fs from "node:fs";
import path from "node:path";
import { readManifest } from "./make-sandbox.js";
import { measureSandbox } from "./measure-sandbox.js";
import {
  type RoundArm,
  type RoundLedger,
  readRoundLedger,
  roundLedgerFiles,
} from "./round-ledger.js";

const REPO = path.resolve(import.meta.dirname, "..");
/**
 * The ledger writes a marker and the reason it is one in the same cell — round 13's framework arm
 * says `unmeasured — no build ran this round`. Matched whole, that cell is not a marker at all, so
 * the report resolved it as a path and refused with `names missing archive
 * '/…/unmeasured — no build ran this round'` — a sentence about a missing file where the finding is
 * a round that ran no build.
 */
const MARKER_SUFFIX = String.raw`(?:\b|$)`;
/** The template's declared not-yet marker: this arm has no archive to measure yet. */
const UNBUILT_ARCHIVE = new RegExp(`^pending${MARKER_SUFFIX}`, "u");
/** Values that claim an arm was measured, or should have been. Those refuse the report. */
const ARCHIVE_PLACEHOLDER = new RegExp(`^(?:unmeasured|None|n/a)${MARKER_SUFFIX}`, "u");

export interface DeletionArchive {
  readonly archive: string;
  readonly arm: "framework";
  readonly genre: string;
  readonly round: number;
  readonly unusedExports: readonly string[];
}

/** A framework arm the ledger names but whose archive has not been built yet. */
export interface UnbuiltArm {
  readonly archive: string;
  readonly genre: string;
  readonly round: number;
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
  readonly unbuiltArms: readonly UnbuiltArm[];
  readonly visualOnlyRounds: readonly number[];
}

function isDirectory(directory: string): boolean {
  return fs.existsSync(directory) && fs.statSync(directory).isDirectory();
}

function archivePath(archive: string, repo: string): string {
  if (ARCHIVE_PLACEHOLDER.test(archive))
    throw new Error(`Round deletion report cannot measure placeholder archive '${archive}'.`);
  return path.isAbsolute(archive) ? archive : path.resolve(repo, archive);
}

function currentAndPreviousLedgers(repo: string): { current: RoundLedger; previous: RoundLedger } {
  const files = roundLedgerFiles(repo);
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

/**
 * The framework arms this round can be measured from, and the ones it cannot yet.
 *
 * `round:deletions` reads the newest ledger, and the newest ledger is an *open* round as often as a
 * closed one — round 14 sat open from 2026-09-04 with `pending` where its archives go, which made
 * this command throw `cannot measure placeholder archive 'pending'` and report nothing at all.
 *
 * `pending` is the template's declared not-yet marker, so it is an observation about the round and
 * is named in the output, the way a declared no-arms round already is. `unmeasured` is not: it says
 * an arm that should have been measured was not, and that still refuses the report — a round with
 * all of its arms unbuilt can only ever remove candidates, never invent one, so naming it is safe.
 */
function frameworkArms(
  ledger: RoundLedger,
  round: number,
  repo: string,
): { archives: DeletionArchive[]; unbuilt: UnbuiltArm[] } {
  if (ledger.declaresVisualOnly) return { archives: [], unbuilt: [] };
  const arms = ledger.arms.filter(
    (arm): arm is RoundArm & { arm: "framework" } => arm.arm === "framework",
  );
  if (arms.length === 0) {
    if (ledger.declaresNoArms && ledger.arms.length === 0) return { archives: [], unbuilt: [] };
    throw new Error(`Round ${round} has no framework archive rows.`);
  }
  const unbuilt = arms
    .filter((arm) => UNBUILT_ARCHIVE.test(arm.archive))
    .map((arm) => ({ archive: arm.archive, genre: arm.genre, round }));
  const built = arms.filter((arm) => !UNBUILT_ARCHIVE.test(arm.archive));
  const archives = built.map((arm) => {
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
  return { archives, unbuilt };
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
  const currentArms = frameworkArms(current, current.round, repo);
  const previousArms = frameworkArms(previous, previous.round, repo);
  const archivesChecked = [...currentArms.archives, ...previousArms.archives];
  const unbuiltArms = [...currentArms.unbuilt, ...previousArms.unbuilt];
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
    unbuiltArms,
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
    ...report.unbuiltArms.map(
      (arm) =>
        `Round ${arm.round}: framework arm for ${arm.genre} has no archive yet ('${arm.archive}'); no deletion candidate can be supported from it.`,
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
