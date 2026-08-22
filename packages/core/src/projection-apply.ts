import {
  type BufferGeometry,
  type Color,
  InstancedMesh,
  LOD,
  type Light,
  Line,
  type Material,
  Matrix4,
  Mesh,
  type Object3D,
  Points,
  Scene,
  SkinnedMesh,
  Sprite,
  type SpriteMaterial,
} from "three";

import { isLight } from "./projection-plan.js";
import type { IProjectionProjectPlan } from "./projection-plan.js";
import type { ProjectionExactReason } from "./renderProjection.js";

/**
 * The apply-and-restore seam of the render projection (P2-3).
 *
 * Everything here mutates: batches are created and disposed, instance slots are handed out and
 * recycled, stand-ins are built and dropped, lights are mirrored, and every source that left the
 * authored scene is retired. The decision of what to do arrived as an immutable plan from
 * `projection-plan.ts`; this module owns all of the state that doing it requires, and all of the
 * restoration paths that undo it. Restoration is not optional bookkeeping — a slot that is not
 * collapsed, a proxy that is not removed, or a light that outlives its source each draw something
 * the game did not author.
 */

/** A transform with no volume. Every triangle drawn through it is degenerate and discarded. */
const ZERO_MATRIX = /* @__PURE__ */ new Matrix4().multiplyScalar(0);

/**
 * Headroom on every batch, so the common case of a game adding a few more props does not rebuild
 * one. A batch that overflows anyway is rebuilt at its new size rather than dropping the object.
 */
const BATCH_GROWTH = 1.5;
const BATCH_MIN_SLOTS = 16;

/**
 * Per-instance frustum culling and depth sorting are both off.
 *
 * They are CPU work proportional to object count, and object-count-proportional CPU work is the
 * entire cost this class exists to remove — on the profile that motivated it, interpreted
 * JavaScript was the frame and the GPU was idle. A batch draws whole and lets the GPU discard what
 * is off screen.
 */
const PER_OBJECT_FRUSTUM_CULLED = false;
const SORT_BATCH_OBJECTS = false;

interface IBatch {
  readonly mesh: InstancedMesh;
  readonly key: string;
  readonly geometry: BufferGeometry;
  readonly material: Material;
  /** Source object per instance slot, so a released slot can be reused rather than leaked. */
  readonly instances: Map<Object3D, number>;
  readonly free: number[];
  /** Slots handed out so far, which is also where the next unused one begins. */
  used: number;
  capacity: number;
}

/** What the mirror last knew about a source, so an unchanged source costs a compare and no work. */
interface ISourceState {
  readonly matrixWorld: Matrix4;
  visible: boolean;
  geometry: BufferGeometry | undefined;
  material: Material | Material[] | undefined;
  /**
   * The batch this source is an instance of, and the key that batch was chosen by. Both are needed
   * to notice that a source has stopped belonging where it is — a mesh whose `castShadow` the game
   * just turned on has not moved and has not changed material, but it can no longer share a draw
   * with meshes that do not cast.
   */
  batchKey: string;
  /**
   * Retained for the exact lane's bookkeeping only. Batched geometry needs no revision tracking:
   * the batch references the game's own `BufferGeometry` rather than copying it, so an attribute
   * the game streams into and marks `needsUpdate` is uploaded by three.js itself.
   */
  geometryVersion: number;
}

/**
 * Everything that has to agree before two meshes may share one draw.
 *
 * A batch is a single object to the renderer, so every property the renderer reads per object
 * rather than per vertex has to be identical across the batch or one of them is being overruled.
 * Keying on the material alone merges a shadow caster with a non-caster and silently picks one
 * behaviour for both — a level that set five hundred casters rendering two of them, which is
 * exactly the class of "reports success, draws the wrong thing" this design exists to prevent.
 */
function batchKeyOf(mesh: Mesh): string {
  const material = mesh.material as Material;
  return [
    mesh.geometry.uuid,
    material.uuid,
    mesh.castShadow ? "cast" : "-",
    mesh.receiveShadow ? "receive" : "-",
    mesh.layers.mask,
  ].join("|");
}

/** The revision of a geometry's own data, so a streamed update is noticed and re-uploaded. */
function geometryVersionOf(geometry: BufferGeometry): number {
  let version = geometry.getIndex()?.version ?? 0;
  for (const name of Object.keys(geometry.attributes)) {
    version += (geometry.attributes[name] as { version?: number } | undefined)?.version ?? 0;
  }
  return version;
}

/** Element-wise equality, which is what "did this object move" reduces to. */
function matrixEquals(a: Matrix4, b: Matrix4): boolean {
  const left = a.elements;
  const right = b.elements;
  for (let index = 0; index < 16; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * A stand-in of the same class as its source, with none of its children.
 *
 * Constructed through the source's own constructor so an unusual `Mesh` subclass keeps whatever
 * its class does at draw time, rather than being flattened into a plain `Mesh` that merely looks
 * like it.
 */
function shallowProxy(object: Object3D): Object3D {
  const source = object as Mesh & {
    isInstancedMesh?: boolean;
    isSkinnedMesh?: boolean;
    isSprite?: boolean;
    isPoints?: boolean;
    isLine?: boolean;
    isLOD?: boolean;
    count?: number;
  };
  // Constructed by class, not by calling the source's constructor with no arguments.
  //
  // Calling it with none does not fail loudly, which is the problem. `new InstancedMesh()` builds
  // happily with `count` undefined and a zero-length instance buffer — a stand-in that is an
  // `InstancedMesh` by every type check and draws nothing. Nothing throws, nothing warns, and the
  // instances are simply gone: the same shape of defect as the merge that dropped two of three
  // instances, arrived at by a different route. What actually keeps them is
  // `copySpecializedState` below; naming each class here is what makes the stand-in the right size
  // to begin with rather than relying on that repair.
  if (source.isInstancedMesh === true) {
    return new InstancedMesh(source.geometry, source.material as Material, source.count ?? 1);
  }
  if (source.isSkinnedMesh === true) return new SkinnedMesh(source.geometry, source.material);
  if (source.isSprite === true) return new Sprite(source.material as SpriteMaterial);
  if (source.isPoints === true) return new Points(source.geometry, source.material);
  if (source.isLine === true) return new Line(source.geometry, source.material);
  if (source.isLOD === true) return new LOD();
  return new Mesh(source.geometry, source.material);
}

/**
 * Copies the state that makes a specialized mesh the thing it is.
 *
 * Shared by reference wherever three.js allows it, so the game animating a skeleton or writing an
 * instance matrix drives what actually draws rather than a copy that stopped tracking it.
 */
function copySpecializedState(source: Object3D, target: Object3D): void {
  const from = source as SkinnedMesh & InstancedMesh & Mesh;
  const to = target as SkinnedMesh & InstancedMesh & Mesh;
  if ((from as { isInstancedMesh?: boolean }).isInstancedMesh === true) {
    to.count = from.count;
    to.instanceMatrix = from.instanceMatrix;
    to.instanceColor = from.instanceColor;
  }
  if ((from as { isSkinnedMesh?: boolean }).isSkinnedMesh === true) {
    // The game's own skeleton, so the bones it animates are the bones that deform this draw.
    to.skeleton = from.skeleton;
    to.bindMatrix = from.bindMatrix;
    to.bindMatrixInverse = from.bindMatrixInverse;
    to.bindMode = from.bindMode;
  }
  // Shared, not copied: a game writing `influences[0] = t` every frame writes into this array.
  to.morphTargetInfluences = from.morphTargetInfluences;
  to.morphTargetDictionary = from.morphTargetDictionary;
}

/**
 * The mirror itself: the private scene the renderer is handed while the projection holds, plus
 * every batch, slot table, stand-in and mirrored light behind it.
 *
 * Constructed and driven only by `SceneRenderProjection`, which keeps the public API, the report
 * assembly and the deoptimization verdict; everything that touches renderer-owned state lives
 * here, so the mutation boundary is one class and restoration has exactly one owner.
 */
export class ProjectionMirror {
  /** Handed to the renderer whenever the projection is faithful. Never shown to the game. */
  readonly scene = new Scene();
  readonly #batches = new Map<string, IBatch>();
  readonly #state = new Map<Object3D, ISourceState>();
  /** Exact-lane stand-ins, keyed by the source they mirror. */
  readonly #proxies = new Map<Object3D, Object3D>();
  readonly #lightProxies = new Map<Light, Light>();
  #exact = new Map<ProjectionExactReason, number>();
  #projectedObjects = 0;
  #compileMs = 0;

  get projectedObjects(): number {
    return this.#projectedObjects;
  }

  get batchCount(): number {
    return this.#batches.size;
  }

  get proxyCount(): number {
    return this.#proxies.size;
  }

  get exactCounts(): ReadonlyMap<ProjectionExactReason, number> {
    return this.#exact;
  }

  get compileMs(): number {
    return this.#compileMs;
  }

  /** Rebuilds the per-frame exact-lane tallies from the scan, before any batching decision. */
  prepare(exactEntries: readonly ProjectionExactReason[]): void {
    this.#exact = new Map();
    for (const reason of exactEntries) {
      this.#exact.set(reason, (this.#exact.get(reason) ?? 0) + 1);
    }
  }

  /**
   * Builds what a project plan describes and brings the mirror in line with the authored scene.
   *
   * Returns the unsupported-light reason when the scene's lights cannot be mirrored honestly —
   * the caller then declines the whole frame. A batch that will not take an object gives up that
   * object, not the scene: dropping several thousand batched props because one of them was
   * awkward would be the fail-open rule applied at exactly the wrong granularity.
   */
  apply(plan: IProjectionProjectPlan): string | undefined {
    const lightFailure = this.#syncLights(plan.lights);
    if (lightFailure !== undefined) {
      this.releaseAll();
      return lightFailure;
    }
    // Groups below the floor join the objects that were never eligible. They keep their own draw,
    // which is what they had.
    const exactLane = [...plan.exactLane];
    for (const mesh of plan.belowFloor) {
      this.#release(mesh);
      exactLane.push({ object: mesh, reason: "tooFewToBatch" });
      this.#exact.set("tooFewToBatch", (this.#exact.get("tooFewToBatch") ?? 0) + 1);
    }
    // A batch that will not take an object gives up that object, not the scene. Dropping several
    // thousand batched props because one of them was awkward would be the fail-open rule applied
    // at exactly the wrong granularity.
    this.#projectedObjects = 0;
    for (const [key, group] of plan.batchGroups) {
      const batch = this.#ensureBatch(key, group);
      for (const mesh of group) {
        if (batch !== undefined && this.#syncBatched(batch, mesh)) {
          this.#projectedObjects += 1;
          continue;
        }
        // `#syncBatched` declines only when its batch has no slot left — the mesh was classified
        // as batchable and its geometry and material are fine. Filing that under
        // `unsupportedGeometry` sends whoever reads the report looking at the asset, which is the
        // one place the cause is not. It keeps its own draw either way; only the reason differs,
        // and the reason is the whole value of the report.
        const reason = batch === undefined ? "unsupportedGeometry" : "batchOverflow";
        this.#release(mesh);
        this.#exact.set(reason, (this.#exact.get(reason) ?? 0) + 1);
        exactLane.push({ object: mesh, reason });
      }
    }
    for (const entry of exactLane) {
      // An object can change lane while staying in the scene — a material turning transparent, a
      // `renderOrder` being set, a plain mesh swapped for a skinned one. Its batch instance has to
      // go as it acquires a proxy, or the frame draws it twice: once batched and once exactly.
      this.#release(entry.object);
      this.#syncProxy(entry.object);
    }
    this.#retire(plan.seen, plan.lights);
    return undefined;
  }

  /** Drops sources that have left the authored scene, so nothing draws what the game removed. */
  #retire(seen: ReadonlySet<Object3D>, lights: readonly Light[]): void {
    for (const batch of this.#batches.values()) {
      for (const [object, slot] of batch.instances) {
        if (seen.has(object)) continue;
        // Collapsed and returned to the free list rather than removed: an `InstancedMesh` has a
        // fixed slot count, and recycling is what lets a level stream objects in and out without
        // rebuilding its draws each time.
        batch.mesh.setMatrixAt(slot, ZERO_MATRIX);
        batch.mesh.instanceMatrix.needsUpdate = true;
        batch.instances.delete(object);
        batch.free.push(slot);
        this.#state.delete(object);
      }
    }
    for (const [object, proxy] of this.#proxies) {
      if (seen.has(object)) continue;
      this.scene.remove(proxy);
      this.#proxies.delete(object);
      this.#state.delete(object);
    }
    const live = new Set(lights);
    for (const [light, proxy] of this.#lightProxies) {
      if (live.has(light)) continue;
      this.scene.remove(proxy);
      this.#lightProxies.delete(light);
    }
    for (const object of this.#state.keys()) {
      if (!seen.has(object)) this.#state.delete(object);
    }
  }

  /**
   * Mirrors the scene's lights.
   *
   * A light cannot be in two graphs at once and moving the game's own light into the mirror would
   * be exactly the destructive rewrite this class exists to stop, so each is cloned once and then
   * kept in step. Only what a game changes at runtime is synchronized; a light form this does not
   * recognize returns false and the whole frame goes to the authored scene, because a scene lit
   * differently from the way the game lit it is a wrong picture, not a slow one.
   */
  #syncLights(lights: readonly Light[]): string | undefined {
    for (const light of lights) {
      let proxy = this.#lightProxies.get(light);
      if (proxy === undefined) {
        const cloned = light.clone() as Light & { target?: Object3D };
        if (!isLight(cloned)) return `a ${light.type} could not be mirrored`;
        // A spot or directional light aims at a target object that lives in the game's graph. The
        // clone's own target is a fresh object at the origin, so the mirror would light a
        // different direction; pointing the clone at the authored target keeps the aim.
        const target = (light as Light & { target?: Object3D }).target;
        if (target !== undefined) cloned.target = target;
        cloned.matrixAutoUpdate = false;
        proxy = cloned;
        this.#lightProxies.set(light, cloned);
        this.scene.add(cloned);
      }
      // The local matrix, for the same reason the mesh proxies use it: the renderer recomposes
      // every child's `matrixWorld` from its local matrix, so a light written the other way lights
      // the scene from the origin regardless of where the game put it.
      proxy.matrix.copy(light.matrixWorld);
      proxy.visible = light.visible;
      proxy.intensity = light.intensity;
      (proxy.color as Color | undefined)?.copy(light.color as Color);
      proxy.castShadow = light.castShadow;
      proxy.layers.mask = light.layers.mask;
    }
    return undefined;
  }
  /**
   * Puts an eligible mesh in a batch and keeps it there, in step with its source.
   *
   * The mirror holds the game's own geometry and material by reference, never a copy, so a game
   * that recolours a material recolours every draw sharing it and a game that streams into a
   * geometry changes what draws without the mirror being told anything at all. Nothing here
   * decides how anything looks; it decides only which draw a thing is part of.
   *
   * This is where "the game may change anything at any time" is paid for. Each supported property
   * is compared against what was last pushed and written in place when it differs — a moved object
   * is a matrix write, a hidden one a collapsed matrix. Nothing rebuilds, which is what makes
   * reconciling every frame affordable instead of guessing once at startup and being wrong for the
   * rest of the session.
   */
  #syncBatched(target: IBatch, mesh: Mesh): boolean {
    const material = mesh.material as Material;
    const geometry = mesh.geometry;
    const previous = this.#state.get(mesh);

    // A geometry, material or flag change moves the object to a different batch entirely, so the
    // old slot is released and it re-enters as if it were new. The key covers the shadow flags and
    // layer mask, which change nothing about where an object is but everything about which draw it
    // may share.
    if (previous !== undefined && previous.batchKey !== target.key) this.#release(mesh);
    // A mesh that was on the exact lane last frame and is batchable now must not keep its
    // stand-in, or it draws twice.
    this.#releaseProxy(mesh);

    let slot = target.instances.get(mesh);
    if (slot === undefined) {
      slot = target.free.pop();
      if (slot === undefined) {
        if (target.used >= target.capacity) return false;
        slot = target.used;
        target.used += 1;
      }
      target.instances.set(mesh, slot);
      this.#state.set(mesh, {
        // Deliberately unequal to anything real, so the first reconcile below writes the matrix
        // and the visibility rather than assuming the new slot already carries them.
        matrixWorld: new Matrix4().multiplyScalar(0),
        visible: !mesh.visible,
        geometry,
        material,
        batchKey: target.key,
        geometryVersion: 0,
      });
    }

    const state = this.#state.get(mesh) as ISourceState;
    // Ancestor visibility, not the object's own flag: a prop under a hidden group does not draw,
    // and a batch has no hierarchy to inherit that from.
    const visible = this.#visibleInWorld(mesh);
    if (visible !== state.visible || !matrixEquals(state.matrixWorld, mesh.matrixWorld)) {
      state.matrixWorld.copy(mesh.matrixWorld);
      state.visible = visible;
      // An `InstancedMesh` has no per-instance visibility flag, so a hidden object is given a
      // collapsed transform. Every one of its triangles then has zero area and is discarded before
      // rasterisation — the same trick the pass this replaces used, and the only one available
      // that does not disturb the other instances.
      if (visible) target.mesh.setMatrixAt(slot, mesh.matrixWorld);
      else target.mesh.setMatrixAt(slot, ZERO_MATRIX);
      target.mesh.instanceMatrix.needsUpdate = true;
    }
    state.geometry = geometry;
    state.material = material;
    state.batchKey = target.key;
    return true;
  }

  /** Whether the game currently wants this object drawn, ancestors included. */
  #visibleInWorld(object: Object3D): boolean {
    for (let node: Object3D | null = object; node !== null; node = node.parent) {
      if (!node.visible) return false;
    }
    return true;
  }

  /**
   * The batch for one (geometry, material, flags) group, sized to hold it.
   *
   * `InstancedMesh` rather than `BatchedMesh`, and the difference is measured rather than
   * stylistic. Three's WebGPU backend has no multi-draw path: it walks a `BatchedMesh` and issues
   * one `drawIndexed` per sub-draw, so a thousand batched objects still cost a thousand draw
   * commands. An `InstancedMesh` is one draw command for the whole group. It also references the
   * game's geometry rather than copying it into a private buffer, so a game streaming into its own
   * attribute needs no re-upload here at all — the batch is already looking at the same array.
   *
   * The price is that a group must share one geometry, where a `BatchedMesh` can hold several. A
   * level of mixed props therefore gets one draw per distinct prop kind instead of one per
   * material, which on the workloads measured is still the overwhelming majority of the reduction.
   */
  #ensureBatch(key: string, group: readonly Mesh[]): IBatch | undefined {
    const existing = this.#batches.get(key);
    if (existing !== undefined && existing.capacity >= group.length) return existing;
    const capacity = Math.max(BATCH_MIN_SLOTS, Math.ceil(group.length * BATCH_GROWTH));
    const first = group[0] as Mesh;
    if (existing !== undefined) this.#disposeBatch(existing);
    return this.#createBatch(key, first, capacity);
  }

  #createBatch(key: string, first: Mesh, capacity: number): IBatch | undefined {
    const startedAt = globalThis.performance?.now() ?? 0;
    const material = first.material as Material;
    let mesh: InstancedMesh;
    try {
      mesh = new InstancedMesh(first.geometry, material, capacity);
    } catch {
      return undefined;
    }
    // Every slot starts collapsed. A slot that is allocated but not yet written would otherwise
    // draw the geometry at the origin for one frame — a prop flashing at world zero on the frame
    // the batch grows.
    for (let slot = 0; slot < capacity; slot += 1) mesh.setMatrixAt(slot, ZERO_MATRIX);
    mesh.instanceMatrix.needsUpdate = true;
    // The batch spans wherever its instances are, so a bounding test on the whole thing can only
    // ever answer "visible" and is pure cost.
    mesh.frustumCulled = false;
    // Carried from the sources rather than defaulted. The batch is one object to the renderer, so
    // these are the batch's, and every mesh in it agreed on them — that is what the key means.
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.layers.mask = first.layers.mask;
    const batch: IBatch = {
      mesh,
      key,
      geometry: first.geometry,
      material,
      instances: new Map(),
      free: [],
      used: 0,
      capacity,
    };
    this.#batches.set(key, batch);
    this.scene.add(mesh);
    this.#compileMs += (globalThis.performance?.now() ?? 0) - startedAt;
    return batch;
  }

  /** Removes a batch from the mirror and releases the buffers it owns. */
  #disposeBatch(batch: IBatch): void {
    this.scene.remove(batch.mesh);
    // The instance matrices are the batch's own; the geometry and material are the game's and are
    // deliberately left alone.
    batch.mesh.dispose();
    for (const object of batch.instances.keys()) this.#state.delete(object);
    this.#batches.delete(batch.key);
  }

  /**
   * Keeps an exact-lane stand-in in step with its source.
   *
   * The proxy shares the source's geometry and material by reference — it is the same buffer and
   * the same material instance, so a game recolouring the original recolours what draws — and
   * carries the composed world matrix rather than a hierarchy, because the hierarchy above it is
   * in the authored scene where it belongs.
   */
  #syncProxy(object: Object3D): void {
    let proxy = this.#proxies.get(object);
    let fresh = false;
    if (proxy === undefined) {
      // `Object3D.prototype.clone` would deep-copy children the mirror does not want; a shallow
      // stand-in of the same class is what an exact draw needs.
      proxy = shallowProxy(object);
      proxy.matrixAutoUpdate = false;
      this.#proxies.set(object, proxy);
      fresh = true;
      // An `LOD` picks one of its levels by distance every frame, and it does that on itself. Its
      // levels therefore have to hang off the stand-in, or nothing selects one and the mirror
      // draws whichever rung happened to be visible when it was built.
      this.#buildLevels(object, proxy);
    }
    const source = object as Mesh;
    const target = proxy as Mesh;
    target.geometry = source.geometry;
    target.material = source.material;
    copySpecializedState(object, proxy);
    // Written into the *local* matrix, not `matrixWorld`, and this is not a detail.
    //
    // The renderer calls `updateMatrixWorld()` on whatever scene it is handed. A `Scene` composes
    // its own matrix every frame, which sets `matrixWorldNeedsUpdate`, which forces every child to
    // recompute `matrixWorld` from its local matrix — so anything written straight into
    // `matrixWorld` is overwritten before a single triangle is drawn, and every proxy in the mirror
    // renders at the world origin. Writing the local matrix instead survives that recomputation,
    // because the mirror's root is an identity transform and `identity × matrix` is the world
    // matrix the source had.
    target.matrix.copy(object.matrixWorld);
    target.visible = this.#visibleInWorld(object);
    target.renderOrder = object.renderOrder;
    target.castShadow = object.castShadow;
    target.receiveShadow = object.receiveShadow;
    target.frustumCulled = object.frustumCulled;
    target.layers.mask = object.layers.mask;
    // Added only once it is fully populated, never before.
    //
    // A `SkinnedMesh` built by its constructor has no `skeleton` until one is assigned, and
    // three.js reads `skeleton.bones.length` while it compiles the shader for that object. A
    // stand-in that is visible to the renderer for even one frame between construction and
    // assignment throws there, per frame, for as long as the material stays uncompiled — which is
    // a torrent of console errors and no drawn character.
    if (fresh) this.scene.add(proxy);
  }

  /**
   * Releases one source's instance without disturbing the rest of its batch.
   *
   * The batch is looked up by the key the source was last filed under rather than by searching
   * every batch. Searching is what makes a lane change cost the number of batches in the scene,
   * and lane changes happen per object per frame.
   */
  #release(object: Object3D): void {
    const state = this.#state.get(object);
    const batch = state === undefined ? undefined : this.#batches.get(state.batchKey);
    const slot = batch?.instances.get(object);
    if (batch !== undefined && slot !== undefined) {
      // Collapsed before the slot is handed back, so a freed slot draws nothing until something
      // else claims it. Reusing slots rather than rebuilding the batch is what keeps a level that
      // streams objects in and out from rebuilding its draws every time it does.
      batch.mesh.setMatrixAt(slot, ZERO_MATRIX);
      batch.mesh.instanceMatrix.needsUpdate = true;
      batch.instances.delete(object);
      batch.free.push(slot);
    }
    this.#state.delete(object);
  }

  /**
   * Gives an `LOD` stand-in the same levels, at the same distances, as the source.
   *
   * `LOD.update()` runs on the container and toggles its children by camera distance, so the
   * levels must be children of the stand-in for any of that to happen. Each level draws the
   * source's own geometry and material; only the container is new.
   */
  #buildLevels(object: Object3D, proxy: Object3D): void {
    if ((object as { isLOD?: boolean }).isLOD !== true) return;
    const source = object as LOD;
    const target = proxy as LOD;
    for (const level of source.levels) {
      const mesh = shallowProxy(level.object);
      copySpecializedState(level.object, mesh);
      mesh.matrix.copy(level.object.matrix);
      mesh.matrixAutoUpdate = false;
      target.addLevel(mesh, level.distance, level.hysteresis);
    }
  }

  /** Drops an exact-lane stand-in, for a source that no longer needs one. */
  #releaseProxy(object: Object3D): void {
    const proxy = this.#proxies.get(object);
    if (proxy === undefined) return;
    this.scene.remove(proxy);
    this.#proxies.delete(object);
  }
  /** Tears the mirror down, leaving the authored scene untouched, as it has been throughout. */
  releaseAll(): void {
    for (const batch of this.#batches.values()) {
      this.scene.remove(batch.mesh);
      batch.mesh.dispose();
    }
    this.#batches.clear();
    for (const proxy of this.#proxies.values()) this.scene.remove(proxy);
    this.#proxies.clear();
    for (const proxy of this.#lightProxies.values()) this.scene.remove(proxy);
    this.#lightProxies.clear();
    this.#state.clear();
    this.#projectedObjects = 0;
  }

  /**
   * What the mirror currently holds for one source object, or `undefined` if it holds nothing.
   *
   * Bounded diagnostics, for the load test and the unit tests: it answers "is this object being
   * drawn, on which lane, and with what transform and visibility" without exposing the batches or
   * the reconciliation state. Games never call this — there is no optimizer API in generated
   * source, and this class is not part of the package's public surface — but a benchmark that
   * cannot ask what the renderer was given can only report intent, and intent is not evidence.
   */
  inspect(
    object: Object3D,
  ): { lane: "batched" | "exact"; matrixWorld: Matrix4; visible: boolean } | undefined {
    const proxy = this.#proxies.get(object);
    if (proxy !== undefined) {
      return {
        lane: "exact",
        matrixWorld: new Matrix4().copy(proxy.matrix),
        visible: proxy.visible,
      };
    }
    const state = this.#state.get(object);
    if (state === undefined) return undefined;
    const batch = this.#batches.get(state.batchKey);
    const slot = batch?.instances.get(object);
    if (batch === undefined || slot === undefined) return undefined;
    const matrixWorld = new Matrix4();
    batch.mesh.getMatrixAt(slot, matrixWorld);
    return { lane: "batched", matrixWorld, visible: state.visible };
  }

  /** True when some batch in the mirror draws with this exact material instance. */
  drawsWith(material: Material): boolean {
    for (const batch of this.#batches.values()) {
      if (batch.material === material) return true;
    }
    for (const proxy of this.#proxies.values()) {
      if ((proxy as Mesh).material === material) return true;
    }
    return false;
  }
}
