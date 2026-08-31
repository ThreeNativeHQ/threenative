import { describe, expect, it } from "vitest";
import {
  clusterAdjacency,
  clusterBoundaryEdges,
  partitionClusters,
} from "../src/virtual/partition.js";

// The partition is the one step `meshoptimizer` does not ship, ported here per PRD-281 §2. It does
// not have to be METIS-quality. It has to be *stable* — the same input gives the same groups on
// every machine, or nothing else in this batch can be A/B'd — and *adjacency-respecting*, because a
// group whose members do not touch has a longer locked rim and simplifies worse.

/** A `width × height` quad grid, triangulated, in one strip of clusters per row. */
function grid(
  width: number,
  height: number,
): {
  indices: Uint32Array;
  ranges: { count: number; start: number }[];
  centres: Float32Array;
} {
  const indices: number[] = [];
  const ranges: { count: number; start: number }[] = [];
  const centres: number[] = [];
  for (let row = 0; row < height; row += 1) {
    const start = indices.length;
    for (let column = 0; column < width; column += 1) {
      const a = row * (width + 1) + column;
      const b = a + 1;
      const c = a + width + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    ranges.push({ count: indices.length - start, start });
    centres.push(width / 2, row + 0.5, 0);
  }
  return { centres: Float32Array.from(centres), indices: Uint32Array.from(indices), ranges };
}

describe("cluster adjacency", () => {
  it("finds only the edges on a cluster's rim", () => {
    const { indices, ranges } = grid(4, 1);
    const boundary = clusterBoundaryEdges(indices, 0, ranges[0]?.count ?? 0);

    // Four quads, eight triangles: four rim edges along the top, four along the bottom, one cap at
    // each end. Every quad's diagonal is used by both of its triangles, so no diagonal is a rim.
    expect(boundary).toHaveLength(4 + 4 + 2);
  });

  it("links the rows that touch and nothing else", () => {
    const { indices, ranges } = grid(4, 3);
    const adjacency = clusterAdjacency(indices, ranges);

    expect(adjacency.neighbours[0]).toEqual([1]);
    expect(adjacency.neighbours[1]).toEqual([0, 2]);
    expect(adjacency.neighbours[2]).toEqual([1]);
    // Four shared edges along a four-quad seam.
    expect(adjacency.weights[0]).toEqual([4]);
  });

  it("reports no neighbours when clusters share no vertices", () => {
    const first = grid(2, 1);
    const second = grid(2, 1);
    const offset = 100;
    const indices = Uint32Array.from([
      ...first.indices,
      ...[...second.indices].map((value) => value + offset),
    ]);
    const ranges = [
      { count: first.indices.length, start: 0 },
      { count: second.indices.length, start: first.indices.length },
    ];
    const adjacency = clusterAdjacency(indices, ranges);

    expect(adjacency.neighbours).toEqual([[], []]);
  });
});

describe("partitionClusters", () => {
  it("groups adjacent clusters and covers every one exactly once", () => {
    const { centres, indices, ranges } = grid(4, 16);
    const groups = partitionClusters(clusterAdjacency(indices, ranges), {
      centres,
      targetSize: 4,
    });

    const seen = groups.flat().sort((a, b) => a - b);
    expect(seen).toEqual([...Array(16).keys()]);
    for (const group of groups) {
      expect(group.length).toBeGreaterThanOrEqual(2);
      // Rows are a chain, so a group of adjacent rows is a run of consecutive indices.
      for (let slot = 1; slot < group.length; slot += 1)
        expect((group[slot] as number) - (group[slot - 1] as number)).toBe(1);
    }
  });

  it("is a pure function of its input — no seed, nothing to disagree about", () => {
    const { centres, indices, ranges } = grid(4, 23);
    const adjacency = clusterAdjacency(indices, ranges);
    const first = partitionClusters(adjacency, { centres, targetSize: 4 });
    const second = partitionClusters(adjacency, { centres, targetSize: 4 });

    expect(second).toEqual(first);
  });

  it("attaches a cluster with no neighbours rather than leaving it alone", () => {
    // A lone cluster is a group whose whole rim is locked, which cannot simplify, which is a level
    // the loop never leaves. Distance closes what adjacency cannot.
    const { centres, indices, ranges } = grid(4, 5);
    const adjacency = {
      neighbours: [[1], [0], [3], [2], []],
      weights: [[4], [4], [4], [4], []],
    };
    void indices;
    void ranges;
    const groups = partitionClusters(adjacency, { centres, targetSize: 4 });

    expect(groups.flat().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    expect(groups.every((group) => group.length >= 2)).toBe(true);
  });

  it("refuses input it cannot partition rather than guessing", () => {
    const { centres, indices, ranges } = grid(4, 3);
    const adjacency = clusterAdjacency(indices, ranges);

    expect(() => partitionClusters(adjacency, { centres, targetSize: 1 })).toThrow(
      /targetSize must be an integer of at least two/,
    );
    expect(() =>
      partitionClusters(adjacency, { centres: new Float32Array(3), targetSize: 4 }),
    ).toThrow(/one centre per cluster/);
  });
});
