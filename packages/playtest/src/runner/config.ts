import { resolve } from "node:path";

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

export function parseStandalonePlaytestArgs(argv: readonly string[], cwd = process.cwd()): IStandalonePlaytestConfig {
  const scenarioPath = readFlag(argv, "--scenario") ?? positional(argv);
  if (scenarioPath === undefined) {
    throw new Error("Missing scenario path. Run: threenative-playtest --scenario playtests/movement.playtest.json --url http://127.0.0.1:5173");
  }
  const url = readFlag(argv, "--url") ?? "http://127.0.0.1:5173";
  const projectPath = resolve(cwd, readFlag(argv, "--project") ?? ".");
  const serverCommand = readFlag(argv, "--server-command");
  const browserArgs = readRepeatedFlag(argv, "--browser-arg");
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
const PLAYTEST_FLAGS = new Set([
  "--artifacts", "--browser-arg", "--headed", "--project", "--scenario",
  "--server-command", "--server-timeout", "--timeout", "--trace", "--url",
]);

// Repeatable, because a WebGPU target needs several flags at once and there is no
// other way to reach chromium.launch from the CLI. An application that will not
// start under the default flags cannot be playtested at all.
function readRepeatedFlag(argv: readonly string[], name: string): string[] {
  return argv.flatMap((value, index) => {
    if (value !== name) return [];
    const next = argv[index + 1];
    if (next === undefined || PLAYTEST_FLAGS.has(next)) {
      throw new Error(`Flag '${name}' requires a value, for example ${name} --enable-unsafe-webgpu.`);
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
    throw new Error(`Expected a positive integer, received '${value ?? ""}'.`);
  }
  return parsed;
}
