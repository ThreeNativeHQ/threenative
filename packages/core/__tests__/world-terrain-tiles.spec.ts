import { MeshBasicMaterial } from "three";
import { describe, expect, it, vi } from "vitest";
import { createAssetLoader } from "../src/assets.js";
import { type IWorldTileCollider, TerrainTiles } from "../src/world-tiles.js";

const sampleHeight = (x: number, z: number): number =>
  Math.sin(x * 0.17) * 2 + Math.cos(z * 0.13) * 1.5 + Math.sin((x + z) * 0.07);

function loader(release: ReturnType<typeof vi.fn>) {
  return {
    audio: vi.fn(),
    model: vi.fn(),
    release,
    texture: vi.fn(),
  } as never;
}

describe("TerrainTiles", () => {
  it("keeps resident tile count and bytes under caps while evicting complete units", () => {
    const release = vi.fn(() => true);
    const disposed: string[] = [];
    const tiles = new TerrainTiles({
      createCollider: ({ key }) => {
        const collider: IWorldTileCollider = {
          dispose: () => disposed.push(key),
        };
        return collider;
      },
      assetKey: (tileX, tileZ) => `test/terrain-${String(tileX)}-${String(tileZ)}.glb`,
      surface: new MeshBasicMaterial(),
      residentByteBudget: 200_000,
      residentTileBudget: 4,
      sampleHeight,
      streamRadius: 1,
      tileResolution: 9,
      tileSize: 16,
      assets: loader(release),
    });

    tiles.follow({ x: 0, z: 0 });
    tiles.follow({ x: 64, z: 0 });

    expect(tiles.residentTileCount).toBeLessThanOrEqual(4);
    expect(tiles.residentBytes).toBeLessThanOrEqual(200_000);
    expect(tiles.residentColliderKeys).toEqual(tiles.residentKeys);
    expect(tiles.peakResidentTileCount).toBeLessThanOrEqual(4);
    expect(tiles.peakResidentBytes).toBeLessThanOrEqual(200_000);
    expect(disposed.length).toBeGreaterThan(0);
    expect(release).toHaveBeenCalled();
    tiles.dispose();
  });

  it("keeps a mixed-LOD neighbor seam covered by edge stitching and skirts", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 200_000,
      residentTileBudget: 9,
      sampleHeight,
      streamRadius: 1,
      tileResolution: 17,
      tileSize: 16,
      lodDistances: [8, 16],
    });

    tiles.follow({ x: 0, z: 0 });
    expect(tiles.lodTransitions).toBe(0);
    tiles.follow({ x: 12, z: 0 });

    expect(tiles.lodLevelCount).toBeGreaterThanOrEqual(3);
    expect(tiles.lodTransitions).toBeGreaterThan(0);
    expect(tiles.maxSeamGap).toBeGreaterThan(0);
    expect(tiles.maxSeamGap).toBeLessThanOrEqual(tiles.skirtDepth);
    expect(tiles.skirtDepth).toBeGreaterThan(0);
    expect(tiles.residentKeys.some((key) => (tiles.getTile(key)?.skirtVertexCount ?? 0) > 0)).toBe(
      true,
    );
    tiles.dispose();
  });

  it("keeps the manually selected LOD visible when a renderer inspects the LOD", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 200_000,
      residentTileBudget: 9,
      sampleHeight,
      streamRadius: 1,
      tileResolution: 17,
      tileSize: 16,
      lodDistances: [8, 16],
    });

    tiles.follow({ x: 0, z: 0 });
    tiles.follow({ x: 12, z: 0 });

    const tile = tiles.getTile("0:0");
    if (tile === undefined) throw new Error("Expected the followed tile to remain resident.");
    const visible = tile.lod.children.filter((child) => child.visible);
    expect(tile.lod.autoUpdate).toBe(false);
    expect(tile.lod.getCurrentLevel()).toBe(tile.lodLevel);
    expect(tiles.lodTransitions).toBeGreaterThan(0);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toBe(tile.lod.levels[tile.lodLevel]?.object);
    expect(tiles.maxVisualSeamGap).toBeLessThanOrEqual(tiles.maxSeamGap);
    tiles.dispose();
  });

  it("publishes the resident field and routed flow for topology evaluation", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 200_000,
      residentTileBudget: 1,
      sampleHeight,
      streamRadius: 0,
      tileResolution: 9,
      tileSize: 128,
      topologyObservation: {
        columns: 65,
        depth: 1024,
        origin: { x: 0, z: 0 },
        rows: 65,
        width: 1024,
      },
      worldPasses: {
        dispatchBudget: 1,
        erosion: {
          depositionRate: 0.35,
          erosionRate: 0.22,
          evaporation: 0.04,
          iterations: 0,
          rainfall: 0.08,
          sedimentCapacity: 0.7,
          timeStep: 0.05,
        },
        gpu: false,
      },
    });

    tiles.follow({ x: 0, z: 0 });

    const topology = tiles.debug().topology as {
      columns: number;
      depth: number;
      flow: readonly number[];
      heights: readonly number[];
      rows: number;
      width: number;
    };
    expect(topology).toMatchObject({ columns: 65, depth: 1024, rows: 65, width: 1024 });
    expect(topology.heights).toHaveLength(4225);
    expect(topology.flow).toHaveLength(4225);
    expect(topology.flow.every(Number.isFinite)).toBe(true);
    tiles.dispose();
  });

  it("publishes a bounded metric summary for the rendered measurement grid", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 200_000,
      residentTileBudget: 1,
      sampleHeight,
      tileResolution: 17,
      tileSize: 16,
      topologyObservation: {
        columns: 1025,
        depth: 1024,
        origin: { x: 0, z: 0 },
        rows: 1025,
        width: 1024,
      },
      worldPasses: {
        dispatchBudget: 1,
        erosion: {
          depositionRate: 0.35,
          erosionRate: 0.22,
          evaporation: 0.04,
          iterations: 0,
          rainfall: 0.08,
          sedimentCapacity: 0.7,
          timeStep: 0.05,
        },
        gpu: false,
      },
    });

    const topology = tiles.debug().topology as Record<string, unknown>;
    const metrics = topology.metrics as Record<string, unknown>;
    expect(topology).toMatchObject({ columns: 1025, depth: 1024, rows: 1025, width: 1024 });
    expect(topology).not.toHaveProperty("heights");
    expect(topology).not.toHaveProperty("flow");
    expect(Object.keys(metrics)).toHaveLength(8);
    expect(new TextEncoder().encode(JSON.stringify(tiles.debug())).byteLength).toBeLessThan(
      1_000_000,
    );
    tiles.dispose();
  }, 10_000);

  it("rejects a quality field whose sample grid does not match rendered tile geometry", () => {
    expect(
      () =>
        new TerrainTiles({
          surface: new MeshBasicMaterial(),
          residentByteBudget: 200_000,
          residentTileBudget: 1,
          sampleHeight,
          tileResolution: 9,
          tileSize: 16,
          topologyObservation: {
            columns: 65,
            depth: 1024,
            origin: { x: 0, z: 0 },
            rows: 65,
            width: 1024,
          },
        }),
    ).toThrow(/columns.*513/u);
  });

  it("reports the actual edge discontinuity before skirt coverage", () => {
    let boundarySample = 0;
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 200_000,
      residentTileBudget: 9,
      sampleHeight: (x, z) => {
        const base = Math.sin(x * 0.17) * 2 + Math.cos(z * 0.13) * 1.5;
        if (Math.abs(x - 8) > 1e-6) return base;
        boundarySample += 1;
        return base + (boundarySample % 2 === 0 ? 10 : 0);
      },
      skirtDepth: 16,
      streamRadius: 1,
      tileResolution: 9,
      tileSize: 16,
      lodFactors: [1],
      lodDistances: [],
    });

    tiles.follow({ x: 0, z: 0 });

    expect(tiles.maxSeamGap).toBeGreaterThan(1);
    expect(tiles.maxVisualSeamGap).toBe(0);
    for (const key of tiles.residentKeys) {
      const tile = tiles.getTile(key);
      if (tile === undefined) throw new Error(`Missing resident tile '${key}'.`);
      const skirtVertices = tile.lod.children.reduce((total, child) => {
        const position =
          child instanceof Object && "geometry" in child
            ? (
                child as { geometry?: { getAttribute(name: string): { count: number } } }
              ).geometry?.getAttribute("position")
            : undefined;
        return total + Math.max(0, (position?.count ?? 0) - 9 * 9);
      }, 0);
      expect(tile.skirtVertexCount).toBe(skirtVertices);
    }
    tiles.dispose();
  });

  it("releases a preloaded game asset without fabricating a tile model lookup", async () => {
    const model = vi.fn(async (url: string) => ({ url }));
    const assets = createAssetLoader({ model });
    const loadedKey = "terrain/fixture.glb";
    await assets.model(loadedKey);
    model.mockClear();
    const release = vi.spyOn(assets, "release");
    const tiles = new TerrainTiles({
      assetKey: () => loadedKey,
      assets,
      residentByteBudget: 200_000,
      residentTileBudget: 1,
      sampleHeight,
      streamRadius: 0,
      tileResolution: 9,
      tileSize: 16,
      surface: new MeshBasicMaterial(),
    });

    tiles.follow({ x: 0, z: 0 });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    tiles.follow({ x: 16, z: 0 });

    expect(model).not.toHaveBeenCalled();
    const releasedCall = release.mock.calls.findIndex(
      ([kind, path]) => kind === "model" && path === loadedKey,
    );
    expect(releasedCall).toBeGreaterThanOrEqual(0);
    expect(release.mock.results[releasedCall]?.value).toBe(true);
    tiles.dispose();
  });

  it("fails closed when one tile cannot fit the byte cap", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 1,
      residentTileBudget: 1,
      sampleHeight,
      tileResolution: 9,
      tileSize: 16,
    });
    expect(() => tiles.follow({ x: 0, z: 0 })).toThrow(/residentByteBudget/u);
  });
});
