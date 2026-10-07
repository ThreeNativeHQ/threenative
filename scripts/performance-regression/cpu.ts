// Opt-in CPU microbenchmark path for `pnpm bench:engines`. The measured work runs in an isolated
// installation of the pinned @pmndrs/labs CLI; this module only validates the request, launches
// that installed executable with a controlled working directory, and records the raw result. It
// never imports Labs and never runs on the ordinary hardware path.
import { type ChildProcess, execFile, spawn } from "node:child_process";
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
const CHILD_OUTPUT_LIMIT = 32 * 1024 * 1024;
// Labs runs each worker with a synchronous `execFileSync` and inherits stdio, so the worker and
// any grandchild share the direct child's process group. Terminating that group is the only way to
// stop the tree; a timeout on the parent alone orphans a running worker.
const TERM_GRACE_MS = 2_000;
const KILL_GRACE_MS = 1_000;
const GROUP_POLL_MS = 25;

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
  const setupCount = argv.filter((arg) => arg === "--cpu-setup").length;
  const captureCount = argv.filter((arg) => arg === "--cpu").length;
  if (setupCount > 1 || captureCount > 1) {
    throw new BenchError("TN_CPU_BENCH_DUPLICATE_MODE", "a CPU mode flag may appear only once", 2);
  }
  if (setupCount > 0 && captureCount > 0) {
    throw new BenchError(
      "TN_CPU_BENCH_CONFLICT",
      "--cpu-setup and --cpu are mutually exclusive",
      2,
    );
  }
  if (setupCount > 0) return "setup";
  if (captureCount > 0) return "capture";
  return undefined;
}

/** The Node executable used to run Labs. Defaults to the current process. */
export function labsNodeExecutable(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.TN_CPU_BENCH_NODE;
  return configured !== undefined && configured.length > 0 ? configured : process.execPath;
}

/**
 * The wall-clock budget for one capture. `TN_CPU_BENCH_TIMEOUT_MS` narrows it for tests; it can
 * never raise it past the design limit, and a non-integer or non-positive override fails closed.
 */
export function captureTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TN_CPU_BENCH_TIMEOUT_MS;
  if (raw === undefined) return CPU_CAPTURE_BUDGET_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > CPU_CAPTURE_BUDGET_MS) {
    throw new BenchError(
      "TN_CPU_BENCH_BAD_TIMEOUT",
      `TN_CPU_BENCH_TIMEOUT_MS must be a positive integer no greater than ${CPU_CAPTURE_BUDGET_MS}, got '${raw}'`,
      2,
    );
  }
  return parsed;
}

// A benchmark worker runs trusted local source, but that source is arbitrary Node execution: it
// can read whatever environment it inherits. Passing the wrapper's whole environment would hand it
// registry tokens, cloud credentials and Node preload hooks it never needs. The allowlist is the
// runtime basics Node needs to start and resolve modules, plus the explicit CPU knobs. It is not a
// sandbox: it limits the ambient secrets, not what the benchmark code may do.
const CHILD_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "LD_LIBRARY_PATH",
  "DYLD_LIBRARY_PATH",
  "SYSTEMROOT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
] as const;

const CHILD_CPU_KNOB_KEYS = [
  "TN_CPU_BENCH_BENCH_DIR",
  "TN_CPU_BENCH_BLOCK_TIME",
  "TN_CPU_BENCH_BLOCKS",
  "TN_CPU_BENCH_MIN_SAMPLES",
  "TN_CPU_BENCH_RESULTS_DIR",
  "TN_CPU_BENCH_SOURCE",
] as const;

/** The environment a benchmark child may see: runtime basics and explicit CPU knobs only. */
export function labsChildEnv(
  base: NodeJS.ProcessEnv = process.env,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [...CHILD_ENV_KEYS, ...CHILD_CPU_KNOB_KEYS]) {
    const value = base[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...overrides };
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
    // The probe must not inherit credentials or preload hooks any more than the benchmark may.
    const { stdout } = await execFileAsync(executable, ["--version"], { env: labsChildEnv() });
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

/**
 * Parse and validate a setup request. Setup owns no flags, so any extra token — including another
 * CPU mode or a hardware flag — fails before an install runs.
 */
export function parseCpuSetupArgs(argv: readonly string[]): void {
  for (const arg of argv) {
    if (arg === "--cpu-setup") continue;
    if (arg.startsWith("--")) {
      throw new BenchError(
        "TN_CPU_BENCH_UNKNOWN_FLAG",
        `unknown setup flag '${arg}'; --cpu-setup accepts no other flag`,
        2,
      );
    }
    throw new BenchError("TN_CPU_BENCH_UNEXPECTED_ARG", `unexpected argument '${arg}'`, 2);
  }
}

/** Record a flag once; a repeated flag is a duplicate, never a silent last-wins. */
function setOnce(values: Map<string, string>, flag: string, value: string): void {
  if (values.has(flag)) {
    throw new BenchError("TN_CPU_BENCH_DUPLICATE_FLAG", `${flag} may appear only once`, 2);
  }
  values.set(flag, value);
}

/** Parse and validate a capture request. Every unknown, duplicate or missing value fails before a workload. */
export function parseCpuCaptureArgs(argv: readonly string[]): ICpuCaptureOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (arg === "--cpu") {
      setOnce(values, "--cpu", "");
      continue;
    }
    if (arg === "--source" || arg === "--name") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new BenchError("TN_CPU_BENCH_MISSING_VALUE", `${arg} requires a value`, 2);
      }
      setOnce(values, arg, value);
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

export interface IBoundedProcessOptions {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}

export interface IBoundedProcessResult {
  readonly stderr: string;
  readonly stdout: string;
}

/** Whether the direct child has been reaped by this process. */
function exited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Signal the whole POSIX process group, or the direct child where no group is addressable. */
function signalTree(child: ChildProcess, signal: "SIGKILL" | "SIGTERM"): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    child.kill(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

/** True while any member of the child's process group is still alive (or the child on Windows). */
function treeAlive(child: ChildProcess): boolean {
  if (child.pid === undefined) return false;
  if (process.platform === "win32") return !exited(child);
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForTreeGone(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = (): void => {
      if (!treeAlive(child)) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(check, GROUP_POLL_MS);
    };
    check();
  });
}

interface ICaptureFailureInput {
  readonly cancelled: boolean;
  readonly command: string;
  readonly exitCode: number | null;
  readonly spawnError: Error | undefined;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly timeoutMs: number;
}

/** The named failure a finished child represents, or undefined for a clean exit. */
function captureFailure(input: ICaptureFailureInput): BenchError | undefined {
  if (input.spawnError !== undefined) {
    return new BenchError(
      "TN_CPU_BENCH_SPAWN_FAILED",
      `could not launch ${input.command}: ${input.spawnError.message}`,
      2,
    );
  }
  if (input.timedOut) {
    return new BenchError(
      "TN_CPU_BENCH_TIMEOUT",
      `CPU capture exceeded ${input.timeoutMs / 1000}s; the worker tree was terminated`,
      2,
    );
  }
  if (input.cancelled) {
    return new BenchError(
      "TN_CPU_BENCH_CANCELLED",
      "CPU capture was cancelled; the worker tree was terminated",
      2,
    );
  }
  if (input.exitCode !== 0) {
    return new BenchError(
      "TN_CPU_BENCH_RUN_FAILED",
      `labs capture failed: ${input.stderr.trim() || `exit code ${input.exitCode ?? 1}`}`,
      2,
    );
  }
  return undefined;
}

/**
 * Run a command as its own process group and bound it: a fixed timeout, an optional abort signal,
 * capped output, and a TERM→KILL escalation that reaps descendants even when the direct child
 * exits first. Errors are named so the caller can report an incomplete capture rather than a
 * completed one. Windows falls back to killing the direct child only; tree termination there is
 * untested and not claimed.
 */
export function runBoundedProcess(
  options: IBoundedProcessOptions,
  signal?: AbortSignal,
): Promise<IBoundedProcessResult> {
  return new Promise<IBoundedProcessResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(options.command, [...options.args], {
        cwd: options.cwd,
        detached: process.platform !== "win32",
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      reject(
        new BenchError(
          "TN_CPU_BENCH_SPAWN_FAILED",
          `could not launch ${options.command}: ${error instanceof Error ? error.message : String(error)}`,
          2,
        ),
      );
      return;
    }

    let stdout = "";
    let stderr = "";
    let cancelled = false;
    let timedOut = false;
    let settling = false;
    let spawnError: Error | undefined;

    const finalize = async (): Promise<void> => {
      if (settling) return;
      settling = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (treeAlive(child)) {
        signalTree(child, "SIGTERM");
        if (!(await waitForTreeGone(child, TERM_GRACE_MS))) {
          signalTree(child, "SIGKILL");
          await waitForTreeGone(child, KILL_GRACE_MS);
        }
      }
      const failure = captureFailure({
        cancelled,
        command: options.command,
        exitCode: child.exitCode,
        spawnError,
        stderr,
        timedOut,
        timeoutMs: options.timeoutMs,
      });
      if (failure !== undefined) {
        reject(failure);
        return;
      }
      resolve({ stderr, stdout });
    };

    const onAbort = (): void => {
      cancelled = true;
      signalTree(child, "SIGTERM");
      void finalize();
    };

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout = `${stdout}${String(chunk)}`;
      if (stdout.length > CHILD_OUTPUT_LIMIT) stdout = stdout.slice(-CHILD_OUTPUT_LIMIT);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`;
      if (stderr.length > CHILD_OUTPUT_LIMIT) stderr = stderr.slice(-CHILD_OUTPUT_LIMIT);
    });
    child.on("error", (error: Error) => {
      spawnError = error;
      void finalize();
    });
    child.on("exit", () => {
      void finalize();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      signalTree(child, "SIGTERM");
      void finalize();
    }, options.timeoutMs);

    if (signal !== undefined) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/** Run one child under the wrapper's own SIGINT/SIGTERM cancellation. */
async function runWithCancellation<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const onSignal = (signal: NodeJS.Signals): void => controller.abort(signal);
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    return await run(controller.signal);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

/** Install the pinned Labs artifact into its isolated profile. Never touches the root graph. */
export async function runCpuSetup(): Promise<void> {
  const executable = labsNodeExecutable();
  assertLabsNode(await labsNodeVersion(executable));
  const pin = await readToolManifestPin();
  await assertCatalogPin(pin);
  try {
    await runWithCancellation((signal) =>
      runBoundedProcess(
        {
          args: [
            "install",
            "--ignore-workspace",
            "--ignore-scripts",
            "--config.node-linker=hoisted",
            "--frozen-lockfile",
          ],
          command: "pnpm",
          cwd: LABS_TOOL_DIR,
          env: process.env,
          timeoutMs: captureTimeoutMs(),
        },
        signal,
      ),
    );
  } catch (error) {
    if (error instanceof BenchError) throw error;
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
  const env = labsChildEnv(process.env, {
    TN_CPU_BENCH_RESULTS_DIR: path.relative(LABS_TOOL_DIR, labsRoot),
    TN_CPU_BENCH_SOURCE: options.source,
  });
  try {
    await runWithCancellation((signal) =>
      runBoundedProcess(
        {
          args: [LABS_BIN, "run", "-n", options.name, "--force"],
          command: executable,
          cwd: LABS_TOOL_DIR,
          env,
          timeoutMs: captureTimeoutMs(),
        },
        signal,
      ),
    );
  } catch (error) {
    if (error instanceof BenchError) throw error;
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
  if (command === "setup") {
    parseCpuSetupArgs(argv);
    return runCpuSetup();
  }
  await runCpuCapture(parseCpuCaptureArgs(argv));
}
