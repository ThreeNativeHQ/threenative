import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  type ISupersession,
  detectReinventions,
  loadSupersessions,
} from "../detect-capability-duplicates.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const SUPERSEDES: readonly ISupersession[] = [
  { construct: "new Raycaster(", importPath: "@threenative/core", symbol: "ScenePicker" },
  { construct: "Math.random(", importPath: "@threenative/core", symbol: "createRandom" },
];

async function writeSource(root: string, relative: string, source: string): Promise<string> {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, source);
  return path.relative(root, file);
}

async function scan(root: string, source: string): Promise<{ empty: number; found: number }> {
  const file = await writeSource(root, "src/game.ts", source);
  const report = await detectReinventions(root, SUPERSEDES);
  const mine = report.findings.filter((finding) => finding.file === file);
  const empties = report.emptyOverrides.filter((finding) => finding.file === file);
  expect(report.filesScanned).toBeGreaterThanOrEqual(1);
  return { empty: empties.length, found: mine.length };
}

describe("reinvention gate", () => {
  it("fails a project that reaches past a superseded capability", async () => {
    const root = await makeTempDir("threenative-reinvent-hit-");
    temporaryRoots.push(root);

    const { found } = await scan(root, "const raycaster = new Raycaster();\n");
    expect(found).toBe(1);
  });

  it("names the superseding symbol and its import path in the finding", async () => {
    const root = await makeTempDir("threenative-reinvent-names-");
    temporaryRoots.push(root);
    const file = await writeSource(root, "src/shoot.ts", "new Raycaster();\n");

    const report = await detectReinventions(root, SUPERSEDES);
    expect(report.findings[0]).toMatchObject({
      construct: "new Raycaster(",
      file,
      importPath: "@threenative/core",
      line: 1,
      symbol: "ScenePicker",
    });
  });

  it("passes an annotated override with a non-empty reason", async () => {
    const root = await makeTempDir("threenative-reinvent-override-");
    temporaryRoots.push(root);

    const sameLine = await scan(
      root,
      "new Raycaster(); // engine-override: needs every hit for splash damage\n",
    );
    expect(sameLine).toEqual({ empty: 0, found: 0 });

    const previousLine = await scan(
      root,
      "// engine-override: needs every hit for splash damage\nnew Raycaster();\n",
    );
    expect(previousLine).toEqual({ empty: 0, found: 0 });
  });

  it("rejects an override annotation whose reason is empty", async () => {
    const root = await makeTempDir("threenative-reinvent-empty-override-");
    temporaryRoots.push(root);

    const result = await scan(root, "new Raycaster(); // engine-override:\n");
    expect(result).toEqual({ empty: 1, found: 0 });
  });

  it("ignores constructs inside comments and strings", async () => {
    const root = await makeTempDir("threenative-reinvent-quiet-");
    temporaryRoots.push(root);

    const { found } = await scan(
      root,
      [
        "// the old code was new Raycaster() everywhere",
        'const hint = "never write new Raycaster(";',
        "/* block new Raycaster( too */",
        "const template = `not new Raycaster(`;",
        "",
      ].join("\n"),
    );
    expect(found).toBe(0);
  });

  it("does not fire on a name that merely overlaps a capability", async () => {
    const root = await makeTempDir("threenative-reinvent-name-noise-");
    temporaryRoots.push(root);

    const { found } = await scan(root, "export class FrameStats {}\n");
    expect(found).toBe(0);
  });

  it("flags a hand-written A* by token structure, not by name", async () => {
    const root = await makeTempDir("threenative-reinvent-astar-");
    temporaryRoots.push(root);
    const file = await writeSource(
      root,
      "src/enemy.ts",
      [
        "#private findPath(): void {",
        "  const gScore = new Map<number, number>();",
        "  const cameFrom = new Map<number, number>();",
        "}",
        "",
      ].join("\n"),
    );

    const report = await detectReinventions(root, []);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        file,
        importPath: "@threenative/physics/navigation",
        symbol: "NavigationAgent3D",
      }),
    );
  });

  it("flags the prewarm trick only when opacity-zero and visible-true co-occur without prewarm", async () => {
    const root = await makeTempDir("threenative-reinvent-prewarm-");
    temporaryRoots.push(root);

    const file = await writeSource(
      root,
      "src/flash.ts",
      "mesh.material.opacity = 0;\nmesh.visible = true;\n",
    );
    const both = await detectReinventions(root, []);
    expect(both.findings).toContainEqual(
      expect.objectContaining({ file, importPath: "@threenative/core", symbol: "prewarm" }),
    );

    const exempted = await writeSource(
      root,
      "src/warmed.ts",
      'import { prewarm } from "@threenative/core";\nmesh.material.opacity = 0;\nmesh.visible = true;\n',
    );
    const withImport = await detectReinventions(root, []);
    expect(withImport.findings.filter((finding) => finding.file === exempted)).toEqual([]);

    await writeSource(root, "src/half.ts", "mesh.material.opacity = 0;\n");
    const onlyOpacity = await detectReinventions(root, []);
    expect(onlyOpacity.findings.filter((finding) => finding.file === "src/half.ts")).toEqual([]);
  });
});
