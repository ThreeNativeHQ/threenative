import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import { checkCoreBoundary } from "../check-core-boundary.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixtureRoot(): Promise<string> {
  const root = await makeTempDir("threenative-core-boundary-");
  temporaryRoots.push(root);
  await mkdir(path.join(root, "packages/core/src"), { recursive: true });
  await mkdir(path.join(root, "packages/create-threenative/templates/starter/src/render"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "packages/create-threenative/templates/starter/package.json"),
    JSON.stringify({ dependencies: { vite: "1.0.0" } }),
  );
  await writeFile(
    path.join(root, "packages/create-threenative/templates/starter/src/render/lighting.ts"),
    "export const lighting = true;\n",
  );
  await writeFile(
    path.join(root, "packages/create-threenative/templates/starter/src/render/hud.ts"),
    "export const hud = true;\n",
  );
  return root;
}

describe("core boundary gate", () => {
  it("passes the entity and scaffold rules on a clean fixture", async () => {
    const root = await fixtureRoot();
    await writeFile(path.join(root, "packages/core/src/entities.ts"), "export const ok = true;\n");
    await expect(checkCoreBoundary(root)).resolves.toEqual([]);
  });

  it("fails the entity line limit and banned-token rule locally", async () => {
    const root = await fixtureRoot();
    await writeFile(
      path.join(root, "packages/core/src/entities.ts"),
      `${"const line = 1;\n".repeat(80)}export const System = 1;\n`,
    );

    const findings = await checkCoreBoundary(root);
    expect(findings.join("\n")).toMatch(/entities\.ts has 81 lines.*fewer than 80/isu);
    expect(findings.join("\n")).toContain("banned entity-registry token 'System'");
  });

  it("names a banned entity-registry token in a second core source file", async () => {
    const root = await fixtureRoot();
    await writeFile(path.join(root, "packages/core/src/entities.ts"), "export const ok = true;\n");
    await writeFile(
      path.join(root, "packages/core/src/entity-snapshot.ts"),
      "export const snapshot = Component;\n",
    );

    await expect(checkCoreBoundary(root)).resolves.toContain(
      "packages/core/src/entity-snapshot.ts:1 uses banned entity-registry token 'Component'",
    );
  });

  it("fails scaffold hygiene when generated render code imports the framework", async () => {
    const root = await fixtureRoot();
    await writeFile(path.join(root, "packages/core/src/entities.ts"), "export const ok = true;\n");
    await writeFile(
      path.join(root, "packages/create-threenative/templates/starter/src/render/lighting.ts"),
      'import { defineGame } from "@threenative/core";\n',
    );

    await expect(checkCoreBoundary(root)).resolves.toEqual([
      expect.stringContaining("starter/src/render/lighting.ts imports @threenative/"),
    ]);
  });
});
