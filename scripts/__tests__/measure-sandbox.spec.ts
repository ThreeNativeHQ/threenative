import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { measureSandbox } from "../measure-sandbox";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixtureRoot(prefix = "threenative-measure-"): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

async function installDeclarations(root: string): Promise<void> {
  const directory = path.join(root, "node_modules", "@threenative", "core", "dist");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "index.d.ts"),
    [
      "export declare const UsedExport: number;",
      "export declare const UnusedExport: number;",
      "export declare function AlsoUnused(): void;",
      "",
    ].join("\n"),
  );
}

describe("sandbox measurement", () => {
  it("reports a zero reach rate when source imports only bare three", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "src"), { recursive: true });
    await installDeclarations(root);
    const source =
      'import { Vector3 } from "three";\nconst label = "é";\nconst position = new Vector3();\nvoid position;\n';
    await writeFile(path.join(root, "src", "main.ts"), source);
    const measurement = measureSandbox(root);
    expect(measurement.reachRate).toBe(0);
    expect(measurement.frameworkFiles).toBe(0);
    expect(measurement.sourceBytes).toBe(Buffer.byteLength(source, "utf8"));
    expect(measurement.sourceBytes).not.toBe(source.length);
    expect(measurement.threeOnlyFiles).toBe(1);
  });

  it("throws when src has no source files instead of reporting 0/0", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "src"), { recursive: true });
    await installDeclarations(root);
    expect(() => measureSandbox(root)).toThrow(/src\/ has no source files/);
  });

  it("moves an imported declaration from unusedExports to usedExports", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "src"), { recursive: true });
    await installDeclarations(root);
    await writeFile(
      path.join(root, "src", "main.ts"),
      'import { UsedExport } from "@threenative/core";\nvoid UsedExport;\n',
    );
    const measurement = measureSandbox(root);
    expect(measurement.frameworkFiles).toBe(1);
    expect(measurement.usedExports).toContain("UsedExport");
    expect(measurement.unusedExports).toContain("UnusedExport");
    expect(measurement.unusedExports).toContain("AlsoUnused");
    expect(measurement.usedExports).not.toContain("UnusedExport");
  });

  it("recognizes multiline framework imports from formatted consumer source", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "src"), { recursive: true });
    await installDeclarations(root);
    await writeFile(
      path.join(root, "src", "main.ts"),
      ["import {", "  UsedExport,", '} from "@threenative/core";', "void UsedExport;", ""].join(
        "\n",
      ),
    );
    const measurement = measureSandbox(root);
    expect(measurement.frameworkFiles).toBe(1);
    expect(measurement.usedExports).toContain("UsedExport");
    expect(measurement.usedExports).not.toContain("UnusedExport");
  });

  it("scopes namespace imports to their framework package", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "src"), { recursive: true });
    await installDeclarations(root);
    const physicsDirectory = path.join(root, "node_modules", "@threenative", "physics", "dist");
    await mkdir(physicsDirectory, { recursive: true });
    await writeFile(
      path.join(physicsDirectory, "index.d.ts"),
      "export declare const PhysicsOnly: number;\n",
    );
    await writeFile(
      path.join(root, "src", "main.ts"),
      'import * as core from "@threenative/core";\nvoid core;\n',
    );
    const measurement = measureSandbox(root);
    expect(measurement.usedExports).toContain("UsedExport");
    expect(measurement.usedExports).not.toContain("PhysicsOnly");
    expect(measurement.unusedExports).toContain("PhysicsOnly");
  });

  it("throws when framework declarations are absent", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "main.ts"), "export const ready = true;\n");
    expect(() => measureSandbox(root)).toThrow(/missing node_modules\/@threenative declarations/);
  });
});
