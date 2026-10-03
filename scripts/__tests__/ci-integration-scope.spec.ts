import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../test-support/temp-dir.js";
const url = new URL("../ci-integration-scope.mjs", import.meta.url).href;
const { integrationSelection, integrationGitSelection } = await import(url);
const workflow = readFileSync(
  new URL("../../.github/workflows/integration.yml", import.meta.url),
  "utf8",
);
function select(after: string, files = [".github/workflows/integration.yml"]) {
  return integrationSelection({ before: workflow, after, files }).lanes;
}
const none = Object.fromEntries(
  [
    ...workflow.matchAll(
      /^ {6}([a-z][a-z-]*): \$\{\{ steps\.filter\.outputs\.[a-z][a-z-]* \}\}$/gmu,
    ),
  ].map((match) => [match[1], false]),
);
const all = Object.fromEntries(Object.keys(none).map((key) => [key, true]));
describe("integration work applies to the changed source", () => {
  it("runs exposure alone for an exposure workflow step edit", () => {
    expect(select(workflow.replace("pnpm test:tone", "pnpm test:tone --example"))).toEqual({
      ...none,
      tone: true,
    });
  });
  it("selects the owning fluid root when only its native dependent changes", () => {
    expect(
      select(workflow.replace("Linux native fluid correctness", "Linux native fluid verification")),
    ).toEqual({ ...none, "fluid-particles": true });
  });
  it("selects decals and its native dependent for a decal job edit", () => {
    expect(
      select(workflow.replace("Linux native decal correctness", "Linux native decal verification")),
    ).toEqual({ ...none, decals: true });
  });
  it("selects just the lane whose source filter changes", () => {
    expect(
      select(
        workflow.replace("csg ^examples/integrations/csg/", "csg ^examples/integrations/csg-new/"),
      ),
    ).toEqual({ ...none, csg: true });
  });
  it("unions source impact with workflow impact", () => {
    expect(
      select(workflow.replace("pnpm test:tone", "pnpm test:tone --example"), [
        ".github/workflows/integration.yml",
        "packages/core/src/fluid-particles.ts",
      ]),
    ).toEqual({ ...none, tone: true, "fluid-particles": true });
  });
  it("retains both native integration consumers for native host changes", () => {
    expect(select(workflow, ["packages/runtime-native/src/main.cpp"])).toEqual({
      ...none,
      decals: true,
      "fluid-particles": true,
    });
  });
  it("retains shared playtest and workspace action consumers", () => {
    expect(select(workflow, ["packages/playtest/src/capture.ts"])).toEqual({
      ...none,
      "world-capture": true,
      decals: true,
      tone: true,
      "fluid-particles": true,
    });
    expect(select(workflow, [".github/actions/workspace-dist/action.yml"])).toEqual({
      ...none,
      decals: true,
      "fluid-particles": true,
    });
    expect(select(workflow, [".github/actions/playwright-chromium/action.yml"])).toEqual({
      ...none,
      "world-capture": true,
      decals: true,
      tone: true,
      "fluid-particles": true,
    });
  });
  it("retains every rendering consumer of the shared display harness", () => {
    expect(select(workflow, ["scripts/xvfb.sh"])).toEqual({
      ...none,
      decals: true,
      tone: true,
      "fluid-particles": true,
    });
  });
  it("retains exposure coverage for each canonical or generated exposure module", () => {
    for (const name of [
      "autoExposure",
      "exposureGraph",
      "exposureReadback",
      "exposureSettings",
      "worldEnvironment",
    ]) {
      expect(
        select(workflow, [`packages/create-threenative/templates/shooter/src/render/${name}.ts`])
          .tone,
      ).toBe(true);
      expect(
        select(workflow, [`packages/create-threenative/template-assets/${name}.ts`]).tone,
      ).toBe(true);
    }
  });
  it("does not run product integration for unrelated CI or inert docs", () => {
    expect(
      select(workflow, ["scripts/__tests__/ci-template-selection.spec.ts", "docs/README.md"]),
    ).toEqual(none);
  });
  it.each([
    ["trigger", "types: [opened, synchronize, reopened, ready_for_review]", "types: [opened]"],
    ["permissions", "contents: read", "contents: write"],
    ["concurrency", "cancel-in-progress: true", "cancel-in-progress: false"],
    ["shared paths job", "timeout-minutes: 5", "timeout-minutes: 6"],
    ["entry cross-lane dependency", "needs: paths", "needs: [paths,csg]"],
    ["entry self-cycle", "needs: paths", "needs: [paths,tone]"],
    ["unknown dependency", "needs: [fluid-collision]", "needs: [missing-job]"],
    ["cycle", "needs: [fluid-collision]", "needs: [fluid-collision-native]"],
    ["ambiguous needs", "needs: [fluid-collision]", "needs: ${{ inputs.jobs }}"],
    ["unknown shape", "  tone:\n", "  tone: &alias\n"],
  ])("fails closed for %s edits", (_name, before, after) => {
    expect(select(workflow.replace(before, after))).toEqual(all);
  });
  it.each(["\n", "    # output comment\n"])(
    "inventories outputs beyond blank/comment lines: %s",
    (prefix) => {
      expect(
        select(
          workflow.replace(
            "      tone: ${{ steps.filter.outputs.tone }}",
            `${prefix}      tone: \${{ steps.filter.outputs.tone }}`,
          ),
        ),
      ).toEqual(all);
    },
  );
  it("fails visibly if a declared lane loses its output", () => {
    expect(() =>
      select(workflow.replace("      tone: ${{ steps.filter.outputs.tone }}\n", "")),
    ).toThrow("incomplete integration output inventory");
  });
  it.each([
    "tone: ${{ steps.filter.outputs.tone || 'false' }}",
    "tone: ${{ steps.filter.outputs.unknown }}",
    "tone: 'false'",
    "tone: ${{ steps.filter.outputs['tone'] }}",
  ])("fails visibly instead of skipping an unsupported output: %s", (expression) => {
    expect(() =>
      select(workflow.replace("tone: ${{ steps.filter.outputs.tone }}", expression)),
    ).toThrow("unsupported integration output expression");
  });
  it("fails closed when the shared selector changes", () => {
    expect(select(workflow, ["scripts/ci-integration-scope.mjs"])).toEqual(all);
  });
});

describe("integration exact Git source selection", () => {
  it("retains rename endpoints and rejects missing/mismatched candidate identities", () => {
    const root = makeTempDirSync("ci-integration-git-");
    const cwd = process.cwd();
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    };
    try {
      git("init", "-q");
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "test");
      mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
      writeFileSync(path.join(root, ".github/workflows/integration.yml"), workflow);
      mkdirSync(path.join(root, "examples/integrations/csg"), { recursive: true });
      writeFileSync(path.join(root, "examples/integrations/csg/removed.ts"), "source");
      git("add", ".");
      git("commit", "-qm", "base");
      const base = git("rev-parse", "HEAD");
      git("mv", "examples/integrations/csg/removed.ts", "unrelated.ts");
      git("commit", "-qm", "rename");
      const head = git("rev-parse", "HEAD");
      process.chdir(root);
      expect(integrationGitSelection(base, head).lanes).toEqual({ ...none, csg: true });
      expect(integrationGitSelection(undefined, head).lanes).toEqual(all);
      git("checkout", "-q", base);
      expect(integrationGitSelection(base, head).lanes).toEqual(all);
    } finally {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("merged world capture lane relevance", () => {
  it("retains its exact runtime source filter", () => {
    expect(Object.keys(none)).toContain("world-capture");
    for (const file of [
      "packages/core/src/world-cells.ts",
      "packages/assets/src/index.ts",
      "scripts/verify-world-capture.ts",
    ]) {
      expect(select(workflow, [file])).toEqual({ ...none, "world-capture": true });
    }
  });
  it("selects world capture alone for its workflow job edit", () => {
    expect(
      select(
        workflow.replace(
          "pnpm exec tsx scripts/verify-world-capture.ts",
          "pnpm exec tsx scripts/verify-world-capture.ts --example",
        ),
      ),
    ).toEqual({ ...none, "world-capture": true });
  });
  it("selects world capture alone for its source-filter edit", () => {
    expect(
      select(
        workflow.replace(
          "world-capture ^packages/core/src/world",
          "world-capture ^packages/core/src/new-world",
        ),
      ),
    ).toEqual({ ...none, "world-capture": true });
  });
  it("selects its owning lane for a transitive dependent edit", () => {
    const before = `${workflow}\n  world-dependent:\n    needs: [capture]\n    name: old proof\n`;
    const after = before.replace("name: old proof", "name: updated proof");
    expect(
      integrationSelection({ files: [".github/workflows/integration.yml"], before, after }).lanes,
    ).toEqual({ ...none, "world-capture": true });
  });
  it("fails closed for an unknown world dependency shape", () => {
    const after = workflow.replace(
      /( {2}capture:\n[\s\S]*?) {4}needs: paths/u,
      "$1    needs: [missing-world-job]",
    );
    expect(select(after)).toEqual(all);
  });
});
