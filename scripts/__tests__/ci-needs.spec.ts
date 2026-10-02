import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../test-support/temp-dir.js";
import { formatJobTimings, formatRunSummary, summaryRows } from "../ci-run-summary.js";
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

describe("PRD-373 measured queue and execution time", () => {
  /** The one `gh api` invocation the run summary's timings come from. */
  function timingCollection(source: string): string {
    const match = /gh api [\s\S]*?job-timings\.json"; then/u.exec(source);
    expect(match?.[0], "ci.yml must collect job timings").toBeTruthy();
    return match?.[0] ?? "";
  }

  it("calls gh with a flag pairing gh accepts", async () => {
    // gh rejects `--slurp` beside `--jq` or `--template`, and the `if !` guard turned that rejection
    // into `[]` — so every run reported a header-only table and an empty measurement read as a
    // measured one.
    const call = timingCollection(await ci());
    expect(call).toContain("--paginate");
    expect(call).toContain("--slurp");
    expect(call).not.toContain("--jq");
    expect(call).not.toContain("--template");
  });

  it("flattens the paginated pages into a populated table", async () => {
    const script = /node -e '([^']+)'/u.exec(timingCollection(await ci()));
    expect(script?.[1], "the flatten must stay a runnable node expression").toBeTruthy();
    const pages = [
      {
        jobs: [
          {
            name: "typecheck",
            created_at: "2026-09-26T00:00:00Z",
            started_at: "2026-09-26T00:02:00Z",
            completed_at: "2026-09-26T00:02:45Z",
          },
        ],
      },
      {},
      {
        jobs: [
          {
            name: "build",
            created_at: "2026-09-26T00:00:00Z",
            started_at: null,
            completed_at: null,
          },
        ],
      },
    ];
    const flatten = spawnSync("node", ["-e", script?.[1] ?? ""], {
      input: JSON.stringify(pages),
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(flatten.stderr).toBe("");
    expect(flatten.status).toBe(0);
    const summary = formatJobTimings(JSON.parse(flatten.stdout));
    expect(summary).toContain("| typecheck | 120s | 45s |");
    expect(summary).toContain("| build | unavailable | unavailable |");
  });

  it("keeps runner queue time distinct from execution time", () => {
    const summary = formatJobTimings([
      {
        name: "typecheck",
        created_at: "2026-09-10T00:00:00Z",
        started_at: "2026-09-10T00:02:00Z",
        completed_at: "2026-09-10T00:02:45Z",
      },
    ]);
    expect(summary).toContain("| typecheck | 120s | 45s |");
    expect(summary).toContain("Queue");
    expect(summary).toContain("Execution");
  });

  it("does not manufacture zero-duration evidence for skipped or malformed jobs", () => {
    const summary = formatJobTimings([
      { name: "native | skipped", started_at: null, completed_at: null },
      {
        name: "invalid",
        created_at: "bad",
        started_at: "2026-09-10T00:02:00Z",
        completed_at: "2026-09-10T00:01:00Z",
      },
    ]);
    expect(summary).toContain("native &#124; skipped");
    expect(summary).toContain("| unavailable | unavailable |");
    expect(summary).not.toContain("0s");
  });
});

/**
 * PRD-481 tree reuse. The key is the whole repository tree, so a tree that changed by one file
 * cannot reuse, and the only thing that can make reuse safe is the source run's own verdict.
 */
const REUSED_RUN_ID = 4242;

interface IReuseFixture {
  root: string;
  /** The commit a previous successful CI run tested. */
  source: string;
  /** A later commit carrying the identical tree: the candidate under test. */
  candidate: string;
  /** One more source file, so the tree differs by exactly one file. */
  moved: string;
  base: string;
}

/**
 * `A` seeds the history, `B` adds a runtime file, `C` is an empty commit on top of it (the same tree
 * at a new commit, which is what a re-push or a promotion produces) and `D` adds one more file.
 * HEAD is parked back on `C`, so the verdict job's own candidate assertion has something to check.
 */
function reuseFixture(): IReuseFixture {
  const root = makeTempDirSync("threenative-tree-reuse-");
  const git = (...args: string[]) =>
    spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        GIT_AUTHOR_NAME: "tree reuse fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "tree reuse fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
    });
  const commit = (contents: Record<string, string>, message: string) => {
    for (const [relative, body] of Object.entries(contents)) {
      mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      writeFileSync(path.join(root, relative), body);
    }
    expect(git("add", "-A").status).toBe(0);
    expect(git("commit", "--quiet", "-m", message).status).toBe(0);
    return git("rev-parse", "HEAD").stdout.trim();
  };
  expect(git("init", "--quiet", "--initial-branch", "develop").status).toBe(0);
  const base = commit({ "seed.txt": "seed\n" }, "base");
  const source = commit({ "src/runtime.ts": "export {};\n" }, "runtime");
  expect(git("commit", "--quiet", "--allow-empty", "-m", "same tree").status).toBe(0);
  const candidate = git("rev-parse", "HEAD").stdout.trim();
  const moved = commit({ "src/other.ts": "export {};\n" }, "one more file");
  expect(git("checkout", "--quiet", "--detach", candidate).status).toBe(0);
  return { root, source, candidate, moved, base };
}

/** The one API the lookup and the verdict job share, stubbed on PATH exactly as gh would answer. */
function fakeActionsApi(root: string, jobs: { name: string; conclusion: string }[]): string {
  const bin = path.join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(root, "jobs.json"), JSON.stringify({ jobs }));
  const script = `#!/bin/sh
if [ "$TN_FIXTURE_API_FAIL" = true ]; then echo "gh: HTTP 403: Resource not accessible" >&2; exit 1; fi
case "$*" in
  *jobs*) cat "$TN_FIXTURE/jobs.json" ;;
  *) cat "$TN_FIXTURE/runs.json" ;;
esac
`;
  writeFileSync(path.join(bin, "gh"), script);
  chmodSync(path.join(bin, "gh"), 0o755);
  return bin;
}

function listRuns(root: string, runs: { id: number; head_sha: string; conclusion: string }[]) {
  writeFileSync(path.join(root, "runs.json"), JSON.stringify({ workflow_runs: runs }));
}

function classifyCandidate(
  fixture: IReuseFixture,
  head: string,
  options: { event?: string; apiFail?: boolean; dayOfWeek?: number } = {},
) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(repo, "scripts/ci-change-scope.mjs"),
      "--root",
      fixture.root,
      "--base",
      fixture.base,
      "--head",
      head,
      "--candidate-sha",
      head,
      "--target",
      "develop",
      "--event-name",
      options.event ?? "pull_request",
      // The nightly split is decided from the clock, so the fixture states the day rather than
      // waiting for one.
      ...(options.dayOfWeek === undefined ? [] : ["--day-of-week", String(options.dayOfWeek)]),
      "--format",
      "json",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${path.join(fixture.root, "bin")}:${process.env.PATH}`,
        TN_FIXTURE: fixture.root,
        TN_FIXTURE_API_FAIL: options.apiFail === true ? "true" : "false",
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: "three-native/fixture",
      },
    },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function verifyReusedPlan(fixture: IReuseFixture, plan: Record<string, unknown>) {
  const jobs = plan.jobs as Record<string, { required: boolean }>;
  const needs = {
    scope: { result: "success", outputs: { plan: JSON.stringify(plan) } },
    ...Object.fromEntries(Object.entries(jobs).map(([name]) => [name, { result: "skipped" }])),
  };
  return spawnSync(process.execPath, [path.join(repo, "scripts/ci-required.mjs")], {
    cwd: fixture.root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${path.join(fixture.root, "bin")}:${process.env.PATH}`,
      TN_CI_NEEDS: JSON.stringify(needs),
      TN_FIXTURE: fixture.root,
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "three-native/fixture",
    },
  });
}

describe("PRD-481 a tree is tested once", () => {
  it("reuses a successful run that tested this exact tree, citing its run id", () => {
    const fixture = reuseFixture();
    fakeActionsApi(fixture.root, []);
    listRuns(fixture.root, [
      { id: 9999, head_sha: "f".repeat(40), conclusion: "success" },
      { id: REUSED_RUN_ID, head_sha: fixture.source, conclusion: "success" },
    ]);
    const plan = classifyCandidate(fixture, fixture.candidate);
    expect(plan).toMatchObject({
      selection: "reused",
      reusedRunId: REUSED_RUN_ID,
      candidateSha: fixture.candidate,
    });
    const jobs = plan.jobs as Record<string, { required: boolean }>;
    expect(Object.values(jobs).some((job) => job.required)).toBe(false);
  });

  it("runs the full board for a tree that changed by one file", () => {
    const fixture = reuseFixture();
    fakeActionsApi(fixture.root, []);
    listRuns(fixture.root, [
      { id: REUSED_RUN_ID, head_sha: fixture.source, conclusion: "success" },
    ]);
    const plan = classifyCandidate(fixture, fixture.moved);
    expect(plan).toMatchObject({ selection: "full" });
    // The reason has to say the tree was looked up and missed. A full run that silently never
    // consulted the API and a full run that consulted it and found nothing read the same.
    expect(plan.reason).toContain("tree reuse unavailable");
  });

  it("runs the full board when the Actions API cannot be read", () => {
    const fixture = reuseFixture();
    fakeActionsApi(fixture.root, []);
    listRuns(fixture.root, [
      { id: REUSED_RUN_ID, head_sha: fixture.source, conclusion: "success" },
    ]);
    const plan = classifyCandidate(fixture, fixture.candidate, { apiFail: true });
    expect(plan).toMatchObject({ selection: "full" });
    expect(plan.reason).toContain("HTTP 403");
  });

  it("keeps workflow_dispatch an explicit full audit even on a tree hit", () => {
    const fixture = reuseFixture();
    fakeActionsApi(fixture.root, []);
    listRuns(fixture.root, [
      { id: REUSED_RUN_ID, head_sha: fixture.source, conclusion: "success" },
    ]);
    const plan = classifyCandidate(fixture, fixture.candidate, { event: "workflow_dispatch" });
    expect(plan).toMatchObject({ selection: "full" });
    // Never even asked: the API answers here, and asking would have found this exact tree.
    expect(plan.reason).toContain("workflow_dispatch");
    expect(plan.reason).not.toContain("tree reuse");
  });

  it("keeps Sunday's nightly full and lets Monday's reuse", () => {
    // The nightly's subject is the runner image and the network, neither of which an unchanged
    // tree can vouch for. Six days of the week may reuse; Sunday may not.
    const fixture = reuseFixture();
    fakeActionsApi(fixture.root, []);
    listRuns(fixture.root, [
      { id: REUSED_RUN_ID, head_sha: fixture.source, conclusion: "success" },
    ]);
    expect(
      classifyCandidate(fixture, fixture.candidate, { event: "schedule", dayOfWeek: 7 }),
    ).toMatchObject({ selection: "full" });
    expect(
      classifyCandidate(fixture, fixture.candidate, { event: "schedule", dayOfWeek: 1 }),
    ).toMatchObject({ selection: "reused", reusedRunId: REUSED_RUN_ID });
  });

  it("passes a reused verdict only when the source run passed its own", () => {
    const fixture = reuseFixture();
    fakeActionsApi(fixture.root, [{ name: "ci-required", conclusion: "success" }]);
    listRuns(fixture.root, [
      { id: REUSED_RUN_ID, head_sha: fixture.source, conclusion: "success" },
    ]);
    const plan = classifyCandidate(fixture, fixture.candidate);
    const passed = verifyReusedPlan(fixture, plan);
    expect(passed.status, passed.stdout + passed.stderr).toBe(0);
    fakeActionsApi(fixture.root, [{ name: "ci-required", conclusion: "failure" }]);
    const failed = verifyReusedPlan(fixture, plan);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("CI_REQUIRED_SOURCE_NOT_SUCCESS");
  });
});
