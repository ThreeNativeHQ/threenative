#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const PROSE_ROOTS = ["docs/PRDs/", "docs/verification/"];
const EXCLUDED_MARKDOWN = [
  /^docs\/PRDs\/realism-effects\/README\.md$/u,
  /^docs\/verification\/(?:PRD-289-conventions|alpha-bar|runtime-perf-state)\.md$/u,
  /^docs\/verification\/realism-effects-ao(?:-|\.)/u,
  /^docs\/verification\/worker-wake(?:-|\.)/u,
  /^docs\/verification\/native-(?:runtime-)?(?:census|coverage)(?:-|\.)/u,
  /^docs\/verification\/(?:round-|parity-|sweep-|tier-1-)/u,
];
const SELECTIONS = new Set(["full", "prose", "instructions", "website", "mixed"]);
// No package/template exemption yet: core, playtest, scaffolding, physics, fixtures, toolchains
// and dependencies have native consumers. Narrow those only with an explicit dependency proof.
const FULL_JOBS = [
  "typecheck",
  "test",
  "test-unit",
  "test-native",
  "test-browser",
  "test-playtest",
  "golden-path-template",
  "template-nonvisual",
  "golden-path",
  "benchmark",
  "build",
  "build-artifacts",
  "budgets",
  "performance-contracts",
  "native-platforms",
];

export function selectionPlan(selection, reason, files = [], candidateSha = "") {
  const full = selection === "full";
  const checks = {
    docs: true,
    instructions: full || selection === "instructions" || selection === "mixed",
    website: full || selection === "website" || selection === "mixed",
    workspace: full,
    native: full,
    templates: full,
  };
  const jobs = Object.fromEntries(
    FULL_JOBS.map((name) => [
      name,
      {
        required: full,
        reason: full
          ? `Full dependency closure: ${reason}`
          : `Exempt: ${selection} changes do not modify runtime, package, template or shared build inputs`,
      },
    ]),
  );
  jobs.lint = {
    required: true,
    reason: "Documentation, formatting and selected instruction contracts",
  };
  jobs["supply-chain"] = {
    required: true,
    reason: "Changed prose can still contain credentials; dependency review remains applicable",
  };
  jobs.website = {
    required: checks.website,
    reason: checks.website
      ? "Website build, types, unit and browser tests (including its consumed contracts)"
      : "Exempt: no website or shared dependency change",
  };
  return { version: 1, files, reason, scope: selection, selection, candidateSha, checks, jobs };
}

export function validatePlan(value) {
  if (
    !value ||
    typeof value !== "object" ||
    value.version !== 1 ||
    !SELECTIONS.has(value.selection) ||
    typeof value.reason !== "string" ||
    !value.reason ||
    /[\r\n]/u.test(value.reason) ||
    !Array.isArray(value.files) ||
    value.files.some((file) => typeof file !== "string" || !file || file.includes("\0")) ||
    typeof value.candidateSha !== "string" ||
    !/^[0-9a-f]{40}$/u.test(value.candidateSha)
  ) {
    throw new Error(
      "CI_SCOPE_INVALID_PLAN: missing or malformed selection, paths, reason or candidate SHA",
    );
  }
  const expected = selectionPlan(value.selection, value.reason, value.files, value.candidateSha);
  for (const field of ["scope", "checks", "jobs"]) {
    if (JSON.stringify(value[field]) !== JSON.stringify(expected[field])) {
      throw new Error(`CI_SCOPE_INVALID_PLAN: ${field} does not match the selected check families`);
    }
  }
  return expected;
}

function requiredValue(argv, index, argument) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`CI_SCOPE_MALFORMED_ARGUMENT: ${argument} needs a value`);
  }
  return value;
}

function parseArgs(argv) {
  const keys = new Map([
    ["--root", "root"],
    ["--base", "base"],
    ["--head", "head"],
    ["--target", "target"],
    ["--event-name", "eventName"],
    ["--event", "eventName"],
    ["--format", "format"],
    ["--validate-plan", "plan"],
    ["--candidate-sha", "candidateSha"],
  ]);
  const options = { root: process.cwd(), format: "text" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--full" || argument === "--local") {
      options[argument.slice(2)] = true;
    } else if (keys.has(argument)) {
      options[keys.get(argument)] = requiredValue(argv, index, argument);
      index += 1;
    } else {
      throw new Error(`CI_SCOPE_MALFORMED_ARGUMENT: unknown argument '${argument}'`);
    }
  }
  if (!["text", "json", "github"].includes(options.format)) {
    throw new Error("CI_SCOPE_MALFORMED_ARGUMENT: --format must be text, json or github");
  }
  return options;
}

function git(root, args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 });
}

function parseNameStatus(output) {
  if (!output.endsWith("\0")) return { error: "unterminated name-status records" };
  const fields = output.slice(0, -1).split("\0");
  const paths = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    if (!status || !/^(?:[ADM]|[RC](?:100|[1-9]?[0-9]))$/u.test(status)) {
      return { error: `unsupported or malformed diff status ${JSON.stringify(status ?? "")}` };
    }
    const count = status[0] === "R" || status[0] === "C" ? 2 : 1;
    const changed = fields.slice(index, index + count);
    if (changed.length !== count || changed.some((file) => !file))
      return { error: `malformed ${status} diff record` };
    paths.push(...changed);
    index += count;
  }
  return { paths: [...new Set(paths)].sort() };
}

function pathFamily(file, selective) {
  if (/(?:^|\/)(?:AGENTS|CLAUDE)\.md$/u.test(file)) {
    // Root and playtest instruction consumers have explicit contracts in the instruction lane.
    // Shipped template/native instructions may affect scaffolding and platform contracts too.
    return selective && /^(?:packages\/playtest\/)?(?:AGENTS|CLAUDE)\.md$/u.test(file)
      ? "instructions"
      : "an instruction consumer whose narrower dependency closure is unproven";
  }
  if (EXCLUDED_MARKDOWN.some((pattern) => pattern.test(file)))
    return "a Markdown file consumed by an executable fixture, parser or gate";
  if (file.endsWith(".md") && PROSE_ROOTS.some((root) => file.startsWith(root))) return "prose";
  // The site is a private, non-published consumer. Its own dependency manifest is deliberately
  // NOT isolated: dependency/catalog/lockfile changes must exercise the entire workspace.
  if (
    selective &&
    /^site\/(?:src\/|public\/|scripts\/|__tests__\/|e2e\/|(?:index\.html|(?:vite|playwright)\.config\.ts|tsconfig\.json|README\.md)$)/u.test(
      file,
    )
  )
    return "website";
  return file.endsWith(".md") ? "outside the narrow prose roots" : "a non-Markdown path";
}

function changedPaths(options) {
  if (!options.base || !options.head)
    return { error: "the pull-request merge-base inputs are missing" };
  const mergeBase = git(options.root, ["merge-base", "--all", options.base, options.head]);
  if (mergeBase.status !== 0 || !/^[0-9a-f]{40}\n?$/u.test(mergeBase.stdout))
    return { error: "the pull-request merge base could not be resolved" };
  const base = mergeBase.stdout.trim();
  const diff = git(options.root, [
    "diff",
    "--name-status",
    "-z",
    "--find-renames",
    "--no-ext-diff",
    base,
    options.head,
    "--",
  ]);
  if (diff.status !== 0) return { error: "Git could not discover the pull-request diff" };
  if (!diff.stdout) return { error: "the pull-request diff is empty" };
  const parsed = parseNameStatus(diff.stdout);
  if ("error" in parsed) return { error: `the pull-request diff is incomplete: ${parsed.error}` };
  // A symlink named .md is not inert prose. Check BOTH trees, including deleted/renamed inputs.
  for (const ref of [base, options.head]) {
    const tree = git(options.root, ["ls-tree", "-r", "-z", ref, "--", ...parsed.paths]);
    if (
      tree.status !== 0 ||
      tree.stdout.split("\0").some((entry) => entry && !/^100(?:644|755) blob /u.test(entry))
    ) {
      return { error: "the diff contains an unresolved, symlink or submodule input" };
    }
  }
  return parsed;
}

export function classify(options) {
  const candidateSha =
    options.candidateSha ?? git(options.root, ["rev-parse", "HEAD"]).stdout.trim();
  const full = (reason, files = []) => selectionPlan("full", reason, files, candidateSha);
  if (options.full) return full("explicit full verification requested");
  if (options.eventName !== undefined && options.eventName !== "pull_request")
    return full(`event ${JSON.stringify(options.eventName)} requires complete verification`);
  if (options.target !== undefined && options.target !== "develop")
    return full(
      `target ${JSON.stringify(options.target)} requires complete verification (promotion/rollback policy)`,
    );
  if (options.local) {
    const status = git(options.root, ["status", "--porcelain", "-z", "--untracked-files=normal"]);
    if (status.status !== 0 || status.stdout)
      return full(
        "local working tree is dirty or unreadable; committed-diff exemptions are unsafe",
      );
  }
  const parsed = changedPaths(options);
  if ("error" in parsed) return full(parsed.error);
  const families = new Set();
  for (const file of parsed.paths) {
    const family = pathFamily(file, options.target === "develop");
    if (!["prose", "instructions", "website"].includes(family))
      return full(`${JSON.stringify(file)} is ${family}`, parsed.paths);
    families.add(family);
  }
  // Prose is already covered by lint's doc lane; mixed means website AND instruction consumers.
  const selection =
    families.has("website") && families.has("instructions")
      ? "mixed"
      : families.has("website")
        ? "website"
        : families.has("instructions")
          ? "instructions"
          : "prose";
  const reason = `all ${String(parsed.paths.length)} changed path(s) match explicit ${[...families].sort().join(" + ")} dependency rules`;
  return selectionPlan(selection, reason, parsed.paths, candidateSha);
}

function output(result, format) {
  if (format === "json") return console.log(JSON.stringify(result));
  if (format === "github") {
    for (const key of ["scope", "selection", "reason"]) console.log(`${key}=${result[key]}`);
    console.log(`candidate_sha=${result.candidateSha}`);
    console.log(`plan=${JSON.stringify(result)}`);
    return;
  }
  console.log(
    `CI change scope: ${result.scope}\nCandidate: ${result.candidateSha}\nReason: ${result.reason}`,
  );
  for (const [name, job] of Object.entries(result.jobs))
    console.log(`${job.required ? "Required" : "Exempt"}: ${name} — ${job.reason}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    output(
      options.plan !== undefined ? validatePlan(JSON.parse(options.plan)) : classify(options),
      options.format,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
