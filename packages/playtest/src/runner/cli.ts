#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PlaytestScenarioError } from "../scenario.js";
import {
  formatUsage,
  parseStandalonePlaytestArgs,
  PlaytestCliUsageError,
  type IStandalonePlaytestConfig,
} from "./config.js";
import { initStandalonePlaytest } from "./init.js";
import { runAndroidPlaytest } from "./androidRunner.js";
import { runIosPlaytest } from "./iosRunner.js";
import { recordToScenario } from "./recording.js";
import { runStandalonePlaytest } from "./runner.js";

export interface IRunnerDiagnostic {
  code: string;
  fix: { instruction: string };
  message: string;
  severity: "error";
}

export function exitCodeForReport(report: {
  assertionResults?: readonly unknown[];
  diagnostics?: ReadonlyArray<{ code?: string }>;
  pass: boolean;
}): 0 | 1 | 2 {
  if (report.pass) return 0;
  if (report.diagnostics?.some(({ code }) => code === "TN_PLAYTEST_FRAMEBUFFER_WINDOW_NOT_REACHED")) return 2;
  return report.assertionResults === undefined ? 2 : 1;
}

export function classifyRunnerError(
  error: unknown,
  options: { cwd?: string; scenarioPath?: string } = {},
): IRunnerDiagnostic {
  if (error instanceof PlaytestCliUsageError) {
    return diagnostic("TN_PLAYTEST_CLI_USAGE", error.message, "Run threenative-playtest --help.");
  }
  if (error instanceof PlaytestScenarioError) {
    if (error.diagnostic.code === "TN_PLAYTEST_SCENARIO_NOT_FOUND") {
      return scenarioUnreadable(error.message, options);
    }
    return {
      code: error.diagnostic.code,
      fix: { instruction: error.diagnostic.fix?.instruction ?? error.diagnostic.suggestion ?? "Fix the scenario and rerun the playtest." },
      message: error.diagnostic.message,
      severity: error.diagnostic.severity,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("browserType.launch")) {
    return diagnostic(
      "TN_PLAYTEST_BROWSER_UNAVAILABLE",
      message,
      "Install or repair Chromium; under a headless Linux session run via xvfb-run.",
    );
  }
  if (message.startsWith("page.goto")) {
    return diagnostic(
      "TN_PLAYTEST_PAGE_UNREACHABLE",
      message,
      "Start the app at --url by hand and confirm it answers.",
    );
  }
  if (message.includes("ENOENT") || /Playtest scenario .*could not be read/u.test(message)) {
    return scenarioUnreadable(message, options);
  }
  return diagnostic(
    "TN_PLAYTEST_RUNNER_FAILED",
    message,
    "Unexpected runner error; inspect this message and rerun the command.",
  );
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let config: IStandalonePlaytestConfig | undefined;
  try {
    if (argv.includes("--help")) {
      process.stdout.write(formatUsage());
      return 0;
    }
    if (argv[0] === "init") {
      const result = await initStandalonePlaytest(process.cwd());
      process.stdout.write(`${JSON.stringify({ ...result, pass: true }, null, 2)}\n`);
      return 0;
    }
    if (argv[0] === "record-to-scenario") {
      return await recordToScenarioCommand(argv.slice(1));
    }
    config = parseStandalonePlaytestArgs(argv);
    const report = config.target === "android"
      ? await runAndroidPlaytest(config)
      : config.target === "ios"
        ? await runIosPlaytest(config)
        : await runStandalonePlaytest(config);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    const exitCode = exitCodeForReport(report);
    process.exitCode = exitCode;
    return exitCode;
  } catch (error) {
    const diagnostic = classifyRunnerError(error, {
      cwd: config?.projectPath,
      scenarioPath: config?.scenarioPath,
    });
    process.stderr.write(`${JSON.stringify({ diagnostics: [diagnostic], pass: false }, null, 2)}\n`);
    process.exitCode = 2;
    return 2;
  }
}

async function recordToScenarioCommand(argv: readonly string[]): Promise<number> {
  const inputPath = argv[0];
  const withOracle =
    argv.length === 5 && argv[1] === "--oracle" && argv[3] === "--out";
  const oraclePath = withOracle ? argv[2] : undefined;
  const outputPath = withOracle ? argv[4] : undefined;
  if (inputPath === undefined || oraclePath === undefined || outputPath === undefined) {
    throw new PlaytestCliUsageError(
      "Usage: threenative-playtest record-to-scenario recording.json --oracle oracle.json --out bug.playtest.json",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  } catch (error) {
    throw new PlaytestCliUsageError(
      `Could not read recording '${inputPath}' as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let oracle: unknown;
  try {
    oracle = JSON.parse(await readFile(resolve(oraclePath), "utf8"));
  } catch (error) {
    throw new PlaytestCliUsageError(
      `Could not read recording oracle '${oraclePath}' as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const scenario = recordToScenario(parsed, inputPath, oracle);
  const absoluteOutput = resolve(outputPath);
  await mkdir(dirname(absoluteOutput), { recursive: true });
  await writeFile(absoluteOutput, `${JSON.stringify(scenario, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: absoluteOutput, pass: true }, null, 2)}\n`);
  return 0;
}

function diagnostic(code: string, message: string, instruction: string): IRunnerDiagnostic {
  return { code, fix: { instruction }, message, severity: "error" };
}

function scenarioUnreadable(
  message: string,
  options: { cwd?: string; scenarioPath?: string },
): IRunnerDiagnostic {
  const cwd = options.cwd ?? process.cwd();
  const candidate = options.scenarioPath
    ?? /Playtest scenario ['"]([^'"]+)['"]/u.exec(message)?.[1]
    ?? /(?:open|read) ['"]([^'"]+)['"]/u.exec(message)?.[1];
  const path = candidate === undefined ? undefined : resolve(cwd, candidate);
  const printedPath = path ?? "the requested scenario path";
  return diagnostic(
    "TN_PLAYTEST_SCENARIO_UNREADABLE",
    `${message} Resolved absolute path: ${printedPath}.`,
    `Check the resolved absolute scenario path: ${printedPath}.`,
  );
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined
  && existsSync(entryPath)
  && realpathSync(resolve(entryPath)) === realpathSync(fileURLToPath(import.meta.url))
) {
  await main();
}
