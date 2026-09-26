// `pnpm bench:engines` — PRD-117's entry point. Opt-in by construction: nothing here is wired
// into `pnpm test`, and the Godot arms are the only thing that needs Godot installed.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream, existsSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseCityFixture } from "../../examples/engine-load-test/src/city-fixture.js";
import { parseCubesFixture } from "../../examples/engine-load-test/src/cubes-fixture.js";
import {
  FOXES_ASSET_SHA256,
  FOXES_UPSTREAM_COMMIT,
  parseFoxesFixture,
} from "../../examples/engine-load-test/src/foxes-fixture.js";
import { LIGHTS_CELL } from "../../examples/engine-load-test/src/lights-fixture.js";
import { runPerformanceRegressionCli } from "../performance-regression/compare.js";
import {
  MESH_BROWSER_ARGS,
  driveBenchmarkPage,
  serveDirectory,
  startProcess,
  waitForUrl,
} from "./browser.js";
import { writeCampaignReport } from "./bundle.js";
import { type ICityComparison, compareCityRuns, parseCityRun } from "./city-compare.js";
import { type CityArm, collectCityPair, resolveMachineIdentity } from "./collect-v2.js";
import { type ICubesComparison, compareCubesRuns, parseCubesRun } from "./cubes-compare.js";
import { type ICullComparison, compareCullRuns, parseCullRun } from "./cull-compare.js";
import { type IFoxesComparison, compareFoxesRuns, parseFoxesRun } from "./foxes-compare.js";
import {
  type ILightsComparison,
  type ILightsRun,
  compareLightsRuns,
  parseLightsRun,
} from "./lights-compare.js";
import { compareMeshRuns, readMeshRun } from "./mesh-compare.js";
import { buildDraftPlan } from "./plan.js";
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
  requireObject,
} from "./report.js";
import { runAndroidArm } from "./run-android.js";
import {
  prepareBevyArm,
  prepareCityArm,
  runBevyCityDesktop,
  runBevyDesktop,
  runBevyFoxesDesktop,
  runCapturing,
  runGodotDesktop,
  runTnCityDesktop,
  runTnCubesDesktop,
  runTnDesktop,
  runTnFoxesDesktop,
} from "./run-desktop.js";
import { exportGodotWeb } from "./run-godot.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const artifactRoot = path.join(repoRoot, "artifacts/engine-load-test");
const TN_PORT = 5199;
const GODOT_PORT = 5198;
const MESH_PORT = 5197;
const DEFAULT_LANE_MANIFEST = path.join(repoRoot, "scripts/performance-regression/lanes.json");
const execFileAsync = promisify(execFile);

interface ILadderOptions {
  frames: number;
  ladder: string;
  modes: string;
  repeats: number;
  sourceSha?: string;
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
    sourceSha: flag("source-sha"),
    warmup: Number(flag("warmup") ?? 120),
  };
}

function query(options: ILadderOptions): string {
  const params = new URLSearchParams({
    frames: String(options.frames),
    ladder: options.ladder,
    modes: options.modes,
    repeats: String(options.repeats),
    warmup: String(options.warmup),
  });
  if (options.sourceSha !== undefined) params.set("sourceSha", options.sourceSha);
  return params.toString();
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

/** Chromium's own `GPUAdapterInfo` field names, which a software adapter is recognisable by. */
const SOFTWARE_ADAPTER =
  /swiftshader|llvmpipe|lavapipe|softwarerasterizer|software adapter|basic render/i;

function adapterText(adapter: unknown): string {
  if (typeof adapter !== "object" || adapter === null) return "";
  return Object.values(adapter)
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

/**
 * A smoke run that cannot name its GPU is not a slow run, it is an unmeasured one: Chromium will
 * answer from SwiftShader without erroring, and the retained mean would be a CPU rasteriser's.
 */
function requireHardwareAdapter(adapter: unknown): Record<string, string | null> {
  if (typeof adapter !== "object" || adapter === null)
    throw new BenchError("TN_BENCH_ADAPTER_UNREPORTED", "the run reported no adapter identity");
  const fields = adapter as Record<string, unknown>;
  const software = adapterText(adapter);
  if (software.length === 0 || fields.vendor === null || fields.architecture === null)
    throw new BenchError(
      "TN_BENCH_ADAPTER_UNREPORTED",
      "the run reported no vendor/architecture; refusing to record a run with no GPU identity",
    );
  const match = software.match(SOFTWARE_ADAPTER);
  if (match !== null)
    throw new BenchError(
      "TN_BENCH_SOFTWARE_ADAPTER",
      `the run reached ${match[0]}, not hardware; its mean is a CPU rasteriser's`,
    );
  return fields as Record<string, string | null>;
}

async function sourceIdentity(): Promise<{ commit: string; dirty: boolean }> {
  const { stdout: commit } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  const { stdout: changes } = await execFileAsync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=no"],
    { cwd: repoRoot },
  );
  return { commit: commit.trim(), dirty: changes.trim().length > 0 };
}

/** The host binary is the native arm's build lock: its bytes decide which engine produced a number. */
async function fileIdentity(file: string): Promise<{ bytes: number; sha256: string }> {
  // Streamed, not read: the arm binaries measured here are hundreds of megabytes.
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest("hex") };
}

/**
 * A hash is a lock only while the bytes it names still exist, and every build output a run measures
 * is a mutable path: the next `dist/` or `target/` build of the same arm overwrites it, which leaves
 * an earlier run's checksum unverifiable. So each measured file is copied to its own content
 * address under `builds/` and the record names both paths. A matching address is the same bytes by
 * construction, so it is reused; bytes that disagree with the address they sit at are a broken lock
 * and no run is recorded over them.
 */
export async function archiveBuild(
  file: string,
  buildsDir = path.join(artifactRoot, "builds"),
): Promise<{ archived: string; bytes: number; path: string; sha256: string }> {
  const { bytes, sha256 } = await fileIdentity(file);
  const archived = path.join(buildsDir, `${sha256}${path.extname(file)}`);
  await mkdir(buildsDir, { recursive: true });
  try {
    // `COPYFILE_EXCL` is the one copy that cannot clobber: the kernel refuses when a concurrent
    // collector won the race to the same address, and the bytes never pass through JS memory.
    await copyFile(file, archived, constants.COPYFILE_EXCL);
  } catch (error) {
    // A collector that archived these same bytes first is the dedupe case, not a failure.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  // Checked whether this call copied the bytes or found them, and against the source read above, so
  // a source rebuilt mid-copy is caught instead of recorded.
  const copy = await fileIdentity(archived);
  if (copy.sha256 !== sha256 || copy.bytes !== bytes)
    throw new BenchError(
      "TN_BENCH_BUILD_ARCHIVE_CORRUPT",
      `${archived} does not hash to its own address; refusing to record a build lock over it`,
    );
  return {
    archived: path.relative(repoRoot, archived),
    bytes,
    path: path.relative(repoRoot, file),
    sha256,
  };
}

async function runMeshArm(arm: string): Promise<void> {
  if (arm !== "plain-three-web" && arm !== "tn-web" && arm !== "tn-desktop")
    throw new BenchError("TN_BENCH_BAD_ARM", `unknown mesh arm ${arm}`);
  const variant = flag("variant") ?? "rotating";
  if (
    ![
      "static",
      "rotating",
      "rotating-projection-off",
      "rotating-instanced",
      "rotating-64-materials",
    ].includes(variant)
  )
    throw new BenchError("TN_BENCH_BAD_VARIANT", `unknown mesh variant ${variant}`);
  const positive = (name: string, fallback: number, minimum: number): number => {
    const value = Number(flag(name) ?? fallback);
    if (!Number.isInteger(value) || value < minimum)
      throw new BenchError("TN_BENCH_BAD_PARAM", `${name} must be an integer >= ${minimum}`);
    return value;
  };
  const count = positive("count", 1000, 1);
  const frames = positive("frames", 600, 1);
  const warmup = positive("warmup", 120, 0);
  // Both mesh arms paint into a window. On a headless Linux box that window is the private Xvfb
  // `sh scripts/xvfb.sh` starts, and Chromium reaches the same NVIDIA Vulkan adapter under it.
  const display = process.env.TN_BENCH_DISPLAY ?? process.env.DISPLAY ?? "";
  if (display.length === 0)
    throw new BenchError(
      "TN_BENCH_DISPLAY_MISSING",
      "set TN_BENCH_DISPLAY (or run under `sh scripts/xvfb.sh`) to name a real X display",
    );
  const { WAYLAND_DISPLAY: _dropped, ...inherited } = process.env;
  const env = { ...inherited, DISPLAY: display };
  const nativeBinary = path.join(repoRoot, "packages/runtime-native/build/tn-linux/mystral");
  const file = path.resolve(repoRoot, flag("out") ?? `artifacts/engine-load-test/mesh-${arm}.json`);
  let result: unknown;
  if (arm === "tn-desktop") {
    if (!existsSync(nativeBinary))
      throw new BenchError("TN_BENCH_NATIVE_HOST_MISSING", `native host missing: ${nativeBinary}`);
    await execFileAsync("pnpm", ["--filter", "threenative-engine-load-test", "build"], {
      cwd: repoRoot,
      env: {
        ...env,
        TN_BENCH_TARGET: "native-mesh",
        TN_BENCH_PLATFORM: "desktop",
        TN_MESH_COUNT: String(count),
        TN_MESH_FRAMES: String(frames),
        TN_MESH_VARIANT: variant,
        TN_MESH_WARMUP: String(warmup),
      },
    });
    result = await runCapturing(
      nativeBinary,
      [
        "run",
        path.join(repoRoot, "examples/engine-load-test/dist/engine-load-test-mesh-desktop.js"),
        "--width",
        String(1920),
        "--height",
        String(1080),
        "--no-vsync",
      ],
      { cwd: repoRoot, env: { ...env, SDL_VIDEODRIVER: "x11" } },
    );
  } else {
    await execFileAsync("pnpm", ["--filter", "threenative-engine-load-test", "build"], {
      cwd: repoRoot,
    });
    const dist = path.join(repoRoot, "examples/engine-load-test/dist");
    const server = await serveDirectory(dist, MESH_PORT);
    try {
      const page = arm === "plain-three-web" ? "mesh-plain.html" : "mesh-tn.html";
      const params = new URLSearchParams({
        count: String(count),
        frames: String(frames),
        variant,
        warmup: String(warmup),
      });
      const url = `http://127.0.0.1:${MESH_PORT}/${page}?${params}`;
      await waitForUrl(url, 60_000);
      result = await driveBenchmarkPage({
        args: MESH_BROWSER_ARGS,
        capturePath: file.replace(/\.json$/, ".png"),
        captureSelector: "#stage",
        env,
        errorGlobal: "__ENGINE_MESH_BENCH_ERROR__",
        onConsole: (message) => process.stderr.write(`[${arm}] ${message}\n`),
        reportGlobal: "__ENGINE_MESH_BENCH__",
        timeoutMs: Math.max(600_000, (frames + warmup) * 500),
        url,
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
  const output = requireObject(result, "meshResult");
  if (output.arm !== arm || output.count !== count || output.variant !== variant)
    throw new BenchError("TN_BENCH_ARM_MISMATCH", "mesh result did not match the request");
  const adapter = requireHardwareAdapter(output.adapter);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify(
      {
        ...output,
        capture:
          arm === "tn-desktop" ? null : path.relative(repoRoot, file.replace(/\.json$/, ".png")),
        identity: {
          adapter,
          // The native host is not a browser: it never saw the Chromium arguments, and a record
          // that listed them would claim a launch this arm did not have.
          browserArgs: arm === "tn-desktop" ? null : [...MESH_BROWSER_ARGS],
          display,
          ...(arm === "tn-desktop"
            ? {
                nativeHost: {
                  path: path.relative(repoRoot, nativeBinary),
                  ...(await fileIdentity(nativeBinary)),
                },
              }
            : {}),
          ...(await sourceIdentity()),
        },
        profile: "smoke",
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`wrote smoke result: ${file}\n`);
}

async function compareMeshArms(): Promise<void> {
  const baselinePath = flag("mesh-compare");
  const candidatePath = flag("mesh-against");
  if (baselinePath === undefined || candidatePath === undefined)
    throw new BenchError(
      "TN_BENCH_MESH_COMPARE_ARGS",
      "--mesh-compare <baseline.json> also needs --mesh-against <candidate.json>",
    );
  const summary = compareMeshRuns(
    await readMeshRun(path.resolve(repoRoot, baselinePath)),
    await readMeshRun(path.resolve(repoRoot, candidatePath)),
    { baseline: baselinePath, candidate: candidatePath },
  );
  const file = path.resolve(
    repoRoot,
    flag("out") ?? "artifacts/engine-load-test/mesh-comparison.json",
  );
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(summary, null, 2)}\n`);
  const { arms } = summary;
  process.stdout.write(
    `independent meshes ${summary.variant}@${summary.count} on ${summary.adapter.vendor}/${summary.adapter.architecture}, three r${summary.threeRevision}, fixture ${summary.fixtureHash.slice(0, 12)}\n` +
      `  ${arms.baseline.arm.padEnd(16)} ${arms.baseline.meanMs.toFixed(3)} ms  p50 ${arms.baseline.frameP50Ms?.toFixed(3) ?? "-"}  draws ${arms.baseline.drawCalls ?? "-"}  tris ${arms.baseline.triangles ?? "-"}\n` +
      `  ${arms.candidate.arm.padEnd(16)} ${arms.candidate.meanMs.toFixed(3)} ms  p50 ${arms.candidate.frameP50Ms?.toFixed(3) ?? "-"}  draws ${arms.candidate.drawCalls ?? "-"}  tris ${arms.candidate.triangles ?? "-"}\n` +
      `  baseline/candidate mean ratio ${summary.meanRatioBaselineOverCandidate.toFixed(3)}x over ${summary.blocks} smoke block: no supported verdict\n` +
      `wrote ${path.relative(repoRoot, file)}\n`,
  );
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

const CULL_VARIANT_NAMES = [
  "basic_cull",
  "dynamic_cull",
  "dynamic_rotate_cull",
  "directional_light_cull",
  "static_omni_light_cull",
  "static_omni_light_cull_with_shadows",
  "dynamic_omni_light_cull",
  "dynamic_omni_light_cull_with_shadows",
  "static_spot_light_cull_with_shadows",
  "dynamic_spot_light_cull_with_shadows",
];

function positiveFlag(name: string, fallback: number, minimum: number): number {
  const value = Number(flag(name) ?? fallback);
  if (!Number.isInteger(value) || value < minimum)
    throw new BenchError("TN_BENCH_BAD_PARAM", `${name} must be an integer >= ${minimum}`);
  return value;
}

/**
 * The pinned upstream checkout under `artifacts/`, which Phase 1 verified and hashed. The Godot arm
 * runs against it directly rather than a copy, so the SHA-256 it checks is the lock's own.
 */
function godotBenchmarksPath(): string {
  return path.join(artifactRoot, "sources/godot-benchmarks");
}

/**
 * Upstream ships `occlusion_culling/use_occlusion_culling=true`, and this fixture's measured object
 * set is 2005 visible objects with that on and 3549 with it off, from the same fixture SHA-256 — so
 * the two engines were never rendering the same objects. The culling arm therefore runs against a
 * staged copy with the setting off. The pinned checkout keeps its own bytes; both project hashes are
 * the contract, and the staged one is what `culling_arm.gd` verifies before it builds a scene.
 */
const GODOT_CULL_PROJECT_SHA256 =
  "e942995c87024bfdc22c5fd9b599d4c8e4b653d2ab05f23787f74c16b197afb7";
const GODOT_CULL_PATCHED_SHA256 =
  "66e3d418efa369aaceb6d781ba9d7ba1c3f74f588fd39c3d9b0d621188fa425c";
const OCCLUSION_SETTING = "occlusion_culling/use_occlusion_culling";

export interface IGodotCullStaging {
  readonly patchedSha256: string;
  readonly upstreamSha256: string;
}

export interface IGodotCullStaged {
  /** False when an already-verified staged copy was reused, so a re-run is not a re-copy. */
  readonly created: boolean;
  readonly project: string;
  readonly projectSha256: string;
  readonly upstreamSha256: string;
}

function godotCullStagedPath(): string {
  return path.join(artifactRoot, "sources/godot-benchmarks-cull-off");
}

/**
 * Stages the pinned project with occlusion culling off and hands back the tree the culling arm runs
 * against. Fail-closed at both ends: the pinned project's bytes are verified before anything is
 * copied, and the staged project's hash before the path is returned, so a run can only name a
 * project that is byte-for-byte upstream plus the one-line patch.
 */
export async function stageGodotCullProject(
  pinned: string,
  staged: string,
  expected: IGodotCullStaging = {
    upstreamSha256: GODOT_CULL_PROJECT_SHA256,
    patchedSha256: GODOT_CULL_PATCHED_SHA256,
  },
): Promise<IGodotCullStaged> {
  const source = path.join(pinned, "project.godot");
  if (!existsSync(source))
    throw new BenchError(
      "TN_BENCH_GODOT_CHECKOUT_MISSING",
      `pinned upstream checkout missing: ${pinned}`,
    );
  const bytes = await readFile(source);
  const upstreamSha256 = createHash("sha256").update(bytes).digest("hex");
  if (upstreamSha256 !== expected.upstreamSha256)
    throw new BenchError(
      "TN_BENCH_GODOT_SOURCE_HASH_MISMATCH",
      `${source} is ${upstreamSha256}, not the pinned ${expected.upstreamSha256}`,
    );
  const occurrences = bytes.toString("utf8").split(`${OCCLUSION_SETTING}=true`).length - 1;
  if (occurrences !== 1)
    throw new BenchError(
      "TN_BENCH_GODOT_OCCLUSION_SETTING_UNPATCHABLE",
      `${OCCLUSION_SETTING}=true appears ${occurrences} time(s) in ${source}; exactly one is required`,
    );
  const target = path.join(staged, "project.godot");
  const stagedSha256 = async (): Promise<string> => (await fileIdentity(target)).sha256;
  // An existing stage is never rebuilt: only a verified one is reused, and anything else is rejected
  // where it lies. A stage holds Godot's ignored `.godot` import cache and whatever a failing run
  // left behind, so `rm -rf` on a hash mismatch destroyed state no hash could restore.
  if (existsSync(staged)) {
    if (!existsSync(target))
      throw new BenchError(
        "TN_BENCH_GODOT_STAGE_INCOMPLETE",
        `staged ${staged} exists but has no project.godot; refusing to overwrite it`,
      );
    const reusedSha256 = await stagedSha256();
    if (reusedSha256 !== expected.patchedSha256)
      throw new BenchError(
        "TN_BENCH_GODOT_STAGE_HASH_MISMATCH",
        `staged ${target} is ${reusedSha256}, not the expected ${expected.patchedSha256}; refusing to overwrite ${staged}`,
      );
    return {
      created: false,
      project: staged,
      projectSha256: reusedSha256,
      upstreamSha256,
    };
  }
  await cp(pinned, staged, { recursive: true });
  await writeFile(
    target,
    bytes.toString("utf8").replace(`${OCCLUSION_SETTING}=true`, `${OCCLUSION_SETTING}=false`),
  );
  const projectSha256 = await stagedSha256();
  if (projectSha256 !== expected.patchedSha256)
    throw new BenchError(
      "TN_BENCH_GODOT_STAGE_HASH_MISMATCH",
      `staged ${target} is ${projectSha256}, not the expected ${expected.patchedSha256}`,
    );
  return { created: true, project: staged, projectSha256, upstreamSha256 };
}

async function runGodotCullArm(
  variant: string,
  frames: number,
  warmup: number,
  file: string,
  captures: string,
  fixture: string,
): Promise<void> {
  const godot = process.env.GODOT_BIN ?? "godot";
  const staged = await stageGodotCullProject(godotBenchmarksPath(), godotCullStagedPath());
  process.stdout.write(
    `godot cull arm: ${staged.created ? "staged" : "reusing"} ${staged.project} (project ${staged.projectSha256}, occlusion culling off)\n`,
  );
  const godotBinary = await (async () => godot)();
  const raw = await runCapturing(
    godotBinary,
    [
      "--path",
      staged.project,
      "--resolution",
      "1920x1080",
      "--script",
      path.join(repoRoot, "benchmark/godot-prd449/culling_arm.gd"),
      "--",
      variant,
      `--frames=${frames}`,
      `--warmup=${warmup}`,
      `--captures=${captures}`,
      `--fixture=${fixture}`,
    ],
    { cwd: repoRoot, env: { ...process.env, DISPLAY: requiredDisplay() } },
  );
  const adapter = requireObject((raw as Record<string, unknown>).adapter, "adapter");
  await writeArmRecord(file, raw, {
    adapter,
    display: requiredDisplay(),
    godot: await fileIdentity(await resolveGodotBinary()),
    source: {
      commit: "b059e38a81230a87293828bbf65ab247b6b2d2a8",
      fixture: path.relative(repoRoot, fixture),
      // What the staged project is, so a reader can tell an occlusion-off object set from an
      // occlusion-on one without re-deriving the patch: the line that changed, the bytes it changed
      // them in, and the value the arm read back out of the project it was actually given.
      occlusionCulling: {
        applied: `${OCCLUSION_SETTING}=false`,
        effective: adapter.occlusionCulling,
        projectSha256: staged.projectSha256,
        staged: path.relative(repoRoot, staged.project),
        upstreamProjectSha256: staged.upstreamSha256,
      },
    },
  });
}

async function resolveGodotBinary(): Promise<string> {
  const godot = process.env.GODOT_BIN ?? "godot";
  const resolved = await new Promise<string>((resolveResolved) => {
    const child = execFile("sh", ["-c", `command -v ${godot}`], (error, stdout) =>
      resolveResolved(error === null ? stdout.trim() : godot),
    );
    child.on("error", () => resolveResolved(godot));
  });
  return resolved;
}

function requiredDisplay(): string {
  const display = process.env.TN_BENCH_DISPLAY ?? process.env.DISPLAY ?? "";
  if (display.length === 0)
    throw new BenchError(
      "TN_BENCH_DISPLAY_MISSING",
      "set TN_BENCH_DISPLAY (or DISPLAY) to the physical X display; a private Xvfb display cannot establish native throughput",
    );
  return display;
}

async function writeArmRecord(
  file: string,
  raw: unknown,
  identity: Record<string, unknown>,
): Promise<void> {
  // The parser gates the record and the raw payload is what gets retained: its frame series, work
  // counters, capture paths and render/GPU samples are the evidence, and a normalized copy of it
  // would silently drop exactly the fields a later reader needs. The parser is the family's, so a
  // lights/meshes record is read by its own rules and not by the culling family's census.
  const isLights = (raw as Record<string, unknown>).family === "godot-lights-meshes";
  const run = isLights ? parseLightsRun(raw) : parseCullRun(raw);
  const label = isLights ? (run as ILightsRun).cell : (run as { variant: string }).variant;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({ ...(raw as Record<string, unknown>), identity, profile: "smoke" }, null, 2)}\n`,
  );
  process.stdout.write(
    `wrote ${run.arm} ${label} run: ${file} (${run.meanMs.toFixed(3)} ms mean, ${run.captures.length} captures)\n`,
  );
}

async function runTnCullArm(
  variant: string,
  authoring: string,
  frames: number,
  warmup: number,
  file: string,
  fixture: string,
): Promise<void> {
  if (!existsSync(fixture))
    throw new BenchError(
      "TN_BENCH_CULL_FIXTURE_MISSING",
      `run the Godot arm with --fixture first: ${fixture}`,
    );
  const display = requiredDisplay();
  const nativeBinary = path.join(repoRoot, "packages/runtime-native/build/tn-linux/mystral");
  if (!existsSync(nativeBinary))
    throw new BenchError("TN_BENCH_NATIVE_HOST_MISSING", `native host missing: ${nativeBinary}`);
  const { WAYLAND_DISPLAY: _dropped, ...inherited } = process.env;
  const env = {
    ...inherited,
    DISPLAY: display,
    TN_BENCH_PLATFORM: "desktop",
    TN_BENCH_TARGET: "native-cull",
    TN_CULL_AUTHORING: authoring,
    TN_CULL_FRAMES: String(frames),
    TN_CULL_FIXTURE: fixture,
    TN_CULL_VARIANT: variant,
    TN_CULL_WARMUP: String(warmup),
  };
  await execFileAsync("pnpm", ["--filter", "threenative-engine-load-test", "build"], {
    cwd: repoRoot,
    env,
  });
  const bundle = path.join(
    repoRoot,
    "examples/engine-load-test/dist/engine-load-test-cull-desktop.js",
  );
  const raw = await runCapturing(
    nativeBinary,
    ["run", bundle, "--width", "1920", "--height", "1080", "--no-vsync"],
    { cwd: repoRoot, env: { ...env, SDL_VIDEODRIVER: "x11" } },
  );
  await writeArmRecord(file, raw, {
    adapter: (raw as Record<string, unknown>).adapter,
    authoring,
    browserArgs: null,
    display,
    nativeHost: {
      path: path.relative(repoRoot, nativeBinary),
      ...(await fileIdentity(nativeBinary)),
    },
    source: {
      commit: "b059e38a81230a87293828bbf65ab247b6b2d2a8",
      fixture: path.relative(repoRoot, fixture),
      tn: { commit: (await sourceIdentity()).commit, dirty: (await sourceIdentity()).dirty },
    },
  });
}

async function runCullArm(arm: string): Promise<void> {
  if (arm !== "godot-desktop" && arm !== "tn-desktop")
    throw new BenchError("TN_BENCH_BAD_ARM", `unknown culling arm ${arm}`);
  const variant = flag("cull-variant") ?? "basic_cull";
  if (!CULL_VARIANT_NAMES.includes(variant))
    throw new BenchError("TN_BENCH_BAD_GODOT_VARIANT", `unknown pinned culling variant ${variant}`);
  const authoring = flag("cull-authoring") ?? "scene-node-independent";
  if (authoring !== "scene-node-independent" && authoring !== "clustered-default")
    throw new BenchError("TN_BENCH_BAD_AUTHORING", `unknown authoring mode ${authoring}`);
  const frames = positiveFlag("frames", 600, 1);
  const warmup = positiveFlag("warmup", 120, 0);
  const slug = `${arm}-${variant}${authoring === "clustered-default" ? "-clustered" : ""}`;
  const file = path.resolve(
    repoRoot,
    flag("out") ?? `artifacts/engine-load-test/cull-${slug}.json`,
  );
  const captures = path.resolve(repoRoot, `artifacts/engine-load-test/cull-captures/${slug}`);
  const fixture = path.resolve(
    repoRoot,
    flag("cull-fixture") ?? "artifacts/engine-load-test/cull-fixture-10k.json",
  );
  if (arm === "godot-desktop")
    await runGodotCullArm(variant, frames, warmup, file, captures, fixture);
  else await runTnCullArm(variant, authoring, frames, warmup, file, fixture);
}

async function compareCullArms(): Promise<void> {
  const tnPath = flag("cull-compare");
  const godotPath = flag("cull-against");
  if (tnPath === undefined || godotPath === undefined)
    throw new BenchError(
      "TN_BENCH_CULL_COMPARE_ARGS",
      "--cull-compare <tn.json> also needs --cull-against <godot.json>",
    );
  const tn = parseCullRun(
    JSON.parse(await readFile(path.resolve(repoRoot, tnPath), "utf8")) as unknown,
  );
  const godot = parseCullRun(
    JSON.parse(await readFile(path.resolve(repoRoot, godotPath), "utf8")) as unknown,
  );
  const comparison: ICullComparison = compareCullRuns(tn, godot);
  const file = path.resolve(
    repoRoot,
    flag("out") ?? "artifacts/engine-load-test/cull-comparison.json",
  );
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify(
      {
        ...comparison,
        arms: {
          godot: { arm: godot.arm, meanMs: godot.meanMs, authoring: godot.authoring },
          tn: { arm: tn.arm, meanMs: tn.meanMs, authoring: tn.authoring },
        },
        variant: godot.variant,
      },
      null,
      2,
    )}\n`,
  );
  // The raw means are always the record; the ratio is printed only when the pair earned one, and
  // the exit code is 2 either way a problem was named.
  const ratio =
    comparison.ratio === null ? "ratio withheld" : `ratio ${comparison.ratio.ratio.toFixed(3)}`;
  process.stdout.write(
    `wrote ${file}\n  tn-desktop      ${tn.meanMs.toFixed(3)} ms\n  godot-desktop   ${godot.meanMs.toFixed(3)} ms  ${ratio}\n  comparability ${comparison.outcome.comparability}${comparison.outcome.problems.length > 0 ? ` (${comparison.outcome.problems.join(", ")})` : ""}\n`,
  );
  if (!comparison.outcome.valid) process.exitCode = 2;
}

/**
 * The pinned Godot arm, running the pinned source's own `create_scene` through an adapter that only
 * drives, measures and exports. It is the exporting arm: it writes the fixture the counterpart reads,
 * so the two hash the same bytes rather than two implementations of Godot's RNG.
 */
async function runGodotLightsArm(
  frames: number,
  warmup: number,
  file: string,
  captures: string,
  fixture: string,
): Promise<void> {
  const checkout = godotBenchmarksPath();
  if (!existsSync(checkout))
    throw new BenchError(
      "TN_BENCH_GODOT_CHECKOUT_MISSING",
      `pinned upstream checkout missing: ${checkout}`,
    );
  const raw = await runCapturing(
    process.env.GODOT_BIN ?? "godot",
    [
      "--path",
      checkout,
      "--resolution",
      "1920x1080",
      "--script",
      path.join(repoRoot, "benchmark/godot-prd449/lights_arm.gd"),
      "--",
      `--frames=${frames}`,
      `--warmup=${warmup}`,
      `--captures=${captures}`,
      `--fixture=${fixture}`,
    ],
    { cwd: repoRoot, env: { ...process.env, DISPLAY: requiredDisplay() } },
  );
  await writeArmRecord(file, raw, {
    adapter: (raw as Record<string, unknown>).adapter,
    display: requiredDisplay(),
    godot: await fileIdentity(await resolveGodotBinary()),
    source: {
      commit: "b059e38a81230a87293828bbf65ab247b6b2d2a8",
      fixture: path.relative(repoRoot, fixture),
    },
  });
}

async function runTnLightsArm(
  frames: number,
  warmup: number,
  file: string,
  fixture: string,
): Promise<void> {
  if (!existsSync(fixture))
    throw new BenchError(
      "TN_BENCH_LIGHTS_FIXTURE_MISSING",
      `run the Godot arm with --lights-fixture first: ${fixture}`,
    );
  const display = requiredDisplay();
  const nativeBinary = path.join(repoRoot, "packages/runtime-native/build/tn-linux/mystral");
  if (!existsSync(nativeBinary))
    throw new BenchError("TN_BENCH_NATIVE_HOST_MISSING", `native host missing: ${nativeBinary}`);
  const { WAYLAND_DISPLAY: _dropped, ...inherited } = process.env;
  const env = {
    ...inherited,
    DISPLAY: display,
    TN_BENCH_PLATFORM: "desktop",
    TN_BENCH_TARGET: "native-lights",
    TN_LIGHTS_FRAMES: String(frames),
    TN_LIGHTS_FIXTURE: fixture,
    TN_LIGHTS_WARMUP: String(warmup),
  };
  await execFileAsync("pnpm", ["--filter", "threenative-engine-load-test", "build"], {
    cwd: repoRoot,
    env,
  });
  const raw = await runCapturing(
    nativeBinary,
    [
      "run",
      path.join(repoRoot, "examples/engine-load-test/dist/engine-load-test-lights-desktop.js"),
      "--width",
      "1920",
      "--height",
      "1080",
      "--no-vsync",
    ],
    { cwd: repoRoot, env: { ...env, SDL_VIDEODRIVER: "x11" } },
  );
  await writeArmRecord(file, raw, {
    adapter: (raw as Record<string, unknown>).adapter,
    display,
    nativeHost: {
      path: path.relative(repoRoot, nativeBinary),
      ...(await fileIdentity(nativeBinary)),
    },
    source: {
      commit: "b059e38a81230a87293828bbf65ab247b6b2d2a8",
      fixture: path.relative(repoRoot, fixture),
    },
  });
}

async function runLightsArm(arm: string): Promise<void> {
  if (arm !== "godot-desktop" && arm !== "tn-desktop")
    throw new BenchError("TN_BENCH_BAD_ARM", `unknown lights/meshes arm ${arm}`);
  const frames = positiveFlag("frames", 600, 1);
  const warmup = positiveFlag("warmup", 120, 0);
  const slug = `${arm}-${LIGHTS_CELL}`;
  const file = path.resolve(
    repoRoot,
    flag("out") ?? `artifacts/engine-load-test/lights-${slug}.json`,
  );
  const captures = path.resolve(repoRoot, `artifacts/engine-load-test/lights-captures/${slug}`);
  const fixture = path.resolve(
    repoRoot,
    flag("lights-fixture") ?? `artifacts/engine-load-test/lights-fixture-${LIGHTS_CELL}.json`,
  );
  if (arm === "godot-desktop") await runGodotLightsArm(frames, warmup, file, captures, fixture);
  else await runTnLightsArm(frames, warmup, file, fixture);
}

async function compareLightsArms(): Promise<void> {
  const tnPath = flag("lights-compare");
  const godotPath = flag("lights-against");
  if (tnPath === undefined || godotPath === undefined)
    throw new BenchError(
      "TN_BENCH_LIGHTS_COMPARE_ARGS",
      "--lights-compare <tn.json> also needs --lights-against <godot.json>",
    );
  const read = async (target: string): Promise<ILightsRun> =>
    parseLightsRun(JSON.parse(await readFile(path.resolve(repoRoot, target), "utf8")) as unknown);
  const tn = await read(tnPath);
  const godot = await read(godotPath);
  const comparison: ILightsComparison = compareLightsRuns(tn, godot);
  const file = path.resolve(
    repoRoot,
    flag("out") ?? "artifacts/engine-load-test/lights-comparison.json",
  );
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify(
      {
        ...comparison,
        arms: {
          godot: { arm: godot.arm, authoring: godot.authoring, meanMs: godot.meanMs },
          tn: { arm: tn.arm, authoring: tn.authoring, meanMs: tn.meanMs },
        },
        cell: godot.cell,
      },
      null,
      2,
    )}\n`,
  );
  // The raw means are always the record; the ratio is printed only when the pair earned one, and the
  // exit code is 2 either way a problem was named.
  const ratio =
    comparison.ratio === null ? "ratio withheld" : `ratio ${comparison.ratio.ratio.toFixed(3)}`;
  process.stdout.write(
    `wrote ${file}\n  tn-desktop      ${tn.meanMs.toFixed(3)} ms\n  godot-desktop   ${godot.meanMs.toFixed(3)} ms  ${ratio}\n  comparability ${comparison.outcome.comparability}${comparison.outcome.problems.length > 0 ? ` (${comparison.outcome.problems.join(", ")})` : ""}\n`,
  );
  if (!comparison.outcome.valid) process.exitCode = 2;
}

async function runCityArm(arm: string): Promise<void> {
  if (arm !== "bevy-desktop" && arm !== "tn-desktop")
    throw new BenchError("TN_BENCH_BAD_ARM", `unknown bevy-city arm ${arm}`);
  const variantFlag = flag("city-variant") ?? "moving";
  if (variantFlag !== "static" && variantFlag !== "moving")
    throw new BenchError("TN_BENCH_BAD_CITY_VARIANT", `unknown variant ${variantFlag}`);
  const variant = variantFlag as "static" | "moving";
  const size = positiveFlag("size", 8, 2);
  const seed = positiveFlag("seed", 42, 0);
  const frames = positiveFlag("frames", 600, 2);
  const warmup = positiveFlag("warmup", 120, 0);
  const display = requiredDisplay();
  const artifacts = path.resolve(repoRoot, "artifacts/engine-load-test");
  const identity = await prepareCityArm(repoRoot);
  const file = path.resolve(
    repoRoot,
    flag("out") ?? `artifacts/engine-load-test/city-size${size}-${variant}-${arm}.json`,
  );
  const fixture = path.resolve(
    repoRoot,
    flag("city-fixture") ??
      `artifacts/engine-load-test/city-size${size}-${variant}-${frames}f-bevy-fixture.json`,
  );
  const run = { artifacts, display, frames, seed, size, variant, warmup } as const;
  let raw: Record<string, unknown>;
  if (arm === "bevy-desktop") {
    // The Bevy arm is the exporting arm: it writes the fixture the counterpart arm then reads, so a
    // TN-only rerun of a different cell keeps hashing the same bytes the comparison was built on.
    const exported = await runBevyCityDesktop(repoRoot, run, identity);
    raw = exported.report;
  } else {
    if (!existsSync(fixture))
      throw new BenchError(
        "TN_BENCH_CITY_FIXTURE_MISSING",
        `run the Bevy arm first: ${path.relative(repoRoot, fixture)}`,
      );
    raw = await runTnCityDesktop(repoRoot, run, fixture);
  }
  const parsed = parseCityRun(raw);
  // The raw run is written only after its build files are archived, so the bytes this run measured
  // are still there to check when the next arm rebuilds the same `dist/` or `target/` path.
  const build =
    arm === "bevy-desktop"
      ? { bevyBinary: await archiveBuild(identity.binary) }
      : {
          tnBundle: await archiveBuild(
            path.join(repoRoot, "examples/engine-load-test/dist/engine-load-test-city-desktop.js"),
          ),
          nativeHost: await archiveBuild(
            path.join(repoRoot, "packages/runtime-native/build/tn-linux/mystral"),
          ),
        };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify(
      {
        ...raw,
        identity: {
          authoring: "default",
          build,
          display,
          fixture: path.relative(repoRoot, fixture),
          profile: "smoke",
          source: {
            adapter: { path: "benchmark/bevy-prd449/city", sha256: identity.adapter },
            bevy: { commit: "c6f634ca9f406d68ba5109d921247b654cb42c10", sha256: identity.upstream },
            tn: await sourceIdentity(),
          },
        },
        profile: "smoke",
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `wrote ${parsed.arm} ${parsed.variant} run: ${path.relative(repoRoot, file)} (${parsed.meanMs.toFixed(3)} ms mean over ${parsed.frameIntervals.length} frames)\n`,
  );
}

/**
 * PRD-449 §10's v2 intake for an archived `bevy-city` pair: the two raw runs become immutable
 * schema-2 records in a real campaign bundle, and the report is regenerated from them. Every path
 * resolves against the repository root because the archived records' own refs are repo-relative.
 *
 * The arm that ran first is named by the operator, not read from the plan: the pair carries no
 * timestamp that would order the arms, and a plan's arm array is a plan. The outcome is deliberately
 * partial — an archived smoke pair stands behind no preflight and no source lock — so this prints no
 * ratio and no winner, and exits 2 the way every other partial bundle does.
 */
async function collectCityPairCommand(): Promise<void> {
  const bundleDir = flag("collect-city-pair");
  const bevyRaw = flag("bevy-run");
  const tnRaw = flag("tn-run");
  const firstArm = flag("first-arm");
  const block = flag("block");
  const session = flag("session");
  const machineJson = flag("machine-json");
  if (
    bundleDir === undefined ||
    bevyRaw === undefined ||
    tnRaw === undefined ||
    firstArm === undefined ||
    block === undefined ||
    session === undefined ||
    machineJson === undefined
  )
    throw new BenchError(
      "TN_BENCH_V2_COLLECT_ARGS",
      "--collect-city-pair <bundle-dir> also needs --bevy-run <bevy.json> --tn-run <tn.json> --first-arm <bevy-desktop|tn-desktop> --block N --session N --machine-json <machine.json>",
    );
  const result = await collectCityPair({
    bevyRaw: path.resolve(repoRoot, bevyRaw),
    block: positiveFlag("block", 1, 1),
    bundleDir: path.resolve(repoRoot, bundleDir),
    firstArm: firstArm as CityArm,
    machine: await resolveMachineIdentity({ machineJson: path.resolve(repoRoot, machineJson) }),
    root: repoRoot,
    session: positiveFlag("session", 1, 1),
    tnRaw: path.resolve(repoRoot, tnRaw),
  });
  process.stdout.write(
    `collected ${path.relative(repoRoot, result.bundleDir)} into ${result.runIds.length} immutable v2 runs\n  cell ${result.cell}, session ${session} block ${block}, declared first arm ${firstArm}\n${result.runIds.map((id) => `  ${id}`).join("\n")}\n  comparability ${result.comparability}; every run is invalid, because this archived pair recorded no thermal preflight and no frozen sources.lock.json\n  report ${result.partial ? "PARTIAL" : "complete"}: measurements retained in results.json, no winner claimed\n`,
  );
  if (result.partial) process.exitCode = 2;
}

async function compareCityArms(): Promise<void> {
  const tnPath = flag("city-compare");
  const bevyPath = flag("city-against");
  if (tnPath === undefined || bevyPath === undefined)
    throw new BenchError(
      "TN_BENCH_CITY_COMPARE_ARGS",
      "--city-compare <tn.json> also needs --city-against <bevy.json>",
    );
  const bevyRecord = JSON.parse(await readFile(path.resolve(repoRoot, bevyPath), "utf8")) as {
    fixture: { path?: string };
  };
  const fixturePath = bevyRecord.fixture?.path;
  if (fixturePath === undefined)
    throw new BenchError("TN_BENCH_CITY_FIXTURE_MISSING", "the Bevy record names no fixture");
  const resolvedFixture = path.isAbsolute(fixturePath)
    ? fixturePath
    : path.resolve(repoRoot, fixturePath);
  const fixture = parseCityFixture(await readFile(resolvedFixture, "utf8"));
  const comparison: ICityComparison = compareCityRuns(
    fixture,
    parseCityRun(JSON.parse(await readFile(path.resolve(repoRoot, bevyPath), "utf8")) as unknown),
    parseCityRun(JSON.parse(await readFile(path.resolve(repoRoot, tnPath), "utf8")) as unknown),
  );
  const file = path.resolve(
    repoRoot,
    flag("out") ?? "artifacts/engine-load-test/city-comparison.json",
  );
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({ ...comparison, fixture: resolvedFixture }, null, 2)}\n`,
  );
  const ratio =
    comparison.ratio === null ? "ratio withheld" : `ratio ${comparison.ratio.ratio.toFixed(3)}`;
  process.stdout.write(
    `wrote ${path.relative(repoRoot, file)}\n  bevy-desktop  ${comparison.arms.bevy.meanMs.toFixed(3)} ms\n  tn-desktop    ${comparison.arms.tn.meanMs.toFixed(3)} ms  ${ratio} (${comparison.ratio?.verdict ?? "no ratio"})\n  census ${fixture.census.nodes} nodes / ${fixture.census.meshNodes} mesh nodes / ${fixture.census.trianglesInCensus} triangles\n  conformance camera bevy ${comparison.conformance.perArm.bevy.cameraMaxDelta.toExponential(2)}/tn ${comparison.conformance.perArm.tn.cameraMaxDelta.toExponential(2)}, nodes bevy ${comparison.conformance.perArm.bevy.nodeMaxDelta.toExponential(2)}@${comparison.conformance.worstFrame.bevy}/tn ${comparison.conformance.perArm.tn.nodeMaxDelta.toExponential(2)}@${comparison.conformance.worstFrame.tn} (tolerance ${comparison.conformance.withinTolerance ? "met" : "MISSED"})\n  car motion required ${comparison.carMotion.required}, observed bevy ${comparison.carMotion.observed.bevy}/tn ${comparison.carMotion.observed.tn}, worst car delta ${comparison.carMotion.maxDistanceDelta.toExponential(2)}\n  comparability ${comparison.outcome.comparability}${comparison.outcome.problems.length > 0 ? ` (${comparison.outcome.problems.join(", ")})` : ""}\n`,
  );
  if (!comparison.outcome.valid) process.exitCode = 2;
}

async function runCubesArm(arm: string): Promise<void> {
  if (arm !== "bevy-desktop" && arm !== "tn-desktop")
    throw new BenchError("TN_BENCH_BAD_ARM", `unknown many-cubes arm ${arm}`);
  const variantFlag = flag("cubes-variant") ?? "static";
  if (variantFlag !== "static" && variantFlag !== "rotating")
    throw new BenchError("TN_BENCH_BAD_CUBES_VARIANT", `unknown variant ${variantFlag}`);
  const variant = variantFlag as "static" | "rotating";
  const authoring = (flag("cubes-authoring") ?? "default") as "default" | "independent";
  if (authoring !== "default" && authoring !== "independent")
    throw new BenchError("TN_BENCH_BAD_AUTHORING", `unknown authoring ${authoring}`);
  const count = positiveFlag("count", 1000, 1);
  const frames = positiveFlag("frames", 600, 2);
  const warmup = positiveFlag("warmup", 120, 0);
  const display = requiredDisplay();
  const artifacts = path.resolve(repoRoot, "artifacts/engine-load-test");
  const identity = await prepareBevyArm(repoRoot);
  const file = path.resolve(
    repoRoot,
    flag("out") ?? `artifacts/engine-load-test/cubes-${count}-${variant}-${arm}.json`,
  );
  const fixture = path.resolve(
    repoRoot,
    flag("cubes-fixture") ??
      `artifacts/engine-load-test/cubes-${count}-${variant}-bevy-fixture.json`,
  );
  const run = {
    artifacts,
    count,
    display,
    frames,
    variant,
    warmup,
  } as const;
  let raw: Record<string, unknown>;
  if (arm === "bevy-desktop") {
    // The Bevy arm is the exporting arm: it writes the fixture the counterpart arm then reads, so a
    // TN-only rerun of a different cell keeps hashing the same bytes the comparison was built on.
    const exported = await runBevyDesktop(repoRoot, run, identity);
    raw = exported.report;
  } else {
    if (!existsSync(fixture))
      throw new BenchError(
        "TN_BENCH_CUBES_FIXTURE_MISSING",
        `run the Bevy arm first: ${path.relative(repoRoot, fixture)}`,
      );
    raw = await runTnCubesDesktop(repoRoot, run, fixture);
  }
  const parsed = parseCubesRun(raw);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify(
      {
        ...raw,
        identity: {
          authoring,
          display,
          fixture: path.relative(repoRoot, fixture),
          profile: "smoke",
          source: {
            adapter: { path: "benchmark/bevy-prd449/cubes_arm.rs", sha256: identity.adapter },
            bevy: { commit: "c6f634ca9f406d68ba5109d921247b654cb42c10", sha256: identity.upstream },
            tn: await sourceIdentity(),
          },
        },
        profile: "smoke",
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `wrote ${parsed.arm} ${parsed.variant} run: ${path.relative(repoRoot, file)} (${parsed.meanMs.toFixed(3)} ms mean over ${parsed.frameIntervals.length} frames)\n`,
  );
}

async function compareCubesArms(): Promise<void> {
  const tnPath = flag("cubes-compare");
  const bevyPath = flag("cubes-against");
  if (tnPath === undefined || bevyPath === undefined)
    throw new BenchError(
      "TN_BENCH_CUBES_COMPARE_ARGS",
      "--cubes-compare <tn.json> also needs --cubes-against <bevy.json>",
    );
  const bevyRecord = JSON.parse(await readFile(path.resolve(repoRoot, bevyPath), "utf8")) as {
    fixture: { path?: string };
  };
  const fixturePath = bevyRecord.fixture?.path;
  if (fixturePath === undefined)
    throw new BenchError("TN_BENCH_CUBES_FIXTURE_MISSING", "the Bevy record names no fixture");
  const resolvedFixture = path.isAbsolute(fixturePath)
    ? fixturePath
    : path.resolve(repoRoot, fixturePath);
  const fixture = parseCubesFixture(await readFile(resolvedFixture, "utf8"));
  const comparison: ICubesComparison = compareCubesRuns(
    fixture,
    parseCubesRun(JSON.parse(await readFile(path.resolve(repoRoot, bevyPath), "utf8")) as unknown),
    parseCubesRun(JSON.parse(await readFile(path.resolve(repoRoot, tnPath), "utf8")) as unknown),
  );
  const file = path.resolve(
    repoRoot,
    flag("out") ?? "artifacts/engine-load-test/cubes-comparison.json",
  );
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({ ...comparison, fixture: resolvedFixture }, null, 2)}\n`,
  );
  const ratio =
    comparison.ratio === null ? "ratio withheld" : `ratio ${comparison.ratio.ratio.toFixed(3)}`;
  process.stdout.write(
    `wrote ${path.relative(repoRoot, file)}\n  bevy-desktop  ${comparison.arms.bevy.meanMs.toFixed(3)} ms\n  tn-desktop    ${comparison.arms.tn.meanMs.toFixed(3)} ms  ${ratio} (${comparison.ratio?.verdict ?? "no ratio"})\n  admitted canonical ${comparison.admitted.canonical}, bevy ${comparison.admitted.bevy}, tn ${comparison.admitted.tn} of ${comparison.admitted.cubes}\n  conformance camera bevy ${comparison.conformance.perArm.bevy.cameraMaxDelta.toExponential(2)}/tn ${comparison.conformance.perArm.tn.cameraMaxDelta.toExponential(2)}, probes bevy ${comparison.conformance.perArm.bevy.probeMaxDelta.toExponential(2)}@${comparison.conformance.worstFrame.bevy}/tn ${comparison.conformance.perArm.tn.probeMaxDelta.toExponential(2)}@${comparison.conformance.worstFrame.tn} (tolerance ${comparison.conformance.tolerance})\n  comparability ${comparison.outcome.comparability}${comparison.outcome.problems.length > 0 ? ` (${comparison.outcome.problems.join(", ")})` : ""}\n`,
  );
  if (!comparison.outcome.valid) process.exitCode = 2;
}

async function runFoxesArm(arm: string): Promise<void> {
  if (arm !== "bevy-desktop" && arm !== "tn-desktop")
    throw new BenchError("TN_BENCH_BAD_ARM", `unknown many-foxes arm ${arm}`);
  const variantFlag = flag("foxes-variant") ?? "staggered";
  if (variantFlag !== "sync" && variantFlag !== "staggered")
    throw new BenchError("TN_BENCH_BAD_FOXES_VARIANT", `unknown variant ${variantFlag}`);
  const variant = variantFlag as "sync" | "staggered";
  const count = positiveFlag("count", 50, 1);
  const frames = positiveFlag("frames", 600, 2);
  const warmup = positiveFlag("warmup", 120, 0);
  const display = requiredDisplay();
  const artifacts = path.resolve(repoRoot, "artifacts/engine-load-test");
  const identity = await prepareBevyArm(repoRoot, "foxes");
  // The pinned asset's digest, hashed here from the checkout the Bevy arm loads and the counterpart
  // arm's build injects, so one number covers both arms and the fixture states it.
  const assetPath = path.join(
    repoRoot,
    "artifacts/engine-load-test/sources/bevy/assets/models/animated/Fox.glb",
  );
  const asset = await fileIdentity(assetPath);
  if (asset.sha256 !== FOXES_ASSET_SHA256)
    throw new BenchError("TN_BENCH_FOXES_ASSET_UNPINNED", `${assetPath} is not the pinned Fox.glb`);
  process.env.TN_FOXES_ASSET_SHA256 = asset.sha256;
  const file = path.resolve(
    repoRoot,
    flag("out") ?? `artifacts/engine-load-test/foxes-${count}-${variant}-${arm}.json`,
  );
  const fixture = path.resolve(
    repoRoot,
    flag("foxes-fixture") ??
      `artifacts/engine-load-test/foxes-${count}-${variant}-${frames}f-bevy-fixture.json`,
  );
  const run = {
    artifacts,
    count,
    display,
    frames,
    variant,
    warmup,
  } as const;
  let raw: Record<string, unknown>;
  if (arm === "bevy-desktop") {
    // The Bevy arm is the exporting arm: it writes the fixture the counterpart arm then reads, so a
    // TN-only rerun keeps hashing the same bytes the comparison was built on.
    const exported = await runBevyFoxesDesktop(repoRoot, run, identity);
    raw = exported.report;
  } else {
    if (!existsSync(fixture))
      throw new BenchError(
        "TN_BENCH_FOXES_FIXTURE_MISSING",
        `run the Bevy arm first: ${path.relative(repoRoot, fixture)}`,
      );
    raw = await runTnFoxesDesktop(repoRoot, run, fixture);
  }
  const parsed = parseFoxesRun(raw);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify(
      {
        ...raw,
        identity: {
          asset: {
            bytes: asset.bytes,
            path: path.relative(repoRoot, assetPath),
            sha256: asset.sha256,
          },
          display,
          fixture: path.relative(repoRoot, fixture),
          profile: "smoke",
          source: {
            adapter: { path: "benchmark/bevy-prd449/foxes_arm.rs", sha256: identity.adapter },
            bevy: { commit: FOXES_UPSTREAM_COMMIT, sha256: identity.upstream },
            tn: await sourceIdentity(),
          },
        },
        profile: "smoke",
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `wrote ${parsed.arm} ${parsed.variant} run: ${path.relative(repoRoot, file)} (${parsed.meanMs.toFixed(3)} ms mean over ${parsed.frameIntervals.length} frames)\n`,
  );
}

async function compareFoxesArms(): Promise<void> {
  const tnPath = flag("foxes-compare");
  const bevyPath = flag("foxes-against");
  if (tnPath === undefined || bevyPath === undefined)
    throw new BenchError(
      "TN_BENCH_FOXES_COMPARE_ARGS",
      "--foxes-compare <tn.json> also needs --foxes-against <bevy.json>",
    );
  const bevyRecord = JSON.parse(await readFile(path.resolve(repoRoot, bevyPath), "utf8")) as {
    fixture: { path?: string };
  };
  const fixturePath = bevyRecord.fixture?.path;
  if (fixturePath === undefined)
    throw new BenchError("TN_BENCH_FOXES_FIXTURE_MISSING", "the Bevy record names no fixture");
  const resolvedFixture = path.isAbsolute(fixturePath)
    ? fixturePath
    : path.resolve(repoRoot, fixturePath);
  const fixture = parseFoxesFixture(await readFile(resolvedFixture, "utf8"));
  const comparison: IFoxesComparison = compareFoxesRuns(
    fixture,
    parseFoxesRun(JSON.parse(await readFile(path.resolve(repoRoot, bevyPath), "utf8")) as unknown),
    parseFoxesRun(JSON.parse(await readFile(path.resolve(repoRoot, tnPath), "utf8")) as unknown),
  );
  const file = path.resolve(
    repoRoot,
    flag("out") ?? "artifacts/engine-load-test/foxes-comparison.json",
  );
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({ ...comparison, fixture: resolvedFixture }, null, 2)}\n`,
  );
  const ratio =
    comparison.ratio === null ? "ratio withheld" : `ratio ${comparison.ratio.ratio.toFixed(3)}`;
  process.stdout.write(
    `wrote ${path.relative(repoRoot, file)}\n  bevy-desktop  ${comparison.arms.bevy.meanMs.toFixed(3)} ms\n  tn-desktop    ${comparison.arms.tn.meanMs.toFixed(3)} ms  ${ratio} (${comparison.ratio?.verdict ?? "no ratio"})\n  rings bevy ${comparison.conformance.perArm.bevy.ringMaxDelta.toExponential(2)}/tn ${comparison.conformance.perArm.tn.ringMaxDelta.toExponential(2)}, oracle bevy ${comparison.conformance.perArm.bevy.oracleMaxDelta.toExponential(2)}@${comparison.conformance.perArm.bevy.worstOracleFrame}/tn ${comparison.conformance.perArm.tn.oracleMaxDelta.toExponential(2)}@${comparison.conformance.perArm.tn.worstOracleFrame} (tolerance ${comparison.conformance.tolerance.oracleAbs})\n  bones cross-arm ${comparison.conformance.crossArm.boneMaxDelta.toExponential(2)}, skin ${comparison.conformance.crossArm.skinMatrixMaxDelta.toExponential(2)} (tolerances ${comparison.conformance.tolerance.boneAbs}/${comparison.conformance.tolerance.matrixAbs})\n  distinct poses bevy ${comparison.conformance.distinctPoses.bevy}/tn ${comparison.conformance.distinctPoses.tn} of ${comparison.census.foxes}\n  comparability ${comparison.outcome.comparability}${comparison.outcome.problems.length > 0 ? ` (${comparison.outcome.problems.join(", ")})` : ""}\n`,
  );
  if (!comparison.outcome.valid) process.exitCode = 2;
}

function printUsage(): void {
  process.stdout.write(
    [
      "usage: pnpm bench:engines --arm <tn-web|godot-web|tn-desktop|godot-desktop|tn-android|godot-android> [--required-baseline --lane id] [--lanes path] [--out name] [--skip-baseline] [--allow-emulator] [--source-sha sha --frames N --warmup N --repeats N --ladder a,b --modes L1,L2]",
      "       pnpm bench:engines --mesh-arm <plain-three-web|tn-web|tn-desktop> [--count N --variant name --frames N --warmup N --out file.json]  # production-build smoke on the named GPU; needs TN_BENCH_DISPLAY or `sh scripts/xvfb.sh`",
      "       pnpm bench:engines --cull-arm <godot-desktop|tn-desktop> [--cull-variant name --cull-authoring scene-node-independent|clustered-default --frames N --warmup N --cull-fixture path --out file.json]  # real-GPU culling arm; needs DISPLAY and the pinned godot-benchmarks checkout",
      "       pnpm bench:engines --cull-compare <tn.json> --cull-against <godot.json> [--out cull-comparison.json]  # one smoke block, no verdict",
      "       pnpm bench:engines --lights-arm <godot-desktop|tn-desktop> [--frames N --warmup N --lights-fixture path --out file.json]  # real-GPU lights/meshes arm on the box-100-omni-10-slow cell; needs DISPLAY and the pinned godot-benchmarks checkout (godot-desktop exports the fixture)",
      "       pnpm bench:engines --lights-compare <tn.json> --lights-against <godot.json> [--out lights-comparison.json]  # one smoke block, no verdict",
      "       pnpm bench:engines --city-arm <bevy-desktop|tn-desktop> [--city-variant static|moving --size N --seed N --frames N --warmup N --out file.json]  # real-GPU bevy-city arm; needs DISPLAY and the pinned bevy checkout with the vendored Kenney pack, which bevy-desktop also exports as the fixture",
      "       pnpm bench:engines --city-compare <tn.json> --city-against <bevy.json> [--out city-comparison.json]  # one smoke block, no verdict",
      "       pnpm bench:engines --collect-city-pair <bundle-dir> --bevy-run <bevy.json> --tn-run <tn.json> --first-arm <bevy-desktop|tn-desktop> --block N --session N --machine-json <bundle machine.json>  # import an archived city pair as two immutable v2 runs; the plan's arm order is never used, and the bundle stays partial with no winner",
      "       pnpm bench:engines --cubes-arm <bevy-desktop|tn-desktop> [--cubes-variant static|rotating --cubes-authoring default|independent --count N --frames N --warmup N --out file.json]  # real-GPU many-cubes arm; needs DISPLAY and the pinned bevy checkout (bevy-desktop exports the fixture)",
      "       pnpm bench:engines --cubes-compare <tn.json> --cubes-against <bevy.json> [--out cubes-comparison.json]  # one smoke block, no verdict",
      "       pnpm bench:engines --foxes-arm <bevy-desktop|tn-desktop> [--foxes-variant sync|staggered --count N --frames N --warmup N --out file.json]  # real-GPU many-foxes arm; needs DISPLAY and the pinned bevy checkout (bevy-desktop exports the fixture)",
      "       pnpm bench:engines --foxes-compare <tn.json> --foxes-against <bevy.json> [--out foxes-comparison.json]  # one smoke block, no verdict",
      "       pnpm bench:engines --mesh-compare <baseline.json> --mesh-against <candidate.json> [--out mesh-comparison.json]  # one smoke block, no verdict",
      "       pnpm bench:engines --plan --suite cross-engine --out <bundle-dir>  # writes a draft plan only",
      "       pnpm bench:engines --report-html <bundle-dir>  # partial bundles render with exit 2",
      "       pnpm bench:engines --compare [--left tn-web --right godot-web] [--doc path.md]",
      "       pnpm bench:engines --check-report path.json [--required-baseline --lanes path]",
      "       pnpm bench:engines --regression --input report.json [--lanes path --lane id] [--policy policy.json] [--out summary.json]",
      "       pnpm bench:engines --regression-collection --target <web|desktop|android|ios> [--device id] [--prebuilt-artifact path] [--out path]",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  await mkdir(artifactRoot, { recursive: true });
  if (process.argv.includes("--plan")) {
    if (flag("suite") !== "cross-engine" || flag("out") === undefined)
      throw new BenchError(
        "TN_BENCH_BAD_PLAN",
        "--plan requires --suite cross-engine --out <bundle-dir>",
      );
    const dir = path.resolve(repoRoot, flag("out") as string);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "plan.json"), `${JSON.stringify(buildDraftPlan(), null, 2)}\n`, {
      flag: "wx",
    });
    process.stdout.write(`wrote draft plan: ${dir}/plan.json\n`);
    return;
  }
  const reportDir = flag("report-html");
  if (reportDir !== undefined) {
    const dir = path.resolve(repoRoot, reportDir);
    const result = await writeCampaignReport(dir);
    process.stdout.write(
      `wrote ${dir}/report.html, results.json, results.csv, checksums.sha256 (${result.runs} runs)\n`,
    );
    if (result.partial) process.exitCode = 2;
    return;
  }
  const meshArm = flag("mesh-arm");
  if (meshArm !== undefined) return runMeshArm(meshArm);
  const cullArm = flag("cull-arm");
  if (cullArm !== undefined) return runCullArm(cullArm);
  if (flag("cull-compare") !== undefined) return compareCullArms();
  const lightsArm = flag("lights-arm");
  if (lightsArm !== undefined) return runLightsArm(lightsArm);
  if (flag("lights-compare") !== undefined) return compareLightsArms();
  const cityArm = flag("city-arm");
  if (cityArm !== undefined) return runCityArm(cityArm);
  // Presence, not a parsed value: a bare `--collect-city-pair` is this route's missing-argument
  // case, and `flag()` cannot see a flag whose value is missing.
  if (process.argv.includes("--collect-city-pair")) return collectCityPairCommand();
  if (flag("city-compare") !== undefined) return compareCityArms();
  const cubesArm = flag("cubes-arm");
  if (cubesArm !== undefined) return runCubesArm(cubesArm);
  if (flag("cubes-compare") !== undefined) return compareCubesArms();
  const foxesArm = flag("foxes-arm");
  if (foxesArm !== undefined) return runFoxesArm(foxesArm);
  if (flag("foxes-compare") !== undefined) return compareFoxesArms();
  if (flag("mesh-compare") !== undefined) return compareMeshArms();
  if (process.argv.includes("--regression-collection")) return runRegressionCollectionCommand();
  if (process.argv.includes("--regression")) return runRegressionCommand();
  const checkReport = flag("check-report");
  if (checkReport !== undefined) return runReportCheckCommand(checkReport);
  const arm = flag("arm");
  if (arm !== undefined) return runArmCommand(arm, ladderOptions());
  if (process.argv.includes("--compare")) return runProductComparison();
  printUsage();
}

// Invoked, not imported: a spec imports `archiveBuild` from this module, and an import is not a run.
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
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
