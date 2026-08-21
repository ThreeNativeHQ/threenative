import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { measureNativeCensusAreas } from "./check-budgets.js";

const CENSUS_RECORD = path.join("docs", "verification", "native-runtime-census-2026-08-16.md");
const TABLE_HEADER = "| Counted area | Lines | Owner |";

/**
 * Rewrite the census record's Lines column and total from the same walk `check-budgets.ts` runs,
 * touching nothing else. Owner, live proof or caller, alternative considered, and KEEP/DELETE
 * verdicts are always hand-authored: fail closed in both directions instead — a measured area
 * with no row means the tree grew an entry nobody has judged, and a row without a measured area
 * means the area left the tree and its verdict must be retired deliberately.
 */
export async function generateNativeCensus(root: string): Promise<{
  changedCells: number;
  total: number;
}> {
  const measurement = await measureNativeCensusAreas(root);
  const recordPath = path.join(root, CENSUS_RECORD);
  let record: string;
  try {
    record = await readFile(recordPath, "utf8");
  } catch {
    throw new Error(`native census record is missing: ${recordPath}`);
  }

  const tableStart = record.indexOf(TABLE_HEADER);
  if (tableStart < 0) {
    throw new Error(`native census record has no counted-area table ("${TABLE_HEADER}")`);
  }
  const prefix = record.slice(0, tableStart);
  const lines = record.slice(tableStart).split(/\r?\n/u);

  type IRow = { cells: string[]; lineIndex: number };
  const rows: IRow[] = [];
  let totalIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.startsWith("|")) break;
    if (line.startsWith("| **Total** |")) {
      totalIndex = index;
      break;
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^[-:]+$/u.test(cell))) continue;
    rows.push({ cells, lineIndex: index });
  }
  if (totalIndex < 0) throw new Error("native census record has no **Total** row");

  const seen = new Set<string>();
  for (const row of rows) {
    const area = row.cells[0]?.replaceAll("`", "").trim();
    if (area === undefined || area.length === 0) {
      throw new Error(
        `native census row is malformed (expected an area name): | ${row.cells.join(" | ")} |`,
      );
    }
    if (!measurement.areas.has(area)) {
      throw new Error(
        `census row ${area} counts an area the runtime tree no longer has. Record the deletion in the doc's changelog, then remove the row by hand.`,
      );
    }
    seen.add(area);
  }
  const unjudged = [...measurement.areas.keys()].filter((area) => !seen.has(area));
  if (unjudged.length > 0) {
    throw new Error(
      `the runtime tree has counted areas with no census row: ${unjudged.join(", ")}. Add a row for each with its owner, live proof or caller, alternative considered, and KEEP/DELETE verdict, then re-run pnpm census.`,
    );
  }

  let changedCells = 0;
  for (const row of rows) {
    const area = row.cells[0]?.replaceAll("`", "").trim() ?? "";
    const formatted = (measurement.areas.get(area) ?? 0).toLocaleString("en-US");
    if (row.cells[1] === formatted) continue;
    row.cells[1] = formatted;
    lines[row.lineIndex] = `| ${row.cells.join(" | ")} |`;
    changedCells += 1;
  }
  const totalCell = measurement.total.toLocaleString("en-US");
  const totalCells = (lines[totalIndex]?.split("|").slice(1, -1) ?? []).map((cell) => cell.trim());
  const recordedTotalRaw = totalCells[1];
  if (recordedTotalRaw !== undefined) {
    // Preserve the cell's own emphasis: the record writes its total in bold.
    const bold = /^\*\*.+\*\*$/u.test(recordedTotalRaw);
    const rendered = bold ? `**${totalCell}**` : totalCell;
    if (recordedTotalRaw !== rendered) {
      console.log(`census: **Total** ${recordedTotalRaw.replaceAll("*", "")} → ${totalCell}`);
      totalCells[1] = rendered;
      lines[totalIndex] = `| ${totalCells.join(" | ")} |`;
      changedCells += 1;
    }
  }

  if (changedCells > 0) await writeFile(recordPath, `${prefix}${lines.join("\n")}`);
  return { changedCells, total: measurement.total };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  generateNativeCensus(process.cwd())
    .then(({ changedCells, total }) => {
      if (changedCells === 0) {
        console.log(`census ok: already current at ${total.toLocaleString("en-US")} lines`);
      } else {
        console.log(
          `census updated: ${changedCells} cell(s), total ${total.toLocaleString("en-US")}`,
        );
      }
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
