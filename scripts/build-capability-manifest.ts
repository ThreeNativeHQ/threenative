import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

export const CAPABILITY_MANIFEST_RELATIVE_PATH = "packages/create-threenative/capabilities.json";
// `@threenative/core` ships the same manifest so the capability MCP server still answers in a
// project that was not scaffolded and therefore has no committed copy of its own.
export const CAPABILITY_MANIFEST_MIRROR_PATH = "packages/core/capabilities.json";

const CAPABILITY_PACKAGE_DIRECTORIES = ["core", "physics", "playtest", "ui"] as const;
const MANIFEST_VERSION = 1 as const;

export type CapabilityKind = "class" | "function";

export interface ICapabilityManifestEntry {
  readonly symbol: string;
  readonly package: string;
  readonly importPath: string;
  readonly kind: CapabilityKind;
  readonly signature: string;
  readonly summary: string;
  readonly situations: readonly string[];
  readonly example: string;
  readonly constraints: readonly string[];
  readonly overrides: readonly string[];
  readonly supersedes: readonly string[];
}

export interface ICapabilityManifest {
  readonly version: typeof MANIFEST_VERSION;
  readonly entries: readonly ICapabilityManifestEntry[];
}

export interface ICapabilityAllowlistEntry {
  readonly package: string;
  readonly symbol: string;
  readonly reason: string;
}

interface IParsedDocumentation {
  readonly summary: string;
  readonly situations: readonly string[];
  readonly example: string;
  readonly constraints: readonly string[];
  readonly overrides: readonly string[];
  readonly supersedes: readonly string[];
}

interface IRawExport {
  readonly symbol: string;
  readonly declaration: ts.Declaration;
  readonly documentation: IParsedDocumentation;
}

interface ICapabilityCandidate extends IRawExport {
  readonly packageName: string;
  readonly importPath: string;
  readonly kind: CapabilityKind;
}

const EMPTY_DOCUMENTATION: IParsedDocumentation = {
  constraints: [],
  example: "",
  overrides: [],
  situations: [],
  summary: "",
  supersedes: [],
};

/**
 * Exports intentionally excluded from this manifest must be named here with a reason. The list is
 * empty today: every exported class and function is a discoverable engine capability.
 */
export const CAPABILITY_ALLOWLIST: readonly ICapabilityAllowlistEntry[] = [];

export function validateCapabilityAllowlist(allowlist: readonly ICapabilityAllowlistEntry[]): void {
  const invalid = allowlist.filter(
    (entry) =>
      entry.reason.trim().length === 0 ||
      entry.package.trim().length === 0 ||
      entry.symbol.trim().length === 0,
  );
  if (invalid.length === 0) return;
  throw new Error(
    `Capability allowlist entries require non-empty package, symbol, and reason: ${invalid
      .map((entry) => `${entry.package}:${entry.symbol}`)
      .join(", ")}`,
  );
}

function packageName(packageDirectory: string): string {
  const packageFile = path.join(packageDirectory, "package.json");
  const manifest = JSON.parse(readFileSync(packageFile)) as { name?: unknown };
  if (typeof manifest.name !== "string" || manifest.name.trim().length === 0) {
    throw new Error(`Capability package manifest has no name: ${packageFile}`);
  }
  return manifest.name;
}

function readFileSync(file: string): string {
  // The package manifests are tiny and this keeps export-map discovery synchronous while the AST
  // walk remains deterministic. All generated output is still written asynchronously below.
  return ts.sys.readFile(file) ?? "";
}

function conditionTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const target = conditionTarget(item);
      if (target !== undefined) return target;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["types", "import", "default", "require"]) {
    const target = conditionTarget(record[key]);
    if (target !== undefined) return target;
  }
  for (const item of Object.values(record)) {
    const target = conditionTarget(item);
    if (target !== undefined) return target;
  }
  return undefined;
}

function exportMapEntries(value: unknown): Array<[string, string]> {
  if (typeof value === "string" || Array.isArray(value)) {
    const target = conditionTarget(value);
    return target === undefined ? [] : [[".", target]];
  }
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const subpaths = Object.keys(record).filter((key) => key.startsWith("."));
  if (subpaths.length === 0) {
    const target = conditionTarget(value);
    return target === undefined ? [] : [[".", target]];
  }
  return subpaths.flatMap((subpath) => {
    const target = conditionTarget(record[subpath]);
    return target === undefined ? [] : [[subpath, target]];
  });
}

function sourceCandidates(packageDirectory: string, target: string): string[] {
  const relative = target
    .replace(/^\.\/dist\//u, "src/")
    .replace(/^\.\/src\//u, "src/")
    .replace(/^dist\//u, "src/")
    .replace(/^src\//u, "src/");
  const withoutDeclaration = relative.endsWith(".d.ts")
    ? relative.slice(0, -5)
    : relative.replace(/\.tsx?$/u, "");
  const candidates = [
    path.join(packageDirectory, `${withoutDeclaration}.ts`),
    path.join(packageDirectory, `${withoutDeclaration}.tsx`),
    path.join(packageDirectory, withoutDeclaration, "index.ts"),
    path.join(packageDirectory, withoutDeclaration, "index.tsx"),
  ];
  return [...new Set(candidates)];
}

function sourceFileForTarget(packageDirectory: string, target: string): string {
  const source = sourceCandidates(packageDirectory, target).find((file) => existsSync(file));
  if (source === undefined) {
    throw new Error(
      `Capability export target has no source file: ${path.join(packageDirectory, "package.json")} -> ${target}`,
    );
  }
  return source;
}

function parseSource(file: string): ts.SourceFile {
  const source = ts.sys.readFile(file);
  if (source === undefined) throw new Error(`Capability source file is unreadable: ${file}`);
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function resolveRelativeModule(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const withoutExtension = specifier.replace(/\.(?:[cm]?js|jsx|tsx?)$/u, "");
  const base = path.resolve(path.dirname(from), withoutExtension);
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return candidates.find((file) => existsSync(file));
}

function documentationComment(source: ts.SourceFile, node: ts.Node): string | undefined {
  const prefix = source.text.slice(node.getFullStart(), node.getStart(source));
  const comments = [...prefix.matchAll(/\/\*\*([\s\S]*?)\*\//gu)];
  const comment = comments.at(-1)?.[1];
  return comment;
}

function parseDocumentation(comment: string | undefined): IParsedDocumentation {
  if (comment === undefined) return EMPTY_DOCUMENTATION;
  const lines = comment.split(/\r?\n/u).map((line) => line.replace(/^\s*\* ?/u, "").trimEnd());
  const situations: string[] = [];
  const constraints: string[] = [];
  const overrides: string[] = [];
  const supersedes: string[] = [];
  const exampleLines: string[] = [];
  const summaryLines: string[] = [];
  let inExample = false;
  for (const line of lines) {
    const tag = /^@(situation|constraint|example|override|supersedes)\b(?:\s+(.*))?$/u.exec(line);
    if (tag !== null) {
      inExample = tag[1] === "example";
      const value = tag[2]?.trim() ?? "";
      if (tag[1] === "situation" && value.length > 0) situations.push(value);
      if (tag[1] === "constraint" && value.length > 0) constraints.push(value);
      if (tag[1] === "override" && value.length > 0) overrides.push(value);
      if (tag[1] === "supersedes" && value.length > 0) supersedes.push(value);
      if (tag[1] === "example" && value.length > 0) exampleLines.push(value);
      continue;
    }
    if (inExample) {
      if (line.length > 0) exampleLines.push(line);
      continue;
    }
    if (line.length > 0) summaryLines.push(line);
  }
  const example = exampleLines
    .filter((line) => !/^```/u.test(line))
    .join("\n")
    .trim();
  return {
    constraints: [...new Set(constraints)],
    example,
    overrides: [...new Set(overrides)],
    situations: [...new Set(situations)],
    summary: summaryLines.join(" ").trim(),
    supersedes: [...new Set(supersedes)],
  };
}

function mergeDocumentation(
  primary: IParsedDocumentation,
  fallback: IParsedDocumentation,
): IParsedDocumentation {
  return {
    constraints: [...new Set([...primary.constraints, ...fallback.constraints])],
    example: primary.example || fallback.example,
    overrides: [...new Set([...primary.overrides, ...fallback.overrides])],
    situations: [...new Set([...primary.situations, ...fallback.situations])],
    summary: primary.summary || fallback.summary,
    supersedes: [...new Set([...primary.supersedes, ...fallback.supersedes])],
  };
}

function declarationName(node: ts.Node): string | undefined {
  if (
    ts.isClassDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  ) {
    return node.name?.text;
  }
  if (ts.isVariableStatement(node)) return undefined;
  if (ts.isVariableDeclaration(node)) {
    return ts.isIdentifier(node.name) ? node.name.text : undefined;
  }
  return undefined;
}

function localDeclaration(source: ts.SourceFile, name: string): ts.Declaration | undefined {
  for (const statement of source.statements) {
    const directName = declarationName(statement);
    if (directName === name) return statement as unknown as ts.Declaration;
    if (ts.isVariableStatement(statement)) {
      const variable = statement.declarationList.declarations.find(
        (declaration) => declarationName(declaration) === name,
      );
      if (variable !== undefined) return variable;
    }
  }
  return undefined;
}

function classifyDeclaration(node: ts.Declaration): CapabilityKind | undefined {
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isVariableDeclaration(node)) {
    const initializer = node.initializer;
    if (
      initializer !== undefined &&
      (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    ) {
      return "function";
    }
  }
  return undefined;
}

function declarationDocumentation(node: ts.Declaration): IParsedDocumentation {
  return parseDocumentation(documentationComment(node.getSourceFile(), node));
}

function exportedName(specifier: ts.ExportSpecifier): string {
  return specifier.name.text;
}

function collectModuleExports(file: string, seen: Set<string> = new Set()): IRawExport[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const source = parseSource(file);
  const result: IRawExport[] = [];
  const byName = new Map<string, IRawExport>();
  const add = (entry: IRawExport): void => {
    if (!byName.has(entry.symbol)) {
      byName.set(entry.symbol, entry);
      result.push(entry);
    }
  };
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const moduleSpecifier = statement.moduleSpecifier;
      if (moduleSpecifier === undefined || !ts.isStringLiteral(moduleSpecifier)) continue;
      const target = resolveRelativeModule(file, moduleSpecifier.text);
      if (target === undefined) continue;
      const targetExports = collectModuleExports(target, new Set(seen));
      const statementDocumentation = parseDocumentation(documentationComment(source, statement));
      if (statement.exportClause === undefined) {
        for (const entry of targetExports) {
          add({
            ...entry,
            documentation: mergeDocumentation(statementDocumentation, entry.documentation),
          });
        }
        continue;
      }
      if (!ts.isNamedExports(statement.exportClause)) continue;
      for (const specifier of statement.exportClause.elements) {
        if (specifier.isTypeOnly) continue;
        const original = (specifier.propertyName ?? specifier.name).text;
        const targetEntry = targetExports.find((entry) => entry.symbol === original);
        if (targetEntry === undefined) continue;
        const specifierDocumentation = parseDocumentation(documentationComment(source, specifier));
        add({
          ...targetEntry,
          documentation: mergeDocumentation(
            mergeDocumentation(statementDocumentation, specifierDocumentation),
            targetEntry.documentation,
          ),
          symbol: exportedName(specifier),
        });
      }
      continue;
    }

    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) !== true)
      continue;
    if (ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)) {
      const name = statement.name?.text;
      if (name === undefined) continue;
      add({
        declaration: statement,
        documentation: declarationDocumentation(statement),
        symbol: name,
      });
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      const statementDocumentation = parseDocumentation(documentationComment(source, statement));
      for (const variable of statement.declarationList.declarations) {
        const name = declarationName(variable);
        if (name === undefined) continue;
        add({
          declaration: variable,
          documentation: mergeDocumentation(
            statementDocumentation,
            declarationDocumentation(variable),
          ),
          symbol: name,
        });
      }
    }
  }
  return result;
}

function signature(node: ts.Declaration): string {
  const text = node.getText(node.getSourceFile()).replace(/\s+/gu, " ").trim();
  const brace = text.indexOf("{");
  const header = brace === -1 ? text : `${text.slice(0, brace).trim()} { … }`;
  return header.length > 500 ? `${header.slice(0, 497)}...` : header;
}

function importPath(packageNameValue: string, subpath: string): string {
  return subpath === "." ? packageNameValue : `${packageNameValue}${subpath.slice(1)}`;
}

function packageExportCandidates(root: string): ICapabilityCandidate[] {
  const candidates: ICapabilityCandidate[] = [];
  for (const directory of CAPABILITY_PACKAGE_DIRECTORIES) {
    const packageDirectory = path.join(root, "packages", directory);
    const packageFile = path.join(packageDirectory, "package.json");
    if (!existsSync(packageFile)) continue;
    const manifest = JSON.parse(readFileSync(packageFile)) as { exports?: unknown };
    if (manifest.exports === undefined) continue;
    const name = packageName(packageDirectory);
    for (const [subpath, target] of exportMapEntries(manifest.exports)) {
      if (subpath === "./package.json") continue;
      const source = sourceFileForTarget(packageDirectory, target);
      const exports = collectModuleExports(source);
      for (const entry of exports) {
        const kind = classifyDeclaration(entry.declaration);
        if (kind === undefined) continue;
        candidates.push({
          ...entry,
          importPath: importPath(name, subpath),
          kind,
          packageName: name,
        });
      }
    }
  }
  return candidates;
}

function validateDocumentation(candidates: readonly ICapabilityCandidate[]): void {
  const missing = candidates.filter((candidate) => candidate.documentation.situations.length === 0);
  const oversized = candidates.filter(
    (candidate) =>
      candidate.documentation.example.split("\n").filter((line) => line.length > 0).length > 10,
  );
  const errors: string[] = [];
  if (missing.length > 0) {
    errors.push(
      `public exports without @situation tags: ${missing
        .map(
          (candidate) => `${candidate.packageName}:${candidate.symbol} (${candidate.importPath})`,
        )
        .join(", ")}`,
    );
  }
  if (oversized.length > 0) {
    errors.push(
      `examples must be at most 10 lines: ${oversized
        .map((candidate) => `${candidate.packageName}:${candidate.symbol}`)
        .join(", ")}`,
    );
  }
  if (errors.length > 0)
    throw new Error(`Capability manifest generation failed:\n${errors.join("\n")}`);
}

export function buildCapabilityManifest(
  root: string,
  allowlist: readonly ICapabilityAllowlistEntry[] = CAPABILITY_ALLOWLIST,
): ICapabilityManifest {
  validateCapabilityAllowlist(allowlist);
  const candidates = packageExportCandidates(root);
  const allowlisted = new Set(allowlist.map((entry) => `${entry.package}:${entry.symbol}`));
  const documentedCandidates = candidates.filter(
    (candidate) => !allowlisted.has(`${candidate.packageName}:${candidate.symbol}`),
  );
  validateDocumentation(documentedCandidates);
  const entries = documentedCandidates
    .map((candidate) => ({
      constraints: candidate.documentation.constraints,
      example: candidate.documentation.example,
      importPath: candidate.importPath,
      kind: candidate.kind,
      overrides: candidate.documentation.overrides,
      package: candidate.packageName,
      signature: signature(candidate.declaration),
      situations: candidate.documentation.situations,
      summary: candidate.documentation.summary || candidate.symbol,
      supersedes: candidate.documentation.supersedes,
      symbol: candidate.symbol,
    }))
    .sort((left, right) =>
      `${left.importPath}:${left.symbol}`.localeCompare(`${right.importPath}:${right.symbol}`),
    );
  return { entries, version: MANIFEST_VERSION };
}

function manifestPath(root: string): string {
  return path.join(root, CAPABILITY_MANIFEST_RELATIVE_PATH);
}

function manifestPaths(root: string): readonly string[] {
  return [manifestPath(root), path.join(root, CAPABILITY_MANIFEST_MIRROR_PATH)];
}

const JSON_LINE_WIDTH = 100;

function jsonIndent(level: number): string {
  return " ".repeat(level * 2);
}

function serialiseJson(value: unknown, level: number, propertyPrefix = ""): string {
  if (Array.isArray(value)) {
    const compact = `[${value.map((item) => JSON.stringify(item) ?? "null").join(", ")}]`;
    if ((jsonIndent(level) + propertyPrefix + compact).length < JSON_LINE_WIDTH) return compact;
    return `[
${value.map((item) => `${jsonIndent(level + 1)}${serialiseJson(item, level + 1)}`).join(",\n")}
${jsonIndent(level)}]`;
  }
  if (typeof value !== "object" || value === null) return JSON.stringify(value) ?? "null";
  const entries = Object.entries(value);
  return `{
${entries
  .map(([key, item], index) => {
    const prefix = `${JSON.stringify(key)}: `;
    const comma = index === entries.length - 1 ? "" : ",";
    return `${jsonIndent(level + 1)}${prefix}${serialiseJson(item, level + 1, prefix)}${comma}`;
  })
  .join("\n")}
${jsonIndent(level)}}`;
}

function serialiseManifest(manifest: ICapabilityManifest): string {
  return `${serialiseJson(manifest, 0)}\n`;
}

export async function writeCapabilityManifest(root: string): Promise<ICapabilityManifest> {
  const manifest = buildCapabilityManifest(root);
  const serialised = serialiseManifest(manifest);
  for (const file of manifestPaths(root)) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, serialised);
  }
  return manifest;
}

export async function checkCapabilityManifest(root: string): Promise<ICapabilityManifest> {
  const expected = serialiseManifest(buildCapabilityManifest(root));
  let parsed: ICapabilityManifest | undefined;
  for (const file of manifestPaths(root)) {
    let actual: string;
    try {
      actual = await readFile(file, "utf8");
    } catch (error) {
      throw new Error(`Capability manifest is missing or unreadable at ${file}: ${String(error)}`);
    }
    try {
      parsed = JSON.parse(actual) as ICapabilityManifest;
    } catch (error) {
      throw new Error(`Capability manifest is unparseable at ${file}: ${String(error)}`);
    }
    if (actual !== expected) {
      throw new Error(`Capability manifest is stale at ${file}; run pnpm build to regenerate it.`);
    }
  }
  if (parsed === undefined) throw new Error("Capability manifest has no destination to check.");
  return parsed;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const check = process.argv.includes("--check");
  const manifest = check
    ? await checkCapabilityManifest(root)
    : await writeCapabilityManifest(root);
  process.stdout.write(
    `${check ? "capability manifest fresh" : "capability manifest generated"}: ${manifest.entries.length} entries at ${manifestPath(root)}\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
