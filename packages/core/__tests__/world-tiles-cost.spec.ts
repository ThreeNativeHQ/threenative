import {
  Box3,
  BufferGeometry,
  InterleavedBufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from "three";
import { describe, expect, it, vi } from "vitest";
import { TerrainTiles } from "../src/world-tiles.js";
import { terrainValidationRequested } from "../src/world-validate.js";
import { Heightfield } from "../src/world.js";

/**
 * The per-frame cost of a settled terrain ring, measured because it was reported rather than
 * guessed: a game running `streamRadius: 8` (289 resident tiles, ring 2 for props) went from a
 * ~10 ms steady frame at 25 tiles to ~48 ms in the render phase's CPU. Every suspect was O(n^2) in
 * the resident set, so the count below is the shape of the fix: a settled ring must cost a handful
 * of per-pair operations, not a per-sample rebuild of every bridge's world matrix.
 *
 * The timing cases are opt-in (`TN_BENCH=1`) because wall-clock thresholds belong on a quiet
 * machine; the operation-count cases run everywhere and are what fails when the cost comes back.
 */
const bench = process.env.TN_BENCH === "1";

const sampleHeight = (x: number, z: number): number =>
  Math.sin(x * 0.017) * 12 + Math.cos(z * 0.013) * 9 + Math.sin((x + z) * 0.007) * 4;

/** Every resident tile's rendered positions, so "unchanged" is a number and not a claim. */
function renderedPositions(tiles: TerrainTiles): Record<string, Float32Array> {
  const rendered: Record<string, Float32Array> = {};
  for (const key of tiles.residentKeys) {
    const tile = tiles.getTile(key);
    if (tile === undefined) throw new Error(`Missing resident tile '${key}'.`);
    const mesh = tile.lod.levels.find(({ object }) => object.visible)?.object;
    if (!(mesh instanceof Mesh)) throw new Error(`Missing visible LOD for tile '${key}'.`);
    rendered[key] = (mesh.geometry.getAttribute("position").array as Float32Array).slice();
  }
  return rendered;
}

function ring(
  streamRadius: number,
  tileResolution: number,
  tileSize: number,
  residentTileBudget: number,
  residentByteBudget: number,
  validate?: boolean,
): TerrainTiles {
  const tiles = new TerrainTiles({
    ...(validate === undefined ? {} : { validate }),
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

/** A settled ring's stitch bridge, which is the only child of the tiles group that is a bare mesh. */
function bridgeOf(tiles: TerrainTiles): Mesh {
  const bridge = tiles.children.find((child): child is Mesh => child instanceof Mesh);
  if (bridge === undefined) throw new Error("Expected a mixed-LOD bridge mesh.");
  return bridge;
}

/** Every resident tile's level meshes, blending or settled. */
function residentLevelMeshes(tiles: TerrainTiles): Mesh[] {
  const meshes: Mesh[] = [];
  for (const key of tiles.residentKeys) {
    const tile = tiles.getTile(key);
    if (tile === undefined) throw new Error(`Missing resident tile '${key}'.`);
    for (const level of tile.lod.levels)
      if (level.object instanceof Mesh) meshes.push(level.object);
  }
  return meshes;
}

/** The exact AABB of a geometry's own positions, ignoring whatever bounds it currently carries. */
function geometryBounds(geometry: BufferGeometry): Box3 {
  const position = geometry.getAttribute("position");
  if (position instanceof InterleavedBufferAttribute)
    throw new Error("Expected a non-interleaved terrain position attribute.");
  return new Box3().setFromBufferAttribute(position);
}

/** A widened bound may be loose, never wrong: every stored position must sit inside it. */
function expectContainsEveryVertex(mesh: Mesh): void {
  const sphere = mesh.geometry.boundingSphere;
  if (sphere === null) throw new Error("Expected a level geometry to carry a bounding sphere.");
  const box = geometryBounds(mesh.geometry);
  const corners = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) corners.push(new Vector3(x, y, z));
  // A sphere written from a box is exact only up to float rounding on the squared comparison, so
  // the overflow is reported as a fraction of the radius: a widened bound is loose, a wrong one
  // misses by metres.
  const overflow = Math.max(
    ...corners.map((corner) => corner.distanceTo(sphere.center) / sphere.radius - 1),
  );
  expect(overflow).toBeLessThanOrEqual(1e-6);
  expect(mesh.geometry.boundingBox?.containsBox(box)).toBe(true);
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

  // The ring-state compare is what decides whether a pass has anything to do, so it stays: it is
  // the only thing that sees a writer that reached past `needsUpdate`. What must not come back is
  // the work the settled ring used to do anyway — a coverage or seam pass that rewrote edges,
  // recomputed whole-tile bounds and re-measured bridges, then wrote back the same numbers.
  it("recomputes no coverage, seam or LOD blend for a follow point that has not moved", () => {
    const tiles = ring(2, 33, 32, 25, 64_000_000);
    try {
      const before = renderedPositions(tiles);
      const stitches = tiles.stitchedEdgeCount;
      const bounds = vi.spyOn(BufferGeometry.prototype, "computeBoundingBox");
      const spheres = vi.spyOn(BufferGeometry.prototype, "computeBoundingSphere");
      const attributes = vi.spyOn(BufferGeometry.prototype, "getAttribute");
      const heights = vi.spyOn(Heightfield.prototype, "heightAt");
      let attributeReads = 0;
      try {
        tiles.follow({ x: 0, z: 0 });
        tiles.process();
      } finally {
        bounds.mockRestore();
        spheres.mockRestore();
        attributeReads = attributes.mock.calls.length;
        attributes.mockRestore();
        heights.mockRestore();
      }
      // A reconcile, a bridge rewrite, an edge restore and a coverage re-measure all recompute
      // whole-tile bounds; a settled ring does none of them.
      expect(bounds).not.toHaveBeenCalled();
      expect(spheres).not.toHaveBeenCalled();
      // And the canonical sampler is not re-read, so no LOD blend is in flight to re-derive.
      expect(heights).not.toHaveBeenCalled();
      // One flat state read per tile and bridge: the compare, and nothing downstream of it.
      expect(attributeReads).toBeLessThanOrEqual(8 * 25);
      // The pass ran and still accounted for the ring: a settled stitch counts as stitched.
      expect(tiles.stitchedEdgeCount).toBeGreaterThan(stitches);
      // Identical output, vertex for vertex.
      expect(renderedPositions(tiles)).toEqual(before);
    } finally {
      tiles.dispose();
    }
  });

  it("recomputes no bounds on a blend frame, and the widened bounds hold both levels", () => {
    const tiles = ring(2, 33, 32, 25, 64_000_000);
    try {
      // A LOD transition in flight, then a frame that advances it.
      for (let frame = 0; frame < 60 && tiles.blendingTiles === 0; frame += 1) {
        tiles.follow({ x: frame * 0.3, z: 0 });
        tiles.process();
      }
      expect(tiles.blendingTiles).toBeGreaterThan(0);
      // The bridge strips are a few dozen vertices and their own exact bounds; a tile level is
      // ~4,500, so the question the six-second walk answered is which of the two got walked.
      const levels = new Set(residentLevelMeshes(tiles).map((mesh) => mesh.geometry));
      const walked = new Set<BufferGeometry>();
      const record = function (this: BufferGeometry) {
        walked.add(this);
      };
      const original = BufferGeometry.prototype.computeBoundingBox;
      const bounds = vi
        .spyOn(BufferGeometry.prototype, "computeBoundingBox")
        .mockImplementation(function (this: BufferGeometry) {
          record.call(this);
          return original.call(this);
        });
      const spheres = vi.spyOn(BufferGeometry.prototype, "computeBoundingSphere");
      try {
        tiles.process();
      } finally {
        bounds.mockRestore();
        spheres.mockRestore();
      }
      // A blend only moves vertices between the two levels' surfaces, so the union set once at the
      // start holds every frame of it: 157 ms of bounds walking per 6 s walk disappears with it.
      expect([...walked].filter((geometry) => levels.has(geometry))).toEqual([]);
      // And the bound it leaves behind still holds the geometry the renderer culls with.
      for (const mesh of residentLevelMeshes(tiles)) {
        expectContainsEveryVertex(mesh);
      }
      // The blend finished, and the level it settled on carries its own bounds again.
      for (let settle = 0; settle < 3; settle += 1) tiles.process();
      expect(tiles.blendingTiles).toBe(0);
      for (const key of tiles.residentKeys) {
        const tile = tiles.getTile(key);
        if (tile === undefined) throw new Error(`Missing resident tile '${key}'.`);
        const mesh = tile.lod.levels[tile.lodLevel]?.object;
        if (!(mesh instanceof Mesh)) throw new Error(`Missing settled LOD for tile '${key}'.`);
        expectContainsEveryVertex(mesh);
        expect(mesh.geometry.boundingBox?.equals(geometryBounds(mesh.geometry))).toBe(true);
      }
    } finally {
      tiles.dispose();
    }
  });

  /**
   * The shipped frame's change detector is the ring epoch, not a rebuilt ring state.
   *
   * Rebuilding it meant a per-tile level, geometry id and attribute-version walk plus a bridge walk
   * every frame, to be told what the class's own writers already knew: 244 ms + 139 ms of a
   * six-second walk on a 289-tile ring, and 100 settled frames build nothing at all now. The counter
   * is the class's own, and the walk below is 100 frames — the case the array was costing on.
   */
  it("builds no ring state at all across 100 settled frames", () => {
    const tiles = ring(2, 33, 32, 25, 64_000_000);
    try {
      const builds = (tiles.debug().ringStateBuilds as number) ?? 0;
      const epoch = tiles.debug().ringEpoch as number;
      const attributes = vi.spyOn(BufferGeometry.prototype, "getAttribute");
      let attributeReads = 0;
      try {
        for (let frame = 0; frame < 100; frame += 1) {
          tiles.follow({ x: 0, z: 0 });
          tiles.process();
        }
      } finally {
        attributeReads = attributes.mock.calls.length;
        attributes.mockRestore();
      }
      // Not one ring state built, and not one attribute read to build it: a settled ring is decided
      // by an integer that no writer moved.
      expect(tiles.debug().ringStateBuilds).toBe(builds);
      expect(tiles.debug().ringEpoch).toBe(epoch);
      expect(attributeReads).toBe(0);
      // And the pass still ran and still accounted for the ring: a settled stitch counts as
      // stitched, which is what a frame that skipped the pass owes its caller.
      expect(tiles.stitchedEdgeCount).toBeGreaterThan(0);
      expect(tiles.blendingTiles).toBe(0);
    } finally {
      tiles.dispose();
    }
  });

  /**
   * Under validation the full compare stays, because it is the only detector left for a writer that
   * reached past the epoch — and the spec that corrupts a bridge's buffer from outside fails closed
   * on it rather than trusting a counter.
   */
  it("still compares the whole ring state under validation", () => {
    const tiles = ring(2, 33, 32, 25, 64_000_000, true);
    try {
      const before = tiles.debug().ringStateBuilds as number;
      for (let frame = 0; frame < 4; frame += 1) {
        tiles.follow({ x: 0, z: 0 });
        tiles.process();
      }
      // A compare a frame, and a second one on a frame that found a change, because the settled
      // state is re-read from what the pass left behind. The epoch decides nothing here.
      expect((tiles.debug().ringStateBuilds as number) - before).toBeGreaterThanOrEqual(4);
    } finally {
      tiles.dispose();
    }
  });

  it.skipIf(!bench)("times a 6 s walk on a 289-tile ring, 0.3 m a frame", () => {
    const tiles = ring(8, 65, 128, 289, 400_000_000);
    try {
      const attributes = vi.spyOn(BufferGeometry.prototype, "getAttribute");
      // Timed without the spy in the loop: a wrapped `getAttribute` costs more than the code it
      // measures, and the walk makes 6,000 of them a frame.
      let frames = 0;
      const started = performance.now();
      for (let frame = 0; frame < 360; frame += 1) {
        tiles.follow({ x: frame * 0.3, z: 0 });
        tiles.process();
        frames += 1;
      }
      const perCall = (performance.now() - started) / frames;
      let attributeReads = 0;
      for (let frame = 0; frame < 360; frame += 1) {
        const before = attributes.mock.calls.length;
        tiles.follow({ x: frame * 0.3, z: 0 });
        tiles.process();
        attributeReads += attributes.mock.calls.length - before;
      }
      attributes.mockRestore();
      // eslint-disable-next-line no-console
      console.log(
        `TerrainTiles 6 s walk: ${perCall.toFixed(3)} ms per follow()+process(), ` +
          `${(attributeReads / frames).toFixed(0)} getAttribute a frame, ` +
          `${tiles.lodTransitions} transitions`,
      );
      // 1.03 ms on a plain node run of the same walk; the instrumented vitest runtime is slower,
      // so the bound is the harness's own floor plus room, not the number a player would feel.
      expect(perCall).toBeLessThan(3);
      // The LOD blend and the pop measurement read their attributes once per transition frame
      // instead of four times per sample: 7,023 a frame before, and the settled ring's own state
      // read is under 2,400 of the rest.
      expect(attributeReads / frames).toBeLessThan(3_000);
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

/**
 * The measurements a shipped frame does not pay for.
 *
 * `TN_TERRAIN_VALIDATE=1`, `?tnTerrainValidate=1` or `validate: true` puts them back: a finiteness
 * scan of every rendered vertex, a seam measurement per resident pair and an LOD pop sample per
 * blending tile, which together cost ~270 ms over a six-second walk on a 289-tile ring. Off, the
 * frame's change detector is the residency, LOD and buffer-version state the class writes itself,
 * and every gated loop leaves a trace a test can read: an observation reports `undefined` rather
 * than a `0` nobody measured, and a vertex written past `needsUpdate` is left exactly as it was
 * instead of being found by a scan, rewritten, and reported.
 */
describe("TerrainTiles validation", () => {
  it("turns on from TN_TERRAIN_VALIDATE or ?tnTerrainValidate, and reads 0 and false as off", () => {
    const previous = process.env.TN_TERRAIN_VALIDATE;
    const previousSearch = (globalThis as { location?: Location }).location?.search;
    try {
      for (const [env, search, expected] of [
        ["1", "", true],
        ["0", "", false],
        [undefined, "?tnTerrainValidate=1", true],
        [undefined, "?tnTerrainValidate=0", false],
        [undefined, "?debug=1", false],
      ] as const) {
        if (env === undefined) Reflect.deleteProperty(process.env, "TN_TERRAIN_VALIDATE");
        else process.env.TN_TERRAIN_VALIDATE = env;
        Object.defineProperty(globalThis, "location", { configurable: true, value: { search } });
        expect(terrainValidationRequested()).toBe(expected);
      }
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, "TN_TERRAIN_VALIDATE");
      else process.env.TN_TERRAIN_VALIDATE = previous;
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: previousSearch === undefined ? undefined : { search: previousSearch },
      });
    }
  });

  it("measures nothing on a 20-frame walk, and draws the same geometry as a validated walk", () => {
    const unmeasured = ring(2, 33, 32, 25, 64_000_000);
    const measured = ring(2, 33, 32, 25, 64_000_000, true);
    try {
      for (const tiles of [unmeasured, measured]) {
        for (let frame = 0; frame < 20; frame += 1) {
          tiles.follow({ x: frame * 0.3, z: 0 });
          tiles.process();
        }
      }
      // The walk did the work the frame pays for: tiles streamed and levels blended.
      expect(unmeasured.lodTransitions).toBeGreaterThan(0);
      expect(unmeasured.stitchedEdgeCount).toBeGreaterThan(0);
      // And measured none of it, which is not the same as measuring zero.
      expect(unmeasured.maxSeamGap).toBeUndefined();
      expect(unmeasured.maxVisualSeamGap).toBeUndefined();
      expect(unmeasured.maxLodPop).toBeUndefined();
      // The same walk with validation on produces the three numbers, and produces the same picture.
      expect(measured.maxSeamGap).toBeTypeOf("number");
      expect(measured.maxLodPop).toBeTypeOf("number");
      expect(renderedPositions(unmeasured)).toEqual(renderedPositions(measured));
      expect(unmeasured.stitchedEdgeCount).toBe(measured.stitchedEdgeCount);
    } finally {
      unmeasured.dispose();
      measured.dispose();
    }
  });

  it("leaves a settled bridge alone off validation, and fails closed on the same write with it", () => {
    const unvalidated = ring(2, 33, 32, 25, 64_000_000);
    const validated = ring(2, 33, 32, 25, 64_000_000, true);
    try {
      // Written the way a writer that reaches past `needsUpdate` writes: on a settled ring, the
      // per-frame finiteness scan is the only thing in the frame that could ever see it.
      const quiet = bridgeOf(unvalidated).geometry.getAttribute("position").array;
      const loud = bridgeOf(validated).geometry.getAttribute("position").array;
      quiet[0] = Number.NaN;
      loud[0] = Number.NaN;
      expect(() => unvalidated.process()).not.toThrow();
      expect(quiet[0]).toBeNaN();
      expect(() => validated.process()).toThrow(/bridge coordinates must be finite/u);
    } finally {
      unvalidated.dispose();
      validated.dispose();
    }
  });
});
