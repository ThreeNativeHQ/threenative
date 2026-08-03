import { resolve } from "node:path";

export interface IPlaytestServerConfig {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface IStandalonePlaytestConfig {
  artifactDirectory: string;
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
  return {
    artifactDirectory: resolve(projectPath, readFlag(argv, "--artifacts") ?? "artifacts/playtest"),
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
