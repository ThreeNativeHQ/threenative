import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareSweeps } from "../sweep-delta.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "threenative-delta-"));
  temporaryRoots.push(root);
  return root;
}

async function writeArchive(
  root: string,
  name: string,
  options: {
    readonly genre?: string;
    readonly briefHash?: string;
    readonly round: number;
    readonly frameworkImports: boolean;
    readonly usedExport?: string;
  },
): Promise<string> {
  const archive = path.join(root, "docs", "benchmark", "sweeps", name);
  const declarations = path.join(archive, "framework-types", "@threenative", "core");
  await mkdir(path.join(archive, "src"), { recursive: true });
  await mkdir(declarations, { recursive: true });
  await writeFile(
    path.join(declarations, "index.d.ts"),
    [
      "export declare const MovedExport: number;",
      "export declare const StillUnused: number;",
      "",
    ].join("\n"),
  );
  const imported = options.usedExport ?? "StillUnused";
  const source = options.frameworkImports
    ? `import { ${imported} } from "@threenative/core";\nvoid ${imported};\n`
    : 'import { Vector3 } from "three";\nvoid new Vector3();\n';
  await writeFile(path.join(archive, "src", "main.ts"), source);
  const genre = options.genre ?? "fixture";
  const briefHash = options.briefHash ?? "a".repeat(64);
  await writeFile(
    path.join(archive, "sweep.json"),
    JSON.stringify({
      genre,
      briefHash,
      template: "none",
      date: `2099-01-0${options.round}T00:00:00.000Z`,
      frameworkVersion: "0.1.0",
      sourceLines: 0,
    }),
  );
  const verification = path.join(root, "docs", "verification");
  await mkdir(verification, { recursive: true });
  await writeFile(
    path.join(verification, `sweep-${name}.md`),
    [
      `# Fixture ${name}`,
      `Genre: ${genre}`,
      `Round: ${options.round}`,
      `Brief SHA-256: ${briefHash}`,
      `Archive: ${path.relative(root, archive)}`,
      "## Friction ledger",
      "| API or surface | What blocked the build | Workaround | Evidence |",
      "| --- | --- | --- | --- |",
      "| CharacterBody3D | fixture blocker | raw body | fixture evidence |",
    ].join("\n"),
  );
  return archive;
}

describe("sweep delta", () => {
  it("exposes the delta comparator through the package script", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.["sweep:delta"]).toBe("tsx scripts/sweep-delta.ts");
  });

  it("reports an export that moved from unused to used and a carried friction row", async () => {
    const root = await fixtureRoot();
    const before = await writeArchive(root, "fixture-before", {
      round: 1,
      frameworkImports: false,
    });
    const after = await writeArchive(root, "fixture-after", {
      round: 2,
      frameworkImports: true,
      usedExport: "MovedExport",
    });
    const delta = compareSweeps(before, after, root);
    expect(delta.reachRate.before).toBe(0);
    expect(delta.reachRate.after).toBe(1);
    expect(delta.movedToUsed).toEqual(["MovedExport"]);
    expect(delta.stillUntouched).toEqual(["StillUnused"]);
    expect(delta.frictionRowsCarriedOver[0]?.apiOrSurface).toBe("CharacterBody3D");
  });

  it("throws when the archives name different genres", async () => {
    const root = await fixtureRoot();
    const before = await writeArchive(root, "fixture-before", {
      round: 1,
      frameworkImports: false,
    });
    const after = await writeArchive(root, "fixture-after", {
      round: 2,
      frameworkImports: true,
      genre: "platformer",
    });
    expect(() => compareSweeps(before, after, root)).toThrow(/different genres/);
  });

  it("throws when the brief hashes differ", async () => {
    const root = await fixtureRoot();
    const before = await writeArchive(root, "fixture-before", {
      round: 1,
      frameworkImports: false,
    });
    const after = await writeArchive(root, "fixture-after", {
      round: 2,
      frameworkImports: true,
      briefHash: "b".repeat(64),
    });
    expect(() => compareSweeps(before, after, root)).toThrow(/different brief hashes/);
  });

  it("throws before measuring when both paths resolve to one archive", async () => {
    const root = await fixtureRoot();
    const archive = await writeArchive(root, "fixture-before", {
      round: 1,
      frameworkImports: false,
    });
    expect(() => compareSweeps(archive, path.join(archive, "."), root)).toThrow(/with itself/);
  });

  it("fails closed when an archive has no round-aware ledger", async () => {
    const root = await fixtureRoot();
    const archive = await writeArchive(root, "fixture-before", {
      round: 1,
      frameworkImports: false,
    });
    const ledger = path.join(root, "docs", "verification", "sweep-fixture-before.md");
    await writeFile(ledger, (await readFile(ledger, "utf8")).replace("Round: 1", "Round: "));
    const after = await writeArchive(root, "fixture-after", {
      round: 2,
      frameworkImports: true,
      usedExport: "MovedExport",
    });
    expect(() => compareSweeps(archive, after, root)).toThrow(/Round/);
  });
});
