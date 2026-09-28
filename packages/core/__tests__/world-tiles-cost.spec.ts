import { BufferGeometry, MeshBasicMaterial, Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import { TerrainTiles } from "../src/world-tiles.js";
import { Heightfield } from "../src/world.js";

/**
 * The per-frame cost of a settled terrain ring, measured because it was reported rather than
 * guessed: a game running `streamRadius: 8` (289 resident tiles, ring 2 for props) went from a
 * ~10 ms steady frame at 25 tiles to ~48 ms in the render phase's CPU. Every suspect was O(n^2) in
 * the resident set, so the count below is the shape of the fix: a settled ring must cost a handful
 * of per-pair operations, not a per-sample rebuild of every bridge's world matrix.
 *
 * The timing case is opt-in (`TN_BENCH=1`) because wall-clock thresholds belong on a quiet machine;
 * the operation-count case runs everywhere and is what fails when the cost comes back.
 */
const bench = process.env.TN_BENCH === "1";

const sampleHeight = (x: number, z: number): number =>
  Math.sin(x * 0.017) * 12 + Math.cos(z * 0.013) * 9 + Math.sin((x + z) * 0.007) * 4;

function ring(
  streamRadius: number,
  tileResolution: number,
  tileSize: number,
  residentTileBudget: number,
  residentByteBudget: number,
): TerrainTiles {
  const tiles = new TerrainTiles({
    residentByteBudget,
    residentTileBudget,
    sampleHeight,
    streamRadius,
    surface: new MeshBasicMaterial(),
    tileResolution,
    tileSize,
  });
  // Two settles: the first fills the ring and moves tiles through their LOD transitions, the second
  // leaves every seam and every LOD target exactly where the last reconcile left it.
  tiles.follow({ x: 0, z: 0 });
  for (let frame = 0; frame < 4; frame += 1) tiles.process();
  tiles.follow({ x: 0, z: 0 });
  tiles.process();
  return tiles;
}

describe("TerrainTiles settled-frame cost", () => {
  // A still camera must not rebuild per-sample seam coverage. `bridgeCoverageAt` revalidated the
  // whole bridge topology and re-derived three world matrices *for every sample of every pair*,
  // which is what turned a 25-tile ring into a 289-tile frame cost.
  it("stops rebuilding seam coverage per sample once the ring has settled", () => {
    const tiles = ring(2, 33, 32, 25, 64_000_000);
    try {
      const matrices = vi.spyOn(Object3D.prototype, "updateWorldMatrix");
      const heights = vi.spyOn(Heightfield.prototype, "heightAt");
      const attributes = vi.spyOn(BufferGeometry.prototype, "getAttribute");
      let attributeReads = 0;
      try {
        tiles.follow({ x: 0, z: 0 });
        tiles.process();
      } finally {
        matrices.mockRestore();
        heights.mockRestore();
        attributeReads = attributes.mock.calls.length;
        attributes.mockRestore();
      }
      // One pair observation, not one per edge sample: a 25-tile ring has at most 40 pairs and each
      // needs at most three matrices.
      expect(matrices.mock.calls.length).toBeLessThanOrEqual(25 * 40 * 3);
      // A settled ring restores no edge, so the canonical sampler is never re-read.
      expect(heights).not.toHaveBeenCalled();
      // One flat state read per tile and bridge, not a per-pair walk: 124 reads here against
      // 24,792 before the settled fast path, so the bound fails loudly if the walk comes back.
      expect(attributeReads).toBeLessThanOrEqual(8 * 25);
    } finally {
      tiles.dispose();
    }
  });

  it.skipIf(!bench)("times 100 settled follow()+process() calls on a 289-tile ring", () => {
    const tiles = ring(8, 65, 128, 289, 400_000_000);
    try {
      expect(tiles.residentTileCount).toBe(289);
      for (let warmup = 0; warmup < 20; warmup += 1) {
        tiles.follow({ x: 0, z: 0 });
        tiles.process();
      }
      const started = performance.now();
      for (let frame = 0; frame < 100; frame += 1) {
        tiles.follow({ x: 0, z: 0 });
        tiles.process();
      }
      const perCall = (performance.now() - started) / 100;
      // eslint-disable-next-line no-console
      console.log(
        `TerrainTiles settled 289-tile ring: ${perCall.toFixed(3)} ms per follow()+process()`,
      );
      expect(perCall).toBeLessThan(0.5);
    } finally {
      tiles.dispose();
    }
  });
});
