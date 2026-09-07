import path from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const implicitSurface = path.resolve(
  "packages/create-threenative/templates/starter/src/render/implicitSurface.ts",
);

describe("implicit surface worker source", () => {
  it("keeps helper bindings after a minified production bundle", async () => {
    const entry = `import { createImplicitSurfaceWorkerSource } from ${JSON.stringify(implicitSurface)};
globalThis.__workerSource = createImplicitSurfaceWorkerSource();`;
    const bundled = await build({
      bundle: true,
      format: "iife",
      minify: true,
      platform: "browser",
      write: false,
      stdin: { contents: entry, loader: "ts", resolveDir: process.cwd() },
    });
    const bundleContext: Record<string, unknown> = {};
    runInNewContext(bundled.outputFiles[0]?.text ?? "", bundleContext);
    const workerSource = bundleContext.__workerSource;
    expect(typeof workerSource).toBe("string");
    if (typeof workerSource !== "string") throw new Error("worker source was not produced");

    const invocation = `new Function("options", ${JSON.stringify(`${workerSource}; return buildImplicitSurface(options);`)})({
      bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1, minZ: -1, maxZ: 1 },
      cellSize: 0.5,
      latticeCap: 1000,
      closed: true,
      protectBoundary: true,
      sample: (x, y, z) => x * x + y * y + z * z - 0.65,
    })`;
    const result = runInNewContext(invocation) as {
      indices: Uint32Array;
      positions: Float32Array;
      report: {
        boundaryEdges: number;
        degenerateTriangles: number;
        signedVolume: number;
        windingConflicts: number;
      };
    };
    expect(result.indices.length).toBeGreaterThan(0);
    expect(result.positions.length).toBeGreaterThan(0);
    expect(result.report).toMatchObject({
      boundaryEdges: 0,
      degenerateTriangles: 0,
      windingConflicts: 0,
    });
    expect(result.report.signedVolume).toBeGreaterThan(0);
  });
});
