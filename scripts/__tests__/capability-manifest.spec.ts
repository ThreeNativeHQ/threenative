import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  buildCapabilityManifest,
  checkCapabilityManifest,
  validateCapabilityAllowlist,
  writeCapabilityManifest,
} from "../build-capability-manifest.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function writePackage(
  root: string,
  directory: string,
  name: string,
  source: string,
  exports = { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
): Promise<void> {
  const packageRoot = path.join(root, "packages", directory);
  await mkdir(path.join(packageRoot, "src"), { recursive: true });
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ exports, name }));
  await writeFile(path.join(packageRoot, "src", "index.ts"), source);
}

const documentedClass = [
  "/**",
  " * A fixture capability.",
  " * @situation test a documented capability",
  " * @constraint use it from the fixture",
  " * @example const capability = new DocumentedCapability();",
  " */",
  "export class DocumentedCapability {}",
  "",
].join("\n");

describe("capability manifest generator", () => {
  it("includes subpath exports with the literal import path", async () => {
    const root = await makeTempDir("threenative-capability-subpath-");
    temporaryRoots.push(root);
    await writePackage(root, "core", "@threenative/core", documentedClass);
    const physicsRoot = path.join(root, "packages", "physics");
    await mkdir(path.join(physicsRoot, "src", "navigation"), { recursive: true });
    await writeFile(
      path.join(physicsRoot, "package.json"),
      JSON.stringify({
        exports: {
          "./navigation": {
            types: "./dist/navigation/index.d.ts",
            import: "./dist/navigation/index.js",
          },
        },
        name: "@threenative/physics",
      }),
    );
    await writeFile(
      path.join(physicsRoot, "src", "navigation", "index.ts"),
      [
        "/**",
        " * A navigation fixture.",
        " * @situation enemy walks around a wall",
        " * @example const agent = new NavigationAgent3D();",
        " */",
        "export class NavigationAgent3D {}",
        "",
      ].join("\n"),
    );

    const manifest = buildCapabilityManifest(root);
    expect(manifest.entries).toContainEqual(
      expect.objectContaining({
        importPath: "@threenative/physics/navigation",
        symbol: "NavigationAgent3D",
      }),
    );
  });

  it("fails closed and names every untagged public class or function", async () => {
    const root = await makeTempDir("threenative-capability-missing-situation-");
    temporaryRoots.push(root);
    await writePackage(
      root,
      "core",
      "@threenative/core",
      `${documentedClass}\nexport function MissingSituation(): void {}\n`,
    );

    expect(() => buildCapabilityManifest(root)).toThrow(/MissingSituation/u);
  });

  it("rejects an allowlist entry with an empty reason", () => {
    expect(() =>
      validateCapabilityAllowlist([{ package: "@threenative/core", reason: "", symbol: "Hidden" }]),
    ).toThrow(/non-empty.*reason/u);
  });

  it("writes and checks a generated manifest instead of accepting a stale copy", async () => {
    const root = await makeTempDir("threenative-capability-freshness-");
    temporaryRoots.push(root);
    await writePackage(root, "core", "@threenative/core", documentedClass);
    const generated = await writeCapabilityManifest(root);
    await expect(checkCapabilityManifest(root)).resolves.toMatchObject({
      entries: generated.entries,
    });

    const file = path.join(root, "packages/create-threenative/capabilities.json");
    await writeFile(file, `${await readFile(file, "utf8")}\n`);
    await expect(checkCapabilityManifest(root)).rejects.toThrow(/stale/u);
  });

  it("fails loudly with the manifest path when the committed copy is missing", async () => {
    const root = await makeTempDir("threenative-capability-missing-manifest-");
    temporaryRoots.push(root);
    await writePackage(root, "core", "@threenative/core", documentedClass);

    await expect(checkCapabilityManifest(root)).rejects.toThrow(
      path.join(root, "packages/create-threenative/capabilities.json"),
    );
  });

  it("proves the committed manifest contains the navigation regression entry", async () => {
    const manifest = await checkCapabilityManifest(process.cwd());
    expect(manifest.entries.length).toBeGreaterThan(0);
    expect(manifest.entries).toContainEqual(
      expect.objectContaining({
        importPath: "@threenative/physics/navigation",
        symbol: "NavigationAgent3D",
      }),
    );
  });

  it("carries @supersedes into the manifest entry as a source construct", async () => {
    const root = await makeTempDir("threenative-capability-supersedes-");
    temporaryRoots.push(root);
    await writePackage(
      root,
      "core",
      "@threenative/core",
      [
        "/**",
        " * A fixture capability that replaces a raw three construct.",
        " * @situation test what the ray hit",
        " * @supersedes new Raycaster(",
        " * @example const capability = new DocumentedCapability();",
        " */",
        "export class DocumentedCapability {}",
        "",
      ].join("\n"),
    );

    const manifest = buildCapabilityManifest(root);
    expect(manifest.entries).toContainEqual(
      expect.objectContaining({
        symbol: "DocumentedCapability",
        supersedes: ["new Raycaster("],
      }),
    );
  });

  it("leaves supersedes empty rather than undefined when untagged", async () => {
    const root = await makeTempDir("threenative-capability-no-supersedes-");
    temporaryRoots.push(root);
    await writePackage(root, "core", "@threenative/core", documentedClass);

    const manifest = buildCapabilityManifest(root);
    const entry = manifest.entries.find((candidate) => candidate.symbol === "DocumentedCapability");
    expect(entry?.supersedes).toEqual([]);
  });
});
