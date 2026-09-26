import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CUBES_TOLERANCE,
  type ICubesFixture,
  cubesCameraRotation,
  cubesObjectRotation,
  parseCubesFixture,
} from "../../examples/engine-load-test/src/cubes-fixture.js";
import {
  CUBES_ADMITTED_TOLERANCE,
  compareCubesRuns,
  parseCubesRun,
} from "../engine-load-test/cubes-compare.js";

/**
 * The comparator's rules, proved without a GPU, plus the real retained pair as a regression pin: the
 * `1k rotating` cell is where this family found that Bevy's first `Time` update applies no delta, so
 * the oracle's two step counts are pinned by the samples an actual run reported.
 */

const UPSTREAM = "c6f634ca9f406d68ba5109d921247b654cb42c10";
const STATE_FRAMES = [0, 1, 60, 120, 300, 599];
const DIGEST = "a".repeat(64);
const WARMUP = 4;
const MEASURED = 600;
const CLOCK_STEPS = WARMUP + 2;

/** A cube mesh with four vertices and two triangles, in the canonical base64 the reader decodes. */
function channels(vertices: number): {
  indices: string;
  normals: string;
  positions: string;
  uvs: string;
} {
  const floats = (values: number[]): string =>
    Buffer.from(new Float32Array(values).buffer).toString("base64");
  const positions: number[] = [];
  for (let index = 0; index < vertices; index += 1) positions.push(index, index + 1, index + 2);
  return {
    indices: Buffer.from(new Uint32Array([0, 1, 2, 0, 2, 3]).buffer).toString("base64"),
    normals: floats(new Array<number>(vertices * 3).fill(0)),
    positions: floats(positions),
    uvs: floats(new Array<number>(vertices * 2).fill(0)),
  };
}

function makeFixture(overrides: Record<string, unknown> = {}): ICubesFixture {
  const buffer = channels(4);
  const raw = {
    camera: { far: 1000, fovDegrees: 45, near: 0.1, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    counts: { cubes: 4, directionalLights: 1, enclosing: 1, requestedInstances: 4 },
    enclosing: [
      {
        geometryAsset: "mesh:1",
        geometryId: 1,
        materialAsset: "material:1",
        materialId: 1,
        rotation: [0, 0, 0, 1],
        scale: [-1, -1, -1],
        translation: [0, 0, 0],
      },
    ],
    environment: { background: "bevy-window-clear", shadowMapsEnabled: false },
    family: "bevy-many-cubes",
    frameSchedule: {
      cameraStepPerFrame: 0.15 / 60,
      firstScoredFrameClockSteps: CLOCK_STEPS,
      firstScoredFrameConstantSteps: CLOCK_STEPS,
      firstScoredFrameTimeDeltas: CLOCK_STEPS - 1,
      frameDelta: 1 / 60,
      measuredFrames: MEASURED,
      rotationPerFrame: 10 / 60,
      rotateCubes: true,
      warmupFrames: WARMUP,
    },
    light: { rotation: [0, 0, 0, 1], shadowMapsEnabled: false },
    materials: [
      { baseColor: [1, 1, 1, 1], metallic: 0, perceptualRoughness: 0.5 },
      { baseColor: [1, 1, 1, 1], metallic: 0, perceptualRoughness: 0.5 },
    ],
    meshes: [
      { ...buffer, indexCount: 6, triangles: 2, vertices: 4 },
      { ...buffer, indexCount: 6, triangles: 2, vertices: 4 },
    ],
    objects: [0, 1, 2, 3].map((index) => ({
      geometryAsset: "mesh:0",
      geometryId: 0,
      materialAsset: "material:0",
      materialId: 0,
      rotation: [0, 0.018976, 0, 0.99982],
      scale: [1, 1, 1],
      translation: [0, 0, -index - 1],
    })),
    probeIndices: [0, 2, 3],
    schedule: "bevy-fractional-frame-boundary/1",
    schemaVersion: 1,
    source: {
      adapterSha256: DIGEST,
      commit: UPSTREAM,
      patch: ["disclosed"],
      path: "examples/stress_tests/many_cubes.rs",
      upstreamSha256: DIGEST,
    },
    variant: "rotating",
    viewport: {
      deviation: null,
      height: 1050,
      requestedHeight: 1080,
      requestedWidth: 1920,
      scaleFactor: 1,
      width: 1920,
    },
    ...overrides,
  };
  return parseCubesFixture(JSON.stringify(raw));
}

function makeRun(
  fixture: ICubesFixture,
  arm: "bevy-desktop" | "tn-desktop",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    adapter: { name: "NVIDIA GeForce RTX 2080" },
    arm,
    authoring: arm === "tn-desktop" ? "default" : undefined,
    boundarySemantics: "render-producing frame boundary",
    drain: { boundaryFrame: MEASURED, includesUntimedFrames: 1 },
    family: "bevy-many-cubes",
    fixture: { hash: DIGEST, objects: fixture.counts.cubes, sourceCommit: UPSTREAM },
    frameSchedule: fixture.frameSchedule,
    meanMs: arm === "bevy-desktop" ? 2 : 1.5,
    profile: "smoke",
    rawSeries: {
      boundaries: Array.from({ length: MEASURED + 1 }, (_unused, index) => ({
        frameId: index,
        monotonicMs: index * 2,
      })),
      finalCompletionMs: MEASURED * 2 + 1,
      schemaVersion: 1,
      unit: "ms",
    },
    states: STATE_FRAMES.map((frameId) => ({
      cameraRotation: cubesCameraRotation(fixture, frameId),
      frameId,
      probes: fixture.probeIndices.map((index) => ({
        index,
        rotation: cubesObjectRotation(fixture, index, frameId),
      })),
    })),
    variant: fixture.variant,
    viewport: { height: fixture.viewport.height, width: fixture.viewport.width },
    work:
      arm === "bevy-desktop"
        ? { authoredObjects: 5, submittedDrawCalls: null, visibleObjects: 4 }
        : { admittedCubes: 4, submittedDrawCalls: 1, submittedTriangles: 8 },
    ...overrides,
  };
}

describe("bevy-many-cubes comparison", () => {
  it("accepts a matched pair, and reports the ratio as an observation rather than a verdict", () => {
    const fixture = makeFixture();
    const comparison = compareCubesRuns(
      fixture,
      parseCubesRun(makeRun(fixture, "bevy-desktop")),
      parseCubesRun(makeRun(fixture, "tn-desktop")),
    );
    expect(comparison.outcome.valid).toBe(true);
    expect(comparison.outcome.comparability).toBe("qualified");
    expect(comparison.conformance.withinTolerance).toBe(true);
    expect(comparison.ratio?.ratio).toBeCloseTo(2 / 1.5, 6);
    expect(comparison.ratio?.verdict).toBe("insufficient");
    expect(comparison.admitted.canonical).toBe(4);
  });

  it("refuses a probe that moved beyond the preregistered tolerance", () => {
    const fixture = makeFixture();
    const run = makeRun(fixture, "bevy-desktop");
    const states = run.states as { frameId: number; probes: { rotation: number[] }[] }[];
    const probe = states[2]?.probes[1] as { rotation: number[] };
    probe.rotation[1] = (probe.rotation[1] as number) + 0.01;
    const comparison = compareCubesRuns(
      fixture,
      parseCubesRun(run),
      parseCubesRun(makeRun(fixture, "tn-desktop")),
    );
    expect(comparison.outcome.valid).toBe(false);
    expect(comparison.outcome.problems).toContain("TN_BENCH_CUBES_STATE_OUT_OF_TOLERANCE");
    expect(comparison.ratio).toBeNull();
  });

  it("refuses a rotating sample that is one fixture-clock step off, the trap this family found", () => {
    const fixture = makeFixture();
    const run = makeRun(fixture, "bevy-desktop");
    const states = run.states as { frameId: number; probes: { rotation: number[] }[] }[];
    // Bevy's first `Time` update applies no delta, so a time consumer is one step behind a system
    // using a constant step. This is the sample that mistake produces.
    const probe = (states[2]?.probes as { rotation: number[] }[])[0] as { rotation: number[] };
    probe.rotation.splice(0, 4, ...cubesObjectRotation(fixture, 0, 61));
    const comparison = compareCubesRuns(
      fixture,
      parseCubesRun(run),
      parseCubesRun(makeRun(fixture, "tn-desktop")),
    );
    expect(comparison.conformance.probeMaxDelta).toBeGreaterThan(CUBES_TOLERANCE.quaternionAbs);
    expect(comparison.outcome.problems).toContain("TN_BENCH_CUBES_STATE_OUT_OF_TOLERANCE");
  });

  it("refuses a static arm whose cubes moved, and a rotating arm whose cubes did not", () => {
    const rotating = makeFixture();
    const staticFixture = makeFixture({
      frameSchedule: {
        ...rotating.frameSchedule,
        rotateCubes: false,
      },
      variant: "static",
    });
    const firstSample = (makeRun(rotating, "bevy-desktop").states as unknown[])[0];
    const stillRotating = makeRun(rotating, "bevy-desktop", { states: [firstSample] });
    expect(
      compareCubesRuns(
        rotating,
        parseCubesRun(stillRotating),
        parseCubesRun(makeRun(rotating, "tn-desktop")),
      ).outcome.problems,
    ).toContain("TN_BENCH_CUBES_ROTATION_NOT_OBSERVED:bevy");
    const frozen = makeRun(staticFixture, "bevy-desktop", {
      variant: "static",
      states: makeRun(rotating, "bevy-desktop").states,
    });
    expect(
      compareCubesRuns(
        staticFixture,
        parseCubesRun(frozen),
        parseCubesRun(makeRun(staticFixture, "tn-desktop")),
      ).outcome.problems,
    ).toContain("TN_BENCH_CUBES_STATIC_ARM_MOVED:bevy");
  });

  it("refuses a pair whose viewport or fixture identity does not match", () => {
    const fixture = makeFixture();
    const wrongViewport = makeRun(fixture, "tn-desktop", {
      viewport: { height: 1080, width: 1920 },
    });
    expect(
      compareCubesRuns(
        fixture,
        parseCubesRun(makeRun(fixture, "bevy-desktop")),
        parseCubesRun(wrongViewport),
      ).outcome.problems,
    ).toContain("TN_BENCH_CUBES_VIEWPORT_MISMATCH:tn");
    const noHash = makeRun(fixture, "tn-desktop", {
      fixture: { objects: 4, sourceCommit: UPSTREAM },
    });
    expect(
      compareCubesRuns(
        fixture,
        parseCubesRun(makeRun(fixture, "bevy-desktop")),
        parseCubesRun(noHash),
      ).outcome.problems,
    ).toContain("TN_BENCH_CUBES_FIXTURE_HASH_ABSENT");
  });

  it("refuses a pair whose admitted-object count leaves the canonical census band", () => {
    const fixture = makeFixture();
    const dropped = makeRun(fixture, "bevy-desktop", {
      work: { authoredObjects: 5, submittedDrawCalls: null, visibleObjects: 0 },
    });
    const comparison = compareCubesRuns(
      fixture,
      parseCubesRun(dropped),
      parseCubesRun(makeRun(fixture, "tn-desktop")),
    );
    expect(comparison.admitted.withinTolerance).toBe(false);
    expect(comparison.outcome.problems).toContain("TN_BENCH_CUBES_ADMITTED_DIVERGED:bevy");
    // The band is declared, not fitted to what the arms happened to report.
    expect(comparison.admitted.tolerance).toBe(
      Math.max(1, Math.round(fixture.counts.cubes * CUBES_ADMITTED_TOLERANCE)),
    );
  });

  it("refuses a run with no final completion observation, and one whose mean is zero", () => {
    const fixture = makeFixture();
    const noCompletion = makeRun(fixture, "bevy-desktop");
    const series = noCompletion.rawSeries as Record<string, unknown>;
    // Absent is not zero: an observation that was never taken is a refusal, not a fast frame.
    expect(series.finalCompletionMs).toBe(MEASURED * 2 + 1);
    series.finalCompletionMs = undefined;
    expect(() => parseCubesRun(noCompletion)).toThrow(/no final completion/);
    expect(() => parseCubesRun(makeRun(fixture, "bevy-desktop", { meanMs: 0 }))).toThrow(
      /no frame completed/,
    );
  });

  it("agrees with the retained real 1k rotating pair, including the one-step clock trap", () => {
    // The retained real pair, read rather than restated: this is what the oracle has to keep matching
    // or the next run's conformance means nothing.
    const fixture = parseCubesFixture(
      readFileSync("artifacts/engine-load-test/cubes-1000-rotating-bevy-fixture.json", "utf8"),
    );
    const bevy = parseCubesRun(
      JSON.parse(
        readFileSync("artifacts/engine-load-test/cubes-1000-rotating-bevy-desktop.json", "utf8"),
      ) as unknown,
    );
    const tn = parseCubesRun(
      JSON.parse(
        readFileSync("artifacts/engine-load-test/cubes-1000-rotating-tn-desktop.json", "utf8"),
      ) as unknown,
    );
    const comparison = compareCubesRuns(fixture, bevy, tn);
    expect(comparison.outcome.valid).toBe(true);
    expect(comparison.outcome.comparability).toBe("qualified");
    expect(comparison.conformance.probeMaxDelta).toBeLessThanOrEqual(CUBES_TOLERANCE.quaternionAbs);
    expect(comparison.conformance.cameraMaxDelta).toBeLessThanOrEqual(
      CUBES_TOLERANCE.quaternionAbs,
    );
    expect(comparison.ratio?.verdict).toBe("insufficient");
  });
});
