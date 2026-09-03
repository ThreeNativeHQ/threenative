import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import { checkTemplateConventions } from "../check-template-conventions.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

function table(groundingCell = "`src/conventions.ts:1`"): string {
  return `| Template | GroundSnap | normaliseToMetres | attachToBone | AnimationPlayer |
| --- | --- | --- | --- | --- |
| alpha | ${groundingCell} | \`src/conventions.ts:2\` | \`src/conventions.ts:3\` | N/A — no animation asset |
`;
}

async function fixtureRoot(source: string, applicability = table()): Promise<string> {
  const root = await makeTempDir("threenative-template-conventions-");
  temporaryRoots.push(root);
  const templateRoot = path.join(root, "packages/create-threenative/templates/alpha");
  await mkdir(path.join(templateRoot, "src"), { recursive: true });
  await writeFile(
    path.join(templateRoot, "AGENTS.md"),
    "GroundSnap normaliseToMetres attachToBone AnimationPlayer\n",
  );
  await writeFile(path.join(templateRoot, "src/conventions.ts"), source);
  await mkdir(path.join(root, "docs/verification"), { recursive: true });
  await writeFile(
    path.join(root, "docs/verification/PRD-289-conventions-2026-08-31.md"),
    applicability,
  );
  return root;
}

describe("template convention drift gate", () => {
  it("passes real AST calls and a reasoned N/A cell", async () => {
    const root = await fixtureRoot(
      "new GroundSnap(model);\nnormaliseToMetres(model);\nattachToBone(model);\n",
    );

    await expect(checkTemplateConventions(root)).resolves.toEqual([]);
  });

  it("fails when an applicable convention name is removed from AGENTS.md", async () => {
    const root = await fixtureRoot(
      "new GroundSnap(model);\nnormaliseToMetres(model);\nattachToBone(model);\n",
    );
    await writeFile(
      path.join(root, "packages/create-threenative/templates/alpha/AGENTS.md"),
      "normaliseToMetres attachToBone AnimationPlayer\n",
    );

    const findings = await checkTemplateConventions(root);
    expect(findings).toContain(
      "Template 'alpha' applicable convention 'GroundSnap' is missing from AGENTS.md.",
    );
  });

  it("names the template and symbol when a call is removed", async () => {
    const root = await fixtureRoot(
      "// GroundSnap was removed.\nnormaliseToMetres(model);\nattachToBone(model);\n",
    );

    const findings = await checkTemplateConventions(root);
    expect(findings.join("\n")).toContain("Template 'alpha' convention 'GroundSnap'");
  });

  it("does not count a commented-out call as source evidence", async () => {
    const root = await fixtureRoot(
      "// new GroundSnap(model);\nnormaliseToMetres(model);\nattachToBone(model);\n",
    );

    await expect(checkTemplateConventions(root)).resolves.toEqual([
      expect.stringContaining("Template 'alpha' convention 'GroundSnap'"),
    ]);
  });

  it("requires a one-line reason for every N/A cell", async () => {
    const root = await fixtureRoot(
      "new GroundSnap(model);\nnormaliseToMetres(model);\nattachToBone(model);\n",
      table("N/A"),
    );

    const findings = await checkTemplateConventions(root);
    expect(findings.join("\n")).toContain("alpha/GroundSnap");
  });

  it("rejects duplicate applicability rows", async () => {
    const root = await fixtureRoot(
      "new GroundSnap(model);\nnormaliseToMetres(model);\nattachToBone(model);\n",
      `${table()}| alpha | \`src/conventions.ts:1\` | \`src/conventions.ts:2\` | \`src/conventions.ts:3\` | N/A — no animation asset |\n`,
    );

    await expect(checkTemplateConventions(root)).resolves.toEqual([
      "Applicability table has duplicate template row 'alpha'.",
    ]);
  });

  it("stops at a later markdown table", async () => {
    const root = await fixtureRoot(
      "new GroundSnap(model);\nnormaliseToMetres(model);\nattachToBone(model);\n",
      `${table()}\n## Run record\n\n| Template | Scenarios | Result |\n| --- | ---: | --- |\n| alpha | 3 | PASS |\n`,
    );

    await expect(checkTemplateConventions(root)).resolves.toEqual([]);
  });
});
