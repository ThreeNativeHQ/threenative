import {
  Box3,
  type BufferGeometry,
  Group,
  InstancedBufferAttribute,
  type InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  SkinnedMesh,
  Sphere,
  Vector3,
} from "three";
import { type IAssetLoader, createAssetLoader } from "./assets.js";
import type { IComputeDriven } from "./compute-driven.js";
import { InstancedBatch } from "./instanced-batch.js";
import { cutoutSurface } from "./render/foliage-alpha.js";
import { materialKey } from "./render/material-key.js";
import {
  advanceWriteEpoch,
  currentWriteEpoch,
  drainMeshPool,
  dropPooledFor,
  parkMesh,
  pooledMesh,
} from "./render/mesh-pool.js";
import type { IRendererLike } from "./renderer.js";
import { addInSlices, loadAll } from "./streaming.js";
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
 * How far the follow point has to move before a residency pass is worth repeating. Below it the
 * ring, the refilter brackets and every tile's LOD level are the same numbers, so the pass would
 * re-derive the set it already holds. Half a metre is under one 2 m heightmap cell and far under a
 * 128 m cell, so nothing that could change an answer is skipped.
 */
const SETTLED_FOLLOW_METRES = 0.5;
/**
 * Instance-matrix bytes a world keeps in released shared batches, oldest dropped first. A batch is
 * sized to its asset's largest cell times the resident cells, so on a 2 km package one runs 80 kB
 * median and 0.9 MB worst, and every key in the world at once is 26 MB. The budget holds the walk's
 * own back-traffic — a batch leaves when the last cell holding its asset leaves, and is wanted
 * again a few hundred metres back — and lets the rest go, so a session that crosses the whole map
 * does not carry the whole map.
 */
const RETIRED_SHARED_BYTES = 8_000_000;
/**
 * Records a retired batch's instance buffer is shrunk to; see `SharedBatch.park`.
 *
 * A released batch holds no records, so what keeping it is buying is the uuid three built a node for,
 * and the buffer is the whole of what that retention costs. At the batch's own ring capacity the
 * walk's back-traffic costs more than the byte budget holds, so the budget evicts the very keys a
 * walk is about to return to and the walk re-mints a mesh for each of them. Parked, a key costs
 * `PARKED_SHARED_CAPACITY` records; `rebind` puts the capacity back before anything is written.
 */
const PARKED_SHARED_CAPACITY = 1;
/**
 * Prewarmed batches minted per update, and the updates a minted batch must survive before it counts
 * as drawn. Three keys its render-object/node cache by `object.uuid`, so every InstancedMesh it has
 * never drawn costs a NodeBuilder build the first frame it is projected (~9 ms in the main pass, and
 * again in the shadow pass for a level that casts): hundreds of them land in a few seconds of
 * walking, which is the walk-time frame cost this pays earlier instead.
 *
 * The rate is a rate of *rendered* updates, not of `update` calls. Minting a batch is cheap (an
 * InstancedMesh and a zeroed buffer) and its build is paid by the next render, so an unbounded queue
 * would hand the whole map's seconds of builds to one frame. 8 per update is ~150 ms of build on the
 * frame that pays it, which the loading screen covers.
 */
const PREWARM_PER_UPDATE = 8;
/**
 * Two updates is the honest floor for "drawn at least once in both the main and the shadow
 * context": the mesh is added during one update and the next render projects it. Tracking it per
 * context would mean hooking the renderer, which this class does not own.
 */
const PREWARM_WARM_UPDATES = 2;
/**
 * The layer the level shadow cameras render and the main camera does not; see
 * `VirtualShadowNode`'s `VIRTUAL_SHADOW_CASTER_LAYER`. Duplicated from `index.ts` rather than
 * imported, because the world chunk is separate from the main one and this is the one value the two
 * halves of the cascade have to agree on.
 */
const VIRTUAL_SHADOW_CASTER_LAYER = 28;
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
    /**
     * @deprecated Accepted and ignored. Clusters replace it: what a shadow level submits is bounded
     * by the clusters its own window covers, not by a hand-tuned radius. It still validates, so a
     * game that set it keeps compiling and keeps loading.
     */
    readonly castDistance?: number;
    /**
     * Called at most once a second after streamed records changed, so the shadow levels that read
     * them redraw. `VirtualShadowNode.invalidateAll` is the whole of it, and a call with no region
     * is exactly that. Not called per frame, and not called at all when nothing changed.
     */
    readonly invalidate?: (region?: IShadowRegion) => void;
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
   * Seconds of motion to stream ahead of, default 1.5: the ring centres on where the follow point
   * will be (`position + velocity * prefetchSeconds`), so a fast camera finds cells already loaded
   * instead of outrunning them. The lead is capped at three quarters of the ring, so the cell the
   * follow point is in always stays resident. `0` streams around the follow point itself.
   */
  readonly prefetchSeconds?: number;
  /**
   * New batch meshes created per update, default 2. On WebGPU each new InstancedMesh builds its
   * own shader the first frame it draws (~10-20 ms of main thread), so a burst of first-seen assets
   * is spread over frames instead of stacked into one; recycled meshes are not counted.
   */
  readonly freshMeshesPerUpdate?: number;
  /**
   * Side of the world-grid square one shared batch's records are clustered into, in world units.
   * Defaults to the package's own `cellSize`, which is the square the placements are already cut
   * on. Each `(key, cluster)` is its own caster InstancedMesh with its own bounds on the shadow
   * caster layer, so a virtual-shadow level submits only the clusters its window covers. The main
   * pass keeps one mesh per `asset:level:part` whatever this is, so it costs main-pass draws
   * nothing. A larger square means fewer caster meshes and more of the world in every level render.
   */
  readonly clusterSize?: number;
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
  /**
   * Shared batches still to be minted, plus the ones minted and not yet drawn; `0` once
   * `prewarmed` has resolved.
   */
  readonly pendingPrewarm: number;
  /** Shared batches minted by the prewarm so far, cumulative. */
  readonly prewarmMinted: number;
  readonly evictions: number;
  /** Cumulative `maxDistance`/`lods` refilters performed, across every update. */
  readonly rebuilds: number;
  /**
   * Cumulative refilters whose rebuild held the same records and were settled without a write,
   * clear or compaction. A rising share of `rebuilds` is a follow point crossing a cell's distance
   * bracket rather than any placement crossing a gate.
   */
  readonly unchanged: number;
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
  readonly level: number;
  readonly part: number;
  /** How far the follow point has to move before this batch is refiltered, `undefined` never. */
  readonly threshold: number | undefined;
  /** The shared mesh this cell's instances are written into, and its segment there (-1: none). */
  shared: SharedBatch | undefined;
  segment: number;
  /**
   * The shadow-caster cluster this cell's records also go into, and its segment there (-1: none).
   * The main mesh is one per key and casts nothing; the same records are written into one mesh per
   * `(key, cluster)` on the caster layer, which is what a virtual-shadow level culls.
   */
  caster: SharedBatch | undefined;
  casterSegment: number;
  lastFilterX: number;
  lastFilterZ: number;
}

/** One key a loaded asset's levels contributed to the prewarm queue. */

/** One asset's placements, waiting to be built, or already holding their own cell's records. */
interface IPrewarmEntry {
  readonly asset: string;
  /** The follow point's own caster cluster, not the main pass's one mesh per key. */
  readonly caster: boolean;
  readonly geometry: BufferGeometry;
  readonly key: string;
  readonly level: number;
  readonly material: Material;
}

/**
 * A plain `{ min, max }` region, the shape a shadow level's invalidation reads and the shape a game
 * can be handed without importing three. Plain numbers, so the object a caller records its bounds
 * in is the object that crosses the boundary.
 */
export interface IShadowRegion {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/**
 * One asset part at one distance level, drawn for every resident cell by a single InstancedMesh.
 *
 * Each cell owns a block of the instance buffer, admitted as the count it needs and freed as one,
 * so the draw object count is per asset part and level rather than per cell: a 25-cell ring of a
 * 218-asset world was ~5,000 meshes and 20+ ms of CPU a frame in three's per-object render path.
 *
 * A shared batch packs its live instances at the front of the instance buffer, so `mesh.count` is
 * the live total. It used to be `(the highest used segment + 1) * segmentSize`, which drew every
 * zero-matrix slot of a partly filled segment and of every freed segment below the top one — tens of
 * thousands of slots per pass — and each empty slot still ran the vertex shader over the whole mesh
 * in the main pass and in every shadow pass. A block is now sized to its own cell's batch instead of
 * to the asset's largest cell, and a freed or shortened block is compacted into the lowest hole, so
 * the drawn range holds nothing but live records. The handles are opaque: `allocate` only hands one
 * back to `write` and `clear`.
 */
class SharedBatch {
  mesh: InstancedMesh;
  readonly #segmentSize: number;
  /** Block handle -> the block's first instance record. */
  readonly #start = new Map<number, number>();
  /** Block handle -> live records in it; the reserved count until `write` reports the real one. */
  readonly #size = new Map<number, number>();
  /** Free record ranges `[from, to)`, sorted, disjoint and never adjacent. */
  #free: Array<[number, number]> = [];
  #handles = 0;
  /** One past the last live record: the range `mesh.count` draws. */
  #drawn = 0;
  /** Block handle -> the AABB of the records it holds, and the union of those is the mesh's bounds. */
  readonly #boxes = new Map<number, Box3>();
  #localGeometry: BufferGeometry | undefined;
  readonly #localCenter = new Vector3();
  readonly #localHalf = new Vector3();
  readonly #union = new Box3();
  readonly #point = new Vector3();
  /** This batch's own pending upload span, and the `update` it was opened in. See `#touched`. */
  #pendingLow = 0;
  #pendingHigh = 0;
  #pendingEpoch = -1;

  constructor(
    geometry: BufferGeometry,
    material: Material,
    segmentSize: number,
    segments: number,
    name: string,
    bounds: Box3,
  ) {
    this.#segmentSize = Math.max(1, segmentSize);
    this.#bounds = bounds;
    this.mesh = SharedBatch.#meshFor(
      geometry,
      material,
      this.#segmentSize * segments,
      name,
      bounds,
    );
    this.#free = [[0, this.mesh.instanceMatrix.count]];
    this.#rebound();
  }

  /** The package extent, the conservative fallback when a part's own box cannot be read. */
  readonly #bounds: Box3;

  /**
   * Takes a pooled mesh with room for `capacity`, so a shared batch that outgrows its buffer keeps
   * the uuid — and the node three built for it — instead of getting a new one. Every field a pooled
   * mesh carries stale is written here, and the two shadow flags are set false because `grow` copies
   * them off the mesh it replaces and the world sets them per level.
   */
  static #meshFor(
    geometry: BufferGeometry,
    material: Material,
    capacity: number,
    name: string,
    bounds: Box3,
  ): InstancedMesh {
    const mesh = pooledMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.boundingBox = bounds.clone();
    mesh.boundingSphere = bounds.getBoundingSphere(mesh.boundingSphere ?? new Sphere());
    mesh.count = 0;
    mesh.visible = false;
    // Cullable, because the bounds are now this batch's own. Every camera three draws this mesh
    // with — the main one and each virtual-shadow level's — asks first, which is what stops a 48 m
    // shadow level from submitting every shared batch in the world.
    mesh.frustumCulled = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    (mesh.instanceMatrix.array as Float32Array).fill(0);
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  /** Point an empty batch at the parts a reload brought; see {@link rebind}. */
  rebind(geometry: BufferGeometry, material: Material): this {
    this.mesh.geometry = geometry;
    this.mesh.material = material;
    this.#localGeometry = undefined;
    if (this.#parked > 1) this.#resize(this.#parked);
    this.#rebound();
    return this;
  }

  /** The capacity this batch had when it was parked; see {@link park}. */
  #parked = 0;

  /**
   * Give up the instance buffer of a batch that holds no records, keeping the mesh.
   *
   * This is what makes a retained set affordable. Unparked, a walk's back-traffic costs a ring-sized
   * buffer per key, so `RETIRED_SHARED_BYTES` could hold only the last few dozen keys of a world with
   * hundreds of them, `#sharedFor` then found nothing to hand back, and the walk minted a second
   * mesh for every key it returned to. Parked, the same keys cost `PARKED_SHARED_CAPACITY` records
   * each and `rebind` gives the buffer back before the first record is written into it.
   */
  park(): this {
    this.#parked = this.mesh.instanceMatrix.count;
    if (this.#parked > PARKED_SHARED_CAPACITY) this.#resize(PARKED_SHARED_CAPACITY);
    return this;
  }

  /**
   * Swap in an instance buffer of `capacity` records, and with it the free range and the drawn count
   * the buffer is the record of. The mesh is off the world and holds no records when this runs, so
   * `#start`, `#size` and `#boxes` are already empty and the one free range is the whole buffer.
   */
  #resize(capacity: number): void {
    const mesh = this.mesh;
    mesh.instanceMatrix = new InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
    mesh.count = 0;
    this.#free = [[0, capacity]];
    this.#drawn = 0;
  }

  /**
   * The mesh's own extent, the union of the blocks' boxes, written on every add and remove. A union
   * over at most one box per resident cell is a few dozen comparisons, against a per-draw saving of
   * every batch the camera does not overlap. `#compact` moves records between slots but never between
   * blocks, so a block's box survives a compaction untouched.
   */
  #rebound(): void {
    const box = this.#union;
    let live = false;
    for (const one of this.#boxes.values()) {
      if (live === false) {
        box.copy(one);
        live = true;
      } else box.union(one);
    }
    if (live === false) box.copy(this.#bounds);
    (this.mesh.boundingBox as Box3).copy(box);
    this.mesh.boundingSphere = this.mesh.boundingSphere ?? new Sphere();
    box.getBoundingSphere(this.mesh.boundingSphere);
  }

  /**
   * The AABB of records `[from, from + count)` of the instance buffer, read from the bytes just
   * written rather than from the batch that wrote them, so it is the same numbers the GPU gets. The
   * half-extents are `|basis| * half`, which is the box a rotated or stretched instance of the part
   * actually covers — a translate-only box would let a scaled trunk through the shadow cull.
   */
  #boxOf(from: number, count: number): Box3 {
    const array = this.mesh.instanceMatrix.array as Float32Array;
    const geometry = this.mesh.geometry;
    if (this.#localGeometry !== geometry) {
      this.#localGeometry = geometry;
      if (geometry?.boundingBox === null || geometry?.boundingBox === undefined)
        geometry?.computeBoundingBox?.();
      const local = geometry?.boundingBox;
      // No readable local box means no readable instances either; the package extent is the answer
      // that cannot be wrong, and it is what these meshes carried before the blocks were sized.
      if (local === undefined || local === null || local.isEmpty()) return this.#bounds;
      this.#localCenter.copy(local.getCenter(this.#point));
      this.#localHalf.copy(local.getSize(this.#point)).multiplyScalar(0.5);
    }
    const cx = this.#localCenter.x;
    const cy = this.#localCenter.y;
    const cz = this.#localCenter.z;
    const hx = this.#localHalf.x;
    const hy = this.#localHalf.y;
    const hz = this.#localHalf.z;
    const out = new Box3();
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (let index = from; index < from + count; index += 1) {
      const at = index * 16;
      const m0 = array[at] as number;
      const m1 = array[at + 1] as number;
      const m2 = array[at + 2] as number;
      const m4 = array[at + 4] as number;
      const m5 = array[at + 5] as number;
      const m6 = array[at + 6] as number;
      const m8 = array[at + 8] as number;
      const m9 = array[at + 9] as number;
      const m10 = array[at + 10] as number;
      const px = m0 * cx + m4 * cy + m8 * cz + (array[at + 12] as number);
      const py = m1 * cx + m5 * cy + m9 * cz + (array[at + 13] as number);
      const pz = m2 * cx + m6 * cy + m10 * cz + (array[at + 14] as number);
      const ex = Math.abs(m0) * hx + Math.abs(m4) * hy + Math.abs(m8) * hz;
      const ey = Math.abs(m1) * hx + Math.abs(m5) * hy + Math.abs(m9) * hz;
      const ez = Math.abs(m2) * hx + Math.abs(m6) * hy + Math.abs(m10) * hz;
      if (px - ex < minX) minX = px - ex;
      if (py - ey < minY) minY = py - ey;
      if (pz - ez < minZ) minZ = pz - ez;
      if (px + ex > maxX) maxX = px + ex;
      if (py + ey > maxY) maxY = py + ey;
      if (pz + ez > maxZ) maxZ = pz + ez;
    }
    out.min.set(minX, minY, minZ);
    out.max.set(maxX, maxY, maxZ);
    return out;
  }

  /** A handle for `count` free records, or `undefined` when the buffer has none and must grow. */
  allocate(count: number): number | undefined {
    const at = this.#take(count);
    if (at < 0) return undefined;
    const handle = this.#handles;
    this.#handles += 1;
    this.#start.set(handle, at);
    this.#size.set(handle, count);
    return handle;
  }

  /**
   * Doubles the buffer in a new mesh (same data), returning the one it replaces for the pool.
   *
   * The replacement comes from the pool, and what it replaces is offered back to it, so the pair
   * costs one new uuid between them instead of one each. This used to push the old mesh onto an
   * unbounded `retired` array that nothing ever read and nothing ever freed.
   */
  grow(): InstancedMesh {
    const old = this.mesh;
    const mesh = SharedBatch.#meshFor(
      old.geometry,
      old.material as Material,
      old.instanceMatrix.count * 2,
      old.name,
      this.#bounds,
    );
    (mesh.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    mesh.castShadow = old.castShadow;
    mesh.receiveShadow = old.receiveShadow;
    mesh.count = old.count;
    this.mesh = mesh;
    this.#compact();
    // The whole drawn range, because this is a different buffer. `#meshFor` left the new
    // attribute's range list empty, and an empty list is how three is told "upload everything" — so
    // before the coalescing below, this was the whole buffer by default and the records copied out
    // of the old array reached the GPU. A narrow range here would leave the new buffer's first
    // records as the zeros it was created with.
    this.#touched(0, this.#drawn);
    this.#rebound();
    return old;
  }

  write(segment: number, batch: InstancedBatch): void {
    const start = this.#start.get(segment);
    const reserved = this.#size.get(segment);
    if (start === undefined || reserved === undefined) return;
    const array = this.mesh.instanceMatrix.array as Float32Array;
    const written = batch.writeMatrices(array, start);
    array.fill(0, (start + written) * 16, (start + reserved) * 16);
    if (written < reserved) this.#hole(start + written, start + reserved);
    this.#size.set(segment, written);
    // The block's extent, read from the records where they are now, because `#compact` is about to
    // move them. The box is keyed by handle, so the move cannot falsify it.
    if (written > 0) this.#boxes.set(segment, this.#boxOf(start, written));
    else this.#boxes.delete(segment);
    this.#compact();
    this.#touched(start, written);
    this.#rebound();
  }

  clear(segment: number): void {
    const start = this.#start.get(segment);
    if (start === undefined) return;
    const size = this.#size.get(segment) ?? 0;
    this.#start.delete(segment);
    this.#size.delete(segment);
    (this.mesh.instanceMatrix.array as Float32Array).fill(0, start * 16, (start + size) * 16);
    this.#hole(start, start + size);
    this.#compact();
    // The drawn range, not nothing. `#compact` closed the hole by moving the topmost block down
    // into it, so the bytes below `#drawn` changed and an empty range list is read by three as
    // "upload the whole buffer" — a ring-sized write to zero a block that is no longer drawn.
    this.#touched(0, this.#drawn);
    this.#boxes.delete(segment);
    this.#rebound();
  }

  /** The first free range with room for `count` records, taken out of the list; -1 when there is none. */
  #take(count: number): number {
    for (let index = 0; index < this.#free.length; index += 1) {
      const range = this.#free[index] as [number, number];
      const size = range[1] - range[0];
      if (size < count) continue;
      if (size === count) this.#free.splice(index, 1);
      else this.#free[index] = [range[0] + count, range[1]];
      return range[0];
    }
    return -1;
  }

  /** Records `[from, to)` back as free, merged with every range it touches. */
  #hole(from: number, to: number): void {
    if (to <= from) return;
    const free = this.#free;
    free.push([from, to]);
    free.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const range of free) {
      const last = merged[merged.length - 1];
      if (last !== undefined && range[0] <= last[1]) {
        if (range[1] > last[1]) last[1] = range[1];
        continue;
      }
      merged.push(range);
    }
    this.#free = merged;
  }

  /**
   * Closes every hole below the drawn range, so `mesh.count` is the live total: the topmost block
   * moves into the lowest hole, or, when it does not fit, everything above the hole shifts down over
   * it. Whatever sits past the topmost block is free again, so one cell's room serves the next cell
   * instead of a `grow`, and the free list is left as the single tail range `[drawn, capacity)`.
   */
  #compact(): void {
    const array = this.mesh.instanceMatrix.array as Float32Array;
    for (;;) {
      let drawn = 0;
      let top = -1;
      let topFrom = 0;
      for (const [handle, start] of this.#start) {
        const end = start + (this.#size.get(handle) ?? 0);
        if (end <= drawn) continue;
        drawn = end;
        top = handle;
        topFrom = start;
      }
      this.#drawn = drawn;
      const lowest = this.#free[0];
      if (top < 0 || lowest === undefined || lowest[0] >= drawn) break;
      const [holeStart, holeEnd] = lowest;
      const size = this.#size.get(top) ?? 0;
      if (size <= holeEnd - holeStart) {
        array.copyWithin(holeStart * 16, topFrom * 16, drawn * 16);
        this.#start.set(top, holeStart);
        if (holeEnd - holeStart > size) this.#free[0] = [holeStart + size, holeEnd];
        else this.#free.shift();
        this.#hole(topFrom, drawn);
        this.#drawn = holeStart + size;
        this.#touched(holeStart, size);
      } else {
        const shift = holeEnd - holeStart;
        array.copyWithin(holeStart * 16, holeEnd * 16, drawn * 16);
        this.#free.shift();
        for (const [handle, start] of this.#start) {
          if (start >= holeEnd) this.#start.set(handle, start - shift);
        }
        for (const range of this.#free) {
          if (range[0] >= holeEnd) {
            range[0] -= shift;
            range[1] -= shift;
          }
        }
        this.#drawn = drawn - shift;
        this.#touched(holeStart, this.#drawn - holeStart);
      }
    }
    const capacity = this.mesh.instanceMatrix.count;
    const free: Array<[number, number]> = [];
    for (const [from, to] of this.#free) {
      if (from < this.#drawn) free.push([from, to > this.#drawn ? this.#drawn : to]);
    }
    if (this.#drawn < capacity) free.push([this.#drawn, capacity]);
    this.#free = free;
  }

  /**
   * One coalesced upload per mesh, not one per moved, written or zeroed record range. Three's WebGPU
   * backend turns each entry of `updateRanges` into its own `GPUQueue.writeBuffer`, so the
   * per-range bookkeeping here was the walk's largest CPU cost: thousands of sub-1 KB vertex writes
   * per frame, over a second of a short walk spent on the queue. The dirty span is accumulated here
   * across every write, compact and clear of one update, so a frame that touches a mesh from
   * several directions still issues one writeBuffer. A span over half the drawn range becomes the
   * whole drawn range, which is never more bytes than the two halves it replaced.
   */
  #touched(from: number, count: number): void {
    const matrix = this.mesh.instanceMatrix;
    // A record is 16 array elements, and that is the unit `updateRanges` is in: three reads them
    // as element offsets into `array`, not as bytes.
    const drawn = this.#drawn * 16;
    const low0 = from * 16;
    const high0 = (from + count) * 16;
    // The pending span is ours, and it lasts one update. Three's WebGPU path uploads through the
    // interleaved buffer it derives from `instanceMatrix.array` and only that buffer's ranges are
    // cleared after the write, so the ranges on `instanceMatrix` are never consumed: they were
    // unioned in here forever, and after one wide write every later write re-uploaded the whole
    // drawn range. The epoch moves once per `update()`, and the render at the end of an update is
    // what consumes the span, so a fresh epoch is a fresh span.
    let low = low0;
    let high = high0;
    const epoch = currentWriteEpoch();
    if (this.#pendingEpoch === epoch) {
      if (this.#pendingLow < low) low = this.#pendingLow;
      if (this.#pendingHigh > high) high = this.#pendingHigh;
    }
    if (low > 0 && (high - low) * 2 > drawn) {
      low = 0;
      high = drawn;
    }
    this.#pendingLow = low;
    this.#pendingHigh = high;
    this.#pendingEpoch = epoch;
    matrix.clearUpdateRanges();
    if (high > low) matrix.addUpdateRange(low, high - low);
    matrix.needsUpdate = true;
    this.mesh.count = this.#drawn;
    this.mesh.visible = this.mesh.count > 0;
    // Records are real, so the bounds are the ones `#rebound` just wrote and the mesh goes back to
    // being culled.
    this.mesh.frustumCulled = true;
  }
}

/**
 * The `@x,z` half of a cluster key, for a cell index. `cellsPerCluster` squares of cells per
 * cluster, so the answer is stable for as long as the grid is: placements never move, so a record is
 * only ever clustered when the cell holding it is admitted or evicted.
 */
function clusterOf(cellX: number, cellZ: number, cellsPerCluster: number): string {
  return `${String(Math.floor(cellX / cellsPerCluster))},${String(Math.floor(cellZ / cellsPerCluster))}`;
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
  replaced: ICellBatch[];
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

/**
 * Model loads in flight for a streamed world. `loadAll`'s six suits a scene's one-off load; a
 * world crossing new asset types as it moves spends most of each load waiting on the network and
 * the transcoder workers, so more in flight keeps the ring ahead of a fast camera.
 */
const WORLD_LOAD_CONCURRENCY = 12;

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
 * @constraint model loads are bounded by `concurrency` (default 12) across every resident cell, not per cell
 * @constraint refilters are bounded by `rebuildsPerUpdate` (default 16) per update, nearest cell first
 * @constraint admission is bounded by `admissionBudgetMs` (default 2) per update across every path, and a deferred cell keeps drawing what it has
 * @constraint SkinnedMesh parts are skipped; an instanced copy would draw one rest pose
 * @override ring, budgets, terrain tile size/resolution, terrain stream and collider radius, `transparentScatter`, `clusterSize` and `shadows.invalidate`, load `concurrency`, `rebuildsPerUpdate`, `admissionBudgetMs` and the package's per-asset maxDistance
 * @constraint `prewarmed` resolves once every prewarmed shared batch has been drawn; a game with a loading screen waits on it, and `stats().pendingPrewarm` is the same gate as a number
 * @constraint every `asset:level:part` is one InstancedMesh for the main pass, plus one caster InstancedMesh per world-grid square of `clusterSize` on the shadow caster layer, so the main pass draws one mesh per key and a shadow level submits only the squares it covers
 * @constraint `shadows.castDistance` is accepted and ignored (clusters replaced it); `shadows.invalidate` is called at most once a second after streamed records changed
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
  readonly #prefetchSeconds: number;
  readonly #freshMeshesPerUpdate: number;
  /** Fresh meshes created this update, and whether a build waited for next frame's allowance. */
  #freshThisUpdate = 0;
  #meshStalled = false;
  /** Smoothed follow velocity (m/s) and the sample it was last updated from. */
  #velocityX = 0;
  #velocityZ = 0;
  #lastSample: { readonly x: number; readonly z: number; readonly t: number } | undefined;
  readonly #ring: number;
  readonly #terrain: TerrainTiles;
  readonly #transparentScatter: "cutout" | "blend";
  readonly #baseUrl: string;
  readonly #logicalBase: string;
  readonly #assets = new Map<string, IAssetState>();
  readonly #resident = new Map<string, IResidentCell>();
  /** Surfaces shared by material content across every asset part; see `materialKey`. */
  readonly #surfaces = new Map<string, ISharedSurface>();
  /** One shared mesh per `asset:level:part`, holding every resident cell's segment; see SharedBatch. */
  readonly #shared = new Map<string, SharedBatch>();
  /**
   * `asset:level:part` -> a released batch kept for the walk back over the same ground, oldest
   * first. `#release` used to throw the mesh away with the asset, so a cell that left the ring and
   * came back drew into a brand new one — a uuid three had never built a node for, in the main pass
   * and in every shadow pass, which is the walk-time frame cost the standing frame rate never pays.
   * The batch is empty by then (`#evict` clears a cell's own block before the refcount reaches
   * zero), so it is handed back whole; only its parts are gone, and `rebind` replaces them.
   */
  readonly #retired = new Map<string, SharedBatch>();
  #retiredBytes = 0;
  /**
   * Every `asset:level:part` of a loaded asset is minted empty, before any placement wants it, so
   * the node build lands in the loading phase instead of the frame a cell row first draws the key.
   * `#prewarmQueue` is the keys still to mint, `#prewarmKeys` the ones queued (a retried load must
   * not queue the same key twice), and `#prewarmPending` the ones minted but not yet
   * `PREWARM_WARM_UPDATES` updates old. `prewarmed` is the game's gate for "safe to show me this
   * world"; `stats().pendingPrewarm` is the same thing as a number.
   */
  readonly #prewarmQueue: IPrewarmEntry[] = [];
  readonly #prewarmKeys = new Set<string>();
  #prewarmPending = 0;
  /** Every mint so far, so a loading bar can read minted / (minted + pending). */
  #prewarmMinted = 0;
  /**
   * Minted meshes whose first draw has been submitted, and the meshes still owed one. A mint is
   * only half the work: the node is built when the mesh is first submitted, and that is the frame
   * the loading bar used to sit still for. `pendingPrewarm` reports this pair, so the bar counts the
   * draw half instead of jumping from minting straight to done. The gate is a promise about batches
   * (`#prewarmPending`), never about these: a companion no shadow level covers is owed a draw
   * forever, and the gate must not wait on it.
   */
  #prewarmOwed = 0;
  #prewarmDrawn = 0;
  #prewarmWait = 0;
  #prewarmSettled = false;
  #prewarmResolve: () => void = () => {
    // replaced in the field initialiser below, once `this` exists
  };
  readonly #prewarmed: Promise<void> = new Promise<void>((resolve) => {
    this.#prewarmResolve = resolve;
  });
  readonly #extentBounds: Box3;
  /** The largest run of each asset in any cell: the segment size every cell of it fits. */
  readonly #runMax = new Map<string, number>();
  /** How many of an asset's finest levels cast shadows; 0 when the game asked for none. */
  readonly #castShadowLevels: number;
  readonly #receiveShadow: boolean;
  /**
   * Side of a world-grid square, and how many cells fit in one. One `SharedBatch` per
   * `asset:level:part` per square, so the mesh's bounds are that square's records and every camera
   * culls at square granularity. A cell's placements never move, so a record's square is the one
   * its own cell sits in and nothing is ever re-clustered.
   */
  readonly #clusterSize: number;
  readonly #cellsPerCluster: number;
  /**
   * Streamed records changed since the shadow levels were last told, and when they were last told.
   * One blanket `invalidate` a second, and only for a game that passed the hook: the companions
   * used to make the hook necessary, and now the levels cull clusters themselves.
   */
  // `true` so the first `update` runs a residency pass: `#residencyStale` reads it, and a fresh
  // world has admitted nothing.
  #shadowMoved = true;
  #shadowToldAt = Number.NEGATIVE_INFINITY;
  /** The follow point the last full residency pass ran for; see `#residencyStale`. */
  readonly #residencyPoint = new Vector3(Number.NaN, 0, Number.NaN);
  /** The game's hook to refresh the shadow levels after streamed records changed. */
  readonly #invalidateShadows: ((region?: IShadowRegion) => void) | undefined;
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
  /** Refilters whose rebuild came back identical and were settled without a write. */
  #unchanged = 0;
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
    for (const cell of this.#cells)
      for (const run of cell.runs)
        this.#runMax.set(run.asset, Math.max(this.#runMax.get(run.asset) ?? 0, run.count));
    this.#cellSize = init.manifest.cellSize;
    this.#minX = init.manifest.extent.minX;
    const { extent, terrain } = init.manifest;
    // Scatter stands on the terrain: its height range, with headroom for tall trees and props.
    this.#extentBounds = new Box3(
      new Vector3(extent.minX, terrain.heightMin - 16, extent.minZ),
      new Vector3(extent.minX + extent.sizeX, terrain.heightMax + 64, extent.minZ + extent.sizeZ),
    );
    this.#minZ = init.manifest.extent.minZ;
    this.#placements = init.placements;
    this.#rebuildsPerUpdate = positiveInteger(init.rebuildsPerUpdate ?? 16, "rebuildsPerUpdate");
    this.#prefetchSeconds = init.prefetchSeconds ?? 1.5;
    this.#freshMeshesPerUpdate = positiveInteger(
      init.freshMeshesPerUpdate ?? 2,
      "freshMeshesPerUpdate",
    );
    if (!(this.#prefetchSeconds >= 0) || !Number.isFinite(this.#prefetchSeconds))
      throw new Error("WorldCells prefetchSeconds must be a finite number >= 0.");
    this.#baseUrl = init.baseUrl;
    this.#logicalBase = init.logicalBase;
    this.#loader = init.assets ?? createAssetLoader();
    this.#loadModel = init.loadModel;
    this.#limiter = new ModelLoadLimiter(
      positiveInteger(init.concurrency ?? WORLD_LOAD_CONCURRENCY, "concurrency"),
    );
    this.#transparentScatter = init.transparentScatter ?? "cutout";
    this.#castShadowLevels =
      init.shadows?.cast === true
        ? positiveInteger(init.shadows.castLevels ?? 1, "shadows.castLevels")
        : 0;
    this.#receiveShadow = init.shadows?.receive === true;
    // Validated and dropped. Clusters bound what a shadow level submits now, so a game that set
    // this keeps compiling and keeps loading; see the option's TSDoc.
    if (init.shadows?.castDistance !== undefined)
      positiveInteger(init.shadows.castDistance, "shadows.castDistance");
    this.#clusterSize =
      init.clusterSize === undefined
        ? this.#cellSize
        : positiveInteger(init.clusterSize, "clusterSize");
    // Rounded, so a cluster is a whole number of cells and a cell belongs to exactly one of them.
    this.#cellsPerCluster = Math.max(1, Math.round(this.#clusterSize / this.#cellSize));
    this.#invalidateShadows = init.shadows?.invalidate;
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
   * Resolves once every minted batch has been drawn at least once, main and shadow context.
   *
   * The loading gate a game with a loading screen waits on, so the shader builds the prewarm exists
   * to move happen behind it instead of in the first seconds of play. It counts updates the world
   * was in a scene for, because a batch added while the world is not in a scene is projected by
   * nothing and builds nothing. `dispose` settles it too: a world torn down mid-load must not leave
   * a game awaiting it forever.
   */
  get prewarmed(): Promise<void> {
    return this.#prewarmed;
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
   *
   * The residency pass itself is skipped while the follow point has moved less than half a metre
   * since the last one and nothing is pending (a load, a cell build, a deferred terrain admission, a
   * prewarm mint or a shadow level not yet told), because the pass would re-derive the set the
   * world already holds. The drain, the prewarm and the invalidation below it run every time.
   */
  update(renderer?: IRendererLike): void {
    if (this.#released) return;
    // A new upload epoch, so no batch's pending span outlives the render that consumed it. See
    // `SharedBatch#touched`.
    advanceWriteEpoch();
    const x = this.#follow.position.x;
    const z = this.#follow.position.z;
    const budget = new AdmissionBudget(this.#budgetMs, this.#now);
    this.#freshThisUpdate = 0;
    this.#meshStalled = false;
    // The residency pass is a function of the follow point, so a follow point that has not moved
    // and a world with nothing pending has the same answer as the last update: hundreds of cells
    // walked and re-sorted, every resident cell refiltered, every terrain tile re-levelled, all of
    // it to reach the set it already holds. Skipped while both hold. A move, a load, a build, a
    // deferred admission or a shadow level not yet told runs the pass exactly as before.
    if (this.#residencyStale(x, z)) {
      this.#residencyPoint.set(x, 0, z);
      try {
        this.#terrain.follow({ x, z }, budget);
        this.#terrain.process(renderer);
      } catch (error) {
        if (!(error instanceof TerrainTileBudgetError)) throw error;
        this.#pressure.bytes += 1;
      }
      const ahead = this.#ahead(x, z);
      this.#updateResidency(
        {
          x: Math.floor((ahead.x - this.#minX) / this.#cellSize),
          z: Math.floor((ahead.z - this.#minZ) / this.#cellSize),
        },
        ahead.x,
        ahead.z,
      );
      this.#updateMaxDistance(x, z);
    } else if (
      // A blend in flight is not a settled ring, and the blend is advanced by `process` alone —
      // `follow` only re-levels tiles. A follow point standing still used to skip both, so a
      // three-frame tile morph froze on its first frame until the player moved again. Only the
      // transition frames pay it: `blendingTiles` is 0 the rest of the time.
      this.#terrain.blendingTiles > 0
    ) {
      this.#terrain.process(renderer);
    }
    this.#drain(budget);
    // The prewarm runs outside the admission budget on purpose — it is not residency, it is the
    // shader builds the residency is about to need, and the allowance that spreads those is
    // `PREWARM_PER_UPDATE`.
    this.#drainPrewarm();
    // After the drain, so the levels are told about this update's records and not the last one's.
    this.#tellShadows();
    this.#admission = {
      backlog: this.#backlog(),
      deferred: this.#jobs.length,
      spentMs: budget.spentMs,
    };
  }

  /**
   * Does this update have to run the residency pass, or is the follow point still inside the half
   * metre it last moved less than and the world holding still?
   *
   * "Still" is every kind of work the pass exists to hand on: a model load in flight or queued, a
   * cell build in `#jobs` (which is also what queues refilters), a prewarm mint owed or in flight, a
   * terrain admission or collider the admission budget refused, and a companion that has not been
   * rebuilt since the follow point last moved. A world standing still on a loaded ring answers none
   * of those, so the pass is skipped; the first update after anything changes is a full pass again.
   */
  #residencyStale(x: number, z: number): boolean {
    if (Math.hypot(x - this.#residencyPoint.x, z - this.#residencyPoint.z) >= SETTLED_FOLLOW_METRES)
      return true;
    return (
      this.#limiter.inFlight > 0 ||
      this.#limiter.queued > 0 ||
      this.#jobs.length > 0 ||
      this.#prewarmQueue.length > 0 ||
      this.#prewarmPending > 0 ||
      this.#shadowMoved === true ||
      this.#terrain.deferredAdmissions > 0
    );
  }

  /**
   * Mint this update's prewarm allowance, then settle the readiness signal.
   *
   * A batch minted while the world is not in a scene is projected by nothing and builds nothing, so
   * the ready count only advances on an update that had somewhere to draw: a `load()` loop filling
   * the ring mints the whole ring and still leaves the gate shut, which is the honest answer.
   */
  #drainPrewarm(): void {
    if (this.#released) return;
    // The loading rate drops to the same 2-per-update a fresh mesh costs once the loading screen is
    // gone. 8 per update is ~150 ms of node builds on the frame that pays it, and the loading
    // screen is the only thing that was covering it: a walk that streams a new asset in afterwards
    // used to hand that frame's builds to a frame that is trying to hold its rate.
    const perUpdate = this.#prewarmSettled ? 2 : PREWARM_PER_UPDATE;
    let minted = 0;
    while (minted < perUpdate && this.#prewarmQueue.length > 0) {
      const entry = this.#prewarmQueue.shift() as IPrewarmEntry;
      this.#prewarmKeys.delete(entry.key);
      this.#mintPrewarm(entry);
      minted += 1;
    }
    // A minted companion is only *owed* a draw by `#awaitDraw`; nothing made the shadow levels draw
    // one. They render when their window moves or something invalidates them, and on a loading
    // screen the follow point stands still, so every companion minted after the first frame sat in
    // the graph with a built-in node that no level had ever asked for. The walk's first window move
    // then built all of them in one shadow pass. Invalidating on every minting update is what makes
    // the prewarm prewarm: the build is paid by the loading screen, which is the only frame rate
    // that was hiding it anyway.
    if (minted > 0) {
      this.#prewarmWait = 0;
      this.#invalidateShadows?.();
    } else if (this.parent !== null) this.#prewarmWait += 1;
    if (this.#prewarmQueue.length > 0 || this.#prewarmPending <= 0) return;
    if (this.#prewarmWait < PREWARM_WARM_UPDATES) return;
    this.#prewarmPending = 0;
    // The gate is settled, so nothing is owed a draw. A companion no shadow level covers leaves its
    // pair non-zero, and `pendingPrewarm` is documented `0` from here on.
    this.#prewarmOwed = 0;
    this.#prewarmDrawn = 0;
    this.#prewarmWait = 0;
    this.#settlePrewarm();
  }

  /**
   * The empty batch for one prewarmed key, built exactly as `#batchFor` builds the real one so a
   * placement that later wants it draws into this mesh and keeps the node three built for it. Both
   * halves of the split are queued: the main key, and the follow point's own caster cluster, which
   * is the one the first shadow level render asks for.
   */
  #mintPrewarm(entry: IPrewarmEntry): void {
    // A key the retained set is holding needs no prewarmed batch: `#batchFor` rebinds that mesh
    // when the walk comes back, and rebinding is the whole point of keeping it. The prewarm did not
    // ask, so it minted a second InstancedMesh for a key that already had one — a uuid three built a
    // node for twice, in the main pass and in every shadow pass, for the whole of a walk back.
    if (this.#released || this.#shared.has(entry.key) || this.#retired.has(entry.key)) return;
    const shared = new SharedBatch(
      entry.geometry,
      entry.material,
      this.#runMax.get(entry.asset) ?? 1,
      this.#budgets.residentCells + 1,
      entry.key,
      this.#extentBounds,
    );
    this.#dressMesh(shared.mesh, entry.caster, !entry.caster && this.#receiveShadow);
    shared.mesh.visible = true;
    this.#shared.set(entry.key, shared);
    this.add(shared.mesh);
    this.#prewarmPending += 1;
    this.#prewarmMinted += 1;
    // A main batch is owed a draw by `#awaitDraw`; nothing made a shadow level draw a caster, and
    // a caster never reaches the main pass, so the hook would wait on a draw that cannot happen.
    // The minting update invalidates the levels instead, which is what builds the caster's node.
    if (!entry.caster) this.#awaitDraw(shared.mesh);
  }

  /** Count this mesh's first submitted draw, once, then hand `onBeforeRender` back to whoever had it. */
  #awaitDraw(mesh: InstancedMesh | undefined): void {
    if (mesh === undefined) return;
    this.#prewarmOwed += 1;
    const own = mesh.onBeforeRender;
    const borrow = own as ((...args: unknown[]) => void) | undefined;
    mesh.onBeforeRender = ((...args: unknown[]): void => {
      this.#prewarmDrawn += 1;
      mesh.onBeforeRender = own;
      borrow?.(...args);
    }) as typeof mesh.onBeforeRender;
  }

  /**
   * Every level and every part of one asset, queued to be minted empty: the main key, and the one
   * caster cluster under the follow point. One square because a cluster per cell of the map would
   * be a prewarm of the whole package, and the squares a walk reaches first are minted by
   * residency, two an update.
   */
  #queuePrewarm(asset: IAssetState): void {
    for (const [level, parts] of asset.levels.entries()) {
      for (const [part, entry] of parts.entries()) {
        const key = `${asset.id}:${String(level)}:${String(part)}`;
        for (const caster of [false, true]) {
          // Only a level that casts has a caster half at all; see `#casts`.
          if (caster && !this.#casts(level)) continue;
          const name = caster ? `${key}@${this.#followCluster()}` : key;
          // A retained key is already paid for; see `#mintPrewarm`.
          if (this.#shared.has(name) || this.#retired.has(name) || this.#prewarmKeys.has(name))
            continue;
          this.#prewarmKeys.add(name);
          this.#prewarmQueue.push({
            asset: asset.id,
            caster,
            geometry: entry.geometry,
            key: name,
            level,
            material: entry.material,
          });
        }
      }
    }
  }

  #settlePrewarm(): void {
    if (this.#prewarmSettled) return;
    this.#prewarmSettled = true;
    this.#prewarmResolve();
  }

  process(renderer?: IRendererLike): void {
    this.update(renderer);
  }

  /**
   * Where the ring centres: the follow point led by its smoothed velocity. Samples closer than a
   * few milliseconds are the same frame and move nothing; a jump longer than the ring is a teleport
   * and resets the velocity rather than reading as speed.
   */
  #ahead(x: number, z: number): { x: number; z: number } {
    if (this.#prefetchSeconds === 0) return { x, z };
    const now = this.#now();
    const last = this.#lastSample;
    if (last === undefined) {
      this.#lastSample = { t: now, x, z };
    } else {
      const seconds = (now - last.t) / 1000;
      if (seconds >= 0.004) {
        const dx = x - last.x;
        const dz = z - last.z;
        if (Math.hypot(dx, dz) > this.#cellSize * this.#ring) {
          this.#velocityX = 0;
          this.#velocityZ = 0;
        } else {
          // ~0.25 s smoothing, so one jittery frame does not swing the ring.
          const blend = Math.min(1, seconds / 0.25);
          this.#velocityX += (dx / seconds - this.#velocityX) * blend;
          this.#velocityZ += (dz / seconds - this.#velocityZ) * blend;
        }
        this.#lastSample = { t: now, x, z };
      }
    }
    let leadX = this.#velocityX * this.#prefetchSeconds;
    let leadZ = this.#velocityZ * this.#prefetchSeconds;
    const limit = this.#cellSize * this.#ring * 0.75;
    const length = Math.hypot(leadX, leadZ);
    if (length > limit) {
      leadX *= limit / length;
      leadZ *= limit / length;
    }
    return { x: x + leadX, z: z + leadZ };
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
      // Minted meshes still owed a first draw, not minted meshes. The two used to be the same
      // number, so a loading bar read minting as the whole of the prewarm and then stood still for
      // the whole draw — the node builds a bar cannot show. The gate is a promise about batches, so
      // the settle zeroes this pair: `0` once `prewarmed` has resolved.
      pendingPrewarm: this.#prewarmQueue.length + this.#prewarmOwed - this.#prewarmDrawn,
      prewarmMinted: this.#prewarmMinted,
      pressure: { ...this.#pressure },
      rebuilds: this.#rebuilds,
      // The share of `rebuilds` the swap found unchanged, which is the honest report of how much of
      // the refilter pass is a bracket that was wider than any placement.
      unchanged: this.#unchanged,
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
    if (this.#drainShared() > 0) this.#failures += 1;
    // The batches `#drainShared` just retired. Their geometry and material were released by the
    // refcount path above, which is why they are disposed and not reused.
    for (const shared of this.#retired.values()) shared.mesh.dispose();
    this.#retired.clear();
    this.#retiredBytes = 0;
    // A world torn down mid-prewarm must not leave a game awaiting its gate.
    this.#prewarmQueue.length = 0;
    this.#prewarmKeys.clear();
    this.#settlePrewarm();
    drainMeshPool();
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
      // Out of fresh meshes this frame: later jobs would only stall the same way.
      if (this.#meshStalled) break;
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
    return this.#swap(job);
  }

  /**
   * Hand the cell its finished batches and take back the ones they replace, in one step.
   *
   * This is the no-hole rule. Attaching and detaching in the same synchronous block means no frame
   * ever shows the replacement beside the batch it replaces, and a refilter that waits three frames
   * for budget shows the level the cell already had for those three frames rather than nothing.
   */
  #swap(job: IBuildJob): boolean {
    const { cell } = job;
    // A refilter that rebuilt byte-for-byte the records the cell already draws must write, clear and
    // move nothing. `#staleIn` queues on the *cell's* distance bracket, which is wider than any one
    // placement's, so a rebuild whose level or cull answer did not move still comes back identical.
    // A matched pair is settled here instead: the outgoing entry keeps its block and its place in
    // the cell, only its filter point moves, so the next gate is measured from where the follow
    // point is now rather than from where it was when the answer was already right. Everything
    // else falls through to the swap below untouched.
    for (let index = job.fresh.length - 1; index >= 0; index -= 1) {
      const fresh = job.fresh[index] as ICellBatch;
      const at = job.replaced.findIndex(
        (old) =>
          old.level === fresh.level && old.part === fresh.part && old.batch.equals(fresh.batch),
      );
      if (at < 0) continue;
      const same = job.replaced.splice(at, 1)[0] as ICellBatch;
      this.#unchanged += 1;
      same.lastFilterX = fresh.lastFilterX;
      same.lastFilterZ = fresh.lastFilterZ;
      job.fresh.splice(index, 1);
    }
    // Every segment first, so a frame out of fresh meshes leaves the old batches drawing whole.
    for (const entry of job.fresh) {
      if (entry.batch.count === 0) continue;
      // Both halves for every fresh entry, whether or not a stalled frame already claimed one:
      // skipping an entry that has its main block meant the retry never asked for its cluster, so
      // those records reached the main pass and no shadow map.
      if (entry.segment < 0) {
        const shared = this.#sharedFor(job.asset.id, entry, cell);
        const segment = shared === undefined ? undefined : this.#segmentIn(shared, entry.batch.count);
        if (shared === undefined || segment === undefined) {
          this.#meshStalled = true;
          return false;
        }
        entry.shared = shared;
        entry.segment = segment;
      }
      // The caster cluster, when this level casts. A frame that runs out of fresh meshes between
      // the main mesh and its cluster leaves the main one drawing whole and takes the cluster next
      // frame, which is the same no-hole rule as above: never half a replacement.
      if (!this.#claimCaster(job.asset.id, entry, cell)) {
        this.#meshStalled = true;
        return false;
      }
    }
    for (const entry of job.replaced) {
      const at = cell.batches.indexOf(entry);
      if (at >= 0) cell.batches.splice(at, 1);
      this.#clearSegment(entry);
    }
    for (const entry of job.fresh) {
      cell.batches.push(entry);
      if (entry.shared !== undefined) entry.shared.write(entry.segment, entry.batch);
      if (entry.caster !== undefined) entry.caster.write(entry.casterSegment, entry.batch);
    }
    // A batch the walk just wrote to, cleared or compacted holds new records, so the shadow levels
    // that drew the old ones are stale. One flag, told at most once a second.
    if (job.fresh.length > 0 || job.replaced.length > 0) this.#shadowRecordsMoved();
    return true;
  }

  /**
   * Claim this cell's block in its caster cluster, when the level casts and it does not have one.
   * `false` means the frame's fresh allowance is spent and the swap waits, so the main mesh and its
   * cluster are never half attached.
   */
  #claimCaster(assetId: string, entry: ICellBatch, cell: IResidentCell): boolean {
    if (entry.casterSegment >= 0 || !this.#casts(entry.level)) return true;
    const caster = this.#casterFor(assetId, entry, cell);
    const at = caster === undefined ? undefined : this.#segmentIn(caster, entry.batch.count);
    if (caster === undefined || at === undefined) return false;
    entry.caster = caster;
    entry.casterSegment = at;
    return true;
  }

  #clearSegment(entry: ICellBatch): void {
    if (entry.shared !== undefined && entry.segment >= 0) entry.shared.clear(entry.segment);
    if (entry.caster !== undefined && entry.casterSegment >= 0)
      entry.caster.clear(entry.casterSegment);
    entry.shared = undefined;
    entry.segment = -1;
    entry.caster = undefined;
    entry.casterSegment = -1;
  }

  /**
   * One cell's records changed, so the shadow levels that cover it redraw — at most once a second,
   * and only for a game that passed the hook. The levels cull clusters themselves now, so nothing
   * has to be copied for them; the flag only says "what you last drew is out of date".
   */
  #shadowRecordsMoved(): void {
    this.#shadowMoved = true;
  }

  /**
   * Tell the shadow levels once, if anything changed and a second has passed.
   *
   * The companions used to make this the expensive call it still is; the levels redraw from
   * scratch, so the cadence is the only lever and once a second is the one that keeps a walk's
   * frames off the shadow lane without leaving the ground stale behind a player.
   */
  #tellShadows(): void {
    if (!this.#shadowMoved) return;
    // No hook means there is no level to tell, so the flag is discharged here. Leaving it set made
    // `#residencyStale` true forever, and every update ran a full residency pass on a world that had
    // nothing left to do.
    if (this.#invalidateShadows === undefined) {
      this.#shadowMoved = false;
      return;
    }
    const now = this.#now();
    if (now - this.#shadowToldAt < 1e3) return;
    this.#shadowToldAt = now;
    this.#shadowMoved = false;
    this.#invalidateShadows();
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
    const { asset } = job;
    let part = job.published;
    for (const [level, levelBatches] of batches.entries()) {
      if (part >= levelBatches.length) {
        part -= levelBatches.length;
        continue;
      }
      job.fresh.push({
        asset: asset.id,
        batch: levelBatches[part] as InstancedBatch,
        caster: undefined,
        casterSegment: -1,
        lastFilterX: job.filterX,
        lastFilterZ: job.filterZ,
        level,
        part,
        segment: -1,
        shared: undefined,
        threshold: asset.threshold,
      });
      job.published += 1;
      return;
    }
  }

  /** The main pass's one mesh for an asset part at a level, covering every resident cell. */
  #sharedFor(assetId: string, entry: ICellBatch, cell: IResidentCell): SharedBatch | undefined {
    return this.#batchFor(assetId, entry, this.#keyOf(entry), false, this.#receiveShadow);
  }

  /**
   * The shadow-caster cluster for one asset part at one level, or `undefined` when the level does
   * not cast or the frame's fresh allowance is spent.
   *
   * One per `(key, cluster)`, on `VIRTUAL_SHADOW_CASTER_LAYER` and off the main camera, so a level
   * culls the clusters its own window covers while the main pass keeps drawing one mesh per key.
   */
  #casterFor(assetId: string, entry: ICellBatch, cell: IResidentCell): SharedBatch | undefined {
    if (!this.#casts(entry.level)) return undefined;
    return this.#batchFor(
      assetId,
      entry,
      `${this.#keyOf(entry)}@${this.#clusterOf(cell)}`,
      true,
      false,
    );
  }

  /** `asset:level:part`, the main pass's one mesh per key. */
  #keyOf(entry: ICellBatch): string {
    return `${entry.asset}:${String(entry.level)}:${String(entry.part)}`;
  }

  /** The `@x,z` half of a caster cluster key, for a resident cell. */
  #clusterOf(cell: IResidentCell): string {
    return clusterOf(cell.x, cell.z, this.#cellsPerCluster);
  }

  /**
   * The shared batch for one key, created (a new mesh: counted against the frame's fresh allowance)
   * the first time any cell draws it. `undefined` means the allowance is spent and the caller waits
   * a frame. A caster batch carries the shadow flags and the caster layer; a main batch casts
   * nothing, because its records reach the shadow maps through the caster cluster.
   *
   * The buffer starts with a block per cell that can hold this key, plus the one a refilter holds
   * alongside the blocks it replaces — the cluster's own cells for a caster cluster, the whole ring
   * for the main pass's one mesh per key — not the eight it used to start with. Sizing a main batch
   * by its cluster's cells left it with two blocks for a ring of dozens, so a walk filled the
   * buffer, `grow` minted a fresh mesh — a uuid three had never built a node for, in every shadow
   * pass too — and put the old one in an array nothing ever read. Those two sizes are ceilings, so
   * this is what stops growing. Cost: a main buffer is ring-sized for assets that never fill it;
   * give `residentCells` a smaller value if that outweighs a re-mint.
   */
  #batchFor(
    assetId: string,
    entry: ICellBatch,
    key: string,
    caster: boolean,
    receiveShadow: boolean,
  ): SharedBatch | undefined {
    const existing = this.#shared.get(key);
    if (existing !== undefined) return existing;
    // The batch released when this asset's last cell left the ring is the one to draw into again,
    // so the mesh keeps the uuid and the node three built for it. It costs no fresh allowance,
    // because it is not a fresh mesh.
    const released = this.#retired.get(key);
    if (released !== undefined) {
      this.#retired.delete(key);
      this.#retiredBytes -= this.#heldBytes(released);
      released.rebind(entry.batch.geometry, entry.batch.material);
      released.mesh.name = key;
      this.#dressMesh(released.mesh, caster, receiveShadow);
      this.#shared.set(key, released);
      this.add(released.mesh);
      return released;
    }
    if (this.#freshThisUpdate >= this.#freshMeshesPerUpdate) return undefined;
    this.#freshThisUpdate += 1;
    const shared = new SharedBatch(
      entry.batch.geometry,
      entry.batch.material,
      this.#runMax.get(assetId) ?? entry.batch.count,
      // A caster cluster's block count is bounded by the cluster's own cells, the main pass's one
      // mesh per key by the ring; either way the one a refilter holds beside the block it replaces.
      caster
        ? this.#cellsPerCluster * this.#cellsPerCluster + 1
        : this.#budgets.residentCells + 1,
      key,
      this.#extentBounds,
    );
    this.#dressMesh(shared.mesh, caster, receiveShadow);
    this.#shared.set(key, shared);
    this.add(shared.mesh);
    return shared;
  }

  /**
   * The shadow half of the split. A caster mesh lives alone on `VIRTUAL_SHADOW_CASTER_LAYER` — the
   * level cameras draw it, the main camera never does — and never receives, because nothing but a
   * shadow level ever sees it. A main mesh keeps layer 0 and casts nothing: its records reach the
   * shadow maps only through the caster cluster, so the main pass pays one draw per key and a level
   * pays one per cluster its window covers.
   */
  #dressMesh(mesh: InstancedMesh, caster: boolean, receiveShadow: boolean): void {
    if (caster) {
      mesh.layers.set(VIRTUAL_SHADOW_CASTER_LAYER);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      return;
    }
    mesh.layers.set(0);
    mesh.castShadow = false;
    mesh.receiveShadow = receiveShadow;
  }

  /** The world-grid square the follow point is in, as the `@x,z` half of a cluster key. */
  #followCluster(): string {
    return clusterOf(
      Math.floor((this.#follow.position.x - this.#minX) / this.#cellSize),
      Math.floor((this.#follow.position.z - this.#minZ) / this.#cellSize),
      this.#cellsPerCluster,
    );
  }

  /** What a released batch costs to keep: its instance buffer, which is all of it. */
  #heldBytes(shared: SharedBatch): number {
    return (shared.mesh.instanceMatrix.array as Float32Array).byteLength;
  }

  /**
   * Keeps a released batch for the walk back, or drops it.
   *
   * Empty is the precondition, and `#evict` guarantees it: it clears a cell's own block before the
   * refcount falls, and the refcount is what calls this. A batch that still holds records means the
   * buffer state cannot be trusted, so it goes the same way as one over the byte budget.
   */
  #retire(key: string, shared: SharedBatch): void {
    if (shared.mesh.count > 0) {
      shared.mesh.dispose();
      return;
    }
    // Parked before the budget is measured, or the retained set is charged for buffers nothing keeps
    // and the byte budget evicts entries as they arrive — the walk then finds nothing to hand back
    // and mints a second mesh for every key it returns to.
    shared.park();
    const bytes = this.#heldBytes(shared);
    this.#retired.delete(key);
    this.#retired.set(key, shared);
    this.#retiredBytes += bytes;
    for (const [oldest, held] of this.#retired) {
      if (this.#retiredBytes <= RETIRED_SHARED_BYTES) break;
      this.#retired.delete(oldest);
      this.#retiredBytes -= this.#heldBytes(held);
      held.mesh.dispose();
    }
  }

  /**
   * Whether a level's own batches cast. Only the caster clusters ask; a main mesh never casts, so
   * the shadow map holds exactly the cluster meshes a level's window covers.
   */
  #casts(level: number): boolean {
    return this.#castShadowLevels > level;
  }

  /** A block in `shared` for one cell's `count` records, growing the buffer when it is full. */
  #segmentIn(shared: SharedBatch, count: number): number | undefined {
    const segment = shared.allocate(count);
    if (segment !== undefined) return segment;
    if (this.#freshThisUpdate >= this.#freshMeshesPerUpdate) return undefined;
    this.#freshThisUpdate += 1;
    const old = shared.grow();
    this.add(shared.mesh);
    // The mesh this grow replaced goes back to the pool: a cached shadow level can still replay a
    // draw of it until its window next moves, and the pool keeps the buffer and the uuid rather
    // than letting one array of retired meshes grow without bound.
    parkMesh(old);
    return shared.allocate(count);
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
    // Every level and part of the asset now, before any of them is asked for. A level with no
    // placement in it is not drawn and would otherwise mint its mesh — and pay its node build — on
    // the frame a walk first moves far enough to switch into it.
    this.#queuePrewarm(asset);
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
      // A swap that ran out of fresh meshes leaves its claims in `fresh`, which is not in
      // `cell.batches` until the swap completes. Dropping the job without handing those blocks back
      // keeps them reserved and unwritten, so `mesh.count` never falls to zero, the asset's release
      // retires a batch that still counts records and drops the key outright, and the walk back
      // mints a second mesh for it.
      for (const entry of job.fresh) this.#clearSegment(entry);
      return false;
    });
    for (const entry of cell.batches) this.#clearSegment(entry);
    // The same invalidation `#swap` makes, for the eviction path: the records that just left the
    // ring are ground the levels were drawing.
    this.#shadowRecordsMoved();
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
      // A parked mesh holds the part's own geometry and material, so once those are released the
      // parked mesh can never be handed out again — it would give the next cell that asks for one a
      // buffer waiting on a disposed resource. Dropped here, so it does not sit in the pool counting
      // against the meshes a walk can park.
      dropPooledFor(part.geometry, part.material);
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
    failed += this.#drainShared(id);
    for (const parts of levels) failed += this.#releaseParts(parts);
    if (failed > 0) this.#failures += 1;
  }

  /** Releases the shared meshes of one asset (or of every asset), keeping them for the walk back. */
  #drainShared(assetId?: string): number {
    const failed = 0;
    for (const [key, shared] of this.#shared) {
      if (assetId !== undefined && !key.startsWith(`${assetId}:`)) continue;
      shared.mesh.removeFromParent();
      this.#shared.delete(key);
      // Retired, not dropped, so the cell that comes back draws into the same mesh.
      this.#retire(key, shared);
    }
    return failed;
  }
}
