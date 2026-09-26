import { describe, expect, it } from "vitest";
import {
  type ICullFixture,
  type ICullMeshChannels,
  type ICullTopology,
  cullMeshBufferBytes,
  cullMeshChannels,
  cullProbe,
  cullRenderedTimeAccum,
  cullTransform,
  cullVariant,
} from "../../examples/engine-load-test/src/cull-fixture.js";
import { cullCapture } from "../../examples/engine-load-test/src/cull-harness.js";
import { sha256 } from "../../examples/engine-load-test/src/identity.js";
import { type ICullRun, compareCullRuns, parseCullRun } from "../engine-load-test/cull-compare.js";

const ADAPTER = { name: "NVIDIA GeForce RTX 2080", type: "hardware" };
const FIXTURE_HASH = "1283daf331d11e21ba0ec1697d2aa712fb4ce90258d7bdaa9fdfe8e2cca4c5f6";
const CADENCE_MS = 1000 / 60;

/** A frame series the host's 60 Hz loop does not quantize: real work, so a mean can carry a ratio. */
function uncapped(count: number, intervalMs: number): Record<string, unknown> {
  const boundaries = [{ frameId: 0, monotonicMs: 0 }];
  for (let frameId = 1; frameId <= count; frameId += 1)
    boundaries.push({ frameId, monotonicMs: intervalMs * frameId });
  return {
    boundaries,
    finalCompletionMs: intervalMs * count,
    schemaVersion: 1,
    unit: "ms",
  };
}

/** The competitor's own shape: the frame intervals as it recorded them. */
function intervals(count: number, intervalMs: number): Record<string, unknown> {
  return { frameIntervalMs: Array.from({ length: count + 1 }, (_, index) => index * intervalMs) };
}

/** One captured frame: `null` changed pixels is the first frame, `0` is an unchanged later one. */
function captures(changed: (number | null)[], coveredFraction = 0.0878): unknown[] {
  return changed.map((value, frameId) => ({
    backgroundLuma: 0,
    changedPixels: value,
    coveredFraction,
    frameId,
    meanLuma: 0.0689,
    name: "frame",
    scored: true,
  }));
}

const KINDS = ["BoxMesh", "SphereMesh", "CapsuleMesh", "CylinderMesh", "PrismMesh"] as const;

/** Triangles, indices and vertices per kind, as each arm's own record counted them. */
const RETAINED_GODOT = [
  [12, 36, 24],
  [4224, 12672, 2210],
  [3456, 10368, 1950],
  [768, 2304, 522],
  [8, 24, 20],
];
const RETAINED_TN = [
  [12, 36, 24],
  [3968, 11904, 2145],
  [2176, 6528, 1170],
  [256, 768, 388],
  [12, 36, 22],
];

/**
 * The retained records carried no buffer identity at all, so the test synthesises one digest per
 * kind from the counts that arm really reported: the box agrees, because the two arms reported the
 * same 12/36/24, and the other four disagree, because they reported different geometry. The
 * comparator's refusal of those four is therefore the same refusal it makes on the real bytes.
 */
function retainedDigest(kind: string, counts: readonly number[]): string {
  const seed = `${kind}:${counts.join("/")}`;
  let digest = "";
  for (let index = 0; digest.length < 64; index += 1)
    digest += seed
      .charCodeAt(index % seed.length)
      .toString(16)
      .padStart(2, "0");
  return digest.slice(0, 64);
}

/** The retained `basic_cull` pair: Godot's buffers, coverage and wall metric against the TN arm's. */
function retained(): { godot: ICullRun; tn: ICullRun } {
  return {
    godot: parse({
      captures: captures([null, 0], 0.0878086419753086),
      drain: "none-available",
      meanMs: 1.06874166666667,
      topology: KINDS.map((kind, index) => ({
        albedo: [0, 0, 0],
        bufferSha256: retainedDigest(kind, RETAINED_GODOT[index] as readonly number[]),
        indices: RETAINED_GODOT[index]?.[1],
        kind,
        triangles: RETAINED_GODOT[index]?.[0],
        vertices: RETAINED_GODOT[index]?.[2],
      })),
    }),
    tn: parse({
      arm: "tn-desktop",
      authoring: "scene-node-independent",
      captures: captures([null, 0], 0.11018518518518519),
      // The counterpart arm states its boundary completion in the series, not in a `drain` field.
      drain: undefined,
      frameIntervalMs: undefined,
      meanMs: 19.448460955,
      rawSeries: uncapped(2, 19.448460955),
      topology: KINDS.map((kind, index) => ({
        albedo: [0, 0, 0],
        bufferSha256: retainedDigest(kind, RETAINED_TN[index] as readonly number[]),
        counterpartIndices: RETAINED_GODOT[index]?.[1],
        counterpartTriangles: RETAINED_GODOT[index]?.[0],
        counterpartVertices: RETAINED_GODOT[index]?.[2],
        kind,
        tnIndices: RETAINED_TN[index]?.[1],
        tnTriangles: RETAINED_TN[index]?.[0],
        tnVertices: RETAINED_TN[index]?.[2],
      })),
    }),
  };
}

function state(frameId: number): unknown {
  return {
    frameId,
    probes: [
      { axisX: [1, 0, 0], index: 0, origin: [266.238, 32.311, -35.796] },
      { axisX: [1, 0, 0], index: 4999, origin: [34.757, -77.748, -150.044] },
      { axisX: [1, 0, 0], index: 9999, origin: [-19.053, -47.31, -88.02] },
    ],
    timeAccum: 0,
  };
}

function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    adapter: ADAPTER,
    arm: "godot-desktop",
    authoring: "rendering-server-rid",
    captures: captures([null, 0]),
    // The wall metric's semantics, declared the way a record without a completion timestamp must.
    // One arm pacing on submission and the other draining at the boundary are different metrics.
    drain: "measurement-boundary-completion",
    dynamic: { enabled: false, rotate: false, rids: 0, target: "none" },
    family: "godot-culling",
    frameIntervalMs: [0, 1.066],
    fixture: {
      hash: FIXTURE_HASH,
      objects: 10000,
      viewport: { height: 1080, width: 1920 },
    },
    lights: { directional: 0, omni: 0, requested: 0, spot: 0 },
    meanMs: 1.066,
    profile: "smoke",
    states: [state(0)],
    topology: KINDS.map((kind, index) => {
      const counts = [12, 36, 24 + index];
      return {
        albedo: [0, 0, 0],
        bufferSha256: retainedDigest(kind, counts),
        counterpartIndices: 36,
        counterpartTriangles: 12,
        counterpartVertices: 24 + index,
        kind,
        tnIndices: 36,
        tnTriangles: 12,
        tnVertices: 24 + index,
      };
    }),
    unshaded: true,
    variant: "basic_cull",
    ...overrides,
  };
}

function parse(overrides: Record<string, unknown> = {}): ICullRun {
  return parseCullRun(run(overrides));
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk =
      ((bytes[index] as number) << 16) |
      (((bytes[index + 1] as number) ?? 0) << 8) |
      ((bytes[index + 2] as number) ?? 0);
    out += BASE64_ALPHABET[(chunk >> 18) & 63];
    out += BASE64_ALPHABET[(chunk >> 12) & 63];
    out += index + 1 < bytes.length ? BASE64_ALPHABET[(chunk >> 6) & 63] : "=";
    out += index + 2 < bytes.length ? BASE64_ALPHABET[chunk & 63] : "=";
  }
  return out;
}

/**
 * A real primitive's four channels — `vertices` vertices, a triangle list, the same shape the pinned
 * scene's `get_mesh_arrays()` produced — plus the SHA-256 of the canonical stream
 * `cullMeshBufferBytes` lays down, which is the identity both arms record. `moved` shifts one
 * interior vertex component or retargets one interior index, so the counts cannot see it.
 */
async function primitive(
  kind: string,
  vertices: number,
  moved: { vertexComponent?: number; index?: number } = {},
): Promise<{ digest: string; topology: ICullTopology }> {
  const positions = new Float32Array(vertices * 3);
  for (let index = 0; index < vertices; index += 1) {
    positions[index * 3] = index / 3;
    positions[index * 3 + 1] = index / 7;
    positions[index * 3 + 2] = -(index / 5);
  }
  if (moved.vertexComponent !== undefined)
    positions[moved.vertexComponent] = (positions[moved.vertexComponent] as number) + 1;
  const normals = new Float32Array(vertices * 3).fill(1 / Math.sqrt(3));
  const uvs = new Float32Array(vertices * 2);
  for (let index = 0; index < vertices; index += 1) uvs[index * 2] = index / vertices;
  const indices = new Uint32Array((vertices / 3) * 3);
  for (let index = 0; index < indices.length; index += 1) indices[index] = index % vertices;
  if (moved.index !== undefined) indices[moved.index] = (indices[moved.index] as number) + 1;
  const channels: ICullMeshChannels = { indices, normals, positions, uvs };
  const counts = { indices: indices.length, kind, vertices };
  const raw = (view: Float32Array | Uint32Array): Uint8Array =>
    new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const topology = {
    aabb: { min: [0, 0, 0], size: [1, 1, 1] },
    albedo: [0, 0, 0],
    bufferSha256: await sha256(cullMeshBufferBytes(counts, channels)),
    buffers: {
      indices: toBase64(raw(indices)),
      normals: toBase64(raw(normals)),
      positions: toBase64(raw(positions)),
      uvs: toBase64(raw(uvs)),
    },
    indices: indices.length,
    kind,
    triangles: indices.length / 3,
    vertices,
  } as ICullTopology;
  // The fixture's own reader accepts both shapes, so the rejection below cannot be the length or
  // range check standing in for the identity check.
  expect(cullMeshChannels(topology).positions).toHaveLength(vertices * 3);
  return { digest: topology.bufferSha256, topology };
}

describe("PRD-449 godot-culling smoke comparison", () => {
  it("refuses the retained pair's mismatched primitives instead of qualifying it", () => {
    // The retained `basic_cull` pair, at the detail that made the previous report green: Godot and
    // TN did not render the same sphere, capsule, cylinder or prism, so a mean over 3.44 M and
    // 4.59 M source triangles is not a comparison of the same work. PRD-449 §6.1 wants exact mesh
    // and index buffers, so the count differences are the failure, not a stated difference.
    const comparison = compareCullRuns(retained().tn, retained().godot);
    expect(comparison.outcome.valid).toBe(false);
    expect(comparison.outcome.comparability).toBe("non-comparable");
    expect(comparison.ratio).toBeNull();
    expect(comparison.outcome.problems.map((problem) => problem.split(":")[0])).toEqual([
      // The same four kinds, refused twice: once because their whole buffer digests differ and once
      // because the counts that differ are named.
      "TN_BENCH_CULL_BUFFER_HASH_MISMATCH",
      "TN_BENCH_CULL_TOPOLOGY_MISMATCH",
      "TN_BENCH_CULL_BUFFER_HASH_MISMATCH",
      "TN_BENCH_CULL_TOPOLOGY_MISMATCH",
      "TN_BENCH_CULL_BUFFER_HASH_MISMATCH",
      "TN_BENCH_CULL_TOPOLOGY_MISMATCH",
      "TN_BENCH_CULL_BUFFER_HASH_MISMATCH",
      "TN_BENCH_CULL_TOPOLOGY_MISMATCH",
      "TN_BENCH_CULL_COVERAGE_DIVERGED",
      "TN_BENCH_CULL_COVERAGE_DIVERGED",
      "TN_BENCH_CULL_WALL_SEMANTICS_MISMATCH",
    ]);
    // The buffer gate accuses exactly the four kinds whose counts differ, and never the box.
    expect(
      comparison.outcome.problems
        .filter((problem) => problem.startsWith("TN_BENCH_CULL_BUFFER_HASH_MISMATCH"))
        .map((problem) => problem.replace("TN_BENCH_CULL_BUFFER_HASH_MISMATCH:", "").split(" ")[0]),
    ).toEqual(["SphereMesh", "CapsuleMesh", "CylinderMesh", "PrismMesh"]);
    expect(
      comparison.outcome.problems.filter((problem) => problem.includes("TOPOLOGY_MISMATCH")),
    ).toEqual([
      "TN_BENCH_CULL_TOPOLOGY_MISMATCH:SphereMesh triangles 4224/3968 indices 12672/11904 vertices 2210/2145",
      "TN_BENCH_CULL_TOPOLOGY_MISMATCH:CapsuleMesh triangles 3456/2176 indices 10368/6528 vertices 1950/1170",
      "TN_BENCH_CULL_TOPOLOGY_MISMATCH:CylinderMesh triangles 768/256 indices 2304/768 vertices 522/388",
      "TN_BENCH_CULL_TOPOLOGY_MISMATCH:PrismMesh triangles 8/12 indices 24/36 vertices 20/22",
    ]);
  });

  it("refuses a kind, a scored frame or a probe that only one arm observed", () => {
    const missingKind = compareCullRuns(
      parse({ arm: "tn-desktop" }),
      parse({
        topology: (run().topology as { kind: string }[]).map((entry, index) =>
          index === 4 ? { ...entry, kind: "Prism" } : entry,
        ),
      }),
    );
    expect(missingKind.outcome.problems).toContain("TN_BENCH_CULL_TOPOLOGY_KIND_MISSING:PrismMesh");
    expect(missingKind.ratio).toBeNull();
    const missingCoverage = compareCullRuns(
      parse({ arm: "tn-desktop", captures: captures([null, 0, 0]) }),
      parse(),
    );
    expect(missingCoverage.outcome.problems).toContain("TN_BENCH_CULL_COVERAGE_FRAME_MISSING:2");
    const missingProbe = compareCullRuns(
      parse({
        arm: "tn-desktop",
        states: [
          {
            frameId: 0,
            probes: [{ axisX: [1, 0, 0], index: 0, origin: [266.238, 32.311, -35.796] }],
            timeAccum: 0,
          },
        ],
      }),
      parse(),
    );
    expect(missingProbe.outcome.problems).toEqual([
      "TN_BENCH_CULL_STATE_PROBE_MISSING:4999",
      "TN_BENCH_CULL_STATE_PROBE_MISSING:9999",
    ]);
    // A frame only one arm sampled is not a frame both rendered.
    expect(
      compareCullRuns(parse({ arm: "tn-desktop" }), parse({ states: [state(0), state(1)] })).outcome
        .problems,
    ).toContain("TN_BENCH_CULL_STATE_FRAME_MISSING:1");
  });

  it("refuses a ratio between two wall metrics that do not measure the same thing", () => {
    // Godot's own record says `drain: none-available`, so its mean paces on submission while the
    // counterpart's drains once at the boundary. The two means are both real; their ratio is not.
    const paced = compareCullRuns(
      parse({ arm: "tn-desktop", drain: "none-available", meanMs: 19.448 }),
      parse(),
    );
    expect(paced.outcome.valid).toBe(false);
    expect(paced.ratio).toBeNull();
    expect(paced.outcome.problems).toContain(
      "TN_BENCH_CULL_WALL_SEMANTICS_MISMATCH:drain:none-available/drain:measurement-boundary-completion",
    );
    // A record that declares neither a drain nor a completion timestamp has no stated metric.
    expect(
      compareCullRuns(parse({ drain: undefined }), parse()).outcome.problems.join(" "),
    ).toMatch(/_TN_WALL_SEMANTICS_UNDECLARED/);
    // The derived shape still works: a boundary completion timestamp is the same statement.
    expect(
      compareCullRuns(
        parse({ arm: "tn-desktop", drain: undefined, rawSeries: uncapped(2, 20) }),
        parse(),
      ).outcome.problems,
    ).toEqual([]);
  });

  it("pairs two runs of the same fixture and reports the godot-over-tn mean ratio", () => {
    const comparison = compareCullRuns(
      parse({ arm: "tn-desktop", authoring: "scene-node-independent", meanMs: 35.336 }),
      parse(),
    );
    expect(comparison.outcome.valid).toBe(true);
    expect(comparison.outcome.comparability).toBe("qualified");
    expect(comparison.ratio?.ratio).toBeCloseTo(1.066 / 35.336, 5);
    expect(comparison.conformance.fixtureHashEqual).toBe(true);
    expect(comparison.conformance.sampledFrames).toBe(1);
    expect(comparison.coverage).toHaveLength(2);
    // RID authoring against scene nodes is a stated difference, not a disclaimer.
    expect(comparison.outcome.comparabilityReasons.join(" ")).toMatch(/RenderingServer/);
  });

  it("refuses a pair whose fixture bytes differ", () => {
    const comparison = compareCullRuns(
      parse({
        arm: "tn-desktop",
        fixture: { hash: "0".repeat(64), objects: 10000, viewport: { height: 1080, width: 1920 } },
      }),
      parse(),
    );
    expect(comparison.outcome.valid).toBe(false);
    expect(comparison.outcome.comparability).toBe("non-comparable");
    expect(comparison.outcome.problems).toContain("TN_BENCH_CULL_FIXTURE_MISMATCH");
  });

  it("refuses a pair whose sampled state moved apart past the declared tolerance", () => {
    const moved = parse();
    const comparison = compareCullRuns(
      parse({
        arm: "tn-desktop",
        states: [
          {
            frameId: 0,
            probes: [
              { axisX: [1, 0, 0], index: 0, origin: [266.24, 32.311, -35.796] },
              { axisX: [1, 0, 0], index: 4999, origin: [34.757, -77.748, -150.044] },
              { axisX: [1, 0, 0], index: 9999, origin: [-19.053, -47.31, -88.02] },
            ],
            timeAccum: 0,
          },
        ],
      }),
      moved,
    );
    expect(comparison.outcome.problems).toContain("TN_BENCH_CULL_STATE_OUT_OF_TOLERANCE");
    // A sub-millimetre float32 rounding difference is inside the declared tolerance and stays valid.
    expect(compareCullRuns(moved, moved).conformance.withinTolerance).toBe(true);
  });

  it("refuses a static workload whose frames moved, and a motion observation that is missing", () => {
    const tn = parse({ arm: "tn-desktop" });
    expect(
      compareCullRuns(tn, parse({ captures: captures([null, 41]) })).outcome.problems,
    ).toContain("TN_BENCH_CULL_MOTION_MISMATCH");
    expect(
      compareCullRuns(parse({ arm: "tn-desktop", captures: captures([null]) }), parse()).outcome
        .problems,
    ).toContain("TN_BENCH_CULL_CAPTURE_MOTION_UNOBSERVED");
  });

  it("refuses an arm whose frame intervals are the host's 60 Hz present cadence rather than its work", () => {
    // 574 of 600 frames on one tick is the real shape of a capped native run, and its mean moves
    // with how many frames spilled past the tick, not with the workload.
    const capped = Array.from({ length: 601 }, (_, index) => ({
      frameId: index,
      monotonicMs: index * CADENCE_MS,
    }));
    const comparison = compareCullRuns(
      parse({
        arm: "tn-desktop",
        frameIntervalMs: undefined,
        rawSeries: {
          boundaries: capped,
          finalCompletionMs: CADENCE_MS * 600,
          schemaVersion: 1,
          unit: "ms",
        },
      }),
      parse(),
    );
    expect(comparison.outcome.valid).toBe(false);
    expect(comparison.outcome.comparability).toBe("non-comparable");
    expect(comparison.outcome.problems[0]).toMatch(/^TN_BENCH_CULL_TN_CADENCE_CAPPED:600\/600/);
    // The same series on the competitor's side is the same accusation.
    expect(
      compareCullRuns(
        parse(),
        parse({ frameIntervalMs: Array.from({ length: 600 }, () => CADENCE_MS) }),
      ).outcome.problems[0],
    ).toMatch(/^TN_BENCH_CULL_GODOT_CADENCE_CAPPED/);
  });

  it("does not call an uncapped arm cadence-bound because its work costs about one tick", () => {
    // The 10,000-mesh `basic_cull` run on the rebuilt host: 600 measured frames at an 18.011 ms
    // completed-work mean, p01 14.637 and p99 28.145, with the frames under 20 ms spread from 13.862
    // to 19.946 rather than sitting on 16.667. Two thirds of them are still within 2 ms of the tick,
    // so the old proximity rule read this real work as a blocked present.
    const intervals = Array.from({ length: 600 }, (_, index) => 13.9 + (index % 61) * 0.1);
    const near = intervals.filter((value) => Math.abs(value - CADENCE_MS) < 2).length;
    expect(near / intervals.length).toBeGreaterThan(0.5);
    const boundaries = [{ frameId: 0, monotonicMs: 0 }];
    let elapsed = 0;
    for (const interval of intervals) {
      elapsed += interval;
      boundaries.push({ frameId: boundaries.length, monotonicMs: elapsed });
    }
    const comparison = compareCullRuns(
      parse({
        arm: "tn-desktop",
        frameIntervalMs: undefined,
        meanMs: 18.011,
        rawSeries: { boundaries, finalCompletionMs: elapsed, schemaVersion: 1, unit: "ms" },
      }),
      parse(),
    );
    expect(comparison.outcome.problems.join(" ")).not.toMatch(/CADENCE_CAPPED/);
    // A genuinely blocked present still is refused, so the relaxation is not the gate's removal.
    expect(
      compareCullRuns(
        parse({
          arm: "tn-desktop",
          frameIntervalMs: undefined,
          rawSeries: uncapped(600, CADENCE_MS),
        }),
        parse(),
      ).outcome.problems[0],
    ).toMatch(/^TN_BENCH_CULL_TN_CADENCE_CAPPED/);
  });

  it("refuses a record with no frame-level series to read a mean from", () => {
    expect(() =>
      parseCullRun({ ...run(), frameIntervalMs: undefined, rawSeries: undefined }),
    ).toThrow(/TN_BENCH_CULL_RUN_MALFORMED/);
    // The counterpart arm's own shape: `N+1` increasing boundaries for `N` frames.
    expect(
      parse({ frameIntervalMs: undefined, rawSeries: uncapped(4, 20) }).frameIntervals,
    ).toEqual([20, 20, 20, 20]);
  });

  it("refuses a record that measured no mesh buffers, rather than comparing absent counts as zero", () => {
    const topology = KINDS.map((kind) => ({ albedo: [0, 0, 0], kind }));
    expect(() => parseCullRun({ ...run(), topology })).toThrow(/TN_BENCH_CULL_RUN_MALFORMED/);
    // Counts without a buffer identity are still a record that measured no whole buffer.
    const counted = KINDS.map((kind, index) => ({
      albedo: [0, 0, 0],
      indices: 36,
      kind,
      triangles: 12,
      vertices: 24 + index,
    }));
    expect(() => parseCullRun({ ...run(), topology: counted })).toThrow(
      /TN_BENCH_CULL_RUN_MALFORMED/,
    );
    expect(() =>
      parseCullRun({
        ...run(),
        topology: counted.map((entry) => ({ ...entry, bufferSha256: "not-a-digest" })),
      }),
    ).toThrow(/TN_BENCH_CULL_RUN_MALFORMED/);
  });

  it("refuses a pair whose middle vertex or middle index moved, with every count identical", async () => {
    // The defect this closes: the previous comparator compared triangle, index and vertex counts, so
    // a sphere re-tessellated into the same number of triangles passed as the same sphere. Both
    // shapes here are 24 vertices, 36 indices and 12 triangles for all five kinds; one middle
    // vertex's y component and one middle index do not, and only the per-mesh digest sees them.
    const untouched = await Promise.all(KINDS.map((kind) => primitive(kind, 24)));
    const altered = await Promise.all(
      KINDS.map((kind, index) =>
        primitive(
          kind,
          24,
          index === 1 ? { vertexComponent: 24 * 3 - 2 } : index === 2 ? { index: 17 } : {},
        ),
      ),
    );
    // The counts really are identical, so nothing but the identity can be what refuses this.
    expect(altered.map((entry, index) => entry.topology.triangles)).toEqual(
      untouched.map((entry) => entry.topology.triangles),
    );
    expect(altered.map((entry, index) => entry.topology.indices)).toEqual(
      untouched.map((entry) => entry.topology.indices),
    );
    expect(altered.map((entry, index) => entry.topology.vertices)).toEqual(
      untouched.map((entry) => entry.topology.vertices),
    );
    expect(altered[1]?.digest).not.toBe(untouched[1]?.digest);
    expect(altered[2]?.digest).not.toBe(untouched[2]?.digest);
    expect(altered[0]?.digest).toBe(untouched[0]?.digest);

    const topologyOf = (entries: { topology: ICullTopology }[]): unknown[] =>
      entries.map((entry) => ({
        albedo: [0, 0, 0],
        bufferSha256: entry.topology.bufferSha256,
        indices: entry.topology.indices,
        kind: entry.topology.kind,
        triangles: entry.topology.triangles,
        vertices: entry.topology.vertices,
      }));
    const comparison = compareCullRuns(
      parse({ arm: "tn-desktop", topology: topologyOf(altered) }),
      parse({ topology: topologyOf(untouched) }),
    );
    expect(comparison.outcome.valid).toBe(false);
    expect(comparison.outcome.comparability).toBe("non-comparable");
    expect(comparison.ratio).toBeNull();
    expect(comparison.conformance.bufferHashesEqual).toBe(false);
    expect(
      comparison.outcome.problems
        .filter((problem) => problem.startsWith("TN_BENCH_CULL_BUFFER_HASH_MISMATCH"))
        .map((problem) => problem.replace("TN_BENCH_CULL_BUFFER_HASH_MISMATCH:", "").split(" ")[0]),
    ).toEqual(["SphereMesh", "CapsuleMesh"]);
    // The three untouched kinds are not accused, and no count-based problem is invented.
    expect(comparison.outcome.problems).not.toContain(
      expect.stringContaining("TN_BENCH_CULL_TOPOLOGY_MISMATCH"),
    );
    // Identical bytes on both sides are the only shape that passes this gate.
    const agreeing = compareCullRuns(
      parse({ arm: "tn-desktop", topology: topologyOf(untouched) }),
      parse({ topology: topologyOf(untouched) }),
    );
    expect(agreeing.conformance.bufferHashesEqual).toBe(true);
    expect(agreeing.outcome.valid).toBe(true);
    expect(agreeing.outcome.comparability).toBe("qualified");
  });

  it("refuses a record that is not this family's, or whose first capture is not a null difference", () => {
    expect(() => parseCullRun(run({ family: "bevy-city" }))).toThrow(/TN_BENCH_CULL_RUN_MALFORMED/);
    expect(() => parseCullRun(run({ variant: "not_a_variant" }))).toThrow(
      /TN_BENCH_CULL_RUN_MALFORMED/,
    );
    expect(() => parseCullRun(run({ meanMs: 0 }))).toThrow(/TN_BENCH_CULL_RUN_MALFORMED/);
    // `-1` is the sentinel the capture used to emit; `null` is the absent difference it must emit.
    expect(() => parseCullRun(run({ captures: captures([-1, 0]) }))).toThrow(
      /TN_BENCH_CULL_RUN_MALFORMED/,
    );
  });
});

describe("PRD-449 godot-culling workload clock", () => {
  it("renders frame k one clock advance in, because the pinned loop advances before it renders", () => {
    // The real dynamic_cull pair: with the counterpart arm's frame k at clock k the two arms' frame
    // 0 disagreed by one advance (0.13 m of displacement) and the transform oracle rejected a pair
    // that was in fact rendering the same frames.
    expect(cullRenderedTimeAccum(0)).toBeCloseTo((1 / 60) * 4, 12);
    expect(cullRenderedTimeAccum(599)).toBeCloseTo(600 * ((1 / 60) * 4), 12);
    // The oracle reads only the two placement sets, so the fixture is the shape it needs rather than
    // 10,000 exported placements this test would have to invent.
    const fixture = {
      lights: {
        placements: [
          [1, 2, 3],
          [4, 5, 6],
        ],
      },
      objects: 10000,
      placements: Array.from({ length: 10000 }, (_, index) => [index, index + 0.5, -index]),
    } as unknown as ICullFixture;
    const moving = cullProbe(fixture, cullVariant("dynamic_cull"), 0, 0);
    const closed = cullTransform(
      fixture.placements[0] as readonly number[],
      0,
      fixture.objects,
      cullRenderedTimeAccum(0),
      false,
    );
    expect(moving.origin).toEqual(closed.origin);
    // A static variant's objects are reported where they were authored, which is what makes the
    // basic_cull pair's zero displacement a real observation rather than two idle frames.
    const still = cullProbe(fixture, cullVariant("basic_cull"), 0, 0);
    expect(still.origin).toEqual(fixture.placements[0]);
    expect(() => cullProbe(fixture, cullVariant("dynamic_omni_light_cull"), 9999, 0)).toThrow(
      /TN_BENCH_CULL_PROBE_MISSING/,
    );
  });
});

describe("PRD-449 godot-culling capture sampling", () => {
  const WIDTH = 1920;
  const HEIGHT = 1080;
  const STRIDE = Math.ceil((WIDTH * 4) / 256) * 256;

  /** One background-black RGBA frame with a bright block at `[from, to)` on the sampled lattice. */
  function frame(from: number, to: number): Uint8Array {
    const pixels = new Uint8Array(STRIDE * HEIGHT);
    for (let y = 0; y < HEIGHT; y++)
      for (let x = 0; x < WIDTH; x++) {
        const on = x >= from && x < to;
        const offset = y * STRIDE + x * 4;
        pixels[offset] = on ? 255 : 0;
        pixels[offset + 1] = on ? 255 : 0;
        pixels[offset + 2] = on ? 255 : 0;
        pixels[offset + 3] = 255;
      }
    return pixels;
  }

  it("differences against the previous frame's luma, not its raw bytes, and reports no frame as null", () => {
    const first = cullCapture(frame(0, 640), WIDTH, HEIGHT, null);
    expect(first.changedPixels).toBeNull();
    // 24x15 cells and one sample in eight are the competitor arm's own lattice, so a covered
    // fraction means the same thing in both records.
    expect(first.sampledPixels).toBe(240 * 135);
    expect(first.coverageCells).toHaveLength(24 * 15);
    expect(first.coveredFraction).toBeCloseTo((640 / 8 / 240) * 1, 3);

    // The bug this exists for: the same frame twice is an unchanged frame, not 400,000 changed
    // pixels from comparing luma against the previous frame's RGBA bytes.
    expect(cullCapture(frame(0, 640), WIDTH, HEIGHT, first.luma).changedPixels).toBe(0);
    const moved = cullCapture(frame(320, 960), WIDTH, HEIGHT, first.luma);
    expect(moved.changedPixels).toBe(80 * 135);
    expect(cullCapture(frame(320, 960), WIDTH, HEIGHT, moved.luma).changedPixels).toBe(0);
  });
});
