import {
  type Accessor,
  type Document,
  MathUtils,
  type Mesh,
  type Node,
  PropertyType,
  type mat4,
} from "@gltf-transform/core";
import { clearNodeParent, instance, join } from "@gltf-transform/functions";

/**
 * Lossless scene-graph compaction: `flatten` collapses empty transform chains, `join`
 * merges sibling primitives that share a material, and `instance` batches a mesh that
 * several nodes reuse behind `EXT_mesh_gpu_instancing`. None of the three changes a vertex,
 * a material, a texture, or a clip — the reduction is in node count and draw count, which is
 * what a CPU-bound scene pays per frame (PRD-443).
 *
 * Every pass runs against one **protected-node set** so a node the game navigates to or
 * animates never disappears into a merged primitive: names matching a configurable regex
 * (default seeded from Midway's proven `MOVING_NODE` shape), animation channel targets and
 * their ancestors, skin joints, and an explicit allow-list. `join`/`flatten`/`instance` take
 * booleans over the CLI, so the predicate is applied through the `@gltf-transform/functions`
 * SDK directly: `join`'s `filter`, a shared-mesh clone that keeps a protected node out of an
 * `instance` batch, and computed-before-the-rename protection for `flatten`.
 */

/** Default node-name regex, the shape proven against Midway's 29 shipped GLBs. */
export const DEFAULT_PROTECTED_PATTERN =
  "propeller|aileron|rudder|flap|elevator|gear|wheel|canopy|hook|crew|gunner|threenativepivot|torpedo|wingport|wingstarboard|cockpit controls";

export interface IModelCompactInstanceOptions {
  /**
   * Minimum number of nodes that must share one mesh before it is instanced, default 2.
   * gltf-transform's own default is 5; the lower floor is what lets a paired prop instance.
   */
  readonly min?: number;
}

export interface IModelCompactOptions {
  readonly flatten?: boolean;
  readonly instance?: boolean | IModelCompactInstanceOptions;
  readonly join?: boolean;
  /** Extra exact node names to protect, on top of the regex and the structural rules. */
  readonly protectedNames?: readonly string[];
  /**
   * Case-insensitive node-name regex source for nodes the game looks up or moves. Defaults to
   * {@link DEFAULT_PROTECTED_PATTERN}; an invalid source throws rather than silently protecting nothing.
   */
  readonly protectedPattern?: string;
}

/** Why a node was kept out of join/instance. */
export type TModelProtectedRule =
  | "allow-list"
  | "animation-ancestor"
  | "animation-target"
  | "regex"
  | "skin-joint";

export interface IModelProtectedNode {
  readonly name: string;
  readonly rule: TModelProtectedRule;
}

export interface IModelCompactSummary {
  /** Whether each pass ran and how many primitives/nodes it removed. */
  readonly flatten: {
    readonly enabled: boolean;
    /** Nodes reparented toward the scene root; a node left in place is not counted. */
    readonly reparented: number;
  };
  readonly instance: {
    readonly batches: number;
    readonly enabled: boolean;
    readonly instances: number;
    /** Why no batch was created, when none was. */
    readonly reason?: string;
  };
  readonly join: {
    readonly enabled: boolean;
    readonly primitivesAfter: number;
    readonly primitivesBefore: number;
  };
  readonly nodesAfter: number;
  readonly nodesBefore: number;
  readonly primitivesAfter: number;
  readonly primitivesBefore: number;
  /**
   * Named scene nodes that existed before compaction and are gone after it. Empty is the
   * expected result of a run whose protected set covered every name the game addresses; a
   * non-empty list is the report's warning that a `getObjectByName` can now return undefined.
   */
  readonly removed: readonly string[];
  /** Every node kept out of compaction, with the rule that protected it, sorted by name. */
  readonly protected: readonly IModelProtectedNode[];
}

/** Structural view of gltf-transform's `EXT_mesh_gpu_instancing` batch property. */
interface IInstanceBatch {
  getAttribute(semantic: string): Accessor | null;
  listSemantics(): string[];
}

const EXT_MESH_GPU_INSTANCING = "EXT_mesh_gpu_instancing";

function asBatch(node: Node): IInstanceBatch | null {
  const batch = node.getExtension(EXT_MESH_GPU_INSTANCING);
  if (batch === null) return null;
  return batch as unknown as IInstanceBatch;
}

function sceneNodes(root: ReturnType<Document["getRoot"]>): Node[] {
  const nodes: Node[] = [];
  const seen = new Set<Node>();
  for (const scene of root.listScenes()) {
    scene.traverse((node) => {
      if (seen.has(node)) return;
      seen.add(node);
      nodes.push(node);
    });
  }
  return nodes;
}

function countPrimitives(nodes: readonly Node[]): number {
  let primitives = 0;
  for (const node of nodes) {
    const mesh = node.getMesh();
    if (mesh !== null) primitives += mesh.listPrimitives().length;
  }
  return primitives;
}

/** Scene-reachable node count, the number the compaction summary reports after `prune`. */
export function countCompactNodes(document: Document): number {
  return sceneNodes(document.getRoot()).length;
}

/** Scene-reachable primitive count, likewise measured after `prune`. */
export function countCompactPrimitives(document: Document): number {
  return countPrimitives(sceneNodes(document.getRoot()));
}

/**
 * Sorted names of every named scene-reachable node that carries geometry or a child. A bare empty
 * leaf is excluded: `prune` removes it whether or not compaction ran, so blaming compaction for it
 * would be a false report.
 */
export function sceneNodeNames(document: Document): string[] {
  return sceneNodes(document.getRoot())
    .filter((node) => node.getMesh() !== null || node.listChildren().length > 0)
    .map((node) => node.getName())
    .filter((name) => name !== "")
    .sort();
}

/** Multiset difference: names present in `before` more times than in `after`, sorted. */
export function removedNames(before: readonly string[], after: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const name of after) counts.set(name, (counts.get(name) ?? 0) + 1);
  const removed: string[] = [];
  for (const name of before) {
    const remaining = counts.get(name) ?? 0;
    if (remaining > 0) counts.set(name, remaining - 1);
    else removed.push(name);
  }
  return removed.sort();
}

/**
 * Builds the protected-node set once, before any pass mutates the graph. A node matched by
 * more than one rule keeps the first rule that fires, in priority order: allow-list, then the
 * structural rules a broken lookup would be hardest to debug, then the regex, and finally the
 * `animation-ancestor` fallback (claimed last so a node that is also a target or a name match
 * keeps the rule that spreads the keep closure to its children).
 */
export function buildProtectedSet(
  document: Document,
  options: IModelCompactOptions = {},
): { readonly nodes: Map<Node, TModelProtectedRule>; readonly summary: IModelProtectedNode[] } {
  const root = document.getRoot();
  const rules = new Map<Node, TModelProtectedRule>();
  const claim = (node: Node, rule: TModelProtectedRule): void => {
    if (!rules.has(node)) rules.set(node, rule);
  };

  const allowList = new Set(options.protectedNames ?? []);
  for (const node of sceneNodes(root)) {
    const name = node.getName();
    if (name !== "" && allowList.has(name)) claim(node, "allow-list");
  }

  for (const skin of root.listSkins()) {
    for (const joint of skin.listJoints()) claim(joint, "skin-joint");
  }

  // Targets first, ancestors last: a node that is both an animation target and an ancestor of
  // another target (a parent and its animated child) must keep the `animation-target` rule, which
  // spreads the keep closure, rather than being mis-classified as a mere ancestor.
  for (const animation of root.listAnimations()) {
    for (const channel of animation.listChannels()) {
      const target = channel.getTargetNode();
      if (target !== null) claim(target, "animation-target");
    }
  }

  const pattern = new RegExp(options.protectedPattern ?? DEFAULT_PROTECTED_PATTERN, "iu");
  for (const node of sceneNodes(root)) {
    const name = node.getName();
    if (name !== "" && pattern.test(name)) claim(node, "regex");
  }

  for (const animation of root.listAnimations()) {
    for (const channel of animation.listChannels()) {
      const target = channel.getTargetNode();
      if (target === null) continue;
      // An ancestor of an animated node must not be absorbed either: moving or merging it
      // would reparent the animated subtree under a different transform.
      let ancestor = target.getParentNode();
      while (ancestor !== null) {
        claim(ancestor, "animation-ancestor");
        ancestor = ancestor.getParentNode();
      }
    }
  }

  const summary: IModelProtectedNode[] = [];
  for (const [node, rule] of rules) {
    summary.push({ name: node.getName() === "" ? "(unnamed)" : node.getName(), rule });
  }
  summary.sort(
    (left, right) => left.name.localeCompare(right.name) || left.rule.localeCompare(right.rule),
  );
  return { nodes: rules, summary };
}

/**
 * `instance()` has no predicate, so a protected node sharing a mesh would lose that mesh to a
 * batch, and a node whose world transform is not exactly T*R*S (a parented non-uniform scale
 * under rotation shears) would be re-expressed by `instance()`'s decomposition and drift. Both
 * cases get their own deep mesh clone, which leaves the sibling batch intact and the node
 * addressable and exact.
 *
 * The clone is deep on purpose: gltf-transform's `Mesh.clone()` copies accessor *references*,
 * and quantize() later assumes one accessor per mesh — a shared accessor leaves the protected
 * node's transform uncompensated, which the pass's own drift check then rejects.
 */
/** A node whose shared mesh was temporarily replaced so `instance()` would not batch it. */
interface IDetachedMesh {
  readonly clone: Mesh;
  readonly node: Node;
  readonly original: Mesh;
}

function detachProtectedMeshes(
  document: Document,
  protectedNodes: ReadonlyMap<Node, unknown>,
): IDetachedMesh[] {
  const keep = keepInPlaceNodes(document, protectedNodes);
  // `instance()` has no predicate: a shared mesh anywhere in the keep closure — a protected
  // node OR one of its descendants — would be batched at the scene root and its node pruned,
  // which for a protected pivot means the lookup breaks and its children stop rotating with it.
  // The clone only has to exist for the `instance()` call; the caller restores the original
  // afterward, so an N-times-shared mesh is never shipped N times.
  const detached: IDetachedMesh[] = [];
  for (const node of keep) {
    const mesh = node.getMesh();
    if (mesh === null || !isShared(mesh, node)) continue;
    const clone = deepCloneMesh(document, mesh);
    node.setMesh(clone);
    detached.push({ clone, node, original: mesh });
  }
  return detached;
}

/** Puts every temporarily detached node back on its original mesh and drops the clones. */
function restoreDetachedMeshes(detached: readonly IDetachedMesh[]): void {
  for (const { clone, node, original } of detached) {
    if (node.getMesh() === clone) node.setMesh(original);
    disposeMeshDeep(clone);
  }
}

/**
 * Disposes a cloned Mesh and everything under it. `Mesh.dispose()` only drops the Mesh; its
 * primitives still own the cloned accessors, and only the chain's `prune` would remove them —
 * with `passes.prune: false` they were written out 33×.
 */
function disposeMeshDeep(mesh: Mesh): void {
  for (const primitive of mesh.listPrimitives()) {
    for (const semantic of primitive.listSemantics()) {
      const attribute = primitive.getAttribute(semantic);
      primitive.setAttribute(semantic, null);
      attribute?.dispose();
    }
    const indices = primitive.getIndices();
    primitive.setIndices(null);
    indices?.dispose();
    for (const target of primitive.listTargets()) {
      for (const semantic of target.listSemantics()) {
        const attribute = target.getAttribute(semantic);
        target.setAttribute(semantic, null);
        attribute?.dispose();
      }
      target.dispose();
    }
    primitive.dispose();
  }
  mesh.dispose();
}

function isShared(mesh: Mesh, node: Node): boolean {
  return mesh
    .listParents()
    .some((parent) => parent !== node && parent.propertyType === PropertyType.NODE);
}

/**
 * True when the node's world matrix is exactly `T * R * S`. `instance()` writes an instance
 * batch from `getWorldTranslation/Rotation/Scale`, which cannot represent a sheared matrix —
 * the child of a non-uniformly scaled, rotated parent — so a node that is not exact must not
 * be instanced.
 */
function isTrsExact(node: Node): boolean {
  const world = node.getWorldMatrix();
  const composed = composeTrsMatrix(
    node.getWorldTranslation(),
    node.getWorldRotation(),
    node.getWorldScale(),
  );
  for (let index = 0; index < 16; index += 1) {
    const expected = world[index] ?? 0;
    const actual = composed[index] ?? 0;
    if (Math.abs(expected - actual) > 1e-4 * Math.max(1, Math.abs(expected))) return false;
  }
  return true;
}

/** Column-major glTF `T * R * S` matrix from translation, quaternion (`x,y,z,w`) and scale. */
export function composeTrsMatrix(
  translation: readonly number[],
  rotation: readonly number[],
  scale: readonly number[],
): number[] {
  const out = new Float32Array(16);
  const tx = translation[0] ?? 0;
  const ty = translation[1] ?? 0;
  const tz = translation[2] ?? 0;
  const qx = rotation[0] ?? 0;
  const qy = rotation[1] ?? 0;
  const qz = rotation[2] ?? 0;
  const qw = rotation[3] ?? 1;
  const sx = scale[0] ?? 1;
  const sy = scale[1] ?? 1;
  const sz = scale[2] ?? 1;
  MathUtils.compose(
    [tx, ty, tz] as unknown as Parameters<typeof MathUtils.compose>[0],
    [qx, qy, qz, qw] as unknown as Parameters<typeof MathUtils.compose>[1],
    [sx, sy, sz] as unknown as Parameters<typeof MathUtils.compose>[2],
    out as unknown as mat4,
  );
  return Array.from(out);
}

/**
 * Nodes a compaction pass must not move or reparent: the protected set, and every descendant of a
 * node that can actually move (an animation target, a skin joint, a regex or allow-list match) —
 * plus any node whose world matrix `T * R * S` cannot represent, because moving it would decompose
 * a shear and drift the self-verify. One traversal feeds both `flatten` and the `instance` mesh
 * detach, so the two passes agree on what is off limits.
 *
 * An `animation-ancestor` is kept itself but does **not** spread the closure to its descendants:
 * otherwise a whole animated aircraft, whose every chain descends from the protected root, would
 * be frozen and the pass would reduce nothing (the a6m3 shape the PRD exists to fix).
 */
function keepInPlaceNodes(
  document: Document,
  protectedNodes: ReadonlyMap<Node, unknown>,
): Set<Node> {
  const keepInPlace = new Set<Node>(protectedNodes.keys());
  const spreading = new Set<Node>();
  for (const [node, rule] of protectedNodes) {
    if (rule !== "animation-ancestor") spreading.add(node);
  }
  // A single top-down pass: by the time a node is visited its parent's decision is known, so a
  // spreading ancestor propagates to every descendant.
  for (const scene of document.getRoot().listScenes()) {
    scene.traverse((node) => {
      const parent = node.getParentNode();
      if (parent === null) {
        if (!isTrsExact(node)) {
          keepInPlace.add(node);
          spreading.add(node);
        }
        return;
      }
      if (spreading.has(parent) || !isTrsExact(parent) || !isTrsExact(node)) {
        keepInPlace.add(node);
        spreading.add(node);
      }
    });
  }
  return keepInPlace;
}

/**
 * A protected-aware `flatten`: reparents every node that is safe to move up to its scene root,
 * and leaves the rest where the game expects them.
 *
 * gltf-transform's own `flatten()` skips animation targets and skeleton descendants but knows
 * nothing about a game's protected names. Without this, a protected pivot's mesh child is
 * reparented first, the pivot becomes an empty leaf and `prune` deletes it, and `join` merges
 * the child into the hull — the exact lookup the PRD forbids.
 */
function flattenProtected(document: Document, protectedNodes: ReadonlyMap<Node, unknown>): number {
  const keepInPlace = keepInPlaceNodes(document, protectedNodes);
  let reparented = 0;
  // Top-down, so a parent's reparent does not strand a child that is staying put.
  for (const scene of document.getRoot().listScenes()) {
    scene.traverse((node) => {
      if (keepInPlace.has(node) || node.getParentNode() === null) return;
      clearNodeParent(node);
      reparented += 1;
    });
  }
  return reparented;
}

/**
 * A genuinely independent mesh: gltf-transform's `Mesh.clone()` copies child *references*,
 * so primitives and their accessors would still be shared with the source and the next
 * quantize() would leave this node's transform uncompensated. Every primitive, attribute,
 * index accessor and morph target is copied here.
 */
function deepCloneMesh(document: Document, mesh: Mesh): Mesh {
  const clone = document.createMesh(mesh.getName());
  for (const primitive of mesh.listPrimitives()) {
    const copy = document.createPrimitive();
    for (const semantic of primitive.listSemantics()) {
      const attribute = primitive.getAttribute(semantic);
      if (attribute !== null) copy.setAttribute(semantic, attribute.clone());
    }
    const indices = primitive.getIndices();
    if (indices !== null) copy.setIndices(indices.clone());
    const material = primitive.getMaterial();
    if (material !== null) copy.setMaterial(material);
    for (const target of primitive.listTargets()) {
      const targetCopy = document.createPrimitiveTarget();
      for (const semantic of target.listSemantics()) {
        const attribute = target.getAttribute(semantic);
        if (attribute !== null) targetCopy.setAttribute(semantic, attribute.clone());
      }
      copy.addTarget(targetCopy);
    }
    clone.addPrimitive(copy);
  }
  return clone;
}

function instanceCount(batch: IInstanceBatch): number {
  for (const semantic of batch.listSemantics()) {
    const attribute = batch.getAttribute(semantic);
    if (attribute !== null) return attribute.getCount();
  }
  return 0;
}

/**
 * Runs the enabled compaction passes against one protected-node set and returns the per-pass
 * counts. `cleanup` is disabled on `flatten`/`join` so the pass chain's own `prune` — which is
 * configured by the game and runs right after — is the only thing that removes geometry; the
 * caller re-measures the node/primitives totals after that prune.
 */
export async function compactModel(
  document: Document,
  options: IModelCompactOptions = {},
): Promise<IModelCompactSummary> {
  const root = document.getRoot();
  const namesBefore = sceneNodeNames(document);
  const nodesBefore = sceneNodes(root).length;
  const primitivesBefore = countPrimitives(sceneNodes(root));
  const { nodes: protectedNodes, summary: protectedSummary } = buildProtectedSet(document, options);

  const flattenEnabled = options.flatten ?? true;
  const joinEnabled = options.join ?? true;
  const instanceOption = options.instance ?? true;
  const instanceEnabled = instanceOption !== false;
  const instanceMin =
    typeof instanceOption === "object" && instanceOption.min !== undefined ? instanceOption.min : 2;

  // Dedup (earlier in the chain) links identical meshes so a shared mesh is instanced rather
  // than joined into one oversized primitive. Order is flatten → instance → join: `join`
  // merges sibling primitives by material, which would otherwise destroy the shared mesh an
  // `instance` batch needs, and `flatten` gathers the siblings that make `join` effective.
  const reparented = flattenEnabled ? flattenProtected(document, protectedNodes) : 0;

  // The mesh detach exists only to keep a node out of an `instance` batch, and `instance()`
  // refuses any document with animations, so it is skipped there and the meshes are restored
  // immediately after the call either way.
  const sharedBefore = new Set<Node>();
  for (const node of sceneNodes(root)) {
    const mesh = node.getMesh();
    if (mesh !== null && isShared(mesh, node)) sharedBefore.add(node);
  }
  let detached: readonly IDetachedMesh[] = [];
  if (instanceEnabled && root.listAnimations().length === 0) {
    detached = detachProtectedMeshes(document, protectedNodes);
  }

  let instanceSummary: IModelCompactSummary["instance"] = {
    batches: 0,
    enabled: instanceEnabled,
    instances: 0,
  };
  if (instanceEnabled) {
    await instance({ min: instanceMin })(document);
    let batches = 0;
    let instances = 0;
    for (const node of sceneNodes(root)) {
      const batch = asBatch(node);
      if (batch === null) continue;
      batches += 1;
      instances += instanceCount(batch);
    }
    const reason =
      batches > 0
        ? undefined
        : root.listAnimations().length > 0
          ? "animated model; EXT_mesh_gpu_instancing is not supported for animated models"
          : `no mesh was shared by >=${String(instanceMin)} nodes`;
    instanceSummary = {
      batches,
      enabled: true,
      instances,
      ...(reason === undefined ? {} : { reason }),
    };
  }
  restoreDetachedMeshes(detached);

  const primitivesBeforeJoin = countPrimitives(sceneNodes(root));
  if (joinEnabled) {
    // `join` merges a primitive whose Mesh several nodes share once per node, duplicating its
    // vertices N times — the N× file growth that made a 50-rivet animated prop 13× larger. Those
    // nodes were recorded before the detach (a protected descendant's clone is not shared any
    // more, but it is still one of a repeated set), and stay authored for `instance`/runtime.
    const accessorsBeforeJoin = collectAccessors(root);
    await join({
      cleanup: false,
      filter: (node) => !protectedNodes.has(node) && !sharedBefore.has(node),
    })(document);
    // With `cleanup: false` `join` leaves the source primitives and accessors behind for the
    // game-configured `prune` to remove. With `passes.prune: false` they shipped as raw float32
    // (8× the compacted file), so remove this pass's own leftovers here regardless.
    for (const accessor of accessorsBeforeJoin) {
      if (accessor.listParents().every((parent) => parent.propertyType === PropertyType.ROOT)) {
        accessor.dispose();
      }
    }
    for (const mesh of root.listMeshes()) {
      if (mesh.listPrimitives().length === 0) mesh.dispose();
    }
  }
  const primitivesAfterJoin = countPrimitives(sceneNodes(root));

  const nodesAfter = sceneNodes(root).length;
  const summary: IModelCompactSummary = {
    flatten: { enabled: flattenEnabled, reparented },
    instance: instanceSummary,
    join: {
      enabled: joinEnabled,
      primitivesAfter: primitivesAfterJoin,
      primitivesBefore: primitivesBeforeJoin,
    },
    nodesAfter,
    nodesBefore,
    primitivesAfter: primitivesAfterJoin,
    primitivesBefore,
    removed: removedNames(namesBefore, sceneNodeNames(document)),
    protected: protectedSummary,
  };
  return summary;
}

/** Every accessor a mesh primitive's attributes, indices or morph targets reference. */
function collectAccessors(root: ReturnType<Document["getRoot"]>): Set<Accessor> {
  const accessors = new Set<Accessor>();
  const add = (accessor: Accessor | null): void => {
    if (accessor !== null) accessors.add(accessor);
  };
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      for (const semantic of primitive.listSemantics()) add(primitive.getAttribute(semantic));
      add(primitive.getIndices());
      for (const target of primitive.listTargets()) {
        for (const semantic of target.listSemantics()) add(target.getAttribute(semantic));
      }
    }
  }
  return accessors;
}

/** True when at least one compaction pass is enabled — the pass chain's activity test. */
export function compactRequested(options: boolean | IModelCompactOptions | undefined): boolean {
  if (options === false) return false;
  if (options === undefined || options === true) return true;
  return options.flatten !== false || options.join !== false || options.instance !== false;
}

/** Bump when a compaction algorithm change makes a previously cached output stale. */
export const COMPACT_VERSION = 5;

/** The compaction policy with every default resolved, so it is a stable cache key. */
export interface IResolvedCompactOptions {
  readonly flatten: boolean;
  readonly instance: false | IModelCompactInstanceOptions;
  readonly join: boolean;
  readonly protectedNames: readonly string[];
  readonly protectedPattern: string;
  /** Algorithm identity, so an upgraded pass never re-serves a cache from an older build. */
  readonly version: number;
}

export function resolveCompactOptions(
  options: boolean | IModelCompactOptions | undefined,
): IResolvedCompactOptions {
  if (options === undefined || options === true) {
    return {
      flatten: true,
      instance: { min: 2 },
      join: true,
      protectedNames: [],
      protectedPattern: DEFAULT_PROTECTED_PATTERN,
      version: COMPACT_VERSION,
    };
  }
  if (options === false) {
    return {
      flatten: false,
      instance: false,
      join: false,
      protectedNames: [],
      protectedPattern: DEFAULT_PROTECTED_PATTERN,
      version: COMPACT_VERSION,
    };
  }
  const instance = options.instance;
  const min = typeof instance === "object" ? (instance.min ?? 2) : 2;
  if (!Number.isSafeInteger(min) || min < 2) {
    throw new Error(
      "TN_ASSETS_COMPACT_INVALID: assets.models.compact.instance.min must be an integer of at least 2.",
    );
  }
  return {
    flatten: options.flatten !== false,
    instance: instance === false ? false : { min },
    join: options.join !== false,
    protectedNames: options.protectedNames ?? [],
    protectedPattern: options.protectedPattern ?? DEFAULT_PROTECTED_PATTERN,
    version: COMPACT_VERSION,
  };
}
