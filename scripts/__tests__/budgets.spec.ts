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
  nativeCensusDrift,
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
  overrides?: {
    readonly alternative?: string;
    readonly liveProof?: string;
    readonly owner?: string;
    readonly verdict?: string;
  },
): Promise<void> {
  const recordPath = path.join(root, "docs", "verification", "native-runtime-census-2026-08-16.md");
  await mkdir(path.dirname(recordPath), { recursive: true });
  const owner = overrides?.owner ?? "owner";
  const liveProof = overrides?.liveProof ?? "live proof";
  const alternative = overrides?.alternative ?? "alternative considered";
  const verdict = overrides?.verdict ?? "**KEEP** — judged.";
  const tableRows = rows
    .map(
      ([area, lines]) =>
        `| ${area} | ${lines} | ${owner} | ${liveProof} | ${alternative} | ${verdict} |`,
    )
    .join("\n");
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

describe("budget gate", () => {
  it("should count active PRDs recursively without counting done or blocked records", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "docs", "PRDs", "performance"), { recursive: true });
    await mkdir(path.join(root, "docs", "PRDs", "done"), { recursive: true });
    await mkdir(path.join(root, "docs", "PRDs", "BLOCKED", "requires-device"), {
      recursive: true,
    });
    await writeFile(path.join(root, "docs", "PRDs", "performance", "PRD-224-example.md"), "active");
    await writeFile(path.join(root, "docs", "PRDs", "done", "PRD-001-example.md"), "done");
    await writeFile(
      path.join(root, "docs", "PRDs", "BLOCKED", "requires-device", "PRD-002-example.md"),
      "blocked",
    );

    const report = await collectBudgets(root);

    expect(report.prdFiles).toBe(1);
  });

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

  it("should allow core to carry the asset MCP automatically", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "core");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { "threenative-asset-mcp": "0.4.0" }, name: "core" }),
    );
    const report = await collectBudgets(root);
    expect(budgetErrors(report)).toEqual([]);
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

  it("should fail when a workspace package other than core depends on the sculpt MCP", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "physics");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { "threenative-sculpt-mcp": "0.1.0" }, name: "physics" }),
    );
    const report = await collectBudgets(root);
    expect(budgetErrors(report).join("\n")).toContain("must stay external");
  });

  it("should keep external MCP source out of the real tree and dependencies owned by core", async () => {
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

  it("should fire the native runtime trigger past 100k lines without charging framework LOC", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "runtime-native", "src");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, "packages", "runtime-native", "package.json"), "{}");
    // A trailing newline adds a final empty split segment: repeat(100_000) counts 100_001 lines,
    // plus package.json's one line.
    await writeFile(path.join(directory, "runtime.cpp"), "x\n".repeat(100_000));
    const report = await collectBudgets(root);
    expect(report.frameworkLoc).toBe(0);
    expect(report.nativeRuntimeLoc).toBe(100_002);
    expect(budgetTriggers(report).join("\n")).toContain(
      "native runtime LOC review trigger: 100002 lines (trigger 100000",
    );
    expect(budgetErrors(report)).toEqual([]);
  });

  it("should stay silent at the pinned native trigger", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "runtime-native", "src");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, "packages", "runtime-native", "package.json"), "{}");
    // repeat(99_998) counts 99_999 lines; with package.json that is exactly the pinned trigger.
    await writeFile(path.join(directory, "runtime.cpp"), "x\n".repeat(99_998));
    const report = await collectBudgets(root);
    expect(report.nativeRuntimeLoc).toBe(100_000);
    expect(budgetTriggers(report)).toEqual([]);
    await expect(enforceBudgets(root)).resolves.toMatchObject({
      nativeRuntimeLoc: report.nativeRuntimeLoc,
    });
  });

  it("should reject a census row with no KEEP/DELETE verdict", async () => {
    const root = await fixtureRoot();
    await nativeFixture(root);
    await writeNativeCensus(root, [["`runtime.cpp`", 1]], 2, { verdict: "seems fine" });

    await expect(enforceBudgets(root)).rejects.toThrow(
      "native census row runtime.cpp has no KEEP/DELETE verdict",
    );
  });

  it("should reject a census row missing its owner, proof, or alternative", async () => {
    const root = await fixtureRoot();
    await nativeFixture(root);
    await writeNativeCensus(root, [["`runtime.cpp`", 1]], 2, { owner: "" });

    await expect(enforceBudgets(root)).rejects.toThrow(
      "native census row runtime.cpp is missing its owner, live proof or caller, or alternative considered",
    );
  });

  it("should reject a measured area with no census row", async () => {
    const root = await fixtureRoot();
    await nativeFixture(root);
    await writeNativeCensus(root, [["`runtime.cpp`", 1]], 1);

    await expect(enforceBudgets(root)).rejects.toThrow(
      "native census record has no row for counted area Root CMakeLists.txt",
    );
  });

  it("should reject a census row whose area left the runtime tree", async () => {
    const root = await fixtureRoot();
    await nativeFixture(root);
    await writeNativeCensus(
      root,
      [
        ["`runtime.cpp`", 1],
        ["Root `CMakeLists.txt`", 1],
        ["`deleted/`", 12],
      ],
      14,
    );

    await expect(enforceBudgets(root)).rejects.toThrow(
      "native census row deleted/ counts an area the runtime tree no longer has",
    );
  });

  it("should reject a census total that disagrees with its own rows", async () => {
    const root = await fixtureRoot();
    await nativeFixture(root);
    await writeNativeCensus(
      root,
      [
        ["`runtime.cpp`", 1],
        ["Root `CMakeLists.txt`", 1],
      ],
      3,
    );

    await expect(enforceBudgets(root)).rejects.toThrow(
      "native census total disagrees with its own area rows: rows sum to 2, total row says 3",
    );
  });

  it("should allow census line drift within the recorded tolerance", async () => {
    const root = await fixtureRoot();
    await nativeFixture(root);
    // The table judges both areas and stays internally consistent; only its numbers trail the
    // tree once runtime.cpp grows. The bounded tolerance leaves a short regeneration window.
    await writeNativeCensus(
      root,
      [
        ["`runtime.cpp`", 1],
        ["Root `CMakeLists.txt`", 1],
      ],
      2,
    );
    await writeFile(path.join(root, "packages", "runtime-native", "runtime.cpp"), "owned\nmore\n");

    await expect(enforceBudgets(root)).resolves.toMatchObject({ nativeRuntimeLoc: 4 });
    expect(await nativeCensusDrift(root)).toEqual([]);
  });

  it("fails budgets when census line drift exceeds the recorded tolerance", async () => {
    const root = await fixtureRoot();
    await nativeFixture(root);
    await writeNativeCensus(
      root,
      [
        ["`runtime.cpp`", 1],
        ["Root `CMakeLists.txt`", 1],
      ],
      2,
    );
    await writeFile(
      path.join(root, "packages", "runtime-native", "runtime.cpp"),
      "owned\nmore\nmore\nmore\nmore\nmore\nmore\n",
    );

    await expect(enforceBudgets(root)).rejects.toThrow(
      /native census drift: runtime\.cpp recorded 1, measured 8.*exceeds tolerance/u,
    );
  });

  it("should pass fixtures that carry no census record at all", async () => {
    const root = await fixtureRoot();
    await nativeFixture(root);

    await expect(enforceBudgets(root)).resolves.toMatchObject({ nativeRuntimeLoc: 2 });
  });

  it("should fail a real runtime tree with no native coverage record", async () => {
    const root = await fixtureRoot();
    await nativeFixture(root);
    await writeFile(
      path.join(root, "packages", "runtime-native", "package.json"),
      JSON.stringify({ name: "@threenative/runtime-native" }),
    );

    await expect(enforceBudgets(root)).rejects.toThrow("native coverage record is missing");
  });

  it("should not let the real tree silence the verdict gate by deleting the census record", async () => {
    const root = await fixtureRoot();
    await nativeFixture(root);
    const coreDirectory = path.join(root, "packages", "core");
    await mkdir(coreDirectory, { recursive: true });
    await writeFile(path.join(coreDirectory, "package.json"), "{}");

    await expect(enforceBudgets(root)).rejects.toThrow(
      "native census record is missing: the counted-area verdict gate has nothing to enforce",
    );
  });

  it("should pass a complete native census", async () => {
    const root = await fixtureRoot();
    await nativeFixture(root);
    await writeNativeCensus(
      root,
      [
        ["`runtime.cpp`", 1],
        ["Root `CMakeLists.txt`", 1],
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
