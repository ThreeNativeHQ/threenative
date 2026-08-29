import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NATIVE_SOURCE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "runtime-native",
  "src",
);

export interface INativeSourceFile {
  path: string;
  text: string;
}

export interface INativeDefinitionOptions {
  /** Override the corpus. Used by the tests that prove this helper fails closed. */
  readFiles?: () => INativeSourceFile[];
  /** Restrict the walk; defaults to every C++ source and header under the native src tree. */
  root?: string;
}

function nativeSourceFiles(root: string): INativeSourceFile[] {
  const files: INativeSourceFile[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(?:cpp|cc|mm|h|hpp)$/u.test(entry.name)) {
        files.push({ path: full, text: readFileSync(full, "utf8") });
      }
    }
  };
  walk(root);
  return files;
}

/** A definition carries a body; a declaration ends in `;` and must not match. */
function definitionStart(text: string, symbol: string): number {
  const pattern = new RegExp(String.raw`(?:^|\n)[^\n;{}]*?\b${symbol}\s*\([^;{}]*\)[^;{}]*\{`, "u");
  const match = pattern.exec(text);
  return match === null ? -1 : match.index + (match[0].startsWith("\n") ? 1 : 0);
}

function bodyEnd(text: string, from: number): number {
  let depth = 0;
  for (let index = text.indexOf("{", from); index < text.length; index += 1) {
    const character = text[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new Error(`unbalanced braces after offset ${from}`);
}

/**
 * Locate a C++ definition by symbol rather than by file path, and return its whole body.
 *
 * PRD-229 Phase 5 exists because the assertions it replaces did neither. They hardcoded
 * `src/webgpu/bindings.cpp`, sliced with `indexOf`, and — when `indexOf` returned -1 because the
 * definition had moved — produced an empty string that satisfied every `not.toMatch` assertion
 * placed on it. A test that passes when its subject vanishes is worse than no test, and PRD-230
 * moves every one of these subjects.
 *
 * Fails closed in both directions: zero matches and more than one match are both errors.
 */
export function nativeDefinition(
  symbol: string,
  options: INativeDefinitionOptions = {},
): INativeSourceFile {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(symbol)) {
    throw new Error(`native definition lookup needs a bare C++ identifier, got "${symbol}"`);
  }
  const files = options.readFiles?.() ?? nativeSourceFiles(options.root ?? NATIVE_SOURCE_ROOT);
  const hits = files
    .map((file) => ({ file, start: definitionStart(file.text, symbol) }))
    .filter((candidate) => candidate.start >= 0);

  if (hits.length === 0) {
    throw new Error(
      `no definition found for ${symbol} across ${files.length} native source files. If it was deliberately removed, delete the assertion in the same commit; if it was renamed, this test must follow the rename.`,
    );
  }
  if (hits.length > 1) {
    throw new Error(
      `${symbol} is defined in more than one place: ${hits.map((hit) => hit.file.path).join(", ")}`,
    );
  }
  const [hit] = hits as [{ file: INativeSourceFile; start: number }];
  return {
    path: hit.file.path,
    text: hit.file.text.slice(hit.start, bodyEnd(hit.file.text, hit.start)),
  };
}
