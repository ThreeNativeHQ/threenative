import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  checkCapabilityDocs,
  collectPublicExports,
  findDocTagGaps,
  formatCapabilityReport,
  missingDocTags,
  validateInternalAllowlist,
} from "../check-capability-docs.js";

async function writePackage(
  root: string,
  directory: string,
  name: string,
  source: string,
): Promise<void> {
  const packageRoot = path.join(root, "packages", directory);
  await mkdir(path.join(packageRoot, "src"), { recursive: true });
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name }));
  await writeFile(path.join(packageRoot, "src", "index.ts"), source);
}

/** A two-package tree whose capabilities are written in every callable form TypeScript allows. */
async function arrowExportFixture(): Promise<string> {
  const root = await makeTempDir("threenative-capability-arrow-");
  const sources: Record<string, string> = {
    core: [
      "export const steerAroundWall = (): void => undefined;",
      "export const SnapToFloor = class { snap(): void {} };",
      "export const VERSION = 1;",
      "export interface INotACapability { readonly kind: string }",
    ].join("\n"),
    physics: [
      "export const holdWeapon = function attach(): void {};",
      "export function alsoCounted(): void {}",
    ].join("\n"),
  };
  for (const [packageName, source] of Object.entries(sources)) {
    const packageRoot = path.join(root, "packages", packageName);
    await mkdir(path.join(packageRoot, "src"), { recursive: true });
    await writeFile(path.join(packageRoot, "src", "index.ts"), `${source}\n`);
    await writeFile(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: `@threenative/${packageName}`,
        exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
      }),
    );
  }
  return root;
}

describe("capability documentation gate", () => {
  it("should fail an export whose doc tags are incomplete, naming symbol and tag", async () => {
    const root = await makeTempDir("threenative-capability-tags-");
    await writePackage(root, "core", "@threenative/core", "");
    const capabilities = [
      {
        entry: path.join(root, "packages/core/src/index.ts"),
        name: "HalfTagged",
        packageName: "@threenative/core" as const,
        subpath: "." as const,
      },
    ];
    const manifest = {
      entries: [
        {
          example: "",
          importPath: "@threenative/core",
          situations: ["test a half documented capability"],
          summary: "A capability with no example.",
          symbol: "HalfTagged",
        },
        {
          example: "",
          importPath: "@threenative/core",
          situations: [],
          summary: "Untagged",
          symbol: "Untagged",
        },
      ],
    };
    await mkdir(path.join(root, "packages/create-threenative"), { recursive: true });
    await writeFile(
      path.join(root, "packages/create-threenative/capabilities.json"),
      JSON.stringify(manifest),
    );

    const gaps = await findDocTagGaps(root, capabilities);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.missing).toEqual(["@example"]);
    expect(formatCapabilityReport({ exports: capabilities, gaps })).toContain("HalfTagged");
    expect(formatCapabilityReport({ exports: capabilities, gaps })).toContain("@example");
  });

  it("should demand every tag when an export is absent from the manifest", () => {
    expect(missingDocTags(undefined)).toEqual(["@example", "@situation", "summary"]);
  });

  it("should still honour INTERNAL_ALLOWLIST", async () => {
    const root = await makeTempDir("threenative-capability-allowlist-");
    await writePackage(root, "core", "@threenative/core", "");
    const capabilities = [
      {
        entry: path.join(root, "packages/core/src/index.ts"),
        name: "assertPortableState",
        packageName: "@threenative/core" as const,
        subpath: "./hot" as const,
      },
    ];
    await mkdir(path.join(root, "packages/create-threenative"), { recursive: true });
    await writeFile(
      path.join(root, "packages/create-threenative/capabilities.json"),
      JSON.stringify({ entries: [] }),
    );

    const gaps = await findDocTagGaps(root, capabilities);
    expect(gaps).toEqual([]);
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
  }, 15_000);

  it("should scan a capability written as an arrow const, not only declaration forms", async () => {
    // The gate's job is to make an undocumented capability a release defect. It counted only
    // `class`/`function` declarations, so `export const helper = () => {}` left the scan without a
    // word — the symbol simply stopped existing as far as documentation was concerned. A constant
    // that is not callable must still be ignored, or the gate starts demanding prose for every
    // exported number.
    const root = await arrowExportFixture();
    const capabilities = await collectPublicExports(root);
    const names = capabilities.map((capability) => capability.name);

    expect(names).toContain("steerAroundWall");
    expect(names).toContain("holdWeapon");
    expect(names).toContain("SnapToFloor");
    expect(names).not.toContain("VERSION");
  });

  it("should pass against the tagged engine tree", async () => {
    const report = await checkCapabilityDocs(process.cwd());

    expect(report.gaps).toEqual([]);
  });
});
