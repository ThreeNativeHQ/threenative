// The legacy starter page's per-frame meter, as a type-only module: the holdout benchmark reads it
// without pulling the page's three/TSL graph into the root typecheck.
export interface IStarterMeter {
  frames: number;
  warmup: number;
  size: [number, number];
  /** Submit (CPU) and submit-to-GPU-idle (wall) per frame, p50/p95. */
  submitMs: { p50: number; p95: number };
  frameMs: { p50: number; p95: number };
  /** three's GPU timestamps on the frames it tracked (every Nth), null when the adapter has none. */
  gpuMs: { p50: number; p95: number } | null;
  gpuSamples: number;
  /** Frames submitted back to back with one wait at the end, per frame: the pipelined cost. */
  throughputMs: number;
  /** How many passes the last tracked frame's GPU reading summed, so a partial reading shows. */
  gpuPasses: number;
  /** The first few raw GPU readings, so a reader can see what the series was made of. */
  gpuSample: number[];
  draws: number;
  triangles: number;
  /** Visible meshes and the triangles their geometry holds, the walk GLTFExporter's onlyVisible does. */
  sceneMeshes: number;
  sceneTriangles: number;
  adapter: Record<string, string> | null;
}
