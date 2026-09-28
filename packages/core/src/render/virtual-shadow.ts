import {
  Box3,
  type Camera,
  type DirectionalLight,
  type Mesh,
  Object3D,
  type OrthographicCamera,
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
  ShadowBaseNode,
  type UniformNode,
} from "three/webgpu";
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
  /** Fraction of levels served from cache over the node's lifetime. */
  readonly reuseRatio: number;
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
const MIN_MOVER_MAP_SIZE = 256;
const DEFAULT_CLIP_EXTENTS: readonly number[] = [16, 48, 144];
const DEFAULT_MARKER_EVERY = 300;
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
   * Set when this level was due and the frame's single render went to a finer one. Sticky, so a
   * level that was passed over stays due on the next frame instead of waiting for its window to
   * move again — the reason it was due (an `invalidateAll`, an explicit region) is already cleared.
   */
  pending: boolean;
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
    Omit<IVirtualShadowOptions, "marker" | "refreshStep" | "selectionGuard">
  > & {
    readonly markerEvery: number;
    /** Per level, finest first; the last entry stands in for every level past it. */
    readonly refreshStep: readonly number[];
    /** The per-level `selectionGuard` each level's own window is drawn with. */
    readonly selectionGuard: readonly number[];
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
    ): number[] => {
      const values = Array.isArray(value) ? [...(value as readonly number[])] : [value as number];
      for (const entry of values) {
        if (!valid(entry)) {
          throw new RangeError(
            `TN_VIRTUAL_SHADOW_INVALID: refreshStep must be in the range [0, 1), got ${String(entry)}.`,
          );
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
    );
    const guards = perLevel(
      options.selectionGuard ?? 0.9,
      (v) => Number.isFinite(v) && v > 0 && v <= 1,
    );
    for (let level = 0; level < steps.length; level += 1) {
      if ((steps[level] as number) >= (guards[level] as number)) {
        throw new RangeError(
          `TN_VIRTUAL_SHADOW_INVALID: refreshStep must be in the range [0, ${String(guards[level])}), got ${String(steps[level])}.`,
        );
      }
    }
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
      lightDistance: options.lightDistance ?? 200,
      mapSize,
      minCasterTexels,
      moverMapSize,
      markerEvery: marker === false ? 0 : marker === true ? DEFAULT_MARKER_EVERY : marker,
      refreshStep: steps,
      selectionGuard: guardedExtent,
    };
    this.#stats = {
      cached: 0,
      deferred: 0,
      frame: 0,
      invalidated: 0,
      levels: clipExtents.length,
      moved: 0,
      moverRenders: 0,
      movers: 0,
      perLevel: this.#perLevel,
      rendered: 0,
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
   * One traverse for both automatic fixes: the world bounding sphere of every shadow-relevant mesh
   * goes into the pool, and every caster too small for this level's texel grid is hidden until the
   * level's render is over. Mirrors the sphere three's own cull reads, so the gate drops exactly the
   * volumes that cull would have kept and the depth below measures the same boxes it will draw.
   */
  #probe(level: ILevel): void {
    const gate = (this.options.minCasterTexels * 2 * level.extent) / this.options.mapSize;
    this.#poolCount = 0;
    this.#hidden.length = 0;
    this.#root().traverse((object) => {
      if (object.visible !== true) return;
      if ((object as { isMesh?: boolean }).isMesh !== true) return;
      const mesh = object as Mesh & {
        boundingBox?: Box3 | null;
        boundingSphere?: Sphere | null;
        computeBoundingBox(): void;
        computeBoundingSphere(): void;
      };
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
      }
    });
  }

  /** Put back every caster `#probe` hid, so the next camera sees the world as it was. */
  #restoreHidden(): void {
    for (const object of this.#hidden) object.visible = true;
    this.#hidden.length = 0;
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
        eye: this.options.lightDistance,
        extent,
        extentUniform: uniform(extent),
        light,
        mapped: uniform(0),
        minX: Number.NaN,
        minY: Number.NaN,
        pending: false,
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
      return result;
      // quality-allow: Three's Fn invocation loses the concrete node type.
    })() as unknown as Node;
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

    let moved = 0;
    let invalidated = 0;
    let rendered = 0;
    let deferred = 0;
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
        if (asked) invalidated += 1;
        const due = canRender && (windowMoved || asked || level.pending);
        // Finest first: the loop walks the levels in that order, so the first due level takes the
        // frame's single render and every other due level is deferred behind it.
        const grant = due && !budgetSpent;
        if (grant) {
          level.minX = window.minX;
          level.minY = window.minY;
          level.mapped.value = 1;
          level.pending = false;
          rendered += 1;
          budgetSpent = true;
        } else if (due) {
          deferred += 1;
          level.pending = true;
        } else {
          level.pending = false;
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
          this.#probe(level);
          if (this.#autoDepth) this.#deriveDepth(level, centre);
          this.#place(level, centre);
          try {
            // Rendered here, not by flagging `needsUpdate`, so the mover exclusion above brackets it.
            // quality-allow: Three exposes updateShadow only on its internal rendering shadow node.
            (level.node as unknown as IRenderingShadowNode).updateShadow(frame);
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
      for (const level of this.#levels) {
        // quality-allow: Three exposes updateShadow only on its internal rendering shadow node.
        if (canRender) (level.moverNode as unknown as IRenderingShadowNode).updateShadow(frame);
        moverRenders += 1;
      }
    }
    this.#frame += 1;
    this.#rendered += rendered;
    this.#served += this.#levels.length - rendered;
    const total = this.#rendered + this.#served;
    this.#stats = {
      cached: this.#levels.length - rendered,
      deferred,
      frame: this.#frame,
      invalidated,
      levels: this.#levels.length,
      moved,
      moverRenders,
      movers: this.#casters.size,
      perLevel: this.#perLevel,
      rendered,
      reuseRatio: total === 0 ? 1 : this.#served / total,
    };
    const every = this.options.markerEvery;
    if (every > 0 && (this.#frame === 1 || this.#frame % every === 0)) {
      console.info(`${VIRTUAL_SHADOW_MARKER}:${JSON.stringify(this.#stats)}`);
    }
    return undefined;
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
  "cached",
  "deferred",
  "frame",
  "invalidated",
  "levels",
  "moved",
  "moverRenders",
  "movers",
  "rendered",
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
