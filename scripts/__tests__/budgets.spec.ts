import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  budgetErrors,
  budgetTriggers,
  collectBudgets,
  enforceBudgets,
  verifyFrameworkLocAttribution,
} from "../check-budgets";

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixtureRoot(): Promise<string> {
  const root = await makeTempDir("threenative-budget-");
  temporaryRoots.push(root);
  return root;
}

async function nativeFixture(root: string): Promise<void> {
  const directory = path.join(root, "packages", "runtime-native");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "runtime.cpp"), "owned");
  await writeFile(path.join(directory, "CMakeLists.txt"), "owned");
}

async function writeNativeCensus(
  root: string,
  rows: readonly (readonly [string, number])[],
  total: number,
): Promise<void> {
  const recordPath = path.join(root, "docs", "verification", "native-runtime-census-2026-08-16.md");
  await mkdir(path.dirname(recordPath), { recursive: true });
  const tableRows = rows.map(([area, lines]) => `| ${area} | ${lines} | owner |`).join("\n");
  await writeFile(
    recordPath,
    [
      "| Counted area | Lines | Owner |",
      "| --- | ---: | --- |",
      tableRows,
      `| **Total** | **${total}** | |`,
    ].join("\n"),
  );
}

async function writeFrameworkAttribution(
  root: string,
  rows: readonly (readonly [string, number])[],
  total: number,
): Promise<void> {
  const recordPath = path.join(root, "docs", "verification", "loc-attribution-2026-08-19.md");
  await mkdir(path.dirname(recordPath), { recursive: true });
  const tableRows = rows.map(([name, lines]) => `| ${name} | ${lines} |`).join("\n");
  await writeFile(
    recordPath,
    [
      "# Framework LOC attribution",
      "",
      `Recorded framework LOC: ${total}`,
      "",
      "| Package | Counted LOC |",
      "| --- | ---: |",
      tableRows,
    ].join("\n"),
  );
}

describe("budget gate", () => {
  it("should allow 8 framework packages plus example workspaces", async () => {
    const root = await fixtureRoot();
    for (let index = 0; index < 8; index += 1) {
      const directory = path.join(root, "packages", `package-${index}`);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "package.json"), "{}");
    }
    for (let index = 0; index < 3; index += 1) {
      const directory = path.join(root, "examples", `example-${index}`);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "package.json"), "{}");
    }
    const report = await collectBudgets(root);
    expect(report.frameworkPackages).toBe(8);
    expect(report.exampleWorkspaces).toBe(3);
    expect(budgetErrors(report)).not.toContainEqual(
      expect.stringContaining("framework package cap exceeded"),
    );
  });

  it("should report framework package count without inventing a numeric cap", async () => {
    const root = await fixtureRoot();
    for (let index = 0; index < 9; index += 1) {
      const directory = path.join(root, "packages", `package-${index}`);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "package.json"), "{}");
    }
    const report = await collectBudgets(root);
    expect(report.frameworkPackages).toBe(9);
    expect(budgetErrors(report)).toEqual([]);
    expect(budgetTriggers(report)).toEqual([]);
  });

  it("should trigger review when framework LOC exceeds 15000", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "core", "src");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, "packages", "core", "package.json"), "{}");
    await writeFile(path.join(directory, "large.ts"), "x\n".repeat(15_000));
    const report = await collectBudgets(root);
    expect(budgetTriggers(report).join("\n")).toContain("framework LOC review trigger");
    expect(budgetErrors(report)).toEqual([]);
  });

  it("should allow framework LOC at 14999 lines", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "core", "src");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, "packages", "core", "package.json"), "{}");
    await writeFile(path.join(directory, "large.ts"), "x\n".repeat(14_998));
    const report = await collectBudgets(root);
    expect(budgetTriggers(report)).toEqual([]);
    expect(budgetErrors(report)).toEqual([]);
  });

  it("should name framework packages that moved since the recorded attribution", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "core", "src");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, "packages", "core", "package.json"), "{}");
    await writeFile(path.join(directory, "large.ts"), "x\n".repeat(15_000));
    await writeFrameworkAttribution(root, [["core", 0]], 0);

    const report = await collectBudgets(root);
    const trigger = budgetTriggers(report).join("\n");

    expect(report.frameworkLocByPackage).toEqual([{ loc: report.frameworkLoc, name: "core" }]);
    expect(trigger).toContain("Packages moved since last recorded attribution: core (+");
  });

  it("should allow a stale historical attribution during normal budget enforcement", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "physics", "src");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, "packages", "physics", "package.json"), "{}");
    await writeFile(path.join(directory, "owned.ts"), "owned");
    await writeFrameworkAttribution(root, [["physics", 0]], 0);

    const report = await collectBudgets(root);
    expect(report.frameworkLoc).toBe(1);
    expect(report.frameworkLocAttribution?.total).toBe(0);
    await expect(enforceBudgets(root)).resolves.toMatchObject({ frameworkLoc: 1 });
  });

  it("should fail closed when the explicit framework attribution verifier finds a mismatch", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "physics", "src");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, "packages", "physics", "package.json"), "{}");
    await writeFile(path.join(directory, "owned.ts"), "owned");
    await writeFrameworkAttribution(root, [["physics", 0]], 0);

    await expect(verifyFrameworkLocAttribution(root)).rejects.toThrow(
      "recorded framework LOC attribution total disagrees with measured framework LOC: recorded 0, measured 1",
    );
  });

  it("should fail the opt-in verifier when package rows move even if the total stays equal", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "core", "src");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, "packages", "core", "package.json"), "{}");
    await writeFile(path.join(directory, "owned.ts"), "owned");
    await writeFrameworkAttribution(
      root,
      [
        ["core", 0],
        ["physics", 1],
      ],
      1,
    );

    await expect(verifyFrameworkLocAttribution(root)).rejects.toThrow(
      "framework LOC attribution package rows disagree",
    );
  });

  it("should count native source and build files toward the framework LOC trigger", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "physics-native", "src");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, "packages", "physics-native", "package.json"), "{}");
    await writeFile(path.join(root, "packages", "physics-native", "CMakeLists.txt"), "x\n");
    await writeFile(path.join(directory, "binding.cpp"), "x\n".repeat(15_000));
    const report = await collectBudgets(root);
    expect(budgetTriggers(report).join("\n")).toContain("framework LOC review trigger");
    expect(budgetErrors(report)).toEqual([]);
  });

  it("should fail when the asset MCP is vendored into packages", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "asset-mcp");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "threenative-asset-mcp" }),
    );
    const report = await collectBudgets(root);
    expect(report.vendoredExternalMcp).toEqual(["asset-mcp"]);
    expect(budgetErrors(report).join("\n")).toContain("must stay external");
  });

  it("should fail when a workspace package depends on the asset MCP", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "core");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { "threenative-asset-mcp": "0.4.0" }, name: "core" }),
    );
    const report = await collectBudgets(root);
    expect(budgetErrors(report).join("\n")).toContain("must stay external");
  });

  it("should fail when the sculpt MCP is vendored into packages", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "sculpt-mcp");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "threenative-sculpt-mcp" }),
    );
    const report = await collectBudgets(root);
    expect(report.vendoredExternalMcp).toEqual(["sculpt-mcp"]);
    expect(budgetErrors(report).join("\n")).toContain("must stay external");
  });

  it("should fail when a workspace package depends on the sculpt MCP", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "core");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { "threenative-sculpt-mcp": "0.1.0" }, name: "core" }),
    );
    const report = await collectBudgets(root);
    expect(budgetErrors(report).join("\n")).toContain("must stay external");
  });

  it("should keep external MCPs out of the real tree", async () => {
    const report = await collectBudgets(process.cwd());
    expect(report.vendoredExternalMcp).toEqual([]);
  });

  it("should allow the Mystral native runtime only in its owned package", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "runtime-native", "include", "mystral");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, "packages", "runtime-native", "package.json"), "{}");
    await writeFile(path.join(directory, "runtime.h"), "#pragma once\n");
    const report = await collectBudgets(root);
    expect(report.vendoredNativeRuntime).toEqual([]);
    expect(budgetErrors(report)).not.toContainEqual(
      expect.stringContaining("runtime is allowed only"),
    );
  });

  it("should fail when the Mystral native runtime is outside its owned package", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "anything-else", "include", "mystral");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "runtime.h"), "#pragma once\n");
    const report = await collectBudgets(root);
    expect(report.vendoredNativeRuntime).toEqual([path.join("packages", "anything-else")]);
    expect(budgetErrors(report).join("\n")).toContain("runtime is allowed only");
  });

  it("should ignore a scratch git worktree that checks the runtime out again", async () => {
    const root = await fixtureRoot();
    const directory = path.join(
      root,
      ".worktrees",
      "prd-000-scratch",
      "packages",
      "runtime-native",
      "include",
      "mystral",
    );
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "runtime.h"), "#pragma once\n");
    const report = await collectBudgets(root);
    expect(report.vendoredNativeRuntime).toEqual([]);
    expect(budgetErrors(report)).not.toContainEqual(
      expect.stringContaining("runtime is allowed only"),
    );
  });

  it("should trigger review when native runtime LOC exceeds 50000 without charging framework LOC", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "runtime-native", "src");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, "packages", "runtime-native", "package.json"), "{}");
    await writeFile(path.join(directory, "runtime.cpp"), "x\n".repeat(50_000));
    const report = await collectBudgets(root);
    expect(report.frameworkLoc).toBe(0);
    expect(report.nativeRuntimeLoc).toBeGreaterThan(50_000);
    expect(budgetTriggers(report).join("\n")).toContain("native runtime LOC review trigger");
    expect(budgetErrors(report)).toEqual([]);
  });

  it("should allow native runtime LOC below 50000", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "runtime-native", "src");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, "packages", "runtime-native", "package.json"), "{}");
    await writeFile(path.join(directory, "runtime.cpp"), "x\n".repeat(49_998));
    const report = await collectBudgets(root);
    expect(report.nativeRuntimeLoc).toBeLessThanOrEqual(50_000);
    expect(budgetTriggers(report)).toEqual([]);
    await expect(enforceBudgets(root)).resolves.toMatchObject({
      nativeRuntimeLoc: report.nativeRuntimeLoc,
    });
  });

  it("should reject an incomplete native census when enforcing budgets", async () => {
    const root = await fixtureRoot();
    await nativeFixture(root);
    await writeNativeCensus(root, [["src/", 1]], 2);

    await expect(enforceBudgets(root)).rejects.toThrow(
      "native census sum no longer equals measured native runtime LOC",
    );

    await writeNativeCensus(
      root,
      [
        ["src/", 1],
        ["tests/", 1],
      ],
      2,
    );
    await expect(enforceBudgets(root)).resolves.toMatchObject({ nativeRuntimeLoc: 2 });
  });

  it("should reject a stale native census total when enforcing budgets", async () => {
    const root = await fixtureRoot();
    await nativeFixture(root);
    const rows = [
      ["src/", 1],
      ["tests/", 1],
    ] as const;
    await writeNativeCensus(root, rows, 1);

    await expect(enforceBudgets(root)).rejects.toThrow(
      "recorded native census total disagrees with measured native runtime LOC",
    );

    await writeNativeCensus(root, rows, 2);
    await expect(enforceBudgets(root)).resolves.toMatchObject({ nativeRuntimeLoc: 2 });
  });

  it("should pass the restored native census", async () => {
    const root = await fixtureRoot();
    await nativeFixture(root);
    await writeNativeCensus(
      root,
      [
        ["src/", 1],
        ["tests/", 1],
      ],
      2,
    );

    await expect(enforceBudgets(root)).resolves.toMatchObject({ nativeRuntimeLoc: 2 });
  });

  it("should exclude only the ignored generated Android bundle artifacts from native LOC", async () => {
    const root = await fixtureRoot();
    const directory = path.join(
      root,
      "packages",
      "runtime-native",
      "android",
      "app",
      "src",
      "main",
      "assets",
      "scripts",
    );
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "main.js"), "generated\n".repeat(60_000));
    await writeFile(path.join(directory, "main.js.meta.json"), "generated\n".repeat(60_000));
    await writeFile(path.join(directory, "bridge.js"), "owned\n");
    const report = await collectBudgets(root);
    expect(report.nativeRuntimeLoc).toBe(2);
  });

  it("should exclude generated Cargo target metadata from native LOC", async () => {
    const root = await fixtureRoot();
    const target = path.join(root, "packages", "runtime-native", "native", "physics", "target");
    await mkdir(path.join(target, "debug"), { recursive: true });
    await writeFile(path.join(root, "packages", "runtime-native", "package.json"), "{}\n");
    await writeFile(path.join(root, "packages", "runtime-native", "runtime.cpp"), "owned\n");
    await writeFile(path.join(target, "debug", "metadata.json"), "generated\n".repeat(60_000));
    const report = await collectBudgets(root);
    expect(report.nativeRuntimeLoc).toBe(4);
  });

  it("should fail when native third_party content is tracked", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "runtime-native", "third_party");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, "packages", "runtime-native", "package.json"), "{}");
    await writeFile(path.join(directory, "dependency.cpp"), "x\n");
    await execFileAsync("git", ["-C", root, "init"]);
    await execFileAsync("git", ["-C", root, "add", "-f", "packages/runtime-native/third_party"]);
    const report = await collectBudgets(root);
    expect(report.trackedNativeThirdParty).toEqual([
      "packages/runtime-native/third_party/dependency.cpp",
    ]);
    expect(budgetErrors(report).join("\n")).toContain("third_party must stay untracked");
  });

  it("should allow untracked native third_party content", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "runtime-native", "third_party");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "dependency.cpp"), "x\n");
    const report = await collectBudgets(root);
    expect(report.trackedNativeThirdParty).toEqual([]);
    expect(budgetErrors(report)).not.toContainEqual(
      expect.stringContaining("third_party must stay untracked"),
    );
  });

  it("should keep the Mystral native runtime free of hard budget errors", async () => {
    const report = await collectBudgets(process.cwd());
    expect(report.vendoredNativeRuntime).toEqual([]);
    expect(report.trackedNativeThirdParty).toEqual([]);
    expect(budgetErrors(report)).toEqual([]);
  });

  it("should keep the real tree under every hard limit", async () => {
    const report = await collectBudgets(process.cwd());
    expect(budgetErrors(report)).toEqual([]);
  });
});
