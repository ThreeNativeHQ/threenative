import { Box3, type Camera, type DirectionalLight, Object3D, Vector3 } from "three";
import { Fn, If, abs, float, max, positionWorld, shadow, uniform, vec3, vec4 } from "three/tsl";
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
  /** Levels re-rendered because a tracked caster moved inside them. */
  readonly invalidated: number;
  /** Levels served from their cached map this frame. */
  readonly cached: number;
  /** Levels rendered this frame, for any reason. */
  readonly rendered: number;
  /** Fraction of levels served from cache over the node's lifetime. */
  readonly reuseRatio: number;
}

export const VIRTUAL_SHADOW_MARKER = "TN_VIRTUAL_SHADOW";
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
  readonly extent: number;
  readonly extentUniform: UniformNode<"float", number>;
  minX: number;
  minY: number;
}

const _direction = new Vector3();
const _center = new Vector3();
const _box = new Box3();

/**
 * One directional shadow for a whole open world: camera-centred clip levels, each snapped to its
 * own texel grid and re-rendered only when its window moves or a tracked caster changes inside it.
 *
 * Plugs into three's own slot, so every material in the scene receives it with no other change:
 * `light.shadow.shadowNode = new VirtualShadowNode(light, { clipExtents: [16, 48, 144] })`.
 *
 * What it owns is mechanism: level windows, texel snapping, per-level caching, invalidation,
 * level selection and the statistics. The light's `shadow` keeps bias, normal bias, intensity,
 * map type and filter, and each level is rendered by the stock {@link ShadowNode} through the
 * renderer's shadow-map type, so the look is the same code path a plain shadow uses.
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
 * @constraint call `trackCaster(object)` for movers whose shadow must refresh in place; untracked movement refreshes only when a window moves
 * @override bias, normalBias, intensity and mapSize stay on `light.shadow`; every option here has a default
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
  readonly tracker: ShadowInvalidationTracker;
  #levels: ILevel[] = [];
  #casters = new Map<string, Object3D>();
  #centerU: UniformNode<"float", number> = uniform(0);
  #centerV: UniformNode<"float", number> = uniform(0);
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
      markerEvery: marker === false ? 0 : marker === true ? DEFAULT_MARKER_EVERY : marker,
      selectionGuard: options.selectionGuard ?? 0.9,
    };
    this.#stats = {
      cached: 0,
      frame: 0,
      invalidated: 0,
      levels: clipExtents.length,
      moved: 0,
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
    return this.#levels.map((level) => level.node as unknown as Node);
  }

  /** The placeholder lights, one per level; exposed for tests and debug views. */
  get levelLights(): readonly Object3D[] {
    return this.#levels.map((level) => level.light);
  }

  /**
   * Watch a caster: when its world bounds change, every level it overlaps re-renders. Static
   * geometry never needs this — a level re-renders whenever its window moves anyway.
   */
  trackCaster(object: Object3D): string {
    this.#casters.set(object.uuid, object);
    return object.uuid;
  }

  untrackCaster(objectOrId: Object3D | string): boolean {
    const id = typeof objectOrId === "string" ? objectOrId : objectOrId.uuid;
    this.tracker.remove(id);
    return this.#casters.delete(id);
  }

  /** Force every level to re-render on the next frame. */
  invalidateAll(): void {
    for (const level of this.#levels) level.shadow.needsUpdate = true;
    this.tracker.invalidateAll();
  }

  #init(): void {
    if (this.#initialised) return;
    this.#initialised = true;
    const source = this.light as DirectionalLight;
    this.options.clipExtents.forEach((extent, index) => {
      const levelShadow = source.shadow.clone();
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
      const light = new LevelLight(levelShadow);
      light.name = `VirtualShadowLevel${String(index)}`;
      this.#levels.push({
        extent,
        extentUniform: uniform(extent),
        light,
        minX: Number.NaN,
        minY: Number.NaN,
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
    const basisU = this.#basisU;
    const basisV = this.#basisV;
    return Fn(() => {
      this.setupShadowPosition(builder);
      const u = positionWorld.dot(vec3(basisU as never)).sub(centerU as never);
      const v = positionWorld.dot(vec3(basisV as never)).sub(centerV as never);
      const distance = max(abs(u), abs(v)).toVar("virtualShadowDistance");
      const coarsest = levels[levels.length - 1];
      if (coarsest === undefined) return vec4(1, 1, 1, 1);
      const result = vec4(coarsest.node as never).toVar("virtualShadowValue");
      // Coarse to fine, so the finest containing level assigns last and wins.
      for (let index = levels.length - 2; index >= 0; index -= 1) {
        const level = levels[index];
        if (level === undefined) continue;
        If(
          distance.lessThanEqual(
            (level.extentUniform as never as ReturnType<typeof float>).mul(float(guard)),
          ),
          () => {
            result.assign(vec4(level.node as never));
          },
        );
      }
      return result;
    })() as unknown as Node;
  }

  override updateBefore(frame: NodeFrame): undefined {
    if (!this.#initialised) return undefined;
    const camera = frame.camera as Camera | null;
    if (camera === null) return undefined;
    const source = this.light as DirectionalLight;
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

    for (const [id, object] of this.#casters) {
      object.updateWorldMatrix(true, true);
      _box.setFromObject(object, true);
      if (_box.isEmpty()) continue;
      this.tracker.update(id, {
        max: { x: _box.max.x, y: _box.max.y, z: _box.max.z },
        min: { x: _box.min.x, y: _box.min.y, z: _box.min.z },
      });
    }
    const invalidatedKeys = this.tracker.consumeInvalidatedKeys();
    const invalidatedLevels = new Set<number>();
    for (const key of invalidatedKeys) invalidatedLevels.add(Number(key.split(":")[0]));

    let moved = 0;
    let invalidated = 0;
    let rendered = 0;
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
      if (invalidatedLevels.has(index)) invalidated += 1;
      if (windowMoved || invalidatedLevels.has(index) || source.shadow.needsUpdate) {
        level.shadow.needsUpdate = true;
        rendered += 1;
      }
    });
    source.shadow.needsUpdate = false;
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
    }
    this.#levels = [];
    this.#casters.clear();
    this.tracker.clear();
    this.#initialised = false;
    super.dispose();
  }
}

/** Parse a `TN_VIRTUAL_SHADOW` console line back into its stats, or `undefined`. */
export function readVirtualShadowMarker(line: string): IVirtualShadowStats | undefined {
  if (!line.startsWith(`${VIRTUAL_SHADOW_MARKER}:`)) return undefined;
  try {
    return JSON.parse(line.slice(VIRTUAL_SHADOW_MARKER.length + 1)) as IVirtualShadowStats;
  } catch {
    return undefined;
  }
}
