import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PlaytestScenarioError } from "../scenario.js";
import {
  formatUsage,
  parseStandalonePlaytestArgs,
  PlaytestCliUsageError,
  type IStandalonePlaytestConfig,
} from "./config.js";
import { WEBGPU_BROWSER_ARGS } from "./browser.js";
import { CaptureLockTimeoutError, formatLockTimeoutLine } from "./captureLock.js";
import { diagnoseHarness, formatDoctorReport, readHarnessEnvironment } from "./doctor.js";
import { formatSceneOverview, observeScene, summariseScene } from "./sceneOverview.js";
import { initStandalonePlaytest } from "./init.js";
import { runAndroidPlaytest } from "./androidRunner.js";
import { runDesktopPlaytest } from "./desktopRunner.js";
import { runIosPlaytest } from "./iosRunner.js";
import { recordToScenario } from "./recording.js";
import { runStandalonePlaytest, runStandalonePlaytests, type IStandalonePlaytestReport } from "./runner.js";
import { safePart } from "./shared.js";

export interface IRunnerDiagnostic {
  code: string;
  fix: { instruction: string };
  message: string;
  severity: "error";
}

export type IConfiguredPlaytestRunner = (
  config: IStandalonePlaytestConfig,
) => Promise<import("./runner.js").IStandalonePlaytestReport>;

export interface IPlaytestTargetRunners {
  android: IConfiguredPlaytestRunner;
  browser: IConfiguredPlaytestRunner;
  desktop: IConfiguredPlaytestRunner;
  ios: IConfiguredPlaytestRunner;
}

const DEFAULT_TARGET_RUNNERS: IPlaytestTargetRunners = {
  android: runAndroidPlaytest,
  browser: runStandalonePlaytest,
  desktop: runDesktopPlaytest,
  ios: runIosPlaytest,
};

export function runConfiguredPlaytest(
  config: IStandalonePlaytestConfig,
  runners: IPlaytestTargetRunners = DEFAULT_TARGET_RUNNERS,
): Promise<import("./runner.js").IStandalonePlaytestReport> {
  return runners[config.target ?? "browser"](config);
}

export function exitCodeForReport(report: {
  assertionResults?: readonly unknown[];
  diagnostics?: ReadonlyArray<{ code?: string }>;
  pass: boolean;
}): 0 | 1 | 2 {
  if (report.pass) return 0;
  if (report.diagnostics?.some(({ code }) => code === "TN_PLAYTEST_FRAMEBUFFER_WINDOW_NOT_REACHED")) return 2;
  if (report.assertionResults === undefined || report.assertionResults.every(isUnobservedDiagnosticsAssertion)) return 2;
  return 1;
}

function isUnobservedDiagnosticsAssertion(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const assertion = value as { details?: unknown; id?: unknown };
  if (assertion.id !== "diagnostics" || typeof assertion.details !== "object" || assertion.details === null) return false;
  return (assertion.details as { reason?: unknown }).reason === "not-evaluated";
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
      "Install or repair Chromium; under a headless Linux session run via sh scripts/xvfb.sh.",
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

/**
 * `doctor` answers "can this machine run a playtest", and `doctor --url` additionally answers
 * "and what is actually in the game running there" — the second question is the one asked while
 * staring at a screenshot that looks wrong.
 */
export interface IDoctorArgs {
  readonly browserArgs: readonly string[];
  readonly text: boolean;
  readonly url: string | undefined;
}

export function parseDoctorArgs(argv: readonly string[]): IDoctorArgs {
  const browserArgs: string[] = [];
  let text = false;
  let url: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--text") text = true;
    else if (flag === "--url") {
      url = argv[index + 1];
      index += 1;
    } else if (flag === "--browser-arg") {
      const value = argv[index + 1];
      if (value !== undefined) browserArgs.push(value);
      index += 1;
    }
  }
  return { browserArgs, text, url };
}

/** Extra arguments extend the WebGPU recipe; replacing it would silently reintroduce SwiftShader. */
export function doctorBrowserArgs(extra: readonly string[]): string[] {
  return [...WEBGPU_BROWSER_ARGS, ...extra];
}

export async function doctorCommand(argv: readonly string[]): Promise<number> {
  const { browserArgs, text, url } = parseDoctorArgs(argv);
  const report = diagnoseHarness(readHarnessEnvironment());
  if (url === undefined) {
    process.stdout.write(text ? formatDoctorReport(report) : `${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.pass ? 0 : 1;
    return report.pass ? 0 : 1;
  }
  if (!report.pass) {
    // Reaching a scene needs the browser the machine checks just said is missing.
    process.stdout.write(text ? formatDoctorReport(report) : `${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 1;
    return 1;
  }
  const overview = summariseScene(await observeScene(url, { browserArgs: doctorBrowserArgs(browserArgs) }));
  process.stdout.write(
    text
      ? `${formatDoctorReport(report)}\n${formatSceneOverview(overview)}`
      : `${JSON.stringify({ machine: report, scene: overview }, null, 2)}\n`,
  );
  return 0;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let config: IStandalonePlaytestConfig | undefined;
  try {
    if (argv.includes("--help")) {
      process.stdout.write(formatUsage());
      return 0;
    }
    if (argv[0] === "doctor") return await doctorCommand(argv.slice(1));
    if (argv[0] === "init") {
      const result = await initStandalonePlaytest(process.cwd());
      process.stdout.write(`${JSON.stringify({ ...result, pass: true }, null, 2)}\n`);
      return 0;
    }
    if (argv[0] === "record-to-scenario") {
      return await recordToScenarioCommand(argv.slice(1));
    }
    config = parseStandalonePlaytestArgs(argv);
    const scenarioPaths = config.scenarioPaths ?? [config.scenarioPath];
    const reports = config.target === "browser"
      ? await runStandalonePlaytests(config)
      : await runDevicePlaytests(config, scenarioPaths);
    const output = reports.length === 1
      ? reports[0]
      : { pass: reports.every(({ pass }) => pass), reports };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    const exitCode = reports.reduce<0 | 1 | 2>((worst, report) => {
      const code = exitCodeForReport(report);
      return code > worst ? code : worst;
    }, 0);
    process.exitCode = exitCode;
    return exitCode;
  } catch (error) {
    // A capture-lock timeout is the queue saying "wait", not the game saying "broken" — it
    // must never be classified as a runner failure or an assertion failure.
    if (error instanceof CaptureLockTimeoutError) {
      process.stderr.write(`${formatLockTimeoutLine(error)}\n`);
      process.exitCode = 75;
      return 75;
    }
    const diagnostic = classifyRunnerError(error, {
      cwd: config?.projectPath,
      scenarioPath: config?.scenarioPath,
    });
    process.stderr.write(`${JSON.stringify({ diagnostics: [diagnostic], pass: false }, null, 2)}\n`);
    process.exitCode = 2;
    return 2;
  }
}

async function runDevicePlaytests(
  config: IStandalonePlaytestConfig,
  scenarioPaths: readonly string[],
): Promise<readonly IStandalonePlaytestReport[]> {
  const runner = config.target === "android"
    ? runAndroidPlaytest
    : config.target === "desktop"
      ? runDesktopPlaytest
      : runIosPlaytest;
  const reports: IStandalonePlaytestReport[] = [];
  for (const [index, scenarioPath] of scenarioPaths.entries()) {
    const artifactDirectory = scenarioPaths.length === 1
      ? config.artifactDirectory
      : join(config.artifactDirectory, `${String(index + 1).padStart(2, "0")}-${safePart(scenarioPath)}`);
    reports.push(await runner({
      ...config,
      artifactDirectory,
      scenarioPath,
      scenarioPaths: undefined,
    }));
  }
  return reports;
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
  const code = await main();
  // Exit explicitly rather than waiting for the event loop to drain. A browser that refused to
  // close leaves handles open, and the report is already written by this point, so waiting only
  // costs the caller its exit: every template chains its scenarios with `&&`, and one run that
  // never returns stalls the whole sequence with no error to read.
  process.exit(code);
}
