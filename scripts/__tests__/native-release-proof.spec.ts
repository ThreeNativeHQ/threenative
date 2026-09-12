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
      "clean-consumer-windows",
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

for (const name of [
  "gates",
  "build",
  "build-android",
  "clean-consumer",
  "clean-consumer-windows",
]) {
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
  assert.equal(
    allowed("clean-consumer-windows", "pull_request", "branch", {
      "validate-tag": "skipped",
      publish: "skipped",
      build: "failure",
    }),
    false,
  );
  assert.equal(allowed("clean-consumer-windows", "push", "tag", { publish: "failure" }), false);
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

test("the main prerequisite wait outlasts a full-board main CI run", () => {
  const wait = script("Wait for the exact main CI run to finish");
  const attempts = Number(wait.match(/for attempt in \$\(seq 1 (\d+)\); do/u)?.[1]);
  const interval = Number(wait.match(/\n\s*sleep (\d+)\n/u)?.[1]);
  assert.ok(Number.isSafeInteger(attempts) && attempts > 0, "missing bounded attempt count");
  assert.ok(Number.isSafeInteger(interval) && interval > 0, "missing poll interval");
  // Observed successful ci.yml push runs on main (2026-09-10): 61.2, 62.5, 63.0, 64.8, 70.7,
  // 73.7, 88.5 and 115.4 minutes on the full board. A shorter budget refuses the candidate for
  // elapsed time instead of for its evidence, which is a false refusal.
  const budget = (attempts * interval) / 60;
  assert.ok(
    budget >= 120,
    `the prerequisite wait budget is ${budget} minutes, under the 115.4 minute worst observed main CI run`,
  );
  const timeout = Number(job("gates").match(/\n\s{4}timeout-minutes: (\d+)/u)?.[1]);
  assert.ok(
    Number.isSafeInteger(timeout) && timeout > budget,
    `gates timeout-minutes ${timeout} cannot outlast its own ${budget} minute wait`,
  );
});

// `clean-consumer-ios` and `build-ios-simulator` are the two publishing-adjacent jobs that rely on
// implicit skip-propagation rather than an explicit event condition, so they are exactly the two
// worth pinning. Their guards are already correct; this closes a coverage gap, not a defect.
for (const name of ["clean-consumer-ios", "build-ios-simulator"]) {
  test(`${name} stays out of every non-tag proof route`, () => {
    // Neither job carries an event condition; both are held out by `validate-tag` skipping and
    // emitting no `candidate_sha`. So the route has to be modelled as it actually runs - with
    // `validate-tag` skipped - rather than with the helper's default populated outputs.
    for (const event of ["pull_request", "workflow_dispatch", "push"] as const) {
      assert.equal(allowed(name, event, "branch", { "validate-tag": "skipped" }), false);
    }
    assert.equal(allowed(name, "workflow_dispatch", "tag", { "validate-tag": "skipped" }), false);
    // And the skip has to be able to propagate: no `always()`/`!cancelled()` escape, and the
    // dependency that does the holding must still be declared.
    const body = job(name).split("\n    steps:")[0] ?? "";
    assert.match(body, /\n\x20{4}needs: \[?[^\n]*validate-tag/u);
    assert.doesNotMatch(body, /always\(\)|!cancelled\(\)/u);
  });
}

test("the emulator lane reports acceleration instead of asserting it", () => {
  // Read the step out of the job rather than via `script()`: that helper needs a line between
  // `- name:` and `run: |`, and this step has none.
  const consumerJob = job("clean-consumer");
  const kvm =
    consumerJob.split("- name: Enable KVM for the emulator\n")[1]?.split("\n      - name:")[0] ??
    "";
  assert.ok(kvm.length > 0, "missing the KVM step");
  // `native-platforms.yml:317-332` records this exact defect and names this file as where it was
  // copied from: "`test -w /dev/kvm` as the last line of this step ... turned 'this runner has no
  // KVM' into a failed job, which is worse than the slow boot it was meant to fix." That lane was
  // repaired; this one still asserted, and it gates every Android control in `clean-consumer`.
  assert.doesNotMatch(
    kvm,
    /^\s*test -w \/dev\/kvm\s*$/mu,
    "a runner without KVM must fall back to software emulation, not fail the job",
  );
  assert.match(kvm, /TN_EMULATOR_ACCEL:kvm/u);
  assert.match(kvm, /TN_EMULATOR_ACCEL:software/u);
});

test("the packed consumer job outlasts its measured comparable", () => {
  const consumer = job("clean-consumer");
  const timeout = Number(consumer.match(/\n\x20{4}timeout-minutes: (\d+)/u)?.[1]);
  assert.ok(Number.isSafeInteger(timeout), "clean-consumer must declare a timeout");
  // Four successful `Android emulator visual parity` runs measured 27m00s, 27m33s, 27m50s and
  // 30m18s (2026-09-09). That job is cached, does one Android build and one emulator boot, and had
  // its own cap raised 35 -> 45 after measurement (`native-platforms.yml:217`). `clean-consumer` is
  // an uncached superset of it: packing every workspace package, scaffolding and installing a
  // consumer, a desktop build and 300-frame launch, an uncached system-image pull, three Android
  // builds, an emulator boot and six playtests.
  assert.ok(
    timeout > 45,
    `clean-consumer's ${timeout} minute cap is under its measured comparable`,
  );
  // The emulator's own boot budget, separately: a cold software-emulation boot was measured at
  // 474s (`native-platforms.yml:335-341`), against the action's 600s default.
  const boot = Number(consumer.match(/emulator-boot-timeout: (\d+)/u)?.[1]);
  assert.ok(
    Number.isSafeInteger(boot) && boot >= 900,
    `the emulator boot timeout is ${boot}s, too close to the measured 474s cold boot`,
  );
});

test("a proof run is not cancelled by the next push to its own branch", () => {
  const concurrency = workflow.split("\nconcurrency:\n")[1]?.split("\njobs:")[0] ?? "";
  assert.ok(concurrency.length > 0, "the workflow declares no concurrency block");
  // Measured over this workflow's entire history: 18 runs, 13 cancelled, 4 failed, zero successes.
  // Every cancellation was a pull_request run killed by the next push to the branch. A consumer job
  // sitting behind a ~20 minute build matrix cannot survive to completion on an actively-pushed
  // branch no matter what its own timeout is, and its evidence is candidate-keyed, so a superseded
  // run's output is still valid for the SHA it was produced from.
  assert.doesNotMatch(
    concurrency,
    /cancel-in-progress:\s*\$\{\{[^}]*ref_type[^}]*\}\}/u,
    "cancelling every non-tag run is what produced 13 cancellations in 18 runs",
  );
  assert.match(concurrency, /cancel-in-progress:\s*false/u);
  // A manual proof on main and an automatic one must not evict each other.
  assert.match(concurrency, /group:[^\n]*github\.event_name/u);
});

test("the scaffolded consumer receives every module its entry imports", () => {
  // Read it out of the job: `script()` needs a line between `- name:` and `run: |`, and this
  // step has none.
  const prepare =
    job("clean-consumer")
      .split("- name: Prepare the scaffolded consumer proof\n")[1]
      ?.split("\n      - ")[0] ?? "";
  assert.ok(prepare.length > 0, "missing the prepare step");
  const copied = new Set(
    [...prepare.matchAll(/copyFileSync\("([^"]+)"/gu)]
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined),
  );
  const entry = [...copied].find((path) => path.endsWith("/game.ts"));
  assert.ok(entry, "the prepare step no longer copies a game entry");
  const source = readFileSync(join(root, entry), "utf8");
  // Derived from the entry rather than hard-coded: the step copied `game.ts` alone, and the
  // consumer build died with
  //   [UNRESOLVED_IMPORT] Could not resolve './networking-game.js' in src/game.ts
  //   [UNRESOLVED_IMPORT] Could not resolve './worker-proof.js' in src/game.ts
  // so the next sibling import added to the entry must be copied too, not discovered on a runner.
  const directory = entry.slice(0, entry.lastIndexOf("/"));
  for (const match of source.matchAll(/from "\.\/([^"]+)\.js"/gu)) {
    const sibling = `${directory}/${match[1]}.ts`;
    assert.ok(
      copied.has(sibling),
      `${entry} imports ./${match[1]}.js, so ${sibling} must be copied into the consumer`,
    );
  }
});

test("every packed Android control names the consumer's own package and activity", () => {
  const emulator =
    job("clean-consumer").split("- name: Run packed Android physics and negative controls")[1] ??
    "";
  const invocations = emulator
    .split("\n")
    .filter((line) => line.includes("playtest/dist/runner/cli.js"));
  assert.equal(
    invocations.length,
    6,
    `expected six control invocations, found ${invocations.length}`,
  );
  for (const invocation of invocations) {
    // The runner defaults to `--package com.mystral.engine` and `--activity .MystralActivity`
    // (`packages/playtest/src/runner/config.ts:82,267`). A scaffolded consumer is neither: its
    // application id comes from its own threenative.config.ts, and its launch activity is
    // runtime-owned. Without both flags every control dies before it asserts anything:
    //   Error type 3
    //   Error: Activity class {<app>/<app>.MystralActivity} does not exist.
    assert.match(invocation, /--package "\$CONSUMER_APP_ID"/u);
    assert.match(invocation, /--activity com\.threenative\.runtime\.MystralActivity/u);
  }
});

test("the consumer's application id is derived, never assumed", () => {
  const prepare =
    job("clean-consumer")
      .split("- name: Prepare the scaffolded consumer proof\n")[1]
      ?.split("\n      - ")[0] ?? "";
  assert.match(prepare, /CONSUMER_APP_ID=/u);
  assert.match(prepare, /threenative\.config\.ts/u);
});

test("the clean consumer installs the runtime's own shared libraries", () => {
  const consumer = job("clean-consumer");
  const apt =
    consumer.split("- name: Install a software Vulkan ICD")[1]?.split("\n      - ")[0] ?? "";
  assert.ok(apt.length > 0, "missing the consumer's apt step");
  // `ldd` on the prebuilt this job downloads names these: the desktop runtime links the UI overlay,
  // which links WebKitGTK. A hosted runner has the Vulkan ICD installed here but not WebKit, so the
  // packager died with "Runtime packager exited with code 127".
  assert.match(apt, /libwebkit2gtk-4\.1-0/u);
});

test("the consumer gets the build tool helper the runtime dispatches to", () => {
  // `src/cli/tool_dispatch.cpp:52` requires a `mystral-tools` binary beside the runtime for desktop
  // packaging. PREBUILT_ASSET_NAMES published no such asset, so a consumer installing from a
  // release could not run `threenative build --target desktop` at all:
  //   Error: build tool helper is missing: .../prebuilt/linux-x64/mystral-tools
  //   Runtime packager exited with code 127.
  // PRD-262 phase 3 publishes it as a release asset per desktop row, so the install places it and
  // the proof no longer carries it out of band.
  const build = job("build");
  for (const asset of [
    "threenative-tools-linux-x64",
    "threenative-tools-darwin-arm64",
    "threenative-tools-win32-x64.exe",
  ]) {
    assert.match(build, new RegExp(`tools_asset: ${asset.replace(".", "\\.")}`, "u"));
  }
  // The helper must travel in the same uploaded artifact the publish job collects, or the lock is
  // generated from an incomplete directory and the release fails closed.
  assert.match(build, /release\/\$\{\{ matrix\.tools_asset \}\}/u);
  const consumer = job("clean-consumer");
  // Nothing may place the helper for the consumer: the whole claim is that the install does.
  assert.doesNotMatch(consumer, /--name tools-linux-x64/u);
  assert.doesNotMatch(consumer, /install -m 0755 "\$RUNNER_TEMP\/tools\/mystral-tools"/u);
  assert.match(
    consumer,
    /test -x "\$CONSUMER_TARGET\/node_modules\/@threenative\/runtime-native\/prebuilt\/linux-x64\/mystral-tools"/u,
    "the consumer gate must assert the installed helper before the desktop build",
  );
  // Order matters: asserting it after the build would not prove the install produced it.
  const assertAt = consumer.indexOf("prebuilt/linux-x64/mystral-tools");
  const buildAt = consumer.indexOf("build --target desktop");
  assert.ok(assertAt > 0 && assertAt < buildAt, "the helper check must precede the consumer build");
});

test("the same-run proof serves the published cohort, not every non-iOS key", () => {
  // macOS uploads under a name the `pattern: runtime-*` download does not collect, so a proof step
  // that demanded every non-iOS asset failed a run whose staging was exactly right:
  //   Error: Proof assets must contain every non-iOS runtime from this run, and no extras.
  const consumer = job("clean-consumer");
  assert.match(consumer, /PUBLISHED_PREBUILT_KEYS/u);
  assert.doesNotMatch(
    consumer,
    /Object\.entries\(PREBUILT_ASSET_NAMES\)\.filter\(\(\[key\]\) => !key\.startsWith\("ios-"\)\)/u,
    "the proof cohort must be derived from the published keys, not from every non-iOS key",
  );
});

function windowStep(name: string): string {
  const block = job("clean-consumer-windows").split(`- name: ${name}\n`)[1];
  assert.ok(block, `missing the Windows consumer step ${name}`);
  return block.split("\n      - ")[0] ?? "";
}

test("the Windows consumer runs on a Windows runner with every native compiler masked", () => {
  // The Linux lane's mask is `printf` plus `chmod +x`, neither of which exists on Windows, so the
  // same claim needs its own lane rather than a flag: PATHEXT resolves a `.cmd` ahead of the real
  // `.exe`, and MSVC is installed on this image, so the shadowing has to be proved, not assumed.
  assert.match(job("clean-consumer-windows"), /runs-on: windows-2025/u);
  const mask = windowStep("Mask every native toolchain entry point");
  for (const command of ["cl", "cmake", "rustc", "ninja", "cargo", "clang", "link"]) {
    assert.match(mask, new RegExp(`"${command}"`, "u"), `${command} must be masked`);
  }
  assert.match(mask, /\.cmd/u);
  assert.match(mask, /exit \/b 97/u);
  assert.match(mask, /TN_TOOLCHAIN_LOG/u);
  assert.match(mask, /cygpath -w/u);
});

test("the Windows consumer asserts the installed helper before the desktop build and never places one", () => {
  const consumer = job("clean-consumer-windows");
  // Nothing may place the helper for the consumer: the whole claim is that the install does.
  assert.doesNotMatch(consumer, /--name tools-/u);
  assert.doesNotMatch(consumer, /install -m 0755/u);
  const build = windowStep("Install and build without a native toolchain");
  assert.match(build, /install-status\.json/u);
  assert.match(build, /prebuilt\/win32-x64\/mystral-tools\.exe/u);
  assert.match(build, /build --target desktop/u);
  const helperAt = build.indexOf("prebuilt/win32-x64/mystral-tools.exe");
  const buildAt = build.indexOf("build --target desktop");
  assert.ok(helperAt > 0 && helperAt < buildAt, "the helper check must precede the consumer build");
});

test("the Windows consumer launches the packed executable and reports its first frame", () => {
  const launch = windowStep("Launch the packed desktop game for 300 frames");
  assert.match(launch, /--screenshot/u);
  assert.match(launch, /--frames 300/u);
  assert.match(launch, /TN_NATIVE_SMOKE_READY:webgpu/u);
  assert.match(launch, /TN_NATIVE_SMOKE_FIRST_FRAME/u);
  assert.match(launch, /TN_NATIVE_SMOKE_300_FRAMES:300/u);
  // A run that does not name its adapter may be a software rasteriser; the lane records it.
  // The shell ERE escapes the brackets, so assert the adapter alternation rather than the escaping.
  assert.match(launch, /WebGPU/u);
  assert.match(launch, /Adapter\|Vendor\|Backend/u);
  assert.match(launch, /windows-adapter\.txt/u);
});

test("the Windows consumer is a mandatory release prerequisite, not advisory", () => {
  assert.match(
    job("finalize"),
    /needs: \[validate-tag, clean-consumer, clean-consumer-ios, clean-consumer-windows\]/u,
  );
  assert.match(
    job("cleanup-failed-release"),
    /needs: \[validate-tag, publish, clean-consumer, clean-consumer-ios, clean-consumer-windows\]/u,
  );
});

test("no mapping in the workflow repeats a key", () => {
  // `yaml.safe_load` and most parsers accept a repeated key silently; GitHub does not, and rejects
  // the whole file before any job starts. A Phase 9 edit left `if-no-files-found` twice in one
  // `with:` block, and the next three runs reported "This run likely failed because of a workflow
  // file issue" with zero jobs, which reads nothing like a duplicate key.
  const lines = workflow.split("\n");
  const seen = new Map<number, Set<string>>();
  const duplicates: string[] = [];
  lines.forEach((line, index) => {
    if (/^\s*#/u.test(line) || line.trim() === "") return;
    const match = line.match(/^(\x20*)(-\x20)?([A-Za-z_][\w.-]*):(\s|$)/u);
    if (!match) return;
    const indent = (match[1]?.length ?? 0) + (match[2] ? 2 : 0);
    const key = match[3] ?? "";
    // A list item starts a fresh mapping, and so does any dedent.
    if (match[2]) for (const depth of [...seen.keys()]) if (depth >= indent) seen.delete(depth);
    for (const depth of [...seen.keys()]) if (depth > indent) seen.delete(depth);
    const scope = seen.get(indent) ?? new Set<string>();
    if (scope.has(key)) duplicates.push(`${key} (line ${index + 1})`);
    scope.add(key);
    seen.set(indent, scope);
  });
  assert.deepEqual(duplicates, [], `repeated keys: ${duplicates.join(", ")}`);
});
