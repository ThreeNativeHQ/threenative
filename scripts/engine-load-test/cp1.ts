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

import { BenchError, type IRunReport, percentile } from "./report.js";

const execFileAsync = promisify(execFile);

export const CP1_ARMS = ["current", "native-v8", "native-cpp"] as const;
export type Cp1Arm = (typeof CP1_ARMS)[number];

interface ISeries {
  p50: number;
  p95: number;
}

export interface ICp1ArmResult {
  arm: Cp1Arm;
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
}

export interface ICp1Options {
  arms: readonly Cp1Arm[];
  objects: number;
  frames: number;
  warmup: number;
  width: number;
  height: number;
  /** The tn-desktop arm at mode L4, unique materials, ladder = `objects`. */
  runCurrent: () => Promise<IRunReport>;
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
  hotPathMs: ISeries;
  frameMs: ISeries;
  crossingsPerFrame: ISeries;
  gpuMs: ISeries | null;
  draws: number;
  triangles: number;
  presented: boolean;
}

async function nativeResult(
  repoRoot: string,
  arm: "native-v8" | "native-cpp",
  options: ICp1Options,
  scratch: string,
): Promise<ICp1ArmResult> {
  const host = path.join(repoRoot, "packages/runtime-native/build/tn-linux/tn-native-engine-host");
  if (!existsSync(host))
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
  else {
    const script = path.join(scratch, "l4-workload.js");
    await execFileAsync(
      path.join(repoRoot, "node_modules/.bin/esbuild"),
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
    args.unshift(script);
  }
  // The host logs to stdout as well, so the report is read from the file it writes.
  const file = path.join(scratch, `${arm}.json`);
  await execFileAsync(host, [...args, "--report", file], {
    cwd: repoRoot,
    maxBuffer: 8 * 1024 * 1024,
  });
  const report = JSON.parse(await readFile(file, "utf8")) as IHostReport;
  if (report.arm !== arm)
    throw new BenchError(
      "TN_BENCH_ARM_MISMATCH",
      `asked the host for ${arm}, it reported ${report.arm}`,
    );
  return {
    arm,
    // The native engine does not batch yet: one draw per presented mesh.
    triangles: report.triangles,
    drawCalls: report.draws,
    hotPathMs: report.hotPathMs,
    frameMs: report.frameMs,
    crossingsPerFrame: report.crossingsPerFrame,
    gpuMs: report.gpuMs,
    presented: report.presented,
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
  // Fail closed on a different workload: every arm must submit the same triangles, three's
  // renderer.info count (scene plus the output pass), however its draws are batched.
  const [first] = results;
  for (const result of results) {
    if (first !== undefined && result.triangles !== first.triangles)
      throw new BenchError(
        "TN_BENCH_CP1_WORKLOAD_MISMATCH",
        `${result.arm} submits ${result.triangles} triangles, ${first.arm} ${first.triangles}`,
      );
  }
  const report = {
    workload: "heterogeneous",
    objects: options.objects,
    frames: options.frames,
    warmup: options.warmup,
    size: [options.width, options.height],
    arms: results,
  };
  const file = path.join(scratch, "cp1-report.json");
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  const rows = results.map(
    (r) =>
      `| ${r.arm} | ${r.hotPathMs.p50.toFixed(2)} / ${r.hotPathMs.p95.toFixed(2)} | ${r.gpuMs?.p50.toFixed(3) ?? "n/a"} | ${r.frameMs.p50.toFixed(2)} | ${r.crossingsPerFrame?.p50 ?? "n/a"} | ${r.drawCalls} | ${r.triangles} |`,
  );
  return {
    file,
    markdown: [
      `CP1 heterogeneous L4@${options.objects}, ${options.width}x${options.height}, ${options.frames} frames`,
      "",
      "| arm | hot path p50 / p95 ms | GPU p50 ms | frame p50 ms | crossings/frame | draws | triangles |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...rows,
    ].join("\n"),
  };
}
