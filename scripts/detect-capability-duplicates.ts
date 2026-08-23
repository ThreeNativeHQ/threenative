import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The duplication linter (report §4.4): flag game files whose exports duplicate a core
 * capability's role, so §1-style migrations are discoverable by tooling rather than by
 * archaeology in a retro. A previous game hand-wrote 446 lines of navigation and bone
 * attachment while `NavigationAgent3D` and `attachToBone` sat installed and importable;
 * this script exists so the next instance of that failure announces itself.
 *
 * Advisory by design: name-token overlap is a hint, not proof — a hit means "go read
 * both", never "delete this". Exit code stays 0 unless --strict is passed, which gates
 * CI only where a project opts in.
 *
 * Usage:
 *   pnpm tsx scripts/detect-capability-duplicates.ts <game-project-dir> [--strict]
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STOPWORDS = new Set([
  // Generic construction words that carry no role signal on either side.
  "the",
  "and",
  "for",
  "with",
  "from",
  // Lifecycle words every game writes legitimately.
  "update",
  "create",
  "make",
  "load",
  // Verbs and geometry words so common on both sides that they carry no role signal;
  // revisited after the first fps-framework run flagged eight non-duplicates.
  "build",
  "resolve",
  "tag",
  "capture",
  "default",
  "face",
  "normal",
]);

interface ICapabilityEntry {
  readonly symbol: string;
  readonly kind: string;
  readonly importPath: string;
}

interface IFinding {
  readonly file: string;
  readonly line: number;
  readonly symbol: string;
  readonly kind: string;
  readonly capability: string;
  readonly importPath: string;
}

function tokens(name: string): readonly string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .map((token) => token.replace(/[0-9]+$/u, "").toLowerCase())
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

/** Two names collide when a distinctive token matches exactly, or nearly (stem within 1 char). */
function roleOverlap(left: readonly string[], right: readonly string[]): boolean {
  for (const a of left) {
    for (const b of right) {
      if (a === b) return true;
      if (
        a.length >= 5 &&
        b.length >= 5 &&
        (a.startsWith(b.slice(0, -1)) || b.startsWith(a.slice(0, -1)))
      ) {
        return true;
      }
    }
  }
  return false;
}

async function walkTsFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...(await walkTsFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const EXPORT_PATTERN =
  /export\s+(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(class|function|const)\s+([A-Za-z][A-Za-z0-9_]*)/gu;

async function main(): Promise<void> {
  const [projectArg, strictArg] = process.argv.slice(2);
  if (projectArg === undefined) {
    console.error(
      "usage: tsx scripts/detect-capability-duplicates.ts <game-project-dir> [--strict]",
    );
    process.exitCode = 2;
    return;
  }
  const projectRoot = path.resolve(projectArg);
  const manifest: { entries: ICapabilityEntry[] } = JSON.parse(
    await readFile(path.join(repoRoot, "packages/create-threenative/capabilities.json"), "utf8"),
  );
  const capabilities = manifest.entries
    // Only game-authoring surfaces count: a game rewriting a core/physics capability is
    // the failure this linter exists for; harness-internal exports (@threenative/playtest
    // runner machinery) are not something a game would ever import, so matching against
    // them manufactures noise.
    .filter((entry) => /@threenative\/(core|physics)/u.test(entry.importPath))
    .map((entry) => ({
      importPath: entry.importPath,
      kind: entry.kind,
      name: entry.symbol,
      tokens: tokens(entry.symbol),
    }));

  const findings: IFinding[] = [];
  const files = await walkTsFiles(projectRoot);
  for (const file of files) {
    if (/\.spec\.ts$/u.test(file) || /\.test\.ts$/u.test(file)) continue;
    const content = await readFile(file, "utf8");
    if (content.includes("@threenative")) continue; // already importing the engine — not a rewrite
    for (const match of content.matchAll(EXPORT_PATTERN)) {
      const [, kind, symbol] = match;
      if (kind === undefined || symbol === undefined) continue;
      const line = content.slice(0, match.index).split("\n").length;
      const symbolTokens = tokens(symbol);
      if (symbolTokens.length === 0) continue;
      const hit = capabilities.find((capability) => roleOverlap(symbolTokens, capability.tokens));
      if (hit !== undefined) {
        findings.push({
          capability: hit.name,
          file: path.relative(projectRoot, file),
          importPath: hit.importPath,
          kind,
          line,
          symbol,
        });
      }
    }
  }

  if (findings.length === 0) {
    console.log(`no capability-role duplicates found across ${files.length} files`);
    return;
  }
  for (const finding of findings) {
    console.log(
      `${finding.file}:${finding.line}: ${finding.kind} ${finding.symbol} — possible duplicate of ${finding.capability} (${finding.importPath}); go read both before keeping this copy`,
    );
  }
  console.log(
    `${findings.length} finding(s); advisory${strictArg === "--strict" ? "" : " only"} — hits mean 'compare', not 'delete'`,
  );
  if (strictArg === "--strict") process.exitCode = 1;
}

await main();
