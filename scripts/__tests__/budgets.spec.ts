import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { budgetErrors, collectBudgets } from "../check-budgets";

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

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

  it("should fail when framework package count exceeds 8", async () => {
    const root = await fixtureRoot();
    for (let index = 0; index < 9; index += 1) {
      const directory = path.join(root, "packages", `package-${index}`);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "package.json"), "{}");
    }
    const report = await collectBudgets(root);
    expect(budgetErrors(report).join("\n")).toContain("framework package cap exceeded");
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

  it("should count native source and build files toward framework LOC", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "physics-native", "src");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, "packages", "physics-native", "package.json"), "{}");
    await writeFile(path.join(root, "packages", "physics-native", "CMakeLists.txt"), "x\n");
    await writeFile(path.join(directory, "binding.cpp"), "x\n".repeat(15_000));
    const report = await collectBudgets(root);
    expect(budgetErrors(report).join("\n")).toContain("framework LOC cap exceeded");
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
    expect(report.vendoredAssetMcp).toEqual(["asset-mcp"]);
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

  it("should keep the asset MCP external in the real tree", async () => {
    const report = await collectBudgets(process.cwd());
    expect(report.vendoredAssetMcp).toEqual([]);
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

  it("should fail when native runtime LOC exceeds 50000 and not charge framework LOC", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "runtime-native", "src");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, "packages", "runtime-native", "package.json"), "{}");
    await writeFile(path.join(directory, "runtime.cpp"), "x\n".repeat(50_000));
    const report = await collectBudgets(root);
    expect(report.frameworkLoc).toBe(0);
    expect(report.nativeRuntimeLoc).toBeGreaterThan(50_000);
    expect(budgetErrors(report).join("\n")).toContain("native runtime LOC cap exceeded");
  });

  it("should allow native runtime LOC below 50000", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "packages", "runtime-native", "src");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, "packages", "runtime-native", "package.json"), "{}");
    await writeFile(path.join(directory, "runtime.cpp"), "x\n".repeat(49_998));
    const report = await collectBudgets(root);
    expect(report.nativeRuntimeLoc).toBeLessThanOrEqual(50_000);
    expect(budgetErrors(report)).not.toContainEqual(
      expect.stringContaining("native runtime LOC cap exceeded"),
    );
  });

  it("should exclude only the ignored generated Android bundle from native LOC", async () => {
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
    await writeFile(path.join(directory, "bridge.js"), "owned\n");
    const report = await collectBudgets(root);
    expect(report.nativeRuntimeLoc).toBe(2);
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

  it("should keep the Mystral native runtime bounded in the real tree", async () => {
    const report = await collectBudgets(process.cwd());
    expect(report.vendoredNativeRuntime).toEqual([]);
    expect(report.trackedNativeThirdParty).toEqual([]);
    expect(report.nativeRuntimeLoc).toBeLessThanOrEqual(50_000);
  });

  it("should keep the real tree under every cap", async () => {
    const report = await collectBudgets(process.cwd());
    expect(budgetErrors(report)).toEqual([]);
  });
});
