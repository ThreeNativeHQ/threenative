import { Object3D } from "three";

/**
 * The per-frame world-matrix walk, with a hidden subtree left where it stands.
 *
 * `three`'s `Object3D.updateMatrixWorld` recurses into every child of every node whatever its
 * `visible` flag, multiplying a world matrix for each. That is the correct default for a library
 * that cannot know what a game is doing, and it is the wrong one for a renderer that is about to
 * skip exactly those subtrees: a full-detail body while its merged stand-in draws, a hidden LOD
 * level, a parked or hangared model each pay the walk and none of them can draw.
 *
 * Native flight in `sandbox/midway-open-pacific` profiled `updateMatrixWorld` plus
 * `multiplyMatrices` at **29 % of all JavaScript ticks**, and the same scene's hand-rolled
 * visible-only pass walked **779 nodes per frame instead of 9,903**, 3.1 ms down to 0.3 ms. That
 * pass was the game's; this is the engine's, so the next game does not write it again.
 *
 * The pass mirrors three exactly for a visible node: `matrixAutoUpdate` -> `updateMatrix()`, then
 * the `matrixWorldNeedsUpdate || force` recompute honouring `matrixWorldAutoUpdate` and a null
 * parent, then force the children. A node with `visible === false` still composes its **own**
 * matrix — that is what makes the next part cheap — and is not recursed into; when it was forced
 * (or carried a dirty flag) it is remembered, so the first frame it is visible again its whole
 * subtree is recomputed with `force = true`.
 *
 * Two things are never dropped by the pruning, because both are read while nothing above them is
 * visible:
 *
 * - a class that overrides `updateMatrixWorld` runs its own. `SkinnedMesh` refreshes
 *   `bindMatrixInverse`, `Camera` its `matrixWorldInverse`; re-implementing only the base walk
 *   left every deck-crew sailor that had moved since load drawing with a stale bind matrix and
 *   vanishing from the frame. Their subtrees are small, so walking them whole costs nothing;
 * - a hidden node that holds a `Bone` is walked, because a visible `SkinnedMesh` draws with its
 *   skeleton's matrices wherever the armature happens to sit. Whether bones sit below a node is
 *   decided once and remembered — a rig is built whole and does not grow.
 *
 * A game that reads a **hidden** object's `matrixWorld` directly must not rely on this pass
 * having reached it: use `getWorldPosition`/`getWorldQuaternion`/`getWorldScale` (which update the
 * chain they need) or call `object.updateWorldMatrix(true, false)` first. The convention's named
 * override is `renderer.matrixWorld: "all"`, which visits every node exactly as three's own walk
 * does; `"visible"` is the default.
 */

/** How much of the scene graph the engine walks for world matrices each frame. */
export type MatrixWorldMode = "visible" | "all";

/** The shipping default: a hidden subtree is not walked. */
export const DEFAULT_MATRIX_WORLD_MODE: MatrixWorldMode = "visible";

/** What the pass did on the last frame, for the frame telemetry a window reports. */
export interface IMatrixWorldReport {
  readonly schemaVersion: 1;
  readonly mode: MatrixWorldMode;
  /**
   * Nodes the engine walked this frame, summed over every application (authored scene and a
   * projection mirror when one is in use). One number both ways, so `"all"` can be read as the
   * cost of the walk the convention just removed.
   */
  readonly visited: number;
}

export interface IMatrixWorldOptions {
  /** `"visible"` (default) skips a hidden subtree; `"all"` reproduces three's own walk. */
  readonly mode?: MatrixWorldMode;
}

/** The base walk, to tell a class that overrides `updateMatrixWorld` (SkinnedMesh, Camera) apart. */
const BASE_UPDATE_MATRIX_WORLD = Object3D.prototype.updateMatrixWorld;

function resolveMode(mode: MatrixWorldMode | undefined): MatrixWorldMode {
  if (mode === undefined) return DEFAULT_MATRIX_WORLD_MODE;
  if (mode !== "visible" && mode !== "all")
    throw new Error(
      `renderer.matrixWorld must be "visible" or "all", received ${JSON.stringify(mode)}.`,
    );
  return mode;
}

/**
 * One game's world-matrix walk, holding the state the pruning needs between frames.
 *
 * The stale set and the bone cache live on the instance rather than in module scope: two games,
 * two playtest scenarios or two roots in one process must not share "this subtree was skipped
 * while hidden", or one game's hidden node would be force-refreshed by the other's frame.
 */
export class MatrixWorldPass {
  readonly #mode: MatrixWorldMode;
  /** Hidden nodes whose own matrix was forced, waiting for the frame they show again. */
  readonly #stale = new WeakSet<Object3D>();
  /** Whether a `Bone` sits anywhere under a node, decided once and remembered. */
  readonly #bones = new WeakMap<Object3D, boolean>();
  #visited = 0;

  constructor(options: IMatrixWorldOptions = {}) {
    this.#mode = resolveMode(options.mode);
  }

  get mode(): MatrixWorldMode {
    return this.#mode;
  }

  /** What the current frame has walked so far, across every {@link apply} call. */
  get report(): IMatrixWorldReport {
    return { schemaVersion: 1, mode: this.#mode, visited: this.#visited };
  }

  /** Starts a frame's count. The pass's state (stale set, bone cache) is untouched. */
  beginFrame(): void {
    this.#visited = 0;
  }

  /**
   * Walks `root`, mirroring three for every node the mode visits.
   *
   * Returns the nodes this call visited, so a caller can report one application's cost without
   * also reporting the frame's total.
   */
  apply(root: Object3D, force = false): number {
    const before = this.#visited;
    this.#step(root, force, this.#mode === "visible");
    return this.#visited - before;
  }

  /** Forgets what was skipped. A whole-scene swap has no hidden ancestors left to refresh. */
  dispose(): void {
    this.#visited = 0;
  }

  #step(root: Object3D, force: boolean, prune: boolean): void {
    this.#visited += 1;
    // A class that extends the walk runs its own, so `SkinnedMesh.bindMatrixInverse` and
    // `Camera.matrixWorldInverse` stay as fresh as the world matrix they derive from.
    if (root.updateMatrixWorld !== BASE_UPDATE_MATRIX_WORLD) {
      const stale = this.#stale.delete(root);
      root.updateMatrixWorld(force || stale);
      return;
    }
    if (root.matrixAutoUpdate) root.updateMatrix();
    let childForce = force;
    if (root.matrixWorldNeedsUpdate || force) {
      if (root.matrixWorldAutoUpdate === true) {
        if (root.parent === null) root.matrixWorld.copy(root.matrix);
        else root.matrixWorld.multiplyMatrices(root.parent.matrixWorld, root.matrix);
      }
      root.matrixWorldNeedsUpdate = false;
      childForce = true;
    }
    // The recompute above cleared the flag, so `childForce` is now true exactly when this node's
    // own world matrix changed — and therefore when its subtree is dirty. Nothing under a hidden
    // node can draw, so defer the recursion; the node itself is already correct for the frame it
    // shows.
    if (prune && root.visible === false && !this.#holdsBones(root)) {
      if (childForce) this.#stale.add(root);
      return;
    }
    if (this.#stale.delete(root)) childForce = true;
    const children = root.children;
    for (let index = 0, length = children.length; index < length; index += 1) {
      this.#step(children[index] as Object3D, childForce, prune);
    }
  }

  #holdsBones(node: Object3D): boolean {
    let known = this.#bones.get(node);
    if (known === undefined) {
      known = false;
      node.traverse((object) => {
        if ((object as Object3D & { isBone?: boolean }).isBone === true) known = true;
      });
      this.#bones.set(node, known);
    }
    return known;
  }
}
