import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { budgetErrors, collectBudgets } from "../check-budgets";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "threenative-budget-"));
  temporaryRoots.push(root);
  return root;
}

describe("budget gate", () => {
  it("should fail when package count exceeds 8", async () => {
    const root = await fixtureRoot();
    for (let index = 0; index < 9; index += 1) {
      const directory = path.join(root, "packages", `package-${index}`);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "package.json"), "{}");
    }
    const report = await collectBudgets(root);
    expect(budgetErrors(report).join("\n")).toContain("workspace package cap exceeded");
  });

  it("should fail when framework LOC exceeds 15000", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "core", "src");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, "packages", "core", "package.json"), "{}");
    await writeFile(path.join(directory, "large.ts"), "x\n".repeat(15_000));
    const report = await collectBudgets(root);
    expect(budgetErrors(report).join("\n")).toContain("framework LOC cap exceeded");
  });

  it("should allow framework LOC at 14999 lines", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "core", "src");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, "packages", "core", "package.json"), "{}");
    await writeFile(path.join(directory, "large.ts"), "x\n".repeat(14_998));
    const report = await collectBudgets(root);
    expect(budgetErrors(report)).not.toContainEqual(
      expect.stringContaining("framework LOC cap exceeded"),
    );
  });

  it("should keep the real tree under every cap", async () => {
    const report = await collectBudgets(process.cwd());
    expect(budgetErrors(report)).toEqual([]);
  });
});
