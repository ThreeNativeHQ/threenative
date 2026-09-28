import {
  Box3,
  type BufferGeometry,
  type Camera,
  type DirectionalLight,
  type Material,
  type Mesh,
  Object3D,
  type OrthographicCamera,
  type RenderTarget,
  Sphere,
  Vector3,
} from "three";
import {
  Fn,
  If,
  abs,
  and,
  float,
  max,
  min,
  positionWorld,
  shadow,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import {
  type Node,
  type NodeBuilder,
  type NodeFrame,
  type Renderer,
  ShadowBaseNode,
  type UniformNode,
} from "three/webgpu";
import { lodChainOf } from "../model-lod.js";
import {
  DirectionalClipmap,
  type IBoundsLike,
  type IClipWindow,
  type IVector3Like,
  ShadowInvalidationTracker,
  projectBounds,
} from "./virtual-shadow-pages.js";

/** One clipmap axis' view of a world region, as the interval it covers in light space. */
type ILightAxisRange = { low: number; high: number };

/**
 * Why a level owes a render: not at all, a window that moved, or an invalidation that asked and
 * waited out its delay. The render it finally takes is counted against this, so a level the frame's
 * single budget passed over is not counted twice.
 */
type RenderReason = 0 | 1 | 2;
const REASON_NONE: RenderReason = 0;
const REASON_MOVE: RenderReason = 1;
const REASON_INVALIDATION: RenderReason = 2;

/**
 * Options for {@link VirtualShadowNode}. Every value is a mechanism parameter; the light's own
 * `shadow` keeps bias, normalBias, intensity, map type and filter, exactly as with a stock shadow.
 */
export interface IVirtualShadowOptions {
  /**
   * Half-width of each clip level's window in world units, finest first and strictly
   * increasing. Default `[16, 48, 144]`: three windows, each three times wider than the last.
   */
  readonly clipExtents?: readonly number[];
  /** Texels per level edge. Default: the light's `shadow.mapSize.width`. */
  readonly mapSize?: number;
  /**
   * Texels per edge of each level's mover map — the map tracked casters draw into every frame.
   * Default: half of `mapSize`, never below 256. Movers are few and close, so half the texels
   * over the same window reads as the same shadow at a quarter of the fill.
   */
  readonly moverMapSize?: number;
  /**
   * Fraction of a level's extent inside which a fragment still selects that level, `(0, 1]`,
   * default 0.9 — the outer ring falls through to the next level so the edge is never sampled.
   * `selectionGuard` minus `refreshStep`, since a window trails its centre by that much. One value
   * for every level, or one per level finest first, the last entry standing in for the rest.
   */
  readonly selectionGuard?: number | readonly number[];
  /**
   * Fraction of a level's extent its window may trail the followed centre by before it re-renders,
   * `[0, selectionGuard)`, default 0.125 — `refreshStep: 0` keeps the old one-texel step. The step
   * is rounded to a whole number of that level's texels, so a walking camera re-renders a level
   * ~`1/refreshStep` times less often while the shadow texels stay on one fixed world grid. Costs
   * that much of `selectionGuard`, which it is already reduced by, so a window never reaches past
   * the trailing edge of a map rendered before the centre moved. One value for every level, or one
   * per level finest first, the last entry standing in for the rest — the fine level is the one a
   * walking camera re-renders most, so it is the one that wants the larger step.
   */
  readonly refreshStep?: number | readonly number[];
  /**
   * How long a level waits after its own last render before an invalidation may re-render it, in
   * seconds. One value for every level, or one per level finest first, the last entry standing in
   * for the rest. Default `0.25 * extent / finestExtent` — 0.25 s, 1 s and 3.33 s for extents
   * 24 / 96 / 320 — and `0` renders on the very next frame, which is what the node did before.
   *
   * A streamed world invalidates its shadows on every residency update, and a cell admitted at the
   * ring edge lands in the coarsest window: the level that redraws for it is the one paying for the
   * whole ring's wide casters, ten times a second where movement alone asks for two. A level
   * waiting out its delay keeps the map and window it has, which is already right for every static
   * caster in it, so only a newly streamed caster is missing — the trade is that a far tree's
   * shadow can appear up to the delay late (3.33 s at extent 320, invisible on a level whose texel
   * is wider than the tree). A window that moved is never delayed: that is a different reason, and
   * it is not this option's.
   */
  readonly invalidationDelay?: number | readonly number[];
  /**
   * How far behind the window centre each level camera sits, in world units. Default 200. An
   * explicit `lightDistance` *and* `depthRange` switch the level's light-space depth off the derived
   * span below and back onto this pair, so a game that knows its own world sizes can still say so.
   */
  readonly lightDistance?: number;
  /**
   * Depth range each level camera covers past its centre, in world units. Default 400. Read only
   * together with `lightDistance`; on its own the span is still derived.
   */
  readonly depthRange?: number;
  /**
   * Texels of a level a caster must cover before it draws into that level, default 1.5. A level's
   * texel is `2 * extent / mapSize`, so the finest levels keep everything and the coarse ones keep
   * only what they can resolve: a fern is a whole number of texels in a 48 m window and a fraction
   * of one in a 640 m window, so it stops being drawn there and the shadow it casts is the ground
   * cover's own, not its silhouette's. Set 0 to draw every caster into every level.
   */
  readonly minCasterTexels?: number;
  /**
   * Draw every level past the finest one with less geometry than the main pass would, default true.
   *
   * Two defaults, both Unreal's and both applied in one place — the draw gate three installs for a
   * level render, wrapped for the duration of that render only:
   *
   * 1. **Shadow LOD bias.** A mesh whose geometry carries a registered AutoLOD chain
   *    (`lodChainOf`) is submitted with the chain's *coarsest* geometry. A level 2 window cannot
   *    resolve a tree's needles, so drawing LOD0 there is a texel of needles per texel of shadow;
   *    the coarse level's own texel is metres wide. Level 0 draws what the main pass draws.
   * 2. **Alpha-caster range.** An alpha-tested (`alphaTest > 0`) or transparent mesh casts into the
   *    finest level only. Its cutout is its own texture: a coarse level either drops it — the
   *    level's texel is wider than the card, so the fence is sub-texel — or keeps resolving a
   *    texture it cannot afford. This is a per-primitive shadow cull distance, and the trade is
   *    honest and one-sided: a fence's or a foliage card's shadow ends where the finest level's
   *    window ends, and a wide level shows bare ground where it stood. Opaque casters — a merged
   *    chunk's position-only proxy, a tree's silhouette — are drawn on every level as before.
   *
   * Nothing here is left changed: the coarse geometry is set for the length of one draw and put
   * back, so the main pass and the mover maps of the finest level see the mesh exactly as authored.
   * `false` puts every level back on stock full-detail draws, which is what the node did before
   * either default existed.
   */
  readonly shadowLodBias?: boolean;
  /** Print the `TN_VIRTUAL_SHADOW` line every `markerEvery` frames; `false` silences it. Default 300. */
  readonly marker?: boolean | number;
}

/** Per-frame counters, readable any time through {@link VirtualShadowNode.stats}. */
export interface IVirtualShadowStats {
  readonly frame: number;
  readonly levels: number;
  /** Levels whose window moved this frame and were re-rendered. */
  readonly moved: number;
  /** Levels re-rendered because `invalidateAll()` or explicit tracker invalidation asked for it. */
  readonly invalidated: number;
  /** Tracked casters, as of this frame. */
  readonly movers: number;
  /** Mover maps rendered this frame: one per level when at least one caster is tracked. */
  readonly moverRenders: number;
  /** Levels served from their cached map this frame. */
  readonly cached: number;
  /** Levels rendered this frame, for any reason. */
  readonly rendered: number;
  /**
   * Levels that wanted a render this frame and did not get one, because the node renders at most
   * one level per frame. They keep the map they already have and come due again next frame.
   */
  readonly deferred: number;
  /**
   * Levels holding a redraw for an invalidation that is still inside its own `invalidationDelay`,
   * so this frame is not the frame they render on. They keep the map they have, which is right for
   * every static caster in it: only a caster streamed in since is missing, and the cumulative
   * `coalesced` below is what is being waited out.
   */
  readonly held: number;
  /** Fraction of levels served from cache over the node's lifetime. */
  readonly reuseRatio: number;
  /**
   * Level renders over the node's lifetime, for any reason. `byMove` and `byInvalidation` are the two
   * the node has — a window that moved, and an invalidation that asked and waited out its delay — and
   * they add up to this exactly, because a render the single per-frame budget defers is counted
   * against the reason that queued it and not again when it is finally taken.
   */
  readonly rendersTotal: number;
  /** Of those, the renders taken because a level's window moved. */
  readonly byMove: number;
  /** Of those, the renders taken because an invalidation asked and its level's delay had passed. */
  readonly byInvalidation: number;
  /**
   * Invalidation asks that cost no render of their own, over the node's lifetime: absorbed by a
   * render the level was taking anyway for its window, or merged into an ask already waiting out
   * that level's delay. The two of these are the shape of the win — with the default delays a walk
   * asks once a second and renders about that often, and every ask in between is counted here.
   */
  readonly coalesced: number;
  /**
   * The same four counters per level, finest first: which window moved, which invalidation asked
   * for a redraw, which level took the frame's single render, and which wanted one and did not get
   * it. One entry per level per frame, so a harness reading this — or the `TN_VIRTUAL_SHADOW`
   * marker line, which carries it — can see which level a walk keeps re-rendering instead of only
   * how many.
   */
  readonly perLevel: readonly IVirtualShadowLevelStat[];
}

/** One level's row of {@link IVirtualShadowStats}: 1 or 0 per counter, per frame. */
export interface IVirtualShadowLevelStat {
  /** The level's clip extent, in world units. */
  readonly extent: number;
  readonly deferred: number;
  readonly invalidated: number;
  readonly moved: number;
  readonly rendered: number;
}

export const VIRTUAL_SHADOW_MARKER = "TN_VIRTUAL_SHADOW";
/**
 * The object layer tracked casters are enabled on, so each level's mover camera sees only them.
 * Keep it free of other uses; the main camera never needs it (tracked objects keep layer 0).
 */
export const VIRTUAL_SHADOW_MOVER_LAYER = 29;
/**
 * The object layer a shadow-only caster is put on, so each level's own shadow camera renders it and
 * the main camera never sees it. The level cameras have it enabled already; an object that exists
 * only as a shadow caster calls `object.layers.set(VIRTUAL_SHADOW_CASTER_LAYER)`.
 */
// The layer a shadow-only object is put on: a level's own shadow camera renders it, the main
// camera never sees it. Three skips an object whose layers do not meet the camera's, and it
// overwrites a shadow camera's mask with the main camera's whenever that mask is layer 0 and
// nothing else — so enabling this bit on the level cameras is also what pins their mask, and a
// caster that lives only on it is reachable from the cascade and from nothing else. 28 is below the
// mover layer and off the main camera, which renders layer 0.
export const VIRTUAL_SHADOW_CASTER_LAYER = 28;
/**
 * The wide counterpart of {@link VIRTUAL_SHADOW_CASTER_LAYER}: one caster mesh per
 * `asset:level:part` holding every resident cell's records, for the levels whose window covers the
 * whole resident ring. A level renders exactly one of the two caster layers — whichever submits
 * fewer draws, counted off the meshes themselves, because a cluster per square is a draw per square
 * for the same pixels once the window holds the ring. `WorldCells` writes both halves of every key,
 * so whichever a level picks is there; the main camera renders neither.
 */
export const VIRTUAL_SHADOW_WIDE_CASTER_LAYER = 27;
/**
 * The wide casters too small to resolve anywhere but the finest level's own window: a fern, a tuft
 * of grass, a bush. `WorldCells` puts the wide half of any asset whose authored bounds are shorter
 * than `shadows.smallCasterMetres` here instead of on the wide layer, so a wide level submits one
 * caster draw per tree and none per tuft — the coarse levels' bill was hundreds of draws for
 * shadows a 192 m window cannot hold. Only the finest level renders this layer, and it renders it
 * beside whichever of the two caster granularities it picked, because a fern 4 m from the player
 * does have a shadow. Not on the main camera, and not a layer a game has to know about: nothing
 * chooses it but `WorldCells`.
 */
export const VIRTUAL_SHADOW_SMALL_CASTER_LAYER = 26;
const MIN_MOVER_MAP_SIZE = 256;
const DEFAULT_CLIP_EXTENTS: readonly number[] = [16, 48, 144];
const DEFAULT_MARKER_EVERY = 300;
/** Frames between markers while `?tnShadowStats=1` is on the URL: about a second a walk is long. */
const STATS_QUERY_EVERY = 60;
/**
 * The invalidation delay of the *finest* level, in seconds; every other level's is this times its
 * extent over the finest one. A burst of streamed invalidations is paid as one render, and the
 * level that pays it is the one whose window is widest.
 */
const BASE_INVALIDATION_DELAY = 0.25;
const DEFAULT_MIN_CASTER_TEXELS = 1.5;
/**
 * The floor on a light's horizontal magnitude, so a sun on the horizon divides by a `cos` that is
 * not zero: the reach of a caster grows without limit as the sun sets, and a level that spans the
 * sky is the one this whole change exists to stop drawing.
 */
const MIN_SUN_COSINE = 0.05;

/**
 * World spheres one level render collects: centre, radius, shadow flags, the box's own height
 * range, seven numbers each.
 */
const POOL_STRIDE = 7;
/**
 * How many window widths a caster may be before the window is cut out of it instead. One: an
 * object wider than the window it is in is a mass, and only its height reaches the frustum.
 */
const MAX_MASS_WINDOW_WIDTHS = 1;
const POOL_CASTERS = 1 << 0;

/** A placeholder light per level: the stock shadow node reads position and target from it. */
class LevelLight extends Object3D {
  readonly target = new Object3D();
  shadow: DirectionalLight["shadow"];
  override castShadow = true;

  constructor(shadow: DirectionalLight["shadow"]) {
    super();
    this.shadow = shadow;
  }
}

interface ILevel {
  readonly light: LevelLight;
  readonly shadow: DirectionalLight["shadow"];
  readonly node: ReturnType<typeof shadow>;
  /** Same window and placement as `shadow`, rendered every frame with only the tracked casters. */
  readonly moverShadow: DirectionalLight["shadow"];
  readonly moverNode: ReturnType<typeof shadow>;
  readonly extent: number;
  readonly extentUniform: UniformNode<"float", number>;
  /**
   * The light-space depth this level's last render derived: how far behind its window centre the
   * camera sat, and the near/far it drew with. Held between renders, because a level that keeps its
   * map is placed with the same span it drew that map with.
   */
  eye: number;
  depthNear: number;
  depthFar: number;
  minX: number;
  minY: number;
  /**
   * 1 once this level's map has been rendered at least once, 0 until then. A fragment never
   * samples a map this level has not drawn yet: with one render per frame the coarse levels are
   * behind on the frame the fine one comes due, and their targets have no depth in them yet.
   */
  readonly mapped: UniformNode<"float", number>;
  /**
   * Set when an invalidation asked for a redraw that has not been rendered yet, 0 until then. The
   * ask is held here instead of being consumed on the frame it arrives, so a level can wait out
   * `invalidationDelay` and still redraw; a render of any reason clears it.
   */
  dirty: boolean;
  /**
   * The engine frame clock's reading when this level last rendered, in seconds. A dirty level
   * re-renders for the invalidation no sooner than `invalidationDelay` after this. `-Infinity`
   * until the first render, so a level invalidated before it holds a map is due immediately.
   */
  lastRender: number;
  /**
   * Why this level owes a render the frame's single budget did not grant it: {@link REASON_NONE},
   * and the reason it was due otherwise. Sticky, so a level that was passed over stays due on the
   * next frame instead of waiting for its window to move again — and the render it eventually takes
   * is counted against the reason that queued it.
   */
  pending: RenderReason;
  /**
   * Where this level's *rendered* map sits, relative to the centre the fragment test measures
   * from. A level whose re-render was deferred still holds an older window, and its selection has
   * to be made against that window rather than the followed centre: the sampler reads through this
   * level's own camera, so testing against anything else is what makes a fragment reach past a
   * rendered map.
   */
  readonly offsetU: UniformNode<"float", number>;
  readonly offsetV: UniformNode<"float", number>;
  /** This level's own guarded extent fraction, for the same reason. */
  readonly guardUniform: UniformNode<"float", number>;
}

type ShadowWithFilter = DirectionalLight["shadow"] & { filterNode?: unknown };

const _direction = new Vector3();
const _center = new Vector3();
const _sphere = new Sphere();
const _box = new Box3();

/**
 * The diameter a shadow level's texel gate judges one caster by: the part's own geometry radius
 * times the largest instance scale `WorldCells` placed into this batch, or the mesh's own sphere
 * when it publishes no scale (anything the world does not own).
 */
function instanceDiameter(mesh: Mesh, sphereRadius: number): number {
  const scale = (mesh as Mesh & { casterInstanceScale?: number }).casterInstanceScale;
  if (scale === undefined || scale <= 0) return sphereRadius * 2;
  const geometry = mesh.geometry;
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere?.radius;
  if (radius === undefined || radius <= 0) return sphereRadius * 2;
  return radius * 2 * scale;
}

/** Keep each stock node's source-owned settings aligned with the public light shadow. */
function syncShadowSettings(
  source: DirectionalLight["shadow"],
  target: DirectionalLight["shadow"],
): void {
  target.bias = source.bias;
  target.biasNode = source.biasNode;
  target.blurSamples = source.blurSamples;
  target.intensity = source.intensity;
  target.mapType = source.mapType;
  target.normalBias = source.normalBias;
  target.radius = source.radius;
  (target as ShadowWithFilter).filterNode = (source as ShadowWithFilter).filterNode;
}

function syncLevelShadowSettings(
  source: DirectionalLight["shadow"],
  levels: readonly ILevel[],
): void {
  for (const level of levels) {
    syncShadowSettings(source, level.shadow);
    syncShadowSettings(source, level.moverShadow);
  }
}

/** The stock node's render entry, called here so the mover exclusion brackets exactly one render. */
interface IRenderingShadowNode {
  updateShadow(frame: NodeFrame): void;
}

/**
 * Three's per-draw gate for a shadow pass, as `getShadowRenderObjectFunction` builds it. The node
 * wraps whatever it is handed rather than reimplementing it, so the pass keeps three's own
 * `castShadow` and velocity decisions and only the geometry and the skip are ours.
 */
type ShadowRenderObjectFunction = NonNullable<Parameters<Renderer["setRenderObjectFunction"]>[0]>;

/**
 * Whether this draw's material cuts itself out — `alphaTest` against a map, or `transparent` — so
 * its shadow is its own texture rather than its silhouette's. A multi-material mesh is projected one
 * group at a time, so the material here is the one this draw would read.
 */
function isAlphaCaster(material: Material | undefined): boolean {
  if (material === undefined) return false;
  return material.transparent === true || material.alphaTest > 0;
}

/**
 * One directional shadow for a whole open world: camera-centred clip levels, each snapped to its
 * own texel grid and re-rendered only when its window moves. Movers never touch that cache: a
 * tracked caster draws into a second, per-level mover map every frame, and a fragment takes the
 * darker of the two — so a walking stag costs one small render of itself, not a render of the wood.
 *
 * Plugs into three's own slot, so every material in the scene receives it with no other change:
 * `light.shadow.shadowNode = new VirtualShadowNode(light, { clipExtents: [16, 48, 144] })`.
 *
 * What it owns is mechanism: level windows, texel snapping, per-level caching, invalidation,
 * level selection and the statistics. The light's `shadow` keeps bias, normal bias, intensity,
 * map type and filter, and those source settings are mirrored into each stock level node before
 * rendering. Per-level map sizes, cameras, `autoUpdate` and `needsUpdate` are owned by this node.
 * Each level is rendered by the stock {@link ShadowNode} through the renderer's shadow-map type,
 * so the look is the same code path a plain shadow uses. At most one level renders per frame,
 * finest first — a level render is a whole scene draw, and a level passed over keeps the map and
 * window it has, so a fragment only ever samples a map that level drew.
 *
 * Ported from the virtual-shadow-map prototype's clipmap and invalidation; the sparse page atlas
 * is deliberately not the first cut — a page needs the scene rendered once per page, and on a
 * forest of hundreds of instanced meshes three level renders are cheaper than twenty-four page
 * renders. The page pool and demand pass in `virtual-shadow-pages.ts` stay ready for it.
 *
 * @situation crisp shadows close to the player across a large outdoor level
 * @situation shadow map too coarse over a big terrain
 * @situation one directional light shadow for a whole open world
 * @situation shadows shimmer when the camera moves
 * @constraint the light must be a DirectionalLight with `castShadow` and a target in the scene
 * @constraint clipExtents are half-widths in world units, finest first, strictly increasing
 * @constraint call `trackCaster(object)` for movers; it enables layer `VIRTUAL_SHADOW_MOVER_LAYER` on the object and its descendants, tracking or untracking refreshes cached levels once, and subsequent mover movement refreshes only when a window moves
 * @override bias, biasNode, normalBias, intensity, radius, blurSamples, mapType and filterNode stay on `light.shadow`; mapSize and the other options here have defaults
 * @example
 * const sun = new DirectionalLight(0xffffff, 3);
 * sun.castShadow = true;
 * sun.shadow.shadowNode = new VirtualShadowNode(sun, { clipExtents: [12, 40, 120] });
 */
export class VirtualShadowNode extends ShadowBaseNode {
  static get type(): string {
    return "VirtualShadowNode";
  }

  readonly options: Required<
    Omit<IVirtualShadowOptions, "marker" | "refreshStep" | "selectionGuard" | "invalidationDelay">
  > & {
    readonly markerEvery: number;
    /** Per level, finest first; the last entry stands in for every level past it. */
    readonly refreshStep: readonly number[];
    /** The per-level `selectionGuard` each level's own window is drawn with. */
    readonly selectionGuard: readonly number[];
    /**
     * Per level, finest first: the seconds a dirty level waits after its own last render before an
     * invalidation may re-render it. Already scaled by that level's extent, so the fine levels
     * answer a streamed caster promptly and the coarse ones let a burst merge into one render.
     */
    readonly invalidationDelay: readonly number[];
  };
  readonly clipmap: DirectionalClipmap;
  /**
   * Compatibility handle for explicit page invalidation. Automatic caster motion uses mover maps;
   * callers that already update this tracker still invalidate the affected cached levels.
   */
  readonly tracker: ShadowInvalidationTracker;
  #levels: ILevel[] = [];
  #invalidateAll = false;
  /** Regions handed to `invalidateRegion`, read and cleared by the next `updateBefore`. */
  #regions: IBoundsLike[] = [];
  /** The same regions, resolved onto the clipmap's axes; scratch, so a frame allocates nothing. */
  #projectedRegions: { u: ILightAxisRange; v: ILightAxisRange }[] | undefined;
  #casters = new Map<string, Object3D>();
  #casterChildren = new Map<string, Set<Object3D>>();
  #moverLayerStates = new Map<Object3D, { originallyEnabled: boolean; references: number }>();
  #centerU: UniformNode<"float", number> = uniform(0);
  #centerV: UniformNode<"float", number> = uniform(0);
  #moversActive: UniformNode<"float", number> = uniform(0);
  #basisU: UniformNode<"vec3", Vector3> = uniform(new Vector3(1, 0, 0));
  #basisV: UniformNode<"vec3", Vector3> = uniform(new Vector3(0, 0, 1));
  #frame = 0;
  /** 1 while this node is inside `#updateFrame`; a level render re-enters `updateBefore`. */
  #updating = false;
  /** Per-level counters, rebuilt each frame; see `IVirtualShadowStats.perLevel`. */
  #perLevel: IVirtualShadowLevelStat[] = [];
  #rendered = 0;
  #served = 0;
  /** Cumulative level renders and the reason each took one; see `IVirtualShadowStats`. */
  #rendersTotal = 0;
  #byMove = 0;
  #byInvalidation = 0;
  #coalesced = 0;
  /** Read from the URL once, for the `?tnShadowStats=1` marker cadence. */
  #statsRequested: boolean | undefined;
  #stats: IVirtualShadowStats;
  #initialised = false;
  /** 1 when each level derives its own light-space depth, 0 when `lightDistance`/`depthRange` pin it. */
  #autoDepth = true;
  /**
   * Every shadow-relevant world sphere one level render collected, five numbers each. The depth
   * derivation reads it in two passes after the one traverse that filled it, and it is reused
   * between renders, so a level render allocates nothing for it.
   */
  #pool = new Float64Array(POOL_STRIDE * 256);
  #poolCount = 0;
  /** Casters the current level's size gate hid, restored the moment that render is over. */
  #hidden: Object3D[] = [];

  constructor(light: DirectionalLight, options: IVirtualShadowOptions = {}) {
    super(light);
    const clipExtents = options.clipExtents ?? DEFAULT_CLIP_EXTENTS;
    const mapSize = options.mapSize ?? light.shadow.mapSize.width;
    if (!Number.isInteger(mapSize) || mapSize <= 0) {
      throw new RangeError(
        `TN_VIRTUAL_SHADOW_INVALID: mapSize must be a positive integer, got ${String(mapSize)}.`,
      );
    }
    const moverMapSize =
      options.moverMapSize ?? Math.max(MIN_MOVER_MAP_SIZE, Math.floor(mapSize / 2));
    if (!Number.isInteger(moverMapSize) || moverMapSize <= 0) {
      throw new RangeError(
        `TN_VIRTUAL_SHADOW_INVALID: moverMapSize must be a positive integer, got ${String(moverMapSize)}.`,
      );
    }
    for (const [name, value] of [
      ["lightDistance", options.lightDistance ?? 200],
      ["depthRange", options.depthRange ?? 400],
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(
          `TN_VIRTUAL_SHADOW_INVALID: ${name} must be positive, got ${String(value)}.`,
        );
      }
    }
    const minCasterTexels = options.minCasterTexels ?? DEFAULT_MIN_CASTER_TEXELS;
    if (!Number.isFinite(minCasterTexels) || minCasterTexels < 0) {
      throw new RangeError(
        `TN_VIRTUAL_SHADOW_INVALID: minCasterTexels must be zero or positive, got ${String(minCasterTexels)}.`,
      );
    }
    // Both halves or neither: one of the two alone cannot place a camera, so a half-specified
    // override is read as no override at all and the span is derived.
    this.#autoDepth = options.lightDistance === undefined || options.depthRange === undefined;
    // A page is a texel here: the clipmap's page snapping is exactly texel snapping.
    // The window now trails its followed centre by up to `refreshStep` extents, so the selection
    // guard gives exactly that much back: a window only reaches `1 - refreshStep` extents past the
    // centre, and `selectionGuard - refreshStep <= 1 - refreshStep` always holds.
    // Both are scalar-or-per-level, finest first, the last entry standing in for every level past
    // it — one level re-rendering on a different cadence is the whole point.
    const perLevel = (
      value: number | readonly number[],
      valid: (v: number) => boolean,
      complaint: string,
    ): number[] => {
      const values = Array.isArray(value) ? [...(value as readonly number[])] : [value as number];
      for (const entry of values) {
        if (!valid(entry)) {
          throw new RangeError(`TN_VIRTUAL_SHADOW_INVALID: ${complaint}, got ${String(entry)}.`);
        }
      }
      // One value for every level, filled in: what the node keeps is one entry per level whatever
      // the game handed it, so a caller reading `options` back sees the level it asked for.
      return values.length === 1
        ? Array.from({ length: clipExtents.length }, () => values[0] as number)
        : values;
    };
    const steps = perLevel(
      options.refreshStep ?? 0.125,
      (v) => Number.isFinite(v) && v >= 0 && v < 1,
      "refreshStep must be in the range [0, 1)",
    );
    const guards = perLevel(
      options.selectionGuard ?? 0.9,
      (v) => Number.isFinite(v) && v > 0 && v <= 1,
      "selectionGuard must be in the range (0, 1]",
    );
    for (let level = 0; level < steps.length; level += 1) {
      if ((steps[level] as number) >= (guards[level] as number)) {
        throw new RangeError(
          `TN_VIRTUAL_SHADOW_INVALID: refreshStep must be in the range [0, ${String(guards[level])}), got ${String(steps[level])}.`,
        );
      }
    }
    // The finest level's delay is the unit the rest are multiples of: a level whose window is `n`
    // times wider redraws `n` times more of the world, so it is the one that merges the most asks
    // into one render. 0.25 s on the fine levels keeps a streamed tree's shadow arriving with the
    // player; 3.33 s on the coarsest is invisible, because a texel there is wider than the tree.
    // One number is the finest level's delay and every level scales it by its own extent; a
    // per-level list is each level's own seconds, taken as it stands.
    const finest = clipExtents[0] as number;
    const validDelay = (v: number): boolean => Number.isFinite(v) && v >= 0;
    const asked = options.invalidationDelay;
    const invalidationDelay = Array.isArray(asked)
      ? perLevel(
          asked as readonly number[],
          validDelay,
          "invalidationDelay must be zero or positive",
        )
      : clipExtents.map(
          (extent) =>
            ((asked as number | undefined) ?? BASE_INVALIDATION_DELAY) * (extent / finest),
        );
    const at = (values: readonly number[], level: number): number =>
      values[Math.min(level, values.length - 1)] as number;
    const guardedExtent = clipExtents.map((_, level) => at(guards, level) - at(steps, level));
    this.clipmap = new DirectionalClipmap({
      clipExtents,
      direction: { x: 0, y: 1, z: 0 },
      pagesPerAxis: mapSize,
      refreshStep: steps,
      selectionGuard: guardedExtent,
    });
    this.tracker = new ShadowInvalidationTracker(this.clipmap);
    const marker = options.marker ?? DEFAULT_MARKER_EVERY;
    this.options = {
      clipExtents: [...clipExtents],
      depthRange: options.depthRange ?? 400,
      invalidationDelay,
      lightDistance: options.lightDistance ?? 200,
      mapSize,
      minCasterTexels,
      moverMapSize,
      markerEvery: marker === false ? 0 : marker === true ? DEFAULT_MARKER_EVERY : marker,
      refreshStep: steps,
      selectionGuard: guardedExtent,
      shadowLodBias: options.shadowLodBias ?? true,
    };
    this.#stats = {
      byInvalidation: 0,
      byMove: 0,
      cached: 0,
      coalesced: 0,
      deferred: 0,
      frame: 0,
      held: 0,
      invalidated: 0,
      levels: clipExtents.length,
      moved: 0,
      moverRenders: 0,
      movers: 0,
      perLevel: this.#perLevel,
      rendered: 0,
      rendersTotal: 0,
      reuseRatio: 1,
    };
  }

  /** The per-frame counters, as of the last `updateBefore`. */
  get stats(): IVirtualShadowStats {
    return this.#stats;
  }

  /** The stock shadow nodes behind each level, for diagnostics. */
  get levelNodes(): readonly Node[] {
    return this.#levels.map((level) => level.node);
  }

  /** The stock shadow nodes behind each level's mover map, for diagnostics. */
  get moverNodes(): readonly Node[] {
    return this.#levels.map((level) => level.moverNode);
  }

  /** The placeholder lights, one per level; exposed for tests and debug views. */
  get levelLights(): readonly Object3D[] {
    return this.#levels.map((level) => level.light);
  }

  #rememberMoverChildren(object: Object3D): void {
    let children = this.#casterChildren.get(object.uuid);
    if (children === undefined) {
      children = new Set<Object3D>();
      this.#casterChildren.set(object.uuid, children);
    }
    object.traverse((child) => {
      if (children.has(child)) return;
      children.add(child);
      const state = this.#moverLayerStates.get(child);
      if (state === undefined) {
        this.#moverLayerStates.set(child, {
          originallyEnabled: child.layers.isEnabled(VIRTUAL_SHADOW_MOVER_LAYER),
          references: 1,
        });
      } else {
        state.references += 1;
      }
      child.layers.enable(VIRTUAL_SHADOW_MOVER_LAYER);
    });
  }

  #restoreMoverChildren(id: string): void {
    const children = this.#casterChildren.get(id);
    if (children === undefined) return;
    for (const child of children) {
      const state = this.#moverLayerStates.get(child);
      if (state === undefined) continue;
      state.references -= 1;
      if (state.references > 0) continue;
      if (state.originallyEnabled) child.layers.enable(VIRTUAL_SHADOW_MOVER_LAYER);
      else child.layers.disable(VIRTUAL_SHADOW_MOVER_LAYER);
      this.#moverLayerStates.delete(child);
    }
    this.#casterChildren.delete(id);
  }

  /**
   * Make an object a mover: it leaves the cached level maps and draws into every level's mover
   * map each frame, so its shadow follows it without a level render. Static geometry never
   * needs this — a level re-renders whenever its window moves anyway.
   */
  trackCaster(object: Object3D): string {
    const previous = this.#casters.get(object.uuid);
    if (previous === object) {
      this.#rememberMoverChildren(object);
      return object.uuid;
    }
    if (previous !== undefined && previous !== object) this.#restoreMoverChildren(object.uuid);
    this.#casters.set(object.uuid, object);
    this.#rememberMoverChildren(object);
    this.invalidateAll();
    return object.uuid;
  }

  untrackCaster(objectOrId: Object3D | string): boolean {
    const id = typeof objectOrId === "string" ? objectOrId : objectOrId.uuid;
    const object = this.#casters.get(id);
    if (object === undefined) return false;
    this.#restoreMoverChildren(id);
    this.tracker.remove(id);
    const removed = this.#casters.delete(id);
    if (removed) this.invalidateAll();
    return removed;
  }

  /** Force every level to re-render on the next frame — a tree fell, a door opened. */
  invalidateAll(): void {
    this.#invalidateAll = true;
    this.#regions.length = 0;
    this.tracker.invalidateAll();
  }

  /**
   * Force only the levels whose current window covers `bounds`, on the next frame. A streamed world
   * that hands its shadow casters over has a moving near set, and a blanket `invalidateAll()` on
   * every refresh redrew all three levels for a change that lands in one corner of one of them. A
   * level whose window does not cover the region draws the same thing either way, so skipping it is
   * the same frame with fewer draws in it.
   *
   * `bounds` is `{ min: {x,y,z}, max: {x,y,z} }`, a plain object so a game can hand one over without
   * importing three. Regions are consumed by the next `updateBefore`; one that arrives before the
   * levels exist is dropped, because their first frame renders all of them anyway.
   */
  invalidateRegion(bounds: IBoundsLike): void {
    if (this.#levels.length === 0) return;
    this.#regions.push({
      max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
      min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
    });
  }

  /**
   * The topmost object above the light: the scene it is lit in, whatever the game nested it under.
   * Walked once per level render, so a `Daylight` group between the sun and the world is not the
   * boundary that hides every tree from the span below.
   */
  #root(): Object3D {
    let root = this.light as Object3D;
    while (root.parent !== null) root = root.parent;
    return root;
  }

  /**
   * One traverse for three automatic fixes: the world bounding sphere of every shadow-relevant mesh
   * goes into the pool, every caster too small for this level's texel grid is hidden until the
   * level's render is over, and the level's caster granularity is chosen from the two bills it could
   * pay. Mirrors the sphere three's own cull reads, so the gate drops exactly the volumes that cull
   * would have kept and the depth below measures the same boxes it will draw.
   *
   * Both halves of every key are on the caster-only layers, so the bill is counted off the meshes
   * themselves rather than configured: the clusters whose square the level's window holds, against
   * the key-wide meshes waiting for it. A cluster's own sphere is its whole grid square, so the
   * window test is on its centre, which is where the records actually are.
   */
  #probe(level: ILevel, centre: IVector3Like, index: number): void {
    const gate = (this.options.minCasterTexels * 2 * level.extent) / this.options.mapSize;
    const clusterLayer = 1 << VIRTUAL_SHADOW_CASTER_LAYER;
    const wideLayer = 1 << VIRTUAL_SHADOW_WIDE_CASTER_LAYER;
    // A square inside the level's window is within a half-diagonal of its centre whichever way the
    // light is turned, so this is the bound that holds for every sun angle.
    const window = level.extent * Math.SQRT2;
    this.#poolCount = 0;
    this.#hidden.length = 0;
    let clusterDraws = 0;
    let wideDraws = 0;
    // A caster still owed its prewarm draw (see `SharedBatch.awaitPrewarmDraw`): its shadow-context
    // node is built by the next shadow render that draws it, so the level that draws it here is
    // what moves the build off the walk. Both layers are therefore rendered while one is owed, since
    // the choice below would leave the other half's casters unbuilt until the level's own window
    // move. The flag is on the mesh rather than a module-level signal because the world chunk does
    // not import this one — the same channel as the `casterInstanceScale` read below.
    let prewarming = false;
    this.#root().traverse((object) => {
      if (object.visible !== true) return;
      if ((object as { isMesh?: boolean }).isMesh !== true) return;
      const mesh = object as Mesh & {
        boundingBox?: Box3 | null;
        boundingSphere?: Sphere | null;
        casterPrewarmOwed?: boolean;
        computeBoundingBox(): void;
        computeBoundingSphere(): void;
      };
      // Read before the gates below: the level is going to render both caster layers either way, and
      // a caster too small for this level's texels is still one the prewarm owes a draw.
      if (mesh.casterPrewarmOwed === true) prewarming = true;
      // The same two spheres three's cull uses: an instanced mesh's own, over its instances, or the
      // geometry's. `boundingSphere` is `null` on a fresh instanced mesh and undefined on a `Mesh`.
      const own = mesh.boundingSphere;
      let sphere: Sphere | null | undefined;
      if (own === undefined) {
        if (mesh.geometry.boundingSphere === null) mesh.geometry.computeBoundingSphere();
        sphere = mesh.geometry.boundingSphere;
      } else if (own === null || own.radius < 0) {
        mesh.computeBoundingSphere();
        sphere = mesh.boundingSphere;
      } else {
        sphere = own;
      }
      if (sphere === null || sphere === undefined) return;
      // The box too, and for the same reason: a sphere has to cover a 128 m tile's diagonal, so its
      // height range is the tile's diagonal rather than the tile's relief, and the window's ground
      // is then read as 180 m of cliff.
      const ownBox = mesh.boundingBox;
      let box: Box3 | null | undefined;
      if (ownBox === undefined) {
        if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox();
        box = mesh.geometry.boundingBox;
      } else if (ownBox === null) {
        mesh.computeBoundingBox();
        box = mesh.boundingBox;
      } else {
        box = ownBox;
      }
      _sphere.copy(sphere).applyMatrix4(mesh.matrixWorld);
      if (box === null || box === undefined) {
        _box.min.set(_sphere.center.x, _sphere.center.y - _sphere.radius, _sphere.center.z);
        _box.max.set(_sphere.center.x, _sphere.center.y + _sphere.radius, _sphere.center.z);
      } else {
        _box.copy(box).applyMatrix4(mesh.matrixWorld);
      }
      const at = this.#poolCount * POOL_STRIDE;
      if (at + POOL_STRIDE > this.#pool.length) {
        const grown = new Float64Array(this.#pool.length * 2);
        grown.set(this.#pool);
        this.#pool = grown;
      }
      const pool = this.#pool;
      pool[at] = _sphere.center.x;
      pool[at + 1] = _sphere.center.y;
      pool[at + 2] = _sphere.center.z;
      pool[at + 3] = _sphere.radius;
      pool[at + 4] = mesh.castShadow ? POOL_CASTERS : 0;
      pool[at + 5] = _box.min.y;
      pool[at + 6] = _box.max.y;
      this.#poolCount += 1;
      // Sub-texel: a caster the level cannot resolve draws no shadow a fragment could tell from
      // ground cover, so it is hidden for this render and put back immediately after it.
      //
      // On the part's own radius, not the cluster's. A world batch is one `InstancedMesh` per grid
      // square, so its sphere is ~24 m of square whatever it holds and every cluster cleared every
      // level's texel budget — the gate dropped nothing at all. `WorldCells` publishes the largest
      // instance scale it actually placed (`casterInstanceScale`), and the part's geometry radius
      // times that is the diameter a shadow map really has to resolve. A mesh without it — anything
      // but a world batch — is gated on its own sphere, exactly as before.
      if (mesh.castShadow && instanceDiameter(mesh, _sphere.radius) < gate) {
        object.visible = false;
        this.#hidden.push(object);
        return;
      }
      // What this level would submit from each half, counted as it goes: a hidden caster submits
      // nothing, so it is not in either bill. A key-wide mesh spans the whole ring, so the level
      // keeps it whether or not the window reaches it — the cull, not the choice, decides that one.
      if ((mesh.layers.mask & clusterLayer) !== 0) {
        if (Math.hypot(_sphere.center.x - centre.x, _sphere.center.z - centre.z) <= window)
          clusterDraws += 1;
      } else if ((mesh.layers.mask & wideLayer) !== 0) {
        wideDraws += 1;
      }
    });
    // One of the two caster layers, never both, and the cheaper bill: clusters when the squares the
    // window covers are fewer than the keys waiting on the wide layer, one mesh per key when they are
    // not. A fraction of the ring's radius was the rule before, and a 192 m window over a 640 m ring
    // is 36% of it — clustered, at one draw per square where one per key would do. Layer 0 stays on,
    // because the terrain and everything else in the world casts from it, and a world with no caster
    // batch at all counts zero of both and takes the wide layer for nothing. A level rendering while
    // a caster is still owed its prewarm draw takes both, which is the only way the half it did not
    // pick gets its node built before the walk.
    const clustered = clusterDraws < wideDraws;
    level.shadow.camera.layers.set(0);
    level.shadow.camera.layers.enable(
      clustered || prewarming ? VIRTUAL_SHADOW_CASTER_LAYER : VIRTUAL_SHADOW_WIDE_CASTER_LAYER,
    );
    if (prewarming) level.shadow.camera.layers.enable(VIRTUAL_SHADOW_WIDE_CASTER_LAYER);
    // The small casters are not in either bill above, and deliberately so: a wide level renders
    // neither this layer nor the meshes on it, and a fine level renders it beside whichever
    // granularity it picked, so counting them would only skew a choice they do not take part in.
    // Finest-first order is the node's own contract, so index 0 is the level whose window is a
    // player's reach; the prewarm owes their draw too, exactly as it owes both caster layers'.
    if (index === 0 || prewarming)
      level.shadow.camera.layers.enable(VIRTUAL_SHADOW_SMALL_CASTER_LAYER);
  }

  /** Put back every caster `#probe` hid, so the next camera sees the world as it was. */
  #restoreHidden(): void {
    for (const object of this.#hidden) object.visible = true;
    this.#hidden.length = 0;
  }

  /**
   * One level's draw gate, wrapped for the length of that level's render: an alpha caster is
   * skipped and a chained mesh is submitted with its coarsest geometry. See
   * `IVirtualShadowOptions.shadowLodBias`, which says what the two defaults are and what they cost.
   *
   * Three hands the geometry to `renderObject` but does not draw it: the cached render object is
   * keyed on the object and re-reads `object.geometry` itself, so the coarse level is set for the
   * length of the one draw and put straight back. Nothing is left changed and the main pass — which
   * never runs inside this window — sees the mesh as authored.
   */
  #biasedShadowRender(inner: ShadowRenderObjectFunction): ShadowRenderObjectFunction {
    return (
      object,
      scene,
      camera,
      geometry,
      material,
      group,
      lightsNode,
      clippingContext,
      passId,
    ) => {
      if (isAlphaCaster(material)) return;
      const chain = lodChainOf(geometry);
      const coarsest = chain?.levels[chain.levels.length - 1];
      const mesh = object as Mesh;
      if (coarsest === undefined || coarsest === mesh.geometry) {
        inner(
          object,
          scene,
          camera,
          geometry,
          material,
          group,
          lightsNode,
          clippingContext,
          passId,
        );
        return;
      }
      const held = mesh.geometry;
      mesh.geometry = coarsest;
      try {
        inner(
          object,
          scene,
          camera,
          coarsest,
          material,
          group,
          lightsNode,
          clippingContext,
          passId,
        );
      } finally {
        mesh.geometry = held;
      }
    };
  }

  /**
   * Render one level's map — cached or mover — with the coarse levels' bias in force.
   *
   * The hook is the renderer's own per-draw seam, installed for the length of the render only.
   * Three's `updateShadow` calls it exactly twice: once to install the shadow pass's draw gate, and
   * once to put back the function it found. Only the first is wrapped, so the main pass's gate is
   * handed straight back, and `setRenderObjectFunction` itself is restored afterwards.
   */
  #renderLevel(frame: NodeFrame, level: ILevel, index: number, mover: boolean): void {
    const node = (mover ? level.moverNode : level.node) as unknown as IRenderingShadowNode;
    const renderer = frame.renderer;
    if (index === 0 || !this.options.shadowLodBias || renderer === null) {
      node.updateShadow(frame);
      return;
    }
    const original = renderer.setRenderObjectFunction;
    let armed = true;
    renderer.setRenderObjectFunction = (renderObjectFunction) => {
      if (armed) {
        armed = false;
        original.call(
          renderer,
          renderObjectFunction === null ? null : this.#biasedShadowRender(renderObjectFunction),
        );
        return;
      }
      original.call(renderer, renderObjectFunction);
    };
    try {
      node.updateShadow(frame);
    } finally {
      renderer.setRenderObjectFunction = original;
    }
  }

  /**
   * The light-space depth one level needs, from what can actually shadow its window: every caster
   * whose own extent reaches the window, turned into light space along the sun. A caster `h` above
   * the ground throws its shadow `h / tan` of a metre away, so that is how far past the window a
   * caster has to be kept, and a caster that cannot reach the window is then outside the frustum
   * and three's cull drops it for free.
   *
   * The u/v box is what bounds the window sideways, so the depth is the only free axis, and every
   * object that overlaps that box has already been found: the pool is the whole candidate set and
   * this pass over it costs no second traverse. The height comes from each box rather than each
   * sphere, because a sphere has to cover a 128 m tile's diagonal and would report 180 m of cliff
   * where the tile has 15 m of it.
   */
  #deriveDepth(level: ILevel, centre: IVector3Like): void {
    const pool = this.#pool;
    const count = this.#poolCount;
    const { basisU, basisV, basisW } = this.clipmap;
    const extent = level.extent;
    // The box's own reach, in each of the three light axes: sideways is bounded, so a point in the
    // window is at most this far along either of them.
    const side = extent * Math.SQRT2;
    // A caster wider than the window is not standing in it, it is a mass the window is cut out of:
    // its own span along the light is the whole world's, and the only part of it this frustum can
    // ever hold is the height of its box.
    const fits = extent * 2 * MAX_MASS_WINDOW_WIDTHS;
    const sin = basisW.y;
    // A sun on or below the horizon: the shadow of a caster an inch tall then reaches an inch
    // divided by a `cos` that is nearly nothing, and the one honest span is the widest there is.
    if (sin < MIN_SUN_COSINE) return;
    const cos = Math.hypot(basisW.x, basisW.z);
    const tan = sin / cos;
    // Everything that writes depth: the casters whose bounding sphere reaches into the window's
    // u/v box. A receiver writes no depth, so a piece of ground that only receives is not in the
    // frustum at all, however tall it is — that is the whole reason this is not a fixed range.
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < count; index += 1) {
      const at = index * POOL_STRIDE;
      if (((pool[at + 4] as number) & POOL_CASTERS) === 0) continue;
      const radius = pool[at + 3] as number;
      const dx = (pool[at] as number) - centre.x;
      const dy = (pool[at + 1] as number) - centre.y;
      const dz = (pool[at + 2] as number) - centre.z;
      const u = Math.abs(dx * basisU.x + dy * basisU.y + dz * basisU.z);
      const v = Math.abs(dx * basisV.x + dy * basisV.y + dz * basisV.z);
      if (u > side + radius || v > side + radius) continue;
      const along = dx * basisW.x + dy * basisW.y + dz * basisW.z;
      const boxLow = pool[at + 5] as number;
      const boxHigh = pool[at + 6] as number;
      if (radius * 2 > fits) {
        // A mass, not a caster in the window: the only part of it this frustum can hold is the
        // height of its box. Its own span along the light would be the whole world's, which is the
        // range this change exists to stop drawing.
        if ((boxLow - centre.y) * sin - side * cos < low)
          low = (boxLow - centre.y) * sin - side * cos;
        if ((boxHigh - centre.y) * sin + side * cos > high)
          high = (boxHigh - centre.y) * sin + side * cos;
        continue;
      }
      // A caster standing in the window, or shadowing into it from up-sun, is worth depth only if
      // its shadow still reaches back to the window's down-sun edge: a caster `h` tall throws that
      // shadow `h / tan` of a metre past its own position along the ground.
      const horizon = (along - dy * sin) / cos;
      if (horizon + (boxHigh - boxLow) / tan < -side) continue;
      if (along - radius < low) low = along - radius;
      if (along + radius > high) high = along + radius;
    }
    if (!Number.isFinite(low)) return;
    const span = high - low;
    if (!(span > 0)) return;
    // Two per cent of slack, and never less than a metre: the pool holds bounding spheres, which
    // round up, and a caster a shadow-map texel taller than the window's own ground must still draw.
    const margin = Math.max(1, span * 0.02);
    level.eye = high + margin;
    level.depthNear = margin;
    level.depthFar = margin + span;
  }

  /** Put a level's camera on its window with the depth it last derived, and hold both maps to it. */
  #place(level: ILevel, centre: IVector3Like): void {
    const { basisW } = this.clipmap;
    level.light.position.set(
      centre.x + basisW.x * level.eye,
      centre.y + basisW.y * level.eye,
      centre.z + basisW.z * level.eye,
    );
    level.light.updateMatrixWorld(true);
    this.#setDepth(level.shadow.camera, level);
    // The mover map is the same window with the tracked casters in it, so it is the same column.
    this.#setDepth(level.moverShadow.camera, level);
  }

  /** Hand a level's own cameras the depth it derived, when it is not the depth they already hold. */
  #setDepth(camera: OrthographicCamera, level: ILevel): void {
    if (camera.near === level.depthNear && camera.far === level.depthFar) return;
    camera.near = level.depthNear;
    camera.far = level.depthFar;
    camera.updateProjectionMatrix();
  }

  #init(): void {
    if (this.#initialised) return;
    this.#initialised = true;
    const source = this.light as DirectionalLight;
    this.options.clipExtents.forEach((extent, index) => {
      const levelShadow = source.shadow.clone();
      syncShadowSettings(source.shadow, levelShadow);
      levelShadow.mapSize.set(this.options.mapSize, this.options.mapSize);
      levelShadow.camera.left = -extent;
      levelShadow.camera.right = extent;
      levelShadow.camera.top = extent;
      levelShadow.camera.bottom = -extent;
      levelShadow.camera.near = 1;
      levelShadow.camera.far = this.options.lightDistance + this.options.depthRange;
      levelShadow.camera.updateProjectionMatrix();
      // The caster-only layer, so a mesh that exists to be a shadow caster draws into this level's
      // map and not into the main pass. It also fixes this camera's layer mask, which three would
      // otherwise take from the main camera.
      levelShadow.camera.layers.enable(VIRTUAL_SHADOW_CASTER_LAYER);
      // Cached: the stock node renders only when asked — and not before this node has placed
      // the level, which happens in `updateBefore`. A render requested here would run on the
      // first frame from an unplaced light, and three's per-frame guard would then keep that
      // blank map as the frame's answer.
      levelShadow.autoUpdate = false;
      levelShadow.needsUpdate = false;
      const moverShadow = levelShadow.clone();
      syncShadowSettings(source.shadow, moverShadow);
      moverShadow.mapSize.set(this.options.moverMapSize, this.options.moverMapSize);
      moverShadow.camera.updateProjectionMatrix();
      moverShadow.autoUpdate = false;
      moverShadow.needsUpdate = false;
      // Only the tracked casters: the stock node keeps a camera's own layer mask when it names
      // any layer but the default.
      moverShadow.camera.layers.set(VIRTUAL_SHADOW_MOVER_LAYER);
      const light = new LevelLight(levelShadow);
      light.name = `VirtualShadowLevel${String(index)}`;
      this.#levels.push({
        depthFar: this.options.lightDistance + this.options.depthRange,
        depthNear: 1,
        dirty: false,
        eye: this.options.lightDistance,
        extent,
        extentUniform: uniform(extent),
        lastRender: Number.NEGATIVE_INFINITY,
        light,
        mapped: uniform(0),
        minX: Number.NaN,
        minY: Number.NaN,
        pending: REASON_NONE,
        offsetU: uniform(0),
        offsetV: uniform(0),
        guardUniform: uniform(
          this.options.selectionGuard[index] ?? this.options.selectionGuard.at(-1) ?? 0,
        ),
        moverShadow,
        // One placeholder light serves both maps: the stock node reads only its placement.
        // quality-allow: the stock shadow node reads only position, target and shadow off its light
        moverNode: shadow(light as unknown as DirectionalLight, moverShadow),
        // quality-allow: the stock shadow node reads only position, target and shadow off its light
        node: shadow(light as unknown as DirectionalLight, levelShadow),
        shadow: levelShadow,
      });
    });
  }

  override setup(builder: NodeBuilder): Node | null | undefined {
    if (builder.renderer.shadowMap.enabled === false) return null;
    this.#init();
    const levels = this.#levels;
    const centerU = this.#centerU;
    const centerV = this.#centerV;
    const moversActive = this.#moversActive;
    const basisU = this.#basisU;
    const basisV = this.#basisV;
    return Fn(() => {
      this.setupShadowPosition(builder);
      const u = positionWorld.dot(vec3(basisU as never)).sub(centerU as never);
      const v = positionWorld.dot(vec3(basisV as never)).sub(centerV as never);
      const coarsest = levels[levels.length - 1];
      if (coarsest === undefined) return vec4(1, 1, 1, 1);
      const moverResult = (level: ILevel) =>
        moversActive.greaterThan(0).select(vec4(level.moverNode as never), vec4(1, 1, 1, 1));
      // Every level is read through its own `mapped` gate. A level whose map this node has not
      // drawn yet contributes nothing rather than being sampled: with one level rendered per frame
      // the coarse levels trail the fine one, and their targets hold nothing to compare against.
      const result = vec4(1, 1, 1, 1).toVar("virtualShadowValue");
      If(coarsest.mapped.greaterThan(0), () => {
        result.assign(min(vec4(coarsest.node as never), moverResult(coarsest)));
      });
      // Coarse to fine, so the finest containing level assigns last and wins.
      for (let index = levels.length - 2; index >= 0; index -= 1) {
        const level = levels[index];
        if (level === undefined) continue;
        // This level's own window, so a level holding an older window still selects the map it
        // actually has. `u`/`v` are measured from the followed centre; `offsetU`/`offsetV` carry the
        // difference back to the rendered window's centre.
        const distance = max(abs(u.add(level.offsetU)), abs(v.add(level.offsetV))).toVar(
          `virtualShadowDistance${String(index)}`,
        );
        If(
          and(
            level.mapped.greaterThan(0),
            distance.lessThanEqual(level.extentUniform.mul(level.guardUniform)),
          ),
          () => {
            result.assign(min(vec4(level.node as never), moverResult(level)));
          },
        );
      }
      // Every level's target is registered here, once the stock nodes above have created it and
      // before the material's bind groups are built, so each depth texture exists at the size and
      // version it keeps for the session. See `#settleTargets`.
      this.#settleTargets(builder.renderer);
      return result;
      // quality-allow: Three's Fn invocation loses the concrete node type.
    })() as unknown as Node;
  }

  /**
   * Register every level's shadow target with the renderer's texture manager while this material is
   * being built, which is before the main pass can name its depth texture in a bind group.
   *
   * three re-versions a render target's depth texture on its *first* registration — the `version++`
   * `Textures.updateRenderTarget` does when it finds the target's recorded size is new — and the
   * main pass builds its bind groups first. So the level's first render re-versions a depth texture
   * whose GPUTexture a bind group already holds, and the re-version branch destroys it: every draw
   * through that bind group then submits a destroyed texture, which is the
   * `GPUValidationError: Destroyed texture [Texture "ShadowDepthTexture"] used in a submit` a
   * map-walk logged hundreds of times a session. Dropping the cached bind groups does not help,
   * because `Bindings` reuses a bind group it already has and never asks the backend to rebuild it.
   *
   * Registering here makes the first registration a no-op instead: the depth texture's GPUTexture is
   * created once, at the settled size, and the bind groups that follow are built against it.
   */
  #settleTargets(renderer: unknown): void {
    const manager = renderer as
      | { _textures?: { updateRenderTarget?: (target: RenderTarget) => void } }
      | undefined;
    const textures = manager?._textures;
    // A renderer that does not expose the manager (a test double, the native host) settles itself.
    if (typeof textures?.updateRenderTarget !== "function") return;
    for (const node of [
      ...this.#levels.map((level) => level.node),
      ...this.#levels.map((level) => level.moverNode),
    ]) {
      const target = (node as { shadowMap?: RenderTarget | null }).shadowMap;
      if (target) textures.updateRenderTarget(target);
    }
  }

  override updateBefore(frame: NodeFrame): undefined {
    // Three calls this once per `render()`, and a level render *is* a `render()`: the draw the
    // budget grants below re-enters this method with a new render id. Without this guard the
    // one-level-per-frame budget resets on that re-entry, so a frame with every level due draws
    // all of them — measured on `?scene=map-walk`, where the levels are re-rendered as a group
    // every time a residency update invalidates them.
    if (this.#updating) return undefined;
    this.#updating = true;
    try {
      this.#updateFrame(frame);
    } finally {
      this.#updating = false;
    }
    return undefined;
  }

  #updateFrame(frame: NodeFrame): undefined {
    if (!this.#initialised) return undefined;
    const camera = frame.camera as Camera | null;
    if (camera === null) return undefined;
    const source = this.light as DirectionalLight;
    syncLevelShadowSettings(source.shadow, this.#levels);
    this.#moversActive.value = this.#casters.size > 0 ? 1 : 0;
    const parent = source.parent;
    for (const level of this.#levels) {
      if (level.light.parent === null && parent !== null) {
        parent.add(level.light.target);
        parent.add(level.light);
      }
    }
    source.updateWorldMatrix(true, false);
    source.target.updateWorldMatrix(true, false);
    // Toward the source: the clipmap's W axis points at the light.
    _direction
      .setFromMatrixPosition(source.matrixWorld)
      .sub(source.target.getWorldPosition(_center));
    if (_direction.lengthSq() === 0) _direction.set(0, 1, 0);
    const directionChanged = this.clipmap.setDirection({
      x: _direction.x,
      y: _direction.y,
      z: _direction.z,
    });
    camera.updateMatrixWorld(true);
    const cameraPosition = _center.setFromMatrixPosition(camera.matrixWorld);
    const windows = this.clipmap.updateCenter({
      x: cameraPosition.x,
      y: cameraPosition.y,
      z: cameraPosition.z,
    });
    this.#centerU.value = this.clipmap.centerLight.u;
    this.#centerV.value = this.clipmap.centerLight.v;
    this.#basisU.value.set(this.clipmap.basisU.x, this.clipmap.basisU.y, this.clipmap.basisU.z);
    this.#basisV.value.set(this.clipmap.basisV.x, this.clipmap.basisV.y, this.clipmap.basisV.z);

    // Movers leave the cached maps and are drawn into the mover maps below. A child attached
    // after `trackCaster` — a loaded mesh under a placeholder group — picks up the layer here.
    const excluded: Array<{ object: Object3D; castShadow: boolean }> = [];
    if (this.#casters.size > 0) {
      for (const object of this.#casters.values()) {
        this.#rememberMoverChildren(object);
        object.traverse((child) => {
          if (child.castShadow) {
            excluded.push({ castShadow: child.castShadow, object: child });
            child.castShadow = false;
          }
        });
      }
    }
    const invalidateAll = this.#invalidateAll;
    const invalidatedKeys = this.tracker.consumeInvalidatedKeys();
    const invalidatedLevels = new Set<number>();
    for (const key of invalidatedKeys) invalidatedLevels.add(Number(key.split(":")[0]));
    // The regions `invalidateRegion` was handed, resolved once onto the two axes every level's
    // window is built on. The per-level test below is then four comparisons, not a projection per
    // level per region per frame.
    this.#projectedRegions ??= [];
    const projected = this.#projectedRegions;
    projected.length = 0;
    for (const region of this.#regions) {
      projected.push({
        u: projectBounds(region, this.clipmap.basisU),
        v: projectBounds(region, this.clipmap.basisV),
      });
    }
    this.#regions.length = 0;
    const canRender = (frame as { renderer?: unknown }).renderer !== undefined;
    // The engine's own frame clock, in seconds. This is what a level's invalidation delay is
    // measured against, so a test drives time instead of frames and a 3.33 s delay means 3.33 s
    // whatever the frame rate is.
    const now = (frame as { time?: number }).time ?? 0;

    let moved = 0;
    let invalidated = 0;
    let rendered = 0;
    let deferred = 0;
    let waiting = 0;
    // Per level, finest first: which window moved, which invalidation asked, and which of the four
    // took the frame's single render. One object per level per frame, so a harness reading the
    // marker can see *which* level a walk keeps re-rendering.
    const perLevel = this.#perLevel;
    perLevel.length = 0;
    // One level render per frame, finest first: a level render is a whole scene draw, and three of
    // them in one frame is the long task a fly-through cannot absorb. A level the budget skipped
    // holds the map it has and is due again on the next frame.
    let budgetSpent = false;
    try {
      const half = this.clipmap.pagesPerAxis / 2;
      // The window each level's map was actually rendered with. A level that does not get this
      // frame's window keeps this one, and `level.minX/minY` stays put, so it is still "moved" next
      // frame and still due.
      const centreOf = (window: IClipWindow): { cu: number; cv: number } => ({
        cu: (window.minX + half) * window.pageWorldSize,
        cv: (window.minY + half) * window.pageWorldSize,
      });
      this.#levels.forEach((level, index) => {
        const window = windows[index];
        if (window === undefined) return;
        const windowMoved =
          directionChanged || window.minX !== level.minX || window.minY !== level.minY;
        const { cu, cv } = centreOf(window);
        // This level's own window against the regions handed to `invalidateRegion`. A window that
        // does not reach a region draws the same shadow either way.
        let regionDirty = false;
        for (const region of projected) {
          if (
            region.u.low <= cu + level.extent &&
            region.u.high >= cu - level.extent &&
            region.v.low <= cv + level.extent &&
            region.v.high >= cv - level.extent
          ) {
            regionDirty = true;
            break;
          }
        }
        const asked =
          invalidateAll || invalidatedLevels.has(index) || regionDirty || source.shadow.needsUpdate;
        if (windowMoved) moved += 1;
        if (asked) {
          invalidated += 1;
          // An ask that lands on a level already dirty merges into the one waiting out that
          // level's delay instead of queueing a render of its own. This is the counter that says
          // how much a streaming world's once-a-second invalidation actually cost.
          if (level.dirty) this.#coalesced += 1;
          level.dirty = true;
        }
        // A window that moved is never delayed. A dirty level waits `invalidationDelay` after its
        // *own* last render, so a burst spanning that delay is one render and a lone ask is one
        // render, and the level keeps the map and window it has in between — already right for
        // every static caster in it, missing only what streamed in since.
        const delay = this.options.invalidationDelay[index] ?? 0;
        const matured = level.dirty && now - level.lastRender >= delay;
        let reason: RenderReason = REASON_NONE;
        if (windowMoved) reason = REASON_MOVE;
        else if (matured) reason = REASON_INVALIDATION;
        else if (level.pending !== REASON_NONE) reason = level.pending;
        else if (level.dirty) waiting += 1;
        const due = canRender && reason !== REASON_NONE;
        // Finest first: the loop walks the levels in that order, so the first due level takes the
        // frame's single render and every other due level is deferred behind it.
        const grant = due && !budgetSpent;
        if (grant) {
          level.minX = window.minX;
          level.minY = window.minY;
          level.mapped.value = 1;
          level.pending = REASON_NONE;
          level.lastRender = now;
          this.#rendersTotal += 1;
          if (reason === REASON_MOVE) {
            this.#byMove += 1;
            // The render was already going to happen for the window, so the invalidation rode
            // along on it: one ask, one render, and it is counted as absorbed.
            if (level.dirty) this.#coalesced += 1;
          } else {
            this.#byInvalidation += 1;
          }
          // A render of any reason answers whatever asked, so a movement render clears the dirty
          // flag too and the coalesced level is not redrawn a frame later for nothing.
          level.dirty = false;
          rendered += 1;
          budgetSpent = true;
        } else if (due) {
          deferred += 1;
          level.pending = reason;
        } else {
          level.pending = REASON_NONE;
        }
        perLevel.push({
          deferred: due && !grant ? 1 : 0,
          extent: level.extent,
          invalidated: asked ? 1 : 0,
          moved: windowMoved ? 1 : 0,
          rendered: grant ? 1 : 0,
        });
        // The level camera sits on the window its map was rendered with, deferred or not. A level
        // that has never rendered takes this frame's: it has no map to hold, and `mapped` keeps
        // every fragment out of it until it does.
        const held =
          level.mapped.value === 1 && !grant
            ? { minX: level.minX, minY: level.minY, pageWorldSize: window.pageWorldSize }
            : window;
        const { cu: hu, cv: hv } = centreOf(held as IClipWindow);
        // The window's centre in light space, snapped to whole texels, back in world space at the
        // camera's own depth along the light — that is what keeps the map stable under motion.
        const centre = this.clipmap.unproject({
          u: hu,
          v: hv,
          w: this.clipmap.centerLight.w,
        });
        level.offsetU.value = this.clipmap.centerLight.u - hu;
        level.offsetV.value = this.clipmap.centerLight.v - hv;
        level.light.target.position.set(centre.x, centre.y, centre.z);
        level.light.target.updateMatrixWorld(true);
        if (grant) {
          // The two automatic fixes, off one traverse of the world this window can see: the depth
          // the level needs to cover what can actually shadow it, and the casters too small for its
          // texels. Both are undone the moment the render is over — the hidden casters by
          // `#restoreHidden`, which the mover maps and the main pass both need back.
          this.#probe(level, centre, index);
          if (this.#autoDepth) this.#deriveDepth(level, centre);
          this.#place(level, centre);
          try {
            // Rendered here, not by flagging `needsUpdate`, so the mover exclusion above brackets it.
            // Every level past the finest draws with `shadowLodBias` in force.
            this.#renderLevel(frame, level, index, false);
          } finally {
            this.#restoreHidden();
          }
        } else {
          // A level that keeps its map is placed with the span that map was drawn with, so the next
          // fragment it is sampled through reads the depth it actually holds.
          this.#place(level, centre);
        }
      });
      source.shadow.needsUpdate = false;
      this.#invalidateAll = false;
    } finally {
      for (const { castShadow, object } of excluded) object.castShadow = castShadow;
    }
    // An untracked node keeps a neutral mover contribution in the shader and does no mover work.
    let moverRenders = 0;
    if (this.#casters.size > 0) {
      this.#levels.forEach((level, index) => {
        // quality-allow: Three exposes updateShadow only on its internal rendering shadow node.
        if (canRender) this.#renderLevel(frame, level, index, true);
        moverRenders += 1;
      });
    }
    this.#frame += 1;
    this.#rendered += rendered;
    this.#served += this.#levels.length - rendered;
    const total = this.#rendered + this.#served;
    this.#stats = {
      byInvalidation: this.#byInvalidation,
      byMove: this.#byMove,
      cached: this.#levels.length - rendered,
      coalesced: this.#coalesced,
      deferred,
      frame: this.#frame,
      held: waiting,
      invalidated,
      levels: this.#levels.length,
      moved,
      moverRenders,
      movers: this.#casters.size,
      perLevel: this.#perLevel,
      rendered,
      rendersTotal: this.#rendersTotal,
      reuseRatio: total === 0 ? 1 : this.#served / total,
    };
    const every = this.options.markerEvery;
    // `?tnShadowStats=1` is the walk's own switch: a 10 s walk is ~600 frames, and a marker every
    // 60 of them is a hundred lines that say which level is re-rendering and why. It prints on top
    // of `markerEvery` rather than instead of it, so a run can turn it on without a rebuild.
    const walk = this.#statsWalkRequested() ? STATS_QUERY_EVERY : 0;
    if (
      (every > 0 && (this.#frame === 1 || this.#frame % every === 0)) ||
      (walk > 0 && this.#frame % walk === 0)
    ) {
      console.info(`${VIRTUAL_SHADOW_MARKER}:${JSON.stringify(this.#stats)}`);
    }
    return undefined;
  }

  /** Whether `?tnShadowStats=1` is on this launch's URL, read once. */
  #statsWalkRequested(): boolean {
    this.#statsRequested ??= /[?&]tnShadowStats=(?!0(?:&|$))(?!false(?:&|$))[^&]/u.test(
      globalThis.location?.search ?? "",
    );
    return this.#statsRequested;
  }

  override dispose(): void {
    this.#regions.length = 0;
    for (const level of this.#levels) {
      level.light.removeFromParent();
      level.light.target.removeFromParent();
      level.node.dispose();
      level.shadow.dispose();
      level.moverNode.dispose();
      level.moverShadow.dispose();
    }
    this.#levels = [];
    for (const id of this.#casters.keys()) this.#restoreMoverChildren(id);
    for (const object of this.#casters.values()) {
      this.tracker.remove(object.uuid);
    }
    this.#casters.clear();
    this.tracker.clear();
    this.#initialised = false;
    super.dispose();
  }
}

const VIRTUAL_SHADOW_STAT_FIELDS = [
  "byInvalidation",
  "byMove",
  "cached",
  "coalesced",
  "deferred",
  "frame",
  "held",
  "invalidated",
  "levels",
  "moved",
  "moverRenders",
  "movers",
  "rendered",
  "rendersTotal",
  "reuseRatio",
] as const;

function isVirtualShadowStats(value: unknown): value is IVirtualShadowStats {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const stats = value as Record<string, unknown>;
  if (
    VIRTUAL_SHADOW_STAT_FIELDS.some(
      (field) => typeof stats[field] !== "number" || !Number.isFinite(stats[field]),
    )
  ) {
    return false;
  }
  const countFields = VIRTUAL_SHADOW_STAT_FIELDS.filter((field) => field !== "reuseRatio");
  if (
    countFields.some((field) => !Number.isInteger(stats[field]) || (stats[field] as number) < 0)
  ) {
    return false;
  }
  const reuseRatio = stats.reuseRatio as number;
  return reuseRatio >= 0 && reuseRatio <= 1;
}

/**
 * Parse a `TN_VIRTUAL_SHADOW` console line back into its complete stats, or `undefined`.
 *
 * @situation inspect virtual shadow cache and mover counters from a renderer log
 * @constraint non-marker lines and markers with incomplete or non-numeric stats return `undefined`
 * @example
 * const stats = readVirtualShadowMarker(line);
 * if (stats !== undefined) console.log(stats.reuseRatio);
 */
export function readVirtualShadowMarker(line: string): IVirtualShadowStats | undefined {
  if (!line.startsWith(`${VIRTUAL_SHADOW_MARKER}:`)) return undefined;
  try {
    const value: unknown = JSON.parse(line.slice(VIRTUAL_SHADOW_MARKER.length + 1));
    return isVirtualShadowStats(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
