// The cluster DAG bake — PRD-281.
//
// A dense mesh becomes a hierarchy of clusters whose error bounds never lie. The loop is
// clusterize → partition into groups → simplify each group with its boundary locked → re-clusterize
// the result → record the group's error on every cluster that went into it, and repeat on what came
// out.
//
// The invariant, and the whole reason this file exists: a cluster's parent error is never below its
// own error. `parentError = max(groupSimplifyError, max(childErrors))`. Given that, the selection
// rule "draw a cluster when its own error is under the threshold and its parent group's error is
// not" cuts the DAG watertight at *every* threshold and *every* camera, because two clusters that
// share a seam either share a group — and are therefore replaced together — or keep that seam
// locked through every simplification above them.
//
// Nothing here is new geometry: simplification only removes vertices, so every level indexes the
// same position buffer the source mesh shipped. That is what lets one vertex buffer serve the whole
// DAG at run time.

import { MeshoptClusterizer, MeshoptSimplifier } from "meshoptimizer";
import { clusterAdjacency, partitionClusters } from "./partition.js";

/** meshoptimizer's per-cluster bounding sphere and normal cone, unpacked into plain numbers. */
export interface IClusterBounds {
  readonly centerX: number;
  readonly centerY: number;
  readonly centerZ: number;
  readonly coneAxisX: number;
  readonly coneAxisY: number;
  readonly coneAxisZ: number;
  readonly coneCutoff: number;
  readonly radius: number;
}

/** A bounding sphere, in the mesh's own space. */
export interface IClusterSphere {
  readonly radius: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface IVirtualCluster {
  readonly bounds: IClusterBounds;
  /** Index count, always a multiple of three. */
  readonly count: number;
  /** Object-space error incurred by drawing this cluster instead of its children. Zero at level 0. */
  readonly error: number;
  /** The group this cluster was folded into one level up, or -1 when nothing above replaces it. */
  readonly group: number;
  readonly level: number;
  /** Error of the group above. `Infinity` when this cluster has no parent — it is always drawn. */
  readonly parentError: number;
  /**
   * The sphere `parentError` is projected through at run time — the sphere of the group this
   * cluster folds into, shared with every sibling in it, so they flip together. Its own bounds when
   * it has no parent.
   */
  readonly parentSphere: IClusterSphere;
  /**
   * The sphere `error` is projected through — the sphere of the group that *produced* this cluster.
   *
   * Two spheres rather than one, because a screen-space cut needs the same projection on both sides
   * of a seam or it cracks: a group's sphere encloses every child's source sphere, so the parent's
   * projected error can never fall below a child's however the camera moves.
   */
  readonly sourceSphere: IClusterSphere;
  /** Start of this cluster's triangles in the DAG's index buffer. */
  readonly start: number;
}

export interface IVirtualGroup {
  /** The clusters that were simplified together. */
  readonly children: readonly number[];
  /** `max(simplify error, max child error)` — monotonic by construction. */
  readonly error: number;
  readonly level: number;
  /** What the simplifier alone reported, before the children's errors were folded in. */
  readonly simplifyError: number;
  /** The clusters the simplified group was re-clusterized into. */
  readonly parents: readonly number[];
  /** Encloses every child's bounds and every child's source sphere. Monotone up the DAG. */
  readonly sphere: IClusterSphere;
}

export interface IVirtualLevel {
  readonly clusterCount: number;
  /** Clusters carried up unchanged because their group would not simplify. */
  readonly promoted: number;
  readonly triangleCount: number;
}

/**
 * Why the level loop stopped.
 *
 * - `root` — one cluster is left, and it is the top of the DAG.
 * - `stalled` — nothing left will simplify. meshoptimizer will not take a closed shell below about
 *   64 triangles, so a body of *n* disconnected shells has a floor of roughly 64n and stops above
 *   one cluster however many levels it is given. That is the geometry's answer, not a bug; the
 *   `Prune` flag is the only way past it and it deletes whole components, which this bake will not
 *   do. Measured in PRD-281's verification file.
 * - `cap` — `maxLevels` ran out. The DAG is incomplete and a caller should say so.
 */
export type ClusterDagStop = "cap" | "root" | "stalled";

export interface IClusterDag {
  readonly clusters: readonly IVirtualCluster[];
  readonly groups: readonly IVirtualGroup[];
  /** Cluster-ordered triangles for every level, indexing the source mesh's vertex buffer. */
  readonly indices: Uint32Array;
  readonly levels: readonly IVirtualLevel[];
  /** Clusters nothing above replaces. Drawn at every threshold at or above their own error. */
  readonly roots: readonly number[];
  readonly stopReason: ClusterDagStop;
}

export interface IClusterDagOptions {
  /** Weight given to normal-cone coherence when clusterizing. */
  readonly coneWeight?: number;
  /** Clusters per group. Four is what the published DAGs use and what §1's diagram names. */
  readonly groupSize?: number;
  /** Stop after this many levels rather than looping forever on a body that will not converge. */
  readonly maxLevels?: number;
  readonly maxTriangles?: number;
  readonly maxVertices?: number;
  readonly minTriangles?: number;
  /** Fraction of a group's triangles the simplifier is asked to keep. */
  readonly simplifyRatio?: number;
  /**
   * Simplifies each group with its rim free to move. The resulting DAG **cracks** — it exists so
   * PRD-281's AC3 can show that the boundary lock is load-bearing rather than assert it.
   */
  readonly unlockGroupBoundary?: boolean;
}

const DEFAULT_CONE_WEIGHT = 0;
const DEFAULT_GROUP_SIZE = 4;
const DEFAULT_MAX_LEVELS = 32;
const DEFAULT_MAX_TRIANGLES = 128;
const DEFAULT_MAX_VERTICES = 128;
const DEFAULT_MIN_TRIANGLES = 96;
const DEFAULT_SIMPLIFY_RATIO = 0.5;

/**
 * The simplifier is asked for a ratio, never for an error: a target error would let it stop early on
 * an easy group and produce a level that barely shrank. The error it reports back is what the DAG
 * records.
 */
const UNBOUNDED_ERROR = 1e9;

/** A level that does not shed at least this much of its triangles is not making progress. */
const MIN_LEVEL_REDUCTION = 0.02;

/** Growable index buffer. `number[]` costs about eight bytes a slot on a multi-million-triangle bake. */
class Uint32Sink {
  private data: Uint32Array;
  private used = 0;

  constructor(capacity: number) {
    this.data = new Uint32Array(Math.max(capacity, 3));
  }

  get length(): number {
    return this.used;
  }

  push(value: number): void {
    if (this.used === this.data.length) {
      const grown = new Uint32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.used] = value;
    this.used += 1;
  }

  /** A view over what has been written. Valid until the next `push` that grows the buffer. */
  view(): Uint32Array {
    return this.data.subarray(0, this.used);
  }

  toArray(): Uint32Array {
    return this.data.slice(0, this.used);
  }
}

interface IMutableCluster {
  bounds: IClusterBounds;
  count: number;
  error: number;
  group: number;
  level: number;
  parentError: number;
  parentSphere: IClusterSphere;
  sourceSphere: IClusterSphere;
  start: number;
}

/**
 * The smallest sphere containing both, by the usual construction.
 *
 * Used to grow a group's sphere over its children. Conservative and deterministic; a tighter
 * enclosure would change nothing about correctness, only about how early a cluster is dropped.
 */
function unite(a: IClusterSphere, b: IClusterSphere): IClusterSphere {
  if (b.radius <= 0) return a;
  if (a.radius <= 0) return b;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance + b.radius <= a.radius) return a;
  if (distance + a.radius <= b.radius) return b;
  const radius = (a.radius + b.radius + distance) / 2;
  const step = distance === 0 ? 0 : (radius - a.radius) / distance;
  return { radius, x: a.x + dx * step, y: a.y + dy * step, z: a.z + dz * step };
}

function assertMesh(indices: Uint32Array, positions: Float32Array): void {
  if (indices.length === 0 || indices.length % 3 !== 0)
    throw new Error(
      `buildClusterDag needs a non-empty triangle list: got ${indices.length} indices.`,
    );
  if (positions.length === 0 || positions.length % 3 !== 0)
    throw new Error(
      `buildClusterDag needs tightly packed vec3 positions: got ${positions.length} floats.`,
    );
  const vertexCount = positions.length / 3;
  for (let slot = 0; slot < indices.length; slot += 1)
    if ((indices[slot] as number) >= vertexCount)
      throw new Error(
        `buildClusterDag index ${indices[slot]} at ${slot} is outside the ${vertexCount}-vertex buffer.`,
      );
}

interface IResolvedOptions {
  readonly coneWeight: number;
  readonly groupSize: number;
  readonly lockFlags: ("ErrorAbsolute" | "LockBorder" | "Sparse")[];
  readonly maxLevels: number;
  readonly maxTriangles: number;
  readonly maxVertices: number;
  readonly minTriangles: number;
  readonly simplifyRatio: number;
}

function resolveOptions(options: IClusterDagOptions): IResolvedOptions {
  const simplifyRatio = options.simplifyRatio ?? DEFAULT_SIMPLIFY_RATIO;
  if (simplifyRatio <= 0 || simplifyRatio >= 1)
    throw new Error(`buildClusterDag simplifyRatio must be inside (0, 1): got ${simplifyRatio}.`);
  return {
    coneWeight: options.coneWeight ?? DEFAULT_CONE_WEIGHT,
    groupSize: options.groupSize ?? DEFAULT_GROUP_SIZE,
    // LockBorder holds the group's rim still — meshoptimizer computes that rim on the welded
    // topology, which is why split seam vertices do not leak through it. ErrorAbsolute puts the
    // reported error in the mesh's own units so levels are comparable. Sparse keeps the simplifier's
    // cost proportional to the group rather than to the whole vertex buffer.
    lockFlags: options.unlockGroupBoundary
      ? ["ErrorAbsolute", "Sparse"]
      : ["LockBorder", "ErrorAbsolute", "Sparse"],
    maxLevels: options.maxLevels ?? DEFAULT_MAX_LEVELS,
    maxTriangles: options.maxTriangles ?? DEFAULT_MAX_TRIANGLES,
    maxVertices: options.maxVertices ?? DEFAULT_MAX_VERTICES,
    minTriangles: options.minTriangles ?? DEFAULT_MIN_TRIANGLES,
    simplifyRatio,
  };
}

interface ILevelFold {
  readonly next: number[];
  readonly promoted: number;
  readonly simplifiedAny: boolean;
}

/** One bake. Holds the growing index buffer and the cluster and group tables the loop appends to. */
class ClusterDagBuilder {
  private readonly clusters: IMutableCluster[] = [];
  private readonly groups: IVirtualGroup[] = [];
  private readonly levels: IVirtualLevel[] = [];
  private readonly settings: IResolvedOptions;
  private readonly sink: Uint32Sink;
  /** Vertices that share a position are one vertex for adjacency: a UV seam splits the vertex
   * buffer but not the surface, and two clusters that meet along one do touch. */
  private readonly weld: Uint32Array;

  constructor(
    private readonly positions: Float32Array,
    sourceIndexCount: number,
    options: IClusterDagOptions,
  ) {
    this.settings = resolveOptions(options);
    this.sink = new Uint32Sink(sourceIndexCount * 2);
    this.weld = MeshoptSimplifier.generatePositionRemap(positions, 3);
  }

  build(indices: Uint32Array): IClusterDag {
    let current = this.emit(this.clusterize(indices), 0, 0, null);
    this.levels.push({
      clusterCount: current.length,
      promoted: 0,
      triangleCount: this.triangles(current),
    });

    let stopReason: ClusterDagStop = current.length <= 1 ? "root" : "cap";
    for (let level = 0; current.length > 1 && level < this.settings.maxLevels; level += 1) {
      const previous = this.triangles(current);
      const fold = this.foldLevel(current, level);
      const triangleCount = this.triangles(fold.next);
      this.levels.push({
        clusterCount: fold.next.length,
        promoted: fold.promoted,
        triangleCount,
      });
      current = fold.next;

      if (current.length <= 1) {
        stopReason = "root";
        break;
      }
      if (!fold.simplifiedAny || triangleCount > previous * (1 - MIN_LEVEL_REDUCTION)) {
        stopReason = "stalled";
        break;
      }
    }

    return {
      clusters: this.clusters.map((cluster) => ({ ...cluster })),
      groups: this.groups,
      indices: this.sink.toArray(),
      levels: this.levels,
      roots: current.slice(),
      stopReason,
    };
  }

  private triangles(ids: readonly number[]): number {
    let total = 0;
    for (const id of ids) total += this.cluster(id).count / 3;
    return total;
  }

  private cluster(id: number): IMutableCluster {
    return this.clusters[id] as IMutableCluster;
  }

  private clusterize(source: Uint32Array): ReturnType<typeof MeshoptClusterizer.buildMeshletsFlex> {
    return MeshoptClusterizer.buildMeshletsFlex(
      source,
      this.positions,
      3,
      this.settings.maxVertices,
      this.settings.minTriangles,
      this.settings.maxTriangles,
      this.settings.coneWeight,
    );
  }

  private emit(
    buffers: ReturnType<typeof MeshoptClusterizer.buildMeshletsFlex>,
    level: number,
    error: number,
    sourceSphere: IClusterSphere | null,
  ): number[] {
    const bounds = MeshoptClusterizer.computeMeshletBounds(buffers, this.positions, 3);
    const emitted: number[] = [];
    for (let meshlet = 0; meshlet < buffers.meshletCount; meshlet += 1) {
      const extracted = MeshoptClusterizer.extractMeshlet(buffers, meshlet);
      const start = this.sink.length;
      for (let corner = 0; corner < extracted.triangles.length; corner += 1)
        this.sink.push(extracted.vertices[extracted.triangles[corner] as number] as number);
      const bound = bounds[meshlet] as (typeof bounds)[number];
      const own: IClusterSphere = {
        radius: bound.radius,
        x: bound.centerX,
        y: bound.centerY,
        z: bound.centerZ,
      };
      emitted.push(this.clusters.length);
      this.clusters.push({
        bounds: {
          centerX: bound.centerX,
          centerY: bound.centerY,
          centerZ: bound.centerZ,
          coneAxisX: bound.coneAxisX,
          coneAxisY: bound.coneAxisY,
          coneAxisZ: bound.coneAxisZ,
          coneCutoff: bound.coneCutoff,
          radius: bound.radius,
        },
        count: extracted.triangles.length,
        error,
        group: -1,
        level,
        parentError: Number.POSITIVE_INFINITY,
        parentSphere: own,
        sourceSphere: sourceSphere ?? own,
        start,
      });
    }
    return emitted;
  }

  /** The level's clusters as the partitioner wants them: welded index space, ranges, centres. */
  private partition(current: readonly number[]): number[][] {
    const view = this.sink.view();
    const welded = new Uint32Array(view.length);
    for (let slot = 0; slot < view.length; slot += 1)
      welded[slot] = this.weld[view[slot] as number] as number;

    const ranges = current.map((id) => ({
      count: this.cluster(id).count,
      start: this.cluster(id).start,
    }));
    const centres = new Float32Array(current.length * 3);
    for (let slot = 0; slot < current.length; slot += 1) {
      const bounds = this.cluster(current[slot] as number).bounds;
      centres[slot * 3] = bounds.centerX;
      centres[slot * 3 + 1] = bounds.centerY;
      centres[slot * 3 + 2] = bounds.centerZ;
    }
    return partitionClusters(clusterAdjacency(welded, ranges), {
      centres,
      targetSize: this.settings.groupSize,
    });
  }

  private gather(members: readonly number[]): Uint32Array {
    const view = this.sink.view();
    let size = 0;
    for (const member of members) size += this.cluster(member).count;
    const group = new Uint32Array(size);
    let cursor = 0;
    for (const member of members) {
      const cluster = this.cluster(member);
      group.set(view.subarray(cluster.start, cluster.start + cluster.count), cursor);
      cursor += cluster.count;
    }
    return group;
  }

  /**
   * Simplifies one group and emits its parents, or reports that it would not shrink.
   *
   * A group that refuses to simplify hands its members back unchanged. They carry their own geometry
   * upward and keep `parentError` at infinity until a level that *can* simplify them groups them —
   * dropping them here is what would turn a stalled group into a hole at high thresholds.
   */
  private foldGroup(members: readonly number[], level: number): number[] | null {
    const groupIndices = this.gather(members);
    const target = Math.max(
      3,
      Math.floor((groupIndices.length / 3) * this.settings.simplifyRatio) * 3,
    );
    const [simplified, simplifyError] = MeshoptSimplifier.simplify(
      groupIndices,
      this.positions,
      3,
      target,
      UNBOUNDED_ERROR,
      this.settings.lockFlags,
    );
    if (simplified.length >= groupIndices.length) return null;

    let error = simplifyError;
    let sphere: IClusterSphere = { radius: 0, x: 0, y: 0, z: 0 };
    for (const member of members) {
      const cluster = this.cluster(member);
      error = Math.max(error, cluster.error);
      // Both the child's own extent and the sphere its error was already measured against, so the
      // group's sphere can never be smaller than one its children project through.
      sphere = unite(unite(sphere, cluster.sourceSphere), {
        radius: cluster.bounds.radius,
        x: cluster.bounds.centerX,
        y: cluster.bounds.centerY,
        z: cluster.bounds.centerZ,
      });
    }

    const groupId = this.groups.length;
    for (const member of members) {
      const cluster = this.cluster(member);
      cluster.group = groupId;
      cluster.parentError = error;
      cluster.parentSphere = sphere;
    }
    const parents = this.emit(this.clusterize(simplified), level + 1, error, sphere);
    this.groups.push({ children: [...members], error, level, parents, simplifyError, sphere });
    return parents;
  }

  private foldLevel(current: readonly number[], level: number): ILevelFold {
    const next: number[] = [];
    let promoted = 0;
    let simplifiedAny = false;
    for (const local of this.partition(current)) {
      const members = local.map((slot) => current[slot] as number);
      const parents = this.foldGroup(members, level);
      if (parents === null) {
        next.push(...members);
        promoted += members.length;
        continue;
      }
      simplifiedAny = true;
      next.push(...parents);
    }
    return { next, promoted, simplifiedAny };
  }
}

/**
 * Bakes the cluster DAG.
 *
 * `positions` is the source mesh's vertex buffer and is never modified or extended: every level of
 * the returned DAG indexes it directly.
 */
export async function buildClusterDag(
  indices: Uint32Array,
  positions: Float32Array,
  options: IClusterDagOptions = {},
): Promise<IClusterDag> {
  assertMesh(indices, positions);
  await MeshoptClusterizer.ready;
  await MeshoptSimplifier.ready;
  return new ClusterDagBuilder(positions, indices.length, options).build(indices);
}

/**
 * The cut: every cluster whose own error the threshold covers and whose parent's it does not.
 *
 * This is the rule PRD-282 moves to the CPU and PRD-283 moves to the GPU. It asks a cluster nothing
 * about its neighbours, which is the entire point of recording error per group.
 */
export function selectCut(dag: IClusterDag, threshold: number): number[] {
  const selected: number[] = [];
  for (let cluster = 0; cluster < dag.clusters.length; cluster += 1) {
    const record = dag.clusters[cluster] as IVirtualCluster;
    if (record.error <= threshold && record.parentError > threshold) selected.push(cluster);
  }
  return selected;
}
