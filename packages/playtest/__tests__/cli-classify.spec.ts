import { expect, test } from "vitest";

import { classifyRunnerError, exitCodeForReport } from "../src/runner/cli.js";
import { PlaytestCliUsageError } from "../src/runner/config.js";
import { PlaytestScenarioError } from "../src/scenario.js";

test.each([
  [new PlaytestCliUsageError("Missing scenario path."), "TN_PLAYTEST_CLI_USAGE"],
  [new Error("browserType.launch: Target page, context or browser has been closed"), "TN_PLAYTEST_BROWSER_UNAVAILABLE"],
  [new Error("browserType.launch: Timeout 180000ms exceeded"), "TN_PLAYTEST_BROWSER_UNAVAILABLE"],
  [new Error("page.evaluate: Error: Cannot advance fixed-step clock"), "TN_PLAYTEST_RUNNER_FAILED"],
  [new Error("page.goto: Timeout 15000ms exceeded"), "TN_PLAYTEST_PAGE_UNREACHABLE"],
  [new Error("ENOENT: no such file or directory, open 'playtests/boot-to-play.playtest.json'"), "TN_PLAYTEST_SCENARIO_UNREADABLE"],
  [new Error("Playtest scenario 'playtests/boot-to-play.playtest.json' could not be read."), "TN_PLAYTEST_SCENARIO_UNREADABLE"],
] as const)("classifies %s as %s", (error, code) => {
  expect(classifyRunnerError(error, { cwd: "/project" }).code).toBe(code);
});

test("an invalid scenario keeps its existing diagnostic code", () => {
  const error = new PlaytestScenarioError({
    code: "TN_PLAYTEST_SCENARIO_INVALID",
    message: "invalid scenario",
    severity: "error",
  });

  expect(classifyRunnerError(error).code).toBe("TN_PLAYTEST_SCENARIO_INVALID");
});

test("an unrecognised error gets the unrecognised fix lead", () => {
  const diagnostic = classifyRunnerError(new Error("page.evaluate: Error: Cannot advance"));

  expect(diagnostic.code).toBe("TN_PLAYTEST_RUNNER_FAILED");
  expect(diagnostic.fix.instruction).toContain("Unexpected runner error");
});

test.each([
  [{ pass: true, assertionResults: [] }, 0],
  [{ pass: false, assertionResults: [{ id: "assertion", pass: false }] }, 1],
  [{ pass: false }, 2],
] as const)("report %o produces exit code %i", (report, exitCode) => {
  expect(exitCodeForReport(report)).toBe(exitCode);
});
