import {
  type BufferGeometry,
  Group,
  type InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
} from "three";
import { type IAssetLoader, createAssetLoader } from "./assets.js";
import type { IComputeDriven } from "./compute-driven.js";
import { InstancedBatch } from "./instanced-batch.js";
import type { IRendererLike } from "./renderer.js";
import { DEFAULT_CONCURRENCY, addInSlices, loadAll } from "./streaming.js";
import { heightSamplerFromHeightmap, loadWorldHeightmap } from "./world-heightmap.js";
import {
  type IWorldAsset,
  type IWorldCell,
  type IWorldPackage,
  type IWorldRun,
  cellPlacements,
  validateWorldPackage,
} from "./world-package.js";
import { type IWorldTilesOptions, TerrainTileBudgetError, TerrainTiles } from "./world-tiles.js";

const PLACEMENT_RECORD_BYTES = 32;
const PLACEMENT_RECORD_FLOATS = 8;
const DEFAULT_TILE_RESOLUTION = 129;
const CHUNK_NAME = "world-chunk";

/** The point a streamed world follows; an `Object3D` satisfies this shape. */
export interface IWorldCellsFollow {
  readonly position: { readonly x: number; readonly z: number };
}

/** Hard caps on what stays resident. A cap that is reached reports pressure, it never throws. */
export interface IWorldCellsBudget {
  readonly residentCells: number;
  readonly instances: number;
  /** Placement-record bytes (`32` per instance) the resident cells are allowed to weigh. */
  readonly bytes: number;
}

/** Terrain options forwarded to the composed `TerrainTiles`; `tileSize` defaults to `cellSize`. */
export interface IWorldCellsTerrainOptions {
  readonly tileSize?: number;
  readonly tileResolution?: number;
  readonly lodFactors?: readonly number[];
  readonly lodDistances?: readonly number[];
  readonly skirtDepth?: number;
}

export interface IWorldCellsLoadOptions {
  /**
   * Logical path of `world.json` (`world/world.json`); every other path in the package resolves
   * against it. A leading `/` is accepted and stripped, so an uncompiled `public/world` keeps
   * working.
   */
  readonly url: string;
  /**
   * Loader the package's paths resolve through — its manifest, or the authored names when there is
   * none. Defaults to a fresh `createAssetLoader()`; inside a game, pass `ctx.assets` so the
   * package's compiled output and compressed textures reach the renderer the game booted with.
   */
  readonly assets?: IAssetLoader;
  /** Game-owned terrain surface, handed straight to `TerrainTiles`. */
  readonly surface: IWorldTilesOptions["surface"];
  /** Passed straight to `TerrainTiles` for per-tile colliders. */
  readonly createCollider?: IWorldTilesOptions["createCollider"];
  /** Read once per update; an `Object3D` works. */
  readonly follow: IWorldCellsFollow;
  /** Chebyshev radius in cells to keep resident; a cell leaves only beyond `ring + 1`. */
  readonly ring: number;
  readonly budgets: IWorldCellsBudget;
  readonly terrain?: IWorldCellsTerrainOptions;
  /**
   * `(url) => Promise<Object3D>`, overriding `assets.model`; a raw `GLTFLoader` or a game's own
   * loader works. The url is the authored one, so a compiled package wants `assets` instead.
   */
  readonly loadModel?: (url: string) => Promise<Object3D>;
  /**
   * Model loads in flight at once, assets and chunks together. Defaults to `loadAll`'s
   * `concurrency`, six.
   */
  readonly concurrency?: number;
  /**
   * Cell-asset batches refiltered per `update`, nearest cell first. Defaults to 16. A cell that did
   * not get its turn keeps drawing the batches it has until a later update replaces them.
   */
  readonly rebuildsPerUpdate?: number;
}

export interface IWorldCellsStats {
  readonly residentCells: number;
  readonly residentKeys: readonly string[];
  /** Placement instances the resident cells hold, before any `maxDistance` filter. */
  readonly instances: number;
  readonly loadsInFlight: number;
  /** Model loads waiting for a free lane; served nearest-cell first, in admission order. */
  readonly loadsQueued: number;
  readonly evictions: number;
  /** Cumulative `maxDistance`/`lods` refilters performed, across every update. */
  readonly rebuilds: number;
  readonly failures: number;
  /** Cumulative rejected requests: cells skipped, instances or bytes refused, terrain retries. */
  readonly pressure: { readonly cells: number; readonly instances: number; readonly bytes: number };
}

interface ICellBatch {
  readonly asset: string;
  readonly batch: InstancedBatch;
  /** How far the follow point has to move before this batch is refiltered, `undefined` never. */
  readonly threshold: number | undefined;
  mesh: InstancedMesh | undefined;
  lastFilterX: number;
  lastFilterZ: number;
}

interface IResidentCell {
  readonly key: string;
  readonly x: number;
  readonly z: number;
  readonly cell: IWorldCell;
  readonly generation: number;
  readonly instances: number;
  readonly bytes: number;
  readonly batches: ICellBatch[];
  readonly chunks: Object3D[];
}

/** One level's drawable shape, read out of the level's own GLB. */
interface IAssetLevel {
  readonly geometry: BufferGeometry;
  readonly material: Material;
}

interface IAssetState {
  readonly id: string;
  readonly definition: IWorldAsset;
  /** The distance at which each level takes over, index-aligned with `glbs`; level 0 never does. */
  readonly distances: readonly number[];
  /** The package-relative GLB per level, index-aligned with `distances`. */
  readonly glbs: readonly string[];
  /** Every distance the level or cull answer changes at, `threshold` being the nearest. */
  readonly gates: readonly number[];
  /** The nearest distance this asset's batching can be crossed at, or `undefined` when it cannot. */
  readonly threshold: number | undefined;
  refcount: number;
  pending: boolean;
  disposed: boolean;
  /**
   * One level per entry in `glbs`, so a level that failed to load reuses the level below it and the
   * batch builder never has to know a level is missing.
   */
  levels: readonly IAssetLevel[];
}

interface IWorldCellsInit extends IWorldCellsLoadOptions {
  readonly manifest: IWorldPackage;
  readonly placements: ArrayBuffer;
  readonly heightmap: Uint16Array;
  readonly baseUrl: string;
  /** `baseUrl` as the loader keys it: no leading slash, which is what a manifest lists. */
  readonly logicalBase: string;
}

/** GPU resources already handed to a `dispose`, so no second path can tear the same one down. */
const tornDown = new WeakSet<object>();

/**
 * Release one GPU resource: at most once per resource, and never by throwing.
 *
 * Exactly once is the streaming contract: an asset's geometry is shared by every cell batch drawn
 * from it, so several residency paths can reach the same object, and a second teardown is the
 * renderer's problem, not the game's.
 *
 * Never throwing is the other half. Three disposes a geometry by deleting each of its attributes,
 * and `WebGPUAttributeUtils.destroyAttribute` reads the GPU buffer off the attribute and calls
 * `destroy` on it with no guard — so disposing a geometry whose upload never produced that buffer
 * throws `TypeError: Cannot read properties of undefined (reading 'destroy')` from wherever the
 * teardown was called. A cell leaving range is the most ordinary thing a streaming world does, so
 * that has to land as a counted failure here, not as a dead frame.
 *
 * @returns `true` when the teardown itself threw, for the caller to count.
 */
function release(target: { dispose: () => void } | undefined): boolean {
  if (target === undefined || tornDown.has(target)) return false;
  tornDown.add(target);
  try {
    target.dispose();
  } catch {
    return true;
  }
  return false;
}

async function loadModelWith(assets: IAssetLoader, path: string): Promise<Object3D> {
  const gltf = await assets.model<{ scene?: Object3D }>(path);
  const scene = gltf?.scene;
  if (!(scene instanceof Object3D))
    throw new Error(`World asset '${path}' loaded without an Object3D scene.`);
  return scene;
}

function resolveRelative(baseUrl: string, relative: string): string {
  if (/^(?:[a-z]+:)?\/\//iu.test(relative) || relative.startsWith("data:")) return relative;
  return `${baseUrl}${relative.replace(/^\//u, "")}`;
}

/**
 * Load a package file from the first candidate the loader says might serve it, the way the
 * loader's own `loadFirst` walks them: the authored name, then the project's `assets/` source. One
 * candidate is what a manifest gives, and a delete-test project has no manifest, so taking only
 * the first is a 404 for a package that is present on disk. When none answer, one error names every
 * url tried and its status — the failure is two places looked at, not one missing file.
 */
async function loadLogical<T>(
  assets: IAssetLoader,
  path: string,
  load: (url: string) => Promise<T>,
): Promise<T> {
  const candidates = await assets.resolve(path);
  const failures: string[] = [];
  for (const url of candidates) {
    try {
      return await load(url);
    } catch (error) {
      failures.push(`${url} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  throw new Error(
    `World file '${path}' could not be loaded from ${String(candidates.length)} candidate url(s): ${failures.join("; ")}`,
  );
}

/** A `fetch` that refuses anything but an ok response, so candidates are walked on status. */
async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`status ${String(response.status)}`);
  return response;
}

function firstRenderable(
  model: Object3D,
): { geometry: BufferGeometry; material: Material } | undefined {
  let found: { geometry: BufferGeometry; material: Material } | undefined;
  model.traverse((object: Object3D) => {
    if (found !== undefined || !(object instanceof Mesh)) return;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    if (object.geometry !== undefined && material !== undefined)
      found = { geometry: object.geometry, material };
  });
  return found;
}

function disposeModel(model: Object3D): number {
  let failed = 0;
  model.traverse((object: Object3D) => {
    if (!(object instanceof Mesh)) return;
    if (release(object.geometry)) failed += 1;
    const materials: Material[] = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) if (release(material)) failed += 1;
  });
  return failed;
}

function disposeModels(models: readonly (Object3D | undefined)[]): number {
  let failed = 0;
  for (const model of models) if (model !== undefined) failed += disposeModel(model);
  return failed;
}

/**
 * The distance a `maxDistance` prop actually culls at, one eighth short of itself: the slack
 * `#buildBatch` leaves, so a follow point that has not moved a whole eighth of the cull distance
 * cannot have culled a placement it had not already culled.
 */
function cullDistance(maxDistance: number | undefined): number | undefined {
  return maxDistance === undefined ? undefined : maxDistance - maxDistance / 8;
}

/**
 * The levels one asset is drawn at, and the distances its batching can be crossed at.
 *
 * Level 0 is the asset's own `glb` and never switches; `lods[i - 1].distance` is where an instance
 * that far out draws `lods[i]` instead. A `lods` entry at or beyond the cull distance is dropped:
 * an instance that far out is culled, so its shape can never be drawn. `gates` is every distance
 * the level or cull answer changes at — `threshold` is the nearest of them, so a follow point that
 * has moved an eighth of it may have moved an instance either way.
 */
function assetLevels(definition: IWorldAsset): {
  readonly distances: readonly number[];
  readonly gates: readonly number[];
  readonly glbs: readonly string[];
  readonly threshold: number | undefined;
} {
  const maxDistance = definition.maxDistance;
  const distances: number[] = [0];
  const glbs: string[] = [definition.glb];
  const gates: number[] = [];
  for (const lod of definition.lods ?? []) {
    // A level at or beyond the cull distance is never drawn: an instance that far out is gone by
    // the time the level would take over, so its GLB is never asked for.
    if (maxDistance !== undefined && lod.distance >= maxDistance) continue;
    distances.push(lod.distance);
    glbs.push(lod.glb);
    gates.push(lod.distance);
  }
  const cull = cullDistance(maxDistance);
  if (cull !== undefined) gates.push(cull);
  return {
    distances,
    gates,
    glbs,
    threshold: gates.length === 0 ? undefined : Math.min(...gates),
  };
}

/** The level a placement `distance` out from the follow point draws with. */
function levelAt(distances: readonly number[], distance: number): number {
  let level = 0;
  for (let index = 1; index < distances.length; index += 1)
    if (distance > (distances[index] as number)) level = index;
  return level;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`WorldCells ${name} must be a positive integer.`);
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`WorldCells ${name} must be a non-negative integer.`);
  return value;
}

function cellKey(x: number, z: number): string {
  return `${String(x)}:${String(z)}`;
}

interface IQueuedModelLoad {
  readonly run: () => Promise<Object3D>;
  readonly wanted: () => boolean;
  readonly resolve: (model: Object3D | undefined) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * One bounded lane for every model load a `WorldCells` starts. Assets and chunks share it, so the
 * number of `loadModel` calls in flight at once cannot grow with the number of admitted cells.
 * Queued loads keep admission order, which is nearest-cell first, and one whose cell left (or
 * whose asset was released) before its turn resolves `undefined` without touching the loader.
 */
class ModelLoadLimiter {
  readonly #concurrency: number;
  readonly #queue: IQueuedModelLoad[] = [];
  #inFlight = 0;

  constructor(concurrency: number) {
    this.#concurrency = concurrency;
  }

  get inFlight(): number {
    return this.#inFlight;
  }

  get queued(): number {
    return this.#queue.length;
  }

  load(run: () => Promise<Object3D>, wanted: () => boolean): Promise<Object3D | undefined> {
    return new Promise((resolve, reject) => {
      this.#queue.push({ reject, resolve, run, wanted });
      this.#pump();
    });
  }

  #pump(): void {
    while (this.#inFlight < this.#concurrency && this.#queue.length > 0) {
      const job = this.#queue.shift() as IQueuedModelLoad;
      if (!job.wanted()) {
        job.resolve(undefined);
        continue;
      }
      this.#inFlight += 1;
      try {
        job.run().then(
          (model) => {
            this.#inFlight -= 1;
            job.resolve(model);
            this.#pump();
          },
          (error: unknown) => {
            this.#inFlight -= 1;
            job.reject(error);
            this.#pump();
          },
        );
      } catch (error) {
        // A loader that throws instead of rejecting must not strand its lane.
        this.#inFlight -= 1;
        job.reject(error);
        this.#pump();
      }
    }
  }
}

/**
 * Stream a Blender-authored world package by cell and keep it resident around a followed point.
 *
 * The class composes `TerrainTiles` for the package's heightmap, builds one `InstancedBatch` per
 * resident cell asset run and distance level, and loads hand-placed chunk GLBs through `loadAll` +
 * `addInSlices`. Ring residency, per-asset `maxDistance` filtering, the per-asset `lods` levels,
 * hard budgets and generation-tokened cancellation all live here; every geometry, material and
 * surface still comes from the package's GLBs and the game.
 *
 * @situation stream a large Blender-authored world by cell instead of one huge GLB
 * @situation keep scattered props and hand-placed chunks resident around a moving player
 * @situation honour per-asset draw distances and hard streaming budgets without a mid-frame throw
 * @constraint surface is the game's; this class creates no material, colour or geometry
 * @constraint budgets are hard caps that report pressure instead of over-committing
 * @constraint model loads are bounded by `concurrency` (default `loadAll`'s six) across every resident cell, not per cell
 * @constraint refilters are bounded by `rebuildsPerUpdate` (default 16) per update, nearest cell first
 * @override ring, budgets, terrain tile size/resolution, load `concurrency`, `rebuildsPerUpdate` and the package's per-asset maxDistance
 * @example
 * const world = await WorldCells.load({ url: "/world/world.json", surface, follow, ring: 1, budgets: { residentCells: 25, instances: 20000, bytes: 8000000 } });
 * scene.add(world);
 * world.update();
 */
export class WorldCells extends Group implements IComputeDriven {
  readonly processCadence = "render" as const;
  readonly #budgets: IWorldCellsBudget;
  readonly #cells: readonly IWorldCell[];
  readonly #cellSize: number;
  readonly #follow: IWorldCellsFollow;
  readonly #loader: IAssetLoader;
  readonly #loadModel: ((url: string) => Promise<Object3D>) | undefined;
  readonly #limiter: ModelLoadLimiter;
  readonly #manifest: IWorldPackage;
  readonly #minX: number;
  readonly #minZ: number;
  readonly #placements: ArrayBuffer;
  readonly #rebuildsPerUpdate: number;
  readonly #ring: number;
  readonly #terrain: TerrainTiles;
  readonly #baseUrl: string;
  readonly #logicalBase: string;
  readonly #assets = new Map<string, IAssetState>();
  readonly #resident = new Map<string, IResidentCell>();
  readonly #position = new Vector3();
  readonly #rotation = new Quaternion();
  readonly #scale = new Vector3();
  readonly #matrix = new Matrix4();
  readonly #pressure = { cells: 0, instances: 0, bytes: 0 };
  #instances = 0;
  #bytes = 0;
  #evictions = 0;
  #failures = 0;
  #rebuilds = 0;
  #generation = 0;
  #released = false;

  private constructor(init: IWorldCellsInit) {
    super();
    this.#budgets = {
      bytes: positiveInteger(init.budgets.bytes, "budgets.bytes"),
      instances: positiveInteger(init.budgets.instances, "budgets.instances"),
      residentCells: positiveInteger(init.budgets.residentCells, "budgets.residentCells"),
    };
    this.#ring = nonNegativeInteger(init.ring, "ring");
    this.#follow = init.follow;
    this.#manifest = init.manifest;
    this.#cells = init.manifest.cells;
    this.#cellSize = init.manifest.cellSize;
    this.#minX = init.manifest.extent.minX;
    this.#minZ = init.manifest.extent.minZ;
    this.#placements = init.placements;
    this.#rebuildsPerUpdate = positiveInteger(init.rebuildsPerUpdate ?? 16, "rebuildsPerUpdate");
    this.#baseUrl = init.baseUrl;
    this.#logicalBase = init.logicalBase;
    this.#loader = init.assets ?? createAssetLoader();
    this.#loadModel = init.loadModel;
    this.#limiter = new ModelLoadLimiter(
      positiveInteger(init.concurrency ?? DEFAULT_CONCURRENCY, "concurrency"),
    );
    const tileCount = (2 * this.#ring + 1) ** 2;
    this.#terrain = new TerrainTiles({
      ...(init.createCollider === undefined ? {} : { createCollider: init.createCollider }),
      ...(init.terrain?.lodDistances === undefined
        ? {}
        : { lodDistances: init.terrain.lodDistances }),
      ...(init.terrain?.lodFactors === undefined ? {} : { lodFactors: init.terrain.lodFactors }),
      ...(init.terrain?.skirtDepth === undefined ? {} : { skirtDepth: init.terrain.skirtDepth }),
      // Sized from the ring: the wanted square fits the tile budget. ponytail: no terrain byte
      // cap (a tile's bytes are deterministic from the ring, and the cells own the memory
      // budget); give `TerrainTiles` its own byte budget when terrain is not ring-bounded. A
      // tile that still cannot fit is caught in `update` and reported as pressure.
      residentByteBudget: Number.MAX_SAFE_INTEGER,
      residentTileBudget: tileCount,
      sampleHeight: heightSamplerFromHeightmap(
        init.manifest.terrain,
        init.manifest.extent,
        init.heightmap,
      ),
      streamRadius: this.#ring,
      surface: init.surface,
      tileResolution: init.terrain?.tileResolution ?? DEFAULT_TILE_RESOLUTION,
      tileSize: init.terrain?.tileSize ?? this.#cellSize,
    });
    this.add(this.#terrain);
  }

  static async load(options: IWorldCellsLoadOptions): Promise<WorldCells> {
    const assets = options.assets ?? createAssetLoader();
    const baseUrl = options.url.slice(0, options.url.lastIndexOf("/") + 1);
    // Logical paths, which is what the loader keys its manifest by: the authored name with no
    // leading slash, and the directory the manifest itself sits in as their base.
    const manifestPath = options.url.replace(/^\//u, "");
    const logicalBase = manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1);
    const manifest = await loadLogical(
      assets,
      manifestPath,
      async (url) => (await (await fetchOk(url)).json()) as IWorldPackage,
    );
    const placements = await loadLogical(
      assets,
      resolveRelative(logicalBase, manifest.placements),
      async (url) => (await fetchOk(url)).arrayBuffer(),
    );
    const heightmap = await loadLogical(
      assets,
      resolveRelative(logicalBase, manifest.terrain.heightmap),
      loadWorldHeightmap,
    );
    const validation = validateWorldPackage(manifest, {
      heightmapByteLength: heightmap.length * 2,
      placementsByteLength: placements.byteLength,
    });
    if (!validation.ok) {
      const codes = new Set<string>();
      const details: string[] = [];
      for (const entry of validation.errors) {
        codes.add(entry.code);
        details.push(`${entry.path} ${entry.message}`);
      }
      const error = new Error(
        `World package '${options.url}' failed validation: ${[...codes].join(", ")}. ${details.join(" ")}`,
      );
      error.name = "WorldPackageValidationError";
      throw error;
    }
    return new WorldCells({
      ...options,
      assets,
      baseUrl,
      heightmap,
      logicalBase,
      manifest,
      placements,
    });
  }

  get released(): boolean {
    return this.#released;
  }

  get warmupNodes(): readonly unknown[] {
    return this.#terrain.warmupNodes;
  }

  /**
   * Per-frame residency step; call it wherever `TerrainTiles.process` is called.
   *
   * Reads the follow target, keeps the in-ring cells, evicts cells beyond the hysteresis ring and
   * refilters the `maxDistance` and `lods` batches the follow point has moved far enough to have
   * changed — at most `rebuildsPerUpdate` of them, the rest left drawing what they have until a later
   * update. A terrain budget throw is caught and counted, and so is a teardown that throws while
   * releasing what left — `failures` in {@link stats} carries both. Every other error, the game's
   * included, escapes.
   */
  update(renderer?: IRendererLike): void {
    if (this.#released) return;
    const x = this.#follow.position.x;
    const z = this.#follow.position.z;
    try {
      this.#terrain.follow({ x, z });
      this.#terrain.process(renderer);
    } catch (error) {
      if (!(error instanceof TerrainTileBudgetError)) throw error;
      this.#pressure.bytes += 1;
    }
    this.#updateResidency(
      {
        x: Math.floor((x - this.#minX) / this.#cellSize),
        z: Math.floor((z - this.#minZ) / this.#cellSize),
      },
      x,
      z,
    );
    this.#updateMaxDistance(x, z);
  }

  process(renderer?: IRendererLike): void {
    this.update(renderer);
  }

  attachRenderer(renderer: IRendererLike): void {
    this.#terrain.attachRenderer(renderer);
  }

  /** Current per-asset reference count; an asset absent from the map is `0`. */
  assetRefCounts(): Readonly<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const [id, asset] of this.#assets) counts[id] = asset.refcount;
    return counts;
  }

  stats(): IWorldCellsStats {
    return {
      evictions: this.#evictions,
      failures: this.#failures,
      instances: this.#instances,
      loadsInFlight: this.#limiter.inFlight,
      loadsQueued: this.#limiter.queued,
      pressure: { ...this.#pressure },
      rebuilds: this.#rebuilds,
      residentCells: this.#resident.size,
      residentKeys: [...this.#resident.keys()].sort(),
    };
  }

  detach(): void {
    this.dispose();
  }

  dispose(): void {
    if (this.#released) return;
    this.#released = true;
    for (const cell of [...this.#resident.values()]) this.#evict(cell);
    this.#terrain.dispose();
    this.removeFromParent();
  }

  #updateResidency(followCell: { x: number; z: number }, x: number, z: number): void {
    const wanted: Array<{ cell: IWorldCell; distance: number }> = [];
    for (const cell of this.#cells) {
      if (Math.max(Math.abs(cell.x - followCell.x), Math.abs(cell.z - followCell.z)) > this.#ring)
        continue;
      const centerX = this.#minX + (cell.x + 0.5) * this.#cellSize;
      const centerZ = this.#minZ + (cell.z + 0.5) * this.#cellSize;
      wanted.push({ cell, distance: Math.hypot(x - centerX, z - centerZ) });
    }
    wanted.sort((a, b) => a.distance - b.distance || a.cell.z - b.cell.z || a.cell.x - b.cell.x);

    for (const resident of [...this.#resident.values()]) {
      if (
        Math.max(Math.abs(resident.x - followCell.x), Math.abs(resident.z - followCell.z)) >
        this.#ring + 1
      )
        this.#evict(resident);
    }

    for (const candidate of wanted) {
      const key = cellKey(candidate.cell.x, candidate.cell.z);
      if (this.#resident.has(key)) continue;
      if (this.#resident.size >= this.#budgets.residentCells) {
        this.#pressure.cells += 1;
        continue;
      }
      const instances = candidate.cell.runs.reduce((total, run) => total + run.count, 0);
      const bytes = instances * PLACEMENT_RECORD_BYTES;
      if (this.#instances + instances > this.#budgets.instances) {
        this.#pressure.instances += 1;
        continue;
      }
      if (this.#bytes + bytes > this.#budgets.bytes) {
        this.#pressure.bytes += 1;
        continue;
      }
      this.#admit(candidate.cell, instances, bytes);
    }
  }

  #admit(cell: IWorldCell, instances: number, bytes: number): void {
    const state: IResidentCell = {
      batches: [],
      bytes,
      cell,
      chunks: [],
      generation: this.#generation++,
      instances,
      key: cellKey(cell.x, cell.z),
      x: cell.x,
      z: cell.z,
    };
    this.#resident.set(state.key, state);
    this.#instances += instances;
    this.#bytes += bytes;
    for (const run of cell.runs) this.#acquire(run, state);
    if (cell.chunks !== undefined && cell.chunks.length > 0) this.#startChunkLoad(state);
  }

  #acquire(run: IWorldRun, cell: IResidentCell): void {
    let asset = this.#assets.get(run.asset);
    if (asset === undefined) {
      const definition = this.#manifest.assets[run.asset];
      if (definition === undefined) return;
      asset = {
        ...assetLevels(definition),
        definition,
        disposed: false,
        id: run.asset,
        levels: [],
        pending: false,
        refcount: 0,
      };
      this.#assets.set(run.asset, asset);
    }
    asset.refcount += 1;
    if (asset.levels.length > 0) {
      this.#buildBatch(asset, cell, run);
      return;
    }
    if (!asset.pending) this.#startAssetLoad(asset);
  }

  /**
   * One model, from the loader the package was given. `loadModel` keeps the override and takes the
   * authored url, so a game's own GLB loader is unchanged; without it the logical path goes to
   * `assets.model`, which is what makes a compiled package and its KTX2 textures work.
   */
  #model(path: string): Promise<Object3D> {
    return this.#loadModel === undefined
      ? loadModelWith(this.#loader, path)
      : this.#loadModel(resolveRelative(this.#baseUrl, path));
  }

  /**
   * Every level of one asset, through the same limiter and the same resolution as `lod0`, so a
   * package's compiled output and compressed textures reach the renderer the game booted with. One
   * level refusing is not the asset refusing: it is counted and `#adoptAsset` falls back to the
   * level below it, so the far placements still draw.
   */
  #startAssetLoad(asset: IAssetState): void {
    asset.pending = true;
    const wanted = (): boolean =>
      !this.#released && this.#assets.get(asset.id) === asset && !asset.disposed;
    // `Promise.all` hands back the levels in `glbs` order, and the limiter is what bounds them: it
    // already caps every load in flight across the resident cells, assets and chunks together.
    const loads: Array<Promise<Object3D | undefined>> = [];
    for (const glb of asset.glbs) {
      const path = resolveRelative(this.#logicalBase, glb);
      loads.push(
        this.#limiter
          .load(() => this.#model(path), wanted)
          .catch(() => {
            this.#failures += 1;
            return undefined;
          }),
      );
    }
    void Promise.all(loads).then((models) => {
      // The state stays, refcount and all, whatever the loads answered: cells still resident are
      // holding it, and the next acquire retries. Dropping it here would let a later cell refcount
      // from zero and hand an eviction of an old cell the geometry a still-resident cell draws.
      asset.pending = false;
      this.#adoptAsset(asset, models);
    });
  }

  /** The level one loaded model draws with, or `undefined` when it carries nothing to draw. */
  #levelOf(model: Object3D | undefined): IAssetLevel | undefined {
    if (model === undefined) return undefined;
    const renderable = firstRenderable(model);
    if (renderable === undefined) {
      // Same as a refused load: counted, released, and the next acquire retries.
      this.#failures += 1;
      this.#failures += disposeModel(model);
      return undefined;
    }
    return { geometry: renderable.geometry, material: renderable.material };
  }

  /**
   * One level per loaded model: level 0 is the asset's own shape, and every level below it falls
   * back to the one above when it did not load. `undefined` is the asset refusing to exist — no
   * `lod0` to fall back to — and the levels that did load are released rather than held by an asset
   * that draws nothing. The refcounted state stays either way, so the next acquire retries.
   */
  #adoptLevels(models: readonly (Object3D | undefined)[]): readonly IAssetLevel[] | undefined {
    const levels: IAssetLevel[] = [];
    for (const [index, model] of models.entries()) {
      const level = this.#levelOf(model) ?? levels[index - 1];
      if (level === undefined) {
        this.#failures += disposeModels(models.slice(index));
        return undefined;
      }
      levels.push(level);
    }
    return levels;
  }

  #adoptAsset(asset: IAssetState, models: readonly (Object3D | undefined)[]): void {
    if (this.#released || this.#assets.get(asset.id) !== asset || asset.disposed) {
      this.#failures += disposeModels(models);
      return;
    }
    const levels = this.#adoptLevels(models);
    if (levels === undefined) return;
    asset.levels = levels;
    for (const cell of [...this.#resident.values()]) {
      for (const run of cell.cell.runs) {
        if (run.asset === asset.id) this.#buildBatch(asset, cell, run);
      }
    }
  }

  #buildBatch(asset: IAssetState, cell: IResidentCell, run: IWorldRun): void {
    if (asset.levels.length === 0) return;
    if (cell.batches.some((entry) => entry.asset === asset.id)) return;
    const records = cellPlacements(this.#placements, run);
    const filterX = this.#follow.position.x;
    const filterZ = this.#follow.position.z;
    const inner = cullDistance(asset.definition.maxDistance);
    // One batch per level, so a placement is filtered and drawn together and an emptied level
    // costs one missing mesh rather than the whole cell's run.
    const batches: InstancedBatch[] = [];
    for (const level of asset.levels)
      batches.push(new InstancedBatch({ geometry: level.geometry, material: level.material }));
    for (let index = 0; index < run.count; index += 1) {
      const base = index * PLACEMENT_RECORD_FLOATS;
      const x = records[base] as number;
      const y = records[base + 1] as number;
      const z = records[base + 2] as number;
      const distance = Math.hypot(x - filterX, z - filterZ);
      if (inner !== undefined && distance > inner) continue;
      this.#position.set(x, y, z);
      this.#rotation.set(
        records[base + 3] as number,
        records[base + 4] as number,
        records[base + 5] as number,
        records[base + 6] as number,
      );
      this.#scale.setScalar(records[base + 7] as number);
      this.#matrix.compose(this.#position, this.#rotation, this.#scale);
      (batches[levelAt(asset.distances, distance)] as InstancedBatch).add(this.#matrix);
    }
    // ponytail: a hard switch, no crossfade — a placement crosses a level boundary by being
    // rebuilt into the other level's batch, so the swap pops. A blend needs a per-instance mix the
    // InstancedBatch has no slot for; add one when a game's swap is visible enough to pay for it.
    for (const [level, batch] of batches.entries()) {
      const mesh = batch.build({ name: `${cell.key}:${asset.id}:${String(level)}` });
      cell.batches.push({
        asset: asset.id,
        batch,
        lastFilterX: filterX,
        lastFilterZ: filterZ,
        mesh,
        threshold: asset.threshold,
      });
      if (mesh !== undefined) this.add(mesh);
    }
  }

  /**
   * The `[nearest, farthest]` distance from `(x, z)` to the rectangle a cell's placements lie in.
   *
   * ponytail: the rectangle is the compiler's contract — a run's records belong to the cell they
   * are filed under — so one interval covers every placement in a cell. A hand-edited package that
   * files a placement under a neighbouring cell keeps it at the level its own distance selects; a
   * validator check on the placement buffer is the fix if that ever has to be caught.
   */
  #span(cell: IResidentCell, x: number, z: number): readonly [number, number] {
    const left = this.#minX + cell.x * this.#cellSize;
    const near = this.#minZ + cell.z * this.#cellSize;
    const right = left + this.#cellSize;
    const far = near + this.#cellSize;
    return [
      Math.hypot(Math.max(left - x, x - right, 0), Math.max(near - z, z - far, 0)),
      Math.hypot(
        Math.max(Math.abs(x - left), Math.abs(x - right)),
        Math.max(Math.abs(z - near), Math.abs(z - far)),
      ),
    ];
  }

  /** One entry per asset of `cell` the follow point has moved a gate of, nearest placement first. */
  #staleIn(cell: IResidentCell, x: number, z: number): Array<{ distance: number; id: string }> {
    const stale: Array<{ distance: number; id: string }> = [];
    const seen = new Set<string>();
    for (const entry of cell.batches) {
      if (entry.threshold === undefined || seen.has(entry.asset)) continue;
      // Every level of one asset was filtered from the same follow position, so the first entry
      // settles the asset and the levels behind it are already stale.
      seen.add(entry.asset);
      if (Math.hypot(x - entry.lastFilterX, z - entry.lastFilterZ) <= entry.threshold / 8) continue;
      const asset = this.#assets.get(entry.asset);
      if (asset === undefined) continue;
      const [near, far] = this.#span(cell, x, z);
      const [builtNear, builtFar] = this.#span(cell, entry.lastFilterX, entry.lastFilterZ);
      const low = Math.min(near, builtNear);
      // Ends included, so a placement exactly on a gate is one of the reasons to rebuild.
      const high = Math.max(far, builtFar);
      if (!asset.gates.some((gate) => gate >= low && gate <= high)) continue;
      stale.push({ distance: near, id: entry.asset });
    }
    return stale;
  }

  /**
   * Refilter the batches whose follow point has moved far enough to have crossed a boundary: a cull
   * distance, or one of the asset's `lods` switches. This is the same step the `maxDistance` filter
   * always took, with the level switch added to the distances it can be crossed at, so there is
   * still no per-frame refiltering pass.
   *
   * Two things keep that pass from costing a frame. A cell's placements all sit inside one
   * rectangle, so the two points that matter — where the batch was built and where the follow point
   * is now — bracket every distance a placement of that cell can have had; with no gate of the
   * asset in that span the level and cull answer is the same and the rebuild could change nothing,
   * and the position the batch was built from is kept so the next move is still measured from it.
   * What is genuinely stale is done nearest cell first, `rebuildsPerUpdate` of them per call, so a
   * fast player pays a few stale-but-drawn batches instead of every resident cell's in one frame.
   */
  #updateMaxDistance(x: number, z: number): void {
    const stale: Array<{ cell: IResidentCell; distance: number; id: string }> = [];
    for (const cell of this.#resident.values())
      for (const job of this.#staleIn(cell, x, z)) stale.push({ cell, ...job });
    stale.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
    for (const job of stale.slice(0, this.#rebuildsPerUpdate)) {
      this.#rebuildAsset(job.cell, job.id);
      this.#rebuilds += 1;
    }
  }

  #rebuildAsset(cell: IResidentCell, id: string): void {
    const asset = this.#assets.get(id);
    if (asset === undefined || asset.levels.length === 0) return;
    for (let index = cell.batches.length - 1; index >= 0; index -= 1) {
      const entry = cell.batches[index] as ICellBatch;
      if (entry.asset !== id) continue;
      cell.batches.splice(index, 1);
      entry.mesh?.removeFromParent();
      if (release(entry.mesh)) this.#failures += 1;
    }
    const run = cell.cell.runs.find((candidate) => candidate.asset === id);
    if (run !== undefined) this.#buildBatch(asset, cell, run);
  }

  #cellLive(cell: IResidentCell, generation: number): boolean {
    return (
      !this.#released && this.#resident.get(cell.key) === cell && cell.generation === generation
    );
  }

  #startChunkLoad(cell: IResidentCell): void {
    const generation = cell.generation;
    const paths: string[] = [];
    for (const chunk of cell.cell.chunks ?? [])
      paths.push(resolveRelative(this.#logicalBase, chunk));
    loadAll(
      paths,
      (path) =>
        this.#limiter.load(
          () => this.#model(path),
          () => this.#cellLive(cell, generation),
        ),
      { marker: false },
    ).then(
      (models) => {
        void this.#attachChunks(
          cell,
          generation,
          models.filter((model): model is Object3D => model !== undefined),
        );
      },
      () => {
        this.#failures += 1;
      },
    );
  }

  async #attachChunks(
    cell: IResidentCell,
    generation: number,
    models: readonly Object3D[],
  ): Promise<void> {
    const live = (): boolean => this.#cellLive(cell, generation);
    let attached = 0;
    try {
      const report = await addInSlices(
        models,
        (object) => {
          if (!live()) return;
          object.name = CHUNK_NAME;
          cell.chunks.push(object);
          this.add(object);
          attached += 1;
        },
        { marker: false, while: live },
      );
      if (report.stopped)
        for (let i = report.added; i < models.length; i += 1)
          this.#failures += disposeModel(models[i] as Object3D);
    } catch {
      this.#failures += 1;
      for (let i = attached; i < models.length; i += 1)
        this.#failures += disposeModel(models[i] as Object3D);
    }
  }

  #evict(cell: IResidentCell): void {
    for (const entry of cell.batches) {
      entry.mesh?.removeFromParent();
      if (release(entry.mesh)) this.#failures += 1;
    }
    cell.batches.length = 0;
    for (const chunk of cell.chunks) {
      chunk.removeFromParent();
      this.#failures += disposeModel(chunk);
    }
    cell.chunks.length = 0;
    this.#resident.delete(cell.key);
    this.#instances -= cell.instances;
    this.#bytes -= cell.bytes;
    this.#evictions += 1;
    for (const run of cell.cell.runs) this.#release(run.asset);
  }

  #release(id: string): void {
    const asset = this.#assets.get(id);
    if (asset === undefined) return;
    asset.refcount -= 1;
    if (asset.refcount > 0) return;
    this.#assets.delete(id);
    asset.disposed = true;
    // The last cell drawing this asset is gone, so this is the one teardown its levels get. It is
    // also the one a lost device makes expensive, which is why every level goes through `release`:
    // at most once per resource, and a level that fell back shares the level below's geometry, so
    // one shape is torn down once however many levels point at it. One refusal is counted per
    // asset, the way one refused `lod0` load was.
    const levels = asset.levels;
    asset.levels = [];
    let failed = 0;
    for (const level of levels) {
      if (release(level.geometry)) failed += 1;
      if (release(level.material)) failed += 1;
    }
    if (failed > 0) this.#failures += 1;
  }
}
