import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
