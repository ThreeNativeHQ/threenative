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
