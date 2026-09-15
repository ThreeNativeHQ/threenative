import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  type Matrix4,
  type Mesh,
  type Object3D,
  Sphere,
  Vector3,
} from "three";
import { pixelsPerUnit } from "./clustered-mesh.js";

/**
 * Engine-owned detail selection for automatic discrete LOD (`TN_discrete_lod`).
 *
 * The asset pipeline bakes a chain of index-only levels into the `.glb`; this module decides which
 * one a camera may see, from the level's measured geometric error projected into pixels. It is the
 * one selection authority for a discrete chain: nothing here is appearance, and nothing here
 * touches a material — it swaps between geometries the pipeline already wrote.
 *
 * Projection is done from the camera's own matrices, so perspective and orthographic cameras, zoom,
 * the actual drawing-buffer height and a non-uniformly scaled parent all read correctly. The depth
 * used is a conservative nearest view-space depth of the object's bounding sphere, not the distance
 * to its origin, and a camera at or inside the near plane selects the finest level.
 */

/** A camera shape this selection needs: the projection terms `three` exposes structurally. */
interface ILodCameraLike extends Camera {
  readonly isOrthographicCamera?: boolean;
  readonly top?: number;
  readonly bottom?: number;
  readonly zoom?: number;
  readonly near?: number;
}

export interface ILodView {
  readonly camera: Camera;
  /** Drawing-buffer height in actual raster pixels; a CSS height is the wrong number. */
  readonly viewportHeight: number;
  /**
   * Conservative nearest view-space depth of the object's bounding sphere, in world units. A caller
   * that has not measured the bounds passes the distance to the origin, which is never closer and
   * therefore never over-refines.
   */
  readonly depth: number;
  /**
   * True when the camera is at or inside the object's near plane, where a projected error has no
   * meaning. The finest level is selected instead of dividing by ~zero.
   */
  readonly degenerate: boolean;
  /**
   * A view that must not drop below the finest level regardless of budget. Recorded as data so a
   * pass-local caller can prove it honoured the rule.
   */
  readonly finest?: boolean;
}

/**
 * Pixels a one-world-unit error at `depth` covers, for this camera and viewport.
 *
 * Perspective divides the projected scale by the depth; orthographic has no depth term and uses the
 * frustum height instead. A non-positive depth or an unprojectable camera throws rather than
 * returning a plausible-looking wrong scale.
 */
export function lodPixelScale(camera: Camera, viewportHeight: number, depth: number): number {
  const like: ILodCameraLike = camera;
  if (!(viewportHeight > 0))
    throw new Error(`AutoLOD needs a positive viewport height, got ${String(viewportHeight)}.`);
  const zoom = like.zoom ?? 1;
  if (like.isOrthographicCamera === true) {
    const height = (like.top ?? 1) - (like.bottom ?? -1);
    if (!(height > 0))
      throw new Error("AutoLOD needs an orthographic frustum with a positive height.");
    return (viewportHeight * zoom) / height;
  }
  if (!(depth > 0)) return Number.POSITIVE_INFINITY;
  return (pixelsPerUnit(camera, viewportHeight) * zoom) / depth;
}

/** The projected geometric error of `worldError` at `depth`, in pixels. */
export function projectedLodError(
  worldError: number,
  camera: Camera,
  viewportHeight: number,
  depth: number,
): number {
  if (worldError <= 0) return 0;
  return worldError * lodPixelScale(camera, viewportHeight, depth);
}

const nearest = new Vector3();

/**
 * The conservative nearest view-space depth of a world-space bounding sphere.
 *
 * The distance along the view axis to the sphere's centre minus its radius is the closest the
 * surface can be, which is what a screen-space error must divide by: an error near the camera must
 * not be projected as if it sat at the centre. A camera inside the sphere reports `degenerate`.
 */
export function conservativeViewDepth(
  camera: Camera,
  center: Vector3,
  radius: number,
  nearPlane: number,
): { readonly depth: number; readonly degenerate: boolean } {
  nearest.copy(center).applyMatrix4(camera.matrixWorldInverse);
  const depth = -nearest.z - Math.max(0, radius);
  return { depth, degenerate: depth <= nearPlane };
}

/** The world-space bounding sphere of a cached local sphere under a node's world matrix. */
export function worldSphere(
  local: Sphere,
  object: Object3D,
  out: Sphere = local.clone(),
  matrix: Matrix4 = object.matrixWorld,
): Sphere {
  out.center.copy(local.center).applyMatrix4(matrix);
  const scale = matrix.getMaxScaleOnAxis();
  out.radius = local.radius * scale;
  return out;
}

/**
 * The coarsest level whose projected error fits the budget in every supplied view, then stabilized
 * against the current level.
 *
 * Refines immediately: a selected level over budget is replaced by the finest one that fits. Coarsens
 * only when the candidate is comfortably inside `(1 - hysteresis) * budget`, which stops a camera
 * breathing across a boundary from flipping levels. `levels[0]` is LOD0 and must carry error 0.
 */
export function selectLodLevel(
  absoluteErrors: readonly number[],
  current: number,
  budgetPixels: number,
  hysteresis: number,
  views: readonly ILodView[],
): number {
  if (absoluteErrors.length === 0) return 0;
  const last = absoluteErrors.length - 1;
  if (!(budgetPixels > 0) || views.length === 0) return 0;
  const clampedCurrent = Math.min(Math.max(Math.trunc(current), 0), last);

  let target = 0;
  outer: for (let index = last; index >= 1; index -= 1) {
    const error = absoluteErrors[index] as number;
    for (const view of views) {
      if (view.degenerate || view.finest === true) continue outer;
      if (projectedLodError(error, view.camera, view.viewportHeight, view.depth) > budgetPixels) {
        continue outer;
      }
    }
    target = index;
    break;
  }

  if (target <= clampedCurrent) return target;

  // Coarsening: reject it unless the candidate is under the hysteresis-adjusted budget in every view.
  const threshold = (1 - hysteresis) * budgetPixels;
  for (const view of views) {
    if (view.degenerate || view.finest === true) return clampedCurrent;
    const error = absoluteErrors[target] as number;
    if (projectedLodError(error, view.camera, view.viewportHeight, view.depth) >= threshold)
      return clampedCurrent;
  }
  return target;
}

/** The glTF extension the asset pipeline writes the discrete chain into. */
export const TN_DISCRETE_LOD = "TN_discrete_lod";

/** Bumped with the written layout; a reader refuses a version it does not understand. */
export const DISCRETE_LOD_SCHEMA_VERSION = 1;

/** Default screen-space error budget, in pixels, when no resolved policy reaches the loader. */
export const DISCRETE_LOD_DEFAULT_ERROR_PIXELS = 1;
/** Default coarsen hysteresis when no resolved policy reaches the loader. */
export const DISCRETE_LOD_DEFAULT_HYSTERESIS = 0.15;

interface IDiscreteLodDef {
  readonly absoluteErrors?: unknown;
  readonly counts?: unknown;
  readonly errors?: unknown;
  readonly indices?: unknown;
  readonly lod0Triangles?: unknown;
  readonly schemaVersion?: unknown;
}

interface IParserLike {
  readonly associations: Map<object, { meshes?: number; primitives?: number }>;
  getDependency(type: string, index: number): Promise<{ array: ArrayLike<number> }>;
  readonly json: {
    meshes?: { primitives?: { extensions?: Record<string, unknown> }[] }[];
  };
}

interface IPendingLevels {
  readonly absoluteErrors: number[];
  readonly indices: Uint32Array[];
  readonly lod0Triangles: number;
}

function numberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "number"))
    throw new Error(`${label} must be an array of numbers.`);
  return value as number[];
}

/**
 * Reads and validates one primitive's chain. Fails closed: an unreadable payload is a defect in the
 * file, and the caller keeps LOD0 and reports it rather than drawing a mangled mesh.
 */
async function readPendingLevels(
  parser: IParserLike,
  def: IDiscreteLodDef,
): Promise<IPendingLevels> {
  if (def.schemaVersion !== DISCRETE_LOD_SCHEMA_VERSION)
    throw new Error(
      `schema version ${String(def.schemaVersion)} is not ${String(DISCRETE_LOD_SCHEMA_VERSION)}.`,
    );
  const indices = numberArray(def.indices, "indices");
  const counts = numberArray(def.counts, "counts");
  const errors = numberArray(def.errors, "errors");
  const absoluteErrors = numberArray(def.absoluteErrors, "absoluteErrors");
  if (
    indices.length !== counts.length ||
    counts.length !== errors.length ||
    counts.length !== absoluteErrors.length
  )
    throw new Error("the level arrays are not parallel.");
  if (typeof def.lod0Triangles !== "number" || !(def.lod0Triangles > 0))
    throw new Error("lod0Triangles must be a positive number.");
  const resolved: Uint32Array[] = [];
  for (const index of indices) {
    const accessor = await parser.getDependency("accessor", index);
    const array = accessor.array;
    resolved.push(array instanceof Uint32Array ? array : Uint32Array.from(array));
  }
  let previous = def.lod0Triangles;
  let previousError = -1;
  for (let level = 0; level < resolved.length; level += 1) {
    const triangles = Math.floor((resolved[level] as Uint32Array).length / 3);
    const error = errors[level] as number;
    if (triangles <= 0 || triangles >= previous)
      throw new Error(`level ${String(level)} is not a reduction.`);
    if (!Number.isFinite(error) || error < previousError)
      throw new Error(`level ${String(level)} has non-monotonic error.`);
    previous = triangles;
    previousError = error;
  }
  return { absoluteErrors, indices: resolved, lod0Triangles: def.lod0Triangles };
}

/**
 * One baked chain: LOD0 is the mesh's own geometry, then one derived geometry per level sharing the
 * same vertex attributes and differing only in index.
 *
 * A chain belongs to the geometry, not to the mesh, because `Object3D.clone()` — which is how a game
 * reuses an imported model, and what `SkeletonUtils.clone` does for a rig — copies the mesh but
 * *shares* its geometry. Keying selection to mesh identity would silently drop every clone to LOD0
 * forever; recovering the chain from the geometry the clone carries is what makes a clone behave
 * like the source.
 */
interface ILodChain {
  readonly levels: BufferGeometry[];
  readonly errors: readonly number[];
  readonly base: BufferGeometry;
  /** Local-space bounds of the base, shared by every mesh over the chain; the mesh matrix is not. */
  readonly sphere: Sphere;
}

/**
 * One mesh's selection state. Every clone shares the source's chain, so this — and only this — holds
 * the level a particular copy currently shows: two copies at different distances must not fight.
 */
class ModelLod {
  readonly #mesh: Mesh;
  readonly #chain: ILodChain;
  readonly #policy: IAppliedLod;
  #current = 0;

  constructor(mesh: Mesh, chain: ILodChain, policy: IAppliedLod) {
    this.#mesh = mesh;
    this.#chain = chain;
    this.#policy = policy;
  }

  get index(): number {
    return this.#current;
  }

  /** The full-detail geometry the chain was built against. */
  get base(): BufferGeometry {
    return this.#chain.base;
  }

  get triangles(): number {
    const geometry = this.#chain.levels[this.#current] as BufferGeometry;
    const drawn = geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
    return Math.floor(drawn / 3);
  }

  update(camera: Camera, viewportHeight: number): void {
    const world = worldSphere(this.#chain.sphere, this.#mesh, undefined, this.#mesh.matrixWorld);
    const { depth, degenerate } = conservativeViewDepth(
      camera,
      world.center,
      world.radius,
      (camera as ILodCameraLike).near ?? 0,
    );
    const view: ILodView = { camera, degenerate, depth, viewportHeight };
    const index = selectLodLevel(
      this.#chain.errors,
      this.#current,
      this.#policy.maxPixelError,
      this.#policy.hysteresis,
      [view],
    );
    if (index === this.#current) return;
    this.#current = index;
    this.#mesh.geometry = this.#chain.levels[index] as BufferGeometry;
  }
}

/** Resolved runtime policy the loader stamps onto a controller, from the manifest. */
export interface IModelLodPolicy {
  readonly hysteresis: number;
  readonly maxPixelError: number;
}

interface IAppliedLod {
  readonly hysteresis: number;
  readonly maxPixelError: number;
}

/** A chain and its policy, registered against every level geometry so a clone can find it. */
interface IRegisteredChain {
  readonly chain: ILodChain;
  readonly policy: IAppliedLod;
}

/**
 * Every chain currently registered, keyed weakly by each of its level geometries.
 *
 * Keyed by geometry, never by mesh, so a `clone()` — a new mesh over the shared geometry — resolves
 * to the source's chain instead of vanishing. Weak on the key, so a chain whose last live geometry
 * is dropped leaves with it: the value holds its own level geometries, and an ephemeron keeps that
 * self-reference from pinning them.
 */
const chains = new WeakMap<BufferGeometry, IRegisteredChain>();

/** Per-mesh selection state, keyed weakly by the mesh so a disposed or dropped clone drops out. */
const controllers = new WeakMap<Mesh, ModelLod>();

/** True when `object` is a mesh whose geometry carries a registered chain (a clone, or the source). */
function isChained(object: object): boolean {
  const mesh = object as Partial<Mesh>;
  const geometry = mesh.geometry;
  return mesh.isMesh === true && geometry !== undefined && chains.has(geometry);
}

/**
 * The mesh's selection state, or `undefined` when its geometry carries no chain.
 *
 * A clone the loader never saw is adopted here, on its first frame, from the geometry it shares with
 * the source; every later frame finds the entry already made. The entry lives in a `WeakMap`, so a
 * dropped clone is not retained, and adopts at most once, so a clone cannot double-register.
 */
function controllerFor(mesh: Mesh): ModelLod | undefined {
  const existing = controllers.get(mesh);
  if (existing !== undefined) return existing;
  const registered = chains.get(mesh.geometry);
  if (registered === undefined) return undefined;
  const controller = new ModelLod(mesh, registered.chain, registered.policy);
  controllers.set(mesh, controller);
  return controller;
}

/**
 * `GLTFLoader` plugin that reads `TN_discrete_lod` and, once the base geometry is final, builds the
 * derived index-only geometries and registers one controller per primitive.
 *
 * Reading and building are separate on purpose: `widenQuantizedPositions` runs after the loader
 * returns and replaces the base position attribute, so derived geometries must be built *after* it
 * to share the widened attributes rather than pin the quantized ones.
 */
export class DiscreteLodPlugin {
  readonly name = TN_DISCRETE_LOD;
  #parser: IParserLike | undefined;
  readonly #pending = new Map<Mesh, IPendingLevels>();

  setParser(parser: IParserLike): void {
    this.#parser = parser;
  }

  async afterRoot(_result: { scene?: Object3D }): Promise<void> {
    const parser = this.#parser;
    if (parser === undefined) return;
    for (const [object, association] of parser.associations) {
      const mesh = object as Mesh;
      if (mesh.isMesh !== true) continue;
      const { meshes, primitives } = association;
      if (meshes === undefined || primitives === undefined) continue;
      const def = parser.json.meshes?.[meshes]?.primitives?.[primitives]?.extensions?.[
        TN_DISCRETE_LOD
      ] as IDiscreteLodDef | undefined;
      if (def === undefined) continue;
      try {
        this.#pending.set(mesh, await readPendingLevels(parser, def));
      } catch (error) {
        // LOD0 is intact and is what a game must still get; the file is the defect, not the game.
        console.error(
          `TN_DISCRETE_LOD_INVALID: '${mesh.name || "unnamed"}' keeps full detail: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** Builds the derived geometries against the mesh's final (widened) attributes and registers. */
  attach(_root: Object3D, policy: IModelLodPolicy | undefined): number {
    const applied: IAppliedLod = {
      hysteresis: policy?.hysteresis ?? DISCRETE_LOD_DEFAULT_HYSTERESIS,
      maxPixelError: policy?.maxPixelError ?? DISCRETE_LOD_DEFAULT_ERROR_PIXELS,
    };
    let appliedCount = 0;
    for (const [mesh, pending] of this.#pending) {
      const base = mesh.geometry;
      const baseTriangles = base.index?.count ?? base.getAttribute("position")?.count ?? 0;
      if (Math.floor(baseTriangles / 3) !== pending.lod0Triangles) {
        // The file's LOD0 no longer matches the payload that was baked against it; keep full detail.
        console.error(
          `TN_DISCRETE_LOD_INVALID: '${mesh.name || "unnamed"}' keeps full detail: LOD0 triangles do not match the baked chain.`,
        );
        continue;
      }
      const levels: BufferGeometry[] = [base];
      for (const indices of pending.indices) {
        const geometry = new BufferGeometry();
        for (const [name, attribute] of Object.entries(base.attributes)) {
          geometry.setAttribute(name, attribute);
        }
        geometry.setIndex(new BufferAttribute(indices, 1));
        // Same vertex positions, so the same bounds; copying keeps bounds queries off the frame path.
        if (base.boundingSphere !== null && base.boundingSphere !== undefined)
          geometry.boundingSphere = base.boundingSphere.clone();
        if (base.boundingBox !== null && base.boundingBox !== undefined)
          geometry.boundingBox = base.boundingBox.clone();
        levels.push(geometry);
      }
      base.computeBoundingSphere();
      const sphere = new Sphere();
      if (base.boundingSphere !== null && base.boundingSphere !== undefined)
        sphere.copy(base.boundingSphere);
      const registered: IRegisteredChain = {
        chain: { base, errors: [0, ...pending.absoluteErrors], levels, sphere },
        policy: applied,
      };
      // Every level, not just the base: a clone made after a selection already swapped the source to
      // a coarser level carries that derived geometry, and must still resolve to this chain.
      for (const geometry of levels) chains.set(geometry, registered);
      controllers.set(mesh, new ModelLod(mesh, registered.chain, applied));
      appliedCount += 1;
    }
    return appliedCount;
  }
}

/** The LOD0 geometry of a mesh under a discrete chain, or the mesh's own geometry otherwise. */
export function baseGeometryOf(mesh: Mesh): BufferGeometry {
  const controller = controllers.get(mesh);
  if (controller !== undefined) return controller.base;
  return chains.get(mesh.geometry)?.chain.base ?? mesh.geometry;
}

// --- Per-frame update, mirroring `updateClusteredMeshes` ----------------------------------------

/** The event surface this module subscribes to. Structural, so traverse-only stand-ins keep working. */
interface IGraphNode {
  addEventListener(type: string, listener: (event: never) => void): void;
  removeEventListener(type: string, listener: (event: never) => void): void;
  traverse(callback: (object: object) => void): void;
}

interface IChildGraphEvent {
  readonly child?: unknown;
}

interface ITrackedRoot {
  readonly items: Set<Mesh>;
  readonly hooked: WeakSet<object>;
  readonly onAdded: (event: IChildGraphEvent) => void;
  readonly onRemoved: (event: IChildGraphEvent) => void;
}

const trackedRoots = new WeakMap<object, ITrackedRoot>();

function isGraphNode(root: object): root is IGraphNode {
  const candidate = root as Partial<IGraphNode>;
  return (
    typeof candidate.traverse === "function" &&
    typeof candidate.addEventListener === "function" &&
    typeof candidate.removeEventListener === "function"
  );
}

function hookSubtree(tracking: ITrackedRoot, subtree: object): void {
  (subtree as IGraphNode).traverse((node) => {
    if (controllers.has(node as Mesh) || isChained(node)) tracking.items.add(node as Mesh);
    if (tracking.hooked.has(node)) return;
    tracking.hooked.add(node);
    const link = node as Partial<IGraphNode>;
    if (typeof link.addEventListener !== "function") return;
    link.addEventListener("childadded", tracking.onAdded);
    (link as IGraphNode).addEventListener("childremoved", tracking.onRemoved);
  });
}

function unhookSubtree(tracking: ITrackedRoot, subtree: object): void {
  (subtree as IGraphNode).traverse((node) => {
    tracking.items.delete(node as Mesh);
    if (!tracking.hooked.has(node)) return;
    tracking.hooked.delete(node);
    const link = node as Partial<IGraphNode>;
    if (typeof link.removeEventListener !== "function") return;
    link.removeEventListener("childadded", tracking.onAdded);
    (link as IGraphNode).removeEventListener("childremoved", tracking.onRemoved);
  });
}

function trackRoot(root: IGraphNode): ITrackedRoot {
  const existing = trackedRoots.get(root);
  if (existing !== undefined) return existing;
  const tracking: ITrackedRoot = {
    hooked: new WeakSet(),
    items: new Set(),
    onAdded: (event) => {
      const child: unknown = event.child;
      if (typeof child === "object" && child !== null && isGraphNode(child))
        hookSubtree(tracking, child);
    },
    onRemoved: (event) => {
      const child: unknown = event.child;
      if (
        typeof child === "object" &&
        child !== null &&
        typeof (child as Partial<IGraphNode>).traverse === "function"
      )
        unhookSubtree(tracking, child);
    },
  };
  trackedRoots.set(root, tracking);
  hookSubtree(tracking, root);
  return tracking;
}

/**
 * Takes every discrete-LOD mesh under `root` through this frame's selection.
 *
 * The engine calls this itself, once a frame, after matrices are synced and before the render.
 * Multi-view callers that need the finest level across passes use {@link selectLodLevel} directly;
 * this entry point selects for the one camera it is handed — which is the main view, and is at
 * least as fine as a shadow pass of lower resolution needs.
 *
 * @returns triangles the managed meshes will submit this frame.
 */
export function updateModelLods(
  root: { traverse(callback: (object: object) => void): void },
  camera: Camera,
  viewportHeight: number,
): number {
  camera.updateMatrixWorld();
  if (!isGraphNode(root)) {
    let triangles = 0;
    root.traverse((object) => {
      const entry = controllerFor(object as Mesh);
      if (entry === undefined) return;
      entry.update(camera, viewportHeight);
      triangles += entry.triangles;
    });
    return triangles;
  }
  let triangles = 0;
  for (const mesh of trackRoot(root).items) {
    const entry = controllerFor(mesh);
    if (entry === undefined) {
      trackRoot(root).items.delete(mesh);
      continue;
    }
    entry.update(camera, viewportHeight);
    triangles += entry.triangles;
  }
  return triangles;
}
