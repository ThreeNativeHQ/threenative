#!/usr/bin/env node

/**
 * The one verdict a protected branch has to require.
 *
 * A selective board cannot be guarded by requiring individual jobs: the jobs a change deselects
 * never report, and GitHub counts a missing or skipped required check as satisfied. So the board
 * gets exactly one always-evaluated check, and it asserts the whole shape of the run — the
 * classifier succeeded, every job the classifier selected succeeded, and every job that did not
 * run is one the classifier explicitly deselected.
 *
 * Fail closed. A selected job that failed, was cancelled, is missing from the results, or skipped
 * without being deselected is a red verdict, and so is a job this repository's own table does not
 * know about.
 */

import { readFileSync } from "node:fs";
import {
  CI_JOB_SELECTION,
  CI_REPORTING_JOBS,
  jobIsSelected,
  listFamilies,
  parseFamilies,
} from "./ci-check-families.mjs";

function requiredValue(argv, index, argument) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`CI_REQUIRED_MALFORMED_ARGUMENT: ${argument} needs a value`);
  }
  return value;
}

export function parseArgs(argv) {
  const keys = new Map([
    ["--results", "results"],
    ["--families", "families"],
    ["--event-name", "eventName"],
  ]);
  const options = { eventName: undefined, families: undefined, results: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const key = keys.get(argv[index]);
    if (key === undefined) {
      throw new Error(`CI_REQUIRED_MALFORMED_ARGUMENT: unknown argument '${argv[index]}'`);
    }
    options[key] = requiredValue(argv, index, argv[index]);
    index += 1;
  }
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined)
      throw new Error(`CI_REQUIRED_MALFORMED_ARGUMENT: --${key} is required`);
  }
  return options;
}

/**
 * The verdict, as rows a run summary can print and a caller can assert on.
 *
 * `results` is `toJSON(needs)`: a map of job name to `{ result }`. The reporting jobs are not in
 * it — the verdict cannot wait on the summary that reports the verdict — and every other job in
 * `CI_JOB_SELECTION` must be, or the workflow has grown a job this check does not watch.
 */
export function ciRequiredRows(results, families, eventName) {
  const watched = Object.keys(CI_JOB_SELECTION).filter((job) => !CI_REPORTING_JOBS.includes(job));
  const rows = [];
  for (const job of watched) {
    const selected = jobIsSelected(job, families, eventName);
    const observed = results[job];
    if (observed === undefined || typeof observed.result !== "string" || !observed.result) {
      rows.push({
        job,
        ok: false,
        result: "missing",
        selected,
        why: "the run reported no result for this job",
      });
      continue;
    }
    const result = observed.result;
    if (selected) {
      rows.push({
        job,
        ok: result === "success",
        result,
        selected,
        why: result === "success" ? "selected and green" : `selected but ${result}`,
      });
      continue;
    }
    rows.push({
      job,
      ok: result === "skipped" || result === "success",
      result,
      selected,
      why: result === "skipped" ? "not selected by this change" : `not selected, yet ${result}`,
    });
  }
  const unknown = Object.keys(results).filter(
    (job) => !(job in CI_JOB_SELECTION) && !CI_REPORTING_JOBS.includes(job),
  );
  for (const job of unknown) {
    rows.push({
      job,
      ok: false,
      result: results[job]?.result ?? "missing",
      selected: false,
      why: "this job has no entry in CI_JOB_SELECTION, so nothing decides whether it was required",
    });
  }
  return rows;
}

export function formatCiRequired(rows, families) {
  const failed = rows.filter((row) => !row.ok);
  const lines = [
    "## ci-required",
    "",
    `- Selected check families: ${listFamilies(families)}`,
    "",
    "| Job | Selected | Result | Verdict |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    lines.push(
      `| \`${row.job}\` | ${row.selected ? "yes" : "no"} | ${row.result} | ${row.ok ? "ok" : "**blocks merge**"} — ${row.why} |`,
    );
  }
  lines.push("");
  lines.push(
    failed.length === 0
      ? `All ${String(rows.length)} watched jobs are accounted for.`
      : `**${String(failed.length)} of ${String(rows.length)} watched jobs block merging:** ${failed.map((row) => row.job).join(", ")}.`,
  );
  return lines.join("\n");
}

function main(argv) {
  const options = parseArgs(argv);
  const families = parseFamilies(options.families);
  const results = JSON.parse(readFileSync(options.results, "utf8"));
  const rows = ciRequiredRows(results, families, options.eventName);
  console.log(formatCiRequired(rows, families));
  return rows.every((row) => row.ok) ? 0 : 1;
}

// Only the CLI invocation exits; the specs import the functions above.
if (process.argv[1]?.endsWith("ci-required-verdict.mjs")) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
