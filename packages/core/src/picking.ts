import {
  type BufferGeometry,
  type Camera,
  type Intersection,
  Mesh,
  type Object3D,
  Raycaster,
  Vector2,
  type Vector3,
} from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { Viewport } from "./viewport.js";

export interface IRaycastOptions {
  /** Screen point in canvas pixels. Mutually exclusive with `origin` and `direction`. */
  readonly screen?: Vector2;
  /** World-space ray origin. Requires `direction`. */
  readonly origin?: Vector3;
  /** World-space ray direction. The caller must provide a normalised vector. */
  readonly direction?: Vector3;
  /** Maximum distance. Defaults to unbounded. */
  readonly far?: number;
  /** What to test. Defaults to the whole scene. */
  readonly targets?: Object3D | readonly Object3D[];
  /** Subtrees never hit, whatever `targets` says. */
  readonly exclude?: Object3D | readonly Object3D[];
}

export interface IScenePickerOptions {
  readonly camera: Camera;
  readonly pointer: () => Vector2;
  readonly scene: Object3D;
  readonly viewport: Viewport;
}

interface ICachedTree {
  readonly tree: MeshBVH;
  readonly version: number;
}

type AcceleratedRaycaster = Raycaster & { firstHitOnly?: boolean };

/**
 * Ray queries against scene geometry, accelerated by a bounding volume hierarchy that is
 * built on first use and rebuilt when the geometry's positions change.
 *
 * The acceleration is an implementation detail: nothing about it reaches the caller, no
 * `three` prototype is patched, and a game that never calls `raycast` never builds a tree.
 * Skinned, instanced, batched and morphed meshes fall back to the stock `three` path,
 * because a hierarchy over their rest positions would report hits in the wrong place.
 */
export class ScenePicker {
  #camera: Camera;
  #pointer: () => Vector2;
  #scene: Object3D;
  #viewport: Viewport;
  #raycaster: AcceleratedRaycaster = new Raycaster();
  #ndc = new Vector2();
  #hits: Intersection[] = [];
  #objectHits: Intersection[] = [];
  #trees = new WeakMap<BufferGeometry, ICachedTree>();

  constructor(options: IScenePickerOptions) {
    this.#camera = options.camera;
    this.#pointer = options.pointer;
    this.#scene = options.scene;
    this.#viewport = options.viewport;
    this.#raycaster.firstHitOnly = false;
  }

  /**
   * The closest hit, or `undefined` when the ray hits nothing.
   *
   * Collects at most one hit per target: the traversal runs with `firstHitOnly` so BVH-backed
   * meshes stop at their own closest triangle (PRD-186 phase 1), and anything on the stock
   * fallback path — instanced, skinned, morphed — is reduced to its own nearest before it joins
   * the candidates. The winner is a running minimum, never a full sort: a game asking "what did
   * this round hit" should not pay for every wall behind the answer.
   */
  raycast(options: IRaycastOptions = {}): Intersection | undefined {
    this.#setRay(options);
    this.#raycaster.far = options.far ?? Number.POSITIVE_INFINITY;
    const targets = options.targets ?? this.#scene;
    const roots = Array.isArray(targets) ? targets : [targets as Object3D];
    const excluded =
      options.exclude === undefined
        ? new Set<Object3D>()
        : new Set(Array.isArray(options.exclude) ? options.exclude : [options.exclude]);
    this.#hits.length = 0;
    this.#raycaster.firstHitOnly = true;
    try {
      for (const root of roots) {
        root.updateMatrixWorld();
        this.#collect(root, excluded, true);
      }
    } finally {
      // `raycastAll` relies on the default of collecting every hit; a query that throws must
      // not leave the accelerated flag set for it.
      this.#raycaster.firstHitOnly = false;
    }
    let nearest: Intersection | undefined;
    for (const hit of this.#hits) {
      if (nearest === undefined || hit.distance < nearest.distance) nearest = hit;
    }
    return nearest;
  }

  /** Every hit, sorted from the nearest to the farthest. */
  raycastAll(options: IRaycastOptions = {}): readonly Intersection[] {
    this.#setRay(options);
    this.#raycaster.far = options.far ?? Number.POSITIVE_INFINITY;
    const targets = options.targets ?? this.#scene;
    const roots = Array.isArray(targets) ? targets : [targets as Object3D];
    const excluded =
      options.exclude === undefined
        ? new Set<Object3D>()
        : new Set(Array.isArray(options.exclude) ? options.exclude : [options.exclude]);
    this.#hits.length = 0;
    for (const root of roots) {
      root.updateMatrixWorld();
      this.#collect(root, excluded, false);
    }
    this.#hits.sort((first, second) => first.distance - second.distance);
    return this.#hits.slice();
  }

  /** Drops every cached hierarchy. The next `raycast` rebuilds what it needs. */
  dispose(): void {
    this.#trees = new WeakMap<BufferGeometry, ICachedTree>();
    this.#hits.length = 0;
  }

  #setRay(options: IRaycastOptions): void {
    const hasScreen = options.screen !== undefined;
    const hasOrigin = options.origin !== undefined;
    const hasDirection = options.direction !== undefined;
    if (hasScreen && (hasOrigin || hasDirection))
      throw new Error("ICtx.raycast screen cannot be combined with origin or direction.");
    if (hasDirection && !hasOrigin) throw new Error("ICtx.raycast direction requires origin.");
    if (hasOrigin && !hasDirection) throw new Error("ICtx.raycast origin requires direction.");
    if (hasOrigin) {
      this.#raycaster.camera = this.#camera;
      this.#raycaster.set(options.origin as Vector3, options.direction as Vector3);
      return;
    }

    const screen = options.screen ?? this.#pointer();
    if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y))
      throw new Error("ICtx.raycast screen point must be finite.");
    const { height, width } = this.#viewport.size;
    if (width <= 0 || height <= 0) throw new Error("ICtx.raycast needs a sized viewport.");
    this.#ndc.set((screen.x / width) * 2 - 1, -(screen.y / height) * 2 + 1);
    this.#raycaster.setFromCamera(this.#ndc, this.#camera);
  }

  #collect(object: Object3D, excluded: ReadonlySet<Object3D>, single: boolean): void {
    if (this.#isExcluded(object, excluded)) return;
    if (object.layers.test(this.#raycaster.layers)) {
      if (single) {
        // The stock fallback ignores `firstHitOnly`, so one object can still push several
        // intersections; only that object's own nearest survives. The global answer can only
        // ever be some object's nearest hit, so nothing behind it is ever needed.
        this.#objectHits.length = 0;
        this.#hitTest(object, this.#objectHits);
        let best = this.#objectHits[0];
        for (let index = 1; index < this.#objectHits.length; index += 1) {
          const candidate = this.#objectHits[index];
          if (candidate !== undefined && (best === undefined || candidate.distance < best.distance))
            best = candidate;
        }
        if (best !== undefined) this.#hits.push(best);
      } else {
        this.#hitTest(object, this.#hits);
      }
    }
    for (const child of object.children) this.#collect(child, excluded, single);
  }

  #hitTest(object: Object3D, into: Intersection[]): void {
    const tree = this.#treeFor(object);
    if (tree === undefined) object.raycast(this.#raycaster, into);
    else tree.raycastObject3D(object, this.#raycaster, into);
  }

  #isExcluded(object: Object3D, excluded: ReadonlySet<Object3D>): boolean {
    let current: Object3D | null = object;
    while (current !== null) {
      if (excluded.has(current)) return true;
      current = current.parent;
    }
    return false;
  }

  #treeFor(object: Object3D): MeshBVH | undefined {
    if (!(object instanceof Mesh)) return undefined;
    const deformed = object as Mesh & {
      isBatchedMesh?: boolean;
      isInstancedMesh?: boolean;
      isSkinnedMesh?: boolean;
    };
    if (
      deformed.isSkinnedMesh === true ||
      deformed.isInstancedMesh === true ||
      deformed.isBatchedMesh === true ||
      (object.morphTargetInfluences?.length ?? 0) > 0
    )
      return undefined;
    const geometry = object.geometry;
    const position = geometry.attributes.position;
    if (position === undefined || position.count === 0) return undefined;
    const cached = this.#trees.get(geometry);
    if (cached !== undefined && cached.version === position.version) return cached.tree;
    const tree = new MeshBVH(geometry);
    this.#trees.set(geometry, { tree, version: position.version });
    return tree;
  }
}
