import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generates the supersession half of `agent-docs/ctx-surface.md` from `capabilities.json`, so the
 * table an agent reads and the constructs the reinvention gate enforces are the same fact
 * (PRD-187 phase 3). The hand-maintained part of the fragment keeps documenting `ctx` property
 * signatures — a different job; this region owns every construct `pnpm budgets` will fail on.
 *
 * Runs inside `pnpm build` after the manifest is generated; `--check` turns a hand-edit of the
 * region into a red gate instead of silent drift.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_RELATIVE_PATH = path.join("packages", "create-threenative", "capabilities.json");
const TARGET_RELATIVE_PATH = path.join(
  "packages",
  "create-threenative",
  "agent-docs",
  "ctx-surface.md",
);

export const GENERATED_REGION_START = "<!-- generated: superseded-constructs -->";
const GENERATED_REGION_END = "<!-- /generated -->";

export interface IManifestEntry {
  readonly importPath: string;
  readonly kind: string;
  readonly supersedes: readonly string[];
  readonly symbol: string;
}

/** One markdown table row per (capability × construct); the gate fails per construct. */
export function buildSupersessionRows(entries: readonly IManifestEntry[]): string {
  const rows: string[] = [];
  const sorted = [...entries].sort((left, right) =>
    `${left.importPath}:${left.symbol}`.localeCompare(`${right.importPath}:${right.symbol}`),
  );
  for (const entry of sorted) {
    if (!/@threenative\/(?:core|physics)/u.test(entry.importPath)) continue;
    for (const construct of entry.supersedes) {
      rows.push(
        `| \`${construct.replaceAll("|", "\\|")}\` | \`${entry.symbol}\` | \`${entry.importPath}\` |`,
      );
    }
  }
  return [...rows].join("\n");
}

/** Replace (or append) the generated region in the fragment body. */
export function applyRegion(fragment: string, entries: readonly IManifestEntry[]): string {
  const start = fragment.indexOf(GENERATED_REGION_START);
  const section = [
    GENERATED_REGION_START,
    "",
    "**Reinvention fails CI.** `pnpm budgets` scans this project's `src/` for these raw",
    "constructs and fails, naming the capability instead. The list and the gate are generated",
    "from the capabilities' own doc tags, so they cannot disagree:",
    "",
    "| Rather than write | Use instead | Import from |",
    "|---|---|---|",
    buildSupersessionRows(entries),
    "",
    "When the raw construct is genuinely right, annotate that exact line with a non-empty",
    "reason — a bare `// engine-override:` still fails:",
    "",
    "```ts",
    "const bounds = new Box3().setFromObject(viewmodel); // engine-override: measuring, not scaling",
    "```",
    "",
    GENERATED_REGION_END,
  ].join("\n");

  if (start === -1) return `${fragment.trimEnd()}\n\n${section}\n`;
  const end = fragment.indexOf(GENERATED_REGION_END, start);
  if (end === -1) throw new Error("generated region is missing its close marker");
  return `${fragment.slice(0, start)}${section}${fragment.slice(end + GENERATED_REGION_END.length)}`;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const manifestFile = path.join(repoRoot, MANIFEST_RELATIVE_PATH);
  const targetFile = path.join(repoRoot, TARGET_RELATIVE_PATH);
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as {
    entries: IManifestEntry[];
  };
  const expected = applyRegion(await readFile(targetFile, "utf8"), manifest.entries);
  const actual = await readFile(targetFile, "utf8");
  if (check) {
    if (actual !== expected) {
      console.error(
        `RED observed: ${TARGET_RELATIVE_PATH} disagrees with capabilities.json; run pnpm build`,
      );
      process.exitCode = 1;
      return;
    }
    console.log("ctx-surface supersession table in sync with capabilities.json");
    return;
  }
  if (actual !== expected) {
    await writeFile(targetFile, expected);
    console.log(`ctx-surface supersession table regenerated at ${TARGET_RELATIVE_PATH}`);
  } else {
    console.log("ctx-surface supersession table already in sync");
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  await main();
}
