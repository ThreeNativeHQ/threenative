import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../test-support/temp-dir.js";
const moduleUrl = new URL("../ci-change-scope.mjs", import.meta.url).href;
const { TEMPLATE_NAMES, changedTemplates, classify, selectionPlan, validatePlan } = await import(
  moduleUrl
);
function fixture() {
  const root = makeTempDirSync("ci-template-scope-");
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  writeFileSync(path.join(root, "README.md"), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  return {
    root,
    git,
    base,
    change(file: string) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), "changed\n");
      git("add", ".");
      git("commit", "-qm", "change");
      return git("rev-parse", "HEAD");
    },
  };
}
describe("impact-driven template coverage", () => {
  it.each(["pull_request", "merge_group"])(
    "selects only an exact changed kit for %s",
    (eventName) => {
      const f = fixture();
      try {
        const head = f.change("packages/create-threenative/templates/shooter/src/game.ts");
        const plan = classify({
          root: f.root,
          base: f.base,
          head,
          candidateSha: head,
          target: "develop",
          eventName,
        });
        expect(plan.selection).toBe("template");
        expect(plan.templateMatrix.template).toEqual(["shooter"]);
        expect(plan.goldenMatrix.template).toEqual(["shooter"]);
        for (const name of ["test-native", "native-platforms", "test-browser", "benchmark"])
          expect(plan.jobs[name].required).toBe(false);
        for (const name of [
          "build-artifacts",
          "template-nonvisual",
          "golden-path-template",
          "supply-chain",
        ])
          expect(plan.jobs[name].required).toBe(true);
        expect(validatePlan(plan)).toEqual(plan);
      } finally {
        rmSync(f.root, { recursive: true, force: true });
      }
    },
  );
  it.each(["pull_request", "merge_group"])("keeps CI and docs narrow on %s", (eventName) => {
    for (const [file, selection] of [
      ["docs/PRDs/inert.md", "prose"],
      ["scripts/ci-required.mjs", "ci"],
    ] as const) {
      const f = fixture();
      try {
        const head = f.change(file);
        const plan = classify({
          root: f.root,
          base: f.base,
          head,
          candidateSha: head,
          target: "develop",
          eventName,
        });
        expect(plan.selection).toBe(selection);
        expect(plan.jobs["template-nonvisual"].required).toBe(false);
        expect(plan.jobs["test-native"].required).toBe(false);
      } finally {
        rmSync(f.root, { recursive: true, force: true });
      }
    }
  });
  it.each([
    "packages/create-threenative/src/scaffold.ts",
    "scripts/stamp-template-render.ts",
    "packages/core/src/index.ts",
    "packages/create-threenative/templates/shooter-lookalike/src/main.ts",
    "unknown/meaningful.ts",
  ])("retains full fanout for shared or unknown %s", (file) => {
    const f = fixture();
    try {
      const head = f.change(file);
      const plan = classify({
        root: f.root,
        base: f.base,
        head,
        candidateSha: head,
        target: "develop",
        eventName: "pull_request",
      });
      expect(plan.selection).toBe("full");
      expect(plan.templateMatrix.template).toEqual(TEMPLATE_NAMES);
      if (file.startsWith("packages/core/")) expect(plan.jobs["test-native"].required).toBe(true);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
  it("normalizes the queue target and includes every constituent template change", () => {
    const f = fixture();
    try {
      f.change("packages/create-threenative/templates/shooter/src/x.ts");
      const head = f.change("packages/create-threenative/templates/snow/src/y.ts");
      const plan = classify({
        root: f.root,
        base: f.base,
        head,
        candidateSha: head,
        target: "refs/heads/develop",
        eventName: "merge_group",
      });
      expect(plan.selection).toBe("template");
      expect(plan.templateMatrix.template).toEqual(["shooter", "snow"]);
      expect(plan.goldenMatrix.template).toEqual(["shooter"]);
      expect(plan.unitMatrix.shard).toEqual(["1/1"]);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
  it("skips inert template Markdown and preserves full main qualification", () => {
    const f = fixture();
    try {
      const head = f.change("packages/create-threenative/templates/shooter/README.md");
      for (const target of ["develop", "main"]) {
        const plan = classify({
          root: f.root,
          base: f.base,
          head,
          candidateSha: head,
          target,
          eventName: "merge_group",
        });
        expect(plan.selection).toBe(target === "main" ? "full" : "prose");
      }
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
  it("covers all kit identities without duplicate matrix entries and rejects tampering", () => {
    const full = selectionPlan("full", "audit", [], "a".repeat(40), true, 0, "main");
    expect(full.templateMatrix.template).toEqual(TEMPLATE_NAMES);
    expect(new Set(TEMPLATE_NAMES).size).toBe(TEMPLATE_NAMES.length);
    expect(() => validatePlan({ ...full, templateMatrix: { template: ["starter"] } })).toThrow();
    expect(
      changedTemplates([
        "packages/create-threenative/templates/starter/src/x.ts",
        "packages/create-threenative/template-playtests/shooter/a.playtest.json",
      ]),
    ).toEqual(["shooter", "starter"]);
  });
  it("rejects an unrelated or unresolved merge-group source", () => {
    const f = fixture();
    try {
      const head = f.change("docs/x.md");
      for (const options of [
        { base: "unknown", head },
        { base: f.base, head: f.base },
      ] as const) {
        expect(
          classify({
            root: f.root,
            ...options,
            candidateSha: head,
            target: "develop",
            eventName: "merge_group",
          }).selection,
        ).toBe("full");
      }
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
});
