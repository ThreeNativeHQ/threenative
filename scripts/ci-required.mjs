#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { validatePlan } from "./ci-change-scope.mjs";

try {
  const needs = JSON.parse(process.env.TN_CI_NEEDS ?? "null");
  if (needs?.scope?.result !== "success")
    throw new Error(
      "CI_REQUIRED_SCOPE_NOT_SUCCESS: classification failed, was cancelled, skipped or is missing",
    );
  const plan = validatePlan(JSON.parse(needs.scope.outputs?.plan ?? "null"));
  const checkout = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  if (checkout.status !== 0 || checkout.stdout.trim() !== plan.candidateSha)
    throw new Error(
      "CI_REQUIRED_CANDIDATE_MISMATCH: verdict must execute the classified candidate",
    );
  if (process.env.TN_CI_EVENT === "pull_request") {
    const { TN_CI_BASE_SHA: base, TN_CI_HEAD_SHA: head } = process.env;
    // The candidate is frozen by the exact base/head parent assertion below, not by the head
    // branch's name. A `promotion/<head-sha>` ref restated a SHA that check already verifies.
    if (
      process.env.TN_CI_CUTOVER === "true" &&
      process.env.TN_CI_BASE_REF === "main" &&
      plan.selection !== "full"
    )
      throw new Error("CI_REQUIRED_MAIN_FULL: main requires complete verification");
    const commit = spawnSync("git", ["cat-file", "-p", "HEAD"], { encoding: "utf8" });
    const headers = commit.stdout?.split("\n\n", 1)[0] ?? "";
    const parents = [...headers.matchAll(/^parent ([0-9a-f]{40})$/gmu)].map((match) => match[1]);
    if (
      commit.status !== 0 ||
      !/^[0-9a-f]{40}$/u.test(base ?? "") ||
      !/^[0-9a-f]{40}$/u.test(head ?? "") ||
      JSON.stringify(parents) !== JSON.stringify([base, head])
    ) {
      throw new Error(
        "CI_REQUIRED_PR_CANDIDATE_MISMATCH: expected the exact proposed base/head merge; changed inputs require fresh verification",
      );
    }
  }
  const failures = [];
  const lines = [
    "## Required CI verdict",
    "",
    `Candidate: \`${plan.candidateSha}\``,
    `Selection: \`${plan.selection}\` — ${plan.reason}`,
    "",
  ];
  for (const [name, job] of Object.entries(plan.jobs)) {
    const result = needs[name]?.result;
    lines.push(
      `- ${name}: ${job.required ? `required (${result ?? "missing"})` : "exempt"} — ${job.reason}`,
    );
    if (job.required && result !== "success")
      failures.push(`CI_REQUIRED_JOB_NOT_SUCCESS: ${name} (${result ?? "missing"})`);
  }
  // New coverage jobs cannot silently sit outside the declared plan. Reporting work belongs in
  // run-summary, which is deliberately not a dependency of the protected verdict.
  for (const name of Object.keys(needs)) {
    if (name !== "scope" && !Object.hasOwn(plan.jobs, name))
      failures.push(`CI_REQUIRED_UNMAPPED_JOB: ${name}`);
  }
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  if (failures.length) throw new Error(failures.join("\n"));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
