// Generated source. The worker is a classic Blob worker so browser and native use one path.
import { createImplicitSurfaceWorkerSource } from "./implicitSurface.js";

export interface IRockRidgeWorkerInput {
  readonly bounds: Readonly<Record<"maxX" | "maxY" | "maxZ" | "minX" | "minY" | "minZ", number>>;
  readonly cellSize: number;
  readonly generation: number;
  readonly latticeCap: number;
  readonly protectBoundary: boolean;
  readonly seed: number;
}

export interface IRockRidgeWorkerReport {
  readonly boundaryEdges: number;
  readonly buildMs: number;
  readonly cellSize: number;
  readonly degenerateTriangles: number;
  readonly signedVolume: number;
  readonly triangles: number;
  readonly vertices: number;
  readonly windingConflicts: number;
}

export interface IRockRidgeWorkerMessage {
  readonly error?: string;
  readonly generation: number;
  readonly indices?: Uint32Array;
  readonly name?: string;
  readonly positions?: Float32Array;
  readonly report?: IRockRidgeWorkerReport;
}

export function createRockRidgeWorkerSource(
  sampleField: (
    x: number,
    y: number,
    z: number,
    seed: number,
    bounds: IRockRidgeWorkerInput["bounds"],
  ) => number,
): string {
  const extractor = createImplicitSurfaceWorkerSource();
  const field = sampleField.toString();
  return `${extractor}
const sampleGraniteField = ${field};
self.onmessage = function (event) {
  const input = event.data;
  try {
    const result = buildImplicitSurface({
      bounds: input.bounds,
      cellSize: input.cellSize,
      closed: true,
      latticeCap: input.latticeCap,
      protectBoundary: input.protectBoundary,
      sample: function (x, y, z) {
        return sampleGraniteField(x, y, z, input.seed, input.bounds);
      },
    });
    self.postMessage(
      {
        generation: input.generation,
        indices: result.indices,
        positions: result.positions,
        report: result.report,
      },
      [result.indices.buffer, result.positions.buffer],
    );
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
      generation: input.generation,
      name: error instanceof Error ? error.name : "TN_ROCK_RIDGE_WORKER_FAILED",
    });
  }
};
`;
}
