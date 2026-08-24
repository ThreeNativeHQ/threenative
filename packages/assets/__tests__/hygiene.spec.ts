import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const sources = [
  ["asset-utils", new URL("../src/asset-utils.ts", import.meta.url)],
  ["compile", new URL("../src/compile.ts", import.meta.url)],
  ["watch", new URL("../src/watch.ts", import.meta.url)],
] as const;

const DEFAULT_OUTPUT_OWNER =
  /(?:export\s+)?const\s+DEFAULT(?:_ASSET)?_OUTPUT\s*=\s*["']public["'];/gu;

describe("asset source ownership", () => {
  it("should define the default output directory in one shared source owner", async () => {
    const contents = await Promise.all(
      sources.map(async ([name, url]) => ({ name, source: await readFile(url, "utf8") })),
    );
    const owners = contents.flatMap(({ name, source }) =>
      [...source.matchAll(DEFAULT_OUTPUT_OWNER)].map(() => name),
    );

    expect(owners).toEqual(["asset-utils"]);
    expect(contents.find(({ name }) => name === "compile")?.source).toContain(
      "DEFAULT_ASSET_OUTPUT",
    );
    expect(contents.find(({ name }) => name === "watch")?.source).toContain("DEFAULT_ASSET_OUTPUT");
  });
});
