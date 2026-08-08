import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_EXTENSIONS = new Set([".css", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);

export interface SweepMeasurement {
  /** Final source count in the submitted sandbox. Kept for maintenance context. */
  readonly userLoc: number;
  readonly sourceBytes: number;
  readonly sourceFiles: number;
  /** Frozen starter source count; zero for a vanilla arm. */
  readonly starterLoc: number;
  readonly starterBytes: number;
  readonly starterFiles: number;
  /**
   * Where the starter baseline came from. `archived` was copied at scaffold time;
   * `reconstructed` was recovered from git history for a sweep that predates the archiving.
   */
  readonly starterSource: "archived" | "reconstructed" | "none";
  /**
   * Lines the agent actually wrote: every final line that is not a surviving starter line,
   * counted per file against the frozen starter. A rewritten starter file costs its rewrite;
   * a deleted starter file costs nothing and can never make the total negative.
   */
  readonly authoredLoc: number;
  readonly authoredBytes: number;
  /** Starter lines still present unchanged in the submission. */
  readonly starterSurvivedLoc: number;
  readonly frameworkFiles: number;
  readonly threeOnlyFiles: number;
  readonly reachRate: number;
  readonly usedExports: readonly string[];
  readonly unusedExports: readonly string[];
}

function isDirectory(directory: string): boolean {
  return fs.existsSync(directory) && fs.statSync(directory).isDirectory();
}

function sourceFiles(directory: string): string[] {
  if (!isDirectory(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (isDirectory(file)) return sourceFiles(file);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [file] : [];
  });
}

function declarationFiles(directory: string): string[] {
  if (!isDirectory(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (isDirectory(file)) return declarationFiles(file);
    return entry.name.endsWith(".d.ts") ? [file] : [];
  });
}

function frameworkDeclarations(root: string): Map<string, Set<string>> {
  const candidates = [
    path.join(root, "node_modules", "@threenative"),
    path.join(root, "framework-types", "@threenative"),
  ];
  for (const candidate of candidates) {
    if (!isDirectory(candidate)) continue;
    const modules = new Map<string, Set<string>>();
    for (const entry of fs.readdirSync(candidate, { withFileTypes: true })) {
      const packageDirectory = path.join(candidate, entry.name);
      if (!isDirectory(packageDirectory)) continue;
      const declarationRoot = fs.existsSync(path.join(packageDirectory, "index.d.ts"))
        ? packageDirectory
        : isDirectory(path.join(packageDirectory, "dist"))
          ? path.join(packageDirectory, "dist")
          : packageDirectory;
      const files = declarationFiles(packageDirectory).filter((file) => {
        const relative = path.relative(declarationRoot, file);
        const basename = path.basename(file);
        return (
          basename === "index.d.ts" ||
          (!relative.includes(path.sep) &&
            !/^(?:game|protocol)-[A-Za-z0-9]+\.d\.ts$/.test(basename))
        );
      });
      for (const file of files) {
        const relative = path.relative(declarationRoot, file).split(path.sep);
        const basename = relative.pop() as string;
        if (basename !== "index.d.ts") relative.push(basename.replace(/\.d\.ts$/, ""));
        const moduleName = `@threenative/${entry.name}${relative.length > 0 ? `/${relative.join("/")}` : ""}`;
        const exports = modules.get(moduleName) ?? new Set<string>();
        for (const name of exportedNames(fs.readFileSync(file, "utf8"))) exports.add(name);
        modules.set(moduleName, exports);
      }
    }
    if (modules.size > 0) return modules;
  }
  throw new Error(
    `Cannot measure '${root}': missing node_modules/@threenative declarations. Archive the installed framework types with pnpm sweep:archive.`,
  );
}

function lineCount(source: string): number {
  const normalized = source.replaceAll("\r\n", "\n");
  if (normalized.length === 0) return 0;
  return normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n").length
    : normalized.split("\n").length;
}

function sourceTotals(files: readonly string[]): {
  readonly bytes: number;
  readonly files: number;
  readonly loc: number;
} {
  let bytes = 0;
  let loc = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    bytes += Buffer.byteLength(source, "utf8");
    loc += lineCount(source);
  }
  return { bytes, files: files.length, loc };
}

function lines(source: string): string[] {
  const normalized = source.replaceAll("\r\n", "\n");
  if (normalized.length === 0) return [];
  return (normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized).split("\n");
}

/**
 * Final lines that no unchanged starter line accounts for, by longest common subsequence.
 * `final - starter` would hide a rewrite: the endless-runner sweep rewrote all fourteen
 * starter files, so its net delta read 541 lines against 775 actually written.
 */
function authoredLines(starter: string, final: string): { bytes: number; loc: number } {
  const before = lines(starter);
  const after = lines(final);
  const width = before.length + 1;
  const table = new Uint32Array(width * (after.length + 1));
  for (let row = after.length - 1; row >= 0; row -= 1) {
    for (let column = before.length - 1; column >= 0; column -= 1) {
      table[row * width + column] =
        after[row] === before[column]
          ? (table[(row + 1) * width + column + 1] as number) + 1
          : Math.max(
              table[(row + 1) * width + column] as number,
              table[row * width + column + 1] as number,
            );
    }
  }
  let bytes = 0;
  let loc = 0;
  let row = 0;
  let column = 0;
  while (row < after.length) {
    if (column < before.length && after[row] === before[column]) {
      row += 1;
      column += 1;
      continue;
    }
    if (
      column < before.length &&
      (table[row * width + column + 1] as number) > (table[(row + 1) * width + column] as number)
    ) {
      column += 1;
      continue;
    }
    bytes += Buffer.byteLength(`${after[row] as string}\n`, "utf8");
    loc += 1;
    row += 1;
  }
  return { bytes, loc };
}

interface StarterBaseline {
  /** Starter source keyed by its path relative to `src/`. */
  readonly files: ReadonlyMap<string, string>;
  readonly source: "archived" | "reconstructed" | "none";
}

/** A baseline recovered from git history says so in writing; anything else is scaffold-time. */
function baselineOrigin(directory: string): "archived" | "reconstructed" {
  const file = path.join(directory, "SOURCE.json");
  if (!fs.existsSync(file)) return "archived";
  const value = JSON.parse(fs.readFileSync(file, "utf8")) as { origin?: unknown };
  if (value.origin === "reconstructed") return "reconstructed";
  if (value.origin === "scaffold") return "archived";
  throw new Error(`Invalid starter baseline origin in '${file}': ${String(value.origin)}.`);
}

/**
 * The frozen starter the agent was handed. Only the copy inside the archive counts: reading
 * the live template instead would re-score old archives every time the template changes.
 */
function starterBaseline(root: string): StarterBaseline {
  const baseline = path.join(root, "starter-baseline");
  const archived = path.join(baseline, "src");
  if (isDirectory(archived)) {
    const files = new Map<string, string>();
    for (const file of sourceFiles(archived)) {
      files.set(path.relative(archived, file).split(path.sep).join("/"), file);
    }
    return { files, source: baselineOrigin(baseline) };
  }

  const manifestFile = path.join(root, "sweep.json");
  if (!fs.existsSync(manifestFile)) return { files: new Map(), source: "none" };
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as { arm?: unknown };
  if (manifest.arm === "framework") {
    throw new Error(
      `Cannot measure '${root}': a framework archive needs its frozen starter-baseline/src/. Re-archive with pnpm sweep:archive, or copy the starter template the run was scaffolded from into ${path.join(root, "starter-baseline", "src")}.`,
    );
  }
  return { files: new Map(), source: "none" };
}

function exportedNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /\bexport\s+(?:declare\s+)?(?:const|let|var|function|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(match[1] as string);
  }
  for (const match of source.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of (match[1] as string).split(",")) {
      const item = part.replace(/\/\*.*?\*\//g, "").trim();
      if (item.length === 0) continue;
      const pieces = item.split(/\s+as\s+/);
      const name = (pieces.at(-1) ?? "").replace(/^type\s+/, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  for (const match of source.matchAll(/\bexport\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g))
    names.add(match[1] as string);
  if (/\bexport\s+default\b/.test(source)) names.add("default");
  return [...names];
}

function importedNames(clause: string): { all: boolean; names: string[] } {
  const names: string[] = [];
  const named = clause.match(/\{([^}]*)\}/)?.[1];
  if (named !== undefined) {
    for (const part of named.split(",")) {
      const item = part.replace(/^\s*type\s+/, "").trim();
      if (item.length === 0) continue;
      names.push((item.split(/\s+as\s+/)[0] ?? "").trim());
    }
  }
  const withoutNamed = clause
    .replace(/\{[^}]*\}/, "")
    .replace(/,\s*$/, "")
    .trim();
  const namespaceClause = withoutNamed.replace(/^type\s+/, "").trim();
  if (namespaceClause.startsWith("*")) return { all: true, names };
  if (withoutNamed.length > 0 && !withoutNamed.startsWith("type ")) names.push("default");
  return { all: false, names: names.filter((name) => /^[A-Za-z_$][\w$]*$/.test(name)) };
}

function usedExportNames(
  files: readonly string[],
  frameworkModules: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const used = new Set<string>();
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const patterns = [
      /\bimport\s+([^;]*?)\s+from\s*["'](@threenative\/[^"']+)["']/g,
      /\bexport\s+(?:type\s+)?([^;]*?)\s+from\s*["'](@threenative\/[^"']+)["']/g,
    ];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const parsed = importedNames(match[1] as string);
        const moduleName = match[2] as string;
        const exports = frameworkModules.get(moduleName);
        if (exports === undefined) continue;
        if (parsed.all) {
          for (const name of exports) used.add(`${moduleName}:${name}`);
          continue;
        }
        for (const name of parsed.names) {
          if (exports.has(name)) used.add(`${moduleName}:${name}`);
        }
      }
    }
  }
  return used;
}

function importsFramework(source: string): boolean {
  return /(?:from\s*|import\s*\(|require\s*\(\s*)["']@threenative\//.test(source);
}

function importsThree(source: string): boolean {
  return /(?:from\s*|import\s*\(|require\s*\(\s*)["']three["']/.test(source);
}

export function measureSandbox(rootDirectory: string): SweepMeasurement {
  const root = path.resolve(rootDirectory);
  const sourceRoot = path.join(root, "src");
  if (!isDirectory(sourceRoot)) throw new Error(`Cannot measure '${root}': missing src/.`);
  const files = sourceFiles(sourceRoot).sort();
  if (files.length === 0) throw new Error(`Cannot measure '${root}': src/ has no source files.`);
  const baseline = starterBaseline(root);
  const starter = sourceTotals([...baseline.files.values()]);
  const frameworkModules = frameworkDeclarations(root);
  const allExports = new Map<string, Set<string>>(
    [...frameworkModules].map(([moduleName, names]) => [moduleName, new Set(names)]),
  );
  if ([...allExports.values()].every((names) => names.size === 0))
    throw new Error(`Cannot measure '${root}': framework declarations export no symbols.`);

  let userLoc = 0;
  let sourceBytes = 0;
  let frameworkFiles = 0;
  let threeOnlyFiles = 0;
  let authoredLoc = 0;
  let authoredBytes = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const framework = importsFramework(source);
    const three = importsThree(source);
    userLoc += lineCount(source);
    sourceBytes += Buffer.byteLength(source, "utf8");
    const starterFile = baseline.files.get(
      path.relative(sourceRoot, file).split(path.sep).join("/"),
    );
    const authored =
      starterFile === undefined
        ? { bytes: Buffer.byteLength(source, "utf8"), loc: lineCount(source) }
        : authoredLines(fs.readFileSync(starterFile, "utf8"), source);
    authoredLoc += authored.loc;
    authoredBytes += authored.bytes;
    if (framework) frameworkFiles += 1;
    if (three && !framework) threeOnlyFiles += 1;
  }
  const used = usedExportNames(files, frameworkModules);
  const usedExports = new Set<string>();
  const unusedExports = new Set<string>();
  for (const [moduleName, names] of allExports) {
    for (const name of names) {
      if (used.has(`${moduleName}:${name}`)) usedExports.add(name);
      else unusedExports.add(name);
    }
  }
  return {
    userLoc,
    sourceBytes,
    sourceFiles: files.length,
    starterLoc: starter.loc,
    starterBytes: starter.bytes,
    starterFiles: starter.files,
    starterSource: baseline.source,
    authoredLoc,
    authoredBytes,
    starterSurvivedLoc: userLoc - authoredLoc,
    frameworkFiles,
    threeOnlyFiles,
    reachRate: frameworkFiles / files.length,
    usedExports: [...usedExports].sort(),
    unusedExports: [...unusedExports].sort(),
  };
}

function main(): void {
  const root = process.argv[2];
  if (root === undefined)
    throw new Error("Missing sandbox path. Usage: pnpm sweep:measure <path>.");
  process.stdout.write(`${JSON.stringify(measureSandbox(root), null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
