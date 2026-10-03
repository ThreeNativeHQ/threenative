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
 * cannot reuse — but a tree is not a validation. The source run also has to prove what this run
 * proves: the same or a stronger target tier, the same or a stronger native matrix, every job and
 * matrix leg this run requires, and the same runner class.
 */
const REUSED_RUN_ID = 4242;
const SELF_RUN_ID = 1;
const HOSTED = ["ubuntu-latest"];
const LOCAL = ["self-hosted", "tn-linux"];

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

/** Every check this repository's `ci.yml` declares, matrix legs included. */
function boardLegs(): string[] {
  return [
    "typecheck",
    "lint",
    "test",
    "test-unit (1/3)",
    "test-unit (2/3)",
    "test-unit (3/3)",
    "test-native",
    "test-browser",
    "test-playtest",
    "golden-path-template (starter)",
    "template-nonvisual (rain, 1/1)",
    "golden-path",
    "benchmark",
    "build",
    "build-artifacts",
    "performance-contracts",
    "budgets",
    "supply-chain",
    "native-platforms",
  ];
}

interface IStubApi {
  /** The pull request branch the source run proved. `develop` by default. */
  base?: string;
  /** The source run's own event. */
  event?: string;
  /** The source run's own `ci-required` conclusion. */
  verdict?: string;
  /** Board legs the source run's job list never ran at all. */
  missing?: string[];
  /** The runner class the source run's board jobs used. */
  sourceLabels?: string[];
  /** The runner class this run routes to. */
  selfLabels?: string[];
  /** A board leg's runner labels, where they differ from the flat class both lists default to. */
  sourceJobLabels?: Record<string, string[]>;
  /** This run's board legs are queued on these labels, which a queued job already reports. */
  selfJobLabels?: Record<string, string[]>;
  /** Every read refuses. */
  fail?: boolean;
}

interface IStubJob {
  name: string;
  conclusion: string;
  labels: string[];
  runner_name: string | null;
}

function stubJob(name: string, conclusion: string, labels: string[]): IStubJob {
  return {
    name,
    conclusion,
    labels,
    // A skipped job never gets a runner, which is exactly what the API reports for one.
    runner_name:
      labels.length === 0
        ? null
        : labels.includes("self-hosted")
          ? "tn-local-01"
          : "GitHub Actions 1",
  };
}

/**
 * The Actions API, stubbed on PATH exactly as `gh` would answer each read: the source run's record,
 * its jobs, the pull requests its commit belongs to (which is where its base branch comes from, since
 * this repository's run records report no `base_ref`) and this run's own job list.
 */
function fakeActionsApi(fixture: IReuseFixture, api: IStubApi = {}): void {
  const bin = path.join(fixture.root, "bin");
  mkdirSync(bin, { recursive: true });
  const sourceLabels = api.sourceLabels ?? HOSTED;
  const selfLabels = api.selfLabels ?? HOSTED;
  const page = (jobs: IStubJob[]) => ({ total_count: jobs.length, jobs });
  writeFileSync(
    path.join(fixture.root, "record.json"),
    JSON.stringify({
      id: REUSED_RUN_ID,
      event: api.event ?? "pull_request",
      // Every run record in this repository reports a null base_ref, so the base is read from the
      // commit's pull requests instead.
      base_ref: null,
      head_sha: fixture.source,
      status: "completed",
      conclusion: "success",
    }),
  );
  writeFileSync(
    path.join(fixture.root, "jobs.json"),
    JSON.stringify(
      page([
        stubJob("Change scope", "success", sourceLabels),
        ...boardLegs()
          .filter((name) => !(api.missing ?? []).includes(name))
          .map((name) => stubJob(name, "success", api.sourceJobLabels?.[name] ?? sourceLabels)),
        stubJob("ci-required", api.verdict ?? "success", sourceLabels),
        stubJob("run-summary", "success", sourceLabels),
      ]),
    ),
  );
  writeFileSync(
    path.join(fixture.root, "self-jobs.json"),
    JSON.stringify(
      page([
        stubJob("Change scope", "success", selfLabels),
        // A reuse run carries every board leg, skipped by its own `if:`; a named routing override
        // states the labels such a leg is queued on, which the API reports before it has a runner.
        ...boardLegs().map((name) => {
          const labels = api.selfJobLabels?.[name] ?? [];
          return stubJob(name, labels.length === 0 ? "skipped" : "queued", labels);
        }),
        stubJob("ci-required", "in_progress", selfLabels),
        stubJob("run-summary", "skipped", []),
      ]),
    ),
  );
  writeFileSync(
    path.join(fixture.root, "pulls.json"),
    JSON.stringify([{ number: 7, base: { ref: api.base ?? "develop" }, head: { ref: "branch" } }]),
  );
  const script = `#!/bin/sh
if [ "$TN_FIXTURE_API_FAIL" = true ]; then echo "gh: HTTP 403: Resource not accessible" >&2; exit 1; fi
case "$*" in
  */pulls) cat "$TN_FIXTURE/pulls.json" ;;
  *"/runs/$TN_FIXTURE_SELF/jobs"*) cat "$TN_FIXTURE/self-jobs.json" ;;
  */jobs*) cat "$TN_FIXTURE/jobs.json" ;;
  *workflows*) cat "$TN_FIXTURE/runs.json" ;;
  *) cat "$TN_FIXTURE/record.json" ;;
esac
`;
  writeFileSync(path.join(bin, "gh"), script);
  chmodSync(path.join(bin, "gh"), 0o755);
}

function listRuns(root: string, runs: { id: number; head_sha: string; conclusion: string }[]) {
  writeFileSync(path.join(root, "runs.json"), JSON.stringify({ workflow_runs: runs }));
}

/** One successful CI run of the tree under test, which is what every reuse case here starts from. */
function listSourceRun(fixture: IReuseFixture) {
  listRuns(fixture.root, [{ id: REUSED_RUN_ID, head_sha: fixture.source, conclusion: "success" }]);
}

function classifyCandidate(
  fixture: IReuseFixture,
  head: string,
  options: {
    event?: string;
    target?: string;
    apiFail?: boolean;
    dayOfWeek?: number;
  } = {},
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
      options.target ?? "develop",
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
        TN_FIXTURE_SELF: String(SELF_RUN_ID),
        TN_FIXTURE_API_FAIL: options.apiFail === true ? "true" : "false",
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: "three-native/fixture",
        GITHUB_RUN_ID: String(SELF_RUN_ID),
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
      // The merge queue targets develop and reports no base ref. A pull-request event would also
      // demand the fixture's exact base/head merge parents, which a one-parent fixture cannot make.
      TN_CI_EVENT: "merge_group",
      TN_CI_BASE_REF: "",
      TN_FIXTURE: fixture.root,
      TN_FIXTURE_SELF: String(SELF_RUN_ID),
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "three-native/fixture",
      GITHUB_RUN_ID: String(SELF_RUN_ID),
    },
  });
}

describe("PRD-481 a tree is tested once", () => {
  it("reuses a successful run that tested this exact tree, citing its run id", () => {
    const fixture = reuseFixture();
    fakeActionsApi(fixture);
    listSourceRun(fixture);
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
    fakeActionsApi(fixture);
    listSourceRun(fixture);
    const plan = classifyCandidate(fixture, fixture.moved);
    expect(plan).toMatchObject({ selection: "full" });
    // The reason has to say the tree was looked up and missed. A full run that silently never
    // consulted the API and a full run that consulted it and found nothing read the same.
    expect(plan.reason).toContain("tree reuse unavailable");
  });

  it("runs the full board when the Actions API cannot be read", () => {
    const fixture = reuseFixture();
    fakeActionsApi(fixture);
    listSourceRun(fixture);
    const plan = classifyCandidate(fixture, fixture.candidate, { apiFail: true });
    expect(plan).toMatchObject({ selection: "full" });
    expect(plan.reason).toContain("HTTP 403");
  });

  it("keeps workflow_dispatch an explicit full audit even on a tree hit", () => {
    const fixture = reuseFixture();
    fakeActionsApi(fixture);
    listSourceRun(fixture);
    const plan = classifyCandidate(fixture, fixture.candidate, { event: "workflow_dispatch" });
    expect(plan).toMatchObject({ selection: "full" });
    // Never even asked: the API answers here, and asking would have found this exact tree.
    expect(plan.reason).toContain("workflow_dispatch");
    expect(plan.reason).not.toContain("tree reuse");
  });

  it("never cites an audit dispatch as the proof a reuse rests on", () => {
    const fixture = reuseFixture();
    fakeActionsApi(fixture, { event: "workflow_dispatch" });
    listSourceRun(fixture);
    const plan = classifyCandidate(fixture, fixture.candidate);
    expect(plan).toMatchObject({ selection: "full" });
    expect(plan.reason).toContain("workflow_dispatch");
  });

  it("keeps Sunday's nightly full and lets Monday's reuse", () => {
    // The nightly's subject is the runner image and the network, neither of which an unchanged
    // tree can vouch for. Six days of the week may reuse; Sunday may not. A scheduled run reports no
    // base ref, so `--target ""` is what the workflow actually passes it.
    const fixture = reuseFixture();
    fakeActionsApi(fixture, { event: "schedule" });
    listSourceRun(fixture);
    expect(
      classifyCandidate(fixture, fixture.candidate, {
        event: "schedule",
        target: "",
        dayOfWeek: 7,
      }),
    ).toMatchObject({ selection: "full" });
    expect(
      classifyCandidate(fixture, fixture.candidate, {
        event: "schedule",
        target: "",
        dayOfWeek: 1,
      }),
    ).toMatchObject({ selection: "reused", reusedRunId: REUSED_RUN_ID });
  });

  it("passes a reused verdict only when the source run passed its own", () => {
    const fixture = reuseFixture();
    fakeActionsApi(fixture);
    listSourceRun(fixture);
    const plan = classifyCandidate(fixture, fixture.candidate);
    const passed = verifyReusedPlan(fixture, plan);
    expect(passed.status, passed.stdout + passed.stderr).toBe(0);
    fakeActionsApi(fixture, { verdict: "failure" });
    const failed = verifyReusedPlan(fixture, plan);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("CI_REQUIRED_SOURCE_NOT_SUCCESS");
  });
});

describe("PRD-481 a reused verdict has to cover this run's validation profile", () => {
  it("runs the full board when a develop pull request's pass is cited for a promotion", () => {
    // The same tree, a stronger requirement. PRD-380 gives an ordinary pull request a reduced
    // native matrix, so its pass is not a promotion's proof.
    const fixture = reuseFixture();
    fakeActionsApi(fixture, { base: "develop" });
    listSourceRun(fixture);
    const plan = classifyCandidate(fixture, fixture.candidate, { target: "main" });
    expect(plan).toMatchObject({ selection: "full" });
    expect(plan.reason).toContain("tree reuse unavailable");
    expect(plan.reason).toContain("target develop");
  });

  it("runs the full board when the source never ran a matrix leg this run requires", () => {
    const fixture = reuseFixture();
    fakeActionsApi(fixture, { missing: ["template-nonvisual (rain, 1/1)"] });
    listSourceRun(fixture);
    const plan = classifyCandidate(fixture, fixture.candidate);
    expect(plan).toMatchObject({ selection: "full" });
    expect(plan.reason).toContain("template-nonvisual (rain, 1/1)");
  });

  it("runs the full board when the source ran on a different runner class", () => {
    // A git tree does not carry the runner image, so a pass on the owner's machine is not a pass on
    // a hosted runner.
    const fixture = reuseFixture();
    fakeActionsApi(fixture, { selfLabels: LOCAL });
    listSourceRun(fixture);
    const plan = classifyCandidate(fixture, fixture.candidate);
    expect(plan).toMatchObject({ selection: "full" });
    expect(plan.reason).toContain("this run routes to tn-local");
  });

  it("reuses a promotion pass for an ordinary develop pull request", () => {
    // Stronger covers weaker: the promotion proved the full board on this exact tree.
    const fixture = reuseFixture();
    fakeActionsApi(fixture, { base: "main" });
    listSourceRun(fixture);
    const plan = classifyCandidate(fixture, fixture.candidate);
    expect(plan).toMatchObject({ selection: "reused", reusedRunId: REUSED_RUN_ID });
    expect(plan.reason).toContain(`CI run ${String(REUSED_RUN_ID)}`);
  });
});

/** Every board leg routed locally, which is what the ordinary joins run on. */
function localRouting(): Record<string, string[]> {
  return Object.fromEntries(boardLegs().map((name) => [name, LOCAL]));
}

/** `supply-chain` is always hosted; the small joins are always local. A board is mixed by design. */
function mixedRouting(): Record<string, string[]> {
  return Object.fromEntries(
    boardLegs().map((name) => [name, name === "supply-chain" ? HOSTED : LOCAL]),
  );
}

describe("PRD-481 the runner class is compared per job, because every board is mixed", () => {
  it("reuses a run that passed the same mix of runner classes", () => {
    const fixture = reuseFixture();
    fakeActionsApi(fixture, { sourceJobLabels: mixedRouting(), selfJobLabels: mixedRouting() });
    listSourceRun(fixture);
    const plan = classifyCandidate(fixture, fixture.candidate);
    expect(plan).toMatchObject({ selection: "reused", reusedRunId: REUSED_RUN_ID });
  });

  it("runs the full board when one job of the mix ran on another runner class", () => {
    const fixture = reuseFixture();
    fakeActionsApi(fixture, {
      sourceLabels: LOCAL,
      sourceJobLabels: { test: HOSTED },
      selfJobLabels: localRouting(),
    });
    listSourceRun(fixture);
    const plan = classifyCandidate(fixture, fixture.candidate);
    expect(plan).toMatchObject({ selection: "full" });
    expect(plan.reason).toContain(
      "the source run's test ran on hosted while this run routes to tn-local",
    );
  });
});
