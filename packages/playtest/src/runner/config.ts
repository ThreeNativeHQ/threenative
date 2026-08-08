import { resolve } from "node:path";
import { WEBGPU_BROWSER_ARGS } from "./browser.js";

export interface IPlaytestServerConfig {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface IStandalonePlaytestConfig {
  artifactDirectory: string;
  browserArgs?: readonly string[];
  headless: boolean;
  projectPath: string;
  scenarioPath: string;
  server?: IPlaytestServerConfig;
  timeoutMs: number;
  trace: boolean;
  url: string;
}

export interface IPlaytestFlagHelp {
  default: string;
  summary: string;
  takesValue: boolean;
  allowDashValue?: boolean;
  repeatable?: boolean;
}

export const PLAYTEST_FLAGS = {
  "--artifacts": { default: "artifacts/playtest", summary: "artifact output directory", takesValue: true },
  "--browser-arg": { allowDashValue: true, default: "none (repeatable)", repeatable: true, summary: "one additional Chromium argument", takesValue: true },
  "--browser-recipe": { default: "none", summary: "named browser recipe (webgpu)", takesValue: true },
  "--headed": { default: "false", summary: "show the browser window", takesValue: false },
  "--project": { default: ".", summary: "project root used to resolve paths", takesValue: true },
  "--scenario": { default: "required (or positional)", summary: "scenario JSON path", takesValue: true },
  "--server-command": { default: "none", summary: "command for a managed app server", takesValue: true },
  "--server-timeout": { default: "15000", summary: "managed server readiness timeout in ms", takesValue: true },
  "--timeout": { default: "15000", summary: "page operation timeout in ms", takesValue: true },
  "--trace": { default: "false", summary: "write a Playwright trace", takesValue: false },
  "--url": { default: "http://127.0.0.1:5173", summary: "application URL", takesValue: true },
} as const satisfies Record<string, IPlaytestFlagHelp>;

export class PlaytestCliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaytestCliUsageError";
  }
}

export function formatUsage(): string {
  const flags = Object.entries(PLAYTEST_FLAGS).map(([name, details]) =>
    `  ${name.padEnd(20)} ${details.summary} (default: ${details.default})`,
  );
  return [
    "Usage: threenative-playtest <scenario> [options]",
    "       threenative-playtest --scenario <path> [options]",
    "",
    "Commands:",
    "  init                  create a starter playtest configuration",
    "",
    "Options:",
    ...flags,
    "  --help                print this help and exit 0",
    "",
    "Exit codes:",
    "  0  playtest passed",
    "  1  assertions failed",
    "  2  the run never reached assertions",
    "",
  ].join("\n");
}

export function parseStandalonePlaytestArgs(argv: readonly string[], cwd = process.cwd()): IStandalonePlaytestConfig {
  const flags = parseFlags(argv);
  const scenarioPath = flags.get("--scenario")?.[0] ?? positional(argv);
  if (scenarioPath === undefined) {
    throw new PlaytestCliUsageError("Missing scenario path. Run: threenative-playtest --scenario playtests/movement.playtest.json --url http://127.0.0.1:5173");
  }
  const url = flags.get("--url")?.[0] ?? "http://127.0.0.1:5173";
  const projectPath = resolve(cwd, flags.get("--project")?.[0] ?? ".");
  const serverCommand = flags.get("--server-command")?.[0];
  const explicitBrowserArgs = flags.get("--browser-arg") ?? [];
  const browserRecipe = flags.get("--browser-recipe")?.[0];
  if (browserRecipe !== undefined && browserRecipe !== "webgpu") {
    throw new PlaytestCliUsageError(`Unknown browser recipe '${browserRecipe}'. Expected 'webgpu'.`);
  }
  if (browserRecipe !== undefined && explicitBrowserArgs.length > 0) {
    throw new PlaytestCliUsageError("Choose --browser-recipe or --browser-arg, not both.");
  }
  const browserArgs =
    explicitBrowserArgs.length > 0
      ? explicitBrowserArgs
      : browserRecipe === "webgpu"
        ? [...WEBGPU_BROWSER_ARGS]
        : [];
  return {
    artifactDirectory: resolve(projectPath, flags.get("--artifacts")?.[0] ?? "artifacts/playtest"),
    ...(browserArgs.length === 0 ? {} : { browserArgs }),
    headless: !argv.includes("--headed"),
    projectPath,
    scenarioPath,
    ...(serverCommand === undefined
      ? {}
      : { server: { command: serverCommand, cwd: projectPath, timeoutMs: readPositiveInteger(flags.get("--server-timeout")?.[0], 15_000) } }),
    timeoutMs: readPositiveInteger(flags.get("--timeout")?.[0], 15_000),
    trace: argv.includes("--trace"),
    url,
  };
}

function parseFlags(argv: readonly string[]): Map<string, string[]> {
  const flags = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name?.startsWith("--") || name === "--help") continue;
    if (!isPlaytestFlag(name)) throw new PlaytestCliUsageError(`Unknown flag '${name}'. Run threenative-playtest --help.`);
    const details: IPlaytestFlagHelp = PLAYTEST_FLAGS[name];
    if (!details.takesValue) continue;
    const next = argv[index + 1];
    if (next === undefined || (next.startsWith("--") && (!details.allowDashValue || isPlaytestFlag(next)))) {
      throw new PlaytestCliUsageError(`Flag '${name}' requires a value.`);
    }
    flags.set(name, [...(flags.get(name) ?? []), next]);
    index += 1;
  }
  return flags;
}

function positional(argv: readonly string[]): string | undefined {
  return argv.find((value, index) => !value.startsWith("-") && (index === 0 || !argv[index - 1]?.startsWith("--")));
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new PlaytestCliUsageError(`Expected a positive integer, received '${value ?? ""}'.`);
  }
  return parsed;
}

function isPlaytestFlag(value: string): value is keyof typeof PLAYTEST_FLAGS {
  return Object.prototype.hasOwnProperty.call(PLAYTEST_FLAGS, value);
}
