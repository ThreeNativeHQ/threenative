import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Frustum,
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
import { markEngineRenderHook } from "./engine-render-hook.js";
import { InstancedBatch } from "./instanced-batch.js";
import { mergeByMaterial } from "./merge-parts.js";
import { type ILodChain, lodChainOf } from "./model-lod.js";
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
import { markStatic } from "./static-transform.js";
import { addInSlices, loadAll } from "./streaming.js";
import { within, yieldToHost } from "./warmup.js";
import {
  DRAW_ARGS_BYTES,
  type IAssetSlot,
  type IMeshDraw,
  WorldGpuScene,
  gpuSceneRequested,
  gpuSceneValidationRequested,
} from "./world-gpu-scene.js";
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
/**
 * Bytes one merged chunk group may hold: 4 MiB, which is where a single first-draw upload stops
 * being a few milliseconds and becomes a frame.
 *
 * The 228.8 MB of `createAttribute` buffers a browser walk measured — 826 buffers, 33 over 1 MB,
 * the largest 23.2 / 18.1 / 17.2 / 16.4 MB — all arrived on the first draw of a merged chunk mesh,
 * and that first draw took up to 230 ms. A group is split rather than grown, so each of those
 * uploads is bounded and none of them is a stall.
 */
const CHUNK_MERGE_MAX_BYTES = 4 * 1024 * 1024;
/** Position (12) + normal (12) + uv (8) in float32: the three channels a merged group keeps. */
const CHUNK_MERGE_BYTES_PER_VERTEX = 32;
/** Vertices in 4 MiB of the above. The budget a chunk's material group is split on. */
const CHUNK_MERGE_MAX_VERTICES = CHUNK_MERGE_MAX_BYTES / CHUNK_MERGE_BYTES_PER_VERTEX;
/**
 * Triangles a chunk's merged material group may reach before one of its `InstancedMesh` is left
 * instanced instead. A merged group is one draw; past this many triangles the instanced draw is the
 * cheaper of the two, so the mesh is kept rather than expanded. It is the same 4 MiB counted in the
 * worst case, a de-indexed triangle of three 32-byte vertices, so the cap and the vertex budget above
 * are the one size read in two units. See `IWorldCellsLoadOptions.chunkMergeMaxTriangles`.
 */
const CHUNK_MERGE_MAX_TRIANGLES = Math.floor(
  CHUNK_MERGE_MAX_BYTES / (3 * CHUNK_MERGE_BYTES_PER_VERTEX),
);
/**
 * How long one chunk's warm-up may take before the chunk is attached uncompiled. The engine's own
 * loading-screen bound for a single pipeline is 2,000 ms, and a compile that outlives it is a
 * compile that is not coming back — which is a slow frame rather than a chunk that never appears.
 */
const CHUNK_WARM_TIMEOUT_MS = 2000;
/** The engine frame clock, for the warm-up's bound. */
const warmClock = (): number => globalThis.performance?.now() ?? Date.now();
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
 * How far the follow point has to move before the `maxDistance`/`lods` refilter pass runs again.
 * That pass walks every resident cell's batches, derives both distance brackets and sorts what it
 * found, and on a 2 km walk at 0.3 m a frame it ran every second frame for the same brackets — a
 * third of the world's `update`. Two metres is the same order as the per-asset hysteresis the pass
 * already applies (`threshold / 8`, 3.75 m for a 30 m gate), so a level switch or a cull lands
 * within about two metres of the distance that asked for it, on a level the player is still walking
 * toward. Raise it when a game's gates are far apart, lower it when placements sit inside one.
 */
const LEVEL_REFILTER_STEP_METRES = 2;
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
 * Updates a mesh may still be owed a prewarm draw after the gate settled before its borrow is handed
 * back anyway. An empty prewarmed batch draws, so this is the ceiling on the ones that never will —
 * a projection that collapsed the world, a camera that never reached the mesh — and not a diagnosis
 * of any of them. Without it those meshes would hold their hook for the whole walk.
 */
const PREWARM_RELEASE_UPDATES = 8;
/**
 * The projection a baked chain's levels are switched at when the world names none: 60° of vertical
 * field of view over 1080 raster rows, which is the desktop view a switch distance is a function of.
 * See `autoLod`.
 */
const DEFAULT_AUTO_LOD_FOV_Y = 60;
const DEFAULT_AUTO_LOD_VIEWPORT_HEIGHT = 1080;
/**
 * The screen-space error budget a baked chain's levels are switched at, in pixels, when the world
 * names none. See `IWorldCellsLoadOptions.autoLod`.
 */
const DEFAULT_AUTO_LOD_MAX_PIXEL_ERROR = 4;
/**
 * How far past the frustum a world-grid square is kept inside the main pass's draw window, in metres.
 *
 * The window is decided once per draw, from the camera that draw uses, and a square that has just
 * left the frustum is dropped from it — so a square at the frustum's edge would be drawn in one
 * frame and not the next, and a tree on that edge pops in at the edge of the screen. Growing each
 * square's box by this margin keeps a band of it in the window while it is still off screen, so a
 * tree crosses into view already there.
 *
 * An eighth of the default 64 m square is deliberately small. It has to exceed what a camera
 * travels between two draws — 8 m a frame is 480 m/s at 60 fps, so no playable camera reaches it —
 * and nothing more, because every metre of it is a metre of geometry the vertex stage still shades.
 */
const MAIN_CULL_PAD_METRES = 8;
/**
 * Side of the main cull's own visibility cell, in metres, when it divides the package's `cellSize`.
 *
 * This is the finest grid the main pass can cull on, and it is not a free parameter: a shared
 * batch's block is one *world* cell's records and placements never move, so a world cell cannot be
 * spread across two cells of a finer grid without giving every world cell its own block — one more
 * main mesh per key, which is the cost this whole cull exists to avoid. So a package whose
 * `cellSize` is not a whole multiple of 32 m falls back to its own `cellSize`, which is the square
 * its placements are already cut on, and the rule below is the whole of it.
 *
 * A visibility cell is a sub-square of the shadow caster's world-grid square, and it is deliberately
 * finer than that square: `clusterSize` is sized for how many meshes a shadow level submits, while
 * this is sized for how little geometry the vertex stage is handed. It is also the one volume the
 * cull tests, so everything in it — a 64 m cell's XZ and the Y its own placements and asset bounds
 * reach — is what a draw of that cell costs. See {@link WorldCells.#cullMainPass}.
 */
const MAIN_CULL_SQUARE_METRES = 32;
/**
 * How often `TN_WORLD_MAIN_CULL` is printed. Five seconds is a line a playtest capture can hold and
 * a walk long enough to see the window move; every frame is a wall of text over the marker it would
 * report on.
 */
const MAIN_CULL_MARKER_MS = 5e3;
/**
 * Assets reported one by one before the `TN_WORLD_LOD_CHAIN` marker collapses into a single line.
 * A 2 km package carries hundreds of chained assets, and a console line each is a wall of text that
 * buries the one that matters.
 */
const CHAIN_LOD_MARKER_LIMIT = 20;
/**
 * The layer the level shadow cameras render and the main camera does not; see
 * `VirtualShadowNode`'s `VIRTUAL_SHADOW_CASTER_LAYER`. Duplicated from `index.ts` rather than
 * imported, because the world chunk is separate from the main one and this is the one value the two
 * halves of the cascade have to agree on.
 */
const VIRTUAL_SHADOW_CASTER_LAYER = 28;
/**
 * The layer the wide shadow levels render and the fine ones do not: one caster mesh per
 * `asset:level:part` holding every cell's records, for a level whose window covers the whole
 * resident ring, where a cluster per square is a draw per square for the same pixels. Duplicated
 * from `index.ts` like the layer above, and a bit of its own so a level camera renders one caster
 * granularity or the other and never both.
 */
const VIRTUAL_SHADOW_WIDE_CASTER_LAYER = 27;
/**
 * The wide casters only the finest level renders: a fern's or a grass tuft's, whose shadow is
 * sub-texel noise past a few metres and whose per-key draw a 192 m or 640 m window was paying
 * hundreds of times for nothing. Duplicated from `virtual-shadow.ts` like the two layers above, and
 * chosen from the asset's own authored bounds rather than from what a game says, so a package
 * nobody has annotated still gets the cull. `shadows.smallCasterMetres` is the override.
 */
const VIRTUAL_SHADOW_SMALL_CASTER_LAYER = 26;
/** An asset shorter than this casts into the finest level only; see the layer above. */
const SMALL_CASTER_METRES = 1.5;
/** The whole ring, as one caster cluster: `@*` is every square's records in one mesh. */
const WIDE_CLUSTER = "*";
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
     *
     * When it is called about records, it is called with the union of the bounds of the records
     * that changed — the placement position widened by the asset's own bounds, unioned over the
     * records of this update and nothing else, so a hook that forwards it to
     * `VirtualShadowNode.invalidateRegion` redraws the levels whose window covers them and leaves
     * the rest of the cascade holding its maps. A call with no region is still a blanket one: the
     * prewarm passes it while a caster's first draw is owed, and there is no region for that.
     */
    readonly invalidate?: (region?: IShadowRegion) => void;
    /**
     * An asset whose authored bounds are shorter than this casts into the finest shadow level only,
     * default 1.5 m. Ground cover below it — ferns, grass, bushes — casts a shadow that is sub-texel
     * noise at every range a wide level covers, and costs one draw per key per level there. Raise it
     * to draw everything at every range, lower it to cull more. Measured on the authored bounds, so
     * a package that scales a fern up four times is judged on the un-scaled fern.
     */
    readonly smallCasterMetres?: number;
  };
  /**
   * Triangles a hand-placed chunk's merged material group may reach before one of its
   * `InstancedMesh` is left instanced. Defaults to 43,690, the same 4 MiB
   * budget the merged buffers are split on counted in the worst case, a de-indexed triangle: a merged
   * group is a single draw, so expanding into it wins until the merged geometry is too big for the
   * frame, and above it the instanced draw is the cheaper of the two. A group that crosses the budget
   * is split into several meshes in traversal order rather than grown, and an instanced shape over
   * 2,048 triangles is never expanded. Everything else in a chunk merges regardless — one mesh per
   * material, in the main pass and in every shadow pass that redraws it.
   */
  readonly chunkMergeMaxTriangles?: number;
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
  /**
   * The screen-space projection the extra levels of a baked AutoLOD chain are switched at, for an
   * asset whose `world.json` entry names no `lods` of its own.
   *
   * A chain measures its levels' geometric error in world units and the model runtime turns that
   * into pixels per frame; a batched draw cannot, so the same test is solved for distance once,
   * here, and every placement beyond it draws the next level. `fovY` is the vertical field of view
   * in degrees and `viewportHeight` the drawing-buffer height in raster pixels — a CSS height is the
   * wrong number, exactly as it is for the model runtime.
   *
   * Defaults are 60° over 1080 raster rows: a desktop view, and what the switch distance is a
   * function of. A world whose camera this class cannot see should pass its own, or a world with a
   * narrow field of view (a telephoto gun sight) or a tall window will switch earlier than its
   * pixels ask for. An asset with authored `lods` ignores all three numbers entirely: the package is
   * the authority on its own shape.
   *
   * `maxPixelError` is the error budget, in pixels, every synthesized level is selected against, and
   * it defaults to 4 rather than to the budget the asset's chain was registered with. The
   * registered budget is calibrated for a `ModelLod`, which picks a level for *one* mesh from where
   * that mesh is on screen; an instanced draw cannot, because every placement in the draw is at its
   * own distance and the draw is one call with one geometry. The batched answer has to be solved
   * once, for the whole key, which moves every switch distance outward by the ratio of the budgets —
   * and a 1 px budget is calibrated for a hero object filling the screen. At 1 px a tree's switches
   * land at 400–600 m on a 1080-row view, which on a 2 km map with a 640 m ring is past most of the
   * resident world: the levels are all there and none of them is ever selected, which is the same
   * full triangle bill the chain was added to remove. Four pixels puts the first switch inside the
   * ring, where it can actually do something.
   */
  readonly autoLod?: {
    readonly fovY?: number;
    readonly viewportHeight?: number;
    readonly maxPixelError?: number;
  };
  /**
   * The GPU-driven main pass: one compute dispatch culls and LOD-selects every resident placement
   * into a shared matrix buffer, and each main key draws its own region of it through an indirect
   * record. The CPU keeps only the coarse per-cell visibility, so a walking camera costs no repack
   * and no `maxDistance`/`lods` refilter.
   *
   * `false` by default, and `TN_GPU_SCENE=1` or `?tnGpuScene=1` turns it on: it needs compute,
   * storage buffers and `drawIndexedIndirect`, and a backend without them falls back to exactly
   * this class's CPU path — a lost saving, never a wrong picture. `stats().gpuScene` and the
   * `TN_WORLD_GPU_SCENE` line say which path a run took.
   */
  readonly gpuScene?: boolean;
  /**
   * Hold every dispatch's indirect args against the pure `cullAndSelect` reference and print the keys
   * that disagree. `false` by default, and `TN_GPU_SCENE_VALIDATE=1` or `?tnGpuSceneValidate=1` turns
   * it on.
   *
   * A readback is a queue submission and a mapped buffer, so this is a mode for answering "which key
   * draws fewer instances than the CPU path" and never a walk to be measured with.
   */
  readonly gpuSceneValidate?: boolean;
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
   * Cumulative refilter *passes* run, whether or not they queued a rebuild. The pass walks every
   * resident cell, derives both distance brackets and sorts what it found, so this is what says
   * whether a follow point standing inside the 2 m step paid for it; `rebuilds` only says whether it
   * was worth anything. See `LEVEL_REFILTER_STEP_METRES`.
   */
  readonly refilters: number;
  /**
   * Cumulative stale cell-assets the refilter passes found, across every update. The pass walks every
   * resident cell and gates it as a whole before it looks at one batch, so a follow point that has
   * crossed nothing leaves this still — which is what says the walk cost brackets and comparisons and
   * not allocations.
   */
  readonly refilterEntries: number;
  /**
   * Cumulative refilters whose rebuild held the same records and were settled without a write,
   * clear or compaction. A rising share of `rebuilds` is a follow point crossing a cell's distance
   * bracket rather than any placement crossing a gate.
   */
  readonly unchanged: number;
  readonly failures: number;
  /**
   * What the main-pass cull cost, cumulative, and the evidence that a settled camera costs nothing.
   *
   * `frustums` is one a frame that had a perspective camera — it used to be one per main mesh, ~230
   * of them on a 2 km walk. `windows` is how many of those meshes had to re-derive their window at
   * all, and `repacks` how many copied records: both are 0 on a frame where the visible squares did
   * not change and no record joined or left, which is what the two integer comparisons in
   * `SharedBatch.cullFrom` buy.
   */
  readonly mainCull: {
    readonly frustums: number;
    readonly windows: number;
    readonly repacks: number;
    readonly visibleEpoch: number;
  };
  /**
   * What the GPU-driven main pass is doing, and why it is not: `on` is the answer, `reason` is the
   * one line `TN_WORLD_GPU_SCENE` printed, and `dispatches` is what the walk actually paid for its
   * per-instance work. `mainCull.repacks` and `refilters` stay at `0` while it is on — that is the
   * CPU work it replaced, counted by the same counters that report it when it is off. `dressed` over
   * `meshes` is the marker line's own pair, and it is the one that says the scene has meshes to draw
   * with: an `on` with `0` dressed is a ring the CPU path is still drawing.
   */
  readonly gpuScene: {
    readonly on: boolean;
    readonly reason: string;
    readonly dispatches: number;
    /** Resident source records: one per placement, shared by every part of the level it reached. */
    readonly instances: number;
    readonly keys: number;
    readonly dressed: number;
    readonly meshes: number;
  };
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
  /**
   * The run these records came from. One cell can hold two runs of one canonical asset — two names
   * for the same model — and each builds its own, so a refilter and a rebuild have to know which of
   * the cell's entries belong to the run they are replacing.
   */
  readonly run: IWorldRun;
  readonly batch: InstancedBatch;
  readonly level: number;
  readonly part: number;
  /** How far the follow point has to move before this batch is refiltered, `undefined` never. */
  readonly threshold: number | undefined;
  /** The shared mesh this cell's instances are written into, and its segment there (-1: none). */
  shared: SharedBatch | undefined;
  segment: number;
  /**
   * The GPU scene's source records this entry draws from, shared by every part of its level, and
   * handed back by `#clearSegment`. `undefined` while the scene is off or the records are the
   * dispatches' own already — a record released twice is a no-op, which is what lets one list be
   * held by a whole level's parts.
   */
  gpu: number[] | undefined;
  /**
   * The shadow-caster cluster this cell's records also go into, and its segment there (-1: none).
   * The main mesh is one per key and casts nothing; the same records are written into one mesh per
   * `(key, cluster)` on the caster layer, which is what a virtual-shadow level culls.
   */
  caster: SharedBatch | undefined;
  casterSegment: number;
  /**
   * The wide-caster half, and its segment there (-1: none): the same records again, in one mesh per
   * key covering the whole ring, alone on the wide caster layer. A shadow level whose window covers
   * the ring would otherwise submit one cluster per square for the same pixels.
   */
  wide: SharedBatch | undefined;
  wideSegment: number;
  /**
   * The world bounds of the records this entry holds, from the filter that built it. The shadow
   * invalidation is the union of these over the entries a swap moved in and out, which is the point
   * of measuring them per record rather than per cell: a 48 m level's window is smaller than the
   * cell box, so the cell box always covered it and always redrew it.
   */
  shadowBounds: Box3 | undefined;
  lastFilterX: number;
  lastFilterZ: number;
}

/** The geometry and material one batch draws; a part is one of these plus what it does not need. */
type IBatchShape = Pick<IAssetPart, "geometry" | "material">;

/** One key a loaded asset's levels contributed to the prewarm queue. */

/** One asset's placements, waiting to be built, or already holding their own cell's records. */
interface IPrewarmEntry {
  readonly asset: string;
  /** Which half of the split this mesh is: the main pass's key, its caster cluster, or its wide. */
  readonly role: "cluster" | "main" | "wide";
  readonly geometry: BufferGeometry;
  readonly key: string;
  readonly level: number;
  readonly material: Material;
  /** The part of the level, which is the third half of a key's name. */
  readonly part: number;
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
 *
 * A **main** batch is `clustered`, and that changes the packing: its blocks are laid out grouped by
 * the world-grid square they sit in, the same square the caster clusters are keyed by, and
 * {@link SharedBatch.cullFrom} narrows `mesh.count` to the squares the main camera's frustum covers.
 * Three's whole-mesh frustum test cannot do this on its own — the bounds are the whole ring, so the
 * test always passes and every instance behind or beside the camera is vertex-shaded. See
 * {@link WorldCells.#cullMainPass} for which camera is allowed to decide.
 */
/**
 * A `SharedBatch`'s mesh plus the one field it publishes for a shadow level's size gate: the largest
 * instance scale any live record carries. Duck-typed rather than augmented into `three`, the same as
 * `isInstancedMesh` — `render/virtual-shadow.ts` reads it back off the mesh.
 */
interface ICasterScaleMesh extends InstancedMesh {
  casterInstanceScale: number;
}

/** One world-grid square's records in a clustered batch: how many of them there are. */
type ISquareSizes = Map<string, number>;

/**
 * The one buffer a clustered regroup permutes through.
 *
 * A regroup is a permutation of `[0, drawn)`, and there is no in-place order for one: putting the
 * visible squares at the front necessarily writes over squares that have not been copied out yet. A
 * snapshot is the honest way to do it — read every block into here, then write the new layout back —
 * and one buffer is enough for the whole world, because a regroup never nests and the largest
 * main batch is the only bound on it. Module-level like the upload epoch, because there is one world
 * drawing at a time.
 */
let regroupScratch = new Float32Array(0);

/** A scratch with room for `floats`, kept between regroups so a walk allocates it once. */
function scratchFor(floats: number): Float32Array {
  if (regroupScratch.length < floats) regroupScratch = new Float32Array(floats * 2);
  return regroupScratch;
}

/** The two scratch objects a cull builds its frustum in, and whether two square sets are the same. */
const _cullFrustum = new Frustum();
const _cullProjScreen = new Matrix4();
/** The corner one visibility cell's volume is widened by, for one placement at a time. */
const _cullPoint = new Vector3();

/** Records a square's blocks hold, which is its share of the batch. */
function sizeOf(square: { blocks: Array<[number, number, number, string]> }): number {
  let size = 0;
  for (const block of square.blocks) size += block[2];
  return size;
}

function sameSquares(next: Set<string>, was: Set<string> | undefined): boolean {
  if (was === undefined || was.size !== next.size) return false;
  for (const cluster of next) if (!was.has(cluster)) return false;
  return true;
}

class SharedBatch {
  mesh: ICasterScaleMesh;
  /** The pass this batch draws in; see `#dressMesh`. Only `main` is clustered. */
  readonly role: "cluster" | "main" | "wide";
  /**
   * Set by `WorldCells` from the asset's own bounds: a wide caster of ground cover goes on the
   * finest level's small-caster layer rather than the wide one. Written after construction because
   * `#segmentIn` re-dresses a grown mesh with nothing but the batch to hand, and a flag the batch
   * carries is the one thing that survives that.
   */
  smallCaster = false;
  /**
   * Set when the GPU scene owns this batch's draw, with the key it was minted under. See
   * `WorldCells#dressGpu`.
   *
   * It is a field rather than a name test because a dressed batch's `mesh.instanceMatrix` is the
   * scene's shared compaction buffer, and everything below writes records into that attribute: a
   * dressed batch keeps its bookkeeping and skips every byte of it, which is the whole of what the
   * `gpu` guards in `write`, `clear`, `#settle`, `#touched` and `#publish` are.
   */
  gpu:
    | {
        readonly asset: string;
        readonly level: number;
        readonly part: number;
        readonly key: string;
      }
    | undefined;
  /**
   * The same descriptor, recorded whether or not the GPU scene is on, which is the whole of what
   * lets a mesh minted before the scene came up be dressed after it: `gpu` says the mesh draws from
   * the scene's buffers, `main` says which key it would draw. A prewarm that mints a whole ring on a
   * loading screen mints it with the scene off, and the first frame with a renderer turns it on.
   */
  main:
    | {
        readonly asset: string;
        readonly level: number;
        readonly part: number;
        readonly key: string;
      }
    | undefined;
  readonly #clustered: boolean;
  readonly #segmentSize: number;
  /** Block handle -> the block's first instance record. */
  readonly #start = new Map<number, number>();
  /** Block handle -> live records in it; the reserved count until `write` reports the real one. */
  readonly #size = new Map<number, number>();
  /** Block handle -> the world-grid square it sits in; only a clustered batch records it. */
  readonly #blockCluster = new Map<number, string>();
  /** World-grid square -> its records in the buffer, so the window can be summed. See `#regroup`. */
  readonly #squareSizes: ISquareSizes = new Map();
  /** The squares the last cull kept, how many records of the batch they are, and whether that is current. */
  #visible: Set<string> | undefined;
  /** The `visibleEpoch` this batch last laid itself out at; see {@link SharedBatch.cullFrom}. */
  #packedEpoch = -1;
  /** Reused across culls, so a repack allocates no set. */
  #scratch: Set<string> = new Set();
  #window = 0;
  #narrowed = false;
  /**
   * A prewarmed batch whose first draw is still owed, so it is visible at count 0 until that draw
   * counts. The draw is the whole of the prewarm; see {@link #publish}.
   */
  #awaitingPrewarm = false;
  /** Free record ranges `[from, to)`, sorted, disjoint and never adjacent. */
  #free: Array<[number, number]> = [];
  #handles = 0;
  /** One past the last live record: the range the whole buffer holds. A clustered batch draws `#window`. */
  #drawn = 0;
  /** Block handle -> the AABB of the records it holds, and the union of those is the mesh's bounds. */
  readonly #boxes = new Map<number, Box3>();
  /** Block handle -> the largest instance scale in it; the union is published on the mesh. */
  readonly #scales = new Map<number, number>();
  /** Carried out of the last `#boxOf` pass, which already reads every record's basis. */
  #maxScale = 0;
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
    role: "cluster" | "main" | "wide",
  ) {
    this.role = role;
    this.#clustered = role === "main";
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
    this.#ceiling = this.mesh.instanceMatrix.count;
    this.#rebound();
  }

  /** This batch's own record ceiling; see {@link liveCeiling}. */
  #ceiling = 0;

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
  ): ICasterScaleMesh {
    const mesh = pooledMesh(geometry, material, capacity) as ICasterScaleMesh;
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
    // A pooled mesh arrives carrying the last user's scale; nothing lives here yet.
    mesh.casterInstanceScale = 0;
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
    this.#ceiling = capacity;
    this.#publish(0);
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
    // The size a per-instance shadow gate reads, published next to the mesh rather than asked for
    // again per level: the cluster's own sphere is ~24 m of grid square, so gating on it dropped
    // nothing, while a fern is 0.3 m and every fern cluster clears every coarse level.
    this.mesh.casterInstanceScale = live === false ? 0 : Math.max(...this.#scales.values());
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
    let scale = 0;
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
      // The largest column of the instance basis: the scale a fern or a trunk is drawn at.
      const basis = Math.max(
        Math.hypot(m0, m1, m2),
        Math.hypot(m4, m5, m6),
        Math.hypot(m8, m9, m10),
      );
      if (basis > scale) scale = basis;
    }
    this.#maxScale = scale;
    out.min.set(minX, minY, minZ);
    out.max.set(maxX, maxY, maxZ);
    return out;
  }

  /** A handle for `count` free records, or `undefined` when the buffer has none and must grow. */
  allocate(count: number, cluster?: string): number | undefined {
    const at = this.#take(count);
    if (at < 0) return undefined;
    const handle = this.#handles;
    this.#handles += 1;
    this.#start.set(handle, at);
    this.#size.set(handle, count);
    // Only a clustered batch groups, so only it pays for the lookup. The square is the caller's
    // cell's, and a cell's placements never move, so a record is only ever grouped when the cell
    // holding it is admitted or evicted.
    if (this.#clustered && cluster !== undefined) this.#blockCluster.set(handle, cluster);
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
    this.mesh = mesh;
    this.#ceiling = mesh.instanceMatrix.count;
    this.#settle();
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
    if (this.gpu !== undefined) {
      // The records themselves are the GPU scene's, written by its dispatch from the source buffer;
      // what the coarse per-cell gate and the counters need is the per-square count and the total.
      const cluster = this.#blockCluster.get(segment) ?? "";
      this.#size.set(segment, batch.count);
      this.#squareSizes.set(cluster, (this.#squareSizes.get(cluster) ?? 0) + batch.count);
      this.#drawn += batch.count;
      this.#publish(this.#drawn);
      return;
    }
    const array = this.mesh.instanceMatrix.array as Float32Array;
    const written = batch.writeMatrices(array, start);
    array.fill(0, (start + written) * 16, (start + reserved) * 16);
    if (written < reserved) this.#hole(start + written, start + reserved);
    this.#size.set(segment, written);
    // The block's extent, read from the records where they are now, because `#compact` is about to
    // move them. The box is keyed by handle, so the move cannot falsify it.
    if (written > 0) {
      this.#boxes.set(segment, this.#boxOf(start, written));
      this.#scales.set(segment, this.#maxScale);
    } else {
      this.#boxes.delete(segment);
      this.#scales.delete(segment);
    }
    this.#settle();
    this.#touched(start, written);
    this.#rebound();
  }

  clear(segment: number): void {
    const start = this.#start.get(segment);
    if (start === undefined) return;
    const size = this.#size.get(segment) ?? 0;
    if (this.gpu !== undefined) {
      // The mirrored half of `write`: the coarse gate and the live total follow the records that left,
      // and no byte of the shared buffer is touched, because none of them were ever in it.
      const cluster = this.#blockCluster.get(segment) ?? "";
      this.#squareSizes.set(cluster, Math.max(0, (this.#squareSizes.get(cluster) ?? 0) - size));
      this.#drawn -= size;
    }
    this.#start.delete(segment);
    this.#size.delete(segment);
    this.#blockCluster.delete(segment);
    if (this.gpu !== undefined) {
      this.#publish(this.#drawn);
      return;
    }
    (this.mesh.instanceMatrix.array as Float32Array).fill(0, start * 16, (start + size) * 16);
    this.#hole(start, start + size);
    this.#settle();
    // The drawn range, not nothing. `#compact` closed the hole by moving the topmost block down
    // into it, so the bytes below `#drawn` changed and an empty range list is read by three as
    // "upload the whole buffer" — a ring-sized write to zero a block that is no longer drawn.
    this.#touched(0, this.#drawn);
    this.#boxes.delete(segment);
    this.#scales.delete(segment);
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
   * Close the holes a write, a clear or a grow left, the way this batch's role needs.
   *
   * A caster batch compacts: one square holds the key's records, so the lowest hole is where the
   * topmost block belongs. A main batch regroups instead, because compaction would carry a block
   * away from the square it belongs to and the frustum test reads the squares.
   */
  #settle(): void {
    if (this.#clustered) {
      this.#regroup();
      // Records moved, so `mesh.count` is the live total again and the window has to be re-narrowed
      // by the next draw — with no copy, because the regroup just put the squares in place.
      this.#narrowed = false;
    } else this.#compact();
  }

  /**
   * Lay every live block out again, grouped by its world-grid square, `visible`'s squares first.
   *
   * A regroup is a permutation of `[0, drawn)` and there is no in-place order for one: writing the
   * visible squares to the front necessarily lands on squares whose records have not been read out
   * yet, in either direction. So every block is copied into {@link regroupScratch} and the new order
   * is copied back — two passes over the drawn range, and only when a square entered or left the
   * window, which on a settled camera is not once a frame.
   *
   * Squares keep their relative order within each half, so a residency change regroups in place and
   * a cull that found the same set writes nothing. What each square holds is recorded here, because
   * that is the only per-key data the window needs: the squares' world volumes belong to the grid,
   * not to a key, and are derived once a frame for all of them. See {@link WorldCells.#cullMainPass}.
   *
   * Only the records that actually moved are handed to the upload, and on a walk that is usually the
   * tail or nothing at all: the squares that stayed in the half they were in keep their offsets
   * exactly, so a square crossing the boundary between the two halves moves the records from there
   * to the boundary and leaves `[0, boundary)` byte-identical. Uploading `[0, drawn)` instead — which
   * is what this did — re-sent a whole key's records to the GPU on every frame the window moved,
   * which on a walking camera is most frames, and on the largest key in a 2 km walk measured
   * **37 draws over 7 ms each**. An identity reorder now costs no bytes at all, and the rest costs
   * the span that moved; `#touched` still widens a span over half the drawn range, so the ranges
   * stay few and large rather than many and small.
   */
  #regroup(visible = this.#visible): void {
    const array = this.mesh.instanceMatrix.array as Float32Array;
    const squares = this.#squares();
    let total = 0;
    for (const square of squares) total += sizeOf(square);
    const scratch = scratchFor(total * 16);
    // The visible squares first. `filter` is stable, so both halves keep the order the buffer had
    // them in and a residency change lays out exactly what the last one did.
    const front = squares.filter((one) => visible?.has(one.cluster) ?? true);
    const back = squares.filter((one) => !(visible?.has(one.cluster) ?? true));
    let written = 0;
    // Where the layout departed from the one the GPU holds: the first record written somewhere other
    // than where it was read from, and the last one after it. `-1` until something moves, so an
    // identity reorder touches nothing.
    let movedFrom = -1;
    let movedTo = 0;
    this.#squareSizes.clear();
    for (const square of [...front, ...back]) {
      const union = new Box3();
      for (const [handle, start, count] of square.blocks) {
        scratch.set(array.subarray(start * 16, (start + count) * 16), written * 16);
        // Read before it is overwritten: a block written back to its own offset is a record the GPU
        // already holds, and is the whole difference between a repack that costs nothing and one
        // that re-uploads the key.
        if (this.#start.get(handle) !== written) {
          if (movedFrom < 0) movedFrom = written;
          movedTo = written + count;
        }
        this.#start.set(handle, written);
        const box = this.#boxes.get(handle);
        // A fresh `Box3` is already empty, so the first block's box is the square's and every block
        // after it unions into it.
        if (box !== undefined) union.union(box);
        written += count;
      }
      this.#squareSizes.set(square.cluster, sizeOf(square));
    }
    array.set(scratch.subarray(0, written * 16));
    this.#drawn = written;
    const capacity = this.mesh.instanceMatrix.count;
    this.#free = written < capacity ? [[written, capacity]] : [];
    this.#window = this.#windowOf(visible);
    // After `#drawn`, because `#touched` measures the span it may widen against the drawn range, and
    // before the caller's own `#touched`, which the epoch unions with it rather than replacing it.
    if (movedFrom >= 0) this.#touched(movedFrom, movedTo - movedFrom);
  }

  /**
   * The live blocks, in buffer order and gathered into the squares they belong to.
   *
   * Buffer order is what "the squares keep their relative order" means, and it is not the order of
   * `#start`, which is keyed by handle rather than by position. A square's blocks are only adjacent
   * because the last regroup made them so — a cell admitted after that lands anywhere in the free
   * tail — so the squares are gathered here and written out by {@link #regroup}, and it is these
   * two orders that a residency change has to preserve.
   */
  #squares(): Array<{ cluster: string; blocks: Array<[number, number, number, string]> }> {
    const blocks: Array<[number, number, number, string]> = [];
    for (const [handle, start] of this.#start) {
      const size = this.#size.get(handle) ?? 0;
      if (size > 0) blocks.push([handle, start, size, this.#blockCluster.get(handle) ?? ""]);
    }
    blocks.sort((a, b) => a[1] - b[1]);
    const squares: Array<{ cluster: string; blocks: typeof blocks }> = [];
    const squareOf = new Map<string, number>();
    for (const block of blocks) {
      const cluster = block[3] as string;
      const index = squareOf.get(cluster);
      if (index === undefined) {
        squareOf.set(cluster, squares.length);
        squares.push({ cluster, blocks: [block] });
        continue;
      }
      (squares[index] as { blocks: typeof blocks }).blocks.push(block);
    }
    return squares;
  }

  /** Records of the squares in `visible`, the count a clustered batch's `mesh.count` draws. */
  #windowOf(visible: Set<string> | undefined): number {
    if (visible === undefined) return this.#drawn;
    let window = 0;
    for (const [cluster, size] of this.#squareSizes) if (visible.has(cluster)) window += size;
    return window;
  }

  /**
   * Narrow the draw window to the visibility cells `visible` names, rewriting the instance buffer
   * when this batch's own share of that set changed. `settled` when nothing had to be looked at,
   * `narrowed` when the count was re-widened, `repacked` when records were copied.
   *
   * `visible` and `epoch` are the frame's answer, derived once for the whole main pass by
   * {@link WorldCells.#cullMainPass}: one frustum, one set of visible visibility cells, and an epoch
   * that only moves when that set did. A batch whose records have not moved since it last packed at
   * that epoch answers `false` from two integer comparisons — no frustum, no set, no copy — which is
   * the whole of a settled frame across the ~230 meshes of a 2 km walk. Before that it was every
   * batch rebuilding a frustum from the same camera, allocating a set and re-testing its own per-key
   * volumes: ~4 ms a frame of `compute` for an answer that had not changed.
   *
   * Three's whole-mesh test cannot do this at all: the mesh's bounds are every resident cell's, so on
   * a 640 m ring the test always passes and every instance behind or beside the camera is
   * vertex-shaded — which on a tree-heavy 2 km map is most of a 65 M-triangle main pass, and the
   * whole cost of it is vertex work that half resolution does not touch.
   *
   * The cells are the main cull's own and the volumes are per placement (see
   * {@link WorldCells.#cullMainPass}), which is what this narrowness is spent on: a cell's XZ is
   * one world cell rather than a 128 m caster square, and its Y is the height its own placements
   * reach rather than the whole map's terrain range.
   *
   * A draw that finds the same cells it found last time touches nothing at all: no copy, no
   * `needsUpdate`, and therefore no attribute version — which is what a settled static draw watches
   * to know it still has to scan.
   */
  cullFrom(visible: ReadonlySet<string>, epoch: number): "settled" | "narrowed" | "repacked" {
    if (!this.#clustered) return "settled";
    // A batch holding no square draws nothing whatever the camera found, so it is published empty
    // and takes no set and no scan — a prewarmed batch sits in exactly this state.
    if (this.#squareSizes.size === 0) {
      this.#publish(0);
      return "settled";
    }
    // Settled: the frame's set is the one this window was laid out at and no record joined or left
    // since. O(1), and no allocation of any kind.
    if (this.#narrowed && this.#packedEpoch === epoch) return "settled";
    const next = this.#scratch;
    next.clear();
    for (const square of this.#squareSizes.keys()) if (visible.has(square)) next.add(square);
    // The same squares as the buffer holds: a residency change or a square elsewhere entering and
    // leaving the view. The layout is already right, so the window only has to be re-narrowed — a
    // residency change left `mesh.count` at the live total, and `#settle`'s regroup put the squares
    // in the window's order with no copy.
    if (sameSquares(next, this.#visible)) {
      this.#publish(this.#window);
      this.#narrowed = true;
      this.#packedEpoch = epoch;
      return "narrowed";
    }
    this.#regroup(next);
    // The reorder hands its own upload, over the records that actually moved — a window that moved
    // a square across the half boundary and left every record where it was costs nothing here, which
    // is the walking camera's common case. See `#regroup`.
    // The layout now belongs to the other set, so the two trade places and the next cull reuses the
    // one this batch is no longer holding.
    const was = this.#visible;
    this.#visible = next;
    this.#scratch = was ?? new Set();
    this.#scratch.clear();
    // `#publish` is what hides a window the camera narrowed to nothing, and what shows it again when
    // the camera turns back.
    this.#publish(this.#window);
    this.#narrowed = true;
    this.#packedEpoch = epoch;
    return "repacked";
  }

  /** Live records this batch holds, whether the camera is drawing them or not. */
  get live(): number {
    return this.#drawn;
  }

  /**
   * The record ceiling of this batch's *own* buffer, which is what a key's GPU region is sized from:
   * the same ring-sized ceiling the CPU path stops growing at. Held rather than read, because a
   * dressed batch's `mesh.instanceMatrix` is the GPU scene's shared buffer and its count is that
   * buffer's, not this key's.
   */
  get liveCeiling(): number {
    return this.#ceiling;
  }

  /** Records `mesh.count` draws: every live one, until a cull narrows the window. */
  get drawn(): number {
    return this.#clustered ? this.#window : this.#drawn;
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
    // A dressed batch's records were never in this attribute, so there is nothing to upload and
    // nothing to put back in charge of culling: the dispatch decided what it drew.
    if (this.gpu !== undefined) return;
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
    this.#publish(this.#drawn);
    // Records are real, so the bounds are the ones `#rebound` just wrote and the mesh goes back to
    // being culled.
    this.mesh.frustumCulled = true;
  }

  /**
   * The one place `mesh.count` is written, so a batch that would draw nothing is not submitted.
   *
   * In three r185's WebGPU path an `InstancedMesh` with `count === 0` still runs the whole per-draw
   * JS chain — nodes, bindings, pipeline, attributes — and only the backend's `getDrawParameters`
   * finally answers null. A walk census measured 322 of 871 main batch meshes and 437 of 1,574
   * caster meshes at count 0, so every empty batch was ~17 µs of CPU a frame for nothing drawn.
   * `visible` is the one flag three reads before any of that, so a batch with nothing to draw is
   * hidden here and shown again by the first write that gives it a record: a placement add, a
   * rebind of a retained batch, a residency change, or the main cull's window opening again.
   *
   * The exception is a batch still owed its prewarm draw, which stays visible *because* it is empty:
   * that one draw is what builds the node and the pipeline the loading screen exists to pay for,
   * and hiding it would hand the build to the first walk frame that wants the key. It hides as soon
   * as the draw is counted — see {@link prewarmDrew} — so this costs one zero-count draw per
   * prewarmed batch over the whole load, which is the cost the prewarm is for.
   */
  #publish(count: number): void {
    this.mesh.count = count;
    // A dressed batch's instances are the GPU scene's, and its own count says nothing about how many
    // of them the dispatch kept — so the coarse per-cell gate in `visibleFrom` is what shows it. The
    // one exception is the prewarm draw, which stays visible *because* it is empty: that submission
    // is what builds the node and the pipeline.
    if (this.gpu !== undefined) {
      this.mesh.visible = this.#awaitingPrewarm;
      return;
    }
    this.mesh.visible = count > 0 || this.#awaitingPrewarm;
  }

  /**
   * The GPU-driven main pass's coarse gate: one boolean per key a frame, from the same visibility
   * cells, with no window, no copy and no upload. A key holding no visible cell draws nothing, and
   * one holding any of them draws what the dispatch kept — which is the whole of what the CPU
   * decides while the GPU decides the rest. See `WorldCells#cullMainPass`.
   */
  visibleFrom(visible: ReadonlySet<string>): void {
    if (this.gpu === undefined || this.#clustered === false) return;
    let shown = this.#awaitingPrewarm;
    for (const square of this.#squareSizes.keys())
      if (visible.has(square)) {
        shown = true;
        break;
      }
    this.mesh.count = this.#drawn;
    this.mesh.visible = shown;
  }

  /**
   * Owe this batch its prewarm draw, and show it: empty, unsubmitted work is not what a prewarm
   * wants, one submission is.
   *
   * The flag on the mesh is what `VirtualShadowNode`'s `#probe` reads: a caster is drawn by a level,
   * and a level picks one of the two caster layers, so a level that finds an owed caster renders
   * both — otherwise the half it did not pick would leave its prewarm casters unbuilt for the whole
   * walk. Engine bookkeeping on the mesh, beside the `casterInstanceScale` the probe already reads.
   */
  awaitPrewarmDraw(): void {
    this.#awaitingPrewarm = true;
    (this.mesh as { casterPrewarmOwed?: boolean }).casterPrewarmOwed = true;
    this.#publish(this.drawn);
  }

  /**
   * The owed draw is counted, or it can never come, so the batch follows the count again and hides
   * if no placement ever gave it a record. Only `visible` is written: the count three is submitting
   * this frame is the right one, and `#publish` would replace it with a window no cull has run for.
   */
  prewarmDrew(): void {
    this.#awaitingPrewarm = false;
    (this.mesh as { casterPrewarmOwed?: boolean }).casterPrewarmOwed = false;
    this.mesh.visible = this.mesh.count > 0;
  }
}

/**
 * A camera, plus the one flag the exclusion rule reads. Three sets `isOrthographicCamera` on an
 * `OrthographicCamera` at runtime and declares it on no base camera type, so it is duck-typed here
 * the same way `ICasterScaleMesh` and `isInstancedMesh` are.
 */
type ICamera = Camera & { readonly isOrthographicCamera?: boolean };

/**
 * The `@x,z` half of a cluster key, for a cell index. `cellsPerCluster` squares of cells per
 * cluster, so the answer is stable for as long as the grid is: placements never move, so a record is
 * only ever clustered when the cell holding it is admitted or evicted.
 */
function clusterOf(cellX: number, cellZ: number, cellsPerCluster: number): string {
  return `${String(Math.floor(cellX / cellsPerCluster))},${String(Math.floor(cellZ / cellsPerCluster))}`;
}

/**
 * Whether any of `gates` — ascending — lies in `[low, high]`. One binary search for the first gate at
 * or past `low`, against the walk of every gate a scan does per cell: a follow point that has not
 * carried anything across a boundary is the common case, and the refilter runs it over every resident
 * cell every 2 m of travel. Ends included, so a placement exactly on a gate is one of the reasons to
 * rebuild.
 */
function crossesGate(gates: readonly number[], low: number, high: number): boolean {
  let start = 0;
  let end = gates.length;
  while (start < end) {
    const middle = (start + end) >> 1;
    if ((gates[middle] as number) < low) start = middle + 1;
    else end = middle;
  }
  return start < gates.length && (gates[start] as number) <= high;
}

interface IResidentCell {
  readonly key: string;
  readonly x: number;
  readonly z: number;
  readonly cell: IWorldCell;
  /**
   * The union of the distances from every one of this cell's batches' own filter points to the cell's
   * rectangle, widened as batches are built and never narrowed; see `#staleIn`. Monotone on purpose:
   * too wide a range means a cell the gate test does not reject, and too narrow one would drop a
   * rebuild the pass owes.
   */
  filterNear: number;
  filterFar: number;
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
  /** One world-bounds box per `(level, part)` batch, filled by `#addPlacements` and read on swap. */
  boxes: Box3[][] | undefined;
  /** How many of the (level, part) meshes have been built. */
  published: number;
  /**
   * The GPU scene's source records for the placements this filter kept, one per placement beside the
   * level it reached — filled by `#addPlacements` only while the scene is on, and read on the swap.
   */
  sources: IGpuSource[] | undefined;
  /** The records placed per level, so every part of a level shares one list; see `#placeSources`. */
  gpuByLevel: Map<number, number[]> | undefined;
}

/** One placement as the GPU scene's source buffer holds it: the placement's own transform, no part. */
interface IGpuSource {
  readonly level: number;
  readonly matrix: Matrix4;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Half the diagonal of the asset's authored bounds at this placement's scale. */
  readonly radius: number;
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
  /**
   * The distance at which each level takes over, index-aligned with `glbs`; level 0 never does.
   *
   * Mutable because a chain is only known once the asset's own model has loaded: an asset with no
   * authored `lods` is widened with the levels that model's baked chain carries, and every consumer
   * of this reads it at build time — after `#adoptAsset` — so nothing has to be rebuilt.
   */
  distances: readonly number[];
  /** The package-relative GLB per level, index-aligned with `distances`. */
  readonly glbs: readonly string[];
  /** Every distance the level or cull answer changes at, `threshold` being the nearest. */
  gates: readonly number[];
  /** The nearest distance this asset's batching can be crossed at, or `undefined` when it cannot. */
  threshold: number | undefined;
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
  /**
   * Asset ids the package named twice for one model, each pointing at the id that is kept. Built
   * once in `load`, where the loader can be asked what each path really fetches; empty when nothing
   * is a duplicate. See {@link assetAliases}.
   */
  readonly aliases: ReadonlyMap<string, string>;
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
    // A world-owned surface is one chunk's proxy material, and the next chunk's teardown would
    // otherwise release a material this world's remaining proxies are still drawing with. It is
    // released with the world that owns it; see `WorldCells#dispose`.
    for (const material of materials)
      if (!worldOwned.has(material) && release(material)) failed += 1;
  });
  return failed;
}

function disposeModels(models: readonly (Object3D | undefined)[]): number {
  let failed = 0;
  for (const model of models) if (model !== undefined) failed += disposeModel(model);
  return failed;
}

/** What one chunk's merge did, for `TN_WORLD_CHUNK_MERGE`. */
interface IChunkMerge {
  /** Meshes the chunk held before, and the ones its subtree submits after. */
  readonly meshes: number;
  readonly draws: number;
  /**
   * Bytes the merged groups hold: exactly what the first draw of those meshes uploads, and the
   * number this merge exists to keep small.
   */
  readonly bytes: number;
  /** Instanced meshes baked into a material's group, and the ones left instanced. */
  readonly expanded: number;
  readonly keptInstanced: number;
  /** Teardowns of the consumed shapes that threw, for the caller to count. */
  readonly failed: number;
  /** Shadow-only proxies the chunk carries, one per `side`; 0 when the chunk casts nothing. */
  readonly shadowDraws: number;
  /**
   * The merged opaque meshes a proxy covers. They keep drawing the main pass and keep receiving, and
   * they stop casting: the depth pass reads positions, not materials, so it reads the proxy instead.
   */
  readonly shadowCovered: readonly Mesh[];
}

function meshesOf(root: Object3D): number {
  let meshes = 0;
  root.traverse((object) => {
    if ((object as Mesh).isMesh === true) meshes += 1;
  });
  return meshes;
}

/**
 * The one surface each `side` of a chunk shadow proxy draws with, world-wide.
 *
 * A depth pass cannot tell one material from another: it reads `side`, `alphaTest` and position,
 * and a proxy covers only opaque, non-alphaTest meshes, so every covered material with the same
 * `side` produces the same shadow pipeline. Borrowing one per covered group built a new one for
 * every chunk that loaded — 23 shadow draws over 125 ms and a 18 ms worst case on the walk this
 * measured, each one compiling a pipeline the one before it had already proven was identical. The
 * first covered material seen for a side is the world's, and every later proxy of that side borrows
 * it, so a world pays at most one shadow pipeline per side over its whole life.
 *
 * The materials are the world's own, so `disposeModel` must not release them with the chunk that
 * happened to contribute them.
 */
const worldOwned = new WeakSet<Material>();

/**
 * A depth pass cannot tell one material from another, so a chunk's shadow bill is its material
 * count, not its triangle count: ~100 shadow draws a level render on the map, each a per-material
 * mesh walked through the light's frustum. Positions are all it needs, and a position-only geometry
 * grouped by `side` — the one thing a depth material does read — collapses that bill to one draw per
 * side.
 *
 * The proxy lives alone on `VIRTUAL_SHADOW_CASTER_LAYER`, the layer the level shadow cameras draw and
 * the main camera never does, and is counted by the same `#probe` window test as the scatter caster
 * clusters, so a level whose window does not reach the chunk drops it for free. Nothing here decides
 * how anything looks: the covered meshes keep the game's own materials and keep drawing the main pass
 * with them, and the proxy carries the world's material for its `side` by reference — the group it
 * was grouped *by* is the material's own `side`, so the depth pass reads exactly what the covered
 * mesh's own depth material would have read, and this file still constructs no material.
 *
 * Alpha-tested and transparent meshes are left out and keep casting themselves: a cutout's depth is
 * its own texture, and a transparent one is not a shadow at all. So are the kept instanced meshes,
 * which a merge left alone.
 */
function buildChunkShadowProxies(
  chunk: Object3D,
  merged: readonly Mesh[],
  label: string,
  proxyMaterials: Map<number, Material>,
): { readonly covered: Mesh[]; readonly proxies: Mesh[] } {
  const sides = new Map<number, { material: Material; meshes: Mesh[] }>();
  for (const mesh of merged) {
    const material = mesh.material;
    if (Array.isArray(material) || material.transparent === true || material.alphaTest > 0)
      continue;
    const side = material.side;
    const group = sides.get(side);
    if (group === undefined) sides.set(side, { material, meshes: [mesh] });
    else group.meshes.push(mesh);
  }
  const covered: Mesh[] = [];
  const proxies: Mesh[] = [];
  for (const [side, group] of sides) {
    const held = proxyMaterials.get(side);
    const material = held ?? group.material;
    if (held === undefined) {
      proxyMaterials.set(side, material);
      worldOwned.add(material);
    }
    const proxy = new Mesh(shadowProxyGeometry(group.meshes, label), material);
    proxy.name = `${CHUNK_NAME}-shadow`;
    proxy.layers.set(VIRTUAL_SHADOW_CASTER_LAYER);
    proxy.castShadow = true;
    proxy.receiveShadow = false;
    markStatic(proxy);
    chunk.add(proxy);
    proxies.push(proxy);
    for (const mesh of group.meshes) {
      mesh.castShadow = false;
      covered.push(mesh);
    }
  }
  return { covered, proxies };
}

/**
 * One position-only geometry holding every covered mesh's vertices, indices preserved.
 *
 * Read through the attribute's own accessors, because a cooked model's positions can be quantized
 * and interleaved (`KHR_mesh_quantization`) and the raw array behind them is not what three would
 * have drawn. One pass at load time; the result is a depth buffer's whole input.
 */
function shadowProxyGeometry(meshes: readonly Mesh[], label: string): BufferGeometry {
  let vertices = 0;
  let drawn = 0;
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position");
    if (position === undefined)
      throw new Error(`Chunk shadow proxy (${label}): a merged mesh carries no position.`);
    vertices += position.count;
    drawn += mesh.geometry.getIndex()?.count ?? position.count;
  }
  const positions = new Float32Array(vertices * 3);
  const indices = new Uint32Array(drawn);
  let vertexAt = 0;
  let indexAt = 0;
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position");
    if (position === undefined)
      throw new Error(`Chunk shadow proxy (${label}): a merged mesh carries no position.`);
    for (let index = 0; index < position.count; index += 1) {
      const at = (vertexAt + index) * 3;
      positions[at] = position.getX(index);
      positions[at + 1] = position.getY(index);
      positions[at + 2] = position.getZ(index);
    }
    const source = mesh.geometry.getIndex();
    if (source === null || source === undefined) {
      for (let index = 0; index < position.count; index += 1) {
        indices[indexAt + index] = vertexAt + index;
      }
      indexAt += position.count;
    } else {
      for (let index = 0; index < source.count; index += 1) {
        indices[indexAt + index] = source.getX(index) + vertexAt;
      }
      indexAt += source.count;
    }
    vertexAt += position.count;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * One chunk's static meshes merged by material, in place, before the chunk is added.
 *
 * A hand-placed chunk is a bridge or a yard, not a prop: its mesh nodes are packed a few dozen to a
 * few hundred per file over a handful of materials, and each one is its own draw — in the main pass
 * and again in every shadow level that redraws it. Merging by material is what the cook already did
 * for repeated meshes (hence the `InstancedMesh`es in a loaded chunk), so this is the same fix one
 * step further out: one draw per material per chunk instead of one per node.
 *
 * Nothing here decides how anything looks. The merged mesh draws the game's own material and holds
 * the geometry exactly as authored, baked into the chunk root's space; what changes is how many
 * calls it takes to draw. `mergeByMaterial` does the bake and owns the refusals, so a group it
 * cannot merge (a material whose meshes disagree about `uv`) leaves the whole chunk as it was and is
 * counted as a failure — a chunk never disappears over a draw-call saving.
 *
 * Left alone: a skinned mesh (posed per frame), one carrying morph targets (the bake drops them), a
 * multi-material mesh (one draw per material already), and anything carrying a baked AutoLOD chain,
 * whose own `ModelLod` swaps its geometry and would be swapped for nothing. No chunk node is
 * animation-targeted: the chunk path takes `gltf.scene` and never a clip list.
 *
 * `disposeSources` says who owns the shapes the bake consumed. The merged buffers are the chunk's
 * own and are released with it on eviction; a shape nothing draws any more is released here, unless
 * the loader cache still holds it — `createAssetLoader` keys models by path and hands the same scene
 * back on the next load, so a cached shape is not this world's to tear down. A geometry a kept mesh
 * still draws is never released either way.
 *
 * `castShadow` says the chunk's shadow bill exists at all — the same answer the caller hands the
 * chunk's nodes — and only then is it worth one position-only proxy per `side`. See
 * `buildChunkShadowProxies`, which draws every side of every chunk with the world's one material for
 * that side.
 *
 * @returns what the merge did, or `undefined` when the bake refused the whole chunk.
 */
function mergeChunk(
  chunk: Object3D,
  maxTriangles: number,
  disposeSources: boolean,
  castShadow: boolean,
  proxyMaterials: Map<number, Material>,
): IChunkMerge | undefined {
  chunk.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  const skipped = new Set<Mesh>();
  let instanced = 0;
  chunk.traverse((object) => {
    const mesh = object as Mesh & { isInstancedMesh?: boolean };
    if (mesh.isMesh !== true) return;
    meshes.push(mesh);
    // A chain is baked into the geometry the mesh draws, so a merged buffer would carry a `ModelLod`
    // that has nothing to swap: the mesh keeps its own geometry and its own level selection.
    if (lodChainOf(mesh.geometry) !== undefined) {
      skipped.add(mesh);
      return;
    }
    if (Object.keys(mesh.geometry.morphAttributes).length > 0) {
      skipped.add(mesh);
      return;
    }
    if (mesh.isInstancedMesh === true) instanced += 1;
  });
  const before = meshes.length;
  let result: Mesh[];
  try {
    result = mergeByMaterial(chunk, {
      expandInstancedUnderTriangles: maxTriangles,
      label: `world chunk ${chunk.name}`,
      maxGroupVertices: CHUNK_MERGE_MAX_VERTICES,
      skip: (mesh) => skipped.has(mesh),
    });
  } catch {
    return undefined;
  }
  const kept = new Set(skipped);
  let keptInstanced = 0;
  for (const mesh of result) {
    if ((mesh as Mesh & { isInstancedMesh?: boolean }).isInstancedMesh !== true) continue;
    kept.add(mesh);
    keptInstanced += 1;
  }
  const held = new Set<BufferGeometry>();
  for (const mesh of kept) held.add(mesh.geometry);
  let failed = 0;
  // Only what the bake consumed leaves its place; a kept mesh draws the same either way, so it is
  // not re-parented and the chunk's authored hierarchy survives around the merged groups.
  for (const mesh of meshes) {
    if (kept.has(mesh)) continue;
    if (disposeSources && !held.has(mesh.geometry) && release(mesh.geometry)) failed += 1;
    mesh.removeFromParent();
  }
  for (const mesh of result)
    if (!(mesh as Mesh & { isInstancedMesh?: boolean }).isInstancedMesh === true) chunk.add(mesh);
  // Only what the bake produced is covered: a kept mesh was never merged, so it still holds its own
  // per-material draw and its own materials the proxy knows nothing about.
  const shadow = castShadow
    ? buildChunkShadowProxies(
        chunk,
        result.filter((mesh) => !kept.has(mesh)),
        `world chunk ${chunk.name}`,
        proxyMaterials,
      )
    : undefined;
  return {
    bytes: mergedBytes(result, kept),
    draws: meshesOf(chunk),
    expanded: instanced - keptInstanced,
    failed,
    keptInstanced,
    meshes: before,
    shadowCovered: shadow?.covered ?? [],
    shadowDraws: shadow?.proxies.length ?? 0,
  };
}

/**
 * Bytes the bake's own meshes hold, indices included: the upload their first draw would have paid.
 * A kept mesh is not one of them — it was never merged, and it draws the same either way.
 */
function mergedBytes(merged: readonly Mesh[], kept: ReadonlySet<Mesh>): number {
  let bytes = 0;
  for (const mesh of merged) {
    if (kept.has(mesh)) continue;
    for (const attribute of Object.values(mesh.geometry.attributes))
      bytes += attribute.array.byteLength;
    const index = mesh.geometry.getIndex();
    if (index !== null) bytes += index.array.byteLength;
  }
  return bytes;
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
 * One empty bounds box per `(level, part)`, beside the batches `#addPlacements` measures. Written
 * as a loop because this file is held to a rule that the array method's name is a material's
 * texture property.
 */
function newBoxes(batches: readonly InstancedBatch[][]): Box3[][] {
  const boxes: Box3[][] = [];
  for (const levelBatches of batches) {
    const level: Box3[] = [];
    for (const _batch of levelBatches) level.push(new Box3());
    boxes.push(level);
  }
  return boxes;
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

/**
 * The batched shape of one definition, as the loader will actually fetch it: the url the manifest
 * gives its `glb`, the url and switch distance of every `lods` entry in order, its `maxDistance` and
 * its bounds. Two definitions that agree on all of it are the same draw — same geometry, same
 * materials, same levels, same gates — so one model serves both and their placements batch together.
 *
 * `undefined` when the loader cannot resolve a path at all: a path the manifest does not list makes
 * `resolve` throw, and the load that asks for it will say so. Such a definition never aliases,
 * which is the same behaviour it has today.
 */
async function assetSignature(
  assets: IAssetLoader,
  definition: IWorldAsset,
  logicalBase: string,
): Promise<string | undefined> {
  const url = async (glb: string): Promise<string> => {
    const candidates = await assets.resolve(resolveRelative(logicalBase, glb));
    return candidates[0] ?? glb;
  };
  try {
    const parts = [await url(definition.glb)];
    for (const lod of definition.lods ?? [])
      parts.push(`${await url(lod.glb)}@${String(lod.distance)}`);
    parts.push(
      definition.maxDistance === undefined ? "" : String(definition.maxDistance),
      definition.bounds.min.join(","),
      definition.bounds.max.join(","),
    );
    return parts.join("|");
  } catch {
    return undefined;
  }
}

/**
 * `alias id -> canonical id` for every definition that is another name for the same cooked model,
 * which is what a 374-asset package with 273 duplicates is: one model exported under many object
 * names, cooked once and fetched once.
 *
 * The canonical is the lexicographically smallest id of the group, so it does not depend on the
 * order the exporter happened to write them in. An empty map — every definition its own model, or a
 * package whose paths resolve to nothing — leaves the whole runtime exactly as it is.
 */
async function assetAliases(
  assets: IAssetLoader,
  manifest: IWorldPackage,
  logicalBase: string,
): Promise<ReadonlyMap<string, string>> {
  const canonicalBySignature = new Map<string, string>();
  const aliases = new Map<string, string>();
  // Sorted, so the first id to claim a signature is the smallest one in its group.
  for (const id of Object.keys(manifest.assets).sort()) {
    const definition = manifest.assets[id];
    if (definition === undefined) continue;
    const signature = await assetSignature(assets, definition, logicalBase);
    if (signature === undefined) continue;
    const canonical = canonicalBySignature.get(signature);
    if (canonical === undefined) canonicalBySignature.set(signature, id);
    else aliases.set(id, canonical);
  }
  return aliases;
}

/** The level a placement `distance` out from the follow point draws with. */
function levelAt(distances: readonly number[], distance: number): number {
  let level = 0;
  for (let index = 1; index < distances.length; index += 1)
    if (distance > (distances[index] as number)) level = index;
  return level;
}

/**
 * A geometry that draws `source`'s shape through an indirect record: its own object, so the record is
 * this mesh's, over the same attributes and index, so no vertex buffer is copied.
 */
function indirectView(
  source: BufferGeometry,
  args: Parameters<BufferGeometry["setIndirect"]>[0],
  offset: number,
): BufferGeometry {
  const view = new BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes))
    view.setAttribute(name, attribute);
  view.setIndex(source.index);
  view.morphAttributes = source.morphAttributes;
  view.morphTargetsRelative = source.morphTargetsRelative;
  for (const group of source.groups) view.addGroup(group.start, group.count, group.materialIndex);
  view.boundingBox = source.boundingBox;
  view.boundingSphere = source.boundingSphere;
  view.setIndirect(args, offset);
  return view;
}

/** The materials `redressMaterial` gave a mesh, disposed when the mesh is or when it is re-dressed. */
const redressed = new WeakMap<InstancedMesh, readonly Material[]>();

/**
 * Give an already-compiled mesh a material of its own, so three builds its nodes again against what
 * the mesh holds now (see `#dressGpu`). The clones share every texture; only the material objects are
 * new, and they leave with the mesh.
 */
function redressMaterial(mesh: InstancedMesh): void {
  for (const material of redressed.get(mesh) ?? []) material.dispose();
  const clones: Material[] = [];
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
    clones.push(material.clone());
  mesh.material = Array.isArray(mesh.material) ? clones : (clones[0] as Material);
  if (!redressed.has(mesh))
    mesh.addEventListener("dispose", () => {
      for (const material of redressed.get(mesh) ?? []) material.dispose();
      redressed.delete(mesh);
    });
  redressed.set(mesh, clones);
}

/** Triangles one geometry submits; the count the `TN_WORLD_LOD_CHAIN` marker reports per level. */
function levelTriangles(geometry: BufferGeometry): number {
  const drawn = geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
  return Math.floor(drawn / 3);
}

/**
 * Pixels one world unit covers at unit depth, from the vertical field of view and the raster height.
 * The scale `ModelLod` divides an error by; see `IWorldCellsLoadOptions.autoLod`.
 */
function autoLodScale(autoLod: IWorldCellsLoadOptions["autoLod"]): number {
  const fovY = autoLod?.fovY ?? DEFAULT_AUTO_LOD_FOV_Y;
  const viewportHeight = autoLod?.viewportHeight ?? DEFAULT_AUTO_LOD_VIEWPORT_HEIGHT;
  if (!Number.isFinite(fovY) || fovY <= 0 || fovY >= 180)
    throw new Error("WorldCells autoLod.fovY must be a finite angle in (0, 180) degrees.");
  if (!Number.isFinite(viewportHeight) || !(viewportHeight > 0))
    throw new Error(
      "WorldCells autoLod.viewportHeight must be a positive number of raster pixels.",
    );
  return viewportHeight / (2 * Math.tan((fovY * Math.PI) / 360));
}

/** The screen-space error budget a synthesized level is switched at, in pixels. */
function autoLodPixelError(autoLod: IWorldCellsLoadOptions["autoLod"]): number {
  const maxPixelError = autoLod?.maxPixelError ?? DEFAULT_AUTO_LOD_MAX_PIXEL_ERROR;
  if (!Number.isFinite(maxPixelError) || maxPixelError <= 0)
    throw new Error("WorldCells autoLod.maxPixelError must be a positive number of pixels.");
  return maxPixelError;
}

/** What a baked chain gives a batched draw: the extra levels, where they take over, what they cost. */
interface IChainLevels {
  /** Index-aligned with `distances`; index 0 is the parts the asset already had. */
  readonly levels: (readonly IAssetPart[])[];
  /** `distances[0]` is 0 and never switches; the rest are the synthesized switch distances. */
  readonly distances: number[];
  /** Triangles every level submits, all its parts together, index-aligned with `levels`. */
  readonly triangles: number[];
}

/**
 * The extra levels an asset's baked AutoLOD chain gives a batched draw, or `undefined` when none of
 * its parts carries a chain.
 *
 * A `ModelLod` swaps one mesh's geometry, so a world that batches thousands of placements of one
 * model into a handful of instanced draws never reaches that selection: every placement drew
 * LOD0, which on a 2 km map is the whole triangle bill at every distance. The chain already holds
 * the reduced shapes, so this derives the levels a batch can hold and the distance each one takes
 * over at — the same screen-space test `ModelLod` runs, solved for depth:
 * `error * pixelsPerUnit / maxPixelError`, with each part's own registered budget.
 *
 * Level `i` is `chain.levels[min(i, length - 1)]` per part, so a part without a chain — and one
 * whose chain ran out below `i` — keeps the shape above it. The switch distance is the **max**
 * across the parts, so a part that still wants detail at that distance holds the whole asset back
 * rather than being drawn coarse by a sibling that does not.
 */
function chainDistances(
  chains: readonly (ILodChain | undefined)[],
  pixelsPerUnit: number,
  maxPixelError: number,
  maxDistance: number | undefined,
): number[] {
  let deepest = 1;
  for (const chain of chains)
    if (chain !== undefined) deepest = Math.max(deepest, chain.levels.length);
  const distances = [0];
  for (let level = 1; level < deepest; level += 1) {
    let error = 0;
    for (const chain of chains) {
      if (chain === undefined) continue;
      error = Math.max(error, chain.errors[Math.min(level, chain.levels.length - 1)] ?? 0);
    }
    const at = (error * pixelsPerUnit) / maxPixelError;
    // A chain's errors only ascend, so a switch that does not move outward — or that lands at or
    // past the cull — ends the list: every level above it is further out still, and none of them
    // can be selected or drawn. That keeps the thresholds strictly increasing and inside
    // `maxDistance`, exactly as `assetLevels` keeps authored ones.
    if (at <= (distances[level - 1] as number)) break;
    if (maxDistance !== undefined && at >= maxDistance) break;
    distances.push(at);
  }
  return distances;
}

/** One level's parts, and what they submit: the chain's shape where it has one, the one above where not. */
function chainLevelParts(
  parts: readonly IAssetPart[],
  chains: readonly (ILodChain | undefined)[],
  level: number,
): { readonly parts: IAssetPart[]; readonly triangles: number } {
  const at: IAssetPart[] = [];
  let triangles = 0;
  for (const [index, part] of parts.entries()) {
    const chain = chains[index];
    // A part with no chain keeps its own shape, in its own slot: the batch builder and
    // `#addPlacements` index every level's parts by the same number.
    const geometry =
      chain === undefined
        ? part.geometry
        : (chain.levels[Math.min(level, chain.levels.length - 1)] as BufferGeometry);
    // The same part object when the shape did not change, so one resource is one teardown.
    at.push(geometry === part.geometry ? part : { ...part, geometry });
    triangles += levelTriangles(geometry);
  }
  return { parts: at, triangles };
}

/**
 * The extra levels an asset's baked AutoLOD chain gives a batched draw, or `undefined` when none of
 * its parts carries a chain.
 *
 * A `ModelLod` swaps one mesh's geometry, so a world that batches thousands of placements of one
 * model into a handful of instanced draws never reaches that selection: every placement drew
 * LOD0, which on a 2 km map is the whole triangle bill at every distance. The chain already holds
 * the reduced shapes, so this derives the levels a batch can hold and the distance each one takes
 * over at — the same screen-space test `ModelLod` runs, solved for depth:
 * `error * pixelsPerUnit / maxPixelError`, over the world's own `autoLod.maxPixelError` rather than
 * the budget the loader registered the chain with. See
 * {@link IWorldCellsLoadOptions.autoLod} for why a batch cannot use the registered one.
 *
 * Level `i` is `chain.levels[min(i, length - 1)]` per part, so a part without a chain — and one
 * whose chain ran out below `i` — keeps the shape above it. The switch distance is the **max**
 * across the parts, so a part that still wants detail at that distance holds the whole asset back
 * rather than being drawn coarse by a sibling that does not.
 */
function chainLevels(
  parts: readonly IAssetPart[],
  pixelsPerUnit: number,
  maxPixelError: number,
  maxDistance: number | undefined,
): IChainLevels | undefined {
  const chains: (ILodChain | undefined)[] = [];
  for (const part of parts) chains.push(lodChainOf(part.geometry));
  const distances = chainDistances(chains, pixelsPerUnit, maxPixelError, maxDistance);
  if (distances.length === 1) return undefined;
  const levels: (readonly IAssetPart[])[] = [parts];
  // Level 0 leads, so the marker opens with what the asset submits today.
  const triangles: number[] = [parts.reduce((sum, part) => sum + levelTriangles(part.geometry), 0)];
  for (let level = 1; level < distances.length; level += 1) {
    const at = chainLevelParts(parts, chains, level);
    levels.push(at.parts);
    triangles.push(at.triangles);
  }
  return { distances, levels, triangles };
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

/** A metre threshold, unlike the counts above: 1.5 m is the whole point of the option. */
function positiveMetres(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`WorldCells ${name} must be a finite number greater than 0.`);
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
 * An asset whose package entry names no `lods` is drawn at the levels its own model carries a baked
 * AutoLOD chain for: the levels an instanced draw cannot reach by itself, switched at the distance
 * their error projects over the `autoLod` viewport. Authored `lods` win; a chain is only a fallback.
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
 * @constraint a baked chain's switch distances are measured against `autoLod` (default 4 px of error over 60° and 1080 raster rows), because an instanced draw cannot select a level per instance; an asset with authored `lods` never consults it
 * @override ring, budgets, terrain tile size/resolution, terrain stream and collider radius, `transparentScatter`, `clusterSize` and `shadows.invalidate`, load `concurrency`, `rebuildsPerUpdate`, `admissionBudgetMs` and the package's per-asset maxDistance
 * @constraint `prewarmed` resolves once every prewarmed shared batch has been drawn; a game with a loading screen waits on it, and `stats().pendingPrewarm` is the same gate as a number
 * @constraint every `asset:level:part` is one InstancedMesh for the main pass, plus one caster InstancedMesh per world-grid square of `clusterSize` on the shadow caster layer, so the main pass draws one mesh per key and a shadow level submits only the squares it covers
 * @constraint two definitions the asset loader resolves to one model — the same cooked `glb`, the same `lods` at the same distances, the same `maxDistance` and bounds — are one asset under the lexicographically smallest id: one model load, one set of `asset:level:part` keys, one prewarm and one refcount, released when the last cell holding any member of the group leaves the ring; `TN_WORLD_ASSET_ALIAS` reports how many of the package's assets are really distinct
 * @constraint the main pass mesh draws only the squares the render camera's frustum covers — on by default, narrowed once per frame for every main batch by the engine's render-cadence dispatch, never for an orthographic camera — a batch with nothing to draw is hidden rather than submitted at `count 0`, and `TN_WORLD_MAIN_CULL` reports both every five seconds
 * @constraint a loaded chunk is merged by material before it is added, so it submits one draw per material rather than one per node; a skinned, multi-material or morph-target mesh, one carrying a baked AutoLOD chain, and an instanced mesh past `chunkMergeMaxTriangles` (default 43,690 triangles) or with a shape over 2,048 triangles, all keep their own geometry; a material group crossing 131,072 vertices (4 MiB of position + normal + uv) is split into several meshes in traversal order instead of one giant upload, indexed parts keep their index, and `TN_WORLD_CHUNK_MERGE` reports what the merge did and the bytes it left
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
  /**
   * Pixels per world unit at unit depth, the scale a baked chain's level errors are divided by to
   * reach a switch distance. See `IWorldCellsLoadOptions.autoLod` and {@link chainLevels}.
   */
  readonly #autoLodPixelsPerUnit: number;
  /** The screen-space error budget a synthesized level is switched at; see `autoLod`. */
  readonly #autoLodMaxPixelError: number;
  /** Assets widened by their own chain so far, and whether the marker has already collapsed. */
  #chainLodAssets = 0;
  #chainLodSummarised = false;
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
  /**
   * Asset ids the package named twice for one model, each pointing at the id kept. Every lookup of
   * an id by a run's `asset` goes through {@link #canonical}, so a duplicate's placements are built,
   * keyed, prewarmed, refcounted and released as the one asset they really are. Empty when the
   * package has no duplicates, and then the lookup is the identity.
   */
  readonly #aliases: ReadonlyMap<string, string>;
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
  /**
   * Awaited meshes that only a shadow level can draw, and the share of them that have had one.
   *
   * A caster's node is built in the shadow context, so a walk-time first shadow draw of a streamed
   * key is a `NodeBuilder.build` inside a shadow pass — a third of the shadow lane's CPU on the
   * 2 km walk. Counting them separately is what `TN_WORLD_PREWARM`'s `shadowPrewarmed` reports and
   * what the gate waits on; a count of "every batch drew once" cannot tell the two apart.
   */
  #prewarmCasterMinted = 0;
  #prewarmCasterOwed = 0;
  #prewarmCasterDrawn = 0;
  /**
   * Meshes still carrying a prewarm borrow, with the hook each one has to be handed back, the batch
   * holding it visible, and the post-settle updates it has waited; see
   * {@link #releaseImpossibleBorrows}.
   */
  readonly #awaited = new Map<
    InstancedMesh,
    { batch: SharedBatch; borrow: unknown; own: unknown; hadOwn: boolean; waited: number }
  >();
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
  /** Asset bounds height under which a wide caster goes on the finest level's layer only. */
  readonly #smallCasterMetres: number;
  /** The triangle cap a chunk's instanced meshes are expanded under; see the load option. */
  readonly #chunkMergeMaxTriangles: number;
  /**
   * The one surface each `side` of a chunk shadow proxy draws with, for the whole world. See
   * `worldOwned`: sharing it is what holds a world to one shadow pipeline per side.
   */
  readonly #proxyMaterials = new Map<number, Material>();
  /**
   * The renderer and camera of the last frame that ran, kept so a chunk streamed in between frames
   * can be compiled before it is attached. `update(renderer, camera)` is the only place either is
   * known, and the admission that loads a chunk is not a place that has them.
   */
  #renderer: IRendererLike | undefined;
  #camera: Camera | undefined;
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
  /**
   * The union of the bounds of the records that moved since the levels were last told, so the tell
   * carries the region rather than the whole cascade. `undefined` is a change with no region to
   * name — the prewarm's blanket ask — and is handed on as no argument at all.
   */
  #shadowRegion: IShadowRegion | undefined;
  /** When `TN_WORLD_MAIN_CULL` was last printed; see {@link #reportMainCull}. */
  #mainCullToldAt = 0;
  /** Window repacks since the last marker; see {@link #reportMainCull}. */
  #mainCullRepacks = 0;
  /** Frusta the main cull has built, one a frame; see `IWorldCellsStats.mainCull`. */
  #mainCullFrustums = 0;
  /** Windows main batches have had to re-derive, cumulative; see `IWorldCellsStats.mainCull`. */
  #mainCullWindows = 0;
  /** Window repacks, cumulative; see `IWorldCellsStats.mainCull`. */
  #mainCullPacks = 0;
  /**
   * One AABB per resident visibility cell, and how many resident world cells hold it. Shared by
   * every key, so the main cull is O(visibility cells) a frame rather than O(keys × cells); see
   * {@link #cullMainPass}.
   */
  readonly #cullCells = new Map<string, { cells: number; box: Box3 }>();
  /** World cells per main-cull visibility cell; see `MAIN_CULL_SQUARE_METRES`. */
  readonly #cellsPerCullCell: number;
  /** The visibility cells the last cull kept and the frame's set, trading places; see `#cullMainPass`. */
  #visibleSquares: Set<string> = new Set();
  #cullScratch: Set<string> = new Set();
  /** Bumped only when `#visibleSquares` changed, so a settled camera repacks no batch at all. */
  #visibleEpoch = 0;
  /** The follow point the last full residency pass ran for; see `#residencyStale`. */
  readonly #residencyPoint = new Vector3(Number.NaN, 0, Number.NaN);
  /** The follow point the last refilter pass ran for; see `#refilterStale`. */
  readonly #refilterPoint = new Vector3(Number.NaN, 0, Number.NaN);
  /** Bumped by every admission and eviction, so a residency change owes a refilter that update. */
  #residencyEpoch = 0;
  /** The residency epoch the last refilter pass saw; see `#refilterStale`. */
  #refilterEpoch = -1;
  /** The last pass found more stale cell-assets than `rebuildsPerUpdate` could queue. */
  #refilterOwed = false;
  /** The game's hook to refresh the shadow levels after streamed records changed. */
  readonly #invalidateShadows: ((region?: IShadowRegion) => void) | undefined;
  /** Cell-asset builds waiting for budget, in admission order: nearest cell first. */
  #jobs: IBuildJob[] = [];
  /** The (cell, run) pairs already queued, so a refilter cannot queue itself twice. */
  readonly #queued = new Set<IWorldRun>();
  readonly #position = new Vector3();
  readonly #rotation = new Quaternion();
  readonly #scale = new Vector3();
  readonly #matrix = new Matrix4();
  readonly #instance = new Matrix4();
  /** The corner `#addPlacements` widens one batch's bounds box with, twice per record. */
  readonly #recordPoint = new Vector3();
  readonly #pressure = { cells: 0, instances: 0, bytes: 0 };
  readonly #budgetMs: number;
  readonly #now: () => number;
  #admission = { spentMs: 0, deferred: 0, backlog: 0 };
  #instances = 0;
  #bytes = 0;
  #evictions = 0;
  #failures = 0;
  #rebuilds = 0;
  /** Refilter passes run, whether or not they queued anything; see `IWorldCellsStats.refilters`. */
  #refilters = 0;
  /** Refilters whose rebuild came back identical and were settled without a write. */
  #unchanged = 0;
  /** Every distinct gate distance the world's assets have, ascending; see `#noteGate`. */
  readonly #gates: number[] = [];
  /** The reused hit list and the reused per-cell seen set; see `#staleIn`. */
  readonly #stale: Array<{ cell: IResidentCell; distance: number; id: string }> = [];
  readonly #staleSeen = new Set<string>();
  /** Stale cell-assets the passes found, cumulative; see `IWorldCellsStats.refilterEntries`. */
  #staleEntries = 0;
  #generation = 0;
  #released = false;
  /**
   * The GPU-driven main pass, and whether the world asked for it. Off is byte-for-byte this class's
   * own CPU path: nothing below reads `on` except the four places the option changes what a frame
   * does. See the `gpuScene` load option and `#cullMainPass`.
   */
  readonly #gpuScene = new WorldGpuScene();
  readonly #gpuWanted: boolean;
  /** `gpuSceneValidate` as the load asked for it, before the query string and the environment. */
  readonly #gpuValidate: boolean | undefined;
  /** Resident placements per canonical asset, which is the capacity a key of that asset needs. */
  readonly #gpuResident = new Map<string, number>();
  /** The resident ring has been handed to the scene once; see `#seedGpuSources`. */
  #gpuSeeded = false;

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
    // Before the first `#canonical` read, which is the run loop below.
    this.#aliases = init.aliases;
    this.#cells = init.manifest.cells;
    for (const cell of this.#cells)
      for (const run of cell.runs) {
        // By the canonical id, so one key's buffer is sized for the largest run of *any* member of
        // the group and a duplicate's placements never overflow the block their canonical minted.
        const id = this.#canonical(run.asset);
        this.#runMax.set(id, Math.max(this.#runMax.get(id) ?? 0, run.count));
      }
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
    this.#autoLodPixelsPerUnit = autoLodScale(init.autoLod);
    this.#autoLodMaxPixelError = autoLodPixelError(init.autoLod);
    // The marker is periodic, and a world's first five seconds are its own: the clock starts at the
    // world, not before it, so loading does not print a line.
    this.#mainCullToldAt = this.#now();
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
    this.#gpuWanted = init.gpuScene ?? gpuSceneRequested();
    this.#gpuValidate = init.gpuSceneValidate;
    this.#castShadowLevels =
      init.shadows?.cast === true
        ? positiveInteger(init.shadows.castLevels ?? 1, "shadows.castLevels")
        : 0;
    this.#receiveShadow = init.shadows?.receive === true;
    this.#smallCasterMetres = positiveMetres(
      init.shadows?.smallCasterMetres ?? SMALL_CASTER_METRES,
      "shadows.smallCasterMetres",
    );
    this.#chunkMergeMaxTriangles = positiveInteger(
      init.chunkMergeMaxTriangles ?? CHUNK_MERGE_MAX_TRIANGLES,
      "chunkMergeMaxTriangles",
    );
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
    // The main cull's own grid, which is a whole number of world cells or nothing: see
    // `MAIN_CULL_SQUARE_METRES`. A `cellSize` that is not a whole multiple of 32 m — and every
    // `cellSize` larger than it — falls back to one cell, which is the cull this shipped before it
    // had a grid of its own.
    this.#cellsPerCullCell =
      MAIN_CULL_SQUARE_METRES % this.#cellSize === 0 ? MAIN_CULL_SQUARE_METRES / this.#cellSize : 1;
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
    // One line, at the one moment the whole package is known: how many assets it names and how many
    // of them are one model under several names. `canonical` equal to `assets` is a package with no
    // duplicates, which is most of them.
    const aliases = await assetAliases(assets, manifest, logicalBase);
    const named = Object.keys(manifest.assets).length;
    console.info(
      `TN_WORLD_ASSET_ALIAS assets=${String(named)} canonical=${String(named - aliases.size)}`,
    );
    return new WorldCells({
      ...options,
      aliases,
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
   * world already holds. The drain, the prewarm, the invalidation and the main cull below it run
   * every time.
   *
   * `camera` is the frame's render camera, which the engine's render-cadence dispatch hands over
   * because it is the one this world draws with. A game that drives this world itself can pass it,
   * and a game that does not keeps every resident record drawn.
   */
  update(renderer?: IRendererLike, camera?: Camera): void {
    if (this.#released) return;
    // Kept for the chunk warm-up below: a chunk is loaded asynchronously and compiled when it
    // arrives, which can be a frame or a loading screen after the frame that gave us these.
    if (renderer !== undefined) this.#renderer = renderer;
    if (camera !== undefined) this.#camera = camera;
    // The first frame that hands over a renderer is the only one that can answer whether this
    // backend can run the GPU scene, and it prints its answer once: `enable` reports, then returns
    // early for the rest of the world's life.
    if (renderer !== undefined)
      this.#gpuScene.enable(
        renderer,
        this.#gpuWanted,
        this.#gpuValidate ?? gpuSceneValidationRequested(),
      );
    // The one check the scene cannot make for itself, and the only one that reads this class's own
    // numbers rather than the scene's tables: a dressed main mesh's own indirect record, against the
    // instances this path composes for the key that mesh is named. Registered before the keys are
    // seeded, because the first check is a whole ring's worth of meshes and every one of them is
    // already dressed by the time it runs.
    this.#gpuScene.drawsFrom(() => this.#gpuDraws());
    // The scene coming up under a ring that was already built: every placement swapped in before it
    // was on has no source record, and the dispatch draws nothing it is not given. One rebuild of the
    // resident ring puts them in, through the same build every first-seen asset takes.
    if (this.#gpuScene.on && this.#gpuSeeded === false) {
      this.#gpuSeeded = true;
      this.#seedGpuKeys();
      this.#seedGpuSources();
      // After the keys, because that is the only point at which the marker can say how many of the
      // world's main meshes are dressed: printed at enable it would read the ring as it was a frame
      // earlier, which is the state the run that found this was in.
      this.#gpuScene.announce(this.#renderer as IRendererLike, this.#gpuCensus());
    }
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
      // The refilter is a scan of every resident cell, so it runs on its own cadence rather than
      // with the residency pass above; see `#refilterStale` and `LEVEL_REFILTER_STEP_METRES`.
      // The GPU scene selects the level and culls per instance on the dispatch, so the pass has
      // nothing left to decide for the main pass and is skipped outright. The casters still run
      // theirs, on their own records.
      if (this.#gpuScene.on === false && this.#refilterStale(x, z)) {
        this.#refilterPoint.set(x, 0, z);
        this.#refilterEpoch = this.#residencyEpoch;
        this.#updateMaxDistance(x, z);
      }
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
    // After the drain too, so a record admitted this update is in the window the camera draws and
    // not one frame behind it.
    this.#cullMainPass(camera);
    this.#reportMainCull();
    this.#admission = {
      backlog: this.#backlog(),
      deferred: this.#jobs.length,
      spentMs: budget.spentMs,
    };
  }

  /**
   * Narrow every main batch's draw window to the world-grid squares `camera`'s frustum covers, once
   * per frame, for the whole set at once.
   *
   * This used to be each main mesh's own `onBeforeRender`, which three never calls for an invisible
   * mesh — so the moment a batch that draws nothing was hidden, the one thing that could show it
   * again when the camera turned back was gone with it, and the world lost its trees for good. The
   * decision therefore moved to the frame's own driver: the render-cadence compute dispatch, which
   * the engine already runs once per rendered frame — on the same readiness gate residency itself
   * sits behind, so a frame that skips this skipped the world's records too — and which now hands the
   * render camera to the world, so it reaches every main mesh whether it is drawn or not.
   *
   * The camera rules are the ones the hook had, and they are the whole of what decides a window:
   *
   * - **An orthographic camera never repacks.** A virtual-shadow level's camera is a
   *   `DirectionalLightShadow`'s own, which three makes orthographic, so a level's window — one shadow
   *   slice of the ring, deliberately not the main view's — can never overwrite the main pass's. A
   *   game whose own camera is orthographic keeps the old behaviour: everything resident is drawn, and
   *   nothing pops. That is a lost saving, never a wrong picture.
   * - **The render camera is the one that decides.** The engine dispatches this with the camera it
   *   is about to draw the main pass with, so the second-perspective-camera race the hook had to
   *   arbitrate per mesh cannot arise: a mirror or a minimap is drawn with its own camera and is
   *   served the main view's window, which is the honest trade for a world with one main view.
   * - **A set that did not change touches nothing.** The frustum, the visible cells and the epoch
   *   are the frame's, derived once for the whole pass; a batch whose records have not moved since it
   *   packed at that epoch compares two integers and returns. A camera at rest costs one frustum and
   *   one test per resident visibility cell a frame, and nothing at all per mesh.
   */
  #cullMainPass(camera: Camera | undefined): void {
    if (camera === undefined || (camera as ICamera).isOrthographicCamera === true) return;
    this.#mainCullFrustums += 1;
    const frustum = _cullFrustum.setFromProjectionMatrix(
      _cullProjScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    // The visible visibility cells, for the whole pass, into a set that is reused and compared
    // rather than allocated: two sets trading places, so a settled camera allocates nothing at all.
    const next = this.#cullScratch;
    next.clear();
    for (const [cell, entry] of this.#cullCells) {
      // An occupied cell whose placements have not been decoded yet holds nothing to draw, and its
      // Y range is still empty — a volume that cannot be tested against ±Infinity is not one this
      // frame's answer may rest on.
      if (entry.box.isEmpty() === false && frustum.intersectsBox(entry.box)) next.add(cell);
    }
    if (!sameSquares(next, this.#visibleSquares)) {
      this.#visibleEpoch += 1;
      const was = this.#visibleSquares;
      this.#visibleSquares = next;
      this.#cullScratch = was;
      this.#cullScratch.clear();
    }
    const gpu = this.#gpuScene;
    for (const shared of this.#shared.values()) {
      if (shared.role !== "main") continue;
      // A dressed batch draws from the GPU scene's own buffers, so the frame's per-instance answer is
      // the dispatch's and this mesh's own window would be a second, stale copy of it. What the CPU
      // still decides is the one coarse thing: whether any of its visibility cells is in the frustum.
      if (gpu.on && shared.gpu !== undefined) {
        this.#dressGpu(shared, shared.gpu);
        shared.visibleFrom(this.#visibleSquares);
        continue;
      }
      const outcome = shared.cullFrom(this.#visibleSquares, this.#visibleEpoch);
      if (outcome === "settled") continue;
      this.#mainCullWindows += 1;
      if (outcome === "repacked") {
        this.#mainCullRepacks += 1;
        this.#mainCullPacks += 1;
      }
    }
    // After the coarse gate, and only for the main camera: an orthographic one — every shadow
    // level's own — returned at the top, so a level's render never dispatches over the main pass's
    // compaction.
    if (gpu.on) gpu.dispatch(this.#renderer as IRendererLike, camera);
  }

  /**
   * The one volume per resident visibility cell, shared by every key: its own XZ footprint, and in Y
   * the range its resident placements actually reach once their assets' own bounds are added to them,
   * padded by `MAIN_CULL_PAD_METRES`.
   *
   * It is derived here, on admission, and never a frame — a volume walked every frame to answer a
   * question about placements that never move is a frame's work for an admission's answer.
   *
   * It is deliberately not per key. Every key drew the same cell set, so deriving it per key meant
   * ~230 frusta and ~230 sets a frame to learn the same answer; one volume per cell is what makes the
   * pass O(cells) instead of O(keys × cells).
   *
   * The Y is what makes it a volume rather than a slab. It used to be the whole terrain height range
   * widened by the tallest asset bound in the world — ~100 m of Y on a map with a 10 m relief, which
   * made every cell's bounding sphere a ~90 m radius that a view beside the world still cleared, and
   * handed the vertex stage the whole ring. This is per placement instead: a sub-square of flat
   * ground with ferns on it is the height of its ferns.
   */
  #cullResident(cell: IWorldCell): void {
    const per = this.#cellsPerCullCell;
    const side = per * this.#cellSize;
    const first = Math.floor(cell.x / per);
    const firstZ = Math.floor(cell.z / per);
    const name = clusterOf(cell.x, cell.z, per);
    let entry = this.#cullCells.get(name);
    if (entry === undefined) {
      // XZ from the grid, padded, and an empty Y: this cell's own placements are unioned in below,
      // and a cell holding none of them yet is never visible rather than visible by its footprint.
      const box = new Box3(
        new Vector3(
          this.#minX + first * side - MAIN_CULL_PAD_METRES,
          Number.POSITIVE_INFINITY,
          this.#minZ + firstZ * side - MAIN_CULL_PAD_METRES,
        ),
        new Vector3(
          this.#minX + (first + 1) * side + MAIN_CULL_PAD_METRES,
          Number.NEGATIVE_INFINITY,
          this.#minZ + (firstZ + 1) * side + MAIN_CULL_PAD_METRES,
        ),
      );
      entry = { box, cells: 0 };
      this.#cullCells.set(name, entry);
    }
    entry.cells += 1;
    const box = entry.box;
    for (const run of cell.runs) {
      const bounds = this.#manifest.assets[this.#canonical(run.asset)]?.bounds;
      if (bounds === undefined || run.count === 0) continue;
      const records = cellPlacements(this.#placements, run);
      for (let index = 0; index < run.count; index += 1) {
        const at = index * PLACEMENT_RECORD_FLOATS;
        // The placement, widened by its own asset's bounds at the scale it is drawn at, and by the
        // pad — a union, so the pad is counted once however many placements there are.
        const scale = Math.abs(records[at + 7] as number);
        const x = records[at] as number;
        const y = records[at + 1] as number;
        const z = records[at + 2] as number;
        box.expandByPoint(
          _cullPoint.set(
            x - (Math.abs(bounds.min[0]) + MAIN_CULL_PAD_METRES) * scale,
            y - Math.abs(bounds.min[1]) * scale - MAIN_CULL_PAD_METRES,
            z - (Math.abs(bounds.min[2]) + MAIN_CULL_PAD_METRES) * scale,
          ),
        );
        box.expandByPoint(
          _cullPoint.set(
            x + (Math.abs(bounds.max[0]) + MAIN_CULL_PAD_METRES) * scale,
            y + Math.abs(bounds.max[1]) * scale + MAIN_CULL_PAD_METRES,
            z + (Math.abs(bounds.max[2]) + MAIN_CULL_PAD_METRES) * scale,
          ),
        );
      }
    }
  }

  /**
   * Drop the visibility cell an evicted cell sat in once nothing resident is left in it. Records are
   * cleared before this runs, so a batch can never be holding a cell the cull no longer knows: an
   * unknown cell is not in the visible set, and that would be a tree nobody draws.
   *
   * The box goes with it, so a cell that comes back derives its volume again — which is what keeps a
   * released asset's height out of a cell that no longer holds it.
   */
  #cullEvicted(cell: IResidentCell): void {
    const name = clusterOf(cell.x, cell.z, this.#cellsPerCullCell);
    const entry = this.#cullCells.get(name);
    if (entry === undefined) return;
    entry.cells -= 1;
    if (entry.cells <= 0) this.#cullCells.delete(name);
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
   * Does this update have to run the `maxDistance`/`lods` refilter pass?
   *
   * Three things, and the pass runs when any of them holds: the follow point has moved
   * `LEVEL_REFILTER_STEP_METRES` since the last one, so a walk re-derives its brackets every two
   * metres instead of every half; residency changed, because a cell that arrived or left is the
   * bracket the pass is about; and the last pass found more stale cell-assets than
   * `rebuildsPerUpdate` could queue, so the ones it could not queue are still owed and a still
   * follow point has to keep coming back for them. Anything else is the same brackets, so the pass
   * is skipped and the world does nothing for that update.
   */
  #refilterStale(x: number, z: number): boolean {
    if (this.#refilterOwed) return true;
    if (this.#refilterEpoch !== this.#residencyEpoch) return true;
    return (
      Math.hypot(x - this.#refilterPoint.x, z - this.#refilterPoint.z) >= LEVEL_REFILTER_STEP_METRES
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
    // A minted batch is only *owed* a draw by `#awaitDraw`; nothing made anything draw it. A main
    // batch is drawn by the next main render, but a caster is drawn by a shadow level, and the
    // levels render when their window moves or something invalidates them — on a loading screen the
    // follow point stands still, so every caster minted after the first frame sat in the graph with
    // a node no level had ever asked for and the walk's first window move built all of them in one
    // shadow pass. Invalidating while the gate is open, minting or not, is what makes the prewarm
    // prewarm: the build is paid by the loading screen, which is the only frame rate hiding it.
    if (minted > 0) this.#prewarmWait = 0;
    // A caster's draw is a shadow level's, and the levels render at most one per frame, so the gate
    // keeps asking them to while one is owed — bounded, because a borrow nothing draws is handed
    // back by `#releaseImpossibleBorrows` below and a world that never draws one settles anyway.
    const waitingOnCasters = this.parent !== null && this.#prewarmCasterOwed > 0;
    if (minted > 0 || waitingOnCasters) this.#invalidateShadows?.();
    else if (this.parent !== null) this.#prewarmWait += 1;
    this.#releaseImpossibleBorrows();
    if (this.#prewarmQueue.length > 0 || this.#prewarmPending <= 0) return;
    if (this.#prewarmWait < PREWARM_WARM_UPDATES) return;
    // A caster still owed a draw is a build the walk would otherwise pay inside a shadow pass, so the
    // gate holds for it until its borrow is handed back, which is the bound.
    if (waitingOnCasters) return;
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
      entry.role,
    );
    shared.smallCaster = this.#smallCaster(entry.asset);
    this.#dressMesh(shared, entry.role === "main" && this.#receiveShadow);
    // Dressed here, before the walk that fills it: the prewarm is what mints every key of an asset
    // before its first placement is swapped, so this is where the whole gate table comes from.
    this.#adoptGpu(shared, entry.asset, entry.key, entry.level, entry.part);
    this.#shared.set(entry.key, shared);
    this.add(shared.mesh);
    this.#prewarmPending += 1;
    this.#prewarmMinted += 1;
    // Every role is owed a draw by `#awaitDraw` and is shown while empty until that draw is counted:
    // the node, the bindings and the pipeline are built by a submission, and one zero-count
    // submission per prewarmed batch is the price of having the walk never pay for it. A caster's
    // submission is a shadow level's, not the main pass's — which is why `#drainPrewarm` keeps the
    // levels rendering while one is owed, and why `VirtualShadowNode`'s `#probe` renders both caster
    // layers when it finds one. A caster that is not awaited here is built on the first shadow draw
    // of the walk, inside a shadow pass, which is the cost this prewarm exists to move.
    this.#awaitDraw(shared);
  }

  /** Count this batch's first submitted draw, once, then hand `onBeforeRender` back to whoever had it. */
  #awaitDraw(shared: SharedBatch): void {
    const mesh = shared.mesh;
    const caster = shared.role !== "main";
    this.#prewarmOwed += 1;
    if (caster) {
      this.#prewarmCasterMinted += 1;
      this.#prewarmCasterOwed += 1;
    }
    shared.awaitPrewarmDraw();
    // three's `Object3D` carries an inherited no-op, so reading `onBeforeRender` off a fresh mesh
    // hands back a function that was never an own property. Writing it back as one leaves every
    // batch that has drawn since looking permanently hooked, and the projection's `hasRenderHook`
    // reads own properties — so the borrow has to remember whether there was one to give back.
    const hadOwn = Object.hasOwn(mesh, "onBeforeRender");
    const own = hadOwn ? mesh.onBeforeRender : undefined;
    const borrow = own as ((...args: unknown[]) => void) | undefined;
    const counted = (...args: unknown[]): void => {
      this.#prewarmDrawn += 1;
      if (caster) {
        this.#prewarmCasterOwed -= 1;
        this.#prewarmCasterDrawn += 1;
      }
      this.#handBack(mesh, hadOwn, own);
      this.#awaited.delete(mesh);
      // The node is built and the pipeline is compiled: the batch owes nothing more, so an empty one
      // goes back to hiding.
      shared.prewarmDrew();
      borrow?.(...args);
    };
    // Engine bookkeeping, not a claim on the mesh: the scene-render projection's `hasRenderHook`
    // ignores a marked borrow, so a streamed world's prewarmed batches stay eligible for the
    // collapse they exist to be folded into. Unmarked, 202 of them permanently declined it.
    markEngineRenderHook(counted);
    this.#awaited.set(mesh, { batch: shared, borrow: counted, own, hadOwn, waited: 0 });
    mesh.onBeforeRender = counted as typeof mesh.onBeforeRender;
  }

  /**
   * Hand back the borrow of a mesh whose prewarm draw can never come, so no hook outlives the
   * prewarm it served.
   *
   * A mesh that is merely empty now draws — `visible` at count 0 is what builds its node and its
   * pipeline, and the borrow is counted off that one submission — so emptiness is no longer a
   * reason to release anything. What is left is a mesh nothing can draw, and which mesh that is
   * depends on the role: a main batch is drawn by the main pass, so a world projected by nothing
   * (`parent === null`, which is a `load()` loop's prewarm and settles the moment the world joins a
   * scene) still owes it one, while a *caster* is drawn by a shadow level, and a world nothing
   * projects has no level to draw it — its visible-at-count-0 exception is handed straight back
   * rather than held for the whole load. Otherwise a level is a frame's schedule away and the
   * borrow waits `PREWARM_RELEASE_UPDATES` updates for it. That is a ceiling rather than a
   * diagnosis — a projection that collapsed the world, a camera that never reached the mesh, a game
   * that passed no `shadows.invalidate` for the levels to be told by — and it is here so those
   * meshes neither hold a hook nor sit visible at count 0 for the whole walk.
   */
  #releaseImpossibleBorrows(): void {
    const projected = this.parent !== null;
    for (const [mesh, entry] of [...this.#awaited]) {
      entry.waited += 1;
      const caster = entry.batch.role !== "main";
      if (projected === true && entry.waited < PREWARM_RELEASE_UPDATES) continue;
      if (projected === false && caster === false) continue;
      if (mesh.onBeforeRender === entry.borrow) this.#handBack(mesh, entry.hadOwn, entry.own);
      this.#awaited.delete(mesh);
      if (caster) this.#prewarmCasterOwed -= 1;
      entry.batch.prewarmDrew();
    }
  }

  /** Give a borrowed mesh back the hook it had, or none at all when it never had one of its own. */
  #handBack(mesh: InstancedMesh, hadOwn: boolean, own: unknown): void {
    if (hadOwn) mesh.onBeforeRender = own as typeof mesh.onBeforeRender;
    // Deleted rather than assigned `undefined`: three calls `object.onBeforeRender(...)`
    // unconditionally, and an own `undefined` shadows the prototype's no-op and throws.
    // biome-ignore lint/performance/noDelete: restoring the prototype lookup is the point.
    else delete (mesh as Partial<InstancedMesh>).onBeforeRender;
  }

  /**
   * Every level and every part of one asset, queued to be minted empty: the main key, and the one
   * caster cluster under the follow point. One square because a cluster per cell of the map would
   * be a prewarm of the whole package, and the squares a walk reaches first are minted by
   * residency, two an update.
   */
  #queuePrewarm(asset: IAssetState): void {
    const coarsest = asset.levels[asset.levels.length - 1];
    for (const [level, parts] of asset.levels.entries()) {
      for (const [part, entry] of parts.entries()) {
        const key = `${asset.id}:${String(level)}:${String(part)}`;
        for (const role of ["main", "cluster", "wide"] as const) {
          // Only a level that casts has a caster half at all; see `#casts`.
          if (role !== "main" && !this.#casts(level)) continue;
          const name =
            role === "main"
              ? key
              : `${key}@${role === "cluster" ? this.#followCluster() : WIDE_CLUSTER}`;
          // A retained key is already paid for; see `#mintPrewarm`.
          if (this.#shared.has(name) || this.#retired.has(name) || this.#prewarmKeys.has(name))
            continue;
          // The wide half is prewarmed out of the coarsest level, exactly as it is drawn; see
          // `#shapeFor`.
          const shape = role === "wide" ? (coarsest?.[part] ?? entry) : entry;
          this.#prewarmKeys.add(name);
          this.#prewarmQueue.push({
            asset: asset.id,
            role,
            geometry: shape.geometry,
            key: name,
            level,
            material: shape.material,
            part,
          });
        }
      }
    }
  }

  #settlePrewarm(): void {
    if (this.#prewarmSettled) return;
    this.#prewarmSettled = true;
    // The one line a walk's log needs to say the prewarm paid what it exists to pay:
    // `shadowPrewarmed` is the casters whose shadow-context node was built behind the gate, and
    // `castersUnbuilt` the ones it could not reach — a non-zero there is the walk-time first shadow
    // build the prewarm was supposed to move, named rather than inferred.
    console.info(
      `TN_WORLD_PREWARM minted=${String(this.#prewarmMinted)} ` +
        `shadowPrewarmed=${String(this.#prewarmCasterDrawn)} ` +
        `castersUnbuilt=${String(Math.max(0, this.#prewarmCasterMinted - this.#prewarmCasterDrawn))}`,
    );
    this.#prewarmResolve();
  }

  /**
   * The render-cadence dispatch. The engine hands the frame's render camera over, and this world's
   * main windows follow it; see {@link #cullMainPass} for why the decision is not the meshes' own.
   */
  process(renderer?: IRendererLike, camera?: Camera): void {
    this.update(renderer, camera);
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
    const gpu = this.#gpuScene.report();
    const census = this.#gpuCensus();
    return {
      admission: { ...this.#admission },
      evictions: this.#evictions,
      failures: this.#failures,
      gpuScene: {
        dispatches: gpu.dispatches,
        instances: gpu.instances,
        keys: gpu.keys,
        on: gpu.on,
        reason: gpu.reason,
        dressed: census.dressed,
        meshes: census.meshes,
      },
      instances: this.#instances,
      loadsInFlight: this.#limiter.inFlight,
      loadsQueued: this.#limiter.queued,
      mainCull: {
        frustums: this.#mainCullFrustums,
        repacks: this.#mainCullPacks,
        visibleEpoch: this.#visibleEpoch,
        windows: this.#mainCullWindows,
      },
      // Minted meshes still owed a first draw, not minted meshes. The two used to be the same
      // number, so a loading bar read minting as the whole of the prewarm and then stood still for
      // the whole draw — the node builds a bar cannot show. The gate is a promise about batches, so
      // the settle zeroes this pair: `0` once `prewarmed` has resolved.
      pendingPrewarm: this.#prewarmQueue.length + this.#prewarmOwed - this.#prewarmDrawn,
      prewarmMinted: this.#prewarmMinted,
      pressure: { ...this.#pressure },
      // The pass itself, counted whether or not it found anything: `rebuilds` cannot tell a skipped
      // pass from one that scanned every resident cell and found the same brackets, and that gap is
      // the whole cost of the 2 m step. See `#refilterStale`.
      refilters: this.#refilters,
      refilterEntries: this.#staleEntries,
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
    for (const [mesh, entry] of [...this.#awaited]) {
      if (mesh.onBeforeRender === entry.borrow) this.#handBack(mesh, entry.hadOwn, entry.own);
    }
    this.#awaited.clear();
    for (const cell of [...this.#resident.values()]) this.#evict(cell);
    // Every chunk is gone by now, so the surfaces the world owns on their behalf are the last thing
    // holding them, and they are released here rather than by whichever chunk contributed them.
    for (const material of this.#proxyMaterials.values())
      this.#failures += release(material) ? 1 : 0;
    this.#proxyMaterials.clear();
    this.#renderer = undefined;
    this.#camera = undefined;
    this.#gpuScene.dispose();
    this.#gpuResident.clear();
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
      filterFar: Number.NEGATIVE_INFINITY,
      filterNear: Number.POSITIVE_INFINITY,
      generation: this.#generation++,
      instances,
      key: cellKey(cell.x, cell.z),
      x: cell.x,
      z: cell.z,
    };
    this.#resident.set(state.key, state);
    this.#cullResident(cell);
    this.#residencyEpoch += 1;
    this.#instances += instances;
    this.#bytes += bytes;
    for (const run of cell.runs) this.#acquire(run, state);
    if (cell.chunks !== undefined && cell.chunks.length > 0) this.#startChunkLoad(state);
  }

  /**
   * The asset id a run's `asset` really is: itself, or the one canonical id its model is loaded
   * under. Every path from a run to the state that holds it goes through here, so a duplicate costs
   * one `IAssetState`, one model load, one set of `canonical:level:part` keys and one refcount —
   * released when the last run naming any member of the group leaves the ring. A placement keeps its
   * own transform, because those are read from the run's own records.
   */
  #canonical(id: string): string {
    return this.#aliases.get(id) ?? id;
  }

  #acquire(run: IWorldRun, cell: IResidentCell): void {
    const id = this.#canonical(run.asset);
    let asset = this.#assets.get(id);
    if (asset === undefined) {
      const definition = this.#manifest.assets[id];
      if (definition === undefined) return;
      asset = {
        ...assetLevels(definition),
        definition,
        disposed: false,
        id,
        levels: [],
        pending: false,
        refcount: 0,
      };
      this.#assets.set(id, asset);
      for (const gate of asset.gates) this.#noteGate(gate);
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
    // Keyed on the run, not the asset: one cell can hold two runs of the same canonical asset —
    // two names for one model — and each has its own records to build. A token per asset made the
    // second run a no-op and dropped its placements on the floor.
    if (this.#queued.has(run)) return;
    // A cell that already draws this run is not built again, which is where an adopted asset's
    // second acquire over a still-resident cell lands.
    if (!replace && cell.batches.some((entry) => entry.asset === asset.id && entry.run === run))
      return;
    this.#queued.add(run);
    this.#jobs.push({
      asset,
      batches: undefined,
      boxes: undefined,
      cell,
      gpuByLevel: undefined,
      filterX: this.#follow.position.x,
      filterZ: this.#follow.position.z,
      fresh: [],
      next: 0,
      published: 0,
      records: undefined,
      replaced: replace
        ? cell.batches.filter((entry) => entry.asset === asset.id && entry.run === run)
        : [],
      run,
      sources: undefined,
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
    this.#queued.delete(job.run);
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
      // One box per `(level, part)` beside the batches it measures, so the swap that hands the
      // records to the renderer can name where they are; see `#addPlacements`.
      job.boxes ??= newBoxes(job.batches);
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
      this.#widenFilterRange(cell, fresh.lastFilterX, fresh.lastFilterZ);
      job.fresh.splice(index, 1);
      // The batch that stays is the one that was already drawing, so its source records are its own
      // — and a cell the ring built before the scene came up has none. This is the only path that
      // hands them over for a rebuild whose records came out identical, which is every one of them:
      // the records are the same, so the fast path is always the one taken.
      if (this.#gpuScene.on && same.gpu === undefined) same.gpu = this.#placeSources(job, same);
    }
    // Every segment first, so a frame out of fresh meshes leaves the old batches drawing whole.
    for (const entry of job.fresh) {
      if (entry.batch.count === 0) continue;
      // Both halves for every fresh entry, whether or not a stalled frame already claimed one:
      // skipping an entry that has its main block meant the retry never asked for its cluster, so
      // those records reached the main pass and no shadow map.
      if (entry.segment < 0) {
        const shared = this.#sharedFor(job.asset.id, entry, cell);
        const segment =
          shared === undefined
            ? undefined
            : this.#segmentIn(shared, entry.batch.count, this.#cullCellOf(cell));
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
      // The wide half, by the same no-hole rule: a key with a cluster and no wide caster draws into
      // a level that may already be reading the wide layer with nothing in it.
      if (!this.#claimWide(job.asset.id, entry)) {
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
      if (this.#gpuScene.on) entry.gpu = this.#placeSources(job, entry);
      if (entry.caster !== undefined) entry.caster.write(entry.casterSegment, entry.batch);
      if (entry.wide !== undefined) entry.wide.write(entry.wideSegment, entry.batch);
    }
    // A batch the walk just wrote to, cleared or compacted holds new records, so the shadow levels
    // that drew the old ones are stale. One flag, told at most once a second.
    if (job.fresh.length > 0 || job.replaced.length > 0)
      this.#shadowRecordsMoved(this.#changedBounds(job.fresh, job.replaced));
    return true;
  }

  /**
   * The world bounds of the records these groups moved: the union of what each batch held, in and
   * out. Both sides, because a record that leaves is ground a level was drawing; `undefined` when
   * neither held one, and then the tell is the blanket one.
   */
  #changedBounds(fresh: readonly ICellBatch[], replaced: readonly ICellBatch[]): Box3 | undefined {
    let union: Box3 | undefined;
    for (const group of [fresh, replaced])
      for (const entry of group) {
        const box = entry.shadowBounds;
        if (box === undefined) continue;
        if (union === undefined) union = box.clone();
        else union.union(box);
      }
    return union;
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

  /**
   * Claim this cell's block in its key's wide caster mesh, when the level casts and it does not
   * have one. `false` means the frame's fresh allowance is spent and the swap waits, so the
   * clusters and the wide half are never half attached.
   */
  #claimWide(assetId: string, entry: ICellBatch): boolean {
    if (entry.wideSegment >= 0 || !this.#casts(entry.level)) return true;
    const wide = this.#wideFor(assetId, entry);
    const at = wide === undefined ? undefined : this.#segmentIn(wide, entry.batch.count);
    if (wide === undefined || at === undefined) return false;
    entry.wide = wide;
    entry.wideSegment = at;
    return true;
  }

  #clearSegment(entry: ICellBatch): void {
    if (entry.shared !== undefined && entry.segment >= 0) entry.shared.clear(entry.segment);
    // The source records go back with the block that held them, on every path a cell's records leave:
    // a refilter's replacement, an eviction, and a queued build dropped with its cell. Releasing one
    // twice is a no-op, which is what lets a level's parts share a single list.
    if (entry.gpu !== undefined) {
      for (const at of entry.gpu) this.#gpuScene.release(at);
      const left = (this.#gpuResident.get(entry.asset) ?? 0) - entry.gpu.length;
      if (left > 0) this.#gpuResident.set(entry.asset, left);
      else this.#gpuResident.delete(entry.asset);
    }
    entry.gpu = undefined;
    if (entry.caster !== undefined && entry.casterSegment >= 0)
      entry.caster.clear(entry.casterSegment);
    if (entry.wide !== undefined && entry.wideSegment >= 0) entry.wide.clear(entry.wideSegment);
    entry.shared = undefined;
    entry.segment = -1;
    entry.caster = undefined;
    entry.casterSegment = -1;
    entry.wide = undefined;
    entry.wideSegment = -1;
  }

  /**
   * One cell's records changed, so the shadow levels that cover it redraw — at most once a second,
   * and only for a game that passed the hook. The levels cull clusters themselves now, so nothing
   * has to be copied for them; the flag only says "what you last drew is out of date".
   *
   * `bounds` is the records that changed and is kept until the tell, unioned with whatever else
   * changed in the same second. A change with no bounds is a blanket one: it has to be, because
   * there is nothing narrower to say.
   */
  #shadowRecordsMoved(bounds?: Box3): void {
    this.#shadowMoved = true;
    if (bounds === undefined || bounds.isEmpty()) return;
    const current = this.#shadowRegion;
    if (current === undefined) {
      this.#shadowRegion = {
        max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
        min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
      };
      return;
    }
    current.min.x = Math.min(current.min.x, bounds.min.x);
    current.min.y = Math.min(current.min.y, bounds.min.y);
    current.min.z = Math.min(current.min.z, bounds.min.z);
    current.max.x = Math.max(current.max.x, bounds.max.x);
    current.max.y = Math.max(current.max.y, bounds.max.y);
    current.max.z = Math.max(current.max.z, bounds.max.z);
  }

  /**
   * Tell the shadow levels once, if anything changed and a second has passed.
   *
   * The companions used to make this the expensive call it still is; the levels redraw from
   * scratch, so the cadence is the only lever and once a second is the one that keeps a walk's
   * frames off the shadow lane without leaving the ground stale behind a player. The region is
   * what the changed records' own bounds add: a hook that forwards it redraws the levels whose
   * window covers them, which for a streaming world is usually the finest one alone.
   */
  #tellShadows(): void {
    if (!this.#shadowMoved) return;
    // No hook means there is no level to tell, so the flag is discharged here. Leaving it set made
    // `#residencyStale` true forever, and every update ran a full residency pass on a world that had
    // nothing left to do.
    if (this.#invalidateShadows === undefined) {
      this.#shadowMoved = false;
      this.#shadowRegion = undefined;
      return;
    }
    const now = this.#now();
    if (now - this.#shadowToldAt < 1e3) return;
    this.#shadowToldAt = now;
    this.#shadowMoved = false;
    const region = this.#shadowRegion;
    this.#shadowRegion = undefined;
    if (region === undefined) this.#invalidateShadows();
    else this.#invalidateShadows(region);
  }

  /**
   * `TN_WORLD_MAIN_CULL`, every `MAIN_CULL_MARKER_MS`: what the main pass holds, what it is drawing,
   * how many of its meshes are submitted at all, and how many times the window moved to get there.
   *
   * `instances` is every live record the main batches hold — the whole resident ring, which is what
   * three's whole-mesh test used to hand the vertex stage — and `drawn` is what the cull left in the
   * windows. The gap between them is the saving, `repacks` says what it cost to get: a settled camera
   * repacks nothing, so a walk that repacks dozens of times a second is a window that is chasing the
   * camera, not one that is thrashing. `hidden` and `castersHidden` are the batches with nothing to
   * draw that are now not submitted at all: in three r185's WebGPU path a zero-count `InstancedMesh`
   * still runs the whole per-draw JS chain, so an empty batch was CPU a frame for no draw — the number
   * is the part of the census that no longer costs anything.
   *
   * `dressed=N/M` is the GPU scene's own claim, repeated every five seconds: a scene that is on over
   * meshes nothing is dressed into compacts a set the CPU path is still drawing, and `keys` alone
   * cannot say so — a ring built before the scene came up has no keys at all and looks healthy.
   */
  #reportMainCull(): void {
    const now = this.#now();
    if (now - this.#mainCullToldAt < MAIN_CULL_MARKER_MS) return;
    this.#mainCullToldAt = now;
    const repacks = this.#mainCullRepacks;
    this.#mainCullRepacks = 0;
    let instances = 0;
    let drawn = 0;
    let hidden = 0;
    let castersHidden = 0;
    // What the two caster layers hold between them, per layer: the resident triangle bill a shadow
    // level that picked that layer submits. Two numbers that must not be equal is the whole claim —
    // the wide half draws the asset's coarsest level, so it is the one that falls.
    let clusterTriangles = 0;
    let wideTriangles = 0;
    let dressed = 0;
    let mainMeshes = 0;
    for (const shared of this.#shared.values()) {
      if (shared.role !== "main") {
        if (shared.mesh.visible === false) castersHidden += 1;
        // Zero records add zero, so an empty batch needs no test of its own here.
        const triangles = levelTriangles(shared.mesh.geometry) * shared.live;
        if (shared.role === "cluster") clusterTriangles += triangles;
        else wideTriangles += triangles;
        continue;
      }
      mainMeshes += 1;
      if (shared.gpu !== undefined) dressed += 1;
      instances += shared.live;
      drawn += shared.drawn;
      if (shared.mesh.visible === false) hidden += 1;
    }
    console.info(
      `TN_WORLD_MAIN_CULL instances=${String(instances)} drawn=${String(drawn)} ` +
        `hidden=${String(hidden)} castersHidden=${String(castersHidden)} repacks=${String(repacks)} ` +
        `clusterTris=${String(clusterTriangles)} wideTris=${String(wideTriangles)} ` +
        `dressed=${String(dressed)}/${String(mainMeshes)}`,
    );
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
    // Half the diagonal of the asset's authored bounds: the sphere the dispatch culls this placement
    // with, and the one number about its extent that comes from the package rather than from here.
    const authored = asset.definition.bounds;
    const boundsRadius =
      0.5 *
      Math.hypot(
        (authored.max[0] as number) - (authored.min[0] as number),
        (authored.max[1] as number) - (authored.min[1] as number),
        (authored.max[2] as number) - (authored.min[2] as number),
      );
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
      // The record's own world bounds: the placement widened by the asset's authored bounds at the
      // scale it is drawn at. Read here because this loop already holds the placement and the scale,
      // and it is the one number the shadow levels' invalidation is tested against — the cell box is
      // 64 m of it, so a level whose window is 48 m wide was redrawing over ground nothing in it.
      const bounds = asset.definition.bounds;
      const scale = this.#scale.x;
      // The GPU scene's source record for this placement: the placement's own transform, the level it
      // reached, and a sphere the dispatch tests against the camera's planes. The part offset is the
      // key's own, so one record serves every part of the level — see `#placeSources`.
      if (this.#gpuScene.on) {
        const list = job.sources ?? [];
        job.sources = list;
        // The sphere is the asset's authored bounds *as placed*, centred where the bounds' centre
        // lands: a sphere at the placement instead is not a bound of the placement, and every prop
        // whose model does not straddle the origin lost the half of itself that reaches away from it
        // — a post, a stump, a fern, all of them culled at the edge of the view with their bases
        // outside it. The CPU path's own gate is the cell's box over the same widened bounds, and it
        // is conservative in exactly the way this is now.
        const at = scale;
        list.push({
          level,
          matrix: this.#matrix.clone(),
          radius: 0.5 * boundsRadius * Math.abs(at),
          x: x + ((bounds.min[0] as number) + (bounds.max[0] as number)) * 0.5 * at,
          y: y + ((bounds.min[1] as number) + (bounds.max[1] as number)) * 0.5 * at,
          z: z + ((bounds.min[2] as number) + (bounds.max[2] as number)) * 0.5 * at,
        });
      }
      const parts = asset.levels[level] as readonly IAssetPart[];
      const levelBatches = job.batches?.[level] as InstancedBatch[];
      const levelBoxes = job.boxes?.[level] as Box3[] | undefined;
      for (const [part, entry] of parts.entries()) {
        this.#instance.multiplyMatrices(this.#matrix, entry.local);
        (levelBatches[part] as InstancedBatch).add(this.#instance);
        const box = levelBoxes?.[part];
        if (box === undefined) continue;
        this.#recordPoint.set(
          x + (bounds.min[0] as number) * scale,
          y + (bounds.min[1] as number) * scale,
          z + (bounds.min[2] as number) * scale,
        );
        box.expandByPoint(this.#recordPoint);
        this.#recordPoint.set(
          x + (bounds.max[0] as number) * scale,
          y + (bounds.max[1] as number) * scale,
          z + (bounds.max[2] as number) * scale,
        );
        box.expandByPoint(this.#recordPoint);
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
  /**
   * Fold one batch's own filter point into the cell's bracket, which only ever widens. See
   * `IResidentCell.filterNear` and `#staleIn`.
   */
  #widenFilterRange(cell: IResidentCell, filterX: number, filterZ: number): void {
    const [near, far] = this.#span(cell, filterX, filterZ);
    if (near < cell.filterNear) cell.filterNear = near;
    if (far > cell.filterFar) cell.filterFar = far;
  }

  #buildOne(job: IBuildJob, batches: readonly InstancedBatch[][]): void {
    const { asset } = job;
    const { cell } = job;
    this.#widenFilterRange(cell, job.filterX, job.filterZ);
    let part = job.published;
    for (const [level, levelBatches] of batches.entries()) {
      if (part >= levelBatches.length) {
        part -= levelBatches.length;
        continue;
      }
      const box = job.boxes?.[level]?.[part];
      job.fresh.push({
        asset: asset.id,
        batch: levelBatches[part] as InstancedBatch,
        caster: undefined,
        casterSegment: -1,
        gpu: undefined,
        wide: undefined,
        wideSegment: -1,
        lastFilterX: job.filterX,
        lastFilterZ: job.filterZ,
        level,
        part,
        run: job.run,
        segment: -1,
        shared: undefined,
        // Where these records are, for the shadow invalidation this entry's swap hands over.
        shadowBounds: box === undefined || box.isEmpty() ? undefined : box,
        threshold: asset.threshold,
      });
      job.published += 1;
      return;
    }
  }

  /** The main pass's one mesh for an asset part at a level, covering every resident cell. */
  #sharedFor(assetId: string, entry: ICellBatch, cell: IResidentCell): SharedBatch | undefined {
    return this.#batchFor(assetId, entry, this.#keyOf(entry), "main", this.#receiveShadow);
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
      "cluster",
      false,
    );
  }

  /**
   * The wide caster for one asset part at one level, or `undefined` when the level does not cast or
   * the frame's fresh allowance is spent.
   *
   * One per key, holding every cell's records, on the wide caster layer: a level whose window
   * covers the whole resident ring pays one draw for the key instead of one per square, and the fine
   * levels that cull clusters never see this layer.
   */
  #wideFor(assetId: string, entry: ICellBatch): SharedBatch | undefined {
    if (!this.#casts(entry.level)) return undefined;
    return this.#batchFor(assetId, entry, `${this.#keyOf(entry)}@${WIDE_CLUSTER}`, "wide", false);
  }

  /** `asset:level:part`, the main pass's one mesh per key. */
  #keyOf(entry: ICellBatch): string {
    return `${entry.asset}:${String(entry.level)}:${String(entry.part)}`;
  }

  /**
   * The geometry and material one caster half draws, and the one place the coarse shape is chosen.
   *
   * Only the wide half is coarse. A shadow level picks its granularity by bill — one mesh per square
   * on `VIRTUAL_SHADOW_CASTER_LAYER`, one mesh per key on the wide layer — so the wide half is what
   * the levels whose window holds the resident ring submit, and their texels are metres across: the
   * shape such a map resolves cannot tell level 0 from the asset's coarsest level, so it draws the
   * coarsest one per part and the triangles it saves are triangles no fragment ever sampled. A
   * cluster is the fine half, culled down to the squares one level's own window covers, so it keeps
   * the level the placement selected. An asset with one level is its own coarsest, and every half
   * draws what it draws today.
   */
  #shapeFor(entry: ICellBatch, role: "cluster" | "main" | "wide"): IBatchShape {
    const coarse =
      role === "wide" ? this.#assets.get(entry.asset)?.levels.at(-1)?.[entry.part] : undefined;
    if (coarse !== undefined) return coarse;
    return { geometry: entry.batch.geometry, material: entry.batch.material };
  }

  /** The `@x,z` half of a caster cluster key, for a resident cell. */
  #clusterOf(cell: IResidentCell): string {
    return clusterOf(cell.x, cell.z, this.#cellsPerCluster);
  }

  /**
   * The `@x,z` half of the main cull's own visibility-cell key, for a resident cell. This is what a
   * main batch's blocks are grouped by and what `#cullMainPass` tests, so it is the granularity the
   * main pass is culled at; the caster clusters above are the shadow levels' and are left alone.
   */
  #cullCellOf(cell: IResidentCell): string {
    return clusterOf(cell.x, cell.z, this.#cellsPerCullCell);
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
    role: "cluster" | "main" | "wide",
    receiveShadow: boolean,
  ): SharedBatch | undefined {
    const existing = this.#shared.get(key);
    if (existing !== undefined) return existing;
    const shape = this.#shapeFor(entry, role);
    const smallCaster = this.#smallCaster(assetId);
    // The batch released when this asset's last cell left the ring is the one to draw into again,
    // so the mesh keeps the uuid and the node three built for it. It costs no fresh allowance,
    // because it is not a fresh mesh.
    const released = this.#retired.get(key);
    if (released !== undefined) {
      this.#retired.delete(key);
      this.#retiredBytes -= this.#heldBytes(released);
      released.rebind(shape.geometry, shape.material);
      released.mesh.name = key;
      released.smallCaster = smallCaster;
      this.#dressMesh(released, receiveShadow);
      // A rebind swaps the geometry and may swap the buffer, so the key is dressed again: the indirect
      // record and the shared matrix buffer belong to the mesh, not to the batch.
      this.#adoptGpu(released, entry.asset, key, entry.level, entry.part);
      this.#shared.set(key, released);
      this.add(released.mesh);
      return released;
    }
    if (this.#freshThisUpdate >= this.#freshMeshesPerUpdate) return undefined;
    this.#freshThisUpdate += 1;
    const shared = new SharedBatch(
      shape.geometry,
      shape.material,
      this.#runMax.get(assetId) ?? entry.batch.count,
      // A caster cluster's block count is bounded by the cluster's own cells; a wide caster and the
      // main pass's one mesh per key are both bounded by the whole ring, so either way the one a
      // refilter holds beside the block it replaces.
      role === "cluster"
        ? this.#cellsPerCluster * this.#cellsPerCluster + 1
        : this.#budgets.residentCells + 1,
      key,
      this.#extentBounds,
      role,
    );
    shared.smallCaster = smallCaster;
    this.#dressMesh(shared, receiveShadow);
    this.#adoptGpu(shared, entry.asset, key, entry.level, entry.part);
    this.#shared.set(key, shared);
    this.add(shared.mesh);
    return shared;
  }

  /**
   * The shadow half of the split, and the two granularities of it. A caster mesh lives alone on
   * `VIRTUAL_SHADOW_CASTER_LAYER` — one per world-grid square, which a level whose window is a
   * fraction of the ring culls down to the squares it covers — and a wide mesh alone on
   * `VIRTUAL_SHADOW_WIDE_CASTER_LAYER`, one per key, which a level whose window covers the ring
   * submits once. The level cameras draw one of the two layers and never both, so a key costs the
   * main pass one draw, a fine level a few and a wide level one. Neither receives: nothing but a
   * shadow level ever sees either. A main mesh keeps layer 0 and casts nothing, because its records
   * reach the shadow maps only through a caster half.
   */
  #dressMesh(shared: SharedBatch, receiveShadow: boolean): void {
    const mesh = shared.mesh;
    const role = shared.role;
    // Every role's records are written into the instance buffer, never moved in the world, and the
    // mesh is created and released per role — so this is the one place that covers a fresh mesh, a
    // rebound one and the three roles. Static here is only safe because every write announces
    // itself: `instanceMatrix.needsUpdate` bumps the attribute's version, which is what a settled
    // draw watches to know it still has to scan.
    markStatic(mesh);
    if (role !== "main") {
      mesh.layers.set(
        role === "cluster"
          ? VIRTUAL_SHADOW_CASTER_LAYER
          : shared.smallCaster
            ? VIRTUAL_SHADOW_SMALL_CASTER_LAYER
            : VIRTUAL_SHADOW_WIDE_CASTER_LAYER,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      return;
    }
    mesh.layers.set(0);
    mesh.castShadow = false;
    mesh.receiveShadow = receiveShadow;
    // Nothing to hang off a main mesh: the window is narrowed by `#cullMainPass` for the whole set,
    // because a batch that drew nothing is hidden and three never reaches an invisible mesh's own
    // hooks — a mesh that could only re-narrow itself in its `onBeforeRender` would stay hidden for
    // as long as the camera looked away. That leaves `onBeforeRender` to the prewarm borrow alone.
  }

  /**
   * Name one main key to the GPU scene, and dress its mesh against the scene's live buffers.
   *
   * A caster or wide key is named `@x,z` or `@*` and belongs to the shadow passes, which the GPU scene
   * does not touch, so those are left exactly as they were.
   *
   * The key is recorded whether or not the scene is on, because a prewarm mints a whole ring before
   * the first frame that can answer whether this backend can run the scene, and a key recorded only
   * when the dress happened is a key the scene is never told about. `#seedGpuKeys` comes back for
   * those; see there.
   */
  #adoptGpu(shared: SharedBatch, assetId: string, key: string, level: number, part: number): void {
    if (shared.role !== "main") return;
    const named = { asset: this.#canonical(assetId), key, level, part };
    shared.main = named;
    if (this.#gpuScene.on === false) return;
    shared.gpu = named;
    this.#dressGpu(shared, named);
  }

  /**
   * Point one main key's mesh at the GPU scene's buffers, and hand the asset's gate table over.
   *
   * The mesh's `instanceMatrix` becomes the shared compacted matrix buffer, its geometry a clone that
   * shares the part's own attributes and carries this key's indirect record, and its whole-mesh
   * frustum test is off — the dispatch already tested every instance against the camera's six
   * planes, and the mesh's own bounds are the whole resident ring. Idempotent: a settled frame's
   * buffers are the ones it was dressed against, and a regrow, a rebind or a `grow` replaces them,
   * which is the only thing that brings a dressed mesh back through here.
   *
   * A key whose placements outgrew its region is regrown here rather than silently dropping instances
   * against the capacity guard, which is what a fixed ceiling did to any key a walk filled past.
   *
   * The buffers are read after `scene.key` rather than before it, because minting the first key is
   * what allocates them: a dress that gave up on their absence was a dress that never happened, and
   * the only frame that would have retried it was one whose fast path had already found the mesh
   * dressed. A regrow replaces them, so the attribute handed to the mesh is the one a draw will read.
   */
  #dressGpu(
    shared: SharedBatch,
    key: {
      readonly asset: string;
      readonly level: number;
      readonly part: number;
      readonly key: string;
    },
  ): void {
    const scene = this.#gpuScene;
    const asset = this.#assets.get(key.asset);
    const part = asset?.levels[key.level]?.[key.part];
    if (asset === undefined || part === undefined) return;
    // The asset's own resident placements, not one level's share of them: a placement's level is
    // decided per frame from where the camera is, so every level's region has to hold all of them.
    const capacity = Math.max(shared.liveCeiling, this.#gpuResident.get(key.asset) ?? 0);
    const settled = scene.drawn;
    const held = scene.regionOf(key.key);
    if (
      settled !== undefined &&
      shared.mesh.instanceMatrix === settled &&
      shared.mesh.frustumCulled === false &&
      (held?.capacity ?? 0) >= capacity
    )
      return;
    const region = scene.key(key.key, new Float32Array(part.local.elements), capacity, {
      group: `${key.asset}:${String(key.level)}`,
      part: key.part,
      // The whole run at once, so a part minted later lands in the slot `firstKey + part` names
      // rather than at the end of the key space, where another level's key is in between.
      parts: (asset.levels[key.level] as readonly IAssetPart[]).length,
    });
    if (region === undefined) return;
    const drawn = scene.drawn;
    const args = scene.args;
    const args2 = scene.regionOf(key.key);
    if (drawn === undefined || args === undefined || args2 === undefined) return;
    const mesh = shared.mesh;
    const compiled = mesh.instanceMatrix !== drawn;
    mesh.instanceMatrix = drawn;
    // Its own geometry object, so the indirect record is this mesh's, over the SAME attributes: the
    // original is the shape the caster halves and a rebind still draw with. `clone()` would copy
    // every vertex buffer of every key a second time.
    mesh.geometry = indirectView(mesh.geometry, args, args2.argsIndex * DRAW_ARGS_BYTES);
    mesh.frustumCulled = false;
    // Three builds an instanced mesh's instancing node when the mesh is first compiled, from the
    // `instanceMatrix` it had then, and keeps it: a mesh the prewarm already drew keeps reading its
    // old per-mesh buffer, which nothing writes once the GPU scene culls. Measured on machinefall:
    // validation matched every count and matrix while the distant forest drew nowhere. A material of
    // its own gives the mesh a fresh build against the storage buffer; it is disposed with the mesh.
    if (compiled) redressMaterial(mesh);
    shared.gpu = key;
    // What the record has to say for the draw to name a triangle: the view's own index count, which
    // is the shape this key draws. The scene is told rather than left to guess, so its validation can
    // hold the record against it.
    scene.indexCount(key.key, mesh.geometry.index?.count ?? 0);
    // The asset's gate table is built from the keys minted so far, so a level whose key is not minted
    // yet carries no parts and the dispatch draws that level nowhere. Re-registering is a no-op while
    // the table holds, and a rewrite when a key joined it.
    scene.slot(key.asset, this.#gatesOf(key.asset, asset));
  }

  /**
   * The asset's own gates, as the kernel reads them: the CPU path's switch distances and cull
   * distance, and the scene key each level's parts draw into. A level with no minted key has no parts,
   * so the dispatch draws nothing at that level rather than reading a key that is not there.
   */
  #gatesOf(id: string, asset: IAssetState): IAssetSlot {
    const gates: { firstKey: number; parts: number }[] = [];
    // The level's own contiguous run, which is what the kernel's `firstKey + part` addresses. Read
    // back from the scene rather than remembered here: a table that recorded the key index it saw
    // last named the wrong part as the first, and a multi-part asset then drew nothing anywhere.
    for (const [level] of asset.levels.entries())
      gates.push(this.#gpuScene.levelKeys(`${id}:${String(level)}`) ?? { firstKey: 0, parts: 0 });
    return {
      cull: cullDistance(asset.definition.maxDistance),
      distances: asset.distances,
      levels: gates,
    };
  }

  /**
   * Rebuild every resident run once, so a scene that came up after the ring was built is given the
   * source records it was built without.
   *
   * `WorldCells.update` can be called before it has a renderer, and a renderer that is not WebGPU
   * never turns the scene on at all; either way the cells that were swapped in while it was off hold
   * placements the dispatches have never heard of, and nothing else in the class would ever hand them
   * over. One rebuild of the ring is the whole fix, and it is the same build every first-seen asset
   * takes: `replace` keeps the old batches drawn until each new one is attached, so the rebuild is
   * not a frame of holes.
   */
  #seedGpuSources(): void {
    for (const cell of this.#resident.values())
      for (const batch of cell.batches) {
        const asset = this.#assets.get(batch.asset);
        if (asset === undefined || asset.levels.length === 0) continue;
        // One rebuild per run, not per batch: a run's placements are one build, and queueing it per
        // batch would rebuild the same placements once per level and part.
        this.#queueBuild(asset, cell, batch.run, true);
      }
  }

  /**
   * Dress every main batch the world already holds, the mirror of {@link #seedGpuSources} for the
   * keys rather than the sources: the keys a prewarm minted on the loading screen were minted with
   * the scene off, and a key is only named at mint time, so a ring built that way came up with an
   * empty region table and every batch still drawing from its own buffer. The dispatch was drawing
   * 21,094 placements into no region at all, and the validation marker said so — `compared=0` — for
   * a scene that reported itself on.
   *
   * The pool is seeded with the rest: a retained key's mesh is handed back by a rebind rather than
   * re-minted, and rebinding replaces the instance buffer, so a parked batch is undressed by the
   * park and dressing it here is what leaves the walk with a key that is already in the table. From
   * here every main batch carries `gpu`, which is what puts it on the dispatch's per-instance answer
   * and off the CPU repack and the refilter.
   */
  #seedGpuKeys(): void {
    for (const shared of this.#shared.values()) this.#seedGpuKey(shared);
    for (const shared of this.#retired.values()) this.#seedGpuKey(shared);
  }

  /** Dress one undressed main batch, or leave a batch the scene does not touch. */
  #seedGpuKey(shared: SharedBatch): void {
    // `main` is the key; `gpu` is the mesh pointing at the scene's buffers. A dressed mesh is left
    // alone, and `#dressGpu` says so itself — it is idempotent against the buffers it was given.
    if (shared.main === undefined || shared.gpu !== undefined) return;
    this.#dressGpu(shared, shared.main);
  }

  /**
   * The main meshes the scene owns and the main meshes the world holds, live and pooled, which is
   * the `dressed=N/M` the marker carries. A scene reporting itself on over a ring it never dressed
   * read `dressed=0/21094` on nothing, so the number is the owner's: the scene cannot see the meshes.
   */
  #gpuCensus(): { readonly dressed: number; readonly meshes: number } {
    let dressed = 0;
    let meshes = 0;
    for (const batch of [...this.#shared.values(), ...this.#retired.values()]) {
      if (batch.role !== "main") continue;
      meshes += 1;
      if (batch.gpu !== undefined) dressed += 1;
    }
    return { dressed, meshes };
  }

  /**
   * Every dressed main mesh's own draw, and what this class's own records say it should be holding.
   *
   * The scene's own validation mirrors its own kernel, so a key, a record and a mesh that do not
   * correspond are one both sides reproduce and a check that reports `ok` over a forest drawn with
   * another tree's geometry. These are the three numbers that are not the scene's: the mesh's own
   * name, the record its own geometry points at (`indirectOffset`, which a dress wrote), and the
   * instances this path composed for that key — level chosen by {@link levelAt} over the gates
   * {@link assetLevels} built, culled by this path's own cull distance, and multiplied by the part's
   * own offset in `#addPlacements`. The dressed mesh no longer holds those instances (its buffer is
   * the scene's shared one), which is why they are read back out of the per-cell batches.
   */
  #gpuDraws(): readonly IMeshDraw[] {
    const draws: IMeshDraw[] = [];
    for (const shared of this.#shared.values()) {
      if (shared.role !== "main" || shared.gpu === undefined) continue;
      const geometry = shared.mesh.geometry;
      // `indirectOffset` is typed as an offset or a list of them; a scene's own record is one
      // number, and a list is not a record this check can name, so it is not compared.
      const offset = geometry.indirectOffset;
      if (geometry.indirect === undefined || typeof offset !== "number") continue;
      draws.push({
        instances: this.#cpuRecords(shared.mesh.name),
        name: shared.mesh.name,
        record: offset / DRAW_ARGS_BYTES,
      });
    }
    return draws;
  }

  /**
   * The CPU path's own instance records for one main key: every resident cell's share of it, in the
   * order the cells hold them. The key is named, not decomposed, so the cells are matched by the same
   * string a key is minted under — a check that re-derived the name would be naming its own answer.
   */
  #cpuRecords(key: string): Float32Array {
    let count = 0;
    for (const cell of this.#resident.values())
      for (const entry of cell.batches) if (this.#keyOf(entry) === key) count += entry.batch.count;
    const out = new Float32Array(count * 16);
    let at = 0;
    for (const cell of this.#resident.values())
      for (const entry of cell.batches)
        if (this.#keyOf(entry) === key) at += entry.batch.writeMatrices(out, at) * 16;
    return out;
  }

  /**
   * The source records one swapped-in entry draws from: one per placement, not per part, because the
   * part's own offset is the key's and the dispatch composes it. Every part of the level shares the
   * list, which is why releasing one is idempotent and a whole level's records are handed back by the
   * first of its entries that leaves.
   */
  #placeSources(job: IBuildJob, entry: ICellBatch): number[] | undefined {
    const sources = job.sources;
    if (sources === undefined) return undefined;
    const asset = this.#assets.get(entry.asset);
    if (asset === undefined) return undefined;
    const slot = this.#gpuScene.slot(entry.asset, this.#gatesOf(entry.asset, asset));
    if (slot < 0) return undefined;
    const byLevel = job.gpuByLevel ?? new Map<number, number[]>();
    job.gpuByLevel = byLevel;
    const held = byLevel.get(entry.level);
    if (held !== undefined) return held;
    const records: number[] = [];
    for (const source of sources)
      if (source.level === entry.level) {
        const at = this.#gpuScene.place(
          slot,
          source.matrix,
          source.x,
          source.y,
          source.z,
          source.radius,
        );
        if (at >= 0) records.push(at);
      }
    byLevel.set(entry.level, records);
    // What a key of this asset has to be able to hold, on any level: see `#dressGpu`.
    this.#gpuResident.set(entry.asset, (this.#gpuResident.get(entry.asset) ?? 0) + records.length);
    return records;
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
    // Live records, not the draw window: a main batch whose squares are all behind the camera still
    // holds its records, and that is not a batch to dispose.
    if (shared.live > 0) {
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
   * Whether this level's own batches cast. Only the caster clusters ask; a main mesh never casts, so
   * the shadow map holds exactly the cluster meshes a level's window covers.
   */
  #casts(level: number): boolean {
    return this.#castShadowLevels > level;
  }

  /**
   * An asset too small to resolve in any window but the finest one's, so its wide caster goes on
   * that level's layer alone. Measured on the authored bounds the package carries, which is the one
   * number a world has for every asset it never loaded a tree for.
   */
  #smallCaster(assetId: string): boolean {
    const bounds = this.#manifest.assets[assetId]?.bounds;
    if (bounds === undefined) return false;
    return bounds.max[1] - bounds.min[1] < this.#smallCasterMetres;
  }

  /**
   * A block in `shared` for one cell's `count` records, growing the buffer when it is full. `cluster`
   * is the world-grid square the cell sits in, and only a main batch keeps it: its draw window is
   * narrowed per square, and a square is a grouping, not a position.
   */
  #segmentIn(shared: SharedBatch, count: number, cluster?: string): number | undefined {
    const segment = shared.allocate(count, cluster);
    if (segment !== undefined) return segment;
    if (this.#freshThisUpdate >= this.#freshMeshesPerUpdate) return undefined;
    this.#freshThisUpdate += 1;
    const old = shared.grow();
    // The replacement is a different object, so the layer and the cull hook `grow` copied neither of
    // have to be dressed onto it again — a grown caster that kept layer 0 would be drawn by the main
    // camera and lost to the shadow level, and a grown main batch would stop narrowing at all.
    this.#dressMesh(shared, shared.role === "main" && this.#receiveShadow);
    this.add(shared.mesh);
    // The mesh this grow replaced goes back to the pool: a cached shadow level can still replay a
    // draw of it until its window next moves, and the pool keeps the buffer and the uuid rather
    // than letting one array of retired meshes grow without bound.
    parkMesh(old);
    return shared.allocate(count, cluster);
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
    const adopted = this.#adoptLevels(models);
    if (adopted === undefined) return;
    // Before the prewarm and the queued builds, both of which read the levels, the distances and
    // the gates: an asset whose chain widened it is batched at those levels from its first build.
    asset.levels = this.#widenWithChain(asset, adopted);
    // Every level and part of the asset now, before any of them is asked for. A level with no
    // placement in it is not drawn and would otherwise mint its mesh — and pay its node build — on
    // the frame a walk first moves far enough to switch into it.
    this.#queuePrewarm(asset);
    for (const cell of [...this.#resident.values()]) {
      for (const run of cell.cell.runs) {
        if (this.#canonical(run.asset) === asset.id) this.#queueBuild(asset, cell, run);
      }
    }
  }

  /**
   * An asset's loaded levels, widened with the ones its model's baked AutoLOD chain carries.
   *
   * An asset with authored `lods` keeps them: the package names its own shape at its own
   * distances, and a chain the loader also happens to have registered is a fallback for a package
   * that named none, not a second opinion over one that did. Everything downstream is unchanged by
   * the widening — a level is a level, and its switch is a gate like any other — so the batch keys,
   * the prewarm, the caster clusters and the retire/rebind pool all see the chain's levels as
   * ordinary ones.
   */
  #widenWithChain(
    asset: IAssetState,
    levels: readonly (readonly IAssetPart[])[],
  ): readonly (readonly IAssetPart[])[] {
    if (asset.definition.lods !== undefined) return levels;
    const chained = chainLevels(
      levels[0] as readonly IAssetPart[],
      this.#autoLodPixelsPerUnit,
      this.#autoLodMaxPixelError,
      asset.definition.maxDistance,
    );
    if (chained === undefined) return levels;
    asset.distances = chained.distances;
    asset.gates = [...chained.distances.slice(1), ...asset.gates];
    for (const gate of asset.gates) this.#noteGate(gate);
    asset.threshold = asset.gates.length === 0 ? undefined : Math.min(...asset.gates);
    this.#reportChainLod(asset.id, chained);
    return chained.levels;
  }

  /**
   * `TN_WORLD_LOD_CHAIN`, one line per asset that was widened: how many levels it is now drawn at,
   * where each takes over in metres to one decimal, and what each submits in triangles. Level 0
   * leads, so the first triangle count is what the asset submits today and the last is what it
   * submits past the last switch: the reduction is the whole point of the line.
   */
  #reportChainLod(id: string, chained: IChainLevels): void {
    this.#chainLodAssets += 1;
    if (this.#chainLodAssets > CHAIN_LOD_MARKER_LIMIT) {
      if (this.#chainLodSummarised) return;
      this.#chainLodSummarised = true;
      console.info(
        `TN_WORLD_LOD_CHAIN more than ${String(CHAIN_LOD_MARKER_LIMIT)} assets carry a chain; ` +
          `the rest are one line: assets=${String(this.#chainLodAssets)}`,
      );
      return;
    }
    const listed: string[] = [];
    for (const distance of chained.distances) listed.push(distance.toFixed(1));
    console.info(
      `TN_WORLD_LOD_CHAIN ${id}: levels=${String(chained.levels.length)} ` +
        `distances=${listed.join(",")} tris=${chained.triangles.join(",")}`,
    );
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

  /**
   * One entry per asset of `cell` the follow point has moved a gate of, nearest placement first.
   *
   * The cell's own bracket is the caller's: it was derived once for the cell, and every batch of a
   * cell is measured against the same rectangle, so deriving it per batch was the same four
   * `Math.max` and two `Math.hypot` calls as many times as the cell had batches. What is left here is
   * per batch: one moved-point test and, for a batch that moved, its own bracket.
   *
   * Nothing is allocated to find them: the entries go into one reused array, the per-cell "already
   * seen" set into another, and a pass that crossed no gate anywhere pushes nothing at all.
   */
  #staleIn(cell: IResidentCell, x: number, z: number, near: number, far: number): void {
    const seen = this.#staleSeen;
    seen.clear();
    for (const entry of cell.batches) {
      if (entry.threshold === undefined || seen.has(entry.asset)) continue;
      // Every level of one asset was filtered from the same follow position, so the first entry
      // settles the asset and the levels behind it are already stale.
      seen.add(entry.asset);
      if (Math.hypot(x - entry.lastFilterX, z - entry.lastFilterZ) <= entry.threshold / 8) continue;
      const asset = this.#assets.get(entry.asset);
      if (asset === undefined) continue;
      const [builtNear, builtFar] = this.#span(cell, entry.lastFilterX, entry.lastFilterZ);
      const low = Math.min(near, builtNear);
      // Ends included, so a placement exactly on a gate is one of the reasons to rebuild.
      const high = Math.max(far, builtFar);
      if (!asset.gates.some((gate) => gate >= low && gate <= high)) continue;
      this.#stale.push({ cell, distance: near, id: entry.asset });
      this.#staleEntries += 1;
    }
  }

  /**
   * Record that one more gate distance exists, keeping the world's list ascending so
   * {@link crossesGate} can binary search it. A gate is never withdrawn: an asset whose ring left
   * still leaves its distances behind, which costs a cell the gate test does not reject and never a
   * rebuild the pass owes.
   */
  #noteGate(gate: number): void {
    const gates = this.#gates;
    if (gates.includes(gate)) return;
    let at = gates.length;
    while (at > 0 && (gates[at - 1] as number) > gate) at -= 1;
    gates.splice(at, 0, gate);
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
    this.#refilters += 1;
    const stale = this.#stale;
    stale.length = 0;
    this.#collectStale(x, z);
    // Only what was found, and usually a handful of entries.
    if (stale.length > 1) stale.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
    // What the cap could not queue is still owed, and `#refilterStale` reads that: a standing follow
    // point has to keep coming back for it, or a walk that stopped mid-drain never finished.
    this.#refilterOwed = stale.length > this.#rebuildsPerUpdate;
    for (const job of stale.slice(0, this.#rebuildsPerUpdate)) {
      const asset = this.#assets.get(job.id);
      if (asset === undefined || asset.levels.length === 0) continue;
      // Every run of the group, not just the one that happens to carry the canonical's name: a cell
      // holding two names for one model has two stale answers, and rebuilding only the named one
      // left the other drawing the level its own distance has moved out of.
      for (const run of job.cell.cell.runs) {
        if (this.#canonical(run.asset) !== job.id) continue;
        this.#queueBuild(asset, job.cell, run, true);
        this.#rebuilds += 1;
      }
    }
  }

  /**
   * Every resident cell's stale assets, into the reused list, nearest placement first.
   *
   * A cell is gated as a whole before one of its batches is looked at: its own bracket is derived
   * once, unioned with every distance any of its batches was filtered from, and one binary search
   * over the world's gates decides it. No gate in that range means no asset of the cell can have
   * changed side of one, so its batches are not walked at all — which is the whole cost of a pass in
   * which the follow point has not yet reached anything that switches.
   */
  #collectStale(x: number, z: number): void {
    for (const cell of this.#resident.values()) {
      const [near, far] = this.#span(cell, x, z);
      const low = near < cell.filterNear ? near : cell.filterNear;
      const high = far > cell.filterFar ? far : cell.filterFar;
      if (!crossesGate(this.#gates, low, high)) continue;
      this.#staleIn(cell, x, z, near, far);
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

  /**
   * Hand the chunk's own buffers to the renderer now, and report how many it took.
   *
   * A compile builds pipelines, not geometry, so the bake's new attributes reached the device on
   * whichever frame first drew them — 826 buffers and 228.8 MB on an 8 s walk, 33 of them over a
   * megabyte, lining up exactly with the p95 and max frame spikes. The backend's own attribute
   * creation is idempotent, so this is a move rather than a second upload, and a renderer with no
   * such seam answers 0 and behaves as it did.
   */
  #uploadAttributes(chunk: Object3D): number {
    const upload = this.#renderer?.uploadAttributes;
    if (upload === undefined) return 0;
    const geometries = new Set<BufferGeometry>();
    chunk.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh === true) geometries.add(mesh.geometry);
    });
    return upload(geometries);
  }

  /**
   * Compile a merged chunk before anything can draw it, and report whether the compile came back.
   *
   * A chunk's first draw is the most expensive frame a streaming world has: its own first draw built
   * nodes and a render pipeline synchronously, and one chunk cost **248 ms of a 291 ms walk** in the
   * census that found it. The engine already owns this work — `warmUpScene` drives the renderer's
   * own `compileAsync`, and this is that same call with the world as the target scene, so the chunk's
   * materials resolve the same lights, environment and clipping the real frame will resolve them
   * against. A pipeline compiled against no lights would be a different pipeline, and the frame would
   * still pay for it.
   *
   * It is bounded by `within`, the warm-up's own bound: a compile that never settles is abandoned and
   * the chunk is attached anyway, because a missing chunk is worse than a slow frame. A world that is
   * in no scene is skipped outright — nothing projects it, so a compile would build nothing, which is
   * the same answer `load()` gets, where the loading screen is about to draw it anyway.
   */
  async #warmChunk(chunk: Object3D): Promise<boolean> {
    const renderer = this.#renderer;
    const camera = this.#camera;
    if (renderer === undefined || camera === undefined || this.parent === null) return false;
    // The rejected compile is a pipeline this warm-up could not build, not a reason to fail the
    // admission: the frame that needs it will try again and fail there, where the error belongs.
    return within(
      renderer.compileAsync(chunk, camera, this),
      CHUNK_WARM_TIMEOUT_MS,
      yieldToHost,
      warmClock,
    );
  }

  async #attachChunks(
    cell: IResidentCell,
    generation: number,
    models: readonly Object3D[],
  ): Promise<void> {
    const live = (): boolean => this.#cellLive(cell, generation);
    let attached = 0;
    // Merged and shaped, not yet in the world: the compile below runs between the two, and a cell
    // that left the ring in the middle takes its prepared chunks with it.
    const prepared: { readonly object: Object3D; readonly proxies: number }[] = [];
    try {
      const report = await addInSlices(
        models,
        (object) => {
          if (!live()) return;
          object.name = CHUNK_NAME;
          // One draw per material before the chunk is ever added, so the main pass and every shadow
          // level that redraws it submit the chunk's materials rather than its nodes. A refusal
          // leaves the chunk exactly as authored and is counted: it never costs the chunk itself.
          const merge = mergeChunk(
            object,
            this.#chunkMergeMaxTriangles,
            // A `loadModel` override parses per load, so a chunk's shapes are this world's to
            // release; `assets.model` caches by path and hands the same scene back, so they are not.
            this.#loadModel !== undefined,
            this.#castShadowLevels > 0,
            this.#proxyMaterials,
          );
          // The buffers the bake just made, uploaded here rather than on the chunk's first draw,
          // which is the frame that uploads them today: 228.8 MB over 826 `createAttribute` calls
          // in a browser walk, and up to 230 ms inside the frames that first submitted them.
          // `addInSlices` is the admission budget, so this is one chunk per update, never a batch.
          const uploaded = this.#uploadAttributes(object);
          if (merge === undefined) this.#failures += 1;
          else {
            this.#failures += merge.failed;
            console.info(
              `TN_WORLD_CHUNK_MERGE meshes=${String(merge.meshes)} draws=${String(merge.draws)} ` +
                `bytes=${String(merge.bytes)} uploaded=${String(uploaded)} ` +
                `instancedExpanded=${String(merge.expanded)} keptInstanced=${String(merge.keptInstanced)} ` +
                `shadowDraws=${String(merge.shadowDraws)}`,
            );
          }
          // Hand-placed chunks are the buildings and set dressing: full shape, so they cast with the
          // near scatter and receive like everything else when the game asks for shadows. A merged
          // opaque mesh the proxy covers keeps receiving and stops casting: the depth pass reads the
          // proxy, so casting from both would pay the bill the proxy was built to remove. The proxy
          // itself is off layer 0 and already carries what the level cameras need of it.
          if (this.#castShadowLevels > 0 || this.#receiveShadow) {
            const covered = new Set(merge?.shadowCovered);
            object.traverse((node) => {
              if (node.layers.isEnabled(0) === false) return;
              node.castShadow = this.#castShadowLevels > 0 && !covered.has(node as Mesh);
              node.receiveShadow = this.#receiveShadow;
            });
          }
          prepared.push({ object, proxies: merge?.shadowDraws ?? 0 });
        },
        { marker: false, while: live },
      );
      if (report.stopped)
        for (let i = report.added; i < models.length; i += 1)
          this.#failures += disposeModel(models[i] as Object3D);
      for (const { object, proxies } of prepared) {
        // The compile is the whole point of the wait, and the wait is the only thing between the
        // merge and the attach. Everything the world does not own is released when the cell that
        // asked for the chunk is gone, so a chunk that arrives after its cell left is torn down here
        // rather than compiled and thrown at a world that is not looking.
        if (live()) await this.#warmChunk(object);
        if (!live()) {
          this.#failures += disposeModel(object);
          continue;
        }
        cell.chunks.push(object);
        this.add(object);
        // A loaded chunk is placed once and never rewritten: its transforms, geometry and material
        // are the ones the export gave it, so it is the one subtree here with nothing to announce.
        markStatic(object);
        // The proxies' shadow pipelines are the one thing a compile cannot build — three creates a
        // shadow variant on the first pass that draws the caster, and the pass is the levels'. So
        // the levels are told a caster arrived, exactly as a prewarmed caster cluster tells them:
        // the first level whose window covers the chunk submits the proxy and builds it. With one
        // material per `side` world-wide, that is one pipeline for the world's first chunk of each
        // side and a node binding for every chunk after it, not a compile per chunk. The chunk's
        // own box is the region, from the merged geometry's boxes rather than its vertices: a chunk
        // is loaded once and the region is only asked to be no wider than the chunk.
        if (proxies > 0) this.#shadowRecordsMoved(new Box3().setFromObject(object, false));
        attached += 1;
      }
    } catch {
      this.#failures += 1;
      for (let i = attached; i < models.length; i += 1)
        this.#failures += disposeModel(models[i] as Object3D);
    }
  }

  #evict(cell: IResidentCell): void {
    this.#residencyEpoch += 1;
    // Work queued for a cell that has left is dropped, not resumed: a later frame would build
    // batches into a graph that no longer holds the cell, and the residency slot is already gone.
    this.#jobs = this.#jobs.filter((job) => {
      if (job.cell !== cell) return true;
      this.#queued.delete(job.run);
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
    // ring are ground the levels were drawing, and they are named one batch at a time.
    this.#shadowRecordsMoved(this.#changedBounds(cell.batches, []));
    cell.batches.length = 0;
    for (const chunk of cell.chunks) {
      chunk.removeFromParent();
      this.#failures += disposeModel(chunk);
    }
    cell.chunks.length = 0;
    this.#resident.delete(cell.key);
    this.#cullEvicted(cell);
    this.#instances -= cell.instances;
    this.#bytes -= cell.bytes;
    this.#evictions += 1;
    // One per run, so the canonical's refcount reaches zero exactly when the last run naming any
    // member of its group has left the ring.
    for (const run of cell.cell.runs) this.#release(this.#canonical(run.asset));
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
