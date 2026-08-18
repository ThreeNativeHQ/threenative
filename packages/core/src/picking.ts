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
  #trees = new WeakMap<BufferGeometry, ICachedTree>();

  constructor(options: IScenePickerOptions) {
    this.#camera = options.camera;
    this.#pointer = options.pointer;
    this.#scene = options.scene;
    this.#viewport = options.viewport;
    this.#raycaster.firstHitOnly = false;
  }

  /** The closest hit, or `undefined` when the ray hits nothing. */
  raycast(options: IRaycastOptions = {}): Intersection | undefined {
    return this.raycastAll(options)[0];
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
      this.#collect(root, excluded);
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

  #collect(object: Object3D, excluded: ReadonlySet<Object3D>): void {
    if (this.#isExcluded(object, excluded)) return;
    if (object.layers.test(this.#raycaster.layers)) {
      const tree = this.#treeFor(object);
      if (tree === undefined) object.raycast(this.#raycaster, this.#hits);
      else tree.raycastObject3D(object, this.#raycaster, this.#hits);
    }
    for (const child of object.children) this.#collect(child, excluded);
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
