import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CI_JOB_SELECTION,
  fenceFamilies,
  parseFamilies,
  pathSelection,
  selectFamilies,
} from "../ci-check-families.mjs";
import { ciRequiredRows, formatCiRequired, parseArgs } from "../ci-required-verdict.mjs";
import { formatRunSummary, summaryRows } from "../ci-run-summary.js";
import { ciJobGraph, ciNeedsFindings, declaredNeeds, jobSections } from "../ci-workflow.js";

const repo = path.resolve(import.meta.dirname, "../..");
const ciPath = path.join(repo, ".github/workflows/ci.yml");

async function ci(): Promise<string> {
  return readFile(ciPath, "utf8");
}

/** A workflow the guard can be pointed at without touching the real one. */
function workflow(jobs: string): string {
  return `name: fixture\non:\n  push:\n\njobs:\n${jobs}`;
}

const BUILD = `  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/upload-artifact@v4
`;

describe("ci needs graph", () => {
  it("should read every job in this repository's own ci.yml", async () => {
    const jobs = ciJobGraph(await ci());
    expect(jobs.map((job) => job.name)).toContain("golden-path");
    expect(jobs.map((job) => job.name)).toContain("run-summary");
    expect(jobs.length).toBeGreaterThanOrEqual(14);
  });

  it("should find no gate ordered behind another gate", async () => {
    // PRD-296's rule, as a regression guard rather than a CI round trip. `needs: build` is
    // artifact production; `golden-path` and `run-summary` aggregate the verdicts they wait on.
    expect(ciNeedsFindings(ciJobGraph(await ci()))).toEqual([]);
  });

  it("should fail when a coverage job is ordered behind another coverage job", () => {
    const jobs = ciJobGraph(
      workflow(`  test:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test

  visuals:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - run: pnpm visuals
`),
    );
    const findings = ciNeedsFindings(jobs);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.job).toBe("visuals");
    expect(findings[0]?.dependsOn).toBe("test");
    expect(findings[0]?.problem).toContain("produces no artifact");
  });

  it("should allow an edge onto a job that produces an artifact", () => {
    expect(
      ciNeedsFindings(
        ciJobGraph(
          workflow(`${BUILD}
  budgets:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: pnpm budgets
`),
        ),
      ),
    ).toEqual([]);
  });

  it("should allow an aggregator to wait on the verdict it publishes", () => {
    expect(
      ciNeedsFindings(
        ciJobGraph(
          workflow(`  golden-path-template:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test:templates

  golden-path:
    needs: golden-path-template
    runs-on: ubuntu-latest
    steps:
      - run: test "\${{ needs.golden-path-template.result }}" = "success"
`),
        ),
      ),
    ).toEqual([]);
  });

  it("should allow the exact scope decision job to schedule coverage", () => {
    expect(
      ciNeedsFindings(
        ciJobGraph(
          workflow(`  scope:
    outputs:
      selection: \${{ steps.classify.outputs.selection }}
      reason: \${{ steps.classify.outputs.reason }}
    runs-on: ubuntu-latest
    steps:
      - id: classify
        run: node scripts/ci-change-scope.mjs

  build:
    needs: scope
    runs-on: ubuntu-latest
    steps:
      - run: pnpm build
`),
        ),
      ),
    ).toEqual([]);
  });

  it("should reject a fake scope job without the decision output", () => {
    const findings = ciNeedsFindings(
      ciJobGraph(
        workflow(`  scope:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/ci-change-scope.mjs

  build:
    needs: scope
    runs-on: ubuntu-latest
    steps:
      - run: pnpm build
`),
      ),
    );
    expect(findings[0]?.problem).toContain("produces no artifact");
  });

  it("should fail closed on an edge naming a job the workflow does not declare", () => {
    const findings = ciNeedsFindings(
      ciJobGraph(
        workflow(`  budgets:
    needs: nonexistent
    runs-on: ubuntu-latest
    steps:
      - run: pnpm budgets
`),
      ),
    );
    expect(findings[0]?.problem).toContain("which this workflow does not declare");
  });

  it("should read both shapes of needs, and ignore one quoted in a comment", () => {
    expect(declaredNeeds("  a:\n    needs: build\n")).toEqual(["build"]);
    expect(declaredNeeds("  a:\n    needs: [build, test]\n")).toEqual(["build", "test"]);
    expect(
      declaredNeeds("  a:\n    needs:\n      - build\n      - test\n    runs-on: x\n"),
    ).toEqual(["build", "test"]);
    expect(
      declaredNeeds("  a:\n      # `needs: test` is what created this\n    runs-on: x\n"),
    ).toEqual([]);
  });

  it("should refuse a workflow with no jobs rather than reporting a green zero", () => {
    expect(() => jobSections("name: x\non:\n  push:\n")).toThrow(/CI_WORKFLOW_NO_JOBS/u);
    expect(() => jobSections("name: x\n\njobs:\n")).toThrow(/CI_WORKFLOW_NO_JOBS/u);
  });
});

describe("ci run summary", () => {
  it("should depend on every job it claims to report on", async () => {
    // The guard against the summary itself going quiet: a job added to ci.yml without being added
    // to run-summary's `needs:` is an unreported job, which is the exact shape of the defect.
    const jobs = ciJobGraph(await ci());
    const results = Object.fromEntries(
      jobs
        .filter((job) => job.name !== "run-summary")
        .map((job) => [job.name, { result: "success" }]),
    );
    const rows = summaryRows(jobs, "run-summary", results);
    expect(rows).toHaveLength(jobs.length - 1);
    expect(formatRunSummary(rows)).toContain(`Every one of the ${String(rows.length)} jobs ran.`);
  });

  it("should refuse to report on a subset of the workflow's jobs", async () => {
    const jobs = ciJobGraph(await ci());
    const results = Object.fromEntries(
      jobs
        .filter((job) => job.name !== "run-summary" && job.name !== "budgets")
        .map((job) => [job.name, { result: "success" }]),
    );
    expect(() => summaryRows(jobs, "run-summary", results)).toThrow(
      /CI_SUMMARY_UNREPORTED_JOBS: budgets/u,
    );
  });

  it("should name the upstream that stopped a skipped job", () => {
    const jobs = ciJobGraph(
      workflow(`${BUILD}
  budgets:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: pnpm budgets
`),
    );
    const rows = summaryRows(jobs, "run-summary", {
      budgets: { result: "skipped" },
      build: { result: "failure" },
    });
    expect(rows).toEqual([
      { job: "build", result: "failure", why: "" },
      { job: "budgets", result: "skipped", why: "never ran — needs: build (failure)" },
    ]);
    const markdown = formatRunSummary(rows);
    expect(markdown).toContain("**skipped**");
    expect(markdown).toContain("**1 of 2 jobs did not run.**");
    expect(markdown).toContain("a skipped required check still counts as satisfied");
  });

  it("should say so when a job skipped itself rather than being blocked", () => {
    const jobs = ciJobGraph(
      workflow(`  supply-chain:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - run: pnpm audit
`),
    );
    expect(
      summaryRows(jobs, "run-summary", { "supply-chain": { result: "skipped" } })[0]?.why,
    ).toBe("never ran — its `if:` condition was false");
  });

  it("should never render a missing observation as a verdict", () => {
    const jobs = ciJobGraph(workflow(BUILD));
    expect(() => summaryRows(jobs, "run-summary", { build: {} })).toThrow(
      /CI_SUMMARY_NO_RESULT: build/u,
    );
  });
});

/** A board where every job ran and passed, which is what a full selection should look like. */
function greenBoard(): Record<string, { result: string }> {
  return Object.fromEntries(
    Object.keys(CI_JOB_SELECTION).map((job) => [job, { result: "success" }]),
  );
}

const FULL = parseFamilies(
  fenceFamilies(
    new Set(["docs", "workspace", "browser", "playtest", "templates", "native", "site"]),
  ),
);
const PROSE = parseFamilies("|docs|");

describe("ci-required verdict", () => {
  it("passes a full board and a narrowed one that skipped exactly what it deselected", () => {
    expect(ciRequiredRows(greenBoard(), FULL, "pull_request").filter((row) => !row.ok)).toEqual([]);

    const prose = Object.fromEntries(
      Object.entries(CI_JOB_SELECTION).map(([job, entry]) => [
        job,
        { result: entry.family === null ? "success" : "skipped" },
      ]),
    );
    expect(ciRequiredRows(prose, PROSE, "pull_request").filter((row) => !row.ok)).toEqual([]);
  });

  it("blocks on a selected job that failed, was cancelled or never reported", () => {
    for (const result of ["failure", "cancelled", "skipped", "neutral", "timed_out"]) {
      const rows = ciRequiredRows({ ...greenBoard(), budgets: { result } }, FULL, "pull_request");
      const budgets = rows.find((row) => row.job === "budgets");
      expect(budgets?.ok, `budgets=${result} did not block`).toBe(false);
      expect(budgets?.why).toContain("selected but");
    }

    const missing: Record<string, { result: string } | undefined> = greenBoard();
    missing.typecheck = undefined;
    const rows = ciRequiredRows(missing, FULL, "pull_request");
    expect(rows.find((row) => row.job === "typecheck")).toMatchObject({
      ok: false,
      result: "missing",
    });
    expect(formatCiRequired(rows, FULL)).toContain("block merging");
  });

  it("blocks on a deselected job that ran and went red, and on a job nothing decides", () => {
    const prose = Object.fromEntries(
      Object.entries(CI_JOB_SELECTION).map(([job, entry]) => [
        job,
        { result: entry.family === null ? "success" : "skipped" },
      ]),
    );
    const leaked = ciRequiredRows(
      { ...prose, "test-native": { result: "failure" } },
      PROSE,
      "pull_request",
    );
    expect(leaked.find((row) => row.job === "test-native")).toMatchObject({ ok: false });

    const stranger = ciRequiredRows(
      { ...greenBoard(), "visuals-gpu": { result: "success" } },
      FULL,
      "pull_request",
    );
    expect(stranger.find((row) => row.job === "visuals-gpu")?.why).toContain("CI_JOB_SELECTION");
  });

  it("lets the secret scan skip on the events its own condition excludes", () => {
    const scheduled = { ...greenBoard(), "supply-chain": { result: "skipped" } };
    expect(ciRequiredRows(scheduled, FULL, "schedule").filter((row) => !row.ok)).toEqual([]);
    expect(
      ciRequiredRows(scheduled, FULL, "pull_request").find((row) => row.job === "supply-chain")?.ok,
    ).toBe(false);
  });

  it("refuses malformed input rather than reporting a green zero", () => {
    expect(() => parseFamilies("docs")).toThrow(/CI_REQUIRED_MALFORMED_FAMILIES/u);
    expect(() => parseFamilies("|docs|rendering|")).toThrow(/CI_REQUIRED_MALFORMED_FAMILIES/u);
    expect(() => parseFamilies("||")).toThrow(/names no family/u);
    expect(() => parseArgs(["--results", "x"])).toThrow(/CI_REQUIRED_MALFORMED_ARGUMENT/u);
    expect(() => parseArgs(["--nope", "x"])).toThrow(/CI_REQUIRED_MALFORMED_ARGUMENT/u);
  });
});

describe("ci change families", () => {
  it("narrows only the paths a rule proves safe and broadens everything else", () => {
    expect(pathSelection("docs/PRDs/PRD-1.md").families).toEqual(["docs"]);
    expect(pathSelection("AGENTS.md").families).toEqual(["docs", "workspace"]);
    expect(pathSelection("site/src/app.ts").families).toEqual(["docs", "workspace", "site"]);
    // Fail-closed rows: a scaffold input, a Markdown file a gate parses, and an unmapped path.
    for (const file of [
      "packages/create-threenative/templates/starter/AGENTS.md",
      "docs/verification/round-12.md",
      "packages/core/src/index.ts",
      "pnpm-lock.yaml",
      "examples/quarry/src/main.ts",
    ]) {
      expect(pathSelection(file).families.length, `${file} narrowed`).toBe(7);
    }
  });

  it("takes the union of the paths in one diff, never the narrowest", () => {
    const { families } = selectFamilies(["docs/PRDs/a.md", "site/index.html"]);
    expect(fenceFamilies(families)).toBe("|docs|workspace|site|");
    expect(fenceFamilies(selectFamilies(["docs/PRDs/a.md", "src/x.ts"]).families)).toBe(
      "|docs|workspace|browser|playtest|templates|native|site|",
    );
  });
});
