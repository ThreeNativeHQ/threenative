import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import * as ts from "typescript";

export interface ICapabilityExport {
  readonly packageName: "@threenative/core" | "@threenative/physics";
  readonly subpath: "." | "./hot" | "./navigation" | "./playtest";
  readonly name: string;
  readonly entry: string;
}

/**
 * What complete capability documentation means (PRD-187 phase 4). An export must say what it is,
 * when to reach for it, and show one working call — checked against the manifest the engine
 * compiles from those same doc tags, so the gate and `capabilities.json` cannot disagree.
 */
export type DocTagRequirement = "@example" | "@situation" | "summary";

export interface ICapabilityTagGap {
  readonly capability: ICapabilityExport;
  readonly missing: readonly DocTagRequirement[];
}

export interface ICapabilityDocReport {
  readonly exports: readonly ICapabilityExport[];
  readonly gaps: readonly ICapabilityTagGap[];
}

/**
 * Public helpers that are intentionally not game-authoring capabilities.
 *
 * Keep this list small and reasoned: adding an entry hides a symbol from every scaffold doc, so
 * an empty or multi-line reason is rejected by the gate.
 */
export const INTERNAL_ALLOWLIST: Readonly<Record<string, string>> = {
  "@threenative/core/hot#assertPortableState":
    "Hot-update implementation detail; game code calls acceptHotUpdate instead.",
};

interface IPackageSpec {
  readonly name: "@threenative/core" | "@threenative/physics";
  readonly directory: string;
}

interface IPackageManifest {
  readonly exports?: Record<string, unknown>;
}

const PACKAGE_SPECS: readonly IPackageSpec[] = [
  { name: "@threenative/core", directory: "packages/core" },
  { name: "@threenative/physics", directory: "packages/physics" },
];

const MANIFEST_RELATIVE_PATH = path.join("packages", "create-threenative", "capabilities.json");

interface IManifestEntry {
  readonly example: string;
  readonly importPath: string;
  readonly situations: readonly string[];
  readonly summary: string;
  readonly symbol: string;
}

function moduleSpecifier(capability: ICapabilityExport): string {
  return `${capability.packageName}${capability.subpath === "." ? "" : capability.subpath.slice(1)}`;
}

export function capabilityKey(capability: ICapabilityExport): string {
  return `${moduleSpecifier(capability)}#${capability.name}`;
}

export function validateInternalAllowlist(
  allowlist: Readonly<Record<string, string>> = INTERNAL_ALLOWLIST,
): void {
  const invalid = Object.entries(allowlist).filter(
    ([, reason]) => reason.trim().length === 0 || reason.includes("\n"),
  );
  if (invalid.length > 0) {
    throw new Error(
      `CAPABILITY_DOCS_INTERNAL_ALLOWLIST_INVALID: every entry needs one-line reason: ${invalid
        .map(([key]) => key)
        .join(", ")}`,
    );
  }
}

function exportTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const conditions = value as Record<string, unknown>;
  for (const condition of ["import", "default", "types"]) {
    const target = exportTarget(conditions[condition]);
    if (target !== undefined) return target;
  }
  return undefined;
}

function sourceEntry(packageRoot: string, target: string): string {
  const relativeTarget = target.replace(/^\.\//u, "");
  const sourceRelative = relativeTarget
    .replace(/^dist\//u, "src/")
    .replace(/\.d\.ts$/u, ".ts")
    .replace(/\.js$/u, ".ts");
  const entry = path.join(packageRoot, sourceRelative);
  if (!existsSync(entry)) {
    throw new Error(`CAPABILITY_DOCS_ENTRY_MISSING: ${entry}`);
  }
  return entry;
}

async function packageEntries(
  root: string,
  spec: IPackageSpec,
): Promise<readonly { subpath: ICapabilityExport["subpath"]; entry: string }[]> {
  const packageRoot = path.join(root, spec.directory);
  const manifestPath = path.join(packageRoot, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as IPackageManifest;
  if (manifest.exports === undefined) {
    throw new Error(`CAPABILITY_DOCS_EXPORTS_MISSING: ${manifestPath}`);
  }

  const entries: { subpath: ICapabilityExport["subpath"]; entry: string }[] = [];
  for (const [subpath, targetDefinition] of Object.entries(manifest.exports)) {
    if (subpath === "./package.json") continue;
    if (
      subpath !== "." &&
      subpath !== "./hot" &&
      subpath !== "./navigation" &&
      subpath !== "./playtest"
    ) {
      throw new Error(`CAPABILITY_DOCS_UNSUPPORTED_SUBPATH: ${spec.name}${subpath}`);
    }
    const target = exportTarget(targetDefinition);
    if (target === undefined) {
      throw new Error(`CAPABILITY_DOCS_TARGET_MISSING: ${spec.name}${subpath}`);
    }
    entries.push({
      subpath,
      entry: sourceEntry(packageRoot, target),
    });
  }
  if (entries.length === 0) throw new Error(`CAPABILITY_DOCS_NO_CODE_EXPORTS: ${spec.name}`);
  return entries;
}

function sourceProgram(root: string, entries: readonly string[]): ts.Program {
  return ts.createProgram({
    rootNames: entries,
    options: {
      allowJs: false,
      baseUrl: root,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      paths: {
        "@threenative/core": ["packages/core/src/index.ts"],
        "@threenative/physics": ["packages/physics/src/index.ts"],
        "@threenative/playtest": ["packages/playtest/src/index.ts"],
      },
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
    },
  });
}

/**
 * True for a callable or constructible export, however it was written.
 *
 * `export function f() {}` and `export const f = () => {}` are the same capability to a game's
 * agent and were not the same thing to this gate: only the declaration forms were counted, so the
 * day a helper is written as an arrow const it leaves the scan silently and its absence stops
 * being a release defect. A gate that quietly narrows what it covers is the failure this
 * repository names as the most dangerous one, so the form is not the test — being a function or
 * a class is.
 */
function isPublicClassOrFunction(checker: ts.TypeChecker, symbol: ts.Symbol): boolean {
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  return (resolved.declarations ?? []).some((declaration) => {
    if (ts.isClassDeclaration(declaration) || ts.isFunctionDeclaration(declaration)) return true;
    if (!ts.isVariableDeclaration(declaration)) return false;
    const initializer = declaration.initializer;
    if (initializer === undefined) return false;
    return (
      ts.isArrowFunction(initializer) ||
      ts.isFunctionExpression(initializer) ||
      ts.isClassExpression(initializer)
    );
  });
}

function exportedValueNames(checker: ts.TypeChecker, entry: ts.SourceFile): readonly string[] {
  const module = checker.getSymbolAtLocation(entry);
  if (module === undefined) throw new Error(`CAPABILITY_DOCS_MODULE_MISSING: ${entry.fileName}`);
  return checker
    .getExportsOfModule(module)
    .filter((symbol) => isPublicClassOrFunction(checker, symbol))
    .map((symbol) => symbol.getName())
    .sort();
}

/** Walk the main entry and every code subpath in the core and physics export maps. */
export async function collectPublicExports(root: string): Promise<readonly ICapabilityExport[]> {
  const discovered: ICapabilityExport[] = [];
  const entryRecords = (
    await Promise.all(
      PACKAGE_SPECS.map(async (spec) => ({ spec, entries: await packageEntries(root, spec) })),
    )
  ).flatMap(({ spec, entries }) => entries.map((entry) => ({ ...entry, packageName: spec.name })));
  const program = sourceProgram(
    root,
    entryRecords.map(({ entry }) => entry),
  );
  const checker = program.getTypeChecker();
  for (const { packageName, subpath, entry } of entryRecords) {
    for (const name of exportedValueNames(checker, program.getSourceFile(entry) as ts.SourceFile)) {
      discovered.push({ packageName, subpath, name, entry });
    }
  }
  const unique = new Map<string, ICapabilityExport>();
  for (const capability of discovered) unique.set(capabilityKey(capability), capability);
  return [...unique.values()].sort((left, right) =>
    capabilityKey(left).localeCompare(capabilityKey(right)),
  );
}

/** The doc-tag completeness verdict for one manifest entry. */
export function missingDocTags(entry: IManifestEntry | undefined): readonly DocTagRequirement[] {
  if (entry === undefined) return ["@example", "@situation", "summary"];
  const missing: DocTagRequirement[] = [];
  // The manifest generator stores `symbol` in place of an empty summary, so a summary equal to
  // the symbol means nobody wrote one.
  if (entry.summary.trim().length === 0 || entry.summary.trim() === entry.symbol)
    missing.push("summary");
  if (entry.situations.length === 0) missing.push("@situation");
  if (entry.example.trim().length === 0) missing.push("@example");
  return missing;
}

/**
 * Check every scanned export against the committed manifest's doc tags. The manifest itself is
 * freshness-gated by `check-budgets.ts`, so these tags are the tree's own words, never stale.
 */
export async function findDocTagGaps(
  root: string,
  capabilities: readonly ICapabilityExport[],
  allowlist: Readonly<Record<string, string>> = INTERNAL_ALLOWLIST,
): Promise<readonly ICapabilityTagGap[]> {
  validateInternalAllowlist(allowlist);
  const manifestFile = path.join(root, MANIFEST_RELATIVE_PATH);
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as {
    entries: IManifestEntry[];
  };
  const byKey = new Map(
    manifest.entries.map((entry) => [`${entry.importPath}#${entry.symbol}`, entry]),
  );
  const gaps: ICapabilityTagGap[] = [];
  for (const capability of capabilities) {
    if (allowlist[capabilityKey(capability)] !== undefined) continue;
    const missing = missingDocTags(byKey.get(capabilityKey(capability)));
    if (missing.length > 0) gaps.push({ capability, missing });
  }
  return gaps;
}

export async function checkCapabilityDocs(root: string): Promise<ICapabilityDocReport> {
  validateInternalAllowlist();
  const exports = await collectPublicExports(root);
  if (exports.length === 0) throw new Error("CAPABILITY_DOCS_NO_PUBLIC_EXPORTS: scan was empty");
  return { exports, gaps: await findDocTagGaps(root, exports) };
}

export function formatCapabilityReport(report: ICapabilityDocReport): string {
  if (report.gaps.length === 0) {
    return `capability docs: ${report.exports.length} public class/function exports carry complete doc tags`;
  }
  const lines = [
    `CAPABILITY_DOCS_INCOMPLETE: ${report.gaps.length} public class/function exports have incomplete doc tags`,
  ];
  for (const { capability, missing } of report.gaps) {
    lines.push(
      `- ${moduleSpecifier(capability)}: ${capability.name}; missing ${missing.join(", ")}`,
    );
  }
  return lines.join("\n");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  checkCapabilityDocs(process.cwd())
    .then((report) => {
      const output = formatCapabilityReport(report);
      if (report.gaps.length > 0) {
        console.error(output);
        process.exitCode = 1;
      } else {
        console.log(output);
      }
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
