import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BoxGeometry,
  DirectionalLight,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
} from "three";
import type { NodeBuilder, NodeFrame } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputeDrivenRegistry } from "../src/compute-driven.js";
import { frameWorkBudget } from "../src/frame-work-budget.js";
import { VirtualShadowNode } from "../src/render/virtual-shadow.js";
import type { IRendererLike } from "../src/renderer.js";
import { type IWorldPackage, TerrainTiles, WorldCells } from "../src/world.js";

/**
 * One admission budget per frame, and the ceiling it holds.
 *
 * The proof is the ceiling itself, so the clock is injected rather than hoped for: with a clock that
 * advances a fixed amount per reading, "one unit costs exactly this much" is an exact number instead
 * of a machine-dependent one, and every frame's spend can be compared against `budget + one unit`
 * without a tolerance. The tests that matter then re-run the same world on the real clock, so what is
 * being paced is real work and not bookkeeping the budget invented.
 */

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "world-v1");
const manifest = JSON.parse(
  readFileSync(path.join(fixture, "world.json"), "utf8"),
) as IWorldPackage;

const CELL_SIZE = manifest.cellSize;
const MIN_X = manifest.extent.minX;
const MIN_Z = manifest.extent.minZ;
const surface = new MeshBasicMaterial();
const budgets = { bytes: 1_000_000_000, instances: 1_000_000, residentCells: 64 };
/** What one unit of admission work costs on the injected clock: `admit` reads it twice per unit. */
const UNIT_MS = 1;

interface IResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: Headers;
  arrayBuffer: () => Promise<ArrayBuffer>;
  json: () => Promise<unknown>;
}

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
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(0),
        json: async () => ({}),
      };
    }),
  );
}

function model(): Object3D {
  const group = new Group();
  group.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
  return group;
}

function cellKey(x: number, z: number): string {
  return `${String(x)}:${String(z)}`;
}

function cellCenter(x: number, z: number): { x: number; z: number } {
  return { x: MIN_X + (x + 0.5) * CELL_SIZE, z: MIN_Z + (z + 0.5) * CELL_SIZE };
}

function followAt(x: number, z: number): { position: { x: number; z: number } } {
  return { position: { x, z } };
}

/** The `TerrainTiles` a `WorldCells` composed, so its residency is observable from the outside. */
function terrainOf(world: WorldCells): TerrainTiles {
  const terrain = world.children.find((child) => child instanceof TerrainTiles);
  if (terrain === undefined) throw new Error("WorldCells composed no TerrainTiles.");
  return terrain;
}

/**
 * The shared mesh an asset's level draws through; every resident cell has a segment in it. One per
 * key for the main pass (PRD-458); the shadow-caster clusters beside it are one per world-grid
 * square and are not this lookup's business.
 */
function batchOf(world: WorldCells, _cell: string, asset: string, level: number): InstancedMesh {
  const key = `${asset}:${String(level)}:0`;
  const meshes: InstancedMesh[] = [];
  world.traverse((object: Object3D) => {
    if (object instanceof InstancedMesh && object.name === key) meshes.push(object);
  });
  const mesh = meshes[0];
  if (mesh === undefined) throw new Error(`No batch mesh named '${key}'.`);
  return mesh;
}

async function flush(rounds = 12): Promise<void> {
  for (let round = 0; round < rounds; round += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Let the loads land, then step once.
 *
 * Adopting a loaded model queues the resident cells' batches rather than building them inside the
 * promise, and `stats()` is read at the end of an `update`, so a test that has just awaited the
 * loads needs a step before the queue it left behind is visible in the report.
 */
async function step(cells: WorldCells): Promise<void> {
  await flush();
  cells.update();
}

interface IWorldUnderTest {
  readonly world: WorldCells;
  readonly follow: { position: { x: number; z: number } };
}

/**
 * A world over the committed package, at `ring` cells around cell (1, 1).
 *
 * `admissionNow` advances the clock by `UNIT_MS` per reading, which prices one unit of admission
 * work at exactly `UNIT_MS` — the deliberately slow unit the ceiling is measured against.
 */
async function makeWorld(options: {
  readonly admissionBudgetMs: number;
  readonly priced?: boolean;
  readonly prefetchSeconds?: number;
  readonly frameWorkBudgetMs?: number | false;
  readonly terrain?: { streamRadius: number; tileResolution: number; tileSize: number };
  readonly ring?: number;
}): Promise<IWorldUnderTest> {
  stubFixtureFetch();
  const follow = followAt(cellCenter(1, 1).x, cellCenter(1, 1).z);
  let elapsed = 0;
  const world = await WorldCells.load({
    admissionBudgetMs: options.admissionBudgetMs,
    ...(options.frameWorkBudgetMs === undefined
      ? {}
      : { frameWorkBudgetMs: options.frameWorkBudgetMs }),
    // The fresh-mesh allowance is its own ceiling; these tests measure the time budget, so an
    // unbounded world is unbounded in both.
    ...(options.admissionBudgetMs === Number.POSITIVE_INFINITY
      ? { freshMeshesPerUpdate: Number.MAX_SAFE_INTEGER }
      : {}),
    budgets,
    follow,
    ...(options.prefetchSeconds === undefined ? {} : { prefetchSeconds: options.prefetchSeconds }),
    ...(options.terrain === undefined ? {} : { terrain: options.terrain }),
    loadModel: async () => model(),
    ring: options.ring ?? 1,
    surface,
    url: "/world/world.json",
    ...(options.priced === true
      ? {
          admissionNow: () => {
            elapsed += UNIT_MS;
            return elapsed;
          },
        }
      : {}),
  });
  return { follow, world };
}

/** Update until nothing is queued, returning every frame's admission spend. */
function drain(world: WorldCells, limit = 4000): number[] {
  const spent: number[] = [];
  for (let frame = 0; frame < limit; frame += 1) {
    world.update();
    const { backlog, deferred, spentMs } = world.stats().admission;
    spent.push(spentMs);
    // Deferred terrain work counts as owed: a tile the budget refused is wanted again next pass,
    // and one pass is forced past the budget, so the ring closes a frame after the queue empties.
    if (backlog === 0 && deferred === 0) return spent;
  }
  throw new Error(`WorldCells still owed ${String(world.stats().admission.backlog)} units.`);
}

/** Instances a shared mesh draws: free segment slots are zero matrices and draw nothing. */
function live(mesh: InstancedMesh): number {
  const array = mesh.instanceMatrix.array as Float32Array;
  let count = 0;
  for (let index = 0; index < mesh.count; index += 1) if (array[index * 16 + 15] !== 0) count += 1;
  return count;
}

/**
 * Every batch mesh the world drew, keyed by `asset:level:part` with the drawn-instance total across
 * the world-grid clusters that key is split into (PRD-458).
 */
function drawn(world: WorldCells): Map<string, number> {
  const meshes = new Map<string, number>();
  world.traverse((object: Object3D) => {
    if (object instanceof InstancedMesh) {
      const key = object.name.split("@")[0] ?? object.name;
      meshes.set(key, (meshes.get(key) ?? 0) + live(object));
    }
  });
  return meshes;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WorldCells admission budget", () => {
  it("postpones streaming in a shadow frame, bounds deferral and settles identically", async () => {
    const terrainOptions = { streamRadius: 2, tileResolution: 17, tileSize: 32 };
    const candidate = await makeWorld({
      admissionBudgetMs: 1,
      prefetchSeconds: 0,
      priced: true,
      terrain: terrainOptions,
    });
    const reference = await makeWorld({
      admissionBudgetMs: Number.POSITIVE_INFINITY,
      prefetchSeconds: 0,
      frameWorkBudgetMs: false,
      terrain: terrainOptions,
    });
    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
    const raw = { shadowMap: { enabled: true } };
    const renderer = { raw, compileAsync: async () => undefined } as unknown as IRendererLike;
    const light = new DirectionalLight();
    light.position.set(0, 100, 0);
    light.castShadow = true;
    scene.add(candidate.world, light, light.target, camera);
    const node = new VirtualShadowNode(light, {
      clipExtents: [24],
      invalidationDelay: 0,
      marker: false,
    });
    node.setup({ context: {}, material: {}, renderer: raw } as unknown as NodeBuilder);
    let elapsed = 0;
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    for (const level of node.levelNodes) {
      (level as unknown as { updateShadow: () => void }).updateShadow = () => {
        elapsed += 3;
      };
    }
    const registry = new ComputeDrivenRegistry();
    registry.add(candidate.world, renderer);
    const terrain = terrainOf(candidate.world);
    const follow = vi.spyOn(terrain, "follow");
    const process = vi.spyOn(terrain, "process");
    const afterRender = () => registry.processAfterRender(renderer, camera);
    const frame = (shadow: boolean) => {
      elapsed += 8;
      registry.processRender(renderer, camera);
      if (shadow) {
        node.invalidateAll();
        node.updateBefore({ camera, renderer: raw, time: elapsed / 1000 } as unknown as NodeFrame);
      }
      afterRender();
    };
    try {
      frame(true);
      expect(node.stats.rendered).toBe(1);
      expect(frameWorkBudget(renderer)?.spentMs).toBe(3);
      expect(follow).not.toHaveBeenCalled();
      expect(process).not.toHaveBeenCalled();
      expect(candidate.world.stats().instances).toBe(0);
      frame(true);
      expect(follow).not.toHaveBeenCalled();
      frame(true);
      expect(follow).toHaveBeenCalledTimes(1);
      await flush();
      let queuedFrameChecked = false;
      for (let i = 0; i < 600; i += 1) {
        const backlog = candidate.world.stats().admission.backlog;
        follow.mockClear();
        process.mockClear();
        frame(true);
        reference.world.update(undefined, camera);
        if (
          !queuedFrameChecked &&
          backlog > 0 &&
          follow.mock.calls.length === 0 &&
          candidate.world.stats().admission.spentMs === 0
        ) {
          expect(candidate.world.stats().admission.backlog).toBe(backlog);
          expect(process).not.toHaveBeenCalled();
          queuedFrameChecked = true;
        }
        await flush(1);
        if (
          candidate.world.stats().admission.backlog === 0 &&
          candidate.world.stats().admission.deferred === 0 &&
          candidate.world.stats().loadsInFlight === 0 &&
          candidate.world.stats().loadsQueued === 0 &&
          terrain.deferredAdmissions === 0 &&
          terrain.blendingTiles === 0 &&
          queuedFrameChecked
        )
          break;
      }
      // The last admitted records reach their render-camera cull on the next draw.
      frame(true);
      reference.world.update(undefined, camera);
      expect(queuedFrameChecked).toBe(true);
      expect(terrain.terrainTiles.rebuilds).toBeGreaterThan(0);
      expect(candidate.world.stats().admission.backlog).toBe(0);
      expect(candidate.world.stats().instances).toBeGreaterThan(0);
      expect(candidate.world.stats().failures).toBe(0);
      expect(candidate.world.stats().instances).toBe(reference.world.stats().instances);
      expect(drawn(candidate.world)).toEqual(drawn(reference.world));
      const matrices = (world: WorldCells) => {
        const records: number[][] = [];
        world.traverse((object) => {
          if (object instanceof InstancedMesh && !object.name.includes("@")) {
            for (let i = 0; i < object.count; i += 1) {
              const matrix = Array.from(object.instanceMatrix.array.slice(i * 16, (i + 1) * 16));
              if (matrix[15] !== 0) records.push(matrix);
            }
          }
        });
        return records.sort((a, b) => a.join(",").localeCompare(b.join(",")));
      };
      expect(matrices(candidate.world)).toEqual(matrices(reference.world));
      expect(terrain.residentKeys).toEqual(terrainOf(reference.world).residentKeys);
      expect(terrain.lodTransitions).toBe(terrainOf(reference.world).lodTransitions);
      const positions = (tiles: TerrainTiles) =>
        tiles.residentKeys.map((key) => {
          const tile = tiles.getTile(key);
          if (tile === undefined) throw new Error(`Missing tile ${key}`);
          return {
            key,
            lod: tile.lodLevel,
            levels: tile.lod.levels.map(({ object }) => [
              ...(object as Mesh).geometry.getAttribute("position").array,
            ]),
          };
        });
      expect(positions(terrain)).toEqual(positions(terrainOf(reference.world)));
      const before = candidate.world.stats().rebuilds;
      frame(false);
      expect(candidate.world.stats().rebuilds).toBe(before);
      expect(terrain.terrainTiles).toEqual(terrainOf(reference.world).terrainTiles);
      candidate.follow.position.x += 16;
      reference.follow.position.x += 16;
      candidate.world.update(undefined, camera);
      reference.world.update(undefined, camera);
      expect(terrain.blendingTiles).toBeGreaterThan(0);
      const blending = positions(terrain);
      const epoch = terrain.debug().ringEpoch;
      const blocks = terrain.terrainTiles.rebuilds;
      const backlog = candidate.world.stats().admission.backlog;
      follow.mockClear();
      process.mockClear();
      frame(true);
      expect(follow).not.toHaveBeenCalled();
      expect(process).not.toHaveBeenCalled();
      expect(positions(terrain)).toEqual(blending);
      expect(terrain.debug().ringEpoch).toBe(epoch);
      expect(terrain.terrainTiles.rebuilds).toBe(blocks);
      expect(candidate.world.stats().admission.backlog).toBe(backlog);
      for (let i = 0; i < 300; i += 1) {
        frame(true);
        reference.world.update(undefined, camera);
        await flush(1);
      }
      expect(terrain.blendingTiles).toBe(0);
      expect(terrain.deferredAdmissions).toBe(0);
      expect(candidate.world.stats().admission.backlog).toBe(0);
      expect(positions(terrain)).toEqual(positions(terrainOf(reference.world)));
      expect(matrices(candidate.world)).toEqual(matrices(reference.world));
    } finally {
      node.dispose();
      registry.clear();
      reference.world.dispose();
    }
  });

  it("spends at most the budget plus one unit per update, however long the backlog", async () => {
    const BUDGET_MS = 2;
    const { world: cells } = await makeWorld({ admissionBudgetMs: BUDGET_MS, priced: true });
    cells.update();
    await step(cells);

    // A unit is priced at 1 ms and a frame may start any unit while the budget is not yet spent, so
    // the worst a frame can do is two whole units plus the third: budget + one unit, exactly.
    const spent = drain(cells);
    expect(spent.length).toBeGreaterThan(2);
    for (const frame of spent) expect(frame).toBeLessThanOrEqual(BUDGET_MS + UNIT_MS);
    // Nothing is owed, and the frame that finished the ring spent what was left of the budget
    // rather than a whole one: the forced tile is one unit, and the rest of the pass had none.
    expect(cells.stats().admission).toMatchObject({ backlog: 0, deferred: 0 });
    expect(cells.stats().admission.spentMs).toBeLessThanOrEqual(BUDGET_MS);
    expect(cells.stats().failures).toBe(0);
    cells.dispose();
  });

  it("keeps building props while the terrain catches up after a jump", async () => {
    // Terrain admits first and every tile is a unit; with the whole allowance its own, a jump left
    // the prop queue nothing for as long as the ground took to follow — on the 2 km map, seconds of
    // a review camera looking at an empty forest.
    const { follow, world: cells } = await makeWorld({ admissionBudgetMs: 2, priced: true });
    cells.update();
    await step(cells);
    drain(cells);
    const far = cellCenter(3, 3);
    follow.position.x = far.x;
    follow.position.z = far.z;
    let shared = 0;
    let previous = cells.stats().admission.backlog;
    for (let frame = 0; frame < 400; frame += 1) {
      cells.update();
      await flush(1);
      const { backlog, deferred } = cells.stats().admission;
      // A frame where terrain still owed tiles and the prop queue still finished work of its own.
      if (terrainOf(cells).deferredAdmissions > 0 && backlog < previous) shared += 1;
      previous = backlog;
      if (backlog === 0 && deferred === 0 && terrainOf(cells).deferredAdmissions === 0) break;
    }
    expect(shared).toBeGreaterThan(0);
    expect(cells.stats().failures).toBe(0);
    cells.dispose();
  });

  it("admits the cells around a jumped camera when the ring it left filled the cell budget", async () => {
    // Residency keeps one ring of hysteresis, so after a jump those cells sat in a full budget and
    // the cells the camera now needed were refused (pressure) until it moved again.
    async function jump(to: readonly [number, number]): Promise<number> {
      stubFixtureFetch();
      const follow = followAt(cellCenter(0, 0).x, cellCenter(0, 0).z);
      const cells = await WorldCells.load({
        admissionBudgetMs: Number.POSITIVE_INFINITY,
        budgets: { ...budgets, residentCells: 4 },
        follow,
        loadModel: async () => model(),
        prefetchSeconds: 0,
        ring: 1,
        surface,
        url: "/world/world.json",
      });
      cells.update();
      await step(cells);
      expect(cells.stats().residentCells).toBe(4);
      const before = cells.stats().pressure.cells;
      const at = cellCenter(to[0], to[1]);
      follow.position.x = at.x;
      follow.position.z = at.z;
      await step(cells);
      expect(cells.stats().residentCells).toBe(4);
      expect(cells.stats().failures).toBe(0);
      const refused = cells.stats().pressure.cells - before;
      cells.dispose();
      return refused;
    }
    // A two-cell jump to (2, 2) wants nine cells over a budget of four: the four the corner held are
    // all within the hysteresis ring, so without the yield all eight new ones are refused; with it
    // three of the four the corner held give way and only five are.
    expect(await jump([2, 2])).toBe(5);
    // A one-cell step is not a jump: the hysteresis holds, as a walk needs it to.
    expect(await jump([1, 1])).toBe(5);
  });

  it("reports the deferred work and the backlog while it waits, and empties both", async () => {
    const { world: cells } = await makeWorld({ admissionBudgetMs: 2, priced: true });
    cells.update();
    await step(cells);

    // The adopted models queued every resident cell's batches, and one frame of two units cannot
    // hold them, so the report is not zero while the work is outstanding.
    expect(cells.stats().admission.deferred).toBeGreaterThan(0);
    expect(cells.stats().admission.backlog).toBeGreaterThan(0);

    drain(cells);
    expect(cells.stats().admission.deferred).toBe(0);
    expect(cells.stats().admission.backlog).toBe(0);
    cells.dispose();
  });

  it("draws what an unbounded build draws, once the backlog has drained", async () => {
    const bounded = await makeWorld({ admissionBudgetMs: 2, priced: true });
    bounded.world.update();
    await flush();
    drain(bounded.world);

    const unbounded = await makeWorld({ admissionBudgetMs: Number.POSITIVE_INFINITY });
    unbounded.world.update();
    await flush();
    // One mesh per world-grid cluster per key (PRD-458), and two fresh meshes an update, so an
    // unbounded ring still needs as many updates as it has clusters to mint. What this compares is
    // the answer, not how many frames it took.
    for (let frame = 0; frame < 200; frame += 1) {
      unbounded.world.update();
      await flush(1);
      if (unbounded.world.stats().admission.deferred === 0) break;
    }

    // Nothing dropped, nothing doubled: the same meshes, with the same instances, however many
    // frames it took to admit them.
    expect(drawn(bounded.world)).toEqual(drawn(unbounded.world));
    expect(drawn(bounded.world).size).toBeGreaterThan(0);
    expect(bounded.world.stats().residentCells).toBe(unbounded.world.stats().residentCells);
    bounded.world.dispose();
    unbounded.world.dispose();
  });

  it("admits terrain tiles and colliders on the same budget, and still converges", async () => {
    // 50 µs a frame is a budget no 129-resolution tile with three LOD levels fits inside, so the
    // ground arrives over several frames instead of all in the first one.
    const { world: cells } = await makeWorld({ admissionBudgetMs: 0.05 });
    const terrain = terrainOf(cells);
    cells.update();
    const first = terrain.residentTileCount;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(9);

    for (let frame = first; frame < 9; frame += 1) cells.update();
    expect(terrain.residentTileCount).toBe(9);
    expect(cells.stats().failures).toBe(0);
    cells.dispose();
  });

  it("keeps a refiltered cell drawing what it had until the replacement is ready", async () => {
    // One unit per frame: the follow point crosses `pine`'s level switch, the refilter is queued, and
    // the cell keeps drawing the lod the placements were built at until every mesh of the
    // replacement exists.
    const { follow, world: cells } = await makeWorld({
      admissionBudgetMs: 1,
      priced: true,
      ring: 0,
    });
    // From the cell's own corner the far half of its placements are past `pine`'s 60 m switch, so
    // the cell has a lod batch to keep drawing.
    follow.position.x = -CELL_SIZE;
    follow.position.z = -CELL_SIZE;
    cells.update();
    await step(cells);
    drain(cells);
    const far = batchOf(cells, cellKey(1, 1), "pine", 1);
    const farDrawn = live(far);
    expect(farDrawn).toBeGreaterThan(0);
    expect(far.parent).toBe(cells);

    // The cell centre is 45 m from where the batch was built — past the eighth of the 60 m switch a
    // refilter waits for — so every placement in it changes level.
    const center = cellCenter(1, 1);
    follow.position.x = center.x;
    follow.position.z = center.z;
    cells.update();
    // The move queued refilters; it did not perform them.
    expect(cells.stats().rebuilds).toBeGreaterThan(0);
    expect(cells.stats().admission.deferred).toBeGreaterThan(0);

    // Mid-refilter the outgoing lod is still the one attached, and it is the only one: the
    // replacement is never half-swapped in beside it.
    expect(batchOf(cells, cellKey(1, 1), "pine", 1)).toBe(far);
    expect(drawn(cells).get("pine:1:0")).toBe(farDrawn);

    drain(cells);
    expect(drawn(cells).get("pine:1:0") ?? 0).toBe(0);
    const near = batchOf(cells, cellKey(1, 1), "pine", 0);
    expect(live(near)).toBe(85);
    expect(cells.stats().failures).toBe(0);
    cells.dispose();
  });

  it("drops the queued work of a cell that left, instead of resuming it into a dead graph", async () => {
    const { follow, world: cells } = await makeWorld({
      admissionBudgetMs: 1,
      priced: true,
      ring: 0,
    });
    cells.update();
    await step(cells);
    expect(cells.stats().admission.deferred).toBeGreaterThan(0);

    // Far outside the hysteresis ring: the cell is evicted with its backlog, and the budget is not
    // spent on batches nothing will draw.
    follow.position.x = 100_000;
    follow.position.z = 100_000;
    cells.update();
    expect(cells.stats().residentKeys).toEqual([]);
    expect(cells.stats().admission.deferred).toBe(0);
    expect(cells.stats().admission.backlog).toBe(0);
    expect(drawn(cells).size).toBe(0);
    expect(cells.stats().failures).toBe(0);
    cells.dispose();
  });

  it("refuses a budget that would never admit anything", async () => {
    stubFixtureFetch();
    const follow = followAt(0, 0);
    await expect(
      WorldCells.load({
        admissionBudgetMs: 0,
        budgets,
        follow,
        loadModel: async () => model(),
        ring: 1,
        surface,
        url: "/world/world.json",
      }),
    ).rejects.toThrow(/admissionBudgetMs/u);
    await expect(
      WorldCells.load({
        admissionBudgetMs: Number.NaN,
        budgets,
        follow,
        loadModel: async () => model(),
        ring: 1,
        surface,
        url: "/world/world.json",
      }),
    ).rejects.toThrow(/admissionBudgetMs/u);
  });
});
