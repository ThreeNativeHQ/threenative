// The measurement driver both web arms share. The TN arm and the `plain-three-webgpu` control must
// frame the same scene on the same clock, so the loop, the adapter read, the identity and the
// report shape live here once and an arm supplies only what is genuinely its own: its name, its
// build notes, its engine version, and the capabilities it owns (the render projection and the
// stage profiler). Nothing here imports the framework, because the control arm's whole claim is
// that it does not.
import type { installRendererStageHooks } from "../../../scripts/render-profile/renderer-stage-hooks.js";
import {
  type CollapseFactory,
  type ILoadTestHarness,
  type ILoadTestRung,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  createLoadTestHarness,
} from "./game.js";
import {
  type IModuleGraphEntry,
  extractModuleSpecifiers,
  hashServedModuleGraph,
  hashWorkloadModuleGraph,
  isBenchmarkWorkloadModule,
} from "./identity.js";
import {
  FRAMES_PER_RUNG,
  type IWorkloadAxes,
  LADDER,
  REPEATS,
  type RenderMode,
  WARMUP_FRAMES,
  parseAxesRecord,
  percentile,
} from "./workload.js";

export interface IRungReport {
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

/** What one web arm tells the shared driver about itself. */
export interface ILadderArm {
  arm: string;
  buildNotes: string;
  /** The render projection, for the arm that has one. L3 and the culling A/B need it. */
  createCollapse?: CollapseFactory;
  engineName: string;
  engineVersion: string;
  /** The culling A/B, which only exists where there is a projection to plan with. */
  measureCulling?: (renderer: ILoadTestHarness["renderer"]) => Promise<unknown>;
  rendererLabel: string;
  /** Opt-in renderer-stage profiling. It inflates absolute frame time, so it is never a default. */
  stageHooks?: typeof installRendererStageHooks;
}

interface IUserAgentData {
  architecture?: string;
  brands?: readonly { brand: string; version: string }[];
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
  model?: string;
  platform?: string;
}

const parameters = new URLSearchParams(globalThis.location.search);
const frames = readInteger("frames", FRAMES_PER_RUNG);
const warmup = readInteger("warmup", WARMUP_FRAMES);
const repeats = readInteger("repeats", REPEATS);
const ladder = readLadder();
const modes = readModes();
const axes = readAxes();

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

// Every axis is optional and defaults to the PRD-117 scene; `parseAxesRecord` validates the rest.
function readAxes(): IWorkloadAxes {
  return parseAxesRecord(Object.fromEntries(parameters.entries()));
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

// Opt-in and never part of a published ladder: wrapping every renderer stage inflates the
// absolute frame time, so a profiled run's proportions are the finding and its milliseconds are
// not comparable to anything.
const profileStages = parameters.get("stages") === "1";

/** The resolved measurement window, so a rung outside the ladder frames like one inside it. */
export interface ILadderKnobs {
  frames: number;
  repeats: number;
  warmup: number;
}

export const LADDER_KNOBS: ILadderKnobs = { frames, repeats, warmup };

async function measureRung(
  harness: ILoadTestHarness,
  arm: ILadderArm,
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
  const hooks =
    profileStages && arm.stageHooks !== undefined
      ? arm.stageHooks(harness.renderer, { mode: "full" })
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

function observed(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`TN_BENCH_IDENTITY_MISSING:${field}`);
  return value;
}

function resolveServedModuleUrl(specifier: string, parentUrl: string): string {
  let resolved: URL;
  try {
    resolved = new URL(specifier, parentUrl);
  } catch {
    throw new Error(`TN_BENCH_IDENTITY_ARTIFACT_UNAVAILABLE:${specifier}`);
  }
  if (
    resolved.protocol !== "http:" &&
    resolved.protocol !== "https:" &&
    resolved.protocol !== "data:"
  ) {
    throw new Error(`TN_BENCH_IDENTITY_ARTIFACT_UNAVAILABLE:${resolved.protocol}`);
  }
  return resolved.href;
}

async function servedModuleGraph(roots: readonly string[]): Promise<IModuleGraphEntry[]> {
  const pending = [...roots];
  const seen = new Set<string>();
  const entries: IModuleGraphEntry[] = [];
  while (pending.length > 0) {
    const url = pending.shift();
    if (url === undefined || seen.has(url)) continue;
    seen.add(url);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`TN_BENCH_IDENTITY_ARTIFACT_UNAVAILABLE:${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    entries.push({ bytes, url });
    const source = new TextDecoder().decode(bytes);
    for (const specifier of extractModuleSpecifiers(source)) {
      pending.push(resolveServedModuleUrl(specifier, url));
    }
  }
  return entries;
}

function inferArchitecture(platform: string): string {
  if (/x86_64|amd64/i.test(platform)) return "x86_64";
  if (/aarch64|arm64/i.test(platform)) return "arm64";
  if (/arm/i.test(platform)) return "arm";
  if (/x86|i[3-6]86/i.test(platform)) return "x86";
  throw new Error(`TN_BENCH_IDENTITY_MISSING:architecture:${platform}`);
}

async function ladderIdentity(
  adapterLabel: string,
  canvas: HTMLCanvasElement,
): Promise<Record<string, string>> {
  const data = (navigator as unknown as { userAgentData?: IUserAgentData }).userAgentData;
  const highEntropy =
    data?.getHighEntropyValues === undefined
      ? {}
      : await data.getHighEntropyValues(["architecture", "model", "platform"]);
  const operatingSystem = observed(
    highEntropy.platform ?? data?.platform ?? navigator.platform,
    "operatingSystem",
  );
  const architecture = observed(
    highEntropy.architecture ?? data?.architecture ?? inferArchitecture(operatingSystem),
    "architecture",
  );
  const browser = observed(navigator.userAgent, "browser");
  const browserBrands = data?.brands?.map(({ brand, version }) => `${brand} ${version}`).join(", ");
  const jsRuntime = observed(browserBrands || browser, "jsRuntime");
  const gpu = observed(adapterLabel, "gpu");
  const device = observed(
    highEntropy.model || `${operatingSystem}-${architecture}-${gpu}`,
    "device",
  );
  const sourceSha = observed(parameters.get("sourceSha"), "sourceSha");
  const artifactModules = await servedModuleGraph([new URL(import.meta.url).href]);
  const workloadGraph = await servedModuleGraph([
    new URL("./game.ts", import.meta.url).href,
    new URL("./workload.ts", import.meta.url).href,
  ]);
  const workloadModules = workloadGraph.filter(isBenchmarkWorkloadModule);
  const artifactHash = await hashServedModuleGraph(artifactModules);
  const workloadHash = await hashWorkloadModuleGraph(
    workloadModules,
    {
      axes,
      frames,
      ladder,
      modes,
      repeats,
      warmup,
      workload: "moving-l2-l3-16384",
      render: `${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}`,
    },
    workloadGraph,
  );
  return {
    architecture,
    artifactHash,
    browser,
    device,
    graphicsBackend: "WebGPU",
    gpu,
    instrumentationRevision: "engine-load-test-v2",
    jsRuntime,
    // Web reports use the served module identity for the comparator's binary slot.
    nativeBinaryHash: artifactHash,
    operatingSystem,
    presentMode: parameters.get("vsync") === "on" ? "vsync" : "immediate",
    resolution: `${canvas.width}x${canvas.height}`,
    sourceSha,
    workloadHash,
  };
}

// Read from the adapter the browser actually handed out, never assumed: a run that silently fell
// back to a software rasteriser must be visible in the published report (PRD-117 §4.5).
export async function describeAdapter(): Promise<string> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (gpu === undefined) throw new Error("TN_BENCH_IDENTITY_MISSING:gpu");
  const adapter = (await gpu.requestAdapter()) as { info?: Record<string, string> } | null;
  const info = adapter?.info;
  if (info === undefined || info === null) throw new Error("TN_BENCH_IDENTITY_MISSING:gpu");
  const parts = [info.vendor, info.architecture, info.device, info.description].filter(
    (part) => typeof part === "string" && part.length > 0,
  );
  if (parts.length === 0) throw new Error("TN_BENCH_IDENTITY_MISSING:gpu");
  return parts.join(" / ");
}

// The bundler, not the collector, decides this: Vite replaces the member expression at build time
// and only a production bundle is built with `PROD` true. The literal access is load-bearing for
// the same reason it is in `packages/core/src/game.ts` — any indirection survives into the bundle.
function productionBuild(): boolean {
  return (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD === true;
}

/** Runs one arm's ladder and parks its §5.1 run report on `window` for the collector to read. */
export async function runLadderArm(
  canvas: HTMLCanvasElement,
  status: HTMLElement,
  arm: ILadderArm,
): Promise<unknown> {
  canvas.width = VIEWPORT_WIDTH;
  canvas.height = VIEWPORT_HEIGHT;
  const harness = await createLoadTestHarness(
    canvas,
    await describeAdapter(),
    true,
    axes,
    arm.createCollapse,
  );
  const rungs: IRungReport[] = [];
  for (const objectCount of ladder) {
    for (const mode of modes) {
      for (let repeat = 0; repeat < repeats; repeat += 1) {
        status.textContent = `N=${objectCount} ${mode} repeat ${repeat + 1}/${repeats}`;
        const report = await measureRung(harness, arm, { mode, objectCount }, repeat);
        rungs.push(report);
        status.textContent = `N=${objectCount} ${mode} repeat ${repeat + 1}/${repeats} — p95 ${percentile(report.frameMs, 0.95).toFixed(2)} ms`;
      }
    }
  }
  const culling =
    arm.measureCulling === undefined ? undefined : await arm.measureCulling(harness.renderer);
  if (culling !== undefined) console.info(`TN_CULLING_RUNG:${JSON.stringify(culling)}`);
  const identity = parameters.has("sourceSha")
    ? await ladderIdentity(harness.adapterLabel, canvas)
    : undefined;
  const report = {
    arm: arm.arm,
    axes,
    build: {
      notes: `${productionBuild() ? "vite production build" : "vite dev build"}, ${arm.buildNotes}`,
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
    driver: { adapter: harness.adapterLabel, renderer: arm.rendererLabel },
    engine: { name: arm.engineName, version: arm.engineVersion },
    ...(culling === undefined ? {} : { culling }),
    identity: identity,
    rungs,
  };
  (globalThis as unknown as Record<string, unknown>).__ENGINE_LOAD_TEST__ = report;
  status.textContent = `done — ${rungs.length} rungs`;
  harness.dispose();
  return report;
}
