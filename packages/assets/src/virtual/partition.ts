// Grouping clusters for the DAG bake.
//
// `meshoptimizer` 1.1.1 ships meshlet construction, bounds and boundary-locked simplification, and
// no cluster partitioner: there is no `partitionClusters` in `meshopt_clusterizer.js`, and
// `clusterlod.h` is a C++ demo header the JavaScript package cannot reach. PRD-281 §2 takes the
// first of its three escapes and ports the partition to TypeScript.
//
// It does not have to be METIS-quality. A worse partition costs simplification quality, which is
// measured; it does not cost correctness, which is not negotiable. What it does have to be is
// *stable* — the same input must produce the same groups on every machine, or the bake is not
// deterministic and no A/B in this batch means anything — and *adjacency-respecting*, because a
// group whose members do not touch has a longer locked boundary and simplifies worse.

export interface IClusterAdjacency {
  /** For each cluster, the neighbour indices it shares at least one boundary edge with. */
  readonly neighbours: readonly (readonly number[])[];
  /** Shared boundary-edge counts, aligned with `neighbours`. */
  readonly weights: readonly (readonly number[])[];
}

/**
 * Undirected edge key. Vertices are welded by position before the DAG is built, so two clusters
 * that meet along a seam share the same vertex indices and are found here.
 */
function edgeKey(a: number, b: number): number {
  // Packed into one double rather than a string: this runs over every edge of every cluster of a
  // multi-million-triangle body, and string keys made the bake minutes longer for nothing.
  return a < b ? a * 4294967296 + b : b * 4294967296 + a;
}

/**
 * The edges on a cluster's rim: those used by exactly one of its triangles.
 *
 * An edge used twice inside the cluster is interior and can never be shared with a neighbour.
 */
export function clusterBoundaryEdges(indices: Uint32Array, start: number, count: number): number[] {
  const seen = new Map<number, number>();
  for (let offset = start; offset < start + count; offset += 3) {
    for (let corner = 0; corner < 3; corner += 1) {
      const key = edgeKey(
        indices[offset + corner] as number,
        indices[offset + ((corner + 1) % 3)] as number,
      );
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  const boundary: number[] = [];
  for (const [key, uses] of seen) if (uses === 1) boundary.push(key);
  return boundary;
}

/** Which clusters touch which, and along how many edges. */
export function clusterAdjacency(
  indices: Uint32Array,
  ranges: readonly { readonly count: number; readonly start: number }[],
): IClusterAdjacency {
  const owners = new Map<number, number[]>();
  const boundaries: number[][] = [];
  for (let cluster = 0; cluster < ranges.length; cluster += 1) {
    const range = ranges[cluster] as { count: number; start: number };
    const boundary = clusterBoundaryEdges(indices, range.start, range.count);
    boundaries.push(boundary);
    for (const key of boundary) {
      const list = owners.get(key);
      if (list === undefined) owners.set(key, [cluster]);
      else list.push(cluster);
    }
  }

  const neighbours: number[][] = ranges.map(() => []);
  const weights: number[][] = ranges.map(() => []);
  const index: Map<number, number>[] = ranges.map(() => new Map<number, number>());
  for (let cluster = 0; cluster < boundaries.length; cluster += 1) {
    for (const key of boundaries[cluster] as number[]) {
      for (const other of owners.get(key) ?? []) {
        if (other === cluster) continue;
        const slot = (index[cluster] as Map<number, number>).get(other);
        if (slot === undefined) {
          (index[cluster] as Map<number, number>).set(
            other,
            (neighbours[cluster] as number[]).length,
          );
          (neighbours[cluster] as number[]).push(other);
          (weights[cluster] as number[]).push(1);
        } else {
          const list = weights[cluster] as number[];
          list[slot] = (list[slot] as number) + 1;
        }
      }
    }
  }
  return { neighbours, weights };
}

export interface IPartitionOptions {
  /** Cluster bounding-sphere centres, three floats each. Used only when adjacency runs out. */
  readonly centres: Float32Array;
  readonly targetSize: number;
}

/**
 * Groups clusters into runs of about `targetSize`, preferring the neighbour that shares the most
 * boundary with the group so far.
 *
 * Ties break on the lower cluster index and the seed is always the lowest ungrouped cluster, so the
 * result is a pure function of the input — there is no randomness to seed and none to disagree
 * about. Clusters that run out of adjacent neighbours are attached to the nearest group by centre
 * distance rather than left alone: a lone cluster is a group whose whole rim is locked, which
 * cannot simplify, and a level that cannot simplify is a level the loop never leaves.
 */
export function partitionClusters(
  adjacency: IClusterAdjacency,
  options: IPartitionOptions,
): number[][] {
  const clusterCount = adjacency.neighbours.length;
  if (!Number.isInteger(options.targetSize) || options.targetSize < 2)
    throw new Error("partitionClusters targetSize must be an integer of at least two.");
  if (options.centres.length !== clusterCount * 3)
    throw new Error(
      `partitionClusters needs one centre per cluster: ${options.centres.length / 3} centres for ${clusterCount} clusters.`,
    );

  const groupOf = new Int32Array(clusterCount).fill(-1);
  const groups: number[][] = [];

  for (let seed = 0; seed < clusterCount; seed += 1) {
    if (groupOf[seed] !== -1) continue;
    const group = [seed];
    groupOf[seed] = groups.length;
    // Shared-boundary weight from the growing group to each candidate outside it.
    const candidates = new Map<number, number>();
    const offer = (member: number): void => {
      const neighbours = adjacency.neighbours[member] as readonly number[];
      const weights = adjacency.weights[member] as readonly number[];
      for (let slot = 0; slot < neighbours.length; slot += 1) {
        const other = neighbours[slot] as number;
        if (groupOf[other] !== -1) continue;
        candidates.set(other, (candidates.get(other) ?? 0) + (weights[slot] as number));
      }
    };
    offer(seed);
    while (group.length < options.targetSize && candidates.size > 0) {
      let best = -1;
      let bestWeight = -1;
      for (const [candidate, weight] of candidates) {
        if (weight > bestWeight || (weight === bestWeight && candidate < best)) {
          best = candidate;
          bestWeight = weight;
        }
      }
      candidates.delete(best);
      if (groupOf[best] !== -1) continue;
      groupOf[best] = groups.length;
      group.push(best);
      offer(best);
    }
    groups.push(group);
  }

  return mergeUndersizedGroups(groups, groupOf, options);
}

/**
 * Folds groups that came out far below target into their nearest neighbour group.
 *
 * The greedy walk above leaves stragglers wherever it painted itself into a corner, and on a body
 * of disconnected shells it leaves one group per shell with no adjacency between them at all. Both
 * cases stall the level loop, so distance closes what adjacency cannot — a group of two shells
 * that do not touch has no shared boundary to lock, which is not a correctness problem, only a
 * missed opportunity to simplify across a seam that was never there.
 */
function mergeUndersizedGroups(
  groups: number[][],
  groupOf: Int32Array,
  options: IPartitionOptions,
): number[][] {
  if (groups.length < 2) return groups;
  const half = Math.max(1, Math.floor(options.targetSize / 2));
  const centre = (group: readonly number[]): [number, number, number] => {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const cluster of group) {
      x += options.centres[cluster * 3] as number;
      y += options.centres[cluster * 3 + 1] as number;
      z += options.centres[cluster * 3 + 2] as number;
    }
    return [x / group.length, y / group.length, z / group.length];
  };
  const centres = groups.map(centre);
  const merged: (number[] | undefined)[] = groups.map((group) => [...group]);

  for (let index = 0; index < merged.length; index += 1) {
    const group = merged[index];
    if (group === undefined || group.length >= half) continue;
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let other = 0; other < merged.length; other += 1) {
      const candidate = merged[other];
      if (other === index || candidate === undefined) continue;
      if (candidate.length + group.length > options.targetSize * 2) continue;
      const [ax, ay, az] = centres[index] as [number, number, number];
      const [bx, by, bz] = centres[other] as [number, number, number];
      const distance = (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2;
      if (distance < bestDistance || (distance === bestDistance && other < best)) {
        best = other;
        bestDistance = distance;
      }
    }
    if (best === -1) continue;
    (merged[best] as number[]).push(...group);
    merged[index] = undefined;
  }

  const result = merged.filter((group): group is number[] => group !== undefined);
  for (let index = 0; index < result.length; index += 1)
    for (const cluster of result[index] as number[]) groupOf[cluster] = index;
  // Sorted so the group order is a function of the clusters in it rather than of the merge order.
  for (const group of result) group.sort((a, b) => a - b);
  return result;
}
