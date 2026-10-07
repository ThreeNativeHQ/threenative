// Opt-in CPU microbenchmark path for `pnpm bench:engines`. The measured work runs in an isolated
// installation of the pinned @pmndrs/labs CLI; this module only validates the request, launches
// that installed executable with a controlled working directory, and records the raw result. It
// never imports Labs and never runs on the ordinary hardware path.
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { BenchError } from "../engine-load-test/report.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const LABS_TOOL_DIR = path.join(repoRoot, "scripts/performance-regression/labs");
const CPU_ARTIFACT_ROOT = path.join(repoRoot, "artifacts/engine-load-test/cpu");
export const LABS_PACKAGE = "@pmndrs/labs";
export const LABS_NODE_FLOOR = "22.12.0";
export const CPU_CAPTURE_BUDGET_MS = 300_000;
const WORKSPACE_FILE = path.join(repoRoot, "pnpm-workspace.yaml");
const LABS_BIN = path.join(LABS_TOOL_DIR, "node_modules", LABS_PACKAGE, "dist/cli/cli.mjs");
const RESULT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type CpuCommand = "setup" | "capture";

export interface ICpuCaptureOptions {
  readonly name: string;
  readonly source: string;
}

export interface ICpuCaptureResult {
  readonly labsVersion: string;
  readonly resultFile: string;
  readonly runDirectory: string;
}

/** Which CPU subcommand an argv selects, or undefined for every existing hardware path. */
export function cpuCommand(argv: readonly string[]): CpuCommand | undefined {
  const wantsSetup = argv.includes("--cpu-setup");
  const wantsCapture = argv.includes("--cpu");
  if (wantsSetup && wantsCapture) {
    throw new BenchError(
      "TN_CPU_BENCH_CONFLICT",
      "--cpu-setup and --cpu are mutually exclusive",
      2,
    );
  }
  if (wantsSetup) return "setup";
  if (wantsCapture) return "capture";
  return undefined;
}

/** The Node executable used to run Labs. Defaults to the current process. */
export function labsNodeExecutable(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.TN_CPU_BENCH_NODE;
  return configured !== undefined && configured.length > 0 ? configured : process.execPath;
}

/** Fail closed when a Node executable is below the version Labs requires. */
export function assertLabsNode(version: string): void {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  const floor = LABS_NODE_FLOOR.split(".").map(Number);
  const floorMajor = floor[0] ?? 0;
  const floorMinor = floor[1] ?? 0;
  if (
    major === undefined ||
    minor === undefined ||
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    major < floorMajor ||
    (major === floorMajor && minor < floorMinor)
  ) {
    throw new BenchError(
      "TN_CPU_BENCH_NODE_UNSUPPORTED",
      `${LABS_PACKAGE} requires Node >= ${LABS_NODE_FLOOR}, got ${version}; set TN_CPU_BENCH_NODE to a compatible executable`,
      2,
    );
  }
}

/** The exact pin from the generated isolated tool manifest, which owns the installed version. */
export async function readToolManifestPin(toolDir: string = LABS_TOOL_DIR): Promise<string> {
  const file = path.join(toolDir, "package.json");
  let manifest: { dependencies?: Record<string, string> };
  try {
    manifest = JSON.parse(await readFile(file, "utf8")) as typeof manifest;
  } catch (error) {
    throw new BenchError(
      "TN_CPU_BENCH_BAD_MANIFEST",
      `could not read ${file}: ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
  const pin = manifest.dependencies?.[LABS_PACKAGE];
  if (pin === undefined || !/^\d+\.\d+\.\d+$/.test(pin)) {
    throw new BenchError(
      "TN_CPU_BENCH_BAD_PIN",
      `${LABS_PACKAGE} must be pinned to an exact version in ${file}`,
      2,
    );
  }
  return pin;
}

/** The catalog value in the root workspace file, the version authority for the generated pin. */
export function parseCatalogPin(workspaceText: string): string | undefined {
  const match = workspaceText.match(/^\s*'?@pmndrs\/labs'?:\s*(\S+)\s*$/mu);
  return match?.[1];
}

async function assertCatalogPin(pin: string): Promise<void> {
  const catalog = parseCatalogPin(await readFile(WORKSPACE_FILE, "utf8"));
  if (catalog !== pin) {
    throw new BenchError(
      "TN_CPU_BENCH_CATALOG_DRIFT",
      `pnpm-workspace.yaml catalog pins ${LABS_PACKAGE} ${catalog ?? "<missing>"}, but the tool manifest pins ${pin}`,
      2,
    );
  }
}

/** Verify the installed artifact matches the pin and exposes the `labs` executable. */
export async function assertInstalledLabs(toolDir: string = LABS_TOOL_DIR): Promise<string> {
  const pin = await readToolManifestPin(toolDir);
  const packageFile = path.join(toolDir, "node_modules", LABS_PACKAGE, "package.json");
  if (!existsSync(packageFile)) {
    throw new BenchError(
      "TN_CPU_BENCH_NOT_INSTALLED",
      `the isolated ${LABS_PACKAGE} profile is not installed; run 'pnpm bench:engines --cpu-setup'`,
      2,
    );
  }
  const installed = JSON.parse(await readFile(packageFile, "utf8")) as {
    bin?: Record<string, string>;
    version?: string;
  };
  if (installed.version !== pin) {
    throw new BenchError(
      "TN_CPU_BENCH_VERSION_MISMATCH",
      `installed ${LABS_PACKAGE}@${installed.version ?? "<unknown>"} does not match the pinned ${pin}; rerun 'pnpm bench:engines --cpu-setup'`,
      2,
    );
  }
  const bin = path.join(toolDir, "node_modules", LABS_PACKAGE, installed.bin?.labs ?? "");
  if (installed.bin?.labs === undefined || !existsSync(bin)) {
    throw new BenchError(
      "TN_CPU_BENCH_MISSING_BIN",
      `${LABS_PACKAGE}@${pin} does not expose the 'labs' executable; reinstall with 'pnpm bench:engines --cpu-setup'`,
      2,
    );
  }
  return pin;
}

async function labsNodeVersion(executable: string): Promise<string> {
  if (path.resolve(executable) === path.resolve(process.execPath)) return process.versions.node;
  try {
    const { stdout } = await execFileAsync(executable, ["--version"]);
    return stdout.trim().replace(/^v/, "");
  } catch (error) {
    throw new BenchError(
      "TN_CPU_BENCH_NODE_UNSUPPORTED",
      `could not run '${executable} --version': ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
}

function assertSourcePath(source: string): void {
  if (!path.isAbsolute(source)) {
    throw new BenchError(
      "TN_CPU_BENCH_BAD_SOURCE",
      `--source must be an absolute checkout path, got '${source}'`,
      2,
    );
  }
  let directory = false;
  try {
    directory = statSync(source).isDirectory();
  } catch {
    directory = false;
  }
  if (!directory) {
    throw new BenchError("TN_CPU_BENCH_BAD_SOURCE", `--source '${source}' is not a directory`, 2);
  }
}

function assertResultName(name: string): void {
  if (!RESULT_NAME.test(name)) {
    throw new BenchError(
      "TN_CPU_BENCH_BAD_NAME",
      `--name must match [A-Za-z0-9][A-Za-z0-9._-]*, got '${name}'`,
      2,
    );
  }
}

/** Parse and validate a capture request. Every unknown or missing value fails before a workload. */
export function parseCpuCaptureArgs(argv: readonly string[]): ICpuCaptureOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (arg === "--cpu") continue;
    if (arg === "--source" || arg === "--name") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new BenchError("TN_CPU_BENCH_MISSING_VALUE", `${arg} requires a value`, 2);
      }
      values.set(arg, value);
      index++;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new BenchError(
        "TN_CPU_BENCH_UNKNOWN_FLAG",
        `unknown CPU flag '${arg}'; --cpu accepts only --source and --name`,
        2,
      );
    }
    throw new BenchError("TN_CPU_BENCH_UNEXPECTED_ARG", `unexpected argument '${arg}'`, 2);
  }
  const source = values.get("--source");
  if (source === undefined) {
    throw new BenchError(
      "TN_CPU_BENCH_SOURCE_REQUIRED",
      "--cpu requires --source <absolute checkout path>",
      2,
    );
  }
  const name = values.get("--name");
  if (name === undefined) {
    throw new BenchError("TN_CPU_BENCH_NAME_REQUIRED", "--cpu requires --name <result name>", 2);
  }
  assertSourcePath(source);
  assertResultName(name);
  return { name, source };
}

function messageOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string" && stderr.trim().length > 0) return stderr.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

function isTimeout(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "killed" in error &&
    (error as { killed?: unknown }).killed === true
  );
}

async function sourceIdentity(source: string): Promise<Record<string, unknown>> {
  const identity: Record<string, unknown> = { path: source };
  try {
    const [{ stdout: commit }, { stdout: status }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: source }),
      execFileAsync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: source }),
    ]);
    identity.commit = commit.trim();
    identity.dirty = status.trim().length > 0;
  } catch (error) {
    identity.git = error instanceof Error ? error.message : String(error);
  }
  return identity;
}

function runStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Install the pinned Labs artifact into its isolated profile. Never touches the root graph. */
export async function runCpuSetup(): Promise<void> {
  const executable = labsNodeExecutable();
  assertLabsNode(await labsNodeVersion(executable));
  const pin = await readToolManifestPin();
  await assertCatalogPin(pin);
  try {
    await execFileAsync(
      "pnpm",
      ["install", "--ignore-workspace", "--config.node-linker=hoisted", "--frozen-lockfile"],
      { cwd: LABS_TOOL_DIR, maxBuffer: 32 * 1024 * 1024, timeout: CPU_CAPTURE_BUDGET_MS },
    );
  } catch (error) {
    throw new BenchError(
      "TN_CPU_BENCH_SETUP_FAILED",
      `isolated install failed: ${messageOf(error)}`,
      2,
    );
  }
  const installed = await assertInstalledLabs();
  process.stdout.write(
    `isolated ${LABS_PACKAGE}@${installed} installed in ${path.relative(repoRoot, LABS_TOOL_DIR)}\n`,
  );
}

/** Launch the installed Labs CLI against the selected checkout and record its raw result. */
export async function runCpuCapture(options: ICpuCaptureOptions): Promise<ICpuCaptureResult> {
  const executable = labsNodeExecutable();
  assertLabsNode(await labsNodeVersion(executable));
  const labsVersion = await assertInstalledLabs();
  const runDirectory = path.join(CPU_ARTIFACT_ROOT, `${runStamp()}-${options.name}`);
  const labsRoot = path.join(runDirectory, "labs");
  await mkdir(labsRoot, { recursive: true });
  const startedAt = new Date().toISOString();
  const env = {
    ...process.env,
    TN_CPU_BENCH_RESULTS_DIR: path.relative(LABS_TOOL_DIR, labsRoot),
    TN_CPU_BENCH_SOURCE: options.source,
  };
  try {
    await execFileAsync(executable, [LABS_BIN, "run", "-n", options.name, "--force"], {
      cwd: LABS_TOOL_DIR,
      env,
      maxBuffer: 32 * 1024 * 1024,
      timeout: CPU_CAPTURE_BUDGET_MS,
    });
  } catch (error) {
    if (isTimeout(error)) {
      throw new BenchError(
        "TN_CPU_BENCH_TIMEOUT",
        `CPU capture exceeded ${CPU_CAPTURE_BUDGET_MS / 1000}s; the worker was terminated`,
        2,
      );
    }
    throw new BenchError("TN_CPU_BENCH_RUN_FAILED", `labs capture failed: ${messageOf(error)}`, 2);
  }
  const resultFile = path.join(labsRoot, "results", `${options.name}.json`);
  if (!existsSync(resultFile)) {
    throw new BenchError(
      "TN_CPU_BENCH_NO_RESULT",
      `labs completed without saving ${path.relative(repoRoot, resultFile)}; check that the configured workload directory exists and contains *.bench.ts files`,
      2,
    );
  }
  const result = JSON.parse(await readFile(resultFile, "utf8")) as {
    files?: readonly { benchmarks?: readonly unknown[] }[];
  };
  const benchmarkCount = (result.files ?? []).reduce(
    (total, file) => total + (file.benchmarks?.length ?? 0),
    0,
  );
  if ((result.files?.length ?? 0) === 0 || benchmarkCount === 0) {
    throw new BenchError(
      "TN_CPU_BENCH_EMPTY_RESULT",
      `labs saved no benchmark cases for ${options.source}; the configured workload directory produced zero results`,
      2,
    );
  }
  const provenance = {
    benchmarkCount,
    labsVersion,
    name: options.name,
    node: await labsNodeVersion(executable),
    resultFile: path.relative(repoRoot, resultFile),
    runId: path.basename(runDirectory),
    source: await sourceIdentity(options.source),
    startedAt,
    endedAt: new Date().toISOString(),
  };
  await writeFile(
    path.join(runDirectory, "provenance.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  process.stdout.write(
    `CPU capture recorded ${benchmarkCount} benchmark result(s)\n${path.relative(repoRoot, runDirectory)}\n`,
  );
  return { labsVersion, resultFile, runDirectory };
}

/** Run whichever CPU subcommand the argv selected. */
export async function runCpuCommand(command: CpuCommand, argv: readonly string[]): Promise<void> {
  if (command === "setup") return runCpuSetup();
  await runCpuCapture(parseCpuCaptureArgs(argv));
}
