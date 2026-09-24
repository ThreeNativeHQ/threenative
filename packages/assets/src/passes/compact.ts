import {
  type Document,
  type Mesh,
  type Node,
  PropertyType,
} from "@gltf-transform/core";
import type { InstancedMesh } from "@gltf-transform/extensions";
import { flatten, instance, join } from "@gltf-transform/functions";

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
    readonly nodesAfter: number;
    readonly nodesBefore: number;
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
  /** Every node kept out of compaction, with the rule that protected it, sorted by name. */
  readonly protected: readonly IModelProtectedNode[];
}

const EXT_MESH_GPU_INSTANCING = "EXT_mesh_gpu_instancing";

function asBatch(node: Node): InstancedMesh | null {
  return node.getExtension<InstancedMesh>(EXT_MESH_GPU_INSTANCING);
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
 * Builds the protected-node set once, before any pass mutates the graph. A node matched by
 * more than one rule keeps the first rule that fires, in priority order: allow-list, then the
 * structural rules a broken lookup would be hardest to debug, then the regex.
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

  for (const animation of root.listAnimations()) {
    for (const channel of animation.listChannels()) {
      const target = channel.getTargetNode();
      if (target === null) continue;
      claim(target, "animation-target");
      // An ancestor of an animated node must not be absorbed either: moving or merging it
      // would reparent the animated subtree under a different transform.
      let ancestor = target.getParentNode();
      while (ancestor !== null) {
        claim(ancestor, "animation-ancestor");
        ancestor = ancestor.getParentNode();
      }
    }
  }

  const pattern = new RegExp(options.protectedPattern ?? DEFAULT_PROTECTED_PATTERN, "iu");
  for (const node of sceneNodes(root)) {
    const name = node.getName();
    if (name !== "" && pattern.test(name)) claim(node, "regex");
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
function detachProtectedMeshes(
  document: Document,
  protectedNodes: ReadonlyMap<Node, unknown>,
): void {
  for (const node of protectedNodes.keys()) {
    const mesh = node.getMesh();
    if (mesh === null) continue;
    if (isShared(mesh, node) || !isTrsExact(node)) node.setMesh(deepCloneMesh(document, mesh));
  }
  // A node whose world transform a batch cannot represent must not be instanced even when it is
  // not protected and shares a mesh: `instance()` would re-express it and the pass would reject
  // its own output for a drift it introduced.
  for (const node of sceneNodes(document.getRoot())) {
    if (protectedNodes.has(node)) continue;
    const mesh = node.getMesh();
    if (mesh === null || isTrsExact(node)) continue;
    node.setMesh(deepCloneMesh(document, mesh));
  }
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
  const [tx = 0, ty = 0, tz = 0] = translation;
  const [qx = 0, qy = 0, qz = 0, qw = 1] = rotation;
  const [sx = 1, sy = 1, sz = 1] = scale;
  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;
  const m00 = 1 - (yy + zz);
  const m01 = xy + wz;
  const m02 = xz - wy;
  const m10 = xy - wz;
  const m11 = 1 - (xx + zz);
  const m12 = yz + wx;
  const m20 = xz + wy;
  const m21 = yz - wx;
  const m22 = 1 - (xx + yy);
  return [
    m00 * sx,
    m10 * sx,
    m20 * sx,
    0,
    m01 * sy,
    m11 * sy,
    m21 * sy,
    0,
    m02 * sz,
    m12 * sz,
    m22 * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
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

function instanceCount(batch: InstancedMesh): number {
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
  let nodesAfterFlatten = nodesBefore;
  if (flattenEnabled) {
    await flatten({ cleanup: false })(document);
    nodesAfterFlatten = sceneNodes(root).length;
  }

  detachProtectedMeshes(document, protectedNodes);

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

  const primitivesBeforeJoin = countPrimitives(sceneNodes(root));
  if (joinEnabled) {
    await join({ cleanup: false, filter: (node) => !protectedNodes.has(node) })(document);
  }
  const primitivesAfterJoin = countPrimitives(sceneNodes(root));

  const nodesAfter = sceneNodes(root).length;
  const summary: IModelCompactSummary = {
    flatten: { enabled: flattenEnabled, nodesAfter: nodesAfterFlatten, nodesBefore },
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
    protected: protectedSummary,
  };
  return summary;
}

/** True when at least one compaction pass is enabled — the pass chain's activity test. */
export function compactRequested(options: boolean | IModelCompactOptions | undefined): boolean {
  if (options === false) return false;
  if (options === undefined || options === true) return true;
  return options.flatten !== false || options.join !== false || options.instance !== false;
}

/** The compaction policy with every default resolved, so it is a stable cache key. */
export interface IResolvedCompactOptions {
  readonly flatten: boolean;
  readonly instance: false | IModelCompactInstanceOptions;
  readonly join: boolean;
  readonly protectedNames: readonly string[];
  readonly protectedPattern: string;
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
    };
  }
  if (options === false) {
    return {
      flatten: false,
      instance: false,
      join: false,
      protectedNames: [],
      protectedPattern: DEFAULT_PROTECTED_PATTERN,
    };
  }
  const instance = options.instance;
  return {
    flatten: options.flatten !== false,
    instance:
      instance === false ? false : { min: typeof instance === "object" ? (instance.min ?? 2) : 2 },
    join: options.join !== false,
    protectedNames: options.protectedNames ?? [],
    protectedPattern: options.protectedPattern ?? DEFAULT_PROTECTED_PATTERN,
  };
}
