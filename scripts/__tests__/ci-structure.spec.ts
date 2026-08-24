import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repo = path.resolve(import.meta.dirname, "../..");
const workflows = [
  ".github/workflows/ci.yml",
  ".github/workflows/native-platforms.yml",
  ".github/workflows/native-release.yml",
  ".github/workflows/npm-release.yml",
] as const;

function jobSections(source: string): readonly [string, string][] {
  const jobs = source.slice(source.indexOf("\njobs:\n"));
  const matches = [...jobs.matchAll(/^ {2}([A-Za-z0-9_-]+):\n/gm)];
  return matches.map((match, index) => {
    const name = match[1];
    if (name === undefined) throw new Error("CI job heading did not include a name.");
    return [name, jobs.slice(match.index, matches[index + 1]?.index ?? jobs.length)];
  });
}

describe("CI pipeline structure", () => {
  it("bounds every runner job with an explicit timeout", async () => {
    for (const relative of workflows) {
      const source = await readFile(path.join(repo, relative), "utf8");
      for (const [job, section] of jobSections(source)) {
        if (section.includes("runs-on:"))
          expect(section, `${relative} ${job}`).toContain("timeout-minutes:");
      }
    }
  });

  it("keeps ordinary CI scoped to main and serializes release lanes", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const npm = await readFile(path.join(repo, ".github/workflows/npm-release.yml"), "utf8");
    const native = await readFile(path.join(repo, ".github/workflows/native-release.yml"), "utf8");
    expect(ci).toMatch(/push:\n\s+branches:\n\s+- main/u);
    expect(ci).toMatch(/pull_request:\n\s+branches:\n\s+- main/u);
    expect(ci).toContain("group: ci-${{ github.ref }}");
    expect(native).toContain("group: native-release-${{ github.ref }}");
    expect(native).toContain("gh run list --workflow ci.yml --commit");
    expect(npm).toContain('gh release view "runtime-native-v${native_version}"');
  });

  it("requires the matching native release for a publishing dispatch", async () => {
    const npm = await readFile(path.join(repo, ".github/workflows/npm-release.yml"), "utf8");
    const publish = jobSections(npm).find(([job]) => job === "publish")?.[1];
    expect(publish).toContain("if: github.event_name == 'push' || inputs.dry_run == false");
  });

  it("requires the matching native release to be published and ready", async () => {
    const npm = await readFile(path.join(repo, ".github/workflows/npm-release.yml"), "utf8");
    const publish = jobSections(npm).find(([job]) => job === "publish")?.[1];
    expect(publish).toContain("--json isDraft,isPrerelease");
    expect(publish).toContain(".isDraft == false and .isPrerelease == false");
    expect(publish).toMatch(/\$\{release_state\}" != "ready"/u);
  });

  it("requires native release CI to be a successful push on main", async () => {
    const native = await readFile(path.join(repo, ".github/workflows/native-release.yml"), "utf8");
    const gates = jobSections(native).find(([job]) => job === "gates")?.[1];
    expect(gates).toContain("--json status,conclusion,event,headBranch");
    expect(gates).toMatch(/\.event == "push"/u);
    expect(gates).toMatch(/\.headBranch == "main"/u);
  });

  it("requires the browser reference capture to pass", async () => {
    const native = await readFile(
      path.join(repo, ".github/workflows/native-platforms.yml"),
      "utf8",
    );
    expect(native).not.toMatch(/status -eq 0 \|\| status -eq 2/u);
    expect(native).toMatch(/test "\$status" -eq 0/u);
  });

  it("builds the framework example before a fail-closed bundle boundary check", async () => {
    const ci = await readFile(path.join(repo, ".github/workflows/ci.yml"), "utf8");
    const build = jobSections(ci).find(([job]) => job === "build")?.[1];
    if (build === undefined) throw new Error("CI build job was not found.");

    const exampleBuild = build.indexOf("pnpm --filter abyss-framework build");
    const boundaryCheck = build.indexOf("name: Enforce entity registry boundaries");
    expect(exampleBuild).toBeGreaterThanOrEqual(0);
    expect(boundaryCheck).toBeGreaterThan(exampleBuild);

    const bundleScan = build.slice(boundaryCheck);
    expect(bundleScan).not.toContain("! rg -n 'DebugOverlay|__THREENATIVE__'");
    expect(bundleScan).toMatch(
      /if rg -n 'DebugOverlay\|__THREENATIVE__' examples\/abyss-framework\/dist; then[\s\S]*?exit 1[\s\S]*?else[\s\S]*?status=\$\?[\s\S]*?if \[ "\$status" -ne 1 \][\s\S]*?exit "\$status"/u,
    );
  });

  it("keeps the repository-wide DebugOverlay CSS guard", async () => {
    const guard = await readFile(
      path.join(repo, "scripts/__tests__/debug-overlay-css.spec.ts"),
      "utf8",
    );
    expect(guard).toContain(
      'const PROJECT_ROOTS = ["examples", "packages/create-threenative/templates"];',
    );
    expect(guard).toContain("mountsOverlay");
    expect(guard).toContain("stylesOverlay");
    expect(guard).toContain("expect(unstyled).toEqual([])");
  });
});
