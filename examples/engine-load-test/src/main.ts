import {
  type BatchedMesh,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
} from "three/webgpu";
import { SceneRenderProjection } from "../../../packages/core/src/renderProjection.js";
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
  type IModuleGraphEntry,
  extractModuleSpecifiers,
  hashServedModuleGraph,
  hashWorkloadModuleGraph,
  isBenchmarkWorkloadModule,
} from "./identity.js";
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

interface ICullingArmReport {
  drawCalls: number;
  renderP50Ms: number;
  renderP95Ms: number;
  repeat: number;
}

interface ICullingReport {
  cullingOff: ICullingArmReport[];
  cullingOn: ICullingArmReport[];
  measuredFrameEnd: number;
  measuredFrameStart: number;
  objectCount: number;
  offscreenFraction: number;
  sampleCount: number;
}

interface ICullingProbe {
  batch: BatchedMesh;
  camera: PerspectiveCamera;
  dispose(): void;
  projection: SceneRenderProjection;
  root: Scene;
}

const CULLING_OBJECT_COUNT = 4_096;
const CULLING_VISIBLE_COUNT = CULLING_OBJECT_COUNT / 4;
const CULLING_ANCHOR_COUNT = 2_048;

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

function createCullingProbe(): ICullingProbe {
  const source = new Scene();
  const material = new MeshBasicMaterial({ color: 0xffffff });
  const anchorGeometry = new BoxGeometry(1, 1, 1);
  for (let index = 0; index < CULLING_ANCHOR_COUNT; index += 1) {
    const anchor = new Mesh(anchorGeometry, material);
    anchor.position.set((index % 64) - 32, Math.floor(index / 64) - 16, 0);
    source.add(anchor);
  }
  const meshes: Mesh[] = [];
  for (let index = 0; index < CULLING_OBJECT_COUNT; index += 1) {
    const mesh = new Mesh(new BoxGeometry(1, 1 + index * 0.001, 1), material);
    mesh.position.z = index < CULLING_VISIBLE_COUNT ? 0 : 1_000;
    source.add(mesh);
    meshes.push(mesh);
  }
  const projection = new SceneRenderProjection(source);
  projection.reconcile();
  if (
    projection.deoptimized ||
    projection.report.instancedBatches !== 1 ||
    projection.report.materialBatches !== 1 ||
    projection.report.projectedObjects !== CULLING_ANCHOR_COUNT + CULLING_OBJECT_COUNT
  ) {
    projection.dispose();
    material.dispose();
    anchorGeometry.dispose();
    for (const mesh of meshes) mesh.geometry.dispose();
    throw new Error("TN_CULLING_PROBE_SETUP_FAILED");
  }

  let batch: BatchedMesh | undefined;
  projection.root.traverse((object) => {
    if ((object as BatchedMesh).isBatchedMesh === true) batch = object as BatchedMesh;
  });
  if (batch === undefined) {
    projection.dispose();
    material.dispose();
    anchorGeometry.dispose();
    for (const mesh of meshes) mesh.geometry.dispose();
    throw new Error("TN_CULLING_PROBE_BATCH_MISSING");
  }

  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  projection.root.updateMatrixWorld(true);
  return {
    batch,
    camera,
    dispose: () => {
      projection.dispose();
      material.dispose();
      anchorGeometry.dispose();
      for (const mesh of meshes) mesh.geometry.dispose();
    },
    projection,
    root: projection.root,
  };
}

async function measureCullingArm(
  renderer: Awaited<ReturnType<typeof createLoadTestHarness>>["renderer"],
  cullingOn: boolean,
  repeat: number,
): Promise<ICullingArmReport> {
  const probe = createCullingProbe();
  // The ON arm uses the projection's production setting. The OFF arm is the paired ablation on
  // the same prepared batch, and is never a game-facing option.
  if (!cullingOn) probe.batch.perObjectFrustumCulled = false;
  const renderMs: number[] = [];
  let drawCalls = 0;
  const statsFrame = Math.floor((frames + warmup) / 2);
  try {
    for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
      renderer.info.reset();
      const startedAt = performance.now();
      await renderer.render(probe.root, probe.camera);
      const elapsed = performance.now() - startedAt;
      if (frameIndex > warmup) renderMs.push(elapsed);
      if (frameIndex === statsFrame) {
        // WebGPU's default framebuffer path adds one full-screen presentation draw after the
        // scene pass. The culling result is the scene's sub-draw count, so keep that presentation
        // draw out of the A/B number while retaining it in the renderer's own meter.
        drawCalls = Math.max(0, renderer.info.render.drawCalls - 1);
      }
      await nextFrame();
    }
  } finally {
    probe.dispose();
  }
  return {
    drawCalls,
    renderP50Ms: percentile(renderMs, 0.5),
    renderP95Ms: percentile(renderMs, 0.95),
    repeat,
  };
}

async function measureCullingRung(
  renderer: Await<ReturnType<typeof createLoadTestHarness>>["renderer"],
): Promise<ICullingReport> {
  const cullingOn: ICullingArmReport[] = [];
  const cullingOff: ICullingArmReport[] = [];
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    cullingOn.push(await measureCullingArm(renderer, true, repeat));
    cullingOff.push(await measureCullingArm(renderer, false, repeat));
  }
  return {
    cullingOff,
    cullingOn,
    measuredFrameEnd: frames - 1,
    measuredFrameStart: warmup + 1,
    objectCount: CULLING_OBJECT_COUNT,
    offscreenFraction: 1 - CULLING_VISIBLE_COUNT / CULLING_OBJECT_COUNT,
    sampleCount: frames - warmup - 1,
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

async function ladderIdentity(adapterLabel: string): Promise<Record<string, string>> {
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
async function describeAdapter(): Promise<string> {
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
  const culling = await measureCullingRung(harness.renderer);
  console.info(`TN_CULLING_RUNG:${JSON.stringify(culling)}`);
  const identity = parameters.has("sourceSha")
    ? await ladderIdentity(harness.adapterLabel)
    : undefined;
  const report = {
    arm: "tn-web",
    build: {
      notes:
        "vite dev build, SceneRenderProjection consumer on three/webgpu; culling A/B uses the production planner and excludes the presentation draw",
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
    culling,
    identity: identity,
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
