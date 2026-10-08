// PRD-533 phase 1, workload 2: the moving skinned crowd. `current` is today's ThreeNative in the
// browser (examples/engine-load-test/skinned-crowd.html, its `projected` arm: the shipping
// projection and batching) and `native` is the native engine's C++ crowd (tn-native-engine-host
// --crowd). Rig geometry is held equal through the page's own parameters: 64 rigs of 12 bones on a
// 12 x 22 cylinder. Poses are not equal and are not claimed to be: both arms write every bone every
// frame, the native one through its animation mixer, the page by a sine. What is asserted equal is
// what is presented: the rigs and the triangles.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { softwareAdapterName } from "../../packages/playtest/src/runner/browser.js";
import { driveBenchmarkPage, startProcess, waitForUrl } from "./browser.js";
import { BenchError } from "./report.js";
import { type IPresentedWork, assertEqualPresentedWork } from "./workloads.js";

const execFileAsync = promisify(execFile);
const PORT = 5212;

/** The native crowd's rig: player::SkinnedCrowd's constants, which the page is told to match. */
export const CROWD_RIG = { bones: 12, radial: 12, heightSegments: 22, rigs: 64 } as const;

export const CROWD_ARMS = ["current", "native"] as const;
export type CrowdArm = (typeof CROWD_ARMS)[number];

interface ISeries {
  p50: number;
  p95: number;
}

export interface ICrowdArmResult {
  arm: CrowdArm;
  driver: "browser-projected" | "cpp";
  objects: number | undefined;
  triangles: number | undefined;
  /** The rigs' own triangle count, from the arm's scene. `triangles` is the renderer's count. */
  sceneTriangles: number | undefined;
  drawCalls: number;
  hotPathMs: ISeries;
  frameMs: ISeries;
  presented: boolean;
}

export interface ICrowdOptions {
  arms: readonly string[];
  frames: number;
  warmup: number;
}

export function parseCrowdArms(arms: readonly string[]): CrowdArm[] {
  for (const arm of arms)
    if (!(CROWD_ARMS as readonly string[]).includes(arm))
      throw new BenchError(
        "TN_BENCH_ARM_UNAVAILABLE",
        `the skinned-crowd workload runs arms ${CROWD_ARMS.join(", ")}, not ${arm}`,
      );
  return arms as CrowdArm[];
}

/** One page `summary` row (the projected arm at the crowd size) as an arm result. */
export function currentCrowdResult(report: unknown): ICrowdArmResult {
  const summary = (report as { adapter?: unknown; summary?: unknown[] }).summary;
  const row = (summary ?? []).find(
    (candidate) => (candidate as { arm?: string }).arm === "projected",
  ) as
    | {
        drawCalls: number;
        cpuP50: number;
        frameP50: number;
        frameP95: number;
        splitP50: number[];
        presented?: { objects: number; sceneTriangles: number; renderedTriangles: number };
      }
    | undefined;
  if (row === undefined)
    throw new BenchError("TN_BENCH_CROWD_ROW_MISSING", "the page reported no projected crowd row");
  const adapter = (report as { adapter?: Record<string, string> | null }).adapter;
  const software = softwareAdapterName(adapter ?? undefined);
  if (software !== undefined) throw new BenchError("TN_BENCH_SOFTWARE_ADAPTER", software);
  return {
    arm: "current",
    driver: "browser-projected",
    objects: row.presented?.objects,
    triangles: row.presented?.renderedTriangles,
    sceneTriangles: row.presented?.sceneTriangles,
    drawCalls: row.drawCalls,
    // The page times the frame's CPU work (animation, reconcile, render) as one figure.
    hotPathMs: { p50: row.cpuP50, p95: row.cpuP50 },
    frameMs: { p50: row.frameP50, p95: row.frameP95 },
    presented: true,
  };
}

async function runCurrent(repoRoot: string, options: ICrowdOptions): Promise<ICrowdArmResult> {
  const query = new URLSearchParams({
    ladder: String(CROWD_RIG.rigs),
    order: "projected",
    frames: String(options.frames),
    warmup: String(options.warmup),
    bones: String(CROWD_RIG.bones),
    radial: String(CROWD_RIG.radial),
    heightSegments: String(CROWD_RIG.heightSegments),
  });
  const dir = path.join(repoRoot, "examples/engine-load-test");
  const server = startProcess(
    "pnpm",
    ["exec", "vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
    dir,
  );
  try {
    await waitForUrl(`http://127.0.0.1:${PORT}/skinned-crowd.html`, 60_000);
    const report = await driveBenchmarkPage({
      url: `http://127.0.0.1:${PORT}/skinned-crowd.html?${query}`,
      timeoutMs: 600_000,
      onConsole: (line) => {
        if (/error/i.test(line)) process.stderr.write(`[crowd] ${line}\n`);
      },
    });
    return currentCrowdResult(report);
  } finally {
    server.kill("SIGTERM");
  }
}

interface IHostReport {
  arm: string;
  workload: string;
  presentedObjects?: number;
  sceneTriangles?: number;
  hotPathMs: ISeries;
  frameMs: ISeries;
  draws: number;
  triangles: number;
  presented: boolean;
}

async function runNative(
  repoRoot: string,
  options: ICrowdOptions,
  scratch: string,
): Promise<ICrowdArmResult> {
  const host = path.join(repoRoot, "packages/runtime-native/build/tn-linux/tn-native-engine-host");
  if (!existsSync(host))
    throw new BenchError(
      "TN_BENCH_CP1_HOST_MISSING",
      `${path.relative(repoRoot, host)} is not built: cmake --build packages/runtime-native/build/tn-linux --target tn-native-engine-host`,
    );
  const file = path.join(scratch, "crowd-native.json");
  await execFileAsync(
    host,
    [
      "--crowd",
      "--frames",
      String(options.frames - options.warmup),
      "--warmup",
      String(options.warmup),
      "--report",
      file,
    ],
    { cwd: repoRoot, maxBuffer: 8 * 1024 * 1024 },
  );
  const report = JSON.parse(await readFile(file, "utf8")) as IHostReport;
  if (report.arm !== "native-cpp" || report.workload !== "skinned-crowd")
    throw new BenchError(
      "TN_BENCH_ARM_MISMATCH",
      `asked the host for the native crowd, it reported ${report.arm}/${report.workload}`,
    );
  return {
    arm: "native",
    driver: "cpp",
    objects: report.presentedObjects,
    triangles: report.triangles,
    sceneTriangles: report.sceneTriangles,
    drawCalls: report.draws,
    hotPathMs: report.hotPathMs,
    frameMs: report.frameMs,
    presented: report.presented,
  };
}

/**
 * The rigs and the triangles of the rigs, each arm counting them from its own scene. The renderers'
 * own counts differ by definition (three's info includes the shadow pass), so they are reported and
 * only checked to cover the rigs, never compared with each other.
 */
export function crowdPresented(result: ICrowdArmResult): IPresentedWork {
  if (
    result.triangles !== undefined &&
    result.sceneTriangles !== undefined &&
    result.triangles < result.sceneTriangles
  )
    throw new BenchError(
      "TN_BENCH_PRESENTED_SHORT",
      `skinned-crowd: ${result.arm} rendered ${result.triangles} triangles for ${result.sceneTriangles} in the scene`,
    );
  return { objects: result.objects, triangles: result.sceneTriangles };
}

export async function runCrowd(repoRoot: string, artifactRoot: string, options: ICrowdOptions) {
  const arms = parseCrowdArms(options.arms);
  const scratch = path.join(artifactRoot, "crowd");
  await mkdir(scratch, { recursive: true });
  const results: ICrowdArmResult[] = [];
  for (const arm of arms)
    results.push(
      arm === "current"
        ? await runCurrent(repoRoot, options)
        : await runNative(repoRoot, options, scratch),
    );
  assertEqualPresentedWork(
    "skinned-crowd",
    results.map((r) => ({ arm: r.arm, presented: crowdPresented(r) })),
  );
  const file = path.join(scratch, "crowd-report.json");
  await writeFile(
    file,
    `${JSON.stringify({ workload: "skinned-crowd", rig: CROWD_RIG, frames: options.frames, warmup: options.warmup, arms: results }, null, 2)}\n`,
  );
  const rows = results.map(
    (r) =>
      `| ${r.arm} (${r.driver}) | ${r.objects} | ${r.hotPathMs.p50.toFixed(2)} | ${r.frameMs.p50.toFixed(2)} | ${r.drawCalls} | ${r.sceneTriangles} | ${r.triangles} |`,
  );
  return {
    file,
    markdown: [
      `skinned crowd, ${CROWD_RIG.rigs} rigs x ${CROWD_RIG.bones} bones, ${options.frames} frames`,
      "",
      "| arm | objects | hot path p50 ms | frame p50 ms | draws | rig triangles | rendered triangles |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...rows,
    ].join("\n"),
  };
}
