import { type Camera, type DirectionalLight, Object3D, Vector3 } from "three";
import {
  Fn,
  If,
  abs,
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
import { DirectionalClipmap, ShadowInvalidationTracker } from "./virtual-shadow-pages.js";

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
   */
  readonly selectionGuard?: number;
  /** How far behind the window centre each level camera sits, in world units. Default 200. */
  readonly lightDistance?: number;
  /** Depth range each level camera covers past its centre, in world units. Default 400. */
  readonly depthRange?: number;
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
  /** Fraction of levels served from cache over the node's lifetime. */
  readonly reuseRatio: number;
}

export const VIRTUAL_SHADOW_MARKER = "TN_VIRTUAL_SHADOW";
/**
 * The object layer tracked casters are enabled on, so each level's mover camera sees only them.
 * Keep it free of other uses; the main camera never needs it (tracked objects keep layer 0).
 */
export const VIRTUAL_SHADOW_MOVER_LAYER = 29;
const MIN_MOVER_MAP_SIZE = 256;
const DEFAULT_CLIP_EXTENTS: readonly number[] = [16, 48, 144];
const DEFAULT_MARKER_EVERY = 300;

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
  minX: number;
  minY: number;
}

type ShadowWithFilter = DirectionalLight["shadow"] & { filterNode?: unknown };

const _direction = new Vector3();
const _center = new Vector3();

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
 * so the look is the same code path a plain shadow uses.
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

  readonly options: Required<Omit<IVirtualShadowOptions, "marker">> & {
    readonly markerEvery: number;
  };
  readonly clipmap: DirectionalClipmap;
  /**
   * Compatibility handle for explicit page invalidation. Automatic caster motion uses mover maps;
   * callers that already update this tracker still invalidate the affected cached levels.
   */
  readonly tracker: ShadowInvalidationTracker;
  #levels: ILevel[] = [];
  #invalidateAll = false;
  #casters = new Map<string, Object3D>();
  #casterChildren = new Map<string, Set<Object3D>>();
  #moverLayerStates = new Map<Object3D, { originallyEnabled: boolean; references: number }>();
  #centerU: UniformNode<"float", number> = uniform(0);
  #centerV: UniformNode<"float", number> = uniform(0);
  #moversActive: UniformNode<"float", number> = uniform(0);
  #basisU: UniformNode<"vec3", Vector3> = uniform(new Vector3(1, 0, 0));
  #basisV: UniformNode<"vec3", Vector3> = uniform(new Vector3(0, 0, 1));
  #frame = 0;
  #rendered = 0;
  #served = 0;
  #stats: IVirtualShadowStats;
  #initialised = false;

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
    // A page is a texel here: the clipmap's page snapping is exactly texel snapping.
    this.clipmap = new DirectionalClipmap({
      clipExtents,
      direction: { x: 0, y: 1, z: 0 },
      pagesPerAxis: mapSize,
      selectionGuard: options.selectionGuard ?? 0.9,
    });
    this.tracker = new ShadowInvalidationTracker(this.clipmap);
    const marker = options.marker ?? DEFAULT_MARKER_EVERY;
    this.options = {
      clipExtents: [...clipExtents],
      depthRange: options.depthRange ?? 400,
      lightDistance: options.lightDistance ?? 200,
      mapSize,
      moverMapSize,
      markerEvery: marker === false ? 0 : marker === true ? DEFAULT_MARKER_EVERY : marker,
      selectionGuard: options.selectionGuard ?? 0.9,
    };
    this.#stats = {
      cached: 0,
      frame: 0,
      invalidated: 0,
      levels: clipExtents.length,
      moved: 0,
      moverRenders: 0,
      movers: 0,
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
    this.tracker.invalidateAll();
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
        extent,
        extentUniform: uniform(extent),
        light,
        minX: Number.NaN,
        minY: Number.NaN,
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
    const guard = this.options.selectionGuard;
    const centerU = this.#centerU;
    const centerV = this.#centerV;
    const moversActive = this.#moversActive;
    const basisU = this.#basisU;
    const basisV = this.#basisV;
    return Fn(() => {
      this.setupShadowPosition(builder);
      const u = positionWorld.dot(vec3(basisU as never)).sub(centerU as never);
      const v = positionWorld.dot(vec3(basisV as never)).sub(centerV as never);
      const distance = max(abs(u), abs(v)).toVar("virtualShadowDistance");
      const coarsest = levels[levels.length - 1];
      if (coarsest === undefined) return vec4(1, 1, 1, 1);
      const moverResult = (level: ILevel) =>
        moversActive.greaterThan(0).select(vec4(level.moverNode as never), vec4(1, 1, 1, 1));
      const result = min(vec4(coarsest.node as never), moverResult(coarsest)).toVar(
        "virtualShadowValue",
      );
      // Coarse to fine, so the finest containing level assigns last and wins.
      for (let index = levels.length - 2; index >= 0; index -= 1) {
        const level = levels[index];
        if (level === undefined) continue;
        If(
          distance.lessThanEqual(
            (level.extentUniform as never as ReturnType<typeof float>).mul(float(guard)),
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
    const canRender = (frame as { renderer?: unknown }).renderer !== undefined;

    let moved = 0;
    let invalidated = 0;
    let rendered = 0;
    try {
      this.#levels.forEach((level, index) => {
        const window = windows[index];
        if (window === undefined) return;
        const windowMoved =
          directionChanged || window.minX !== level.minX || window.minY !== level.minY;
        level.minX = window.minX;
        level.minY = window.minY;
        // The window's centre in light space, snapped to whole texels, back in world space at the
        // camera's own depth along the light — that is what keeps the map stable under motion.
        const half = this.clipmap.pagesPerAxis / 2;
        const centre = this.clipmap.unproject({
          u: (window.minX + half) * window.pageWorldSize,
          v: (window.minY + half) * window.pageWorldSize,
          w: this.clipmap.centerLight.w,
        });
        level.light.target.position.set(centre.x, centre.y, centre.z);
        level.light.position.set(
          centre.x + this.clipmap.basisW.x * this.options.lightDistance,
          centre.y + this.clipmap.basisW.y * this.options.lightDistance,
          centre.z + this.clipmap.basisW.z * this.options.lightDistance,
        );
        level.light.updateMatrixWorld(true);
        level.light.target.updateMatrixWorld(true);
        if (windowMoved) moved += 1;
        if (invalidateAll || invalidatedLevels.has(index)) invalidated += 1;
        if (
          windowMoved ||
          invalidateAll ||
          invalidatedLevels.has(index) ||
          source.shadow.needsUpdate
        ) {
          // Rendered here, not by flagging `needsUpdate`, so the mover exclusion above brackets it.
          // quality-allow: Three exposes updateShadow only on its internal rendering shadow node.
          if (canRender) (level.node as unknown as IRenderingShadowNode).updateShadow(frame);
          rendered += 1;
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
      frame: this.#frame,
      invalidated,
      levels: this.#levels.length,
      moved,
      moverRenders,
      movers: this.#casters.size,
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
