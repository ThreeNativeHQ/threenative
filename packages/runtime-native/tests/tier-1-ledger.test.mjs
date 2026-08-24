import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const ledgerPath = join(repositoryRoot, "docs/verification/tier-1-2026-08-10.md");
const ledger = readFileSync(ledgerPath, "utf8");

const TARGET_COLUMNS = ["Target", "Command", "Pass", "Fail", "Blocked", "Exit", "Outcome"];
const CONTROL_COLUMNS = ["ID", "Control", "Result", "Exit", "Evidence"];
const GATE_COLUMNS = ["Gate", "Exit", "Result"];

const TARGETS = [
  ["Browser", "67", "0", "0", "0"],
  ["Desktop Linux", "65", "1", "1", "1"],
  ["Android emulator", "27", "40", "0", "1"],
];
const CONTROL_IDS = [
  "phase-1-drop-pointer",
  "phase-2-excluded-pass",
  "phase-3-missing-device",
  "phase-4-slow-web",
  "phase-4-slow-native",
  "phase-4-startup",
];
const GATES = ["pnpm typecheck", "pnpm lint", "pnpm test", "pnpm budgets"];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function sectionBody(markdown, heading) {
  const headingMatch = new RegExp(`^${escapeRegExp(heading)}$`, "mu").exec(markdown);
  assert.ok(headingMatch, `missing heading: ${heading}`);

  const bodyStart = headingMatch.index + headingMatch[0].length;
  const remainder = markdown.slice(bodyStart);
  const nextHeading = remainder.search(/^## /mu);
  return remainder.slice(0, nextHeading === -1 ? remainder.length : nextHeading);
}

function cells(line, context) {
  const trimmed = line.trim();
  assert.match(trimmed, /^\|.*\|$/u, `${context} is not a Markdown table row`);
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function parseTable(markdown, heading, expectedColumns) {
  const lines = sectionBody(markdown, heading)
    .split(/\r?\n/u)
    .filter((line) => /^\s*\|.*\|\s*$/u.test(line));
  assert.ok(lines.length >= 3, `${heading} must contain a header, separator, and data row`);

  const header = cells(lines[0], `${heading} header`);
  assert.deepEqual(header, expectedColumns, `${heading} header changed`);

  const separator = cells(lines[1], `${heading} separator`);
  assert.equal(separator.length, expectedColumns.length, `${heading} separator width changed`);
  assert.ok(
    separator.every((cell) => /^:?-{3,}:?$/u.test(cell)),
    `${heading} separator is invalid`,
  );

  const rows = lines.slice(2).map((line) => cells(line, `${heading} data`));
  for (const row of rows) {
    assert.equal(row.length, expectedColumns.length, `${heading} row width changed`);
    assert.ok(row.every((cell) => cell.length > 0), `${heading} contains an empty cell`);
  }
  return { rows };
}

function uniqueRow(rows, firstCell, heading) {
  const matches = rows.filter((row) => row[0] === firstCell);
  assert.equal(matches.length, 1, `${heading} row ${firstCell} must appear exactly once`);
  return matches[0];
}

function validateLedger(markdown) {
  assert.match(markdown, /^<!-- schemaVersion: 1 -->$/mu);
  for (const heading of ["## Target results", "## Controls", "## Gates", "## Verdict"]) {
    assert.match(markdown, new RegExp(`^${escapeRegExp(heading)}$`, "mu"));
  }

  const targetTable = parseTable(markdown, "## Target results", TARGET_COLUMNS);
  assert.equal(targetTable.rows.length, TARGETS.length, "target row count changed");
  for (const [target, pass, fail, blocked, exit] of TARGETS) {
    const row = uniqueRow(targetTable.rows, target, "Target results");
    assert.deepEqual(row.slice(2, 6), [pass, fail, blocked, exit], `${target} result changed`);
  }

  const controlsTable = parseTable(markdown, "## Controls", CONTROL_COLUMNS);
  assert.equal(controlsTable.rows.length, CONTROL_IDS.length, "control row count changed");
  for (const id of CONTROL_IDS) {
    const row = uniqueRow(controlsTable.rows, `\`${id}\``, "Controls");
    assert.match(row[2], /^Observed red:/u, `${id} was not observed red`);
    assert.equal(row[3], "1", `${id} must exit 1`);
  }

  const gatesTable = parseTable(markdown, "## Gates", GATE_COLUMNS);
  assert.equal(gatesTable.rows.length, GATES.length, "gate row count changed");
  for (const gate of GATES) {
    const row = uniqueRow(gatesTable.rows, `\`${gate}\``, "Gates");
    assert.equal(row[1], "0", `${gate} must exit 0`);
  }

  const verdict = sectionBody(markdown, "## Verdict");
  assert.match(verdict, /\bTier 1 not reached\b/u);
  assert.match(verdict, /no mobile-readiness claim/u);
  assert.doesNotMatch(markdown, /\bmobile-ready\b/iu);
  assert.doesNotMatch(
    markdown,
    /\bmobile[- ]readiness\b[^.\n]{0,80}\b(?:met|complete|green|passed|ready)\b/iu,
  );

  assert.doesNotMatch(markdown, /node --input-type=module -e '[^`\n]*tier-1-2026-08-10\.md/u);
  assert.doesNotMatch(markdown, /tier-1-ledger-schema: PASS/u);
  assert.match(
    markdown,
    /```sh\npnpm exec vitest run --config packages\/runtime-native\/vitest\.config\.ts --dir packages\/runtime-native packages\/runtime-native\/tests\/tier-1-ledger\.test\.mjs\n```/u,
  );
  return true;
}

function removeRow(markdown, heading, firstCell) {
  const line = sectionBody(markdown, heading)
    .split(/\r?\n/u)
    .find((candidate) => candidate.startsWith(`| ${firstCell} |`));
  assert.ok(line, `cannot mutate missing row ${firstCell}`);
  assert.equal(markdown.split(line).length, 2, `row ${firstCell} is not unique`);
  return markdown.replace(line, "");
}

test("the committed Tier 1 ledger passes the external schema validator", () => {
  assert.equal(validateLedger(ledger), true);
});

test("the external validator rejects a removed target, control, or gate row", () => {
  const mutations = [
    ["target", "## Target results", "Browser"],
    ["control", "## Controls", "`phase-1-drop-pointer`"],
    ["gate", "## Gates", "`pnpm typecheck`"],
  ];

  for (const [kind, heading, firstCell] of mutations) {
    const mutatedLedger = removeRow(ledger, heading, firstCell);
    assert.throws(
      () => validateLedger(mutatedLedger),
      undefined,
      `${kind} row removal must fail validation`,
    );
  }
});
