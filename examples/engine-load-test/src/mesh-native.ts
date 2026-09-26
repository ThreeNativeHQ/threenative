import { SceneRenderProjection } from "../../../packages/core/src/renderProjection.js";
import { parseMeshBrowserOptions } from "./mesh-browser.js";
import { MESH_VIEWPORT, meshFixtureHash, meshObjects } from "./mesh-fixture.js";
import { createMeshHarness } from "./mesh-harness.js";

declare global {
  var canvas: HTMLCanvasElement | undefined;
}

declare const __TN_MESH_CONFIG__: Readonly<{
  count: number;
  frames: number;
  variant: string;
  warmup: number;
}>;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function percentile(samples: readonly number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1] as number;
}

async function main(): Promise<void> {
  const options = parseMeshBrowserOptions(
    new URLSearchParams({
      count: String(__TN_MESH_CONFIG__.count),
      frames: String(__TN_MESH_CONFIG__.frames),
      variant: __TN_MESH_CONFIG__.variant,
      warmup: String(__TN_MESH_CONFIG__.warmup),
    }).toString(),
  );
  const surface = globalThis.canvas;
  if (surface === undefined) throw new Error("TN_BENCH_NO_CANVAS");
  surface.width = MESH_VIEWPORT.width;
  surface.height = MESH_VIEWPORT.height;
  const projection =
    options.variant === "rotating-projection-off" || options.variant === "rotating-instanced"
      ? undefined
      : (scene: ConstructorParameters<typeof SceneRenderProjection>[0]) =>
          new SceneRenderProjection(scene);
  const harness = await createMeshHarness(surface, options.count, options.variant, projection);
  try {
    const fixtureHash = await meshFixtureHash(
      meshObjects(options.count, options.variant),
      options.variant,
    );
    const warmupStart = performance.now();
    for (let frameId = 0; frameId < options.warmup; frameId++) {
      harness.step(frameId);
      await harness.render();
      await nextFrame();
    }
    if (projection !== undefined && harness.projectionReport()?.reasonCode !== "projected") {
      throw new Error(`TN_BENCH_PROJECTION_NOT_APPLIED:${harness.projectionReport()?.reasonCode}`);
    }
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
      arm: "tn-desktop",
      count: options.count,
      fixtureHash,
      frameP50Ms: percentile(intervals, 0.5),
      frameP95Ms: percentile(intervals, 0.95),
      frameP99Ms: percentile(intervals, 0.99),
      independentlyUpdatedObjects: harness.independentlyUpdatedObjects,
      materialCount: harness.materialCount,
      meanMs: (finalCompletionMs - start) / options.frames,
      profile: "smoke",
      projection: harness.projectionReport(),
      rawSeries: { schemaVersion: 1, unit: "ms", boundaries, finalCompletionMs },
      stats,
      threeRevision: harness.threeRevision,
      variant: options.variant,
      viewport: MESH_VIEWPORT,
      warmupFrames: options.warmup,
      warmupMs: start - warmupStart,
    };
    console.log("ENGINE_LOAD_TEST_JSON_BEGIN");
    const payload = JSON.stringify(result);
    for (let offset = 0; offset < payload.length; offset += 800) {
      console.log(`TNJSON:${payload.slice(offset, offset + 800)}`);
    }
    console.log("ENGINE_LOAD_TEST_JSON_END");
  } finally {
    harness.dispose();
  }
}

main().catch((error: unknown) => {
  console.log(`ENGINE_LOAD_TEST_FAILED ${String(error)}`);
});
