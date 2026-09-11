import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A test file that runs under no runner is worse than a failing one: it looks like coverage and
 * gates nothing.
 *
 * `packages/runtime-native/vitest.config.ts` collects `tests/**\/*.test.{ts,mjs}`, so every file
 * matching that glob is handed to vitest. A file there that imports `test` from `node:test`
 * instead passes happily under `node --test` by hand and reaches CI as
 *
 *   Error: No test suite found in .../tests/<file>.test.mjs
 *
 * Four such files existed at once in one evening - one mine, three from another lane - and each
 * had to be found through a red CI board. The rule is mechanical, so it belongs in a gate.
 */
const repositoryRoot = path.resolve(import.meta.dirname, "../..");

/** Packages whose own vitest config collects a `tests/` tree of test files. */
const collectedTrees = [{ glob: /\.test\.(?:ts|mjs)$/u, tree: "packages/runtime-native/tests" }];

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(entryPath)));
    else found.push(entryPath);
  }
  return found;
}

describe("vitest-collected test files", () => {
  it("never import a runner vitest cannot collect", async () => {
    const offenders: string[] = [];
    for (const { glob, tree } of collectedTrees) {
      for (const file of await filesUnder(path.join(repositoryRoot, tree))) {
        if (!glob.test(file)) continue;
        const source = await readFile(file, "utf8");
        if (/from\s+['"]node:test['"]/u.test(source)) {
          offenders.push(path.relative(repositoryRoot, file).split(path.sep).join("/"));
        }
      }
    }
    expect(
      offenders.sort(),
      "these files are collected by vitest but import node:test, so vitest reports 'No test suite found' and they gate nothing",
    ).toEqual([]);
  });

  it("checks a tree that actually contains collected files", async () => {
    // A guard that silently scans nothing passes forever. Pin that each configured tree really
    // does hold files the glob matches.
    for (const { glob, tree } of collectedTrees) {
      const matched = (await filesUnder(path.join(repositoryRoot, tree))).filter((file) =>
        glob.test(file),
      );
      expect(
        matched.length,
        `${tree} matched no test files; the glob or the path is stale`,
      ).toBeGreaterThan(0);
    }
  });
});
