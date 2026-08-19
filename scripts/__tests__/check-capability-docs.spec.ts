import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  checkCapabilityDocs,
  collectPublicExports,
  findMissingCapabilities,
  formatCapabilityReport,
  validateInternalAllowlist,
} from "../check-capability-docs.js";

const execFileAsync = promisify(execFile);

async function missingCapabilityBudgetFixture(): Promise<string> {
  const root = await makeTempDir("threenative-capability-docs-");
  const packagesRoot = path.join(root, "packages");
  await mkdir(packagesRoot, { recursive: true });
  for (const packageName of ["core", "physics", "playtest"]) {
    await symlink(
      path.resolve("packages", packageName),
      path.join(packagesRoot, packageName),
      "dir",
    );
  }

  const sourceTemplatesRoot = path.resolve("packages/create-threenative/templates");
  const fixtureTemplatesRoot = path.join(packagesRoot, "create-threenative", "templates");
  await mkdir(fixtureTemplatesRoot, { recursive: true });
  const templates = await readdir(sourceTemplatesRoot, { withFileTypes: true });
  for (const template of templates.filter((entry) => entry.isDirectory())) {
    const destination = path.join(fixtureTemplatesRoot, template.name);
    await mkdir(destination, { recursive: true });
    const content =
      template.name === "minimal"
        ? ""
        : await readFile(path.join(sourceTemplatesRoot, template.name, "AGENTS.md"), "utf8");
    await writeFile(path.join(destination, "AGENTS.md"), content);
  }

  await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
  const fixtureScriptsRoot = path.join(root, "scripts");
  await mkdir(fixtureScriptsRoot, { recursive: true });
  for (const scriptName of ["check-capability-docs.ts", "check-budgets.ts"]) {
    await writeFile(
      path.join(fixtureScriptsRoot, scriptName),
      await readFile(path.resolve("scripts", scriptName), "utf8"),
    );
  }
  await writeFile(
    path.join(root, "package.json"),
    await readFile(path.resolve("package.json"), "utf8"),
  );
  return root;
}

describe("capability documentation gate", () => {
  it("should make root budgets exit nonzero when a template document is missing", async () => {
    const root = await missingCapabilityBudgetFixture();

    let failure: { code?: number; stderr?: string; stdout?: string } | undefined;
    try {
      await execFileAsync("pnpm", ["run", "budgets"], {
        cwd: root,
        encoding: "utf8",
      });
    } catch (error) {
      failure = error as { code?: number; stderr?: string; stdout?: string };
    }

    expect(failure).toBeDefined();
    expect(failure?.code).not.toBe(0);
    expect(`${failure?.stdout ?? ""}\n${failure?.stderr ?? ""}`).toContain(
      "CAPABILITY_DOCS_MISSING",
    );
  }, 30_000);

  it("should fail when a public export is missing from a template document", async () => {
    const capabilities = await collectPublicExports(process.cwd());
    const missing = findMissingCapabilities(
      capabilities.filter((capability) => capability.name === "NavigationAgent3D"),
      [{ path: "packages/create-threenative/templates/minimal/AGENTS.md", content: "" }],
      {},
    );

    expect(missing).toHaveLength(1);
    expect(formatCapabilityReport({ documents: [], exports: capabilities, missing })).toContain(
      "NavigationAgent3D",
    );
  });

  it("should fail when an INTERNAL allowlist entry has an empty reason", () => {
    expect(() => validateInternalAllowlist({ "@threenative/core#Hidden": "" })).toThrow(
      "CAPABILITY_DOCS_INTERNAL_ALLOWLIST_INVALID",
    );
  });

  it("should scan subpath exports, not only the main package index", async () => {
    const capabilities = await collectPublicExports(process.cwd());

    expect(capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "NavigationAgent3D",
          packageName: "@threenative/physics",
          subpath: "./navigation",
        }),
      ]),
    );
  });

  it("should pass against the repaired scaffold documents", async () => {
    const report = await checkCapabilityDocs(process.cwd());

    expect(report.missing).toEqual([]);
  });
});
