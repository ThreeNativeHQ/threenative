import { MeshBasicMaterial } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type IWorldExtent,
  type IWorldTerrain,
  TerrainTiles,
  heightSamplerFromHeightmap,
  loadWorldHeightmap,
} from "../src/world.js";

const COLUMNS = 101;
const ROWS = 101;
const SPACING = 2;
const extent: IWorldExtent = { minX: -100, minZ: -100, sizeX: 200, sizeZ: 200 };

function hills(x: number, z: number): number {
  return (
    120 +
    Math.sin(x * 0.02) * 60 +
    Math.cos(z * 0.017) * 50 +
    Math.sin((x + z) * 0.011) * 45 +
    Math.sin(x * 0.05) * Math.cos(z * 0.04) * 30
  );
}

interface ISourceGrid {
  readonly data: Float64Array;
  readonly terrain: IWorldTerrain;
}

function sourceGrid(): ISourceGrid {
  const data = new Float64Array(COLUMNS * ROWS);
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let row = 0; row < ROWS; row += 1) {
    const z = extent.minZ + row * SPACING;
    for (let column = 0; column < COLUMNS; column += 1) {
      const value = hills(extent.minX + column * SPACING, z);
      data[row * COLUMNS + column] = value;
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
  }
  const quantized = new Uint16Array(COLUMNS * ROWS);
  for (let index = 0; index < data.length; index += 1)
    quantized[index] = Math.round(
      (((data[index] as number) - minimum) / (maximum - minimum)) * 65_535,
    );
  return {
    data,
    terrain: {
      columns: COLUMNS,
      heightMax: maximum,
      heightMin: minimum,
      heightmap: "terrain/heightmap.u16",
      rows: ROWS,
      spacing: SPACING,
    },
  };
}

function bilinearSource(grid: Float64Array, x: number, z: number): number {
  const column = Math.min(COLUMNS - 1, Math.max(0, (x - extent.minX) / SPACING));
  const row = Math.min(ROWS - 1, Math.max(0, (z - extent.minZ) / SPACING));
  const column0 = Math.floor(column);
  const row0 = Math.floor(row);
  const column1 = Math.min(COLUMNS - 1, column0 + 1);
  const row1 = Math.min(ROWS - 1, row0 + 1);
  const mixX = column - column0;
  const mixZ = row - row0;
  const upperLeft = grid[row0 * COLUMNS + column0] as number;
  const upperRight = grid[row0 * COLUMNS + column1] as number;
  const lowerLeft = grid[row1 * COLUMNS + column0] as number;
  const lowerRight = grid[row1 * COLUMNS + column1] as number;
  const upper = upperLeft + (upperRight - upperLeft) * mixX;
  const lower = lowerLeft + (lowerRight - lowerLeft) * mixX;
  return upper + (lower - upper) * mixZ;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("heightSamplerFromHeightmap", () => {
  it("reproduces the source grid within two centimetres at 1000 sampled points", () => {
    const { data, terrain } = sourceGrid();
    const quantized = new Uint16Array(COLUMNS * ROWS);
    for (let index = 0; index < data.length; index += 1)
      quantized[index] = Math.round(
        (((data[index] as number) - terrain.heightMin) / (terrain.heightMax - terrain.heightMin)) *
          65_535,
      );
    const sampleHeight = heightSamplerFromHeightmap(terrain, extent, quantized);
    expect(terrain.heightMax - terrain.heightMin).toBeGreaterThan(200);

    const tiles = new TerrainTiles({
      residentByteBudget: 64 * 1024 * 1024,
      residentTileBudget: 4,
      sampleHeight,
      streamRadius: 0,
      surface: new MeshBasicMaterial(),
      tileResolution: COLUMNS,
      tileSize: extent.sizeX,
    });
    tiles.follow({ x: 0, z: 0 });
    const tile = tiles.getTile("0:0");
    if (tile === undefined) throw new Error("Expected the followed tile to be resident.");

    const random = seededRandom(448);
    let maximumError = 0;
    for (let sample = 0; sample < 1000; sample += 1) {
      const x = extent.minX + random() * extent.sizeX;
      const z = extent.minZ + random() * extent.sizeZ;
      maximumError = Math.max(
        maximumError,
        Math.abs(tile.field.heightAt(x, z) - bilinearSource(data, x, z)),
      );
    }
    tiles.dispose();
    expect(maximumError).toBeLessThanOrEqual(0.02);
  });

  it("clamps to the edge vertices outside the sampled region", () => {
    const { terrain } = sourceGrid();
    const quantized = new Uint16Array(COLUMNS * ROWS);
    const sampleHeight = heightSamplerFromHeightmap(terrain, extent, quantized);
    const corner = terrain.heightMin;
    expect(sampleHeight(-1e9, -1e9)).toBeCloseTo(corner, 10);
    expect(sampleHeight(-1e9, -1e9)).toBe(sampleHeight(-100, -100));
    expect(sampleHeight(1e9, 1e9)).toBe(sampleHeight(100, 100));
  });

  it("rejects a data length that does not match the declared vertex counts", () => {
    const { terrain } = sourceGrid();
    expect(() => heightSamplerFromHeightmap(terrain, extent, new Uint16Array(4))).toThrow(
      /expected 10201 samples/u,
    );
  });
});

describe("loadWorldHeightmap", () => {
  it("decodes a little-endian uint16 response", async () => {
    const source = Uint16Array.from([0, 1, 255, 65_535]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        arrayBuffer: async () => source.buffer.slice(0),
        ok: true,
        status: 200,
      })),
    );
    const loaded = await loadWorldHeightmap("/world/terrain/heightmap.u16");
    expect(Array.from(loaded)).toEqual([0, 1, 255, 65_535]);
  });

  it("throws a named error on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 })),
    );
    await expect(loadWorldHeightmap("/world/terrain/heightmap.u16")).rejects.toThrow(/status 404/u);
  });

  it("rejects an odd byte length", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        arrayBuffer: async () => new ArrayBuffer(3),
        ok: true,
        status: 200,
      })),
    );
    await expect(loadWorldHeightmap("/world/terrain/heightmap.u16")).rejects.toThrow(
      /odd byte length/u,
    );
  });
});
