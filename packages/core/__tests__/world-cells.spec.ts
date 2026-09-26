import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type IWorldPackage, WorldCells } from "../src/world.js";

/**
 * The runtime fixture is the committed Phase 2 package. Serving it from disk through a stubbed
 * `fetch` keeps the test on the real contract; the model loader is injected so the GPU/network
 * parts stay out of the lane.
 */

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "world-v1");
const manifest = JSON.parse(
  readFileSync(path.join(fixture, "world.json"), "utf8"),
) as IWorldPackage;

const CELL_SIZE = manifest.cellSize;
const MIN_X = manifest.extent.minX;
const MIN_Z = manifest.extent.minZ;

function cellKey(x: number, z: number): string {
  return `${String(x)}:${String(z)}`;
}

function cellAt(x: number, z: number): { x: number; z: number } {
  return {
    x: Math.floor((x - MIN_X) / CELL_SIZE),
    z: Math.floor((z - MIN_Z) / CELL_SIZE),
  };
}

function cellCenter(x: number, z: number): { x: number; z: number } {
  return { x: MIN_X + (x + 0.5) * CELL_SIZE, z: MIN_Z + (z + 0.5) * CELL_SIZE };
}

function chebyshev(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function makeModel(): Object3D {
  const group = new Group();
  group.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
  return group;
}

interface IResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: Headers;
  arrayBuffer: () => Promise<ArrayBuffer>;
  json: () => Promise<unknown>;
}

const notFound: IResponseLike = {
  ok: false,
  status: 404,
  headers: new Headers(),
  arrayBuffer: async () => new ArrayBuffer(0),
  json: async () => ({}),
};

function fileResponse(buffer: Buffer): IResponseLike {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    arrayBuffer: async () =>
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    json: async () => JSON.parse(buffer.toString("utf8")),
  };
}

function stubFixtureFetch(): { requested: string[] } {
  const requested: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown): Promise<IResponseLike> => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("world.json"))
        return fileResponse(readFileSync(path.join(fixture, "world.json")));
      if (url.endsWith("placements.bin"))
        return fileResponse(readFileSync(path.join(fixture, "placements.bin")));
      if (url.endsWith("heightmap.u16"))
        return fileResponse(readFileSync(path.join(fixture, "terrain", "heightmap.u16")));
      return notFound;
    }),
  );
  return { requested };
}

function stubManifestFetch(override: IWorldPackage): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown): Promise<IResponseLike> => {
      const url = String(input);
      const body = JSON.stringify(override);
      if (url.endsWith("world.json")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
          json: async () => override,
        };
      }
      if (url.endsWith("placements.bin"))
        return fileResponse(readFileSync(path.join(fixture, "placements.bin")));
      if (url.endsWith("heightmap.u16"))
        return fileResponse(readFileSync(path.join(fixture, "terrain", "heightmap.u16")));
      return notFound;
    }),
  );
}

/** Every logical path the committed package names, as `world/<relative>`. */
function packageLogicalPaths(pkg: IWorldPackage): string[] {
  const paths = new Set<string>([
    "world/world.json",
    "world/placements.bin",
    `world/${pkg.terrain.heightmap}`,
  ]);
  for (const asset of Object.values(pkg.assets)) {
    paths.add(`world/${asset.glb}`);
    for (const lod of asset.lods ?? []) paths.add(`world/${lod.glb}`);
  }
  for (const cell of pkg.cells) for (const chunk of cell.chunks ?? []) paths.add(`world/${chunk}`);
  return [...paths];
}

/** The name the compile step writes a file under: its content hash in the stem, its kind kept. */
function compiledName(logicalPath: string, bytes: Buffer): string {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
  const dot = logicalPath.lastIndexOf(".");
  return `${logicalPath.slice(0, dot)}.${hash}${logicalPath.slice(dot)}`;
}

/**
 * Serve the package the way the asset pipeline writes it: every file under a content-addressed
 * name, reachable only through `assets.manifest.json`, with the authored names 404ing. A real
 * `Response` carries `headers`, and the loader reads the manifest's content type off it.
 */
function stubCompiledFetch(): { requested: string[] } {
  const served = new Map<string, Buffer>();
  const entries: Record<string, { bytes: number; output: string }> = {};
  for (const logicalPath of packageLogicalPaths(manifest)) {
    const buffer = readFileSync(
      path.join(fixture, ...(logicalPath.slice("world/".length).split("/") as string[])),
    );
    const output = compiledName(logicalPath, buffer);
    entries[logicalPath] = { bytes: buffer.byteLength, output };
    served.set(output, buffer);
  }
  const body = JSON.stringify({ entries, version: 1 });
  const requested: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown): Promise<IResponseLike> => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("assets.manifest.json")) return fileResponse(Buffer.from(body));
      const buffer = served.get(url);
      return buffer === undefined ? notFound : fileResponse(buffer);
    }),
  );
  return { requested };
}

/**
 * A compiled project with its compile step's output deleted: no manifest is served, and the only
 * names that answer are the sources the author left under `assets/`. The authored path 404s, which
 * is exactly the case the loader's second candidate exists for.
 */
function stubSourceDirFetch(): { requested: string[] } {
  const served = new Map<string, Buffer>([
    ["assets/world/world.json", readFileSync(path.join(fixture, "world.json"))],
    ["assets/world/placements.bin", readFileSync(path.join(fixture, "placements.bin"))],
    [
      "assets/world/terrain/heightmap.u16",
      readFileSync(path.join(fixture, "terrain", "heightmap.u16")),
    ],
  ]);
  const requested: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown): Promise<IResponseLike> => {
      const url = String(input);
      requested.push(url);
      const buffer = served.get(url);
      return buffer === undefined ? notFound : fileResponse(buffer);
    }),
  );
  return { requested };
}

/** A loader that never settles until `release`, so concurrency can be measured mid-flight. */
interface IGatedLoader {
  readonly probe: { current: number; max: number; total: number };
  readonly load: (url: string) => Promise<Object3D>;
  readonly release: () => void;
}

function gatedLoader(): IGatedLoader {
  const probe = { current: 0, max: 0, total: 0 };
  const waiting: Array<() => void> = [];
  let open = false;
  return {
    probe,
    load: () => {
      probe.total += 1;
      probe.current += 1;
      probe.max = Math.max(probe.max, probe.current);
      return new Promise<Object3D>((resolve) => {
        const settle = (): void => {
          probe.current -= 1;
          resolve(makeModel());
        };
        if (open) settle();
        else waiting.push(settle);
      });
    },
    release: () => {
      open = true;
      for (const settle of waiting.splice(0)) settle();
    },
  };
}

function withChunks(
  cell: IWorldPackage["cells"][number],
  prefix: string,
): IWorldPackage["cells"][number] {
  return {
    ...cell,
    chunks: Array.from(
      { length: 8 },
      (_, index) => `chunks/${prefix}_${String(cell.x)}_${String(cell.z)}_${String(index)}.glb`,
    ),
  };
}

interface IControlledLoader {
  readonly calls: string[];
  holdChunks: boolean;
  readonly chunkCalls: () => number;
  readonly load: (url: string) => Promise<Object3D>;
  readonly resolveChunks: () => void;
}

function controlledLoader(): IControlledLoader {
  const calls: string[] = [];
  const held: Array<(model: Object3D) => void> = [];
  const api: IControlledLoader = {
    calls,
    holdChunks: false,
    chunkCalls: () => calls.filter((url) => url.includes("/chunks/")).length,
    load: (url) => {
      calls.push(url);
      if (api.holdChunks && url.includes("/chunks/"))
        return new Promise<Object3D>((resolve) => held.push(resolve));
      return Promise.resolve(makeModel());
    },
    resolveChunks: () => {
      for (const resolve of held.splice(0)) resolve(makeModel());
    },
  };
  return api;
}

async function flush(rounds = 12): Promise<void> {
  for (let round = 0; round < rounds; round += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function followAt(x: number, z: number): { position: { x: number; z: number } } {
  return { position: { x, z } };
}

const surface = new MeshBasicMaterial();
const largeBudgets = {
  residentCells: manifest.cells.length,
  instances: 1_000_000,
  bytes: 1_000_000_000,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WorldCells", () => {
  it("keeps exactly the in-ring cells, plus hysteresis, along a scripted path", async () => {
    stubFixtureFetch();
    const ring = 1;
    const follow = followAt(0, 0);
    const loader = controlledLoader();
    const world = await WorldCells.load({
      budgets: largeBudgets,
      follow,
      loadModel: loader.load,
      ring,
      surface,
      url: "/world/world.json",
    });

    const path: Array<{ x: number; z: number }> = [
      { x: 1, z: 1 },
      { x: 2, z: 1 },
      { x: 2, z: 2 },
      { x: 1, z: 2 },
      { x: 0, z: 0 },
      { x: 3, z: 3 },
    ];

    let expected = new Set<string>();
    for (const cell of path) {
      const center = cellCenter(cell.x, cell.z);
      follow.position.x = center.x;
      follow.position.z = center.z;
      world.update();

      const followCell = cellAt(center.x, center.z);
      const retained = new Set(
        [...expected].filter((key) => {
          const [x = 0, z = 0] = key.split(":").map(Number);
          return chebyshev({ x, z }, followCell) <= ring + 1;
        }),
      );
      for (const candidate of manifest.cells) {
        if (chebyshev(candidate, followCell) <= ring)
          retained.add(cellKey(candidate.x, candidate.z));
      }
      expected = retained;

      expect(new Set(world.stats().residentKeys)).toEqual(expected);
      await flush();
    }

    world.dispose();
  });

  it("disposes a leaving cell's batches and returns asset refcounts to zero", async () => {
    stubFixtureFetch();
    const follow = followAt(0, 0);
    const loader = controlledLoader();
    const world = await WorldCells.load({
      budgets: largeBudgets,
      follow,
      loadModel: loader.load,
      ring: 0,
      surface,
      url: "/world/world.json",
    });

    const center = cellCenter(1, 1);
    follow.position.x = center.x;
    follow.position.z = center.z;
    world.update();
    await flush();

    expect(world.stats().residentKeys).toEqual([cellKey(1, 1)]);
    expect(world.assetRefCounts()).toEqual({ ground_cover: 1, pine: 1, rock: 1 });

    const dispose = vi.spyOn(InstancedMesh.prototype, "dispose");
    follow.position.x = 100_000;
    follow.position.z = 100_000;
    world.update();
    await flush();

    expect(world.stats().residentKeys).toEqual([]);
    expect(dispose).toHaveBeenCalled();
    expect(world.assetRefCounts()).toEqual({});
    world.dispose();
  });

  it("never renders a maxDistance instance beyond its distance", async () => {
    stubFixtureFetch();
    const follow = followAt(0, 0);
    const loader = controlledLoader();
    const world = await WorldCells.load({
      budgets: largeBudgets,
      follow,
      loadModel: loader.load,
      ring: 1,
      surface,
      url: "/world/world.json",
    });

    const maxDistance = manifest.assets.ground_cover?.maxDistance as number;
    const matrix = new Matrix4();
    let rendered = 0;
    for (let step = 0; step <= 12; step += 1) {
      follow.position.x = -96 + step * 16;
      follow.position.z = -32;
      world.update();
      await flush();

      world.traverse((object: Object3D) => {
        if (!(object instanceof InstancedMesh) || !object.name.includes("ground_cover")) return;
        for (let index = 0; index < object.count; index += 1) {
          object.getMatrixAt(index, matrix);
          const elements = matrix.elements;
          const x = elements[12] as number;
          const z = elements[14] as number;
          const distance = Math.hypot(x - follow.position.x, z - follow.position.z);
          expect(distance).toBeLessThanOrEqual(maxDistance + 1e-6);
          rendered += 1;
        }
      });
    }
    expect(rendered).toBeGreaterThan(0);
    world.dispose();
  });

  it("drops a chunk load whose cell left range before it resolved", async () => {
    stubFixtureFetch();
    const follow = followAt(0, 0);
    const loader = controlledLoader();
    loader.holdChunks = true;
    const world = await WorldCells.load({
      budgets: largeBudgets,
      follow,
      loadModel: loader.load,
      ring: 0,
      surface,
      url: "/world/world.json",
    });

    const chunkCell = cellCenter(0, 2);
    follow.position.x = chunkCell.x;
    follow.position.z = chunkCell.z;
    world.update();
    await flush();
    expect(loader.chunkCalls()).toBeGreaterThan(0);
    expect(world.stats().loadsInFlight).toBeGreaterThan(0);

    follow.position.x = 100_000;
    follow.position.z = 100_000;
    world.update();
    await flush();
    expect(world.stats().residentKeys).toEqual([]);
    expect(world.assetRefCounts()).toEqual({});

    loader.resolveChunks();
    await flush();
    expect(world.stats().failures).toBe(0);
    expect(world.stats().loadsInFlight).toBe(0);
    expect(world.getObjectByName("world-chunk")).toBeUndefined();
    world.dispose();
  });

  it("reports cell budget pressure instead of throwing", async () => {
    stubFixtureFetch();
    const follow = followAt(0, 0);
    const loader = controlledLoader();
    const world = await WorldCells.load({
      budgets: { residentCells: 2, instances: 1_000_000, bytes: 1_000_000_000 },
      follow,
      loadModel: loader.load,
      ring: 1,
      surface,
      url: "/world/world.json",
    });

    const center = cellCenter(1, 1);
    follow.position.x = center.x;
    follow.position.z = center.z;
    expect(() => world.update()).not.toThrow();
    expect(world.stats().residentCells).toBe(2);
    expect(world.stats().pressure.cells).toBeGreaterThan(0);
    world.dispose();
  });

  it("rethrows a game's terrain error instead of reporting it as byte pressure", async () => {
    stubFixtureFetch();
    const follow = followAt(0, 0);
    const world = await WorldCells.load({
      budgets: largeBudgets,
      createCollider: () => {
        throw new Error("game collider factory failed");
      },
      follow,
      loadModel: controlledLoader().load,
      ring: 1,
      surface,
      url: "/world/world.json",
    });

    const center = cellCenter(1, 1);
    follow.position.x = center.x;
    follow.position.z = center.z;
    expect(() => world.update()).toThrow(/game collider factory failed/u);
    expect(world.stats().pressure.bytes).toBe(0);
    world.dispose();
  });

  it("rethrows a game error that borrows the terrain budget error's name", async () => {
    stubFixtureFetch();
    const follow = followAt(0, 0);
    const world = await WorldCells.load({
      budgets: largeBudgets,
      createCollider: () => {
        const error = new Error("game collider factory failed");
        error.name = "TerrainTileBudgetError";
        throw error;
      },
      follow,
      loadModel: controlledLoader().load,
      ring: 1,
      surface,
      url: "/world/world.json",
    });

    const center = cellCenter(1, 1);
    follow.position.x = center.x;
    follow.position.z = center.z;
    expect(() => world.update()).toThrow(/game collider factory failed/u);
    expect(world.stats().pressure.bytes).toBe(0);
    world.dispose();
  });

  it("counts a real terrain byte-budget throw as byte pressure", async () => {
    stubFixtureFetch();
    const follow = followAt(0, 0);
    const world = await WorldCells.load({
      budgets: largeBudgets,
      follow,
      loadModel: controlledLoader().load,
      ring: 1,
      // A 20M-vertex tile cannot fit any byte budget, and the estimate is checked before the tile
      // is built, so the cap fires for real on the tile the camera follows.
      terrain: { tileResolution: 20_000_001 },
      surface,
      url: "/world/world.json",
    });

    const center = cellCenter(1, 1);
    follow.position.x = center.x;
    follow.position.z = center.z;
    expect(() => world.update()).not.toThrow();
    expect(world.stats().pressure.bytes).toBe(1);
    world.dispose();
  });

  it("keeps refcounts and geometry consistent when one asset load fails", async () => {
    // Two cells one ring apart, so the second comes into range only after the first load refused.
    stubManifestFetch({
      ...manifest,
      cells: manifest.cells
        .filter((cell) => (cell.x === 0 || cell.x === 2) && cell.z === 0)
        .map((cell) => ({
          ...cell,
          chunks: [],
          runs: cell.runs.filter((run) => run.asset === "pine"),
        })),
    });
    const follow = followAt(0, 0);
    const models: Object3D[] = [];
    let refused = false;
    const load = (url: string): Promise<Object3D> => {
      if (url.includes("pine") && !refused) {
        refused = true;
        return Promise.reject(new Error("pine is offline"));
      }
      const model = makeModel();
      models.push(model);
      return Promise.resolve(model);
    };
    const world = await WorldCells.load({
      budgets: largeBudgets,
      follow,
      loadModel: load,
      ring: 1,
      surface,
      url: "/world/world.json",
    });

    const first = cellCenter(0, 0);
    follow.position.x = first.x;
    follow.position.z = first.z;
    world.update();
    await flush();
    expect(world.stats().failures).toBe(1);

    // The second cell retries the load, and its geometry is what both cells now draw.
    const second = cellCenter(1, 0);
    follow.position.x = second.x;
    follow.position.z = second.z;
    world.update();
    await flush();
    expect(world.stats().residentKeys).toEqual([cellKey(0, 0), cellKey(2, 0)]);
    expect(models.length).toBe(1);
    const source = (models[0] as Group).children[0] as Mesh;
    const dispose = vi.spyOn(source.geometry, "dispose");

    // Past the hysteresis ring the first cell leaves; the second must keep drawing that geometry.
    const away = cellCenter(3, 0);
    follow.position.x = away.x;
    follow.position.z = away.z;
    world.update();
    await flush();

    expect(world.stats().residentKeys).toEqual([cellKey(2, 0)]);
    expect(world.assetRefCounts()).toEqual({ pine: 1 });
    expect(dispose).not.toHaveBeenCalled();
    world.dispose();
  });

  it("rejects a load concurrency that could never start a load", async () => {
    stubFixtureFetch();
    for (const concurrency of [0, -1, 1.5, Number.NaN])
      await expect(
        WorldCells.load({
          budgets: { residentCells: 9, instances: 1_000_000, bytes: 1_000_000_000 },
          concurrency,
          follow: followAt(0, 0),
          loadModel: controlledLoader().load,
          ring: 1,
          surface,
          url: "/world/world.json",
        }),
      ).rejects.toThrow(/concurrency/u);
  });

  it("bounds model loads across every admitted cell, not per cell", async () => {
    stubManifestFetch({
      ...manifest,
      cells: manifest.cells.map((cell) => withChunks(cell, "synth")),
    });
    const follow = followAt(0, 0);
    const gate = gatedLoader();
    const concurrency = 3;
    const world = await WorldCells.load({
      budgets: largeBudgets,
      concurrency,
      follow,
      loadModel: gate.load,
      ring: 3,
      surface,
      url: "/world/world.json",
    });

    const center = cellCenter(1, 1);
    follow.position.x = center.x;
    follow.position.z = center.z;
    world.update();
    await flush();

    expect(world.stats().loadsInFlight).toBe(concurrency);
    expect(world.stats().loadsQueued).toBeGreaterThan(0);
    expect(gate.probe.max).toBeLessThanOrEqual(concurrency);

    gate.release();
    await flush();
    expect(gate.probe.total).toBeGreaterThan(concurrency);
    expect(gate.probe.max).toBeLessThanOrEqual(concurrency);
    expect(world.stats().loadsInFlight).toBe(0);
    expect(world.stats().loadsQueued).toBe(0);
    world.dispose();
  });

  it("skips a queued load whose cell was evicted, without loading or failing", async () => {
    stubManifestFetch({
      ...manifest,
      cells: manifest.cells.map((cell) => ({ ...withChunks(cell, "skip"), runs: [] })),
    });
    const follow = followAt(0, 0);
    const gate = gatedLoader();
    const world = await WorldCells.load({
      budgets: largeBudgets,
      concurrency: 1,
      follow,
      loadModel: gate.load,
      ring: 0,
      surface,
      url: "/world/world.json",
    });

    const center = cellCenter(1, 1);
    follow.position.x = center.x;
    follow.position.z = center.z;
    world.update();
    await flush();
    const started = gate.probe.total;
    expect(started).toBe(1);
    expect(world.stats().loadsQueued).toBeGreaterThan(0);

    follow.position.x = 100_000;
    follow.position.z = 100_000;
    world.update();
    await flush();

    gate.release();
    await flush();
    expect(gate.probe.total).toBe(started);
    expect(world.stats().failures).toBe(0);
    expect(world.stats().loadsInFlight).toBe(0);
    expect(world.stats().loadsQueued).toBe(0);
    world.dispose();
  });

  it("streams a compiled package, every file reached through the asset manifest", async () => {
    const { requested } = stubCompiledFetch();
    const follow = followAt(0, 0);
    const world = await WorldCells.load({
      budgets: largeBudgets,
      follow,
      ring: 1,
      surface,
      url: "world/world.json",
    });

    const center = cellCenter(1, 1);
    follow.position.x = center.x;
    follow.position.z = center.z;
    world.update();
    await flush();

    // The models came through the loader too: batches exist, and the one cell carrying a chunk
    // attached it. A model served by an authored name would have 404ed instead.
    expect(world.stats().failures).toBe(0);
    expect(world.stats().residentCells).toBe(9);
    expect(world.getObjectByName("world-chunk")).toBeDefined();
    expect(world.children.filter((child) => child instanceof InstancedMesh).length).toBeGreaterThan(
      0,
    );
    for (const url of requested) expect(url).toMatch(/assets\.manifest\.json$|\.[0-9a-f]{8}\./u);
    world.dispose();
  });

  it("still loads the package from assets/ when the compiled output is gone", async () => {
    // The delete-test: every compiled output is gone, so only the author's `assets/` sources are
    // left to serve the package, and nothing names them.
    const { requested } = stubSourceDirFetch();
    const follow = followAt(0, 0);
    const world = await WorldCells.load({
      budgets: largeBudgets,
      follow,
      loadModel: controlledLoader().load,
      ring: 1,
      surface,
      url: "world/world.json",
    });

    const center = cellCenter(1, 1);
    follow.position.x = center.x;
    follow.position.z = center.z;
    world.update();
    await flush();

    expect(world.stats().failures).toBe(0);
    expect(world.stats().residentCells).toBe(9);
    // Each file was asked for by its authored name first, 404ed, and then found under `assets/`.
    expect(requested).toEqual([
      "assets.manifest.json",
      "world/world.json",
      "assets/world/world.json",
      "world/placements.bin",
      "assets/world/placements.bin",
      "world/terrain/heightmap.u16",
      "assets/world/terrain/heightmap.u16",
    ]);
    world.dispose();
  });
});
