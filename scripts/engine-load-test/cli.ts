// `pnpm bench:engines` — PRD-117's entry point. Opt-in by construction: nothing here is wired
// into `pnpm test`, and the Godot arms are the only thing that needs Godot installed.
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runPerformanceRegressionCli } from "../performance-regression/compare.js";
import { driveBenchmarkPage, serveDirectory, startProcess, waitForUrl } from "./browser.js";
import {
  BenchError,
  type IPerformanceBaseline,
  type IPerformanceCheck,
  type IRunReport,
  baselineForLane,
  checkPerformance,
  compare,
  laneForArm,
  laneForId,
  parsePerformanceLaneManifest,
  parseRunReport,
  renderArmMarkdown,
  renderComparisonMarkdown,
  renderPerformanceCheck,
} from "./report.js";
import { runAndroidArm } from "./run-android.js";
import { runGodotDesktop, runTnDesktop } from "./run-desktop.js";
import { exportGodotWeb } from "./run-godot.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const artifactRoot = path.join(repoRoot, "artifacts/engine-load-test");
const TN_PORT = 5199;
const GODOT_PORT = 5198;
const DEFAULT_LANE_MANIFEST = path.join(repoRoot, "scripts/performance-regression/lanes.json");
const execFileAsync = promisify(execFile);

interface ILadderOptions {
  frames: number;
  ladder: string;
  modes: string;
  repeats: number;
  warmup: number;
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function ladderOptions(): ILadderOptions {
  return {
    frames: Number(flag("frames") ?? 600),
    ladder: flag("ladder") ?? "256,1024,4096,16384",
    modes: flag("modes") ?? "L1,L2",
    repeats: Number(flag("repeats") ?? 3),
    warmup: Number(flag("warmup") ?? 120),
  };
}

function query(options: ILadderOptions): string {
  return `frames=${options.frames}&warmup=${options.warmup}&repeats=${options.repeats}&ladder=${options.ladder}&modes=${options.modes}`;
}

function timeoutFor(options: ILadderOptions): number {
  const cells =
    options.ladder.split(",").length * options.modes.split(",").length * options.repeats;
  // Budget half a second per frame at the top rung; the arm reports long before this fires.
  return Math.max(600_000, cells * options.frames * 500);
}

async function runTnWeb(options: ILadderOptions): Promise<IRunReport> {
  const server = startProcess(
    "pnpm",
    [
      "--filter",
      "threenative-engine-load-test",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(TN_PORT),
      "--strictPort",
    ],
    repoRoot,
  );
  try {
    await waitForUrl(`http://127.0.0.1:${TN_PORT}/`, 120_000);
    const raw = await driveBenchmarkPage({
      onConsole: (text) => process.stderr.write(`[tn-web] ${text}\n`),
      timeoutMs: timeoutFor(options),
      url: `http://127.0.0.1:${TN_PORT}/?${query(options)}`,
    });
    return parseRunReport(raw);
  } finally {
    server.kill("SIGTERM");
  }
}

async function runGodotWeb(options: ILadderOptions): Promise<IRunReport> {
  const exportDir = await exportGodotWeb(repoRoot);
  const server = await serveDirectory(exportDir, GODOT_PORT);
  try {
    await waitForUrl(`http://127.0.0.1:${GODOT_PORT}/index.html`, 60_000);
    const raw = await driveBenchmarkPage({
      onConsole: (text) => process.stderr.write(`[godot-web] ${text}\n`),
      timeoutMs: timeoutFor(options),
      url: `http://127.0.0.1:${GODOT_PORT}/index.html?${query(options)}`,
    });
    return parseRunReport(raw);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function loadArm(arm: string): Promise<IRunReport> {
  const file = path.join(artifactRoot, `${arm}.json`);
  return parseRunReport(JSON.parse(await readFile(file, "utf8")));
}

function requiredBaselineMode(): boolean {
  return (
    process.argv.includes("--required-baseline") || process.argv.includes("--require-baseline")
  );
}

async function readLaneManifest(file: string) {
  try {
    return parsePerformanceLaneManifest(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (error instanceof BenchError) throw error;
    throw new BenchError(
      "TN_BENCH_BAD_LANE_MANIFEST",
      `could not read or parse ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function requiredBaseline(report: IRunReport): Promise<{
  readonly baselines: Record<string, IPerformanceBaseline>;
  readonly laneId: string;
}> {
  const manifestFile = flag("lanes") ?? DEFAULT_LANE_MANIFEST;
  const manifest = await readLaneManifest(manifestFile);
  const requestedLane = flag("lane");
  const lane =
    requestedLane === undefined
      ? laneForArm(manifest, report.arm)
      : laneForId(manifest, requestedLane);
  if (lane === undefined) {
    throw new BenchError(
      "TN_BENCH_LANE_MISSING",
      `no manifest lane is assigned to ${requestedLane ?? report.arm}; requested coverage cannot pass`,
    );
  }
  if (!lane.arms.includes(report.arm)) {
    throw new BenchError(
      "TN_BENCH_LANE_IDENTITY_MISMATCH",
      `requested lane ${lane.id} does not accept report arm ${report.arm}`,
    );
  }
  const baseline = baselineForLane(lane);
  if (baseline === undefined) return { baselines: {}, laneId: lane.id };
  const key = report.deviceCondition?.serial.startsWith("emulator-")
    ? `${report.arm}@emulator`
    : report.arm;
  return { baselines: { [key]: baseline }, laneId: lane.id };
}

async function runRequestedArm(arm: string, options: ILadderOptions): Promise<IRunReport> {
  if (arm === "tn-web") return runTnWeb(options);
  if (arm === "godot-web") return runGodotWeb(options);
  if (arm === "tn-desktop") return parseRunReport(await runTnDesktop(repoRoot, options));
  if (arm === "godot-desktop") return parseRunReport(await runGodotDesktop(repoRoot, options));
  if (arm === "tn-android" || arm === "godot-android") {
    return parseRunReport(
      await runAndroidArm(repoRoot, arm, {
        ...options,
        allowEmulator: process.argv.includes("--allow-emulator"),
        allowLowBattery: process.argv.includes("--allow-low-battery"),
        timeoutMs: timeoutFor(options),
      }),
    );
  }
  throw new BenchError("TN_BENCH_BAD_ARM", `unknown arm ${arm}`);
}

async function checkArmPerformance(
  report: IRunReport,
  required: boolean,
): Promise<IPerformanceCheck | undefined> {
  if (!required) return checkPerformance(report);
  const input = await requiredBaseline(report);
  return checkPerformance(report, input.baselines, undefined, {
    laneId: input.laneId,
    required: true,
  });
}

async function runArmCommand(arm: string, options: ILadderOptions): Promise<void> {
  const report = await runRequestedArm(arm, options);
  if (report.arm !== arm) {
    throw new BenchError(
      "TN_BENCH_ARM_MISMATCH",
      `asked for ${arm}, the run reported ${report.arm}. Check the build's platform stamp.`,
    );
  }
  const file = path.join(artifactRoot, `${flag("out") ?? arm}.json`);
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${renderArmMarkdown(report)}\n\nwrote ${path.relative(repoRoot, file)}\n`);

  const required = requiredBaselineMode();
  if (process.argv.includes("--skip-baseline")) {
    if (required) {
      throw new BenchError(
        "TN_BENCH_REQUIRED_BASELINE_SKIPPED",
        "required mode cannot skip a baseline",
      );
    }
    process.stderr.write("baseline check skipped by --skip-baseline\n");
    return;
  }
  const check = await checkArmPerformance(report, required);
  if (check === undefined) return;
  process.stdout.write(`\n${renderPerformanceCheck(check)}\n`);
  if (check.regressions.length > 0) {
    throw new BenchError(
      "TN_BENCH_PERFORMANCE_REGRESSION",
      `${check.regressions.length} rung(s) slower than the ${check.arm} baseline.`,
      1,
    );
  }
}

async function runRegressionCommand(): Promise<void> {
  const result = await runPerformanceRegressionCli({
    input: flag("input") ?? flag("report"),
    lane: flag("lane"),
    lanes: flag("lanes"),
    output: flag("out"),
    policy: flag("policy"),
  });
  process.stdout.write(`${result.markdown}\n`);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}

async function runRegressionCollectionCommand(): Promise<void> {
  const target = flag("target");
  if (target === undefined) {
    throw new BenchError(
      "TN_BENCH_COLLECTION_TARGET_MISSING",
      "--regression-collection requires --target so the collector records the selected platform",
    );
  }
  const script = path.join(repoRoot, "packages/runtime-native/scripts/profile-production.mjs");
  const forwardedNames = [
    "config",
    "control",
    "device",
    "out",
    "physical-evidence",
    "prebuilt-artifact",
    "render-size",
    "source-sha",
    "cold-starts",
    "duration",
    "repetitions",
    "warmup",
  ] as const;
  const forwarded = [
    "--target",
    target,
    "--profile",
    "regression",
    ...forwardedNames.flatMap((name) => {
      const value = flag(name);
      return value === undefined ? [] : [`--${name}`, value];
    }),
  ];
  try {
    const result = await execFileAsync(process.execPath, [script, ...forwarded], {
      cwd: repoRoot,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (result.stdout.length > 0) process.stdout.write(result.stdout);
    if (result.stderr.length > 0) process.stderr.write(result.stderr);
  } catch (error) {
    if (typeof error === "object" && error !== null) {
      const output = "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
      const diagnostics = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
      if (output.length > 0) process.stdout.write(output);
      if (diagnostics.length > 0) process.stderr.write(diagnostics);
    }
    const exitCode =
      typeof error === "object" && error !== null && "code" in error && error.code === 1 ? 1 : 2;
    throw new BenchError(
      "TN_BENCH_REGRESSION_COLLECTION_FAILED",
      `bounded regression collector failed for ${target}: ${error instanceof Error ? error.message : String(error)}`,
      exitCode,
    );
  }
}

async function runReportCheckCommand(file: string): Promise<void> {
  let report: IRunReport;
  try {
    report = parseRunReport(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (error instanceof BenchError) throw error;
    throw new BenchError(
      "TN_BENCH_BAD_REPORT_INPUT",
      `could not read or parse ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const check = await checkArmPerformance(report, requiredBaselineMode());
  if (check === undefined) return;
  process.stdout.write(`${renderPerformanceCheck(check)}\n`);
  if (check.regressions.length > 0) {
    throw new BenchError(
      "TN_BENCH_PERFORMANCE_REGRESSION",
      `${check.regressions.length} rung(s) slower than the ${check.arm} baseline.`,
      1,
    );
  }
}

async function runProductComparison(): Promise<void> {
  const left = await loadArm(flag("left") ?? "tn-web");
  const right = await loadArm(flag("right") ?? "godot-web");
  const markdown = renderComparisonMarkdown(compare(left, right));
  const out = flag("doc");
  if (out !== undefined) await writeFile(path.join(repoRoot, out), `${markdown}\n`);
  process.stdout.write(`${markdown}\n`);
}

function printUsage(): void {
  process.stdout.write(
    "usage: pnpm bench:engines --arm <tn-web|godot-web|tn-desktop|godot-desktop|tn-android|godot-android> [--required-baseline --lane id] [--lanes path] [--out name] [--skip-baseline] [--allow-emulator] [--frames N --warmup N --repeats N --ladder a,b --modes L1,L2]\n       pnpm bench:engines --compare [--left tn-web --right godot-web] [--doc path.md]\n       pnpm bench:engines --check-report path.json [--required-baseline --lanes path]\n       pnpm bench:engines --regression --input report.json [--lanes path --lane id] [--policy policy.json] [--out summary.json]\n       pnpm bench:engines --regression-collection --target <web|desktop|android|ios> [--device id] [--prebuilt-artifact path] [--out path]\n",
  );
}

async function main(): Promise<void> {
  await mkdir(artifactRoot, { recursive: true });
  if (process.argv.includes("--regression-collection")) return runRegressionCollectionCommand();
  if (process.argv.includes("--regression")) return runRegressionCommand();
  const checkReport = flag("check-report");
  if (checkReport !== undefined) return runReportCheckCommand(checkReport);
  const arm = flag("arm");
  if (arm !== undefined) return runArmCommand(arm, ladderOptions());
  if (process.argv.includes("--compare")) return runProductComparison();
  printUsage();
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode =
    error instanceof BenchError
      ? error.exitCode
      : error &&
          typeof error === "object" &&
          "exitCode" in error &&
          (error.exitCode === 1 || error.exitCode === 2)
        ? error.exitCode
        : 1;
});
