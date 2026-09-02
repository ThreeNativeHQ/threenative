// Generated source. The field, seed and refinement quality belong to this game.
import { BufferAttribute, BufferGeometry, Group, type Material, Mesh } from "three";
import { auditImplicitSurface, buildImplicitSurface } from "./implicitSurface.js";
import {
  type IRockRidgeWorkerInput,
  type IRockRidgeWorkerMessage,
  createRockRidgeWorkerSource,
} from "./rockRidge.worker.js";
// biome-ignore format: compact generated bounds keep the render source under its smell budget.
const ROCK_RIDGE_BOUNDS = { maxX: 54, maxY: 18, maxZ: -42, minX: -54, minY: -32, minZ: -74 } as const;
const PREVIEW_SETTINGS = { cellSize: 10, latticeCap: 30_000, protectBoundary: true } as const;
const REFINED_SETTINGS = { cellSize: 8, latticeCap: 100_000, protectBoundary: true } as const;
// biome-ignore format: the generated field stays within the render-source smell budget.
export function sampleGraniteField(x: number, y: number, z: number, seed: number, bounds: IRockRidgeWorkerInput["bounds"]): number {
  const phase = ((seed >>> 0) % 4096) * 0.0015;
  const noise = (index: number): number => {
    let value = Math.imul((index | 0) ^ (seed | 0), 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_295;
  };
  const smoothMin = (a: number, b: number, radius: number): number => {
    const h = Math.max(radius - Math.abs(a - b), 0) / radius;
    return Math.min(a, b) - h * h * h * radius / 6;
  };
  const centerZ = -58 + Math.sin(x * 0.08 + phase) * 1.2 + Math.cos(x * 0.17 - phase) * 0.7;
  const top = -5 + Math.sin(x * 0.13 + phase * 2) * 0.8;
  const contactY = -20;
  const bottom = contactY - 2 + Math.cos(x * 0.07 - phase) * 0.45;
  let field = Math.hypot(x / 50, (y - (top + bottom) * 0.5) / ((top - bottom) * 0.5), (z - centerZ) / 12) - 1;
  for (let index = -4; index <= 4; index += 1) {
    const jitter = noise(index + 31);
    const lobeX = index * 11 + (jitter - 0.5) * 3;
    const lobeZ = centerZ + (noise(index + 61) - 0.5) * 3;
    const lobeY = -5 + (noise(index + 91) - 0.5) * 2;
    const lobe = Math.hypot((x - lobeX) / (6.4 + noise(index + 121) * 2.2), (y - lobeY) / (8.5 + noise(index + 151) * 3), (z - lobeZ) / (6.5 + noise(index + 181) * 2)) - 1;
    field = smoothMin(field, lobe, 0.22);
  }
  const edge = Math.min(x - bounds.minX, bounds.maxX - x, y - bounds.minY, bounds.maxY - y, z - bounds.minZ, bounds.maxZ - z);
  return Math.max(field, 0.06 - edge / 4);
}
function hashArray(array: Float32Array | Uint32Array): string {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let hash = 2_166_136_261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16_777_619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
// biome-ignore format: compact generated validation keeps the render source under its smell budget.
function topologyError(report: ReturnType<typeof auditImplicitSurface>): Error | undefined {
  if (report.boundaryEdges === 0 && report.degenerateTriangles === 0 && report.windingConflicts === 0 && report.signedVolume > 0)
    return undefined;
  const error = new Error(`boundary=${report.boundaryEdges}, degenerate=${report.degenerateTriangles}, winding=${report.windingConflicts}, volume=${report.signedVolume}`);
  error.name = "TN_ROCK_RIDGE_TOPOLOGY_INVALID";
  return error;
}
// biome-ignore format: compact generated mesh attachment keeps the render source under its smell budget.
function makeMesh(result: ReturnType<typeof buildImplicitSurface>, material: Material, generation: number): { mesh: Mesh; report: ReturnType<typeof auditImplicitSurface> } {
  const report = auditImplicitSurface(result.indices, result.positions);
  const error = topologyError(report);
  if (error !== undefined) throw error;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(result.positions, 3));
  geometry.setIndex(new BufferAttribute(result.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, material);
  mesh.name = `granite-ridge-${generation === 0 ? "preview" : "refined"}`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return { mesh, report };
}
// biome-ignore format: compact generated controller contract keeps the render source under budget.
export interface IRockRidgeController { readonly object: Group; readonly state: "preview" | "refined" | "error" | "disposed"; debug(): Record<string, unknown>; dispose(): void; rebuild(seed?: number): void; }
// biome-ignore format: the controller is a single generated render source with a fixed budget.
export function createRockRidge(ridgeMaterial: Material, initialSeed: number, options: { deferRefinement?: boolean } = {}): IRockRidgeController {
  const object = new Group();
  object.name = "granite-ridge";
  const preview = buildImplicitSurface({
    ...PREVIEW_SETTINGS, bounds: ROCK_RIDGE_BOUNDS, closed: true,
    sample: (x, y, z) => sampleGraniteField(x, y, z, initialSeed, ROCK_RIDGE_BOUNDS),
  });
  let visible = makeMesh(preview, ridgeMaterial, 0);
  object.add(visible.mesh);
  const state = {
    phase: "preview" as IRockRidgeController["state"],
    visibleGeneration: 0,
    requestedGeneration: 0,
    lastError: undefined as string | undefined,
    report: { ...visible.report, buildMs: preview.report.buildMs, cellSize: preview.report.cellSize },
  };
  const workers = new Set<Worker>();
  const workerSource = createRockRidgeWorkerSource(sampleGraniteField);
  const stop = (worker: Worker): void => {
    if (!workers.delete(worker)) return;
    worker.terminate();
  };
  const fail = (error: unknown): void => {
    state.phase = "error";
    state.lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    for (const worker of [...workers]) stop(worker);
  };
  const swap = (result: ReturnType<typeof buildImplicitSurface>, generation: number, buildMs: number, cellSize: number): void => {
    const next = makeMesh(result, ridgeMaterial, generation);
    const previous = visible.mesh;
    object.add(next.mesh);
    visible = next;
    state.visibleGeneration = generation;
    state.report = { ...next.report, buildMs, cellSize };
    object.remove(previous);
    previous.geometry.dispose();
  };
  const dispatch = (seed: number, settings: typeof REFINED_SETTINGS): void => {
    const generation = state.requestedGeneration + 1;
    state.requestedGeneration = generation;
    if (typeof Worker === "undefined" || typeof URL.createObjectURL !== "function") {
      const error = new Error("TN_ROCK_RIDGE_WORKER_FAILED: classic Worker support is required.");
      fail(error);
      throw error;
    }
    const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    let worker: Worker;
    try {
      worker = new Worker(url);
    } catch (error) {
      URL.revokeObjectURL(url);
      fail(error);
      throw error;
    }
    URL.revokeObjectURL(url);
    workers.add(worker);
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: stale-result and error guards stay atomic.
    worker.onmessage = (event: MessageEvent<IRockRidgeWorkerMessage>) => {
      stop(worker);
      const message = event.data;
      if (state.phase === "disposed" || message.generation !== state.requestedGeneration) return;
      if (message.error !== undefined || message.positions === undefined || message.indices === undefined || message.report === undefined) {
        fail(new Error(`${message.name ?? "TN_ROCK_RIDGE_WORKER_FAILED"}: ${message.error ?? "missing result"}`));
        return;
      }
      try {
        const result = { positions: message.positions, indices: message.indices, report: message.report } as ReturnType<typeof buildImplicitSurface>;
        const report = auditImplicitSurface(result.indices, result.positions);
        const error = topologyError(report);
        if (error !== undefined) throw error;
        if (report.boundaryEdges !== message.report.boundaryEdges || report.degenerateTriangles !== message.report.degenerateTriangles || report.windingConflicts !== message.report.windingConflicts)
          throw new Error("TN_ROCK_RIDGE_WORKER_FAILED: report does not match final arrays.");
        swap(result, message.generation, message.report.buildMs, message.report.cellSize);
        state.phase = "refined";
      } catch (error) {
        fail(error);
      }
    };
    worker.onerror = (event) => {
      stop(worker);
      if (state.phase !== "disposed" && generation === state.requestedGeneration)
        fail(new Error(`TN_ROCK_RIDGE_WORKER_FAILED: ${event.message || "worker error"}`));
    };
    try {
      const input: IRockRidgeWorkerInput = {
        bounds: ROCK_RIDGE_BOUNDS, cellSize: settings.cellSize, generation,
        latticeCap: settings.latticeCap, protectBoundary: settings.protectBoundary, seed,
      };
      worker.postMessage(input);
    } catch (error) {
      stop(worker);
      fail(error);
      throw error;
    }
  };
  if (options.deferRefinement !== true) dispatch(initialSeed, REFINED_SETTINGS);
  return {
    object,
    get state() {
      return state.phase;
    },
    debug: () => ({
      state: state.phase,
      generation: state.visibleGeneration,
      requestedGeneration: state.requestedGeneration,
      positionHash: hashArray(visible.mesh.geometry.getAttribute("position").array as Float32Array),
      indexHash: hashArray(visible.mesh.geometry.index?.array as Uint32Array),
      topology: state.report,
      ...(state.lastError === undefined ? {} : { error: state.lastError }),
    }),
    dispose: () => {
      if (state.phase === "disposed") return;
      state.phase = "disposed";
      state.requestedGeneration += 1;
      for (const worker of [...workers]) stop(worker);
      object.remove(visible.mesh);
      visible.mesh.geometry.dispose();
    },
    rebuild: (seed = initialSeed) => {
      if (state.phase === "disposed") return;
      dispatch(seed, REFINED_SETTINGS);
    },
  };
}
