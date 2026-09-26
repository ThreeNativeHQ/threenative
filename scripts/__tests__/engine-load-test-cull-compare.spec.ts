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
function captures(changed: (number | null)[]): unknown[] {
  return changed.map((value, frameId) => ({
    backgroundLuma: 0,
    changedPixels: value,
    coveredFraction: 0.0878,
    frameId,
    meanLuma: 0.0689,
    name: "frame",
    scored: true,
  }));
}

function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    adapter: ADAPTER,
    arm: "godot-desktop",
    authoring: "rendering-server-rid",
    captures: captures([null, 0]),
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
    states: [
      {
        frameId: 0,
        probes: [
          { axisX: [1, 0, 0], index: 0, origin: [266.238, 32.311, -35.796] },
          { axisX: [1, 0, 0], index: 4999, origin: [34.757, -77.748, -150.044] },
          { axisX: [1, 0, 0], index: 9999, origin: [-19.053, -47.31, -88.02] },
        ],
        timeAccum: 0,
      },
    ],
    topology: ["BoxMesh", "SphereMesh", "CapsuleMesh", "CylinderMesh", "PrismMesh"].map(
      (kind, index) => ({
        albedo: [0, 0, 0],
        counterpartTriangles: 12,
        kind,
        tnIndices: 36,
        tnTriangles: 12,
        tnVertices: 24 + index,
      }),
    ),
    unshaded: true,
    variant: "basic_cull",
    ...overrides,
  };
}

function parse(overrides: Record<string, unknown> = {}): ICullRun {
  return parseCullRun(run(overrides));
}

describe("PRD-449 godot-culling smoke comparison", () => {
  it("pairs two runs of the same fixture and reports the godot-over-tn mean ratio", () => {
    const comparison = compareCullRuns(
      parse({ arm: "tn-desktop", authoring: "scene-node-independent", meanMs: 35.336 }),
      parse(),
    );
    expect(comparison.outcome.valid).toBe(true);
    expect(comparison.outcome.comparability).toBe("qualified");
    expect(comparison.ratio.ratio).toBeCloseTo(1.066 / 35.336, 5);
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
