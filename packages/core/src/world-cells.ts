import {
  type BufferGeometry,
  Group,
  type InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  SkinnedMesh,
  Vector3,
} from "three";
import { type IAssetLoader, createAssetLoader } from "./assets.js";
import type { IComputeDriven } from "./compute-driven.js";
import { InstancedBatch } from "./instanced-batch.js";
import { cutoutSurface } from "./render/foliage-alpha.js";
import { materialKey } from "./render/material-key.js";
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
import {
  type IAdmissionBudget,
  type IWorldTilesOptions,
  TerrainTileBudgetError,
  TerrainTiles,
} from "./world-tiles.js";

const PLACEMENT_RECORD_BYTES = 32;
const PLACEMENT_RECORD_FLOATS = 8;
const DEFAULT_TILE_RESOLUTION = 129;
const CHUNK_NAME = "world-chunk";
/** Milliseconds one `update` may spend admitting streamed content, unless the game says otherwise. */
const DEFAULT_ADMISSION_BUDGET_MS = 2;
/**
 * Placements filtered per unit of admission work.
 *
 * One unit is what a frame can overshoot its budget by, so it is sized to stay small rather than to
 * divide the work evenly: a slice is a few hundred placements' worth of matrix maths, tens of
 * microseconds, whatever the cell holds. ponytail: a count, not a time — the budget is the clock,
 * and this only decides how often it is read.
 */
const ADMISSION_SLICE_PLACEMENTS = 256;

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
  /**
   * Tiles kept resident around the follow tile, independent of the cell `ring`: terrain can reach
   * to the horizon while props stay near. Defaults to `ring`, so raising only this widens the
   * ground without widening the props, and the far tiles take the coarser `lodDistances` levels.
   */
  readonly streamRadius?: number;
  /**
   * Tiles that get a `createCollider` body, by Chebyshev radius from the follow tile. Defaults to
   * `ring`. A tile entering or leaving it creates or disposes its collider, so a wide terrain
   * radius does not have to mean a physics body for every tile in it.
   */
  readonly colliderRadius?: number;
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
   * How a scattered part whose own material is `transparent` is drawn. `"cutout"` (the default)
   * gives the part a clone of that material with `transparent: false` and an `alphaTest`, so the
   * instanced draw needs no per-instance sorting and the depth buffer rejects what is behind it;
   * `"blend"` draws the material as authored. One clone per asset part, never per cell.
   */
  readonly transparentScatter?: "cutout" | "blend";
  /**
   * Shadows for the streamed world, all off by default. `cast` makes scattered batches cast into
   * the scene's shadow map, but only their `castLevels` finest distance levels (default 1: the
   * near shape), since a far LOD's shadow is sub-texel in any open-world shadow window and every
   * caster is redrawn per shadow level. `receive` lets scatter and terrain receive shadows.
   */
  readonly shadows?: {
    readonly cast?: boolean;
    readonly castLevels?: number;
    readonly receive?: boolean;
  };
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
  /**
   * Milliseconds one `update` may spend admitting streamed content — cell batches, terrain tiles,
   * colliders and `maxDistance`/`lods` refilters together. Defaults to 2, and `Infinity` opts out
   * of the ceiling entirely.
   *
   * The ceiling is a budget, not a promise: one unit of work always finishes, so a frame spends at
   * most this plus its last unit. Work that does not fit waits for the next `update` rather than
   * being dropped, and `stats().admission` reports what is waiting. A frame that admits nothing
   * costs nothing here.
   */
  readonly admissionBudgetMs?: number;
  /**
   * Milliseconds source for the admission budget, `performance.now` by default. Injectable so a
   * test can prove the ceiling instead of hoping a machine is slow enough to show it.
   */
  readonly admissionNow?: () => number;
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
  /**
   * What the last `update` spent on admitting streamed content, and what it left behind.
   *
   * A rising `backlog` is the honest signal that admission is not keeping up with the follow point;
   * it is the one number that says a player is outrunning the world.
   */
  readonly admission: {
    /** Milliseconds the last `update` spent admitting; at most the budget plus its last unit. */
    readonly spentMs: number;
    /** Cell-asset builds the last `update` had no budget for, still queued for a later one. */
    readonly deferred: number;
    /** Units of work those builds still owe — placement slices left plus meshes left to publish. */
    readonly backlog: number;
  };
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

/**
 * One cell's asset run waiting to be built, in units small enough to fit a frame's admission
 * budget: a slice of placements, or one mesh built.
 *
 * A job outlives the `update` that queued it, so every field it needs to resume is on the job and
 * not on the call stack — a streamed cell holds its residency slot while it waits, so the work is
 * never spent on a cell that has since left.
 */
interface IBuildJob {
  readonly asset: IAssetState;
  readonly cell: IResidentCell;
  readonly run: IWorldRun;
  /** The follow position this build filters for; a deferred build keeps the answer it was queued for. */
  readonly filterX: number;
  readonly filterZ: number;
  /** A refilter's outgoing batches, drawn until this job's own batches are attached. */
  readonly replaced: readonly ICellBatch[];
  /** This job's built batches, attached together when the last one is ready. */
  readonly fresh: ICellBatch[];
  /** The run's placement records, read once and kept across the slices that filter them. */
  records: Float32Array | undefined;
  /** Next placement to filter; the filter is complete when it reaches `run.count`. */
  next: number;
  batches: InstancedBatch[][] | undefined;
  /** How many of the (level, part) meshes have been built. */
  published: number;
}

/** One drawable part of one level, read out of the level's own GLB. */
interface IAssetPart {
  readonly geometry: BufferGeometry;
  /** The mesh's transform relative to the model root, composed into every instance matrix. */
  readonly local: Matrix4;
  /** The surface the batch draws with: the shared surface for this part's material content. */
  readonly material: Material;
  /** The `materialKey` of that surface, released through the shared-surface registry. */
  readonly surface: string;
}

/** A surface every part with the same material content draws with, and who still uses it. */
interface ISharedSurface {
  readonly material: Material;
  /** The canonical source and any cutout made from it, torn down with the last user. */
  readonly owned: readonly Material[];
  users: number;
}

/** Parts already handed back, so a level that fell back to the one above releases it once. */
const releasedParts = new WeakSet<IAssetPart>();

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
   * One part list per entry in `glbs`, so a level that failed to load reuses the level below it and
   * the batch builder never has to know a level is missing.
   */
  levels: readonly (readonly IAssetPart[])[];
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

/**
 * The alpha threshold a cutout gets when the part's own material names none. ponytail: a fixed
 * 0.5, because the cutout point is authored data a GLB carries per texture and nothing reads it
 * here. A tree whose needles visibly dither at 0.5 wants a lower one — give
 * `transparentScatter` a third mode carrying a threshold when that is worth a knob.
 */
const DEFAULT_CUTOUT_ALPHA = 0.5;

/**
 * Mip compensation for scattered foliage. Golus's 0.25 suits dense cards; a needle atlas at ~9 %
 * coverage averages to ~0.09 alpha by mip 8, where a tree 150 m out samples, so 0.25 still drops
 * every needle. 0.75 keeps the cutoff under that average through mip 8.
 * ponytail: one tuned constant; coverage-preserving mips at cook time are the upgrade path.
 */
const SCATTER_MIP_ALPHA_SCALE = 0.75;

/**
 * The surface a scattered part draws with, and the cutout this class owns when it made one.
 *
 * An `InstancedMesh` cannot sort its instances, so a `transparent` material on scattered foliage
 * draws in submission order — wrong against itself, and overdraw on top of it. A cutout keeps the
 * part's own alpha shape, keeps the depth buffer, and lets the draw reject what is behind it. The
 * GLB's material is never mutated: the cutout is per asset part, so every cell batch of the asset
 * shares one and a game that still wants blending asks for it.
 *
 * The cutout itself is `cutoutSurface`, because a cutout that ignores the mip chain deletes itself
 * at distance: the needle card's mips average to a tenth, and every needle is discarded.
 */
function scatterMaterial(
  material: Material,
  transparentScatter: "cutout" | "blend",
): { readonly material: Material; readonly owned: readonly Material[] } {
  if (transparentScatter === "blend" || !material.transparent)
    return { material, owned: [material] };
  const cutout = cutoutSurface(
    material,
    material.alphaTest > 0 ? material.alphaTest : DEFAULT_CUTOUT_ALPHA,
    SCATTER_MIP_ALPHA_SCALE,
  );
  // The authored material is owned too: the batch draws the cutout, and the GLB's own surface is
  // still this asset's to hand back.
  return { material: cutout, owned: [material, cutout] };
}

/**
 * Every drawable part of a loaded model: one per `Mesh`, each with its shape, its surface, and
 * where it sits relative to the model root.
 *
 * A GLB authored as a tree — bark `OPAQUE`, needles `BLEND` — is one node carrying one mesh with
 * two primitives, which three loads as a `Group` of one child `Mesh` per primitive. Taking only the
 * first of those drew 62k bare trunks, so every one of them is a part and each keeps its own
 * material.
 *
 * `SkinnedMesh` is skipped deliberately: its vertices are posed per frame from a skeleton, and one
 * `InstancedMesh` of the geometry would draw the rest pose once per placement. `Points` and
 * `LineSegments` are not `Mesh`es and are skipped with them.
 */
function renderableParts(
  model: Object3D,
  surfaceFor: (material: Material) => { readonly key: string; readonly material: Material },
): readonly IAssetPart[] {
  model.updateMatrixWorld(true);
  const rootInverse = new Matrix4().copy(model.matrixWorld).invert();
  const local = new Matrix4();
  const parts: IAssetPart[] = [];
  model.traverse((object: Object3D) => {
    if (object instanceof SkinnedMesh || !(object instanceof Mesh)) return;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    if (object.geometry === undefined || material === undefined) return;
    const surface = surfaceFor(material);
    parts.push({
      geometry: object.geometry,
      local: local.multiplyMatrices(rootInverse, object.matrixWorld).clone(),
      material: surface.material,
      surface: surface.key,
    });
  });
  return parts;
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
 * One empty batch per (level, part), so a placement is filtered and drawn together and an emptied
 * level or a part nobody placed costs one missing mesh rather than the whole cell's run.
 */
function newBatches(asset: IAssetState): InstancedBatch[][] {
  const batches: InstancedBatch[][] = [];
  for (const parts of asset.levels) {
    const levelBatches: InstancedBatch[] = [];
    for (const part of parts)
      levelBatches.push(new InstancedBatch({ geometry: part.geometry, material: part.material }));
    batches.push(levelBatches);
  }
  return batches;
}

/** How many meshes a build will publish: one per (level, part). */
function publishCount(batches: readonly InstancedBatch[][]): number {
  let total = 0;
  for (const levelBatches of batches) total += levelBatches.length;
  return total;
}

/**
 * The distance a `maxDistance` prop actually culls at, one eighth short of itself: the slack
 * `#addPlacements` leaves, so a follow point that has not moved a whole eighth of the cull distance
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

/**
 * The admission budget: a positive number of milliseconds, or `Infinity` for no ceiling at all —
 * which is what a game that wants one `update` to admit everything it can asks for. Zero is refused
 * rather than obeyed, because a world whose budget is spent before it starts never streams at all,
 * and that is never what anyone meant to write.
 */
function admissionBudgetMs(value: number): number {
  if (Number.isNaN(value) || value <= 0)
    throw new Error("WorldCells admissionBudgetMs must be a positive number of milliseconds.");
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
 * One frame's admission allowance, shared by every path that puts streamed content on screen.
 *
 * A streaming world has no frame-time ceiling anywhere else: a cell row arriving builds a batch per
 * asset run over every placement in it, a terrain tile builds every LOD level, and the game's
 * `createCollider` runs for every resident tile — all in the one frame that discovers them. That is
 * the 100-330 ms hitch a 60 m/s camera feels every time the ring moves, and it is admission cost,
 * not streaming: the loads never fail.
 *
 * The budget is opened once per `update` and drawn down by the units it admits. A unit always
 * finishes, so a frame spends at most the limit plus the unit that crossed it, and the rest of the
 * backlog waits for the next frame rather than being dropped.
 */
class AdmissionBudget implements IAdmissionBudget {
  readonly #limitMs: number;
  readonly #now: () => number;
  #spentMs = 0;

  constructor(limitMs: number, now: () => number) {
    this.#limitMs = limitMs;
    this.#now = now;
  }

  get spentMs(): number {
    return this.#spentMs;
  }

  admit(work: () => void): boolean {
    if (this.#spentMs >= this.#limitMs) return false;
    const startedAt = this.#now();
    work();
    this.#spentMs += this.#now() - startedAt;
    return true;
  }
}

/**
 * Stream a Blender-authored world package by cell and keep it resident around a followed point.
 *
 * The class composes `TerrainTiles` for the package's heightmap, builds one `InstancedBatch` per
 * resident cell asset run, distance level and mesh part, and loads hand-placed chunk GLBs through
 * `loadAll` + `addInSlices`. Ring residency, per-asset `maxDistance` filtering, the per-asset `lods`
 * levels, hard budgets and generation-tokened cancellation all live here; every geometry, material
 * and surface still comes from the package's GLBs and the game.
 *
 * An asset is drawn per part, not per model: a GLB with several primitives is one `InstancedBatch`
 * each, and a scattered part whose own material is transparent draws as an alpha cutout unless the
 * game asks for blending, because an `InstancedMesh` cannot sort its instances.
 *
 * @situation stream a large Blender-authored world by cell instead of one huge GLB
 * @situation keep scattered props and hand-placed chunks resident around a moving player
 * @situation honour per-asset draw distances and hard streaming budgets without a mid-frame throw
 * @constraint surface is the game's; this class creates no material, colour or geometry
 * @constraint budgets are hard caps that report pressure instead of over-committing
 * @constraint model loads are bounded by `concurrency` (default `loadAll`'s six) across every resident cell, not per cell
 * @constraint refilters are bounded by `rebuildsPerUpdate` (default 16) per update, nearest cell first
 * @constraint admission is bounded by `admissionBudgetMs` (default 2) per update across every path, and a deferred cell keeps drawing what it has
 * @constraint SkinnedMesh parts are skipped; an instanced copy would draw one rest pose
 * @override ring, budgets, terrain tile size/resolution, terrain stream and collider radius, `transparentScatter`, load `concurrency`, `rebuildsPerUpdate`, `admissionBudgetMs` and the package's per-asset maxDistance
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
  readonly #transparentScatter: "cutout" | "blend";
  readonly #baseUrl: string;
  readonly #logicalBase: string;
  readonly #assets = new Map<string, IAssetState>();
  readonly #resident = new Map<string, IResidentCell>();
  /** Surfaces shared by material content across every asset part; see `materialKey`. */
  readonly #surfaces = new Map<string, ISharedSurface>();
  /** How many of an asset's finest levels cast shadows; 0 when the game asked for none. */
  readonly #castShadowLevels: number;
  readonly #receiveShadow: boolean;
  /** Cell-asset builds waiting for budget, in admission order: nearest cell first. */
  #jobs: IBuildJob[] = [];
  /** The (cell, asset) pairs already queued, so a refilter cannot queue itself twice. */
  readonly #queued = new Set<string>();
  readonly #position = new Vector3();
  readonly #rotation = new Quaternion();
  readonly #scale = new Vector3();
  readonly #matrix = new Matrix4();
  readonly #instance = new Matrix4();
  readonly #pressure = { cells: 0, instances: 0, bytes: 0 };
  readonly #budgetMs: number;
  readonly #now: () => number;
  #admission = { spentMs: 0, deferred: 0, backlog: 0 };
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
    this.#budgetMs = admissionBudgetMs(init.admissionBudgetMs ?? DEFAULT_ADMISSION_BUDGET_MS);
    this.#now = init.admissionNow ?? ((): number => globalThis.performance?.now() ?? Date.now());
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
    this.#transparentScatter = init.transparentScatter ?? "cutout";
    this.#castShadowLevels =
      init.shadows?.cast === true
        ? positiveInteger(init.shadows.castLevels ?? 1, "shadows.castLevels")
        : 0;
    this.#receiveShadow = init.shadows?.receive === true;
    if (this.#transparentScatter !== "cutout" && this.#transparentScatter !== "blend")
      throw new Error("WorldCells transparentScatter must be 'cutout' or 'blend'.");
    // Terrain can reach further than the props do, so its radius is its own option; the collider
    // radius stays on the ring, which is how far a player can actually walk into this world.
    const streamRadius = nonNegativeInteger(
      init.terrain?.streamRadius ?? this.#ring,
      "terrain.streamRadius",
    );
    const colliderRadius = nonNegativeInteger(
      init.terrain?.colliderRadius ?? this.#ring,
      "terrain.colliderRadius",
    );
    const tileCount = (2 * streamRadius + 1) ** 2;
    this.#terrain = new TerrainTiles({
      ...(init.createCollider === undefined
        ? {}
        : { colliderRadius, createCollider: init.createCollider }),
      receiveShadow: init.shadows?.receive === true,
      ...(init.terrain?.lodDistances === undefined
        ? {}
        : { lodDistances: init.terrain.lodDistances }),
      ...(init.terrain?.lodFactors === undefined ? {} : { lodFactors: init.terrain.lodFactors }),
      ...(init.terrain?.skirtDepth === undefined ? {} : { skirtDepth: init.terrain.skirtDepth }),
      // Sized from the terrain stream radius: the wanted square fits the tile budget. ponytail: no
      // terrain byte cap (a tile's bytes are deterministic from the radius, and the cells own the
      // memory budget); give `TerrainTiles` its own byte budget when terrain is not radius-bounded.
      // A tile that still cannot fit is caught in `update` and reported as pressure.
      residentByteBudget: Number.MAX_SAFE_INTEGER,
      residentTileBudget: tileCount,
      sampleHeight: heightSamplerFromHeightmap(
        init.manifest.terrain,
        init.manifest.extent,
        init.heightmap,
      ),
      streamRadius,
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
   * Reads the follow target, keeps the in-ring cells, evicts cells beyond the hysteresis ring, and
   * spends one admission budget on everything the ring newly wants: cell-asset batches, terrain
   * tiles, colliders and the `maxDistance`/`lods` refilters the follow point has moved far enough to
   * have changed. Whatever does not fit waits for the next call — nothing is dropped, and
   * `stats().admission` is the honest report of what is waiting. A terrain budget throw is caught
   * and counted, and so is a teardown that throws while releasing what left; `failures` carries
   * both. Every other error, the game's included, escapes.
   */
  update(renderer?: IRendererLike): void {
    if (this.#released) return;
    const x = this.#follow.position.x;
    const z = this.#follow.position.z;
    const budget = new AdmissionBudget(this.#budgetMs, this.#now);
    try {
      this.#terrain.follow({ x, z }, budget);
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
    this.#drain(budget);
    this.#admission = {
      backlog: this.#backlog(),
      deferred: this.#jobs.length,
      spentMs: budget.spentMs,
    };
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
      admission: { ...this.#admission },
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
      this.#queueBuild(asset, cell, run);
      return;
    }
    if (!asset.pending) this.#startAssetLoad(asset);
  }

  /**
   * Ask for one cell-asset run to be built, and do not build it yet.
   *
   * Admission is the only thing in this class that has no frame-time ceiling, so it is the only
   * thing that became a queue: the cell keeps its residency slot from `#admit`, the work waits for
   * a frame with budget in it, and a game that outruns the backlog sees it as `admission.backlog`
   * rather than as a frozen frame. A run already queued is not queued twice, which is what stops a
   * refilter — stale for as many frames as it waits — from stacking a second copy of itself.
   *
   * `replaced` is a refilter's outgoing batches, captured now and kept drawn until the replacement
   * is attached, so a rebuild that waits three frames shows the old level for those three frames
   * instead of a hole.
   */
  #queueBuild(asset: IAssetState, cell: IResidentCell, run: IWorldRun, replace = false): void {
    const token = `${cell.key}|${asset.id}`;
    if (this.#queued.has(token)) return;
    // A cell that already draws this asset is not built again, which is where an adopted asset's
    // second acquire over a still-resident cell lands.
    if (!replace && cell.batches.some((entry) => entry.asset === asset.id)) return;
    this.#queued.add(token);
    this.#jobs.push({
      asset,
      batches: undefined,
      cell,
      filterX: this.#follow.position.x,
      filterZ: this.#follow.position.z,
      fresh: [],
      next: 0,
      published: 0,
      records: undefined,
      replaced: replace ? cell.batches.filter((entry) => entry.asset === asset.id) : [],
      run,
    });
  }

  /**
   * Spend the frame's budget on queued builds, one unit each, and stop when it is gone.
   *
   * The queue is served in admission order, which is nearest cell first, and a build is taken to
   * completion before the next one starts: the units of one run are cheaper together than the
   * per-frame bookkeeping of interleaving them, and the cell behind it is the same distance away.
   * A build whose cell or asset has gone is dropped rather than resumed — there is nothing left to
   * draw it into — and a frame that runs out of budget leaves the rest of the queue for the next.
   */
  #drain(budget: IAdmissionBudget): void {
    const index = 0;
    while (index < this.#jobs.length) {
      const job = this.#jobs[index] as IBuildJob;
      if (this.#resident.get(job.cell.key) !== job.cell || job.asset.levels.length === 0) {
        this.#forget(index, job);
        continue;
      }
      let finished = false;
      if (
        !budget.admit(() => {
          finished = this.#step(job);
        })
      )
        break;
      // A finished build leaves the queue at this index, so the next one is served without a skip.
      if (finished) this.#forget(index, job);
    }
  }

  #forget(index: number, job: IBuildJob): void {
    this.#jobs.splice(index, 1);
    this.#queued.delete(`${job.cell.key}|${job.asset.id}`);
  }

  /** Units of work the queue still owes: placement slices left, plus meshes left to publish. */
  #backlog(): number {
    let units = 0;
    for (const job of this.#jobs) {
      const meshes = job.batches === undefined ? 0 : publishCount(job.batches);
      units +=
        Math.ceil(Math.max(0, job.run.count - job.next) / ADMISSION_SLICE_PLACEMENTS) +
        Math.max(0, meshes - job.published);
    }
    return units;
  }

  /**
   * One unit of one build: a slice of placements, or one mesh built, or the swap that attaches the
   * finished batch and retires what a refilter replaced. `true` means the job is done.
   */
  #step(job: IBuildJob): boolean {
    if (job.next < job.run.count) {
      job.batches ??= newBatches(job.asset);
      const end = Math.min(job.next + ADMISSION_SLICE_PLACEMENTS, job.run.count);
      this.#addPlacements(job, job.next, end);
      job.next = end;
      return false;
    }
    const batches = job.batches;
    // A run with nothing placed in it publishes nothing, exactly as an unbounded build would.
    if (batches === undefined) return true;
    if (job.published < publishCount(batches)) {
      this.#buildOne(job, batches);
      return false;
    }
    this.#swap(job);
    return true;
  }

  /**
   * Hand the cell its finished batches and take back the ones they replace, in one step.
   *
   * This is the no-hole rule. Attaching and detaching in the same synchronous block means no frame
   * ever shows the replacement beside the batch it replaces, and a refilter that waits three frames
   * for budget shows the level the cell already had for those three frames rather than nothing.
   */
  #swap(job: IBuildJob): void {
    const { cell } = job;
    for (const entry of job.fresh) {
      cell.batches.push(entry);
      if (entry.mesh !== undefined) this.add(entry.mesh);
    }
    for (const entry of job.replaced) {
      const at = cell.batches.indexOf(entry);
      if (at >= 0) cell.batches.splice(at, 1);
      entry.mesh?.removeFromParent();
      if (release(entry.mesh)) this.#failures += 1;
    }
  }

  /**
   * Filter one slice of a run's placements into the batches they draw from, culling on the position
   * this build was queued for and switching level where an asset's `lods` say to.
   */
  #addPlacements(job: IBuildJob, from: number, to: number): void {
    const { asset, filterX, filterZ } = job;
    if (job.records === undefined) job.records = cellPlacements(this.#placements, job.run);
    const records = job.records;
    const inner = cullDistance(asset.definition.maxDistance);
    for (let index = from; index < to; index += 1) {
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
      // The placement transform, then the part's own offset inside the model: a bark primitive at
      // the trunk and a needles primitive higher up both land in the one instance matrix.
      const level = levelAt(asset.distances, distance);
      const parts = asset.levels[level] as readonly IAssetPart[];
      const levelBatches = job.batches?.[level] as InstancedBatch[];
      for (const [part, entry] of parts.entries()) {
        this.#instance.multiplyMatrices(this.#matrix, entry.local);
        (levelBatches[part] as InstancedBatch).add(this.#instance);
      }
    }
  }

  /**
   * Build one (level, part) batch into a mesh. One mesh is one unit, because this is where every
   * instance matrix is written and the batch's bounds are first computed — the part of admission the
   * renderer pays for again on the frame it first draws the result. The mesh joins the cell in
   * {@link #swap}, with the rest of the job, so it is never half a replacement.
   *
   * ponytail: a hard switch, no crossfade — a placement crosses a level boundary by being rebuilt
   * into the other level's batch, so the swap pops. A blend needs a per-instance mix the
   * InstancedBatch has no slot for; add one when a game's swap is visible enough to pay for it.
   */
  #buildOne(job: IBuildJob, batches: readonly InstancedBatch[][]): void {
    const { asset, cell } = job;
    let part = job.published;
    for (const [level, levelBatches] of batches.entries()) {
      if (part >= levelBatches.length) {
        part -= levelBatches.length;
        continue;
      }
      const batch = levelBatches[part] as InstancedBatch;
      const mesh = batch.build({
        castShadow: this.#castShadowLevels > level,
        name: `${cell.key}:${asset.id}:${String(level)}:${String(part)}`,
        receiveShadow: this.#receiveShadow,
      });
      job.fresh.push({
        asset: asset.id,
        batch,
        lastFilterX: job.filterX,
        lastFilterZ: job.filterZ,
        mesh,
        threshold: asset.threshold,
      });
      job.published += 1;
      return;
    }
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

  /** One loaded model's drawable parts, or `undefined` when it carries nothing to draw. */
  #partsOf(model: Object3D | undefined): readonly IAssetPart[] | undefined {
    if (model === undefined) return undefined;
    const parts = renderableParts(model, (material) => this.#surfaceFor(material));
    if (parts.length === 0) {
      // Same as a refused load: counted, released, and the next acquire retries.
      this.#failures += 1;
      this.#failures += disposeModel(model);
      return undefined;
    }
    return parts;
  }

  /**
   * One part list per loaded model: level 0 is the asset's own shape, and every level below it
   * falls back to the one above when it did not load. `undefined` is the asset refusing to exist —
   * no `lod0` to fall back to — and the levels that did load are released rather than held by an
   * asset that draws nothing, cutout clones included. The refcounted state stays either way, so the
   * next acquire retries.
   */
  #adoptLevels(
    models: readonly (Object3D | undefined)[],
  ): readonly (readonly IAssetPart[])[] | undefined {
    const levels: (readonly IAssetPart[])[] = [];
    for (const [index, model] of models.entries()) {
      const level = this.#partsOf(model) ?? levels[index - 1];
      if (level === undefined) {
        this.#failures += disposeModels(models.slice(index));
        for (const parts of levels) this.#failures += this.#releaseParts(parts);
        return undefined;
      }
      levels.push(level);
    }
    return levels;
  }

  /**
   * An asset's levels are in, so every resident cell holding it needs its batches — queued, not
   * built. This is the path that used to be worst: adopting one asset rebuilt every resident cell's
   * batches for it in a single frame, and a 218-asset package pays it over and over as the ring
   * moves. The queue turns it into the same per-frame allowance every other admission path gets.
   */
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
        if (run.asset === asset.id) this.#queueBuild(asset, cell, run);
      }
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
   * Queue a refilter for every batch whose follow point has moved far enough to have crossed a
   * boundary: a cull distance, or one of the asset's `lods` switches. This is the same step the
   * `maxDistance` filter always took, with the level switch added to the distances it can be
   * crossed at, so there is still no per-frame refiltering pass.
   *
   * Two things keep that pass from costing a frame. A cell's placements all sit inside one
   * rectangle, so the two points that matter — where the batch was built and where the follow point
   * is now — bracket every distance a placement of that cell can have had; with no gate of the
   * asset in that span the level and cull answer is the same and the rebuild could change nothing,
   * and the position the batch was built from is kept so the next move is still measured from it.
   * What is genuinely stale is queued nearest cell first, `rebuildsPerUpdate` of them per call, and
   * the queue spends the frame's admission budget on them like any other build — so a refilter that
   * cannot be afforded this frame leaves the cell drawing the level it has, not a hole.
   */
  #updateMaxDistance(x: number, z: number): void {
    const stale: Array<{ cell: IResidentCell; distance: number; id: string }> = [];
    for (const cell of this.#resident.values())
      for (const job of this.#staleIn(cell, x, z)) stale.push({ cell, ...job });
    stale.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
    for (const job of stale.slice(0, this.#rebuildsPerUpdate)) {
      const asset = this.#assets.get(job.id);
      const run = job.cell.cell.runs.find((candidate) => candidate.asset === job.id);
      if (asset === undefined || asset.levels.length === 0 || run === undefined) continue;
      this.#queueBuild(asset, job.cell, run, true);
      this.#rebuilds += 1;
    }
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
          // Hand-placed chunks are the buildings and set dressing: full shape, so they cast with the
          // near scatter and receive like everything else when the game asks for shadows.
          if (this.#castShadowLevels > 0 || this.#receiveShadow)
            object.traverse((node) => {
              node.castShadow = this.#castShadowLevels > 0;
              node.receiveShadow = this.#receiveShadow;
            });
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
    // Work queued for a cell that has left is dropped, not resumed: a later frame would build
    // batches into a graph that no longer holds the cell, and the residency slot is already gone.
    this.#jobs = this.#jobs.filter((job) => {
      if (job.cell !== cell) return true;
      this.#queued.delete(`${cell.key}|${job.asset.id}`);
      return false;
    });
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

  /**
   * Release every part's shape and every surface it owns — its own material and, for a scattered
   * transparent part, the cutout clone made for it.
   *
   * At most once per resource, the same contract `release` gives the single-shape case: two parts
   * of one GLB routinely share a material, a level that fell back shares the level below's whole
   * part list, and every cell batch of the asset drew the same one. A clone is a resource this
   * class made, so it is released here and nowhere else.
   *
   * @returns how many teardowns threw, for the caller to count.
   */
  #releaseParts(parts: readonly IAssetPart[]): number {
    let failed = 0;
    for (const part of parts) {
      if (releasedParts.has(part)) continue;
      releasedParts.add(part);
      if (release(part.geometry)) failed += 1;
      failed += this.#releaseSurface(part.surface);
    }
    return failed;
  }

  /**
   * The shared surface for a material's content: the first material seen for a key becomes the
   * canonical one (converted to a cutout when it is transparent scatter), and every later material
   * with the same content is released on arrival and draws with it instead.
   */
  #surfaceFor(source: Material): { readonly key: string; readonly material: Material } {
    const key = materialKey(source);
    const shared = this.#surfaces.get(key);
    if (shared !== undefined) {
      shared.users += 1;
      if (!shared.owned.includes(source) && release(source)) this.#failures += 1;
      return { key, material: shared.material };
    }
    const drawn = scatterMaterial(source, this.#transparentScatter);
    this.#surfaces.set(key, { material: drawn.material, owned: drawn.owned, users: 1 });
    return { key, material: drawn.material };
  }

  /** One user gone; the last one tears the shared surface down. Returns teardowns that threw. */
  #releaseSurface(key: string): number {
    const shared = this.#surfaces.get(key);
    if (shared === undefined) return 0;
    shared.users -= 1;
    if (shared.users > 0) return 0;
    this.#surfaces.delete(key);
    let failed = 0;
    for (const material of shared.owned) if (release(material)) failed += 1;
    return failed;
  }

  #release(id: string): void {
    const asset = this.#assets.get(id);
    if (asset === undefined) return;
    asset.refcount -= 1;
    if (asset.refcount > 0) return;
    this.#assets.delete(id);
    asset.disposed = true;
    // The last cell drawing this asset is gone, so this is the one teardown its levels get. It is
    // also the one a lost device makes expensive, which is why every part goes through `release`:
    // at most once per resource, and a level that fell back shares the level below's parts, so one
    // shape is torn down once however many levels point at it. One refusal is counted per asset,
    // the way one refused `lod0` load was.
    const levels = asset.levels;
    asset.levels = [];
    let failed = 0;
    for (const parts of levels) failed += this.#releaseParts(parts);
    if (failed > 0) this.#failures += 1;
  }
}
