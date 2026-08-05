import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readManifest } from "../make-sandbox";
import { measureSandbox } from "../measure-sandbox";

const LEDGER_DIRECTORY = path.join(process.cwd(), "docs", "verification");
const REQUIRED_FIELDS = [
  "Genre",
  "Round",
  "Brief SHA-256",
  "Template",
  "Archive",
  "Framework version",
  "User source LOC",
  "Source files",
  "Framework files",
  "Three-only files",
  "Reach rate",
  "Used exports",
  "Unused exports",
  "Measurement command",
  "First game-code tool call",
  "Visual result",
] as const;

function field(markdown: string, label: string): string {
  const line = markdown.split(/\r?\n/).find((candidate) => candidate.startsWith(`${label}:`));
  if (line === undefined) throw new Error(`Missing required field ${label}.`);
  const value = line
    .slice(label.length + 1)
    .trim()
    .replaceAll("`", "");
  if (value.length === 0 || /TBD/i.test(value) || /^<.*>$/.test(value))
    throw new Error(`Required field ${label} is blank.`);
  return value;
}

function tableCells(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function validateLedger(markdown: string, filename = "sweep.md"): void {
  for (const label of REQUIRED_FIELDS) field(markdown, label);
  const round = field(markdown, "Round");
  if (!/^[1-9]\d*$/.test(round)) throw new Error(`${filename}: Round must be a positive integer.`);
  const heading = markdown.indexOf("## Friction ledger");
  if (heading < 0) throw new Error(`${filename}: missing friction ledger.`);
  const rows = markdown
    .slice(heading)
    .split(/\r?\n/)
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .map(tableCells)
    .filter((cells) => cells.length > 0 && !cells.every((cell) => /^-+$/.test(cell)));
  const dataRows = rows.filter((cells) => cells[0] !== "API or surface");
  if (dataRows.length === 0)
    throw new Error(`${filename}: friction ledger has no observation row.`);
  for (const [index, cells] of dataRows.entries()) {
    if (
      cells.length !== 4 ||
      cells.some((cell) => cell.length === 0 || /TBD/i.test(cell) || /^<.*>$/.test(cell))
    )
      throw new Error(`${filename}: friction row ${index + 1} is incomplete.`);
  }
}

function listField(value: string): string[] {
  if (value === "None") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

describe("sweep ledgers", () => {
  it("should fail a ledger with an unfilled required field", () => {
    const valid = [
      "Genre: fixture",
      "Round: 1",
      "Brief SHA-256: abc",
      "Template: none",
      "Archive: docs/benchmark/sweeps/fixture",
      "Framework version: 0.1.0",
      "User source LOC: 1",
      "Source files: 1",
      "Framework files: 0",
      "Three-only files: 1",
      "Reach rate: 0",
      "Used exports: None",
      "Unused exports: FixtureExport",
      "Measurement command: pnpm sweep:measure docs/benchmark/sweeps/fixture",
      "First game-code tool call: 1",
      "Visual result: pass; fixture",
      "## Friction ledger",
      "| API or surface | What blocked the build | Workaround | Evidence |",
      "| --- | --- | --- | --- |",
      "| None | No blocker | None | fixture |",
    ].join("\n");
    expect(() => validateLedger(valid.replace("Reach rate: 0", "Reach rate: "))).toThrow(
      /Reach rate/,
    );
  });

  it("should fail a ledger with no round marker", () => {
    const valid = [
      "Genre: fixture",
      "Round: 1",
      "Brief SHA-256: abc",
      "Template: none",
      "Archive: docs/benchmark/sweeps/fixture",
      "Framework version: 0.1.0",
      "User source LOC: 1",
      "Source files: 1",
      "Framework files: 0",
      "Three-only files: 1",
      "Reach rate: 0",
      "Used exports: None",
      "Unused exports: FixtureExport",
      "Measurement command: pnpm sweep:measure docs/benchmark/sweeps/fixture",
      "First game-code tool call: 1",
      "Visual result: pass; fixture",
      "## Friction ledger",
      "| API or surface | What blocked the build | Workaround | Evidence |",
      "| --- | --- | --- | --- |",
      "| None | No blocker | None | fixture |",
    ].join("\n");
    expect(() => validateLedger(valid.replace("Round: 1", "Round: "))).toThrow(/Round/);
  });

  it("should fail a ledger with a non-positive round", () => {
    const valid = [
      "Genre: fixture",
      "Round: 1",
      "Brief SHA-256: abc",
      "Template: none",
      "Archive: docs/benchmark/sweeps/fixture",
      "Framework version: 0.1.0",
      "User source LOC: 1",
      "Source files: 1",
      "Framework files: 0",
      "Three-only files: 1",
      "Reach rate: 0",
      "Used exports: None",
      "Unused exports: FixtureExport",
      "Measurement command: pnpm sweep:measure docs/benchmark/sweeps/fixture",
      "First game-code tool call: 1",
      "Visual result: pass; fixture",
      "## Friction ledger",
      "| API or surface | What blocked the build | Workaround | Evidence |",
      "| --- | --- | --- | --- |",
      "| None | No blocker | None | fixture |",
    ].join("\n");
    expect(() => validateLedger(valid.replace("Round: 1", "Round: 0"))).toThrow(/positive integer/);
  });

  it("should validate both recorded sweeps and match their archived measurements", async () => {
    const files = (await readdir(LEDGER_DIRECTORY))
      .filter((file) => file.startsWith("sweep-") && file.endsWith(".md"))
      .sort();
    expect(files).toEqual(
      expect.arrayContaining([
        "sweep-platformer-2026-08-05.md",
        "sweep-topdown-action-2026-08-05.md",
      ]),
    );
    expect(files.length).toBeGreaterThanOrEqual(2);

    for (const file of files) {
      const markdown = await readFile(path.join(LEDGER_DIRECTORY, file), "utf8");
      validateLedger(markdown, file);
      const archive = path.resolve(process.cwd(), field(markdown, "Archive"));
      const measurement = measureSandbox(archive);
      const manifest = readManifest(path.join(archive, "sweep.json"));
      expect(field(markdown, "Genre")).toBe(manifest.genre);
      expect(field(markdown, "Brief SHA-256")).toBe(manifest.briefHash);
      expect(Number(field(markdown, "User source LOC"))).toBe(measurement.userLoc);
      expect(Number(field(markdown, "Source files"))).toBe(measurement.sourceFiles);
      expect(Number(field(markdown, "Framework files"))).toBe(measurement.frameworkFiles);
      expect(Number(field(markdown, "Three-only files"))).toBe(measurement.threeOnlyFiles);
      expect(Number(field(markdown, "Reach rate"))).toBe(measurement.reachRate);
      expect(listField(field(markdown, "Used exports"))).toEqual(measurement.usedExports);
      expect(listField(field(markdown, "Unused exports"))).toEqual(measurement.unusedExports);
    }
  });
});
