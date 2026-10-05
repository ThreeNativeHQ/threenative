import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../test-support/temp-dir.js";

const { classify, selectionPlan, TEMPLATE_NAMES, validatePlan } = await import(
  new URL("../ci-change-scope.mjs", import.meta.url).href
);
const gate = new URL("../ci-required.mjs", import.meta.url).pathname;

function fixture(file: string) {
  const root = makeTempDirSync("ci-qualification-");
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.name", "CI fixture");
  git("config", "user.email", "ci@example.invalid");
  writeFileSync(path.join(root, "seed"), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), "changed\n");
  git("add", ".");
  git("commit", "-qm", "change");
  return { root, base, head: git("rev-parse", "HEAD") };
}

describe("exact-candidate qualification minimum", () => {
  it("keeps resolved shared-runtime PR smoke and Android coverage unchanged", () => {
    const f = fixture("packages/core/src/scene.ts");
    try {
      const plan = classify({
        ...f,
        candidateSha: f.head,
        target: "develop",
        eventName: "pull_request",
      });
      expect(plan).toMatchObject({
        selection: "full",
        qualification: false,
        nativeTier: "reduced",
      });
      expect(plan.jobs["native-platforms"].required).toBe(true);
      expect(plan.templateMatrix.template).toEqual(["starter"]);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it("falls back to exhaustive when event identity is absent", () => {
    const f = fixture("docs/inert.md");
    try {
      expect(classify({ ...f, candidateSha: f.head, target: "develop" })).toMatchObject({
        selection: "full",
        qualification: true,
        nativeTier: "full",
      });
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
  it.each([
    "docs/inert.md",
    "scripts/ci-required.mjs",
    "packages/core/src/scene.ts",
    "packages/create-threenative/templates/shooter/src/main.ts",
  ])("requires every supported system and kit for queue input %s", (file) => {
    const f = fixture(file);
    try {
      const plan = classify({
        ...f,
        candidateSha: f.head,
        target: "refs/heads/develop",
        eventName: "merge_group",
      });
      expect(plan).toMatchObject({
        selection: "full",
        qualification: true,
        native: true,
        nativeTier: "full",
        reusedRunId: 0,
      });
      expect(plan.templateMatrix.template).toEqual(TEMPLATE_NAMES);
      expect(plan.goldenMatrix.template).toEqual(["starter", "platformer"]);
      expect(plan.unitMatrix.shard).toEqual(["1/4", "2/4", "3/4", "4/4"]);
      expect(
        Object.values(plan.jobs).every((job: unknown) => (job as { required: boolean }).required),
      ).toBe(true);
      expect(validatePlan(plan)).toEqual(plan);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it.each(["schedule", "workflow_dispatch", "unknown"])(
    "keeps %s exhaustive on develop",
    (eventName) => {
      const f = fixture("packages/core/src/scene.ts");
      try {
        expect(
          classify({ ...f, candidateSha: f.head, target: "develop", eventName }),
        ).toMatchObject({ qualification: true, nativeTier: "full" });
        expect(
          classify({
            ...f,
            candidateSha: f.head,
            target: "develop",
            eventName: "pull_request",
            full: true,
          }),
        ).toMatchObject({ qualification: true, nativeTier: "full" });
      } finally {
        rmSync(f.root, { recursive: true, force: true });
      }
    },
  );

  it.each(["prose", "ci", "warm", "full"])(
    "independently rejects a planner-generated %s queue exemption",
    (selection) => {
      const f = fixture("docs/inert.md");
      try {
        const plan = selectionPlan(
          selection,
          "narrow review",
          ["packages/core/src/scene.ts"],
          f.head,
          selection === "full",
          0,
          "develop",
        );
        expect(validatePlan(plan)).toEqual(plan);
        const needs = {
          scope: { result: "success", outputs: { plan: JSON.stringify(plan) } },
          ...Object.fromEntries(
            Object.entries(plan.jobs).map(([name, job]) => [
              name,
              { result: (job as { required: boolean }).required ? "success" : "skipped" },
            ]),
          ),
        };
        const result = spawnSync(process.execPath, [gate], {
          cwd: f.root,
          encoding: "utf8",
          env: {
            ...process.env,
            TN_CI_EVENT: "merge_group",
            TN_CI_BASE_REF: "refs/heads/develop",
            TN_CI_BASE_SHA: f.base,
            TN_CI_HEAD_SHA: f.head,
            TN_CI_NEEDS: JSON.stringify(needs),
          },
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("CI_REQUIRED_QUALIFICATION_MINIMUM");
      } finally {
        rmSync(f.root, { recursive: true, force: true });
      }
    },
  );
});
