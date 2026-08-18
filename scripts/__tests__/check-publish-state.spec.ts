import fs from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  type IRegistryFacts,
  RELEASE_WORKFLOW,
  type RegistryLookup,
  checkPublishState,
  missingPackageReadmes,
  publishSet,
  satisfiesRange,
  staleInternalPeerRanges,
  unresolvedTemplateSpecifiers,
} from "../check-publish-state.js";

const roots: string[] = [];

const PUBLISHED = "2026-08-09T07:32:33.145Z";

const PACKAGES = [
  { dir: "core", name: "@threenative/core", version: "0.1.0" },
  { dir: "create-threenative", name: "create-threenative", version: "0.1.0" },
] as const;

function write(root: string, relative: string, contents: string): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

async function fixture(): Promise<string> {
  const root = await makeTempDir("threenative-publish-check-");
  roots.push(root);
  for (const item of PACKAGES) {
    write(
      root,
      `packages/${item.dir}/package.json`,
      JSON.stringify({
        files: item.dir === "core" ? ["dist", "README.md"] : undefined,
        name: item.name,
        version: item.version,
      }),
    );
    write(root, `packages/${item.dir}/README.md`, `# ${item.name}\n`);
    write(root, `packages/${item.dir}/src/index.ts`, "export const x = 1;\n");
  }
  write(
    root,
    "packages/create-threenative/templates/starter/package.json",
    JSON.stringify({ dependencies: { "@threenative/core": "0.1.0", three: "0.185.1" } }),
  );
  write(root, RELEASE_WORKFLOW, PACKAGES.map((item) => `#   ${item.name}`).join("\n"));
  return root;
}

/** Everything published, at a version the workspace has already moved past. */
const everythingPublished: RegistryLookup = (name) => ({
  published: PUBLISHED,
  state: "present",
  version: PACKAGES.find((item) => item.name === name)?.version ?? "0.0.0",
});

describe("pnpm publish:check", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it("passes when every version moved past what the registry holds", async () => {
    const root = await fixture();
    const report = checkPublishState({
      lookup: (name) => ({ ...everythingPublished(name), version: "0.0.9" }),
      repo: root,
      sourceCommits: () => 12,
    });
    expect(report.findings).toEqual([]);
    expect(report.exitCode).toBe(0);
  });

  it("fails when a local version equals the published version and the source has moved", async () => {
    const root = await fixture();
    const report = checkPublishState({
      lookup: everythingPublished,
      repo: root,
      sourceCommits: () => 144,
    });
    expect(report.exitCode).toBe(1);
    expect(report.findings.map((finding) => finding.package)).toContain("@threenative/core");
    expect(report.findings[0]?.detail).toMatch(/144 commit\(s\) since.*bump it/u);
  });

  it("passes a version that equals the published one when the source has not moved", async () => {
    // Republishing an identical tree is not the defect. Publishing a *changed* tree under a
    // version string the registry already serves is, because npm will refuse it.
    const root = await fixture();
    const report = checkPublishState({
      lookup: everythingPublished,
      repo: root,
      sourceCommits: () => 0,
    });
    expect(report.findings).toEqual([]);
    expect(report.exitCode).toBe(0);
  });

  it("does not fail a package that was never published", async () => {
    // A 404 is what this whole lane exists to fix; refusing to publish because of it would make
    // the preflight unsatisfiable.
    const root = await fixture();
    const report = checkPublishState({
      lookup: (name) =>
        name === "create-threenative"
          ? ({ state: "absent" } satisfies IRegistryFacts)
          : { ...everythingPublished(name), version: "0.0.9" },
      repo: root,
      sourceCommits: () => 5,
    });
    expect(report.findings).toEqual([]);
  });

  it("fails when a publishable package is missing from the release workflow's publish set", async () => {
    const root = await fixture();
    write(root, RELEASE_WORKFLOW, "#   @threenative/core\n");
    const report = checkPublishState({
      lookup: (name) => ({ ...everythingPublished(name), version: "0.0.9" }),
      repo: root,
      sourceCommits: () => 1,
    });
    expect(report.exitCode).toBe(1);
    expect(report.findings[0]?.detail).toMatch(
      /create-threenative is publishable but is not named/u,
    );
  });

  it("fails when a publishable package has no README", async () => {
    const root = await fixture();
    await rm(path.join(root, "packages/core/README.md"));
    const findings = missingPackageReadmes(publishSet(root));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ package: "@threenative/core", severity: "fail" });
    expect(findings[0]?.detail).toMatch(/missing README\.md/u);
  });

  it("fails when a package's explicit files list excludes its README", async () => {
    const root = await fixture();
    write(
      root,
      "packages/core/package.json",
      JSON.stringify({ files: ["dist"], name: "@threenative/core", version: "0.1.0" }),
    );
    const findings = missingPackageReadmes(publishSet(root));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ package: "@threenative/core", severity: "fail" });
    expect(findings[0]?.detail).toMatch(/files list.*dist.*README\.md/u);
  });

  it("accepts an existing README with no files list or an explicit README entry", async () => {
    const root = await fixture();
    expect(missingPackageReadmes(publishSet(root))).toEqual([]);
  });

  it("blocks, never passes, when the release workflow does not exist", async () => {
    const root = await fixture();
    await rm(path.join(root, RELEASE_WORKFLOW));
    const report = checkPublishState({
      lookup: (name) => ({ ...everythingPublished(name), version: "0.0.9" }),
      repo: root,
      sourceCommits: () => 1,
    });
    expect(report.exitCode).toBe(2);
    expect(report.findings[0]?.severity).toBe("blocked");
  });

  it("blocks, never passes, when the registry cannot be reached", async () => {
    const root = await fixture();
    const report = checkPublishState({
      lookup: () => ({ state: "unreachable" }),
      repo: root,
      sourceCommits: () => 1,
    });
    expect(report.exitCode).toBe(2);
    expect(report.findings.every((finding) => finding.severity === "blocked")).toBe(true);
  });

  it("fails when a catalog: specifier survives into a template manifest", async () => {
    const root = await fixture();
    write(
      root,
      "packages/create-threenative/templates/starter/package.json",
      JSON.stringify({ dependencies: { "@threenative/core": "catalog:" } }),
    );
    const findings = unresolvedTemplateSpecifiers(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toMatch(/no meaning outside this workspace/u);
  });

  it("fails when a workspace: specifier survives into a template manifest", async () => {
    const root = await fixture();
    write(
      root,
      "packages/create-threenative/templates/starter/package.json",
      JSON.stringify({ devDependencies: { "@threenative/playtest": "workspace:*" } }),
    );
    expect(unresolvedTemplateSpecifiers(root)).toHaveLength(1);
  });

  it("fails when a peer range on a sibling excludes the version shipping beside it", async () => {
    // @threenative/physics@0.2.0 and @threenative/ui@0.2.0 shipped declaring
    // @threenative/core@">=0.1.0 <0.2.0", so npm install in a scaffolded project died with
    // ERESOLVE and no stranger could build anything. The range is hand-maintained and had to
    // move with the release; nothing made it, so this does.
    const root = await fixture();
    write(
      root,
      "packages/core/package.json",
      JSON.stringify({
        name: "@threenative/core",
        peerDependencies: { "create-threenative": ">=0.1.0 <0.2.0" },
        version: "0.2.0",
      }),
    );
    write(
      root,
      "packages/create-threenative/package.json",
      JSON.stringify({ name: "create-threenative", version: "0.2.0" }),
    );
    const findings = staleInternalPeerRanges(publishSet(root));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toMatch(/excludes the 0\.2\.0 being published beside it/u);
  });

  it("accepts a peer range that admits the sibling version", async () => {
    const root = await fixture();
    write(
      root,
      "packages/core/package.json",
      JSON.stringify({
        name: "@threenative/core",
        peerDependencies: { "create-threenative": ">=0.2.0 <0.3.0" },
        version: "0.2.0",
      }),
    );
    write(
      root,
      "packages/create-threenative/package.json",
      JSON.stringify({ name: "create-threenative", version: "0.2.0" }),
    );
    expect(staleInternalPeerRanges(publishSet(root))).toEqual([]);
  });

  it("evaluates the range forms this repository writes, and refuses ones it cannot read", () => {
    expect(satisfiesRange("0.2.0", ">=0.1.0 <0.2.0")).toBe(false);
    expect(satisfiesRange("0.2.0", ">=0.2.0 <0.3.0")).toBe(true);
    expect(satisfiesRange("0.2.1", "^0.2.0")).toBe(true);
    expect(satisfiesRange("0.3.0", "^0.2.0")).toBe(false);
    expect(satisfiesRange("0.2.1", "~0.2.0")).toBe(true);
    expect(satisfiesRange("0.2.0", "0.2.0")).toBe(true);
    expect(satisfiesRange("0.2.0", "*")).toBe(true);
    // Guessing at a range it cannot parse is how a preflight reports green while asserting
    // nothing, so an unreadable range is an error rather than an optimistic true.
    expect(() => satisfiesRange("0.2.0", "1.x || >=2")).toThrow(/TN_PUBLISH_RANGE_UNREADABLE/u);
  });

  it("refuses an empty publish set rather than reporting nothing to do", async () => {
    const root = await makeTempDir("threenative-publish-empty-");
    roots.push(root);
    fs.mkdirSync(path.join(root, "packages"), { recursive: true });
    expect(() => publishSet(root)).toThrow(/TN_PUBLISH_EMPTY_SET/u);
  });

  it("skips private packages, which are not shipped", async () => {
    const root = await fixture();
    write(
      root,
      "packages/internal/package.json",
      JSON.stringify({ name: "@threenative/internal", private: true, version: "9.9.9" }),
    );
    expect(publishSet(root).map((item) => item.name)).toEqual([
      "@threenative/core",
      "create-threenative",
    ]);
  });
});
