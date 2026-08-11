import {
  type BufferGeometry,
  type Camera,
  type Intersection,
  Mesh,
  type Object3D,
  Raycaster,
  Vector2,
} from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { Viewport } from "./viewport.js";

export interface IRaycastOptions {
  /** Screen point in canvas pixels. Defaults to the current pointer position. */
  readonly screen?: Vector2;
  /** What to test. Defaults to the whole scene. */
  readonly targets?: Object3D | readonly Object3D[];
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
    this.#raycaster.firstHitOnly = true;
  }

  /** The closest hit under the screen point, or `undefined` when the ray hits nothing. */
  raycast(options: IRaycastOptions = {}): Intersection | undefined {
    const screen = options.screen ?? this.#pointer();
    if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y))
      throw new Error("ICtx.raycast screen point must be finite.");
    const { height, width } = this.#viewport.size;
    if (width <= 0 || height <= 0) throw new Error("ICtx.raycast needs a sized viewport.");
    this.#ndc.set((screen.x / width) * 2 - 1, -(screen.y / height) * 2 + 1);
    this.#raycaster.setFromCamera(this.#ndc, this.#camera);

    const targets = options.targets ?? this.#scene;
    const roots = Array.isArray(targets) ? targets : [targets as Object3D];
    this.#hits.length = 0;
    for (const root of roots) {
      root.updateMatrixWorld();
      this.#collect(root);
    }
    if (this.#hits.length === 0) return undefined;
    this.#hits.sort((first, second) => first.distance - second.distance);
    return this.#hits[0];
  }

  /** Drops every cached hierarchy. The next `raycast` rebuilds what it needs. */
  dispose(): void {
    this.#trees = new WeakMap<BufferGeometry, ICachedTree>();
    this.#hits.length = 0;
  }

  #collect(object: Object3D): void {
    if (object.layers.test(this.#raycaster.layers)) {
      const tree = this.#treeFor(object);
      if (tree === undefined) object.raycast(this.#raycaster, this.#hits);
      else tree.raycastObject3D(object, this.#raycaster, this.#hits);
    }
    for (const child of object.children) this.#collect(child);
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
