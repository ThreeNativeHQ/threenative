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
    expect(native).toMatch(/gh run list .*--workflow ci\.yml --commit/u);
    expect(npm).toContain('gh release view "runtime-native-v${native_version}"');
  });

  // A `gh` call infers its repository from a git checkout. A job that never checks out has
  // none, so `gh` dies with "failed to determine base repo" — and a gate that dies is a gate
  // that never asked its question. `native-release.yml`'s CI gate shipped that way and could
  // not be caught by anything: the workflow runs only on a `runtime-native-v*` tag, and the
  // first such tag ever pushed was the one that exposed it.
  // A `gh` call infers its repository from a git checkout. A job that never checks out has
  // none, so `gh` dies with "failed to determine base repo" -- and a gate that dies is a gate
  // that never asked its question. The native release's CI gate shipped that way and nothing
  // could have caught it: that workflow runs only on a `runtime-native-v*` tag, and the first
  // such tag ever pushed was the one that exposed it.
  it("passes an explicit repository to every gh call in a job that never checks out", async () => {
    const offenders: string[] = [];
    for (const relative of workflows) {
      const source = await readFile(path.join(repo, relative), "utf8");
      for (const [job, section] of jobSections(source)) {
        if (section.includes("uses: actions/checkout")) continue;
        // Read whole commands, not lines: a flag may sit on a continuation line, and a `#`
        // line is prose. Both were false readings of this same section.
        const lines = section.split("\n").filter((line) => !/^\s*#/u.test(line));
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? "";
          if (!/(?:^|[\s"'`(|&;$])gh\s+(?:api|run|release|pr|issue|workflow|cache)\b/u.test(line))
            continue;
          let command = line;
          for (let next = index + 1; next < lines.length; next += 1) {
            const continuation = lines[next] ?? "";
            const continued =
              command.trimEnd().endsWith("\\") || /^\s*-{1,2}\w/u.test(continuation);
            if (!continued) break;
            command += ` ${continuation}`;
          }
          if (command.includes("--repo")) continue;
          offenders.push(`${relative} ${job}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
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
    expect(bundleScan).toContain("run: pnpm exec tsx scripts/check-core-boundary.ts");
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
