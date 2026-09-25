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
  arrayBuffer: () => Promise<ArrayBuffer>;
  json: () => Promise<unknown>;
}

function fileResponse(buffer: Buffer): IResponseLike {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () =>
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    json: async () => JSON.parse(buffer.toString("utf8")),
  };
}

function stubFixtureFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown): Promise<IResponseLike> => {
      const url = String(input);
      if (url.endsWith("world.json"))
        return fileResponse(readFileSync(path.join(fixture, "world.json")));
      if (url.endsWith("placements.bin"))
        return fileResponse(readFileSync(path.join(fixture, "placements.bin")));
      if (url.endsWith("heightmap.u16"))
        return fileResponse(readFileSync(path.join(fixture, "terrain", "heightmap.u16")));
      return {
        ok: false,
        status: 404,
        arrayBuffer: async () => new ArrayBuffer(0),
        json: async () => ({}),
      };
    }),
  );
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
});
