import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

// Core's base export must stand alone: every module reachable from src/index.ts resolves
// without @threenative/playtest, whose inlined copy tsup used to ship inside dist. The one
// exception is src/playtest.ts itself - the ./playtest subpath is the deliberate bridge to
// the harness, declared as an optional peer dependency rather than bundled.
const PLAYTEST_BRIDGE_ENTRY = "playtest.ts";

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") continue;
      files.push(...(await collectSourceFiles(path)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

test("should import the protocol from core, not playtest", async () => {
  const sources = await collectSourceFiles(srcRoot);
  // Fail closed: a renamed or emptied tree must fail here, not scan to zero silently.
  expect(sources.length).toBeGreaterThan(5);
  expect(sources).toContain(join(srcRoot, "index.ts"));
  expect(sources).toContain(join(srcRoot, "replay.ts"));
  expect(sources).toContain(join(srcRoot, "replay-protocol.ts"));

  const offenders: string[] = [];
  for (const source of sources) {
    const text = await readFile(source, "utf8");
    if (!text.includes("@threenative/playtest")) continue;
    if (source.endsWith(PLAYTEST_BRIDGE_ENTRY)) continue;
    offenders.push(source);
  }
  expect(offenders).toEqual([]);
});

// The ./playtest bridge subpath loads inside the GAME'S browser page. Its import graph must
// therefore stay free of bare node: builtins - and free of value imports from the harness
// ROOT entry, which transitively drags scenario loading (node:fs/promises) into that graph.
// Regression context: PRD-181 briefly repointed core at the root entry and every example
// using the bridge died at page evaluation with vite's "externalized for browser
// compatibility" error.
test("should keep the playtest bridge tier browser-safe", async () => {
  // Transitive local-import walk from both entries: every reached module must be free of
  // bare node: specifiers AND free of value imports from the harness ROOT entry (whose
  // graph drags scenario loading - node:fs/promises - into the page). Type-only imports of
  // the root are elided at runtime and allowed; multi-line imports must be caught too, so
  // matching happens over whole-file text with import-type statements stripped first.
  const entryFiles = ["index.ts", PLAYTEST_BRIDGE_ENTRY];
  const seen = new Set<string>();
  const offenders: string[] = [];
  async function walk(file: string): Promise<void> {
    if (seen.has(file)) return;
    seen.add(file);
    let text: string;
    try {
      text = await readFile(join(srcRoot, file), "utf8");
    } catch {
      throw new Error(`browser-tier walk could not read ${file}`);
    }
    for (const match of text.matchAll(/(?:from|import) ["'](node:[^"']+)["']/g)) {
      offenders.push(`${file}: bare ${match[1]}`);
    }
    const withoutTypeImports = text.replace(/import type \{[^}]*\} from "[^"]*";/g, "");
    if (/["']@threenative\/playtest["']/.test(withoutTypeImports)) {
      offenders.push(`${file}: value import of @threenative/playtest root`);
    }
    for (const match of withoutTypeImports.matchAll(/from ["'](\.[./][^"']+)["']/g)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const resolved = join(dirname(file), specifier).replace(/\.js$/, ".ts");
      await walk(resolved);
    }
  }
  for (const entry of entryFiles) await walk(entry);

  expect(seen.size).toBeGreaterThan(3);
  expect(offenders).toEqual([]);
});

test("should ship the Three.js batched velocity patch with core", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { files?: string[] };
  expect(manifest.files).toContain("patches");
  const patch = await readFile(new URL("../patches/three@0.185.1.patch", import.meta.url), "utf8");
  expect(patch).toContain("this.object.userData?.useVelocity === true");
  expect(patch).toContain("_previousMatricesTexture ?? matricesTexture");
  expect(patch).toContain("this.gpu = ( typeof navigator !== 'undefined' ) ? navigator.gpu : null");
});
