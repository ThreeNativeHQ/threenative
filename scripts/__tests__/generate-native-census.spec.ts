import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import { generateNativeCensus } from "../generate-native-census";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixtureRoot(): Promise<string> {
  const root = await makeTempDir("threenative-census-");
  temporaryRoots.push(root);
  return root;
}

async function nativeFixture(root: string): Promise<void> {
  const directory = path.join(root, "packages", "runtime-native");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "runtime.cpp"), "owned\nmore\n");
  await writeFile(path.join(directory, "CMakeLists.txt"), "owned");
}

async function writeCensus(root: string, table: readonly string[]): Promise<void> {
  const recordPath = path.join(root, "docs", "verification", "native-runtime-census-2026-08-16.md");
  await mkdir(path.dirname(recordPath), { recursive: true });
  await writeFile(recordPath, `${table.join("\n")}\n`);
}

async function readCensus(root: string): Promise<string> {
  return readFile(
    path.join(root, "docs", "verification", "native-runtime-census-2026-08-16.md"),
    "utf8",
  );
}

describe("generateNativeCensus", () => {
  it("rewrites the Lines column and total from the measured walk", async () => {
    const root = await fixtureRoot();
    await nativeFixture(root);
    await writeCensus(root, [
      "| Counted area | Lines | Owner |",
      "| --- | ---: | --- |",
      "| `runtime.cpp` | 1 | owner | proof | alternative | **KEEP** — judged. |",
      "| Root `CMakeLists.txt` | 999 | owner | proof | alternative | **KEEP** — judged. |",
      "| **Total** | **1,000** |  |  |  |  |",
    ]);

    const result = await generateNativeCensus(root);
    expect(result).toEqual({ changedCells: 3, total: 4 });
    const record = await readCensus(root);
    expect(record).toContain("| `runtime.cpp` | 3 | owner | proof | alternative |");
    expect(record).toContain("| Root `CMakeLists.txt` | 1 | owner | proof | alternative |");
    expect(record).toContain("| **Total** | **4** |");
    expect(record).toContain("**KEEP** — judged.");
  });

  it("is idempotent once current", async () => {
    const root = await fixtureRoot();
    await nativeFixture(root);
    await writeCensus(root, [
      "| Counted area | Lines | Owner |",
      "| --- | ---: | --- |",
      "| `runtime.cpp` | 1 | owner | proof | alternative | **KEEP** — judged. |",
      "| Root `CMakeLists.txt` | 1 | owner | proof | alternative | **KEEP** — judged. |",
      "| **Total** | **2** |  |  |  |  |",
    ]);
    await generateNativeCensus(root);
    const before = await readCensus(root);

    const second = await generateNativeCensus(root);
    expect(second.changedCells).toBe(0);
    expect(await readCensus(root)).toBe(before);
  });

  it("refuses to add a row for an area nobody has judged", async () => {
    const root = await fixtureRoot();
    await nativeFixture(root);
    await writeCensus(root, [
      "| Counted area | Lines | Owner |",
      "| --- | ---: | --- |",
      "| `runtime.cpp` | 2 | owner | proof | alternative | **KEEP** — judged. |",
      "| **Total** | **2** |  |  |  |  |",
    ]);

    await expect(generateNativeCensus(root)).rejects.toThrow("counted areas with no census row");
    await expect(generateNativeCensus(root)).rejects.toThrow("Root CMakeLists.txt");
  });

  it("refuses to renumber a row whose area left the tree", async () => {
    const root = await fixtureRoot();
    await nativeFixture(root);
    await writeCensus(root, [
      "| Counted area | Lines | Owner |",
      "| --- | ---: | --- |",
      "| `runtime.cpp` | 2 | owner | proof | alternative | **KEEP** — judged. |",
      "| `deleted/` | 40 | owner | proof | alternative | **KEEP** — judged. |",
      "| Root `CMakeLists.txt` | 1 | owner | proof | alternative | **KEEP** — judged. |",
      "| **Total** | **43** |  |  |  |  |",
    ]);

    await expect(generateNativeCensus(root)).rejects.toThrow(
      "deleted/ counts an area the runtime tree no longer has",
    );
  });
});
