import { installRendererStageHooks } from "../../../scripts/render-profile/renderer-stage-hooks.js";
// Web entry for the PRD-117 ThreeNative arm: drives the ladder and parks a §5.1 run report on
// `window` for `scripts/engine-load-test/run-web.ts` to collect. Kept out of `game.ts` so the
// portable half stays free of browser globals.
import {
  type ILoadTestRung,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  createLoadTestHarness,
} from "./game.js";
import {
  FRAMES_PER_RUNG,
  LADDER,
  REPEATS,
  type RenderMode,
  WARMUP_FRAMES,
  percentile,
} from "./workload.js";

interface IRungReport {
  drawCalls: number;
  frameMs: number[];
  stageReport?: unknown;
  stepMs?: number[];
  mode: RenderMode;
  objectCount: number;
  positionHash: string;
  repeat: number;
  triangles: number;
  visibleObjects: number;
}

const parameters = new URLSearchParams(globalThis.location.search);
const frames = readInteger("frames", FRAMES_PER_RUNG);
const warmup = readInteger("warmup", WARMUP_FRAMES);
const repeats = readInteger("repeats", REPEATS);
const ladder = readLadder();
const modes = readModes();

const status = document.getElementById("status") as HTMLElement;
const canvas = document.getElementById("stage") as HTMLCanvasElement;
canvas.width = VIEWPORT_WIDTH;
canvas.height = VIEWPORT_HEIGHT;

function readInteger(name: string, fallback: number): number {
  const raw = parameters.get(name);
  if (raw === null) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) throw new Error(`TN_BENCH_BAD_PARAM:${name}`);
  return value;
}

function readLadder(): number[] {
  const raw = parameters.get("ladder");
  if (raw === null) return [...LADDER];
  return raw.split(",").map((part) => {
    const value = Number.parseInt(part, 10);
    if (!Number.isFinite(value) || value < 0) throw new Error("TN_BENCH_BAD_PARAM:ladder");
    return value;
  });
}

function readModes(): RenderMode[] {
  const raw = parameters.get("modes");
  if (raw === null) return ["L1", "L2"];
  return raw.split(",").map((part) => {
    if (part !== "L1" && part !== "L2" && part !== "L3")
      throw new Error("TN_BENCH_BAD_PARAM:modes");
    return part;
  });
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

// Opt-in and never part of a published ladder: wrapping every renderer stage inflates the
// absolute frame time, so a profiled run's proportions are the finding and its milliseconds are
// not comparable to anything.
const profileStages = parameters.get("stages") === "1";

async function measureRung(
  harness: Awaited<ReturnType<typeof createLoadTestHarness>>,
  rung: ILoadTestRung,
  repeat: number,
): Promise<IRungReport> {
  harness.setRung(rung);
  // L3 bakes across frames. Drive it to "applied" before a single sample is taken, or the rung
  // times the bake and reports it as the steady-state cost.
  if (rung.mode === "L3") {
    harness.beginCollapse();
    for (let settle = 0; settle < 5_000 && harness.collapseStatus() === "pending"; settle += 1) {
      // Draw occasionally while the pass bakes. Every frame pays the un-collapsed scene's cost and
      // timed the desktop arm out at 16 384; never drawing is worse, because the native host drives
      // `requestAnimationFrame` from its present loop, so a settle that never renders never gets
      // another callback and hangs at full CPU. One frame in eight keeps the pump alive cheaply.
      harness.step(settle);
      if (settle % 8 === 0) await harness.render();
      await nextFrame();
    }
    // `projected` is the projection's applied state, where the pass this replaced said `applied`.
    if (harness.collapseStatus() !== "projected")
      throw new Error(`TN_BENCH_COLLAPSE_${harness.collapseStatus().toUpperCase()}`);
    // Fail closed on the frozen scene. The pass this replaced could classify a moving object as
    // static and render a still picture at a very fast frame time, which is indistinguishable from a
    // win unless the rung refuses to report. The projection cannot freeze an object — every one of
    // them carries its own instance matrix — so the equivalent assertion is that every object is
    // actually in the optimized lane rather than quietly sitting on the exact one.
    //
    // `>=`, not `===`: the count is every projected object in the scene, and the scene holds a
    // ground plane besides the rung's cubes. The old equality held only because the ground was
    // static and so was never a "moving part"; under the projection there is no static/moving split
    // to exclude it, which is the whole point of the replacement.
    const moving = harness.collapseMovingParts();
    if (moving < rung.objectCount)
      throw new Error(`TN_BENCH_COLLAPSE_FROZE:${moving}/${rung.objectCount}`);
  }
  const frameMs: number[] = [];
  const stepMs: number[] = [];
  let drawCalls = 0;
  let triangles = 0;
  let visibleObjects = 0;
  let previous = performance.now();
  const statsFrame = Math.floor((frames + warmup) / 2);
  const hooks = profileStages
    ? installRendererStageHooks(harness.renderer, { mode: "full" })
    : undefined;
  for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
    if (frameIndex === warmup) hooks?.reset();
    harness.step(frameIndex);
    await harness.render();
    // Read before yielding: three's own rAF resets the per-frame counters, so a read after
    // `nextFrame()` reports zero draws no matter what was submitted.
    if (frameIndex === statsFrame) {
      const stats = harness.stats();
      drawCalls = stats.drawCalls;
      triangles = stats.triangles;
      visibleObjects = stats.visibleObjects;
    }
    await nextFrame();
    const now = performance.now();
    const interval = now - previous;
    previous = now;
    if (frameIndex >= warmup) {
      frameMs.push(interval);
      stepMs.push(harness.stepMs);
    }
  }
  const stageReport = hooks?.snapshot({ measuredFrameCount: frames - warmup });
  hooks?.dispose();
  return {
    drawCalls,
    frameMs,
    stageReport,
    stepMs,
    mode: rung.mode,
    objectCount: rung.objectCount,
    positionHash: harness.positionHash,
    repeat,
    triangles,
    visibleObjects,
  };
}

// Read from the adapter the browser actually handed out, never assumed: a run that silently fell
// back to a software rasteriser must be visible in the published report (PRD-117 §4.5).
async function describeAdapter(): Promise<string> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (gpu === undefined) return "no webgpu";
  const adapter = (await gpu.requestAdapter()) as { info?: Record<string, string> } | null;
  const info = adapter?.info;
  if (info === undefined || info === null) return "unknown";
  const parts = [info.vendor, info.architecture, info.device, info.description].filter(
    (part) => typeof part === "string" && part.length > 0,
  );
  return parts.length === 0 ? "unknown" : parts.join(" / ");
}

async function main(): Promise<void> {
  const harness = await createLoadTestHarness(canvas, await describeAdapter());
  const rungs: IRungReport[] = [];
  for (const objectCount of ladder) {
    for (const mode of modes) {
      for (let repeat = 0; repeat < repeats; repeat += 1) {
        status.textContent = `N=${objectCount} ${mode} repeat ${repeat + 1}/${repeats}`;
        const report = await measureRung(harness, { mode, objectCount }, repeat);
        rungs.push(report);
        status.textContent = `N=${objectCount} ${mode} repeat ${repeat + 1}/${repeats} — p95 ${percentile(report.frameMs, 0.95).toFixed(2)} ms`;
      }
    }
  }
  const report = {
    arm: "tn-web",
    build: {
      notes:
        "vite dev build, three/webgpu render path as ThreeNative ships it; defineGame loop not in the measured path",
      type: "release",
    },
    device: {
      battery: null,
      label: parameters.get("device") ?? "desktop-chrome-linux",
    },
    display: {
      height: VIEWPORT_HEIGHT,
      refreshHz: readInteger("refreshHz", 60),
      vsync: parameters.get("vsync") === "on",
      width: VIEWPORT_WIDTH,
    },
    driver: { adapter: harness.adapterLabel, renderer: "three/webgpu WebGPURenderer" },
    engine: { name: "threenative", version: readVersion() },
    rungs,
  };
  (globalThis as unknown as Record<string, unknown>).__ENGINE_LOAD_TEST__ = report;
  status.textContent = `done — ${rungs.length} rungs`;
  harness.dispose();
}

function readVersion(): string {
  return parameters.get("engineVersion") ?? "workspace";
}

main().catch((error: unknown) => {
  status.textContent = `failed: ${String(error)}`;
  (globalThis as unknown as Record<string, unknown>).__ENGINE_LOAD_TEST_ERROR__ = String(error);
});
