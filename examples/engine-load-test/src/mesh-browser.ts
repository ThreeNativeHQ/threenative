import type { Scene } from "three/webgpu";
import { MESH_VIEWPORT, type MeshVariant, meshFixtureHash, meshObjects } from "./mesh-fixture.js";
import { type IMeshProjection, createMeshHarness } from "./mesh-harness.js";

const VARIANTS: readonly MeshVariant[] = [
  "static",
  "rotating",
  "rotating-projection-off",
  "rotating-instanced",
  "rotating-64-materials",
];

export interface IMeshBrowserOptions {
  count: number;
  frames: number;
  variant: MeshVariant;
  warmup: number;
}

export function parseMeshBrowserOptions(search: string): IMeshBrowserOptions {
  const query = new URLSearchParams(search);
  const integer = (name: string, fallback: number, minimum: number): number => {
    const raw = query.get(name);
    const value = raw === null ? fallback : Number(raw);
    if (!Number.isInteger(value) || value < minimum)
      throw new Error(`TN_BENCH_BAD_MESH_PARAM:${name}`);
    return value;
  };
  const variant = query.get("variant") ?? "rotating";
  if (!VARIANTS.includes(variant as MeshVariant))
    throw new Error("TN_BENCH_BAD_MESH_PARAM:variant");
  return {
    count: integer("count", 1000, 1),
    frames: integer("frames", 600, 1),
    variant: variant as MeshVariant,
    warmup: integer("warmup", 120, 0),
  };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function percentile(samples: readonly number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1] as number;
}

export async function runMeshBrowser(
  arm: "plain-three-web" | "tn-web",
  createProjection?: (scene: Scene) => IMeshProjection,
): Promise<void> {
  const options = parseMeshBrowserOptions(globalThis.location.search);
  const canvas = document.getElementById("stage");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("TN_BENCH_CANVAS_MISSING");
  canvas.width = MESH_VIEWPORT.width;
  canvas.height = MESH_VIEWPORT.height;
  const status = document.getElementById("status");
  const harness = await createMeshHarness(canvas, options.count, options.variant, createProjection);
  try {
    const fixtureHash = await meshFixtureHash(
      meshObjects(options.count, options.variant),
      options.variant,
    );
    for (let frameId = 0; frameId < options.warmup; frameId++) {
      harness.step(frameId);
      await harness.render();
      await nextFrame();
    }
    const projection = harness.projectionReport();
    if (
      arm === "tn-web" &&
      createProjection !== undefined &&
      options.variant !== "rotating-instanced" &&
      projection?.reasonCode !== "projected"
    ) {
      throw new Error(`TN_BENCH_PROJECTION_NOT_APPLIED:${projection?.reasonCode ?? "missing"}`);
    }
    // Warmed shaders stay resident; the workload clock restarts at measured frame zero.
    harness.step(0);
    await harness.drain();
    const start = performance.now();
    const boundaries = [{ frameId: 0, monotonicMs: start }];
    let stats = { drawCalls: 0, triangles: 0 };
    for (let frameId = 0; frameId < options.frames; frameId++) {
      harness.step(frameId);
      await harness.render();
      if (frameId === Math.floor(options.frames / 2)) stats = harness.stats();
      await nextFrame();
      boundaries.push({ frameId: frameId + 1, monotonicMs: performance.now() });
    }
    await harness.drain();
    const finalCompletionMs = performance.now();
    const intervals = boundaries
      .slice(1)
      .map(
        (boundary, index) =>
          boundary.monotonicMs - (boundaries[index] as { monotonicMs: number }).monotonicMs,
      );
    const result = {
      adapter: harness.adapter,
      arm,
      count: options.count,
      fixtureHash,
      frameP50Ms: percentile(intervals, 0.5),
      frameP95Ms: percentile(intervals, 0.95),
      frameP99Ms: percentile(intervals, 0.99),
      independentlyUpdatedObjects: harness.independentlyUpdatedObjects,
      materialCount: harness.materialCount,
      meanMs: (finalCompletionMs - start) / options.frames,
      projection: harness.projectionReport(),
      rawSeries: { schemaVersion: 1, unit: "ms", boundaries, finalCompletionMs },
      stats,
      threeRevision: harness.threeRevision,
      userAgent: navigator.userAgent,
      variant: options.variant,
      viewport: MESH_VIEWPORT,
      warmupFrames: options.warmup,
    };
    (globalThis as unknown as Record<string, unknown>).__ENGINE_MESH_BENCH__ = result;
    if (status !== null)
      status.textContent = `${arm} ${options.variant}@${options.count}: complete`;
  } finally {
    harness.dispose();
  }
}
