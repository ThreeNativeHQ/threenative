import { BufferAttribute, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it, vi } from "vitest";
import { createAssetLoader } from "../src/assets.js";
import { type IWorldTile, type IWorldTileCollider, TerrainTiles } from "../src/world-tiles.js";

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

function renderedHeight(tiles: TerrainTiles, key: string, index: number): number {
  const tile = tiles.getTile(key);
  if (tile === undefined) throw new Error(`Missing resident tile '${key}'.`);
  const level = tile.lod.levels[0]?.object;
  if (!(level instanceof Mesh)) throw new Error(`Missing rendered LOD for tile '${key}'.`);
  return level.geometry.getAttribute("position").getY(index);
}

interface IVisibleSurface {
  readonly heights: Float32Array;
  readonly resolution: number;
}

type Edge = "east" | "north" | "south" | "west";

function visibleSurface(tile: IWorldTile): IVisibleSurface {
  const level = tile.lod.levels.find(({ object }) => object.visible)?.object;
  if (!(level instanceof Mesh)) throw new Error(`Missing visible LOD for tile '${tile.key}'.`);
  const position = level.geometry.getAttribute("position");
  const resolution = Math.round(Math.sqrt(position.count + 4) - 2);
  if (resolution < 3 || resolution * resolution + resolution * 4 !== position.count)
    throw new Error(`Invalid visible LOD geometry for tile '${tile.key}'.`);
  const heights = new Float32Array(resolution * resolution);
  for (let index = 0; index < heights.length; index += 1) heights[index] = position.getY(index);
  return { heights, resolution };
}

function surfaceHeight(surface: IVisibleSurface, normalizedX: number, normalizedZ: number): number {
  const column = Math.max(0, Math.min(1, normalizedX)) * (surface.resolution - 1);
  const row = Math.max(0, Math.min(1, normalizedZ)) * (surface.resolution - 1);
  const column0 = Math.floor(column);
  const row0 = Math.floor(row);
  const column1 = Math.min(surface.resolution - 1, column0 + 1);
  const row1 = Math.min(surface.resolution - 1, row0 + 1);
  const columnMix = column - column0;
  const rowMix = row - row0;
  const upperLeft = surface.heights[row0 * surface.resolution + column0] as number;
  const upperRight = surface.heights[row0 * surface.resolution + column1] as number;
  const lowerLeft = surface.heights[row1 * surface.resolution + column0] as number;
  const lowerRight = surface.heights[row1 * surface.resolution + column1] as number;
  const upper = upperLeft + (upperRight - upperLeft) * columnMix;
  const lower = lowerLeft + (lowerRight - lowerLeft) * columnMix;
  return upper + (lower - upper) * rowMix;
}

function surfaceDelta(a: IVisibleSurface, b: IVisibleSurface): number {
  const samples = Math.max(a.resolution, b.resolution);
  let maximum = 0;
  for (let row = 0; row < samples; row += 1) {
    for (let column = 0; column < samples; column += 1) {
      const normalizedX = samples === 1 ? 0 : column / (samples - 1);
      const normalizedZ = samples === 1 ? 0 : row / (samples - 1);
      maximum = Math.max(
        maximum,
        Math.abs(
          surfaceHeight(a, normalizedX, normalizedZ) - surfaceHeight(b, normalizedX, normalizedZ),
        ),
      );
    }
  }
  return maximum;
}

function edgeHeight(surface: IVisibleSurface, side: Edge, normalized: number): number {
  if (side === "north") return surfaceHeight(surface, normalized, 0);
  if (side === "south") return surfaceHeight(surface, normalized, 1);
  if (side === "west") return surfaceHeight(surface, 0, normalized);
  return surfaceHeight(surface, 1, normalized);
}

function visibleSeamGap(a: IWorldTile, b: IWorldTile): number {
  const aSurface = visibleSurface(a);
  const bSurface = visibleSurface(b);
  const [aSide, bSide] =
    a.tileX < b.tileX
      ? (["east", "west"] as const)
      : a.tileX > b.tileX
        ? (["west", "east"] as const)
        : a.tileZ < b.tileZ
          ? (["south", "north"] as const)
          : (["north", "south"] as const);
  const samples = Math.max(aSurface.resolution, bSurface.resolution);
  let maximum = 0;
  for (let index = 0; index < samples; index += 1) {
    const normalized = samples === 1 ? 0 : index / (samples - 1);
    maximum = Math.max(
      maximum,
      Math.abs(edgeHeight(aSurface, aSide, normalized) - edgeHeight(bSurface, bSide, normalized)),
    );
  }
  return maximum;
}

function edgeSampleCoordinates(
  tile: IWorldTile,
  side: Edge,
  normalized: number,
): { column: number; row: number; x: number; z: number } {
  const field = tile.field;
  const minimumX = field.origin.x - field.width / 2;
  const minimumZ = field.origin.z - field.depth / 2;
  const x =
    side === "west"
      ? minimumX
      : side === "east"
        ? minimumX + field.width
        : minimumX + normalized * field.width;
  const z =
    side === "north"
      ? minimumZ
      : side === "south"
        ? minimumZ + field.depth
        : minimumZ + normalized * field.depth;
  return {
    column:
      side === "west"
        ? 0
        : side === "east"
          ? field.columns - 1
          : Math.round(normalized * (field.columns - 1)),
    row:
      side === "north"
        ? 0
        : side === "south"
          ? field.rows - 1
          : Math.round(normalized * (field.rows - 1)),
    x,
    z,
  };
}

function canonicalEdgeError(
  tile: IWorldTile,
  side: Edge,
  surface: IVisibleSurface,
  colliderHeights?: Float32Array,
): number {
  const field = tile.field;
  const normalizedCoordinate = (index: number): number =>
    surface.resolution === 1 ? 0 : index / (surface.resolution - 1);
  let maximum = 0;
  for (let index = 0; index < surface.resolution; index += 1) {
    const normalized = normalizedCoordinate(index);
    const { column, row, x, z } = edgeSampleCoordinates(tile, side, normalized);
    const rendered = edgeHeight(surface, side, normalized);
    const canonical = field.heightAt(x, z);
    const collider =
      colliderHeights === undefined
        ? 0
        : Math.abs(rendered - (colliderHeights[column * field.rows + row] as number));
    maximum = Math.max(maximum, Math.abs(rendered - canonical), collider);
  }
  return maximum;
}

describe("TerrainTiles", () => {
  it("counts retained topology storage against the hard byte cap", () => {
    expect(
      () =>
        new TerrainTiles({
          surface: new MeshBasicMaterial(),
          residentByteBudget: 100_000,
          residentTileBudget: 1,
          sampleHeight,
          streamRadius: 0,
          tileResolution: 9,
          tileSize: 16,
          topologyObservation: {
            columns: 129,
            depth: 256,
            origin: { x: 0, z: 0 },
            rows: 129,
            width: 256,
          },
        }),
    ).toThrow(/residentByteBudget/u);
  });

  it("counts retained edge samples in each tile and its admission estimate", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 9_000,
      residentTileBudget: 1,
      sampleHeight,
      streamRadius: 0,
      tileResolution: 9,
      tileSize: 16,
    });

    tiles.follow({ x: 0, z: 0 });

    const tile = tiles.getTile("0:0");
    if (tile === undefined) throw new Error("Expected the followed tile to remain resident.");
    expect(tile.bytes).toBe(8_672);
    expect(tiles.residentBytes).toBe(8_672);
    tiles.dispose();
  });

  it("rejects a tile when retained edge samples make it exceed the byte cap", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 8_400,
      residentTileBudget: 1,
      sampleHeight,
      streamRadius: 0,
      tileResolution: 9,
      tileSize: 16,
    });

    expect(() => tiles.follow({ x: 0, z: 0 })).toThrow(/residentByteBudget/u);
    tiles.dispose();
  });

  it("keeps resident render, query, normal, and collider data independent of topology coverage", () => {
    const worldPasses = {
      dispatchBudget: 4,
      erosion: {
        depositionRate: 1,
        erosionRate: 1,
        evaporation: 0,
        iterations: 4,
        rainfall: 1,
        sedimentCapacity: 10,
        timeStep: 1,
      },
      gpu: false,
    } as const;
    const topologyObservation = {
      columns: 17,
      depth: 16,
      origin: { x: 0, z: 0 },
      rows: 9,
      width: 32,
    } as const;
    const createTiles = (withObservation: boolean) => {
      const colliderHeights = new Map<string, Float32Array>();
      const tiles = new TerrainTiles({
        createCollider: ({ field, key }) => {
          colliderHeights.set(key, field.toColliderHeights());
          return { dispose: () => undefined };
        },
        surface: new MeshBasicMaterial(),
        residentByteBudget: 200_000,
        residentTileBudget: 9,
        sampleHeight,
        streamRadius: 1,
        tileResolution: 9,
        tileSize: 16,
        ...(withObservation ? { topologyObservation } : {}),
        worldPasses,
      });
      tiles.follow({ x: 0, z: 0 });
      return { colliderHeights, tiles };
    };
    const withoutObservation = createTiles(false);
    const withObservation = createTiles(true);

    for (const [x, z] of [
      [-4, -4],
      [4, 4],
      [7.9, 0],
      [8.1, 0],
      [12, 0],
    ] as const) {
      expect(withObservation.tiles.heightAt(x, z)).toBeCloseTo(
        withoutObservation.tiles.heightAt(x, z),
        6,
      );
      const observedNormal = withObservation.tiles.normalAt(x, z);
      const expectedNormal = withoutObservation.tiles.normalAt(x, z);
      expect(observedNormal.x).toBeCloseTo(expectedNormal.x, 6);
      expect(observedNormal.y).toBeCloseTo(expectedNormal.y, 6);
      expect(observedNormal.z).toBeCloseTo(expectedNormal.z, 6);
    }

    expect(renderedHeight(withObservation.tiles, "0:0", 4 * 9 + 4)).toBeCloseTo(
      renderedHeight(withoutObservation.tiles, "0:0", 4 * 9 + 4),
      6,
    );
    for (const key of ["0:0", "1:0"]) {
      const observedCollider = withObservation.colliderHeights.get(key);
      const expectedCollider = withoutObservation.colliderHeights.get(key);
      expect(observedCollider).toBeDefined();
      expect(expectedCollider).toBeDefined();
      expect(observedCollider).toHaveLength(expectedCollider?.length ?? 0);
      for (let index = 0; index < (expectedCollider?.length ?? 0); index += 1)
        expect(observedCollider?.[index]).toBeCloseTo(expectedCollider?.[index] as number, 6);
    }
    expect(withObservation.tiles.debug()).toHaveProperty("topology");
    withObservation.tiles.dispose();
    withoutObservation.tiles.dispose();
  });

  it("keeps stitched rendered edges equal to the canonical query and collider source", () => {
    const colliderHeights = new Map<string, Float32Array>();
    const tiles = new TerrainTiles({
      createCollider: ({ field, key }) => {
        colliderHeights.set(key, field.toColliderHeights());
        return { dispose: () => undefined };
      },
      residentByteBudget: 1_000_000,
      residentTileBudget: 9,
      sampleHeight: (x, z) => (Math.abs(x - 8) < 1e-6 ? Math.sin(z * (Math.PI / 2)) * 10 : 0),
      streamRadius: 1,
      surface: new MeshBasicMaterial(),
      tileResolution: 17,
      tileSize: 16,
      lodDistances: [8, 16],
    });

    try {
      tiles.follow({ x: 0, z: 0 });
      const a = tiles.getTile("0:0");
      const b = tiles.getTile("1:0");
      if (a === undefined || b === undefined) throw new Error("Expected adjacent resident tiles.");
      expect(Math.abs(a.lodLevel - b.lodLevel)).toBe(1);
      expect(tiles.maxSeamGap).toBeGreaterThan(0);

      const aSurface = visibleSurface(a);
      const bSurface = visibleSurface(b);
      expect(canonicalEdgeError(a, "east", aSurface, colliderHeights.get(a.key))).toBeLessThan(
        0.00001,
      );
      expect(canonicalEdgeError(b, "west", bSurface, colliderHeights.get(b.key))).toBeLessThan(
        0.00001,
      );
    } finally {
      tiles.dispose();
    }
  });

  it("restores canonical shared edges when mixed neighbors return to equal LOD", () => {
    const tiles = new TerrainTiles({
      residentByteBudget: 1_000_000,
      residentTileBudget: 9,
      sampleHeight,
      streamRadius: 1,
      surface: new MeshBasicMaterial(),
      tileResolution: 17,
      tileSize: 16,
      lodDistances: [9, 18],
    });

    try {
      tiles.follow({ x: 0, z: 0 });
      tiles.follow({ x: 8, z: 0 });
      for (let frame = 0; frame < 3; frame += 1) tiles.process();

      const a = tiles.getTile("0:0");
      const b = tiles.getTile("1:0");
      if (a === undefined || b === undefined) throw new Error("Expected adjacent resident tiles.");
      expect(a.lodLevel).toBe(0);
      expect(b.lodLevel).toBe(0);
      expect(visibleSeamGap(a, b)).toBeLessThan(0.00001);
      expect(canonicalEdgeError(a, "east", visibleSurface(a))).toBeLessThan(0.00001);
      expect(canonicalEdgeError(b, "west", visibleSurface(b))).toBeLessThan(0.00001);
    } finally {
      tiles.dispose();
    }
  });

  it("morphs one LOD surface within the measured pop bound for three frames", () => {
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
    const renderer = {} as never;

    tiles.follow({ x: 0, z: 0 });
    tiles.follow({ x: 12, z: 0 });

    const tile = tiles.getTile("0:0");
    if (tile === undefined) throw new Error("Expected the followed tile to remain resident.");
    const fine = tile.lod.levels[0]?.object;
    if (!(fine instanceof Mesh)) throw new Error("Expected the finest LOD to be a mesh.");
    const position = fine.geometry.getAttribute("position");
    const trackedIndex = 4 * 17 + 5;
    const startHeight = position.getY(trackedIndex);
    const visible = (): number => tile.lod.children.filter((child) => child.visible).length;
    expect(visible()).toBe(1);
    tiles.process(renderer);
    expect(visible()).toBe(1);
    expect(position.getY(trackedIndex)).not.toBe(startHeight);
    tiles.process(renderer);
    expect(visible()).toBe(1);
    tiles.process(renderer);
    expect(visible()).toBe(1);
    expect(tiles.maxLodTransitionFrames).toBeGreaterThanOrEqual(3);
    expect(tiles.maxLodPop).toBeGreaterThan(0);
    expect(tiles.maxLodPop).toBeLessThanOrEqual(16);
    tiles.dispose();
  });

  it("measures the visible per-frame displacement instead of the complete LOD mismatch", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 200_000,
      residentTileBudget: 2,
      sampleHeight: (x, z) => sampleHeight(x, z) * 500,
      streamRadius: 1,
      tileResolution: 17,
      tileSize: 16,
      lodDistances: [8, 16],
    });

    tiles.follow({ x: 0, z: 0 });
    tiles.follow({ x: 12, z: 0 });

    const tile = tiles.getTile("0:0");
    if (tile === undefined) throw new Error("Expected the transitioned tile to remain resident.");
    let previous = visibleSurface(tile);
    let observedMaximum = 0;
    for (let frame = 0; frame < 3; frame += 1) {
      tiles.process();
      const current = visibleSurface(tile);
      observedMaximum = Math.max(observedMaximum, surfaceDelta(previous, current));
      previous = current;
    }

    expect(observedMaximum).toBeGreaterThan(0);
    expect(tiles.maxLodPop).toBeCloseTo(observedMaximum, 5);
    expect(tiles.maxLodPop).toBeLessThanOrEqual(16);
    tiles.dispose();
  });

  it("records a visible snap when an active LOD transition is retargeted before the next render", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 200_000,
      residentTileBudget: 1,
      sampleHeight: (x, z) => sampleHeight(x, z) * 500,
      streamRadius: 0,
      tileResolution: 17,
      tileSize: 16,
      lodDistances: [4, 8],
    });

    try {
      tiles.follow({ x: 0, z: 0 });
      tiles.follow({ x: 6, z: 0 });

      const tile = tiles.getTile("0:0");
      if (tile === undefined) throw new Error("Expected the transitioned tile to remain resident.");
      tiles.process();
      const beforeRetarget = visibleSurface(tile);

      tiles.follow({ x: 0, z: 0 });
      const afterRetarget = visibleSurface(tile);
      const retargetSnap = surfaceDelta(beforeRetarget, afterRetarget);
      expect(retargetSnap).toBeGreaterThan(0.00001);

      tiles.process();
      expect(tiles.maxLodPop).toBeGreaterThanOrEqual(retargetSnap - 0.00001);
    } finally {
      tiles.dispose();
    }
  });

  it("reports visible edge geometry on every frame of an LOD transition", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 200_000,
      residentTileBudget: 2,
      sampleHeight,
      streamRadius: 1,
      tileResolution: 17,
      tileSize: 16,
      lodDistances: [8, 16],
    });

    tiles.follow({ x: 0, z: 0 });
    tiles.follow({ x: 12, z: 0 });

    expect(tiles.residentKeys).toEqual(["0:0", "1:0"]);
    const a = tiles.getTile("0:0");
    const b = tiles.getTile("1:0");
    if (a === undefined || b === undefined) throw new Error("Expected adjacent resident tiles.");
    let observedMaximum = visibleSeamGap(a, b);
    for (let frame = 0; frame < 3; frame += 1) {
      tiles.process();
      const current = visibleSeamGap(a, b);
      observedMaximum = Math.max(observedMaximum, current);
      expect(Number.isFinite(current)).toBe(true);
      expect(tiles.maxSeamGap).toBeGreaterThanOrEqual(observedMaximum);
    }
    tiles.dispose();
  });

  it("fails closed when a live seam edge contains a non-finite position", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 200_000,
      residentTileBudget: 2,
      sampleHeight,
      streamRadius: 1,
      tileResolution: 17,
      tileSize: 16,
      lodDistances: [8, 16],
    });

    tiles.follow({ x: 0, z: 0 });
    tiles.follow({ x: 12, z: 0 });
    for (let frame = 0; frame < 3; frame += 1) tiles.process();

    const tile = tiles.getTile("0:0");
    if (tile === undefined) throw new Error("Expected the corrupted tile to remain resident.");
    const surface = tile.lod.levels.find(({ object }) => object.visible)?.object;
    if (!(surface instanceof Mesh)) throw new Error("Expected a visible surface mesh.");
    const position = surface.geometry.getAttribute("position");
    const resolution = Math.round(Math.sqrt(position.count + 4) - 2);
    for (let row = 0; row < resolution; row += 1)
      position.setY(row * resolution + resolution - 1, Number.NaN);

    try {
      expect(() => tiles.process()).toThrow(/seam diagnostic.*finite|invalid.*seam/u);
    } finally {
      tiles.dispose();
    }
  });

  it("reconciles a mixed-LOD surface edge before skirt coverage", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 200_000,
      residentTileBudget: 2,
      sampleHeight,
      streamRadius: 1,
      tileResolution: 17,
      tileSize: 16,
      lodDistances: [8, 16],
    });

    tiles.follow({ x: 0, z: 0 });
    tiles.follow({ x: 12, z: 0 });
    for (let frame = 0; frame < 3; frame += 1) tiles.process();

    const a = tiles.getTile("0:0");
    const b = tiles.getTile("1:0");
    if (a === undefined || b === undefined) throw new Error("Expected adjacent resident tiles.");
    const aSurface = visibleSurface(a);
    const bSurface = visibleSurface(b);
    expect(aSurface.resolution).not.toBe(bSurface.resolution);
    expect(visibleSeamGap(a, b)).toBeGreaterThan(0);
    expect(tiles.stitchedEdgeCount).toBeGreaterThan(0);
    expect(tiles.maxVisualSeamGap).toBe(0);
    expect(a.lodLevel).toBeLessThanOrEqual(b.lodLevel + 1);
    expect(b.lodLevel).toBeLessThanOrEqual(a.lodLevel + 1);
    tiles.dispose();
  });

  it("measures the final rendered LOD frame after edge restoration", () => {
    const tiles = new TerrainTiles({
      residentByteBudget: 200_000,
      residentTileBudget: 2,
      sampleHeight: (x, z) => (Math.abs(x - 8) < 1e-6 ? Math.sin(z * (Math.PI / 2)) * 10 : 0),
      streamRadius: 1,
      surface: new MeshBasicMaterial(),
      tileResolution: 17,
      tileSize: 16,
      lodDistances: [8, 16],
    });

    try {
      tiles.follow({ x: 8, z: 0 });
      tiles.follow({ x: 12, z: 0 });
      const tile = tiles.getTile("1:0");
      if (tile === undefined) throw new Error("Expected the transitioned tile to remain resident.");
      let previous = visibleSurface(tile);
      let observedMaximum = 0;
      for (let frame = 0; frame < 3; frame += 1) {
        tiles.process();
        const current = visibleSurface(tile);
        observedMaximum = Math.max(observedMaximum, surfaceDelta(previous, current));
        previous = current;
      }

      expect(observedMaximum).toBeLessThan(0.00001);
      expect(tiles.maxLodPop).toBeCloseTo(observedMaximum, 5);
    } finally {
      tiles.dispose();
    }
  });

  it("coordinates adjacent resident LOD targets instead of allowing a two-level jump", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 1_000_000,
      residentTileBudget: 9,
      sampleHeight,
      streamRadius: 1,
      tileResolution: 17,
      tileSize: 16,
      lodDistances: [1, 2],
    });

    tiles.follow({ x: 0, z: 0 });

    const center = tiles.getTile("0:0");
    const east = tiles.getTile("1:0");
    if (center === undefined || east === undefined)
      throw new Error("Expected the center and east neighbor to remain resident.");
    expect(center.lodLevel).toBe(0);
    expect(east.lodLevel).toBe(1);
    expect(Math.abs(center.lodLevel - east.lodLevel)).toBeLessThanOrEqual(1);
    tiles.dispose();
  });

  it("retains the maximum seam diagnostics after a transient transition seam closes", () => {
    const skirtDepth = 0.000001;
    const tiles = new TerrainTiles({
      residentByteBudget: 200_000,
      residentTileBudget: 2,
      sampleHeight: (x, z) => Math.sin(x * 0.2) * 10 + Math.cos(z * 0.11),
      skirtDepth,
      streamRadius: 1,
      surface: new MeshBasicMaterial(),
      tileResolution: 17,
      tileSize: 16,
      lodFactors: [1, 2],
      lodDistances: [4],
    });

    tiles.follow({ x: 2, z: 0 });
    tiles.follow({ x: 6, z: 0 });

    const a = tiles.getTile("0:0");
    const b = tiles.getTile("1:0");
    if (a === undefined || b === undefined) throw new Error("Expected adjacent resident tiles.");
    expect(tiles.maxSeamGap).toBeGreaterThan(0);
    expect(tiles.maxVisualSeamGap).toBeGreaterThan(0);
    const observedMaximum = tiles.maxSeamGap;
    const observedVisualMaximum = tiles.maxVisualSeamGap;
    for (let frame = 0; frame < 3; frame += 1) {
      tiles.process();
    }

    expect(observedMaximum).toBeGreaterThan(0);
    expect(observedVisualMaximum).toBeGreaterThan(0);
    expect(visibleSeamGap(a, b)).toBeCloseTo(0, 6);
    expect(tiles.maxSeamGap).toBeCloseTo(observedMaximum, 6);
    expect(tiles.maxVisualSeamGap).toBeCloseTo(observedVisualMaximum, 6);
    const maximumBeforeResidencyChange = tiles.maxSeamGap;
    const visualMaximumBeforeResidencyChange = tiles.maxVisualSeamGap;
    tiles.follow({ x: 32, z: 0 });
    expect(Number.isFinite(tiles.maxSeamGap)).toBe(true);
    expect(Number.isFinite(tiles.maxVisualSeamGap)).toBe(true);
    expect(tiles.maxSeamGap).toBeGreaterThanOrEqual(maximumBeforeResidencyChange);
    expect(tiles.maxVisualSeamGap).toBeGreaterThanOrEqual(visualMaximumBeforeResidencyChange);
    tiles.dispose();
  });

  it("rejects an LOD transition whose measured mismatch exceeds the pop bound", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 200_000,
      residentTileBudget: 9,
      sampleHeight: (x) => Math.sin(x * (Math.PI / 2)) * 100,
      streamRadius: 0,
      tileResolution: 17,
      tileSize: 16,
      lodDistances: [4, 8],
    });

    tiles.follow({ x: 0, z: 0 });
    expect(() => {
      tiles.follow({ x: 6, z: 0 });
      tiles.process();
    }).toThrow(/LOD pop threshold/u);
    tiles.dispose();
  });

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

  it("reports a visual seam when a recorded bridge is detached from the tile owner", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 200_000,
      residentTileBudget: 2,
      sampleHeight,
      skirtDepth: 32,
      streamRadius: 1,
      tileResolution: 17,
      tileSize: 16,
      lodFactors: [1, 2],
      lodDistances: [4],
    });

    try {
      tiles.follow({ x: 2, z: 0 });
      const bridge = tiles.children.find((child): child is Mesh => child instanceof Mesh);
      if (bridge === undefined) throw new Error("Expected a mixed-LOD bridge mesh.");
      expect(tiles.stitchedEdgeCount).toBeGreaterThan(0);
      expect(tiles.maxVisualSeamGap).toBe(0);

      tiles.remove(bridge);
      const tile = tiles.getTile("0:0");
      if (tile === undefined) throw new Error("Expected the stitched tile to remain resident.");
      const surface = tile.lod.levels.find(({ object }) => object.visible)?.object;
      if (!(surface instanceof Mesh)) throw new Error("Expected a visible surface mesh.");
      const position = surface.geometry.getAttribute("position");
      const resolution = Math.round(Math.sqrt(position.count + 4) - 2);
      for (let row = 0; row < resolution; row += 1) {
        const index = row * resolution + resolution - 1;
        position.setY(index, position.getY(index) + 128);
      }
      position.needsUpdate = true;
      tiles.process();

      expect(tiles.maxVisualSeamGap).toBeGreaterThan(0);
    } finally {
      tiles.dispose();
    }
  });

  it("rejects an attached bridge translated away from its seam", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 200_000,
      residentTileBudget: 2,
      sampleHeight,
      skirtDepth: 32,
      streamRadius: 1,
      tileResolution: 17,
      tileSize: 16,
      lodFactors: [1, 2],
      lodDistances: [4],
    });

    try {
      tiles.follow({ x: 2, z: 0 });
      const bridge = tiles.children.find((child): child is Mesh => child instanceof Mesh);
      if (bridge === undefined) throw new Error("Expected a mixed-LOD bridge mesh.");
      expect(tiles.stitchedEdgeCount).toBeGreaterThan(0);
      expect(tiles.maxVisualSeamGap).toBe(0);

      bridge.position.x += 128;

      expect(() => tiles.process()).toThrow(/bridge.*topology|bridge.*coordinate/u);
    } finally {
      tiles.dispose();
    }
  });

  it("rejects an attached bridge translated vertically away from its seam", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 200_000,
      residentTileBudget: 2,
      sampleHeight,
      skirtDepth: 32,
      streamRadius: 1,
      tileResolution: 17,
      tileSize: 16,
      lodFactors: [1, 2],
      lodDistances: [4],
    });

    try {
      tiles.follow({ x: 2, z: 0 });
      const bridge = tiles.children.find((child): child is Mesh => child instanceof Mesh);
      if (bridge === undefined) throw new Error("Expected a mixed-LOD bridge mesh.");
      expect(tiles.stitchedEdgeCount).toBeGreaterThan(0);
      expect(tiles.maxVisualSeamGap).toBe(0);

      bridge.position.y += 128;

      expect(() => tiles.process()).toThrow(/bridge.*topology|bridge.*coordinate/u);
    } finally {
      tiles.dispose();
    }
  });

  it("rejects an attached bridge with an empty rendered draw range", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 200_000,
      residentTileBudget: 2,
      sampleHeight,
      skirtDepth: 32,
      streamRadius: 1,
      tileResolution: 17,
      tileSize: 16,
      lodFactors: [1, 2],
      lodDistances: [4],
    });

    try {
      tiles.follow({ x: 2, z: 0 });
      const bridge = tiles.children.find((child): child is Mesh => child instanceof Mesh);
      if (bridge === undefined) throw new Error("Expected a mixed-LOD bridge mesh.");
      expect(tiles.stitchedEdgeCount).toBeGreaterThan(0);
      expect(tiles.maxVisualSeamGap).toBe(0);

      bridge.geometry.setDrawRange(0, 0);

      expect(() => tiles.process()).toThrow(/bridge.*topology/u);
    } finally {
      tiles.dispose();
    }
  });

  it("rejects an attached bridge whose rendered index buffer is all degenerate", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 200_000,
      residentTileBudget: 2,
      sampleHeight,
      skirtDepth: 32,
      streamRadius: 1,
      tileResolution: 17,
      tileSize: 16,
      lodFactors: [1, 2],
      lodDistances: [4],
    });

    try {
      tiles.follow({ x: 2, z: 0 });
      const bridge = tiles.children.find((child): child is Mesh => child instanceof Mesh);
      if (bridge === undefined) throw new Error("Expected a mixed-LOD bridge mesh.");
      expect(tiles.stitchedEdgeCount).toBeGreaterThan(0);
      expect(tiles.maxVisualSeamGap).toBe(0);

      const index = bridge.geometry.getIndex();
      if (index === null) throw new Error("Expected the bridge to have an index buffer.");
      index.array.fill(0);
      index.needsUpdate = true;

      expect(() => tiles.process()).toThrow(/bridge.*topology/u);
    } finally {
      tiles.dispose();
    }
  });

  it("rejects an attached bridge whose rendered index buffer uses floating-point data", () => {
    const tiles = new TerrainTiles({
      surface: new MeshBasicMaterial(),
      residentByteBudget: 200_000,
      residentTileBudget: 2,
      sampleHeight,
      skirtDepth: 32,
      streamRadius: 1,
      tileResolution: 17,
      tileSize: 16,
      lodFactors: [1, 2],
      lodDistances: [4],
    });

    try {
      tiles.follow({ x: 2, z: 0 });
      const bridge = tiles.children.find((child): child is Mesh => child instanceof Mesh);
      if (bridge === undefined) throw new Error("Expected a mixed-LOD bridge mesh.");
      expect(tiles.stitchedEdgeCount).toBeGreaterThan(0);
      expect(tiles.maxVisualSeamGap).toBe(0);

      const index = bridge.geometry.getIndex();
      if (index === null) throw new Error("Expected the bridge to have an index buffer.");
      bridge.geometry.setIndex(new BufferAttribute(new Float32Array(index.array), 1));

      expect(() => tiles.process()).toThrow(/bridge.*topology/u);
    } finally {
      tiles.dispose();
    }
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
    for (let frame = 0; frame < 3; frame += 1) tiles.process();
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
      residentByteBudget: 20_000_000,
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
