import { describe, expect, it } from "vitest";
import {
  type ICullFixture,
  cullProbe,
  cullRenderedTimeAccum,
  cullTransform,
  cullVariant,
} from "../../examples/engine-load-test/src/cull-fixture.js";
import { cullCapture } from "../../examples/engine-load-test/src/cull-harness.js";
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

/** The retained `basic_cull` pair: Godot's buffers, coverage and wall metric against the TN arm's. */
function retained(): { godot: ICullRun; tn: ICullRun } {
  return {
    godot: parse({
      captures: captures([null, 0], 0.0878086419753086),
      drain: "none-available",
      meanMs: 1.06874166666667,
      topology: KINDS.map((kind, index) => ({
        albedo: [0, 0, 0],
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
    topology: KINDS.map((kind, index) => ({
      albedo: [0, 0, 0],
      counterpartIndices: 36,
      counterpartTriangles: 12,
      counterpartVertices: 24 + index,
      kind,
      tnIndices: 36,
      tnTriangles: 12,
      tnVertices: 24 + index,
    })),
    unshaded: true,
    variant: "basic_cull",
    ...overrides,
  };
}

function parse(overrides: Record<string, unknown> = {}): ICullRun {
  return parseCullRun(run(overrides));
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
    expect(comparison.outcome.problems).toEqual([
      "TN_BENCH_CULL_TOPOLOGY_MISMATCH:SphereMesh triangles 4224/3968 indices 12672/11904 vertices 2210/2145",
      "TN_BENCH_CULL_TOPOLOGY_MISMATCH:CapsuleMesh triangles 3456/2176 indices 10368/6528 vertices 1950/1170",
      "TN_BENCH_CULL_TOPOLOGY_MISMATCH:CylinderMesh triangles 768/256 indices 2304/768 vertices 522/388",
      "TN_BENCH_CULL_TOPOLOGY_MISMATCH:PrismMesh triangles 8/12 indices 24/36 vertices 20/22",
      "TN_BENCH_CULL_COVERAGE_DIVERGED:0 0.022377 of the frame",
      "TN_BENCH_CULL_COVERAGE_DIVERGED:1 0.022377 of the frame",
      "TN_BENCH_CULL_WALL_SEMANTICS_MISMATCH:drain:measurement-boundary-completion/drain:none-available",
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
