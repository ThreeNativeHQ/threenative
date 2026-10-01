import { type BufferGeometry, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { TerrainTiles } from "../src/world-tiles.js";

const sampleHeight = (x: number, z: number): number =>
  Math.sin(x * 0.17) * 2 + Math.cos(z * 0.13) * 1.5 + Math.sin((x + z) * 0.07);

const BLOCK_PREFIX = "tn-terrain-block:";

function terrain(mergeTiles: boolean, overrides: Record<string, unknown> = {}): TerrainTiles {
  return new TerrainTiles({
    mergeTiles,
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

function geometryBytes(mesh: Mesh): number {
  const index = mesh.geometry.getIndex();
  return (
    mesh.geometry.getAttribute("position").array.byteLength +
    mesh.geometry.getAttribute("normal").array.byteLength +
    (index?.array.byteLength ?? 0)
  );
}

/** Every visible terrain level mesh and block mesh: the tiles the main pass would submit. */
function submittedMeshes(tiles: TerrainTiles): number {
  const levels = new Set<unknown>();
  for (const key of tiles.residentKeys) {
    const tile = tiles.getTile(key);
    if (tile === undefined) continue;
    for (const level of tile.lod.levels) levels.add(level.object);
  }
  let submitted = 0;
  tiles.traverseVisible((object) => {
    if (object instanceof Mesh && (object.name.startsWith(BLOCK_PREFIX) || levels.has(object)))
      submitted += 1;
  });
  return submitted;
}

function blockKey(mesh: Mesh): { lod: number; blockX: number; blockZ: number } {
  const key = mesh.name.slice(BLOCK_PREFIX.length);
  const [lod, cell] = key.split(":");
  const [blockX, blockZ] = (cell as string).split(",");
  return { lod: Number(lod), blockX: Number(blockX), blockZ: Number(blockZ) };
}

function levelWorldKeys(
  tiles: TerrainTiles,
  tileKey: string,
  levelIndex: number,
  offsetX: number,
  offsetZ: number,
): string[] {
  const tile = tiles.getTile(tileKey);
  if (tile === undefined) throw new Error(`Missing resident tile '${tileKey}'.`);
  const level = tile.lod.levels[levelIndex]?.object;
  if (!(level instanceof Mesh)) throw new Error(`Missing level ${String(levelIndex)}.`);
  const position = level.geometry.getAttribute("position");
  const keys: string[] = [];
  for (let vertex = 0; vertex < position.count; vertex += 1)
    keys.push(
      `${String(position.getX(vertex) + offsetX)},${String(position.getY(vertex))},${String(
        position.getZ(vertex) + offsetZ,
      )}`,
    );
  return keys;
}

function mergedWorldKeys(mesh: Mesh, offsetX: number, offsetZ: number): string[] {
  const position = mesh.geometry.getAttribute("position");
  const keys: string[] = [];
  for (let vertex = 0; vertex < position.count; vertex += 1)
    keys.push(
      `${String(position.getX(vertex) + offsetX)},${String(position.getY(vertex))},${String(
        position.getZ(vertex) + offsetZ,
      )}`,
    );
  return keys;
}

function sortedCounts(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function normalKeys(geometry: BufferGeometry, offsetX: number, offsetZ: number): string[] {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const keys: string[] = [];
  for (let vertex = 0; vertex < position.count; vertex += 1)
    keys.push(
      `${String(normal.getX(vertex))},${String(normal.getY(vertex))},${String(
        normal.getZ(vertex),
      )}|${String(position.getX(vertex) + offsetX)},${String(position.getY(vertex))},${String(
        position.getZ(vertex) + offsetZ,
      )}`,
    );
  return keys;
}

/** Every triangle as its three world positions, so a merge can be compared without vertex order. */
function triangleKeys(
  geometry: BufferGeometry,
  offsetX: number,
  offsetZ: number,
): Map<string, number> {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  if (index === null) throw new Error("Expected an indexed terrain geometry.");
  const keys: string[] = [];
  for (let element = 0; element + 2 < index.count; element += 3) {
    const corners: string[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = index.getX(element + corner);
      corners.push(
        `${String(position.getX(vertex) + offsetX)},${String(position.getY(vertex))},${String(
          position.getZ(vertex) + offsetZ,
        )}`,
      );
    }
    keys.push(corners.sort().join("|"));
  }
  return sortedCounts(keys);
}

describe("TerrainTiles merge", () => {
  it("reads mergeTiles from the option, the environment, the query string and the global, off by default", () => {
    const previousEnv = process.env.TN_TERRAIN_MERGE;
    const previousSearch = (globalThis as { location?: Location }).location?.search;
    const previousGlobal = (globalThis as { __tnTerrainMerge?: unknown }).__tnTerrainMerge;
    try {
      for (const [env, search, global, expected] of [
        [undefined, "", undefined, false],
        ["1", "", undefined, true],
        ["0", "", undefined, false],
        [undefined, "?tnTerrainMerge=1", undefined, true],
        [undefined, "?tnTerrainMerge=0", undefined, false],
        [undefined, "", 1, true],
      ] as const) {
        if (env === undefined) Reflect.deleteProperty(process.env, "TN_TERRAIN_MERGE");
        else process.env.TN_TERRAIN_MERGE = env;
        Object.defineProperty(globalThis, "location", { configurable: true, value: { search } });
        Reflect.deleteProperty(globalThis, "__tnTerrainMerge");
        if (global !== undefined)
          (globalThis as { __tnTerrainMerge?: unknown }).__tnTerrainMerge = global;
        const tiles = new TerrainTiles({
          residentByteBudget: 64_000_000,
          residentTileBudget: 8,
          sampleHeight,
          streamRadius: 1,
          surface: new MeshBasicMaterial(),
          tileResolution: 33,
          tileSize: 16,
        });
        tiles.follow({ x: 16, z: 16 });
        expect(tiles.terrainTiles.blocks > 0).toBe(expected);
        tiles.dispose();
      }
    } finally {
      if (previousEnv === undefined) Reflect.deleteProperty(process.env, "TN_TERRAIN_MERGE");
      else process.env.TN_TERRAIN_MERGE = previousEnv;
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: previousSearch === undefined ? undefined : { search: previousSearch },
      });
      Reflect.deleteProperty(globalThis, "__tnTerrainMerge");
      if (previousGlobal !== undefined)
        (globalThis as { __tnTerrainMerge?: unknown }).__tnTerrainMerge = previousGlobal;
    }
  });

  it("reports the tile census beside the lodTransitions stat, counting the meshes it submits", () => {
    for (const mergeTiles of [false, true]) {
      const tiles = terrain(mergeTiles);
      try {
        tiles.follow({ x: 16, z: 16 });
        const stat = tiles.debug().terrainTiles as {
          blending: number;
          blocks: number;
          draws: number;
          tiles: number;
        };
        expect(stat.draws).toBe(submittedMeshes(tiles));
        expect(stat.tiles).toBe(tiles.residentTileCount);
        expect(stat.blending).toBe(tiles.blendingTiles);
        expect(stat.blocks).toBe(mergeTiles ? 1 : 0);
      } finally {
        tiles.dispose();
      }
    }
  });

  it("charges a merged block's bytes to the resident budget instead of holding both for free", () => {
    const walk = (mergeTiles: boolean): number => {
      const tiles = terrain(mergeTiles);
      try {
        tiles.follow({ x: 16, z: 16 });
        const held = blockMeshes(tiles).reduce((total, mesh) => total + geometryBytes(mesh), 0);
        return tiles.residentBytes - held;
      } finally {
        tiles.dispose();
      }
    };
    // Nine tiles cost the same resident bytes merged or not, once the block's own copy is charged.
    expect(walk(true)).toBe(walk(false));
  });

  it("leaves the draw structure untouched with the merge off", () => {
    const tiles = terrain(false);
    try {
      tiles.follow({ x: 16, z: 16 });
      expect(blockMeshes(tiles)).toHaveLength(0);
      expect(tiles.terrainTiles.blocks).toBe(0);
      expect(tiles.terrainTiles.draws).toBe(tiles.residentTileCount);
      expect(tiles.terrainTiles.tiles).toBe(tiles.residentTileCount);
      for (const key of tiles.residentKeys) {
        const tile = tiles.getTile(key);
        if (tile === undefined) throw new Error("Expected a resident tile.");
        expect(tile.lod.levels.some(({ object }) => object.visible)).toBe(true);
      }
    } finally {
      tiles.dispose();
    }
  });

  it("merges a settled same-LOD island into one draw whose positions equal the tiles' concatenation", () => {
    const tiles = terrain(true);
    try {
      tiles.follow({ x: 16, z: 16 });
      expect(tiles.terrainTiles.blocks).toBe(1);
      expect(tiles.terrainTiles.draws).toBe(1);
      expect(tiles.terrainTiles.tiles).toBe(9);
      const [block] = blockMeshes(tiles);
      if (block === undefined) throw new Error("Expected one merged block.");
      const { blockX, blockZ } = blockKey(block);
      const originX = blockX * 4 * 16;
      const originZ = blockZ * 4 * 16;
      const expected: string[] = [];
      const expectedNormals: string[] = [];
      const expectedTriangles = new Map<string, number>();
      for (const key of tiles.residentKeys) {
        const tile = tiles.getTile(key);
        if (tile === undefined) throw new Error(`Missing resident tile '${key}'.`);
        const offsetX = tile.tileX * 16 - originX;
        const offsetZ = tile.tileZ * 16 - originZ;
        expected.push(...levelWorldKeys(tiles, key, 0, offsetX, offsetZ));
        const level = tile.lod.levels[0]?.object;
        if (!(level instanceof Mesh)) throw new Error("Missing level 0.");
        expectedNormals.push(...normalKeys(level.geometry, offsetX, offsetZ));
        for (const [triangle, count] of triangleKeys(level.geometry, offsetX, offsetZ))
          expectedTriangles.set(triangle, (expectedTriangles.get(triangle) ?? 0) + count);
      }
      const expectedCounts = sortedCounts(expected);
      const actualCounts = sortedCounts(mergedWorldKeys(block, 0, 0));
      expect(actualCounts.size).toBe(expectedCounts.size);
      expect(actualCounts).toEqual(expectedCounts);
      // One visible mesh for the island, and every vertex carrying the normal and the triangles of
      // the tile it came from: the merge moved no vertex and dropped no triangle.
      expect(submittedMeshes(tiles)).toBe(1);
      expect(sortedCounts(normalKeys(block.geometry, 0, 0))).toEqual(sortedCounts(expectedNormals));
      expect(triangleKeys(block.geometry, 0, 0)).toEqual(expectedTriangles);
    } finally {
      tiles.dispose();
    }
  });

  it("dissolves blocks and restores individual meshes when tiles stream out", () => {
    const tiles = terrain(true);
    try {
      tiles.follow({ x: 16, z: 16 });
      const [block] = blockMeshes(tiles);
      if (block === undefined) throw new Error("Expected a merged block.");
      const geometry = block.geometry;
      let disposed = false;
      const original = geometry.dispose.bind(geometry);
      geometry.dispose = () => {
        disposed = true;
        original();
      };
      expect(tiles.terrainTiles.blocks).toBe(1);
      tiles.follow({ x: 16 + 200, z: 16 + 200 });
      expect(blockMeshes(tiles)).not.toContain(block);
      expect(disposed).toBe(true);
    } finally {
      tiles.dispose();
    }
  });

  it("keeps a lone block member individual rather than copying its geometry", () => {
    const tiles = terrain(true);
    try {
      tiles.follow({ x: 0, z: 0 });
      // tileX -1..1 x tileZ -1..1 splits into three blocks of two or more tiles and one lone tile.
      expect(tiles.terrainTiles.blocks).toBe(3);
      expect(tiles.terrainTiles.tiles).toBe(9);
      expect(tiles.terrainTiles.draws).toBe(4);
    } finally {
      tiles.dispose();
    }
  });

  it("excludes a morphing tile from its block until the blend ends", () => {
    const options = { lodDistances: [8], lodFactors: [1, 2] };
    const tiles = terrain(true, options);
    try {
      tiles.follow({ x: 16, z: 16 });
      tiles.follow({ x: 24.5, z: 16 });
      expect(tiles.blendingTiles).toBeGreaterThan(0);
      for (const block of blockMeshes(tiles)) {
        const { lod, blockX, blockZ } = blockKey(block);
        let expectedVertices = 0;
        let members = 0;
        for (const key of tiles.residentKeys) {
          const tile = tiles.getTile(key);
          if (tile === undefined) continue;
          const transitioned = (tile as { lodTransition?: unknown }).lodTransition !== undefined;
          if (transitioned || tile.lodLevel !== lod) continue;
          if (Math.floor(tile.tileX / 4) !== blockX || Math.floor(tile.tileZ / 4) !== blockZ)
            continue;
          const level = tile.lod.levels[lod]?.object;
          if (!(level instanceof Mesh)) continue;
          expectedVertices += level.geometry.getAttribute("position").count;
          members += 1;
        }
        if (members >= 2)
          expect(block.geometry.getAttribute("position").count).toBe(expectedVertices);
      }
      // The morphing tile still draws through its own visible mesh, not through the block.
      let visibleIndividual = 0;
      for (const key of tiles.residentKeys) {
        const tile = tiles.getTile(key);
        if (tile === undefined) continue;
        if ((tile as { lodTransition?: unknown }).lodTransition === undefined) continue;
        expect(tile.lod.levels.some(({ object }) => object.visible)).toBe(true);
        visibleIndividual += 1;
      }
      expect(visibleIndividual).toBe(tiles.blendingTiles);
    } finally {
      tiles.dispose();
    }
  });

  it("measures the same seam gap with the merge on and off", () => {
    const walk = (mergeTiles: boolean): number => {
      const tiles = terrain(mergeTiles, { lodDistances: [8], lodFactors: [1, 2], validate: true });
      try {
        for (let frame = 0; frame < 12; frame += 1) {
          tiles.follow({ x: 16 + frame * 0.4, z: 16 });
          tiles.process();
        }
        const gap = tiles.maxSeamGap;
        if (gap === undefined) throw new Error("Expected a validated seam gap.");
        return gap;
      } finally {
        tiles.dispose();
      }
    };
    const unmerged = walk(false);
    const merged = walk(true);
    expect(merged).toBe(unmerged);
  });

  it("disposes every merged block geometry on release", () => {
    const tiles = terrain(true);
    try {
      tiles.follow({ x: 16, z: 16 });
      const geometries: BufferGeometry[] = blockMeshes(tiles).map((mesh) => mesh.geometry);
      expect(geometries.length).toBeGreaterThan(0);
      const disposed = geometries.map(() => false);
      geometries.forEach((geometry, index) => {
        const original = geometry.dispose.bind(geometry);
        geometry.dispose = () => {
          disposed[index] = true;
          original();
        };
      });
      tiles.dispose();
      expect(tiles.children).toHaveLength(0);
      expect(disposed.every((value) => value)).toBe(true);
    } finally {
      tiles.dispose();
    }
  });
});
