import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderRealismEffectsCoverageTable } from "./realism-effects-coverage.js";

export const REALISM_EFFECTS_TABLE_BEGIN = "<!-- BEGIN GENERATED: realism-effects-coverage -->";
export const REALISM_EFFECTS_TABLE_END = "<!-- END GENERATED: realism-effects-coverage -->";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const README_PATH = path.join(REPO_ROOT, "docs/PRDs/realism-effects/README.md");

export function replaceRealismEffectsCoverageTable(markdown: string, file = "README.md"): string {
  const begin = markdown.indexOf(REALISM_EFFECTS_TABLE_BEGIN);
  const end = markdown.indexOf(REALISM_EFFECTS_TABLE_END);
  if (begin < 0 || end < 0 || end < begin) {
    throw new Error(`TN_REALISM_EFFECTS_TABLE_MARKERS_MISSING: ${file}`);
  }
  const table = renderRealismEffectsCoverageTable();
  const replacement = `${REALISM_EFFECTS_TABLE_BEGIN}\n${table}\n${REALISM_EFFECTS_TABLE_END}`;
  const endOffset = end + REALISM_EFFECTS_TABLE_END.length;
  return `${markdown.slice(0, begin)}${replacement}${markdown.slice(endOffset)}`;
}

export async function updateRealismEffectsDocs(root = REPO_ROOT, check = false): Promise<void> {
  const readmePath = path.join(root, "docs/PRDs/realism-effects/README.md");
  const current = await readFile(readmePath, "utf8");
  const expected = replaceRealismEffectsCoverageTable(current, path.relative(root, readmePath));
  if (current === expected) return;
  if (check) throw new Error(`TN_REALISM_EFFECTS_TABLE_STALE: ${path.relative(root, readmePath)}`);
  await writeFile(readmePath, expected);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  await updateRealismEffectsDocs(REPO_ROOT, process.argv.includes("--check"));
}
