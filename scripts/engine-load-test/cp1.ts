// PRD-534 CP1: `pnpm bench:engines --arms current,native-v8,native-cpp --workload heterogeneous`.
// The three arms draw the L4 heterogeneous scene (unique material per cube) at one object count,
// resolution and camera path. `current` is today's ThreeNative on the legacy native host (the
// tn-desktop arm at mode L4, projection and batching included); `native-v8` runs
// examples/engine-load-test/native-engine/l4-workload.ts on the native engine through the V8
// adapter; `native-cpp` runs the host's C++ twin of the same workload. The hot path is the game
// update plus the render call per frame, timed the same way in every arm.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { pushHost, readyDevice, runHostOnDevice } from "./cp1-android.js";
import { BenchError, type IRunReport, percentile } from "./report.js";
import { assertEqualPresentedWork } from "./workloads.js";

const execFileAsync = promisify(execFile);

// `native` is the native engine arm of the four-workload comparison (PRD-533): the shipping-shape
// game driver the workload has (V8 for the heterogeneous scene). `native-aot` is the same scene
// as Perry-compiled game code, so native-cpp against native-aot is the binding overhead.
export const CP1_ARMS = ["current", "native", "native-v8", "native-cpp", "native-aot"] as const;
export type Cp1Arm = (typeof CP1_ARMS)[number];

interface ISeries {
  p50: number;
  p95: number;
}

export interface ICp1ArmResult {
  arm: Cp1Arm;
  /** The game driver that ran: `native` is the V8 one here. */
  driver: "legacy-host" | "v8" | "cpp" | "aot";
  /** Cubes presented, as the arm reported them (not the count it was asked for). */
  objects: number | undefined;
  triangles: number;
  /** GPU draw calls submitted. Lower in `current` when its projection batches the scene. */
  drawCalls: number;
  hotPathMs: ISeries;
  frameMs: ISeries;
  /** C ABI crossings; null for `current`, which has no C ABI. */
  crossingsPerFrame: ISeries | null;
  /** Timestamp-query GPU time per frame; null where the arm has no reading yet. Dawn quantizes
   *  timestamps to 65.536 µs unless its timestamp_quantization toggle is off. */
  gpuMs: ISeries | null;
  /** Whether frames went to a window; the native host draws offscreen. */
  presented: boolean;
  /** The device conditions the preflight read before this arm ran (Android only). */
  deviceCondition?: unknown;
}

export interface ICp1Options {
  arms: readonly Cp1Arm[];
  objects: number;
  frames: number;
  warmup: number;
  width: number;
  height: number;
  /** The tn-desktop arm at mode L4, unique materials, ladder = `objects`; on Android, the legacy APK. */
  runCurrent: () => Promise<IRunReport>;
  /** `android` runs the native arms from `adb shell` on `device`; `current` is the caller's. */
  target?: "desktop" | "android";
  device?: string;
}

export function parseCp1Arms(value: string): Cp1Arm[] {
  const arms = value.split(",").map((arm) => arm.trim());
  for (const arm of arms) {
    if (!(CP1_ARMS as readonly string[]).includes(arm))
      throw new BenchError(
        "TN_BENCH_BAD_ARM",
        `CP1 arm ${arm} is not one of ${CP1_ARMS.join(", ")}`,
      );
  }
  if (arms.length === 0 || new Set(arms).size !== arms.length)
    throw new BenchError("TN_BENCH_BAD_ARM", `CP1 arms must be distinct and non-empty: ${value}`);
  return arms as Cp1Arm[];
}

function series(samples: readonly number[]): ISeries {
  return { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95) };
}

function currentResult(report: IRunReport, objects: number): ICp1ArmResult {
  const rung = report.rungs.find(
    (candidate) => candidate.mode === "L4" && candidate.objectCount === objects,
  );
  if (rung === undefined)
    throw new BenchError(
      "TN_BENCH_CP1_RUNG_MISSING",
      `the current arm reported no L4@${objects} rung`,
    );
  if (rung.hotPathMs === undefined)
    throw new BenchError(
      "TN_BENCH_CP1_METER_MISSING",
      "the current arm reported no hotPathMs series",
    );
  return {
    arm: "current",
    driver: "legacy-host",
    objects: rung.objectCount,
    triangles: rung.triangles,
    drawCalls: rung.drawCalls,
    hotPathMs: series(rung.hotPathMs),
    frameMs: series(rung.frameMs),
    crossingsPerFrame: null,
    gpuMs: rung.gpuMs === undefined || rung.gpuMs.length === 0 ? null : series(rung.gpuMs),
    presented: true,
  };
}

interface IHostReport {
  arm: string;
  presentedObjects?: number;
  hotPathMs: ISeries;
  frameMs: ISeries;
  crossingsPerFrame: ISeries;
  gpuMs: ISeries | null;
  draws: number;
  triangles: number;
  presented: boolean;
}

function hostResult(
  arm: Cp1Arm,
  driver: ICp1ArmResult["driver"],
  report: IHostReport,
): ICp1ArmResult {
  return {
    arm,
    driver,
    objects: report.presentedObjects,
    // The native engine batches: far fewer draws than presented meshes, the same triangles.
    triangles: report.triangles,
    drawCalls: report.draws,
    hotPathMs: report.hotPathMs,
    frameMs: report.frameMs,
    crossingsPerFrame: report.crossingsPerFrame,
    gpuMs: report.gpuMs,
    presented: report.presented,
  };
}

/**
 * `native-aot`: the same scene as Perry-compiled game code (tools/native-typescript/bench-aot.mjs),
 * through the facade over the C ABI, metered by the same session code as the host. It needs the pinned
 * Perry toolchain, cargo and the render bridge (the engine's render driver built).
 */
async function aotResult(
  repoRoot: string,
  options: ICp1Options,
  scratch: string,
): Promise<ICp1ArmResult> {
  const file = path.join(scratch, "native-aot.json");
  try {
    await execFileAsync(
      "node",
      [
        path.join(repoRoot, "tools/native-typescript/bench-aot.mjs"),
        "--out",
        file,
        "--objects",
        String(options.objects),
        "--frames",
        String(options.frames),
        "--warmup",
        String(options.warmup),
        "--width",
        String(options.width),
        "--height",
        String(options.height),
      ],
      { cwd: repoRoot, maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new BenchError(
      "TN_BENCH_AOT_FAILED",
      `the native-AOT driver did not run: ${stderr || String(error)}`,
    );
  }
  const report = JSON.parse(await readFile(file, "utf8")) as IHostReport;
  if (report.arm !== "native-aot")
    throw new BenchError(
      "TN_BENCH_ARM_MISMATCH",
      `asked the AOT driver for native-aot, it reported ${report.arm}`,
    );
  return hostResult("native-aot", "aot", report);
}

async function nativeResult(
  repoRoot: string,
  arm: "native" | "native-v8" | "native-cpp" | "native-aot",
  options: ICp1Options,
  scratch: string,
): Promise<ICp1ArmResult> {
  const android = options.target === "android";
  if (arm === "native-aot" && android)
    throw new BenchError(
      "TN_BENCH_CP1_ARM_UNSUPPORTED",
      "native-aot has no Android lane: Perry's Android library is a JNI-loaded shared library, not a host executable",
    );
  if (arm === "native-aot") return aotResult(repoRoot, options, scratch);
  const host = path.join(repoRoot, "packages/runtime-native/build/tn-linux/tn-native-engine-host");
  if (!android && !existsSync(host))
    throw new BenchError(
      "TN_BENCH_CP1_HOST_MISSING",
      `${path.relative(repoRoot, host)} is not built: cmake --build packages/runtime-native/build/tn-linux --target tn-native-engine-host`,
    );
  const args = [
    "--objects",
    String(options.objects),
    // The current arm's `frames` includes its warmup; the host measures `frames` after warmup.
    "--frames",
    String(options.frames - options.warmup),
    "--warmup",
    String(options.warmup),
    "--size",
    `${options.width}x${options.height}`,
  ];
  if (arm === "native-cpp") args.unshift("--cpp");
  let script: string | undefined;
  if (arm !== "native-cpp") {
    script = path.join(scratch, "l4-workload.js");
    await execFileAsync(
      // esbuild is a runtime-native dependency; the workspace root does not install it.
      path.join(repoRoot, "packages/runtime-native/node_modules/.bin/esbuild"),
      [
        path.join(repoRoot, "examples/engine-load-test/native-engine/l4-workload.ts"),
        "--bundle",
        "--format=iife",
        "--platform=neutral",
        "--log-level=error",
        `--outfile=${script}`,
      ],
      { cwd: repoRoot },
    );
    if (!android) args.unshift(script);
  }
  let report: IHostReport;
  let deviceCondition: unknown;
  if (android) {
    const serial = options.device;
    if (serial === undefined)
      throw new BenchError("TN_BENCH_BAD_FLAG", "an Android CP1 run needs --device <serial>");
    deviceCondition = await readyDevice(serial, arm);
    await pushHost(repoRoot, serial);
    const run = await runHostOnDevice(serial, args, script);
    if (run.exit !== 0)
      throw new BenchError(
        "TN_BENCH_CP1_HOST_FAILED",
        `the host exited ${run.exit} on ${serial}: ${run.log.trim().split("\n").slice(-4).join(" | ")}`,
      );
    report = JSON.parse(run.report) as IHostReport;
  } else {
    // The host logs to stdout as well, so the report is read from the file it writes.
    const file = path.join(scratch, `${arm}.json`);
    await execFileAsync(host, [...args, "--report", file], {
      cwd: repoRoot,
      maxBuffer: 8 * 1024 * 1024,
    });
    report = JSON.parse(await readFile(file, "utf8")) as IHostReport;
  }
  const driver = arm === "native-cpp" ? "native-cpp" : "native-v8";
  if (report.arm !== driver)
    throw new BenchError(
      "TN_BENCH_ARM_MISMATCH",
      `asked the host for ${driver}, it reported ${report.arm}`,
    );
  return {
    ...hostResult(arm, arm === "native-cpp" ? "cpp" : "v8", report),
    ...(deviceCondition === undefined ? {} : { deviceCondition }),
  };
}

export async function runCp1(repoRoot: string, artifactRoot: string, options: ICp1Options) {
  const scratch = path.join(artifactRoot, "cp1");
  await mkdir(scratch, { recursive: true });
  const results: ICp1ArmResult[] = [];
  for (const arm of options.arms) {
    results.push(
      arm === "current"
        ? currentResult(await options.runCurrent(), options.objects)
        : await nativeResult(repoRoot, arm, options, scratch),
    );
  }
  // Fail closed on a different workload: every arm reports the cubes and triangles it presented
  // (three's renderer.info count, scene plus the output pass, however the draws are batched).
  assertEqualPresentedWork(
    "heterogeneous",
    results.map((r) => ({ arm: r.arm, presented: { objects: r.objects, triangles: r.triangles } })),
  );
  const overhead = bindingOverhead(results);
  const report = {
    workload: "heterogeneous",
    target: options.target ?? "desktop",
    ...(options.device === undefined ? {} : { device: options.device }),
    objects: options.objects,
    frames: options.frames,
    warmup: options.warmup,
    size: [options.width, options.height],
    arms: results,
    ...(overhead === undefined ? {} : { bindingOverhead: overhead }),
  };
  const file = path.join(scratch, "cp1-report.json");
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  return { file, markdown: cp1Markdown(options, results, overhead) };
}

export interface IBindingOverhead {
  /** native-aot minus native-cpp, per frame: what the compiled game's calls into the engine cost. */
  hotPathP50Ms: number;
  hotPathP95Ms: number;
  ratioP50: number;
}

/** Defined only when both drivers of the same workload ran: the C++ driver is the zero-binding control. */
export function bindingOverhead(results: readonly ICp1ArmResult[]): IBindingOverhead | undefined {
  const cpp = results.find((r) => r.arm === "native-cpp");
  const aot = results.find((r) => r.arm === "native-aot");
  if (cpp === undefined || aot === undefined) return undefined;
  return {
    hotPathP50Ms: aot.hotPathMs.p50 - cpp.hotPathMs.p50,
    hotPathP95Ms: aot.hotPathMs.p95 - cpp.hotPathMs.p95,
    ratioP50: aot.hotPathMs.p50 / cpp.hotPathMs.p50,
  };
}

function cp1Markdown(
  options: ICp1Options,
  results: readonly ICp1ArmResult[],
  overhead: IBindingOverhead | undefined,
): string {
  const rows = results.map(
    (r) =>
      `| ${r.arm} (${r.driver}) | ${r.objects} | ${r.hotPathMs.p50.toFixed(2)} / ${r.hotPathMs.p95.toFixed(2)} | ${r.gpuMs?.p50.toFixed(3) ?? "n/a"} | ${r.frameMs.p50.toFixed(2)} | ${r.crossingsPerFrame?.p50 ?? "n/a"} | ${r.drawCalls} | ${r.triangles} |`,
  );
  return [
    `CP1 heterogeneous L4@${options.objects}, ${options.width}x${options.height}, ${options.frames} frames${options.target === "android" ? `, Android device ${options.device}` : ""}`,
    "",
    "| arm | objects | hot path p50 / p95 ms | GPU p50 ms | frame p50 ms | crossings/frame | draws | triangles |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    ...(overhead === undefined
      ? []
      : [
          "",
          `binding overhead (native-aot - native-cpp), hot path: ${overhead.hotPathP50Ms.toFixed(3)} ms p50 (${overhead.ratioP50.toFixed(2)}x), ${overhead.hotPathP95Ms.toFixed(3)} ms p95`,
        ]),
  ].join("\n");
}
