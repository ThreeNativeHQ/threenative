import { type BufferGeometry, Mesh, MeshBasicMaterial } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ITerrainJob, runTerrainJob } from "../src/terrain-jobs.js";
import { TerrainTiles } from "../src/world-tiles.js";

const sampleHeight = (x: number, z: number): number =>
  Math.sin(x * 0.17) * 2 + Math.cos(z * 0.13) * 1.5 + Math.sin((x + z) * 0.07);

const BLOCK_PREFIX = "tn-terrain-block:";

/** Follows a point off the world origin, so a block's own transform cannot hide a wrong merge. */
const ISLAND = { x: 48, z: 48 };

/** Two level tiers, so the ring has neighbours to reconcile and a seam strip to build. */
const TWO_TIERS = { lodDistances: [8], lodFactors: [1, 2] };

function terrain(overrides: Record<string, unknown> = {}): TerrainTiles {
  return new TerrainTiles({
    mergeTiles: true,
    residentByteBudget: 64_000_000,
    residentTileBudget: 64,
    sampleHeight,
    streamRadius: 1,
    surface: new MeshBasicMaterial(),
    tileResolution: 33,
    tileSize: 16,
    ...overrides,
  } as ConstructorParameters<typeof TerrainTiles>[0]);
}

function blockMeshes(tiles: TerrainTiles): Mesh[] {
  return tiles.children.filter(
    (child): child is Mesh => child instanceof Mesh && child.name.startsWith(BLOCK_PREFIX),
  );
}

/** Every stitch bridge: the seam strips, in the order the passes wrote them. */
function bridgeMeshes(tiles: TerrainTiles): Mesh[] {
  const blocks = new Set(blockMeshes(tiles));
  return tiles.children.filter(
    (child): child is Mesh => child instanceof Mesh && !blocks.has(child),
  );
}

interface ITerrainStat {
  readonly blocks: number;
  readonly rebuilds: number;
}

function stat(tiles: TerrainTiles): ITerrainStat {
  return tiles.debug().terrainTiles as ITerrainStat;
}

/**
 * One geometry's bytes, as a renderer reads them.
 *
 * A float32 that differs by one ulp moves a triangle, so the comparison is the raw bytes and not a
 * tolerance: the worker path has to be the inline path, not a close copy of it.
 */
function bytes(geometry: BufferGeometry, name: string): Uint8Array {
  const array = geometry.getAttribute(name).array as Float32Array;
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

function indexBytes(geometry: BufferGeometry): Uint8Array {
  const array = geometry.getIndex()?.array as Uint32Array | undefined;
  if (array === undefined) throw new Error("Expected an indexed terrain geometry.");
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

/** `-1` when the two are the same length and the same bytes, else the first byte that differs. */
function firstDifference(left: Uint8Array, right: Uint8Array): number {
  const shared = Math.min(left.length, right.length);
  for (let at = 0; at < shared; at += 1) if (left[at] !== right[at]) return at;
  return left.length === right.length ? -1 : shared;
}

function expectSameGeometry(settled: BufferGeometry, inline: BufferGeometry, what: string): void {
  expect(firstDifference(bytes(settled, "position"), bytes(inline, "position")), what).toBe(-1);
  expect(firstDifference(bytes(settled, "normal"), bytes(inline, "normal")), what).toBe(-1);
  expect(firstDifference(indexBytes(settled), indexBytes(inline)), what).toBe(-1);
}

function expectSameSettling(settled: readonly BufferGeometry[], inline: readonly BufferGeometry[]) {
  expect(settled.length).toBe(inline.length);
  for (const [index, geometry] of settled.entries())
    expectSameGeometry(geometry, inline[index] as BufferGeometry, `geometry ${index}`);
}

function settledGeometry(tiles: TerrainTiles, pick: (mesh: Mesh) => boolean): BufferGeometry[] {
  return tiles.children
    .filter((child): child is Mesh => child instanceof Mesh && pick(child))
    .map((mesh) => mesh.geometry);
}

/**
 * A worker that answers only when the test tells it to.
 *
 * `postMessage` structured-clones what it is given, which is what a real transport does with a typed
 * array, and `answer` runs the worker body — `runTerrainJob`, the same function the inline path
 * calls — over that clone. So a result that survives this fake survived a real serialization.
 */
class FakeWorker {
  static readonly instances: FakeWorker[] = [];
  /** The native host's shim: a module worker is refused by name. */
  static readonly refused = class {
    constructor() {
      throw new Error("TN_NATIVE_WORKER_MODULE_UNSUPPORTED: module workers are not supported");
    }
  };

  readonly options: { type?: string } | undefined;
  readonly received: { id: number; job: ITerrainJob }[] = [];
  readonly url: unknown;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  terminated = false;

  constructor(url: unknown, options?: { type?: string }) {
    this.url = url;
    this.options = options;
    FakeWorker.instances.push(this);
  }

  static latest(): FakeWorker {
    const worker = FakeWorker.instances.at(-1);
    if (worker === undefined) throw new Error("No worker was spawned.");
    return worker;
  }

  postMessage(data: unknown): void {
    this.received.push(structuredClone(data) as { id: number; job: ITerrainJob });
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Answer everything still owed, the way a worker answers: off this thread and a tick later. */
  async answer(): Promise<void> {
    await this.answerAndSpan();
  }

  /**
   * Answer what is owed and report how long the main thread spent handling the replies: the swap,
   * without the job this fake has to run to produce them, which is the whole point of a worker.
   */
  async answerAndSpan(): Promise<number> {
    let span = 0;
    for (const request of this.received.splice(0)) {
      const result = runTerrainJob(request.job);
      // Timed from the delivery, not from here: this fake has to run the job on this thread, and
      // that is the work a real worker would have done elsewhere.
      const started = performance.now();
      this.onmessage?.({ data: { id: request.id, result } });
      await Promise.resolve();
      span += performance.now() - started;
    }
    return span;
  }

  /** A worker that dies mid-job: every job it owes is run on this thread instead. */
  fail(): void {
    this.onerror?.(new Error("fake worker failed"));
  }

  jobOf(kind: ITerrainJob["kind"]): ITerrainJob {
    const request = this.received.find(({ job }) => job.kind === kind);
    if (request === undefined) throw new Error(`No ${kind} job was posted.`);
    return request.job;
  }

  has(kind: ITerrainJob["kind"]): boolean {
    return this.received.some(({ job }) => job.kind === kind);
  }
}

/** Streams to a settled ring, answering the worker after every frame the way a browser would. */
async function settleWith(tiles: TerrainTiles, frames = 12): Promise<void> {
  for (let frame = 0; frame < frames; frame += 1) {
    tiles.follow(ISLAND);
    await FakeWorker.latest().answer();
  }
}

/** The same walk with no worker at all, which is what node is. */
function settleInline(tiles: TerrainTiles, frames = 12): void {
  for (let frame = 0; frame < frames; frame += 1) tiles.follow(ISLAND);
}

/** What a ring settled without a worker looks like: its blocks and its bridges. */
function inlineSettlement(overrides: Record<string, unknown> = {}): {
  blocks: BufferGeometry[];
  bridges: BufferGeometry[];
} {
  const tiles = terrain(overrides);
  try {
    settleInline(tiles);
    const blocks = settledGeometry(tiles, (mesh) => mesh.name.startsWith(BLOCK_PREFIX));
    return {
      blocks,
      bridges: settledGeometry(tiles, (mesh) => !mesh.name.startsWith(BLOCK_PREFIX)),
    };
  } finally {
    tiles.dispose();
  }
}

/** The same ring settled by a worker, answered frame by frame. */
async function workerSettlement(overrides: Record<string, unknown> = {}): Promise<{
  blocks: BufferGeometry[];
  bridges: BufferGeometry[];
}> {
  const tiles = terrain(overrides);
  try {
    await settleWith(tiles);
    const blocks = settledGeometry(tiles, (mesh) => mesh.name.startsWith(BLOCK_PREFIX));
    return {
      blocks,
      bridges: settledGeometry(tiles, (mesh) => !mesh.name.startsWith(BLOCK_PREFIX)),
    };
  } finally {
    tiles.dispose();
  }
}

/** The middle sample, so one slow frame is not the number a PRD quotes. */
function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  if (sorted.length === 0) throw new Error("No samples.");
  return sorted[Math.floor(sorted.length / 2)] as number;
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances.length = 0;
});

describe("terrain jobs", () => {
  it("writes no merged geometry while the merge job that builds it is owed", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const tiles = terrain();
    try {
      tiles.follow(ISLAND);
      const worker = FakeWorker.latest();
      // The job carries the tile levels themselves: no merged buffer exists anywhere yet.
      const job = worker.jobOf("merge");
      if (job.kind !== "merge") throw new Error("Expected a merge job.");
      expect(job.parts.length).toBeGreaterThanOrEqual(2);
      for (const part of job.parts) expect(part.positions.length).toBeGreaterThan(0);
      expect(blockMeshes(tiles)).toHaveLength(0);
      expect(stat(tiles).blocks).toBe(0);
      expect(stat(tiles).rebuilds).toBe(0);
    } finally {
      tiles.dispose();
    }
  });

  it("writes no bridge while the seam job that builds its strips is owed", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const tiles = terrain(TWO_TIERS);
    try {
      tiles.follow(ISLAND);
      expect(FakeWorker.latest().has("seam")).toBe(true);
      expect(bridgeMeshes(tiles)).toHaveLength(0);
      expect(tiles.stitchedEdgeCount).toBe(0);
    } finally {
      tiles.dispose();
    }
  });

  it("settles the block bytes the inline path settles, from the worker's own result", async () => {
    const inline = inlineSettlement();
    expect(inline.blocks.length).toBeGreaterThan(0);

    vi.stubGlobal("Worker", FakeWorker);
    const settled = await workerSettlement();
    expect(settled.blocks.length).toBeGreaterThan(0);
    expectSameSettling(settled.blocks, inline.blocks);
  });

  it("settles the bridge bytes the inline path settles", async () => {
    const inline = inlineSettlement(TWO_TIERS);
    expect(inline.bridges.length).toBeGreaterThan(0);

    vi.stubGlobal("Worker", FakeWorker);
    const settled = await workerSettlement(TWO_TIERS);
    expectSameSettling(settled.bridges, inline.bridges);
  });

  // The spans, measured over a walk, and only the structural claim asserted: a node sample is not a
  // browser frame, so what this holds is which half of a block rebuild runs on this thread. The
  // numbers go to the PRD beside the box they belong to.
  it("reports the main-thread span of a block rebuild while the worker builds it", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const tiles = terrain({
      lodDistances: [],
      lodFactors: [1],
      streamRadius: 2,
      tileResolution: 33,
    });
    const jobs: number[] = [];
    const swaps: number[] = [];
    let vertices = 0;
    try {
      // A walk, so blocks keep changing membership: one rebuild is the cap a frame spends, and a
      // frame without a dirty block measures nothing and is not counted.
      for (let frame = 0; frame < 24; frame += 1) {
        tiles.follow({ x: 16 + frame * 8, z: 16 + frame * 8 });
        const worker = FakeWorker.latest();
        const merges = worker.received.filter(({ job }) => job.kind === "merge");
        if (merges.length === 0) {
          await worker.answerAndSpan();
          continue;
        }
        for (const { job } of merges) {
          if (job.kind !== "merge") throw new Error("Expected a merge job.");
          vertices = job.parts.reduce((total, part) => total + part.positions.length / 3, 0);
          const started = performance.now();
          runTerrainJob(job);
          jobs.push(performance.now() - started);
        }
        swaps.push(await worker.answerAndSpan());
      }
      expect(jobs.length).toBeGreaterThan(2);
      expect(swaps).toHaveLength(jobs.length);
      console.log(
        `TN_TERRAIN_JOBS rebuilds=${String(jobs.length)} vertices=${String(vertices)} mergeP50=${median(
          jobs,
        ).toFixed(2)}ms swapP50=${median(swaps).toFixed(2)}ms`,
      );
    } finally {
      tiles.dispose();
    }
  });

  it("runs the same jobs inline, unchanged, where there is no Worker", () => {
    expect(typeof globalThis.Worker).toBe("undefined");
    const merged = terrain();
    const seamed = terrain(TWO_TIERS);
    try {
      // Inline resolves inside the call, so one frame is enough for a block: nothing is owed a reply.
      merged.follow(ISLAND);
      expect(stat(merged).blocks).toBeGreaterThan(0);
      expect(stat(merged).rebuilds).toBeGreaterThan(0);
      // A bridge waits for the LOD blend to land, which is frames of streaming, not a worker.
      settleInline(seamed);
      expect(bridgeMeshes(seamed).length).toBeGreaterThan(0);
      expect(seamed.stitchedEdgeCount).toBeGreaterThan(0);
    } finally {
      merged.dispose();
      seamed.dispose();
    }
  });

  it("runs the same jobs inline, unchanged, where a Worker refuses a module source", () => {
    const inline = inlineSettlement(TWO_TIERS);
    vi.stubGlobal("Worker", FakeWorker.refused);
    const tiles = terrain(TWO_TIERS);
    try {
      settleInline(tiles);
      expectSameSettling(
        settledGeometry(tiles, (mesh) => mesh.name.startsWith(BLOCK_PREFIX)),
        inline.blocks,
      );
      expectSameSettling(
        settledGeometry(tiles, (mesh) => !mesh.name.startsWith(BLOCK_PREFIX)),
        inline.bridges,
      );
    } finally {
      tiles.dispose();
    }
  });

  it("runs a dead worker's job on this thread, with the same result", async () => {
    const inline = inlineSettlement();
    vi.stubGlobal("Worker", FakeWorker);
    const tiles = terrain();
    try {
      tiles.follow(ISLAND);
      const worker = FakeWorker.latest();
      worker.fail();
      await Promise.resolve();
      await Promise.resolve();
      expect(worker.terminated).toBe(true);
      const settled = blockMeshes(tiles);
      expect(settled.length).toBeGreaterThan(0);
      expectSameGeometry(
        settled[0]?.geometry as BufferGeometry,
        inline.blocks[0] as BufferGeometry,
        "block",
      );
    } finally {
      tiles.dispose();
    }
  });
});
