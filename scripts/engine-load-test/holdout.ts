// PRD-533 phase 1, workload 3: the GPU-heavy visual holdout. It is the starter template's frame
// with its shipped post chain at 1080p: the scene the PRD-526 visual gate draws on both backends,
// paused so the pose is fixed, drawn repeatedly with a per-frame meter. `current` is today's
// ThreeNative renderer in the browser (three's WebGPU renderer with the starter's own
// RenderPipeline, GPU time from three's timestamp queries). `native` is the native engine's render
// driver on the cooked scene and the exported post graph (GPU time from the engine's timestamp
// queries). What is asserted equal is what is presented: the visible meshes, their triangles and the
// resolution. The workload is only a holdout while it is GPU-bound, so that is asserted too: an arm
// whose GPU time is not most of its frame fails the run instead of being reported as GPU-heavy.
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { softwareAdapterName } from "../../packages/playtest/src/runner/browser.js";
import type { IStarterMeter } from "../../packages/runtime-native/scripts/starter-meter.js";
import type { IStarterVisualSnapshot } from "../../packages/runtime-native/scripts/starter-visual-cook.js";
import { encodeFixture } from "../../packages/three-native/src/fixture-protocol.js";
import {
  loadStarterVisualPage,
  observeStarterGraph,
  starterSnapshotFixture,
} from "../starter-native-visual.js";
import { captureTemplate, packageLocalFramework } from "../visual-gate.js";
import { BenchError } from "./report.js";
import { type IPresentedWork, assertEqualPresentedWork } from "./workloads.js";

export const HOLDOUT_ARMS = ["current", "native"] as const;
export type HoldoutArm = (typeof HOLDOUT_ARMS)[number];
export const HOLDOUT_SIZE = { width: 1920, height: 1080 } as const;
/** The share of an arm's frame its GPU time must reach for the workload to count as GPU-heavy. */
export const GPU_BOUND_SHARE = 0.5;
const PORT = 5213;

interface ISeries {
  p50: number;
  p95: number;
}

export interface IHoldoutArmResult {
  arm: HoldoutArm;
  driver: "browser-legacy" | "render-driver";
  size: [number, number];
  /** Visible meshes and their triangles, counted from the arm's own scene. */
  sceneMeshes: number;
  sceneTriangles: number;
  /** The renderer's own counts: they include the post chain's passes and differ by definition. */
  draws: number;
  triangles: number;
  submitMs: ISeries;
  frameMs: ISeries;
  gpuMs: ISeries | null;
  /** Browser arm only: the pipelined per-frame cost, and how many passes the GPU reading summed. */
  throughputMs?: number;
  gpuPasses?: number;
  gpuSample?: number[];
}

export interface IHoldoutOptions {
  arms: readonly string[];
  frames: number;
}

export function parseHoldoutArms(arms: readonly string[]): HoldoutArm[] {
  for (const arm of arms)
    if (!(HOLDOUT_ARMS as readonly string[]).includes(arm))
      throw new BenchError(
        "TN_BENCH_ARM_UNAVAILABLE",
        `the holdout workload runs arms ${HOLDOUT_ARMS.join(", ")}, not ${arm}`,
      );
  return arms as HoldoutArm[];
}

/** The page meter's reading as an arm result; a software adapter is refused, it is no GPU. */
export function currentHoldoutResult(meter: IStarterMeter): IHoldoutArmResult {
  const software = softwareAdapterName(meter.adapter ?? undefined);
  if (software !== undefined) throw new BenchError("TN_BENCH_SOFTWARE_ADAPTER", software);
  return {
    arm: "current",
    driver: "browser-legacy",
    size: meter.size,
    sceneMeshes: meter.sceneMeshes,
    sceneTriangles: meter.sceneTriangles,
    draws: meter.draws,
    triangles: meter.triangles,
    submitMs: meter.submitMs,
    frameMs: meter.frameMs,
    gpuMs: meter.gpuMs,
    throughputMs: meter.throughputMs,
    gpuPasses: meter.gpuPasses,
    gpuSample: meter.gpuSample,
  };
}

interface IDriverReport {
  arm: string;
  size: [number, number];
  sceneMeshes: number;
  sceneTriangles: number;
  draws: number;
  triangles: number;
  submitMs: ISeries;
  frameMs: ISeries;
  gpuMs: ISeries | null;
}

export function nativeHoldoutResult(report: IDriverReport): IHoldoutArmResult {
  if (report.arm !== "native-render-driver")
    throw new BenchError(
      "TN_BENCH_ARM_MISMATCH",
      `asked the render driver for the native holdout, it reported ${report.arm}`,
    );
  return {
    arm: "native",
    driver: "render-driver",
    size: report.size,
    sceneMeshes: report.sceneMeshes,
    sceneTriangles: report.sceneTriangles,
    draws: report.draws,
    triangles: report.triangles,
    submitMs: report.submitMs,
    frameMs: report.frameMs,
    gpuMs: report.gpuMs,
  };
}

/** GPU time over frame time, the measured answer to "is this scene GPU-bound here". */
export function gpuShare(result: IHoldoutArmResult): number | undefined {
  return result.gpuMs === null ? undefined : result.gpuMs.p50 / result.frameMs.p50;
}

/**
 * The visible meshes, their triangles and the resolution, each arm counting from its own scene.
 * The renderers' own triangle counts are reported and only checked to cover the scene.
 */
export function holdoutPresented(result: IHoldoutArmResult): IPresentedWork {
  if (result.size[0] !== HOLDOUT_SIZE.width || result.size[1] !== HOLDOUT_SIZE.height)
    throw new BenchError(
      "TN_BENCH_WORKLOAD_MISMATCH",
      `holdout: ${result.arm} drew at ${result.size.join("x")}, not ${HOLDOUT_SIZE.width}x${HOLDOUT_SIZE.height}`,
    );
  if (result.triangles < result.sceneTriangles)
    throw new BenchError(
      "TN_BENCH_PRESENTED_SHORT",
      `holdout: ${result.arm} rendered ${result.triangles} triangles for ${result.sceneTriangles} in the scene`,
    );
  return { objects: result.sceneMeshes, triangles: result.sceneTriangles };
}

/**
 * What makes the run a GPU-heavy holdout. The scene must be GPU-heavy on the arm that is not
 * CPU-limited, the native one; the legacy arm may be CPU-bound (that is a finding to report, not a
 * reason to refuse the workload), but its GPU reading has to be a validated meter: it exists, it
 * summed the post chain's passes and not only the main one, and it fits inside the frame.
 */
export function assertHoldoutValid(results: readonly IHoldoutArmResult[]): void {
  const native = results.find((r) => r.arm === "native");
  if (native === undefined)
    throw new BenchError(
      "TN_BENCH_HOLDOUT_NO_NATIVE",
      "holdout: the native arm defines whether the scene is GPU-heavy, so it has to run",
    );
  const nativeShare = gpuShare(native);
  if (nativeShare === undefined)
    throw new BenchError(
      "TN_BENCH_HOLDOUT_GPU_UNMEASURED",
      "holdout: native reported no GPU time, so the scene cannot be called GPU-heavy",
    );
  if (nativeShare <= GPU_BOUND_SHARE)
    throw new BenchError(
      "TN_BENCH_HOLDOUT_NOT_GPU_BOUND",
      `holdout: native spends ${(nativeShare * 100).toFixed(1)}% of its frame on the GPU, not above ${GPU_BOUND_SHARE * 100}%`,
    );
  const legacy = results.find((r) => r.arm === "current");
  if (legacy === undefined) return;
  if (legacy.gpuMs === null)
    throw new BenchError(
      "TN_BENCH_HOLDOUT_GPU_UNMEASURED",
      "holdout: current reported no GPU time, so its share cannot be reported",
    );
  if ((legacy.gpuPasses ?? 0) < 2)
    throw new BenchError(
      "TN_BENCH_HOLDOUT_METER_PARTIAL",
      `holdout: current's GPU reading summed ${legacy.gpuPasses ?? 0} pass(es); the post chain has more, so the meter covers only part of the frame`,
    );
  if (legacy.gpuMs.p50 > legacy.frameMs.p50)
    throw new BenchError(
      "TN_BENCH_HOLDOUT_METER_INCONSISTENT",
      `holdout: current's GPU time ${legacy.gpuMs.p50} ms exceeds its frame ${legacy.frameMs.p50} ms`,
    );
}

/** Which resource the arm waits on per frame: the CPU submit or the GPU. */
export function limit(result: IHoldoutArmResult): "CPU" | "GPU" | "unknown" {
  return result.gpuMs === null ? "unknown" : result.submitMs.p50 > result.gpuMs.p50 ? "CPU" : "GPU";
}

const execFileAsync = promisify(execFile);

interface IStarterCapture {
  legacy: IStarterMeter;
  fixtureFile: string;
  graphFile: string;
}

/** Scaffold the starter, meter it in the browser at 1080p, and export its scene and post graph. */
async function captureLegacy(
  repoRoot: string,
  out: string,
  options: IHoldoutOptions,
): Promise<IStarterCapture> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "tn-holdout-"));
  try {
    const packages = await packageLocalFramework(temporary);
    const bundle = path.join(temporary, "starter-visual.js");
    // esbuild is a runtime-native dependency; the workspace root does not install it.
    await execFileAsync(path.join(repoRoot, "packages/runtime-native/node_modules/.bin/esbuild"), [
      path.join(repoRoot, "packages/runtime-native/scripts/starter-visual-page.ts"),
      "--bundle",
      "--platform=browser",
      "--format=iife",
      "--global-name=TnStarterVisual",
      `--outfile=${bundle}`,
    ]);
    let captured: IStarterCapture | undefined;
    await captureTemplate(
      "starter",
      temporary,
      packages,
      PORT,
      async (page) => {
        await page.setViewportSize({ width: HOLDOUT_SIZE.width, height: HOLDOUT_SIZE.height });
        await page.waitForTimeout(1_000);
        await loadStarterVisualPage(page, bundle);
        const legacy: IStarterMeter = await page.evaluate(
          `TnStarterVisual.meterStarterFrames(${options.frames})`,
        );
        const snapshot = (await page.evaluate(
          "TnStarterVisual.prepareStarterSnapshot()",
        )) as IStarterVisualSnapshot;
        const sceneFile = path.join(out, "starter.gltf");
        const graphFile = path.join(out, "starter-post.json");
        await writeFile(sceneFile, JSON.stringify(snapshot.gltf));
        await writeFile(graphFile, JSON.stringify(snapshot.postGraph));
        const base = starterSnapshotFixture(snapshot, sceneFile);
        if (base.render === undefined) throw new Error("TN_BENCH_HOLDOUT_FIXTURE_NO_RENDER");
        const fixture = {
          ...base,
          render: { ...base.render, width: HOLDOUT_SIZE.width, height: HOLDOUT_SIZE.height },
        };
        const fixtureFile = path.join(out, "scene-fixture.json");
        await writeFile(fixtureFile, JSON.stringify(fixture, null, 2));
        captured = { legacy, fixtureFile, graphFile };
        return page.screenshot({ type: "png" });
      },
      async (page) => {
        await page.route(/\/src\/render\/postprocessing\.(?:ts|js)(?:\?.*)?$/u, async (route) => {
          const response = await route.fetch();
          await route.fulfill({
            response,
            body: observeStarterGraph(await response.text()),
          });
        });
      },
    );
    if (captured === undefined)
      throw new BenchError("TN_BENCH_HOLDOUT_CAPTURE_MISSING", "no capture");
    return captured;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function runNative(repoRoot: string, capture: IStarterCapture, scratch: string, frames: number) {
  const driver = path.join(
    repoRoot,
    "packages/runtime-native/build/tn-linux/tn-native-engine-render-driver",
  );
  if (!existsSync(driver))
    throw new BenchError(
      "TN_BENCH_CP1_HOST_MISSING",
      `${path.relative(repoRoot, driver)} is not built: cmake --build packages/runtime-native/build/tn-linux --target tn-native-engine-render-driver`,
    );
  const report = path.join(scratch, "holdout-native.json");
  const png = path.join(scratch, "holdout-native.png");
  const fixture = JSON.parse(readFileSync(capture.fixtureFile, "utf8"));
  const run = spawnSync(driver, [], {
    cwd: repoRoot,
    env: {
      ...process.env,
      TN_FIXTURE_FRAMES: String(frames),
      TN_FIXTURE_REPORT: report,
      TN_FIXTURE_POST_GRAPH: capture.graphFile,
    },
    input: `${encodeFixture(fixture, png).join("\n")}\n`,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error || run.status !== 0)
    throw new BenchError(
      "TN_BENCH_HOLDOUT_DRIVER_FAILED",
      `the render driver failed: ${run.error?.message ?? run.stderr.slice(-2000)}`,
    );
  return nativeHoldoutResult(JSON.parse(readFileSync(report, "utf8")) as IDriverReport);
}

export async function runHoldout(repoRoot: string, artifactRoot: string, options: IHoldoutOptions) {
  const arms = parseHoldoutArms(options.arms);
  const scratch = path.join(artifactRoot, "holdout");
  await mkdir(scratch, { recursive: true });
  const capture = await captureLegacy(repoRoot, scratch, options);
  const results = arms.map((arm) =>
    arm === "current"
      ? currentHoldoutResult(capture.legacy)
      : runNative(repoRoot, capture, scratch, options.frames),
  );
  const graphSha = createHash("sha256").update(readFileSync(capture.graphFile)).digest("hex");
  const file = path.join(scratch, "holdout-report.json");
  await writeFile(
    file,
    `${JSON.stringify(
      {
        workload: "holdout",
        scene: "starter, paused, shipped post chain",
        postGraphSha256: graphSha,
        size: [HOLDOUT_SIZE.width, HOLDOUT_SIZE.height],
        frames: options.frames,
        arms: results,
      },
      null,
      2,
    )}\n`,
  );
  assertEqualPresentedWork(
    "holdout",
    results.map((r) => ({ arm: r.arm, presented: holdoutPresented(r) })),
  );
  // After the report is on disk: a run that fails the GPU-bound check still leaves its numbers.
  const markdownRows = results.map(
    (r) =>
      `| ${r.arm} (${r.driver}) | ${r.sceneMeshes} | ${r.sceneTriangles} | ${r.submitMs.p50.toFixed(2)} | ${r.gpuMs?.p50.toFixed(3) ?? "n/a"} | ${((gpuShare(r) ?? 0) * 100).toFixed(1)}% | ${r.frameMs.p50.toFixed(2)} | ${limit(r)} | ${r.throughputMs?.toFixed(2) ?? "n/a"} | ${r.draws} | ${r.triangles} |`,
  );
  assertHoldoutValid(results);
  return {
    file,
    markdown: [
      `GPU-heavy holdout, starter frame with its post chain at ${HOLDOUT_SIZE.width}x${HOLDOUT_SIZE.height}, ${options.frames} frames`,
      "",
      "| arm | meshes | scene triangles | submit p50 ms | GPU p50 ms | GPU share of frame | frame p50 ms | limit | pipelined ms | draws | rendered triangles |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...markdownRows,
    ].join("\n"),
  };
}
