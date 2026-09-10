import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "vitest";
import { makeTempDirSync } from "../../test-support/temp-dir.js";

const root = resolve(import.meta.dirname, "../..");
const workflow = readFileSync(join(root, ".github/workflows/native-release.yml"), "utf8");
const sha = "a".repeat(40);
const names = [
  "typecheck",
  "lint",
  "test",
  "budgets",
  "build",
  "test-native",
  "native-platforms / Windows desktop core",
  "native-platforms / macOS desktop core",
  "native-platforms / Scaffolded starter desktop artifact",
  "native-platforms / Desktop web/native parity",
  "native-platforms / Android emulator visual parity",
];

function job(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `missing job ${name}`);
  return workflow.slice(start + 1).split(/\n\x20{2}[\w-]+:\n/u)[0] ?? "";
}

function script(name: string): string {
  const step = workflow.split(`      - name: ${name}\n`)[1];
  assert.ok(step, `missing step ${name}`);
  const block = step.split(/\n\x20{6}- /u)[0]?.split(/\n\x20{8}run: \|\n/u)[1];
  assert.ok(block, `missing script ${name}`);
  return block
    .split("\n")
    .map((line) => line.replace(/^\x20{10}/u, ""))
    .join("\n");
}

function allowed(
  name: string,
  event: string,
  refType: string,
  results: Record<string, string> = {},
): boolean {
  const body = job(name).split("\n    steps:")[0] ?? "";
  const expression = body.match(/\n\x20{4}if: (?:>-\n)?([\s\S]*?)(?=\n\x20{4}[a-z]|$)/u)?.[1];
  assert.ok(expression, `missing explicit job condition for ${name}`);
  const condition = expression
    .replace(/\$\{\{|\}\}/gu, "")
    .replace(/needs\.([\w-]+)/gu, 'needs["$1"]');
  const needs = Object.fromEntries(
    [
      "validate-tag",
      "gates",
      "build",
      "build-android",
      "publish",
      "clean-consumer",
      "clean-consumer-ios",
    ].map((key) => [key, { result: results[key] ?? "success", outputs: { candidate_sha: sha } }]),
  );
  const validation = needs["validate-tag"];
  assert.ok(validation);
  if (results["validate-tag"] === "skipped") validation.outputs.candidate_sha = "";
  const evaluate = new Function(
    "github",
    "needs",
    "cancelled",
    "always",
    "startsWith",
    `return Boolean(${condition});`,
  );
  return evaluate(
    {
      event_name: event,
      ref_type: refType,
      ref: refType === "tag" ? "refs/tags/runtime-native-v0.3.1" : "refs/heads/main",
      sha,
    },
    needs,
    () => false,
    () => true,
    (text: string, prefix: string) => text.startsWith(prefix),
  );
}

function runGate(change: "none" | "wrong-sha" | "missing-job" | "skipped-job") {
  const directory = makeTempDirSync("threenative-release-gate-");
  const run = {
    databaseId: 123,
    attempt: 1,
    status: "completed",
    conclusion: "success",
    event: "push",
    headBranch: "main",
    headSha: change === "wrong-sha" ? "b".repeat(40) : sha,
  };
  const jobs = names.map((name, index) => ({
    id: index + 1,
    name,
    run_id: 123,
    head_sha: sha,
    status: "completed",
    conclusion: "success",
  }));
  if (change === "missing-job") jobs.pop();
  if (change === "skipped-job") {
    assert.ok(jobs[0]);
    jobs[0].conclusion = "skipped";
  }
  writeFileSync(join(directory, "runs.json"), JSON.stringify([run]));
  writeFileSync(join(directory, "run.json"), JSON.stringify(run));
  writeFileSync(join(directory, "jobs.json"), JSON.stringify([{ total_count: jobs.length, jobs }]));
  const bin = join(directory, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "gh"),
    '#!/bin/sh\ncase "$1 $2" in\n"run list") cat "$FIXTURES/runs.json";;\n"run view") cat "$FIXTURES/run.json";;\n"api --paginate") cat "$FIXTURES/jobs.json";;\n*) exit 91;;\nesac\n',
  );
  chmodSync(join(bin, "gh"), 0o755);
  const result = spawnSync(
    "bash",
    ["-e", "-o", "pipefail", "-c", script("Require a green CI run for this commit")],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        FIXTURES: directory,
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: directory,
        GITHUB_SHA: sha,
        GITHUB_REPOSITORY: "ThreeNativeHQ/threenative",
        GITHUB_STEP_SUMMARY: join(directory, "summary.md"),
      },
    },
  );
  assert.ifError(result.error);
  return { ...result, directory, evidence: join(directory, "native-release-prerequisites") };
}

test("offers non-publishing PR and manual proof entry points in the existing workflow", () => {
  const triggers = workflow.split("\npermissions:")[0] ?? "";
  assert.match(triggers, /\n\x20{2}pull_request:/u);
  assert.match(triggers, /\n\x20{2}workflow_dispatch:/u);
  assert.doesNotMatch(triggers, /pull_request_target/u);
});

for (const name of ["validate-tag", "publish", "finalize", "cleanup-failed-release"]) {
  test(`${name} cannot mutate releases from a pull request or manual invocation`, () => {
    assert.equal(allowed(name, "pull_request", "branch"), false);
    assert.equal(allowed(name, "workflow_dispatch", "branch"), false);
    assert.equal(allowed(name, "workflow_dispatch", "tag"), false);
  });
}

for (const name of ["gates", "build", "build-android", "clean-consumer"]) {
  test(`${name} runs proof despite intentionally skipped publishing dependencies`, () => {
    assert.equal(
      allowed(name, "pull_request", "branch", { "validate-tag": "skipped", publish: "skipped" }),
      true,
    );
    assert.equal(
      allowed(name, "workflow_dispatch", "branch", {
        "validate-tag": "skipped",
        publish: "skipped",
      }),
      true,
    );
  });
}

test("native builds and consumers refuse failed dependencies rather than treating always as success", () => {
  for (const name of ["build", "build-android"]) {
    assert.equal(
      allowed(name, "pull_request", "branch", { "validate-tag": "skipped", gates: "failure" }),
      false,
    );
  }
  assert.equal(
    allowed("clean-consumer", "pull_request", "branch", {
      "validate-tag": "skipped",
      publish: "skipped",
      "build-android": "failure",
    }),
    false,
  );
  assert.equal(allowed("clean-consumer", "push", "tag", { publish: "failure" }), false);
});

test("the actual prerequisite shell accepts complete exact-candidate evidence", () => {
  const result = runGate("none");
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(join(result.evidence, "validation.json"), "utf8"));
  assert.equal(report.requiredJobs.length, 11);
  assert.deepEqual(report.failures, []);
});

for (const control of ["wrong-sha", "missing-job", "skipped-job"] as const) {
  test(`the actual prerequisite shell refuses ${control} with retained exit evidence`, () => {
    const result = runGate(control);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(readFileSync(join(result.evidence, "status.txt"), "utf8"), /exit_code=1/u);
    assert.match(
      result.stderr,
      control === "wrong-sha"
        ? /exact candidate SHA/u
        : control === "missing-job"
          ? /Android emulator visual parity: 0 result/u
          : /typecheck: 1 result\(s\), completed\/skipped/u,
    );
  });
}

test("the hosted release entry point executes refusal controls before native work", () => {
  assert.match(
    job("gates"),
    /pnpm exec vitest run scripts\/__tests__\/native-release-proof\.spec\.ts/u,
  );
  assert.match(job("gates"), /pull_request/u);
});

test("proof artifact transport is loopback-only and never applies to tag publication", () => {
  const consumer = job("clean-consumer");
  assert.match(consumer, /name: Serve same-run proof assets without publishing/u);
  assert.match(consumer, /--bind 127\.0\.0\.1/u);
  assert.match(consumer, /THREENATIVE_PREBUILT_MANIFEST/u);
  assert.match(consumer, /Stop the proof asset server/u);
  assert.doesNotMatch(job("publish"), /THREENATIVE_ALLOW_INSECURE_PREBUILT/u);
});

test("the PR proof is not reported as accepted main release prerequisites", () => {
  assert.match(script("Record PR-only proof scope"), /not-release-acceptance/u);
  assert.match(script("Record PR-only proof scope"), /headSha/u);
});

function runEvidence(
  change: "complete" | "missing" | "empty" | "wrong-marker" | "wrong-exit" | "wrong-scenario",
) {
  const directory = makeTempDirSync("threenative-consumer-evidence-");
  const scenarioRoot = join(directory, "examples/native-smoke/playtests");
  mkdirSync(scenarioRoot, { recursive: true });
  for (const name of ["physics", "physics-wrong-height", "physics-mask"]) {
    writeFileSync(join(scenarioRoot, `${name}.playtest.json`), JSON.stringify({ name }));
  }
  writeFileSync(join(directory, "threenative-package-specs"), "@threenative/core\tcore\n");
  const packed = join(directory, "package");
  mkdirSync(packed);
  mkdirSync(join(directory, "packages"));
  writeFileSync(
    join(packed, "package.json"),
    JSON.stringify({ name: "@threenative/core", version: "0.3.1" }),
  );
  assert.equal(
    spawnSync("tar", ["-czf", join(directory, "packages/core.tgz"), "-C", directory, "package"])
      .status,
    0,
  );
  for (const args of [
    ["init", "-q"],
    ["add", "."],
    ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"],
  ]) {
    assert.equal(spawnSync("git", args, { cwd: directory }).status, 0);
  }
  const checkout = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
  }).stdout.trim();
  const controls = [
    ["positive", "physics", "physics", 0, "normal", ""],
    [
      "wrong-height",
      "physics-wrong-height",
      "wrong-height",
      1,
      "normal",
      "TN_PLAYTEST_POSITION_REACH_ASSERTION_FAILED",
    ],
    [
      "mask-control",
      "physics-mask",
      "mask-control",
      1,
      "normal",
      "TN_PLAYTEST_MOVEMENT_ASSERTION_FAILED",
    ],
    ["mask-positive", "physics-mask", "mask-pass", 0, "masked", ""],
    [
      "masked-physics-control",
      "physics",
      "masked-physics-control",
      1,
      "masked",
      "TN_PLAYTEST_POSITION_REACH_ASSERTION_FAILED",
    ],
    [
      "wrong-gravity",
      "physics",
      "wrong-gravity",
      1,
      "wrong-gravity",
      "TN_PLAYTEST_POSITION_REACH_ASSERTION_FAILED",
    ],
  ] as const;
  for (const [key, scenario, folder, code, variant, marker] of controls) {
    if (change === "missing" && key === "wrong-gravity") continue;
    const artifactDirectory = join(directory, `packed-android-${folder}`);
    mkdirSync(artifactDirectory);
    writeFileSync(
      join(artifactDirectory, "device-response-observations.json"),
      '{"observations":[1]}\n',
    );
    const report = {
      artifactDirectory,
      assertionResults: change === "empty" ? [] : [{ id: "positionReach", pass: code === 0 }],
      diagnostics: marker
        ? [{ code: change === "wrong-marker" ? "TN_UNRELATED_FAILURE" : marker }]
        : [],
      pass: code === 0,
      runtime: "native",
      target: "android",
      frames: 100,
      scenario: change === "wrong-scenario" ? "unrelated" : scenario,
    };
    writeFileSync(
      join(directory, `android-${key}.log`),
      `startup noise\n${JSON.stringify(report, null, 2)}\n`,
    );
    writeFileSync(
      join(directory, `android-${key}.exit`),
      `${change === "wrong-exit" ? 2 : code}\n`,
    );
    writeFileSync(
      join(directory, `android-${variant}-apk.sha256`),
      `${"c".repeat(64)}  game.apk\n`,
    );
  }
  const result = spawnSync(
    "bash",
    ["-e", "-o", "pipefail", "-c", script("Record packed consumer verification evidence")],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        RUNNER_TEMP: directory,
        GITHUB_WORKSPACE: directory,
        GITHUB_SHA: checkout,
        GITHUB_RUN_ID: "123",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_REF_TYPE: "branch",
        GITHUB_STEP_SUMMARY: join(directory, "summary.md"),
      },
    },
  );
  assert.ifError(result.error);
  return { ...result, directory };
}

test("consumer evidence records six real outcomes and integrity of the actual packed bytes", () => {
  const result = runEvidence("complete");
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(
    readFileSync(join(result.directory, "proof-consumer-evidence.json"), "utf8"),
  );
  assert.equal(report.controls.length, 6);
  assert.ok(
    report.controls.every(
      (row: { assertionCount: number; verified: boolean }) =>
        row.assertionCount > 0 && row.verified,
    ),
  );
  assert.equal(report.packages[0].version, "0.3.1");
  assert.match(report.packages[0].integrity, /^sha512-/u);
  assert.equal(report.scope, "same-run-artifacts-not-public-installation");
});

for (const change of [
  "missing",
  "empty",
  "wrong-marker",
  "wrong-exit",
  "wrong-scenario",
] as const) {
  test(`consumer evidence refuses ${change} observations and preserves failed rows`, () => {
    const result = runEvidence(change);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const report = JSON.parse(
      readFileSync(join(result.directory, "proof-consumer-evidence.json"), "utf8"),
    );
    assert.equal(report.controls.length, 6);
    assert.ok(report.controls.some((row: { verified: boolean }) => !row.verified));
    assert.ok(report.failures.length > 0);
  });
}

// The staging step copies a third-party AAR whose filename carries the SDL version. Spelled out in
// the workflow it drifted: `package-android.mjs` moved to 3.2.30 - deliberately, because 3.2.8's
// 64-bit libraries are not 16 KB LOAD-aligned - while the workflow still asked for SDL3-3.2.8.aar,
// so the first run that reached this step died with ENOENT on a file that had not existed for some
// time. Nothing before that point touches the AAR, so no earlier gate could catch it.
test("stages the SDL Android AAR by the version its owning module declares", async () => {
  const staging = workflow.match(
    /- name: Stage Android runtime payloads\n[\s\S]*?\n\x20{10}NODE\n/u,
  )?.[0];
  assert.ok(staging, "missing the Android staging step");
  assert.match(staging, /SDL3-\$\{SDL3_ANDROID_VERSION\}\.aar/u);
  assert.doesNotMatch(
    staging,
    /SDL3-\d+\.\d+\.\d+\.aar"/u,
    "the AAR filename must derive from SDL3_ANDROID_VERSION, never a literal version",
  );
  // And the name it derives has to be the file the download step actually writes.
  const { SDL3_ANDROID_VERSION } = (await import(
    "../../packages/runtime-native/scripts/package-android.mjs"
  )) as { SDL3_ANDROID_VERSION: string };
  assert.match(SDL3_ANDROID_VERSION, /^\d+\.\d+\.\d+$/u);
  const deps = readFileSync(
    join(root, "packages/runtime-native/scripts/download-deps.mjs"),
    "utf8",
  );
  assert.match(deps, /SDL3-devel-\$\{DEPS\['sdl3-android'\]\.version\}-android\.zip/u);
});
