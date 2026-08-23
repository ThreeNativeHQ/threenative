import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { CORE_VERSION } from "../src/version.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// PRD-181 Phase 3: the version core reports in recordings has one owner - package.json.
// src/version.ts is generated from it; a hand-edited constant goes stale and this fails.
test("should report the real package version", async () => {
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
    version: string;
  };
  const generated = await readFile(join(packageRoot, "src", "version.ts"), "utf8");

  expect(CORE_VERSION).toBe(manifest.version);
  expect(generated).toContain(`export const CORE_VERSION = ${JSON.stringify(manifest.version)};`);
});
