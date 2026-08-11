import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Biome interface naming gate", () => {
  it("should reject an unprefixed interface added to playtest source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-biome-naming-"));
    temporaryRoots.push(root);
    await writeFile(path.join(root, "biome.json"), await readFile(path.resolve("biome.json")));
    const fixture = path.join(root, "packages/playtest/src/fixture.ts");
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(fixture, "interface PlaytestFixture { readonly value: string; }\n");

    const result = spawnSync(
      path.resolve("node_modules/.bin/biome"),
      ["check", "--config-path", path.join(root, "biome.json"), fixture],
      { cwd: root, encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/naming|interface|PlaytestFixture/iu);
  });
});
