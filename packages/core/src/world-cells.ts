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
import { createAssetLoader } from "./assets.js";
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
  /** URL of `world.json`; every other path in the package resolves relative to it. */
  readonly url: string;
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
  /** `(url) => Promise<Object3D>`; defaults to the engine GLB loader. */
  readonly loadModel?: (url: string) => Promise<Object3D>;
  /**
   * Model loads in flight at once, assets and chunks together. Defaults to `loadAll`'s
   * `concurrency`, six.
   */
  readonly concurrency?: number;
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
  readonly failures: number;
  /** Cumulative rejected requests: cells skipped, instances or bytes refused, terrain retries. */
  readonly pressure: { readonly cells: number; readonly instances: number; readonly bytes: number };
}

interface ICellBatch {
  readonly asset: string;
  readonly batch: InstancedBatch;
  readonly maxDistance: number | undefined;
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

interface IAssetState {
  readonly id: string;
  readonly definition: IWorldAsset;
  refcount: number;
  pending: boolean;
  disposed: boolean;
  geometry: BufferGeometry | undefined;
  material: Material | undefined;
}

interface IWorldCellsInit extends IWorldCellsLoadOptions {
  readonly manifest: IWorldPackage;
  readonly placements: ArrayBuffer;
  readonly heightmap: Uint16Array;
  readonly baseUrl: string;
}

let defaultLoader: ReturnType<typeof createAssetLoader> | undefined;

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

async function defaultLoadModel(url: string): Promise<Object3D> {
  defaultLoader ??= createAssetLoader();
  const gltf = await defaultLoader.model<{ scene?: Object3D }>(url);
  const scene = gltf?.scene;
  if (!(scene instanceof Object3D))
    throw new Error(`World asset '${url}' loaded without an Object3D scene.`);
  return scene;
}

function resolveRelative(baseUrl: string, relative: string): string {
  if (/^(?:[a-z]+:)?\/\//iu.test(relative) || relative.startsWith("data:")) return relative;
  return `${baseUrl}${relative.replace(/^\//u, "")}`;
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
 * resident cell asset run, and loads hand-placed chunk GLBs through `loadAll` + `addInSlices`.
 * Ring residency, per-asset `maxDistance` filtering, hard budgets and generation-tokened
 * cancellation all live here; every geometry, material and surface still comes from the package's
 * GLBs and the game.
 *
 * @situation stream a large Blender-authored world by cell instead of one huge GLB
 * @situation keep scattered props and hand-placed chunks resident around a moving player
 * @situation honour per-asset draw distances and hard streaming budgets without a mid-frame throw
 * @constraint surface is the game's; this class creates no material, colour or geometry
 * @constraint budgets are hard caps that report pressure instead of over-committing
 * @constraint model loads are bounded by `concurrency` (default `loadAll`'s six) across every resident cell, not per cell
 * @override ring, budgets, terrain tile size/resolution, load `concurrency` and the package's per-asset maxDistance
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
  readonly #loadModel: (url: string) => Promise<Object3D>;
  readonly #limiter: ModelLoadLimiter;
  readonly #manifest: IWorldPackage;
  readonly #minX: number;
  readonly #minZ: number;
  readonly #placements: ArrayBuffer;
  readonly #ring: number;
  readonly #terrain: TerrainTiles;
  readonly #baseUrl: string;
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
    this.#baseUrl = init.baseUrl;
    this.#loadModel = init.loadModel ?? defaultLoadModel;
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
    const baseUrl = options.url.slice(0, options.url.lastIndexOf("/") + 1);
    const manifestResponse = await fetch(options.url);
    if (!manifestResponse.ok)
      throw new Error(
        `World manifest request failed with status ${String(manifestResponse.status)} for ${options.url}.`,
      );
    const manifest = (await manifestResponse.json()) as IWorldPackage;
    const placementsResponse = await fetch(resolveRelative(baseUrl, manifest.placements));
    if (!placementsResponse.ok)
      throw new Error(
        `World placements request failed with status ${String(placementsResponse.status)} for ${manifest.placements}.`,
      );
    const placements = await placementsResponse.arrayBuffer();
    const heightmap = await loadWorldHeightmap(
      resolveRelative(baseUrl, manifest.terrain.heightmap),
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
    return new WorldCells({ ...options, baseUrl, heightmap, manifest, placements });
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
   * refilters `maxDistance` batches. A terrain budget throw is caught and counted, and so is a
   * teardown that throws while releasing what left — `failures` in {@link stats} carries both. Every
   * other error, the game's included, escapes.
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
        definition,
        disposed: false,
        geometry: undefined,
        id: run.asset,
        material: undefined,
        pending: false,
        refcount: 0,
      };
      this.#assets.set(run.asset, asset);
    }
    asset.refcount += 1;
    if (asset.geometry !== undefined && asset.material !== undefined) {
      this.#buildBatch(asset, cell, run);
      return;
    }
    if (!asset.pending) this.#startAssetLoad(asset);
  }

  #startAssetLoad(asset: IAssetState): void {
    asset.pending = true;
    const url = resolveRelative(this.#baseUrl, asset.definition.glb);
    this.#limiter
      .load(
        () => this.#loadModel(url),
        () => !this.#released && this.#assets.get(asset.id) === asset && !asset.disposed,
      )
      .then(
        (model) => {
          asset.pending = false;
          if (model !== undefined) this.#adoptAsset(asset, model);
        },
        () => {
          // The state stays, refcount and all: cells still resident are holding it, and the next
          // acquire retries. Dropping it here would let a later cell refcount from zero and hand
          // an eviction of an old cell the geometry a still-resident cell draws.
          asset.pending = false;
          this.#failures += 1;
        },
      );
  }

  #adoptAsset(asset: IAssetState, model: Object3D): void {
    if (this.#released || this.#assets.get(asset.id) !== asset || asset.disposed) {
      this.#failures += disposeModel(model);
      return;
    }
    const renderable = firstRenderable(model);
    if (renderable === undefined) {
      // Same as a refused load: keep the refcounted state so the next acquire retries.
      this.#failures += 1;
      this.#failures += disposeModel(model);
      return;
    }
    asset.geometry = renderable.geometry;
    asset.material = renderable.material;
    for (const cell of [...this.#resident.values()]) {
      for (const run of cell.cell.runs) {
        if (run.asset === asset.id) this.#buildBatch(asset, cell, run);
      }
    }
  }

  #buildBatch(asset: IAssetState, cell: IResidentCell, run: IWorldRun): void {
    const geometry = asset.geometry;
    const material = asset.material;
    if (geometry === undefined || material === undefined) return;
    if (cell.batches.some((entry) => entry.asset === asset.id)) return;
    const records = cellPlacements(this.#placements, run);
    const maxDistance = asset.definition.maxDistance;
    const filterX = this.#follow.position.x;
    const filterZ = this.#follow.position.z;
    const inner = maxDistance === undefined ? undefined : maxDistance - maxDistance / 8;
    const batch = new InstancedBatch({ geometry, material });
    for (let index = 0; index < run.count; index += 1) {
      const base = index * PLACEMENT_RECORD_FLOATS;
      const x = records[base] as number;
      const y = records[base + 1] as number;
      const z = records[base + 2] as number;
      if (inner !== undefined && Math.hypot(x - filterX, z - filterZ) > inner) continue;
      this.#position.set(x, y, z);
      this.#rotation.set(
        records[base + 3] as number,
        records[base + 4] as number,
        records[base + 5] as number,
        records[base + 6] as number,
      );
      this.#scale.setScalar(records[base + 7] as number);
      this.#matrix.compose(this.#position, this.#rotation, this.#scale);
      batch.add(this.#matrix);
    }
    // ponytail: one geometry/material per asset run and lod0 only; InstancedBatch has no LOD
    // container, so the package's `lods` are not consumed. Add an LOD-aware batch when a game
    // needs distance LODs for scattered assets.
    const mesh = batch.build({ name: `${cell.key}:${asset.id}` });
    const entry: ICellBatch = {
      asset: asset.id,
      batch,
      lastFilterX: filterX,
      lastFilterZ: filterZ,
      maxDistance,
      mesh,
    };
    cell.batches.push(entry);
    if (mesh !== undefined) this.add(mesh);
  }

  #updateMaxDistance(x: number, z: number): void {
    for (const cell of this.#resident.values()) {
      for (const entry of [...cell.batches]) {
        if (entry.maxDistance === undefined) continue;
        if (Math.hypot(x - entry.lastFilterX, z - entry.lastFilterZ) <= entry.maxDistance / 8)
          continue;
        this.#rebuildMaxDistance(cell, entry);
      }
    }
  }

  #rebuildMaxDistance(cell: IResidentCell, entry: ICellBatch): void {
    const asset = this.#assets.get(entry.asset);
    if (asset === undefined || asset.geometry === undefined || asset.material === undefined) return;
    const run = cell.cell.runs.find((candidate) => candidate.asset === entry.asset);
    const index = cell.batches.indexOf(entry);
    if (index === -1) return;
    cell.batches.splice(index, 1);
    entry.mesh?.removeFromParent();
    if (release(entry.mesh)) this.#failures += 1;
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
    for (const chunk of cell.cell.chunks ?? []) paths.push(resolveRelative(this.#baseUrl, chunk));
    loadAll(
      paths,
      (url) =>
        this.#limiter.load(
          () => this.#loadModel(url),
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
    // The last cell drawing this asset is gone, so this is the one teardown the geometry gets. It
    // is also the one a lost device makes expensive, which is why it goes through `release`.
    const geometry = asset.geometry;
    const material = asset.material;
    asset.geometry = undefined;
    asset.material = undefined;
    const geometryFailed = release(geometry);
    const materialFailed = release(material);
    if (geometryFailed || materialFailed) this.#failures += 1;
  }
}
