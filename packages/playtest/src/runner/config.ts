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
}

export const PLAYTEST_FLAGS = {
  "--artifacts": { default: "artifacts/playtest", summary: "artifact output directory" },
  "--browser-arg": { default: "none (repeatable)", summary: "one additional Chromium argument" },
  "--browser-recipe": { default: "none", summary: "named browser recipe (webgpu)" },
  "--headed": { default: "false", summary: "show the browser window" },
  "--project": { default: ".", summary: "project root used to resolve paths" },
  "--scenario": { default: "required (or positional)", summary: "scenario JSON path" },
  "--server-command": { default: "none", summary: "command for a managed app server" },
  "--server-timeout": { default: "15000", summary: "managed server readiness timeout in ms" },
  "--timeout": { default: "15000", summary: "page operation timeout in ms" },
  "--trace": { default: "false", summary: "write a Playwright trace" },
  "--url": { default: "http://127.0.0.1:5173", summary: "application URL" },
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
  const scenarioPath = readFlag(argv, "--scenario") ?? positional(argv);
  if (scenarioPath === undefined) {
    throw new PlaytestCliUsageError("Missing scenario path. Run: threenative-playtest --scenario playtests/movement.playtest.json --url http://127.0.0.1:5173");
  }
  const url = readFlag(argv, "--url") ?? "http://127.0.0.1:5173";
  const projectPath = resolve(cwd, readFlag(argv, "--project") ?? ".");
  const serverCommand = readFlag(argv, "--server-command");
  const explicitBrowserArgs = readRepeatedFlag(argv, "--browser-arg");
  const browserRecipe = readFlag(argv, "--browser-recipe");
  if (argv.includes("--browser-recipe") && browserRecipe === undefined) {
    throw new PlaytestCliUsageError("Flag '--browser-recipe' requires a value, for example --browser-recipe webgpu.");
  }
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
    artifactDirectory: resolve(projectPath, readFlag(argv, "--artifacts") ?? "artifacts/playtest"),
    ...(browserArgs.length === 0 ? {} : { browserArgs }),
    headless: !argv.includes("--headed"),
    projectPath,
    scenarioPath,
    ...(serverCommand === undefined
      ? {}
      : { server: { command: serverCommand, cwd: projectPath, timeoutMs: readPositiveInteger(readFlag(argv, "--server-timeout"), 15_000) } }),
    timeoutMs: readPositiveInteger(readFlag(argv, "--timeout"), 15_000),
    trace: argv.includes("--trace"),
    url,
  };
}

function readFlag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

// Playtest's own flags, so a missing value cannot silently swallow the next one.
// A browser arg is itself dash-prefixed, so "starts with --" is not usable as the
// separator here; the reserved names are.
// Repeatable, because a WebGPU target needs several flags at once and there is no
// other way to reach chromium.launch from the CLI. An application that will not
// start under the default flags cannot be playtested at all.
function readRepeatedFlag(argv: readonly string[], name: string): string[] {
  return argv.flatMap((value, index) => {
    if (value !== name) return [];
    const next = argv[index + 1];
    if (next === undefined || isPlaytestFlag(next)) {
      throw new PlaytestCliUsageError(`Flag '${name}' requires a value, for example ${name} --enable-unsafe-webgpu.`);
    }
    return [next];
  });
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

function isPlaytestFlag(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(PLAYTEST_FLAGS, value);
}
