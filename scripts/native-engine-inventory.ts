import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PRD-497 (N00): the module and used-symbol inventory that gates the native-engine port.
 *
 * Every module under `packages/core/src`, plus every module reachable from it through a relative
 * import, is classified in `docs/architecture/native-engine-inventory.json` with one class and the
 * batch key of the work package that owns it. The used-symbol list is the measured compatibility
 * denominator decision 6 promises: every `three*` symbol templates and examples actually import,
 * plus every property read through `ctx.renderer.raw`.
 *
 * The check fails closed: an unclassified module, a stale entry, an owner key the batch index does
 * not define, or a symbol list that no longer matches the source all exit 1 by name.
 */

export const INVENTORY_PATH = "docs/architecture/native-engine-inventory.json";
export const BATCH_INDEX_PATH = "docs/PRDs/native-engine/README.md";
export const CORE_SOURCE_ROOT = "packages/core/src";
const SYMBOL_ROOTS = ["packages/create-threenative/templates", "examples"] as const;

export const CLASSES = [
  "native-engine",
  "binding-glue",
  "build-tool",
  "game-specific",
  "unsupported",
] as const;
export const UNCLASSIFIED = "unclassified";

const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "build", "coverage", "third_party"]);

const THREE_ROOT_MODULE = /^three$/u;
const THREE_ENTRY_MODULE = /^three\/(?:webgpu|tsl)$/u;
const THREE_SUBPATH_MODULE = /^three\/(?:addons|examples)\//u;

const RELATIVE_IMPORT =
  /(?:^|[\s;}])(?:import|export)\s[^'"()]*?from\s*["'](\.[^"']*)["']|(?:^|[\s;}])import\s*["'](\.[^"']*)["']/gu;

const THREE_NAMED_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/gu;
const THREE_NAMESPACE_IMPORT = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s*from\s*["']([^"']+)["']/gu;

const RENDERER_RAW_ALIAS =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:ctx\.)?renderer\.raw\s*(?:as\s*(?:const\s*)?\{([^}]*)\})?/gu;
const RENDERER_RAW_DESTRUCTURE = /\{([^}]*)\}\s*(?::[^=]+)?=\s*(?:ctx\.)?renderer\.raw\b/gu;
const RENDERER_RAW_DIRECT = /(?:ctx\.)?renderer\.raw\.([A-Za-z_$][\w$]*)/gu;

export interface IModuleEntry {
  readonly class: string;
  readonly owner: string;
}

export interface ISymbolEntry {
  readonly imports: readonly string[];
  readonly rendererRawProperties: readonly string[];
}

export interface IInventory {
  readonly modules: Record<string, IModuleEntry>;
  readonly symbols: ISymbolEntry;
}

export interface IDiscovered {
  readonly modules: readonly string[];
  readonly keys: ReadonlySet<string>;
  readonly symbols?: ISymbolEntry;
}

/** The batch index's `| Key | PRD | Depends on |` table is the only list of owner keys. */
export function parseOwnerKeys(markdown: string): Set<string> {
  const keys = new Set<string>();
  const header = markdown.search(/^\|\s*Key\s*\|/mu);
  if (header === -1) {
    throw new Error(`Batch index has no Key column: ${BATCH_INDEX_PATH}`);
  }
  for (const line of markdown.slice(header).split("\n").slice(1)) {
    if (!line.trimStart().startsWith("|")) {
      if (keys.size > 0) break;
      continue;
    }
    const key = line.split("|")[1]?.trim();
    if (key === undefined || key.length === 0 || /^-{2,}$/u.test(key)) continue;
    keys.add(key);
  }
  return keys;
}

function isThreeModule(specifier: string): boolean {
  return (
    THREE_ROOT_MODULE.test(specifier) ||
    THREE_ENTRY_MODULE.test(specifier) ||
    THREE_SUBPATH_MODULE.test(specifier)
  );
}

function importedName(clause: string): string {
  return (
    clause
      .trim()
      .replace(/^type\s+/u, "")
      .split(/\s+as\s+/u)[0]
      ?.trim() ?? ""
  );
}

function typeLiteralNames(clause: string): readonly string[] {
  return clause
    .split(/[,;]/u)
    .map((entry) => /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:/u.exec(entry)?.[1] ?? "")
    .filter((name) => name.length > 0);
}

function namedImportSymbols(source: string): readonly string[] {
  const symbols: string[] = [];
  for (const match of source.matchAll(THREE_NAMED_IMPORT)) {
    const specifier = match[2] ?? "";
    if (!isThreeModule(specifier)) continue;
    for (const clause of (match[1] ?? "").split(",")) {
      const name = importedName(clause);
      if (name.length > 0) symbols.push(`${specifier}:${name}`);
    }
  }
  return symbols;
}

/** `import * as THREE from "three/webgpu"` names no symbol itself; its members do. */
function namespaceMemberSymbols(source: string): readonly string[] {
  const symbols: string[] = [];
  for (const match of source.matchAll(THREE_NAMESPACE_IMPORT)) {
    const alias = match[1] ?? "";
    const specifier = match[2] ?? "";
    if (alias.length === 0 || !isThreeModule(specifier)) continue;
    for (const read of source.matchAll(new RegExp(`\\b${alias}\\.([A-Za-z_$][\\w$]*)`, "gu"))) {
      const name = read[1] ?? "";
      if (name.length > 0) symbols.push(`${specifier}:${name}`);
    }
  }
  return symbols;
}

/** Named imports from a `three` entry point, plus members read off a `three` namespace alias. */
export function threeImportSymbols(source: string): readonly string[] {
  return [...new Set([...namedImportSymbols(source), ...namespaceMemberSymbols(source)])].sort();
}

/** Properties reachable through `const raw = ctx.renderer.raw as { toneMapping?: number }`. */
function aliasedRawProperties(source: string): readonly string[] {
  const properties = new Set<string>();
  for (const match of source.matchAll(RENDERER_RAW_ALIAS)) {
    for (const name of typeLiteralNames(match[2] ?? "")) properties.add(name);
    const alias = match[1] ?? "";
    if (alias.length === 0) continue;
    for (const read of source.matchAll(new RegExp(`\\b${alias}\\.([A-Za-z_$][\\w$]*)`, "gu"))) {
      properties.add(read[1] ?? "");
    }
  }
  return [...properties].filter((name) => name.length > 0);
}

/**
 * Every property read on `ctx.renderer.raw`, including through the local alias templates assign it
 * to and through a destructure.
 */
export function rendererRawProperties(source: string): readonly string[] {
  const properties = new Set<string>();
  for (const match of source.matchAll(RENDERER_RAW_DIRECT)) {
    properties.add(match[1] ?? "");
  }
  for (const match of source.matchAll(RENDERER_RAW_DESTRUCTURE)) {
    for (const name of typeLiteralNames(match[1] ?? "")) properties.add(name);
  }
  for (const name of aliasedRawProperties(source)) properties.add(name);
  return [...properties].filter((name) => name.length > 0).sort();
}

export function relativeImportSpecifiers(source: string): readonly string[] {
  const specifiers = new Set<string>();
  for (const match of source.matchAll(RELATIVE_IMPORT)) {
    const specifier = match[1] ?? match[2] ?? "";
    if (specifier.startsWith(".")) specifiers.add(specifier);
  }
  return [...specifiers];
}

/** Merge discovered modules and symbols into a committed inventory, keeping every existing class. */
export function buildInventory(
  existing: IInventory | undefined,
  discovered: IDiscovered,
): IInventory {
  const modules: Record<string, IModuleEntry> = {};
  for (const module of [...discovered.modules].sort()) {
    modules[module] = existing?.modules[module] ?? { class: UNCLASSIFIED, owner: "" };
  }
  return { modules, symbols: discovered.symbols ?? { imports: [], rendererRawProperties: [] } };
}

/** One module's verdict: a class that is one of the five, and an owner the batch index defines. */
function moduleProblems(
  module: string,
  entry: IModuleEntry | undefined,
  keys: ReadonlySet<string>,
): readonly string[] {
  if (entry === undefined || entry.class === UNCLASSIFIED) {
    return [`unclassified module: ${module}`];
  }
  if (!(CLASSES as readonly string[]).includes(entry.class)) {
    return [`unclassified module: ${module} carries unknown class '${entry.class}'`];
  }
  if (keys.has(entry.owner)) return [];
  return [
    `${module} is classed ${entry.class} and names owner '${entry.owner}', which is not a key in ${BATCH_INDEX_PATH}`,
  ];
}

/** Everything that must fail the check, each problem naming the module or symbol. */
export function inventoryProblems(
  inventory: IInventory,
  discovered: IDiscovered,
): readonly string[] {
  const problems: string[] = [];
  const modules = new Set(discovered.modules);
  for (const module of discovered.modules) {
    problems.push(...moduleProblems(module, inventory.modules[module], discovered.keys));
  }
  for (const module of Object.keys(inventory.modules).sort()) {
    if (!modules.has(module)) problems.push(`stale entry: ${module} no longer exists`);
  }
  problems.push(...symbolProblems(inventory, discovered.symbols));
  return problems;
}

function symbolProblems(
  inventory: IInventory,
  symbols: ISymbolEntry | undefined,
): readonly string[] {
  if (symbols === undefined) return [];
  const problems: string[] = [];
  for (const [label, expected, committed] of [
    ["symbol", symbols.imports, inventory.symbols?.imports ?? []],
    [
      "renderer.raw property",
      symbols.rendererRawProperties,
      inventory.symbols?.rendererRawProperties ?? [],
    ],
  ] as const) {
    const missing = expected.filter((name) => !committed.includes(name));
    const extra = committed.filter((name) => !expected.includes(name));
    if (missing.length > 0)
      problems.push(`${label} missing from ${INVENTORY_PATH}: ${missing.join(", ")}`);
    if (extra.length > 0) problems.push(`${label} no longer used: ${extra.join(", ")}`);
  }
  return problems;
}

async function filesUnder(directory: string, extensions: ReadonlySet<string>): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(file, extensions)));
    else if (extensions.has(path.extname(entry.name))) files.push(file);
  }
  return files;
}

function relative(root: string, file: string): string {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function resolveRelative(from: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(from), specifier.replace(/\.js$/u, ""));
  const candidates = [base, ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`)];
  if (!path.extname(base)) {
    for (const extension of SOURCE_EXTENSIONS)
      candidates.push(path.join(base, `index${extension}`));
  }
  return candidates.find((candidate) => existsSync(candidate) && !existsSync(`${candidate}.d.ts`));
}

export async function discoverModules(root: string): Promise<readonly string[]> {
  const source = new Set(
    await filesUnder(path.join(root, CORE_SOURCE_ROOT), new Set(SOURCE_EXTENSIONS)),
  );
  const pending = [...source];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined) continue;
    const contents = await readFile(file, "utf8");
    for (const specifier of relativeImportSpecifiers(contents)) {
      const target = resolveRelative(file, specifier);
      if (target === undefined || source.has(target)) continue;
      source.add(target);
      pending.push(target);
    }
  }
  return [...source].map((file) => relative(root, file)).sort();
}

export async function discoverSymbols(root: string): Promise<ISymbolEntry> {
  const imports = new Set<string>();
  const rawProperties = new Set<string>();
  for (const symbolRoot of SYMBOL_ROOTS) {
    for (const file of await filesUnder(path.join(root, symbolRoot), new Set(SCRIPT_EXTENSIONS))) {
      const contents = await readFile(file, "utf8");
      for (const symbol of threeImportSymbols(contents)) imports.add(symbol);
      for (const property of rendererRawProperties(contents)) rawProperties.add(property);
    }
  }
  return { imports: [...imports].sort(), rendererRawProperties: [...rawProperties].sort() };
}

export async function readInventory(root: string): Promise<IInventory | undefined> {
  const file = path.join(root, INVENTORY_PATH);
  if (!existsSync(file)) return undefined;
  return JSON.parse(await readFile(file, "utf8")) as IInventory;
}

async function main(argv: readonly string[]): Promise<void> {
  const root = process.cwd();
  const check = argv.includes("--check");
  const write = argv.includes("--write");
  if (!check && !write) {
    console.error("Usage: native-engine-inventory.ts --check [--symbols] | --write [--symbols]");
    process.exitCode = 1;
    return;
  }
  const discovered: IDiscovered = {
    modules: await discoverModules(root),
    keys: parseOwnerKeys(await readFile(path.join(root, BATCH_INDEX_PATH), "utf8")),
    symbols: argv.includes("--symbols")
      ? await discoverSymbols(root)
      : (undefined as unknown as ISymbolEntry),
  };
  const existing = await readInventory(root);
  if (write) {
    const inventory = buildInventory(existing, discovered);
    await writeFile(path.join(root, INVENTORY_PATH), `${JSON.stringify(inventory, null, 2)}\n`);
    console.log(
      `Wrote ${INVENTORY_PATH}: ${Object.keys(inventory.modules).length} modules${
        discovered.symbols === undefined ? "" : `, ${inventory.symbols.imports.length} symbols`
      }.`,
    );
    return;
  }
  if (existing === undefined) {
    console.error(`${INVENTORY_PATH} is missing; run with --write to create it.`);
    process.exitCode = 1;
    return;
  }
  const problems = inventoryProblems(existing, discovered);
  if (problems.length > 0) {
    console.error(
      `TN_NATIVE_ENGINE_INVENTORY_FAILED (${discovered.modules.length} modules):\n${problems
        .map((problem) => `- ${problem}`)
        .join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `native-engine inventory ok: ${discovered.modules.length} modules classified${
      discovered.symbols === undefined
        ? ""
        : `, ${discovered.symbols.imports.length} symbols and ${discovered.symbols.rendererRawProperties.length} renderer.raw properties recorded`
    }.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
