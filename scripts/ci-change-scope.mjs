#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const PROSE_ROOTS = ["docs/PRDs/", "docs/verification/"];
const EXCLUDED_MARKDOWN = [
  /^docs\/PRDs\/realism-effects\/README\.md$/u,
  /^docs\/verification\/(?:PRD-289-conventions|alpha-bar|runtime-perf-state)\.md$/u,
  /^docs\/verification\/realism-effects-ao(?:-|\.)/u,
  /^docs\/verification\/worker-wake(?:-|\.)/u,
  /^docs\/verification\/native-(?:runtime-)?(?:census|coverage)(?:-|\.)/u,
  /^docs\/verification\/(?:round-|parity-|sweep-|tier-1-)/u,
];

function requiredValue(argv, index, argument) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`CI_SCOPE_MALFORMED_ARGUMENT: ${argument} needs a value`);
  }
  return value;
}

function parseArgs(argv) {
  const valueArguments = new Map([
    ["--root", "root"],
    ["--base", "base"],
    ["--head", "head"],
    ["--event-name", "eventName"],
    ["--event", "eventName"],
  ]);
  const options = {
    eventName: undefined,
    format: "text",
    head: undefined,
    root: process.cwd(),
    base: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const key = valueArguments.get(argument);
    if (key !== undefined) {
      options[key] = requiredValue(argv, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--format") {
      const value = requiredValue(argv, index, argument);
      if (value !== "text" && value !== "json" && value !== "github") {
        throw new Error("CI_SCOPE_MALFORMED_ARGUMENT: --format must be text, json or github");
      }
      options.format = value;
      index += 1;
      continue;
    }
    throw new Error(`CI_SCOPE_MALFORMED_ARGUMENT: unknown argument '${argument}'`);
  }
  return options;
}

function git(root, args) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16,
  });
}

function full(reason, files = []) {
  return { files, reason, scope: "full", selection: "full" };
}

function prose(files) {
  return {
    files,
    reason: `all ${String(files.length)} changed path(s) are inert Markdown under docs/PRDs or docs/verification`,
    scope: "prose",
    selection: "prose",
  };
}

function parseNameStatus(output) {
  const fields = output.endsWith("\0") ? output.slice(0, -1).split("\0") : output.split("\0");
  if (fields.length === 1 && fields[0] === "") return { error: "the diff has no changed paths" };
  const paths = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index];
    index += 1;
    if (!status || !/^[A-Z][0-9]*$/u.test(status)) {
      return { error: `malformed diff status ${JSON.stringify(status ?? "")}` };
    }
    const count = status[0] === "R" || status[0] === "C" ? 2 : 1;
    const changed = fields.slice(index, index + count);
    if (changed.length !== count || changed.some((file) => !file)) {
      return { error: `malformed ${status[0]} diff record` };
    }
    paths.push(...changed);
    index += count;
  }
  return { paths: [...new Set(paths)].sort() };
}

function exclusionReason(file) {
  if (/(?:^|\/)AGENTS\.md$/u.test(file) || /(?:^|\/)CLAUDE\.md$/u.test(file)) {
    return "agent instruction mirror";
  }
  if (EXCLUDED_MARKDOWN.some((pattern) => pattern.test(file))) {
    return "a Markdown file consumed by an executable fixture, parser or gate";
  }
  if (!file.endsWith(".md")) return "a non-Markdown path";
  if (!PROSE_ROOTS.some((root) => file.startsWith(root))) {
    return "outside the narrow prose roots";
  }
  return undefined;
}

function classify(options) {
  if (options.eventName !== undefined && options.eventName !== "pull_request") {
    return full(`event '${options.eventName}' requires complete verification`);
  }
  if (options.base === undefined || options.head === undefined) {
    return full("the pull-request merge-base inputs are missing");
  }

  const mergeBase = git(options.root, ["merge-base", options.base, options.head]);
  if (
    mergeBase.status !== 0 ||
    mergeBase.stdout.trim().split(/\r?\n/u).length !== 1 ||
    !mergeBase.stdout.trim()
  ) {
    return full("the pull-request merge base could not be resolved");
  }
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
  if (diff.status !== 0) return full("Git could not discover the pull-request diff");
  if (diff.stdout.length === 0) return full("the pull-request diff is empty");
  const parsed = parseNameStatus(diff.stdout);
  if ("error" in parsed) return full(`the pull-request diff is incomplete: ${parsed.error}`);
  if (parsed.paths.length === 0) return full("the pull-request diff is empty");

  for (const file of parsed.paths) {
    const reason = exclusionReason(file);
    if (reason !== undefined) return full(`${JSON.stringify(file)} is ${reason}`, parsed.paths);
  }
  return prose(parsed.paths);
}

function output(result, format) {
  if (format === "json") {
    console.log(JSON.stringify(result));
    return;
  }
  if (format === "github") {
    console.log(`scope=${result.scope}`);
    console.log(`selection=${result.selection}`);
    console.log(`reason=${result.reason}`);
    return;
  }
  console.log(`CI change scope: ${result.scope}`);
  console.log(`Reason: ${result.reason}`);
  if (result.files.length > 0) console.log(`Changed paths: ${result.files.join(", ")}`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  output(classify(options), options.format);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
