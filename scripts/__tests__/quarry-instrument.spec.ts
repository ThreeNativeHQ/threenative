// The quarry is a measuring instrument, so what it measures has to be the same triangles on every
// machine that runs it. These are the checks that make a frame time taken here comparable to one
// taken anywhere else: the geometry hashes, the walk is a function of the frame index, and none of
// the bytes are in git.
//
// It lives under `scripts/` because the root vitest config excludes `examples/**` — the same place
// `engine-load-test.spec.ts` already tests an example's workload from.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BOULDER_INSTANCES,
  BOULDER_SUBDIVISIONS,
  bodyPositionHash,
  boulderPlacements,
  boulderTriangleCount,
  buildBoulder,
  buildCliff,
  buildFloor,
  buildGantry,
  buildGrating,
  cliffTriangleCount,
} from "../../examples/quarry/src/quarry/bodies.js";
import { ROUTE_FRAMES, ROUTE_MARKS, routePose } from "../../examples/quarry/src/quarry/route.js";
import { ValueNoise3D, createLcg, positionHash } from "../../examples/quarry/src/quarry/seed.js";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/**
 * The instrument's identity. A change to any of these is a change to what the quarry measures, and
 * every number recorded against the old hash stops being comparable at that moment — so this is a
 * constant to be updated deliberately, in the same commit as a re-measurement.
 */
const POSITION_HASHES: Readonly<Record<string, string>> = {
  "boulder-0": "5c75d9b8",
  "boulder-1": "1aa259be",
  "boulder-2": "40a1df12",
  "boulder-3": "03509ab6",
  "boulder-4": "3718d474",
  "boulder-5": "1c5833a0",
  cliff: "1eb7ccb8",
  floor: "741b78b0",
  gantry: "d97eb82b",
  grating: "143050cd",
};

/** Every undirected edge, with a signed count of how many triangles wound each way across it. */
function edgeBalance(indices: Uint32Array): Map<string, number> {
  const edges = new Map<string, number>();
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    for (let corner = 0; corner < 3; corner += 1) {
      const from = indices[triangle + corner] as number;
      const to = indices[triangle + ((corner + 1) % 3)] as number;
      const key = from < to ? `${from}_${to}` : `${to}_${from}`;
      edges.set(key, (edges.get(key) ?? 0) + (from < to ? 1 : -1));
    }
  }
  return edges;
}

describe("quarry geometry", () => {
  it("should generate the same triangles on every machine", () => {
    const bodies = [
      buildCliff(),
      buildFloor(),
      buildGantry(),
      buildGrating(),
      ...BOULDER_SUBDIVISIONS.map((_, source) => buildBoulder(source)),
    ];
    const observed = Object.fromEntries(bodies.map((body) => [body.name, bodyPositionHash(body)]));
    expect(observed).toEqual(POSITION_HASHES);
  }, 120_000);

  it("should reject a changed seed rather than quietly measuring a different quarry", () => {
    // The red-green for the hash itself. `ValueNoise3D` is what every body's shape comes from, so
    // one different seed is one different quarry — and without this the constants above could be
    // regenerated from whatever the code happens to produce and prove nothing.
    const positions = new Float32Array(300);
    const fill = (seed: number): Float32Array => {
      const noise = new ValueNoise3D(seed);
      for (let index = 0; index < positions.length; index += 1)
        positions[index] = noise.fractal(index * 0.11, 1.5, 2.5, 4);
      return positions;
    };
    const before = positionHash(fill(90271));
    const after = positionHash(fill(90272));
    expect(before).not.toEqual(after);
  });

  it("should hold the stated triangle counts, because the density is the instrument", () => {
    expect(cliffTriangleCount()).toBe(1_999_200);
    expect(BOULDER_SUBDIVISIONS.map((_, source) => boulderTriangleCount(source))).toEqual([
      151_380, 184_320, 224_720, 269_120, 317_520, 397_620,
    ]);
    // Every boulder source's triangles, times how many instances draw it.
    const placements = boulderPlacements();
    expect(placements).toHaveLength(BOULDER_INSTANCES);
    const submitted = placements.reduce(
      (total, placement) => total + boulderTriangleCount(placement.source),
      0,
    );
    expect(submitted).toBeGreaterThan(90_000_000);
  });

  it("should close every boulder, so a hole on screen is a hole in the cut", () => {
    // PRD-282's "no background pixel through a body that is closed in the source" needs bodies
    // that are closed in the source. A lat-long sphere's seam and poles would hand the cluster
    // baker free boundary edges to lock and hide a real crack behind.
    for (let source = 0; source < BOULDER_SUBDIVISIONS.length; source += 1) {
      const boulder = buildBoulder(source);
      const unbalanced = [...edgeBalance(boulder.indices).values()].filter((count) => count !== 0);
      expect({ source, unbalanced: unbalanced.length }).toEqual({ source, unbalanced: 0 });
    }
  }, 120_000);

  it("should not track a single byte of what it generates", () => {
    const tracked = execFileSync("git", ["ls-files", "examples/quarry"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    })
      .split("\n")
      .filter((line) => /\.(glb|gltf|bin|ktx2|png|jpg)$/iu.test(line));
    expect(tracked).toEqual([]);
  });
});

describe("quarry route", () => {
  it("should be a pure function of the frame index", () => {
    for (const frame of [0, 137, 900, ROUTE_FRAMES]) {
      const first = routePose(frame);
      const second = routePose(frame);
      expect(first).toEqual(second);
    }
  });

  it("should stand where the named marks say it stands", () => {
    // A stated epsilon rather than an exact float: the constants below are what the playtest's
    // `markX/markY/markZ` bands are drawn around, and the two must not be allowed to drift apart.
    const expected: Readonly<Record<string, readonly [number, number, number]>> = {
      approach: [2.205, 1.346, -4.52],
      contact: [1.472, 1.908, -20.217],
      floor: [12.175, 1.42, -2.785],
      rim: [48.887, 12.743, 33.439],
      switchback: [28.101, 4.027, 24.31],
    };
    for (const mark of ROUTE_MARKS) {
      const pose = routePose(mark.frame).position;
      const target = expected[mark.label];
      if (target === undefined) throw new Error(`No expected pose for '${mark.label}'.`);
      for (let axis = 0; axis < 3; axis += 1)
        expect(Math.abs((pose[axis] as number) - (target[axis] as number))).toBeLessThan(0.005);
    }
  });

  it("should refuse a frame index it cannot walk", () => {
    // Fails closed: a negative or fractional frame would otherwise sample somewhere plausible and
    // report a pose for a frame that never happened.
    expect(() => routePose(-1)).toThrow(/non-negative integer/u);
    expect(() => routePose(1.5)).toThrow(/non-negative integer/u);
  });

  it("should draw its randomness from the recurrence it states", () => {
    const random = createLcg(1337);
    // state = (1337 * 1664525 + 1013904223) mod 2^32, divided by 2^32.
    expect(random()).toBeCloseTo(((1337 * 1664525 + 1013904223) % 4294967296) / 4294967296, 12);
    expect(() => createLcg(-1)).toThrow(/32-bit unsigned integer/u);
  });
});
