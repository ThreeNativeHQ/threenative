import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import * as ts from "typescript";

const MANIFEST_PATH = path.join("packages", "runtime-native", "shim-manifest.json");
const FRAMEWORK_PACKAGES = ["core", "physics", "ui", "playtest"] as const;

interface IManifestEntry {
  readonly name: string;
  readonly evidence?: string;
  readonly reason?: string;
}

interface INativeShimManifest {
  readonly version: 1;
  readonly shims: readonly IManifestEntry[];
  readonly allowlist: readonly IManifestEntry[];
}

export interface INativeGlobalRead {
  readonly file: string;
  readonly line: number;
  readonly name: string;
}

function relative(root: string, file: string): string {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

async function filesUnder(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(file)));
    else if (/\.tsx?$/u.test(entry.name)) files.push(file);
  }
  return files;
}

function parseManifest(value: unknown, file: string): INativeShimManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`TN_NATIVE_SHIM_MANIFEST_INVALID: ${file} must be an object`);
  const candidate = value as Partial<INativeShimManifest>;
  if (
    candidate.version !== 1 ||
    !Array.isArray(candidate.shims) ||
    !Array.isArray(candidate.allowlist)
  ) {
    throw new Error(
      `TN_NATIVE_SHIM_MANIFEST_INVALID: ${file} needs version 1, shims, and allowlist arrays`,
    );
  }
  const names = new Set<string>();
  const validate = (entries: readonly IManifestEntry[], kind: string): void => {
    for (const entry of entries) {
      if (
        typeof entry !== "object" ||
        entry === null ||
        typeof entry.name !== "string" ||
        entry.name.length === 0
      ) {
        throw new Error(`TN_NATIVE_SHIM_MANIFEST_INVALID: ${file} has a malformed ${kind} entry`);
      }
      if (names.has(entry.name)) {
        throw new Error(
          `TN_NATIVE_SHIM_MANIFEST_INVALID: ${file} lists ${entry.name} more than once`,
        );
      }
      names.add(entry.name);
      const explanation = kind === "shim" ? entry.evidence : entry.reason;
      if (typeof explanation !== "string" || explanation.trim().length === 0) {
        throw new Error(
          `TN_NATIVE_SHIM_MANIFEST_INVALID: ${file} ${kind} ${entry.name} needs a non-empty ${kind === "shim" ? "evidence" : "reason"}`,
        );
      }
    }
  };
  validate(candidate.shims, "shim");
  validate(candidate.allowlist, "allowlist");
  return {
    allowlist: candidate.allowlist,
    shims: candidate.shims,
    version: 1,
  };
}

export function loadNativeShimManifest(root = process.cwd()): INativeShimManifest {
  const file = path.join(root, MANIFEST_PATH);
  if (!existsSync(file))
    throw new Error(`TN_NATIVE_SHIM_MANIFEST_MISSING: ${relative(root, file)}`);
  try {
    return parseManifest(JSON.parse(readFileSync(file, "utf8")), relative(root, file));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("TN_NATIVE_SHIM_MANIFEST_INVALID"))
      throw error;
    throw new Error(`TN_NATIVE_SHIM_MANIFEST_INVALID: ${relative(root, file)} is not valid JSON`);
  }
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isClassDeclaration(parent) && parent.name === node) ||
    (ts.isInterfaceDeclaration(parent) && parent.name === node) ||
    (ts.isTypeAliasDeclaration(parent) && parent.name === node) ||
    (ts.isEnumDeclaration(parent) && parent.name === node) ||
    (ts.isTypeParameterDeclaration(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.name === node) ||
    (ts.isImportClause(parent) && parent.name === node) ||
    (ts.isImportEqualsDeclaration(parent) && parent.name === node) ||
    (ts.isImportSpecifier(parent) && (parent.name === node || parent.propertyName === node)) ||
    (ts.isNamespaceImport(parent) && parent.name === node) ||
    (ts.isExportSpecifier(parent) && (parent.name === node || parent.propertyName === node))
  )
    return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (ts.isQualifiedName(parent) && parent.right === node) return true;
  if (
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node)
  )
    return true;
  return false;
}

function isLocalSymbol(
  checker: ts.TypeChecker,
  node: ts.Identifier,
  frameworkRoots: readonly string[],
): boolean {
  const symbol = checker.getSymbolAtLocation(node);
  if (symbol === undefined) return false;
  return (symbol.declarations ?? []).some((declaration) => {
    const file = declaration.getSourceFile().fileName;
    return frameworkRoots.some((sourceRoot) => file.startsWith(`${sourceRoot}${path.sep}`));
  });
}

function isDomLibraryFile(file: ts.SourceFile): boolean {
  return /(?:^|[/\\])lib\.dom(?:\.iterable)?\.d\.ts$/u.test(file.fileName);
}

function bindingNames(name: ts.BindingName): readonly string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? bindingNames(element.name) : [],
  );
}

function domGlobalValueNames(program: ts.Program): ReadonlySet<string> {
  const names = new Set<string>();
  for (const sourceFile of program.getSourceFiles()) {
    if (!isDomLibraryFile(sourceFile)) continue;
    for (const statement of sourceFile.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          for (const name of bindingNames(declaration.name)) names.add(name);
        }
      } else if (
        (ts.isClassDeclaration(statement) ||
          ts.isEnumDeclaration(statement) ||
          ts.isFunctionDeclaration(statement)) &&
        statement.name !== undefined
      ) {
        names.add(statement.name.text);
      } else if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
        names.add(statement.name.text);
      }
    }
  }
  return names;
}

function isTypeOnlyReference(node: ts.Identifier): boolean {
  let parent: ts.Node | undefined = node.parent;
  while (parent !== undefined) {
    if (ts.isTypeNode(parent)) return true;
    if (ts.isStatement(parent) || ts.isExpression(parent)) return false;
    parent = parent.parent;
  }
  return false;
}

export async function collectNativeGlobalReads(
  root = process.cwd(),
): Promise<readonly INativeGlobalRead[]> {
  const files = (
    await Promise.all(
      FRAMEWORK_PACKAGES.map((packageName) =>
        filesUnder(path.join(root, "packages", packageName, "src")),
      ),
    )
  ).flat();
  const frameworkRoots = FRAMEWORK_PACKAGES.map((packageName) =>
    path.join(root, "packages", packageName, "src"),
  );
  const program = ts.createProgram({
    rootNames: files,
    options: {
      allowJs: false,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const checker = program.getTypeChecker();
  const browserGlobals = domGlobalValueNames(program);
  const reads: INativeGlobalRead[] = [];
  for (const file of files) {
    const sourceFile = program.getSourceFile(file);
    if (sourceFile === undefined) continue;
    const parsedSourceFile = sourceFile;
    function visit(node: ts.Node): void {
      if (
        ts.isIdentifier(node) &&
        browserGlobals.has(node.text) &&
        !isTypeOnlyReference(node) &&
        !isDeclarationName(node) &&
        !isLocalSymbol(checker, node, frameworkRoots)
      ) {
        reads.push({
          file: relative(root, file),
          line:
            parsedSourceFile.getLineAndCharacterOfPosition(node.getStart(parsedSourceFile)).line +
            1,
          name: node.text,
        });
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return reads.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.name.localeCompare(right.name),
  );
}

function evidencePaths(evidence: string): readonly string[] {
  return evidence
    .split(/\s+and\s+/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function withoutComments(source: string): string {
  let result = "";
  let blockComment = false;
  let lineComment = false;
  let quote: "`" | "'" | '"' | undefined;
  let rawDelimiter: string | undefined;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (rawDelimiter !== undefined) {
      const closing = `)${rawDelimiter}"`;
      const closingIndex = source.indexOf(closing, index);
      if (closingIndex === -1) {
        result += withoutComments(source.slice(index));
        break;
      }
      result += withoutComments(source.slice(index, closingIndex));
      result += closing;
      index = closingIndex + closing.length - 1;
      rawDelimiter = undefined;
      continue;
    }
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        result += character;
      } else result += " ";
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        result += "  ";
        index += 1;
      } else result += character === "\n" ? character : " ";
      continue;
    }
    if (quote !== undefined) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    const rawStart = source.slice(index).match(/^(?:u8|u|U|L)?R"([^\s()\\]*)\(/u);
    if (rawStart !== null) {
      result += rawStart[0];
      rawDelimiter = rawStart[1] ?? "";
      index += rawStart[0].length - 1;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      result += "  ";
      index += 1;
    } else if (character === "/" && next === "*") {
      blockComment = true;
      result += "  ";
      index += 1;
    } else {
      if (character === "'" || character === '"' || character === "`") quote = character;
      result += character;
    }
  }
  return result;
}

const REGEX_PREFIX_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

const REGEX_CONTROL_HEADER_KEYWORDS = new Set(["catch", "for", "if", "switch", "while", "with"]);
const REGEX_BLOCK_PREFIX_KEYWORDS = new Set(["do", "else", "finally", "try"]);
type RegexLiteralRange = readonly [start: number, end: number];

function withoutRegexRanges(source: string, regexLiterals: readonly RegexLiteralRange[]): string {
  let rangeIndex = 0;
  let result = "";
  for (let index = 0; index < source.length; index += 1) {
    while (
      rangeIndex < regexLiterals.length &&
      (regexLiterals[rangeIndex]?.[1] ?? Number.POSITIVE_INFINITY) <= index
    ) {
      rangeIndex += 1;
    }
    const range = regexLiterals[rangeIndex];
    const character = source[index] ?? "";
    if (range !== undefined && index >= range[0] && index < range[1]) {
      result += character === "\n" || character === "\r" ? character : " ";
    } else {
      result += character;
    }
  }
  return result;
}

function regexLiteralFollowsClassDeclaration(
  source: string,
  opening: number,
  regexLiterals: readonly RegexLiteralRange[],
): boolean {
  return /(?:^|[;{}])\s*(?:export\s+(?:default\s+)?)?class\b[^{};]*$/u.test(
    withoutQuotedLiterals(withoutRegexRanges(source, regexLiterals).slice(0, opening)),
  );
}

function matchingDelimiterStart(
  source: string,
  closeIndex: number,
  opening: string,
  closing: string,
  regexLiterals: readonly RegexLiteralRange[] = [],
): number | undefined {
  const openings: number[] = [];
  let quote: "`" | "'" | '"' | undefined;
  let rawDelimiter: string | undefined;
  let escaped = false;
  const regexEnds = new Map(regexLiterals);
  for (let index = 0; index <= closeIndex; index += 1) {
    const regexEnd = regexEnds.get(index);
    if (regexEnd !== undefined) {
      index = regexEnd - 1;
      continue;
    }
    const character = source[index] ?? "";
    if (rawDelimiter !== undefined) {
      const rawClosing = `)${rawDelimiter}"`;
      if (source.startsWith(rawClosing, index)) {
        index += rawClosing.length - 1;
        rawDelimiter = undefined;
      } else if (quote !== undefined) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = undefined;
      } else if (character === "'" || character === '"' || character === "`") {
        quote = character;
      } else if (character === opening) {
        openings.push(index);
      } else if (character === closing) {
        const start = openings.pop();
        if (index === closeIndex) return start;
      }
      continue;
    }
    const rawStart = source.slice(index).match(/^(?:u8|u|U|L)?R"([^\s()\\]*)\(/u);
    if (rawStart !== null) {
      index += rawStart[0].length - 1;
      rawDelimiter = rawStart[1] ?? "";
      quote = undefined;
      continue;
    }
    if (quote !== undefined) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
    } else if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === opening) {
      openings.push(index);
    } else if (character === closing) {
      const start = openings.pop();
      if (index === closeIndex) return start;
    }
  }
  return undefined;
}

function precedingIdentifier(source: string, index: number): string | undefined {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/u.test(source[cursor] ?? "")) cursor -= 1;
  const end = cursor + 1;
  while (cursor >= 0 && /[A-Za-z0-9_$]/u.test(source[cursor] ?? "")) cursor -= 1;
  return end === cursor + 1 ? undefined : source.slice(cursor + 1, end);
}

function regexLiteralFollowsControlHeader(
  source: string,
  closeIndex: number,
  regexLiterals: readonly RegexLiteralRange[],
): boolean {
  const opening = matchingDelimiterStart(source, closeIndex, "(", ")", regexLiterals);
  return (
    opening !== undefined &&
    REGEX_CONTROL_HEADER_KEYWORDS.has(precedingIdentifier(source, opening) ?? "")
  );
}

function regexLiteralFollowsBlock(
  source: string,
  closeIndex: number,
  regexLiterals: readonly RegexLiteralRange[],
): boolean {
  const opening = matchingDelimiterStart(source, closeIndex, "{", "}", regexLiterals);
  if (opening === undefined) return true;
  if (regexLiteralFollowsClassDeclaration(source, opening, regexLiterals)) return true;
  let cursor = opening - 1;
  while (cursor >= 0 && /\s/u.test(source[cursor] ?? "")) cursor -= 1;
  if (cursor < 0 || ";{}".includes(source[cursor] ?? "")) return true;
  if (source.slice(Math.max(0, cursor - 1), cursor + 1) === "=>") return true;
  if (source[cursor] === ")") return true;
  return REGEX_BLOCK_PREFIX_KEYWORDS.has(precedingIdentifier(source, opening) ?? "");
}

function regexLiteralCanStart(
  source: string,
  index: number,
  regexLiterals: readonly RegexLiteralRange[],
): boolean {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/u.test(source[cursor] ?? "")) cursor -= 1;
  if (cursor < 0) return true;
  const previous = source[cursor] ?? "";
  if (previous === ")") return regexLiteralFollowsControlHeader(source, cursor, regexLiterals);
  if (previous === "}") return regexLiteralFollowsBlock(source, cursor, regexLiterals);
  if ("([{,;:=!?&|+-*%^~<>".includes(previous)) return true;
  const tokenEnd = cursor + 1;
  while (cursor >= 0 && /[A-Za-z0-9_$]/u.test(source[cursor] ?? "")) cursor -= 1;
  return REGEX_PREFIX_KEYWORDS.has(source.slice(cursor + 1, tokenEnd));
}

function regexLiteralEnd(source: string, start: number): number | undefined {
  let characterClass = false;
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (character === "\n" || character === "\r") return undefined;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") {
      characterClass = true;
      continue;
    }
    if (character === "]") {
      characterClass = false;
      continue;
    }
    if (character === "/" && !characterClass) {
      let end = index + 1;
      while (/[A-Za-z]/u.test(source[end] ?? "")) end += 1;
      return end;
    }
  }
  return undefined;
}

/** Mask JavaScript regex literals without changing source offsets for evidence matching. */
function withoutRegexLiterals(source: string): string {
  let result = "";
  const regexLiterals: RegexLiteralRange[] = [];
  let quote: "`" | "'" | '"' | undefined;
  let rawDelimiter: string | undefined;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (rawDelimiter !== undefined) {
      const closing = `)${rawDelimiter}"`;
      if (source.startsWith(closing, index)) {
        result += closing;
        index += closing.length - 1;
        rawDelimiter = undefined;
      } else if (quote !== undefined) {
        result += character;
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = undefined;
      } else if (character === "'" || character === '"' || character === "`") {
        quote = character;
        result += character;
      } else if (character === "/" && regexLiteralCanStart(source, index, regexLiterals)) {
        const end = regexLiteralEnd(source, index);
        if (end === undefined) {
          result += character;
        } else {
          for (let masked = index; masked < end; masked += 1) {
            const maskedCharacter = source[masked] ?? "";
            result += maskedCharacter === "\n" ? "\n" : " ";
          }
          regexLiterals.push([index, end]);
          index = end - 1;
        }
      } else {
        result += character;
      }
      continue;
    }
    const rawStart = source.slice(index).match(/^(?:u8|u|U|L)?R"([^\s()\\]*)\(/u);
    if (rawStart !== null) {
      result += rawStart[0];
      rawDelimiter = rawStart[1] ?? "";
      index += rawStart[0].length - 1;
      continue;
    }
    if (quote !== undefined) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
    } else if (character === "'" || character === '"' || character === "`") {
      quote = character;
      result += character;
    } else if (character === "/" && regexLiteralCanStart(source, index, regexLiterals)) {
      const end = regexLiteralEnd(source, index);
      if (end === undefined) {
        result += character;
      } else {
        for (let masked = index; masked < end; masked += 1) {
          const maskedCharacter = source[masked] ?? "";
          result += maskedCharacter === "\n" ? "\n" : " ";
        }
        regexLiterals.push([index, end]);
        index = end - 1;
      }
    } else {
      result += character;
    }
  }
  return result;
}

function withoutQuotedLiterals(source: string): string {
  let result = "";
  let quote: "`" | "'" | '"' | undefined;
  let rawDelimiter: string | undefined;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (rawDelimiter !== undefined) {
      const closing = `)${rawDelimiter}"`;
      if (source.startsWith(closing, index)) {
        result += closing;
        index += closing.length - 1;
        rawDelimiter = undefined;
      } else if (quote !== undefined) {
        result += character === "\n" ? character : " ";
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = undefined;
      } else if (character === "'" || character === '"' || character === "`") {
        quote = character;
        result += character;
      } else {
        result += character;
      }
      continue;
    }
    if (quote !== undefined) {
      result += character === "\n" ? character : " ";
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    const rawStart = source.slice(index).match(/^(?:u8|u|U|L)?R"([^\s()\\]*)\(/u);
    if (rawStart !== null) {
      result += rawStart[0];
      rawDelimiter = rawStart[1] ?? "";
      index += rawStart[0].length - 1;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      result += character;
    } else {
      result += character;
    }
  }
  return result;
}

function hasQuotedNameAfterCall(
  source: string,
  code: string,
  callPattern: RegExp,
  name: string,
  firstArgument: boolean,
): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const namePattern = firstArgument
    ? new RegExp(`^\\s*["']${escaped}["']\\s*,`, "u")
    : new RegExp(`["']${escaped}["']`, "u");
  for (const match of code.matchAll(callPattern)) {
    const start = (match.index ?? 0) + match[0].length;
    const statementEnd = source.indexOf(";", start);
    const statement = source.slice(start, statementEnd === -1 ? source.length : statementEnd);
    if (namePattern.test(statement)) return true;
  }
  return false;
}

function shimInstalled(runtime: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const source = withoutRegexLiterals(withoutComments(runtime));
  const code = withoutQuotedLiterals(source);
  if (
    new RegExp(
      `(?:globalThis|global)\\s*\\.\\s*${escaped}\\s*(?:\\?\\?=|\\|\\|=|=(?![=>]))`,
      "u",
    ).test(code)
  )
    return true;
  return (
    hasQuotedNameAfterCall(source, code, /\bsetGlobalProperty\s*\(/gu, name, true) ||
    hasQuotedNameAfterCall(
      source,
      code,
      /(?:\bObject\s*\.\s*)?\bdefineProperty\s*\(\s*globalThis\s*,/gu,
      name,
      true,
    ) ||
    hasQuotedNameAfterCall(
      source,
      code,
      /\bGlobal\s*\(\s*\)[^\n;]*(?:Set|set|Define|define|Property|property)/gu,
      name,
      false,
    ) ||
    hasQuotedNameAfterCall(source, code, /SetPropertyStr\s*\(/gu, name, false)
  );
}

export async function checkNativeShims(root = process.cwd()): Promise<readonly string[]> {
  const manifest = loadNativeShimManifest(root);
  const shims = new Map(manifest.shims.map((entry) => [entry.name, entry]));
  const allowlist = new Map(manifest.allowlist.map((entry) => [entry.name, entry]));
  const findings: string[] = [];
  for (const entry of manifest.shims) {
    for (const evidence of evidencePaths(entry.evidence ?? "")) {
      const file = path.join(root, evidence);
      if (!existsSync(file) || !shimInstalled(readFileSync(file, "utf8"), entry.name)) {
        findings.push(
          `TN_NATIVE_SHIM_EVIDENCE_MISSING: manifest shim ${entry.name} has no matching runtime installation in ${evidence}; evidence ${entry.evidence}`,
        );
      }
    }
  }
  for (const read of await collectNativeGlobalReads(root)) {
    if (shims.has(read.name) || allowlist.has(read.name)) continue;
    findings.push(
      `TN_NATIVE_SHIM_MISSING: ${read.file}:${read.line} reads ${read.name}; ${read.name} is not registered as a native shim or an allowlist reason; add a host shim or record an allowlist reason`,
    );
  }
  return findings.sort();
}

async function main(): Promise<void> {
  const findings = await checkNativeShims();
  if (findings.length > 0) {
    console.error(findings.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("native shim contract passed");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
