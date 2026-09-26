import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FOXES_ACTIVE_CLIP,
  FOXES_ASSET_SHA256,
  FOXES_TOLERANCE,
  FOXES_UPSTREAM_COMMIT,
  type IFoxesFixture,
  foxesBindposeDigest,
  foxesMeshDigest,
  foxesOracleTime,
  foxesOracleValue,
  foxesRingRotation,
  parseFoxesFixture,
} from "../../examples/engine-load-test/src/foxes-fixture.js";
import { compareFoxesRuns, parseFoxesRun } from "../engine-load-test/foxes-compare.js";

/**
 * The comparator's rules, proved without a GPU, plus the two retained real pairs as a regression pin:
 * the 50-fox cells are where this family found that the competitor's own f32 clock drifts over the
 * measured horizon while the counterpart arm's does not, so the oracles' step count and the declared
 * tolerances are pinned by the samples an actual run reported.
 */

const DIGEST = "a".repeat(64);
const SHORT = "0123456789abcdef";
const WARMUP = 4;
const MEASURED = 600;
const DELTAS = 3;
const STATE_FRAMES = [0, 1, 60];
const JOINTS = 2;

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function floats(values: number[]): string {
  return base64(new Uint8Array(new Float32Array(values).buffer));
}

function planeMesh(): Record<string, unknown> {
  return {
    indexCount: 6,
    indices: base64(new Uint8Array(new Uint32Array([0, 1, 2, 0, 2, 3]).buffer)),
    normals: floats([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    positions: floats([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    triangles: 2,
    uvs: floats([0, 0, 1, 0, 1, 1, 0, 1]),
    vertices: 4,
  };
}

function makeFixture(overrides: Record<string, unknown> = {}): IFoxesFixture {
  const binds = [0, 1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1].map((value) => value as number);
  const raw = {
    asset: {
      attribution: "PixelMannen (CC0), @tomkranis (CC-BY 4.0)",
      bytes: 162852,
      copyright: "CC-BY 4.0",
      name: "Fox.glb",
      path: "assets/models/animated/Fox.glb",
      sha256: FOXES_ASSET_SHA256,
    },
    camera: {
      far: 1000,
      fovDegrees: 45,
      msaa: "Off",
      near: 0.1,
      position: [10, 4, 12],
      rotation: [0, 0, 0, 1],
    },
    clips: [
      {
        channels: 1,
        digest: SHORT,
        duration: 1,
        index: 0,
        interpolation: "linear",
        keys: 2,
        name: "Survey",
        nodes: ["b_Hip_01"],
        targets: 1,
      },
      {
        channels: 1,
        digest: "b".repeat(16),
        duration: 1,
        index: 1,
        interpolation: "linear",
        keys: 2,
        name: "Walk",
        nodes: ["b_Hip_01"],
        targets: 1,
      },
      {
        channels: 1,
        digest: "c".repeat(16),
        duration: 1,
        index: 2,
        interpolation: "linear",
        keys: 2,
        name: "Run",
        nodes: ["b_Hip_01"],
        targets: 1,
      },
    ],
    counts: { directionalLights: 1, foxes: 4, joints: JOINTS, requestedFoxes: 4, rings: 1 },
    environment: {
      antialias: "Off",
      background: "bevy-window-clear",
      motionBlur: false,
      shadowMapsEnabled: false,
      staticTransformOptimizations: "Disabled (upstream)",
    },
    family: "bevy-many-foxes",
    foxes: [0, 1, 2, 3].map((index) => ({
      entityIndex: 10 + index,
      index,
      joints: JOINTS,
      phase: index / 10,
      ring: 0,
      ringRadius: 2,
      rotation: [0, 0, 0, 1],
      scale: [0.01, 0.01, 0.01],
      translation: [2, 0, 0],
    })),
    frameSchedule: {
      firstScoredFrameTimeDeltas: DELTAS,
      foxSpacing: 2,
      foxSpeed: 2,
      frameDelta: 1 / 60,
      measuredFrames: MEASURED,
      ringSpacing: 2,
      ringsMoving: true,
      staggerDivisor: 10,
      warmupFrames: WARMUP,
    },
    light: {
      cascades: [9],
      minimumDistance: 0.1,
      overlapProportion: 0.2,
      rotation: [0, 0, 0, 1],
      shadowMapsEnabled: false,
    },
    material: {
      baseColor: [1, 1, 1, 1],
      metallic: 0,
      perceptualRoughness: 0.58,
      texture: { format: "Rgba8UnormSrgb", height: 8, width: 8 },
      textureBinding: "baseColorTexture",
    },
    mesh: {
      digest: "d".repeat(16),
      hasNormals: true,
      indexCount: 6,
      joints: 4,
      sourceIndexed: false,
      triangles: 2,
      vertices: 4,
      weightsExcluded: "three renormalises skin weights",
    },
    oracleChannel: {
      animation: 2,
      channel: 0,
      component: 1,
      components: 3,
      interpolation: "linear",
      keys: 2,
      node: "b_Hip_01",
      property: "translation",
      range: 10,
      rule: "largest max-min",
      times: [0, 1],
      values: [0, 10],
    },
    plane: { color: [0.3, 0.5, 0.3, 1], mesh: planeMesh() },
    probeFoxIndices: [0, 3],
    rings: [
      {
        direction: "counter-clockwise",
        foxes: 4,
        index: 0,
        radius: 2,
        sign: 1,
        spawnRotation: [0, 0, 0, 1],
      },
    ],
    runtime: {
      clips: [
        { curves: 1, duration: 1, index: 0, targets: 1 },
        { curves: 1, duration: 1, index: 1, targets: 1 },
        { curves: 1, duration: 1, index: 2, targets: 1 },
      ],
      note: "bevy 0.19 keeps its curves private",
    },
    schedule: "bevy-fractional-frame-boundary/1",
    schemaVersion: 1,
    skin: {
      bindposeDigest: "e".repeat(16),
      inverseBindMatrices: [binds, binds],
      joints: ["_rootJoint", "b_Hip_01"],
      stream: "threenative-foxes-bindposes/1",
    },
    source: {
      adapterSha256: DIGEST,
      commit: FOXES_UPSTREAM_COMMIT,
      patch: ["disclosed"],
      path: "examples/stress_tests/many_foxes.rs",
      upstreamSha256: DIGEST,
    },
    variant: "staggered",
    viewport: {
      deviation: "requested 1920x1080, rendered 1920x1050",
      height: 1050,
      requestedHeight: 1080,
      requestedWidth: 1920,
      scaleFactor: 1,
      width: 1920,
    },
    ...overrides,
  };
  return parseFoxesFixture(JSON.stringify(raw));
}

/** A pose that moves with the frame and differs per fox, which is what a live staggered arm reports. */
function pose(fixture: IFoxesFixture, frame: number, fox: number): Record<string, unknown> {
  const t = (DELTAS + frame) / 60;
  return {
    bonePoses: [
      [0, 0, 0, 0, 0, 0, 1],
      [0, foxesOracleValue(fixture, fox, frame), 0, 0, 0, 0, 1],
    ],
    index: fox,
    joints: JOINTS,
    oracleRotation: [0, 0, 0, 1],
    oracleTranslation: [0, foxesOracleValue(fixture, fox, frame), 0],
    poseScalar: fox / 10 + t,
    ring: 0,
    skinMatrices: [[fox / 100, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]],
  };
}

function makeRun(
  fixture: IFoxesFixture,
  arm: "bevy-desktop" | "tn-desktop",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    adapter: { name: "NVIDIA GeForce RTX 2080" },
    arm,
    asset: { bytes: 162852, path: "assets/models/animated/Fox.glb", sha256: FOXES_ASSET_SHA256 },
    bindposeDigest: fixture.skin.bindposeDigest,
    boundarySemantics: "render-producing frame boundary",
    clipDigest: fixture.clips[FOXES_ACTIVE_CLIP]?.digest ?? null,
    clipName: fixture.clips[FOXES_ACTIVE_CLIP]?.name ?? null,
    drain: { boundaryFrame: MEASURED, includesUntimedFrames: 1 },
    family: "bevy-many-foxes",
    fixture: { foxes: fixture.counts.foxes, hash: DIGEST, sourceCommit: FOXES_UPSTREAM_COMMIT },
    frameSchedule: fixture.frameSchedule,
    jointNames: fixture.skin.joints,
    meanMs: arm === "bevy-desktop" ? 2 : 2.5,
    meshDigest: fixture.mesh.digest,
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
    states: STATE_FRAMES.map((frame) => ({
      frameId: frame,
      state: {
        foxes: fixture.probeFoxIndices.map((fox) => pose(fixture, frame, fox)),
        poseScalars: fixture.foxes.map((_fox, index) => index / 10 + (DELTAS + frame) / 60),
        rings: fixture.rings.map((ring) => ({
          index: ring.index,
          rotation: foxesRingRotation(fixture, ring.index, frame),
        })),
        ringSystemRuns: DELTAS + frame,
      },
    })),
    variant: fixture.variant,
    viewport: { height: 1050, width: 1920 },
    warmupFrames: WARMUP,
    work:
      arm === "bevy-desktop"
        ? {
            authoredFoxes: fixture.counts.foxes,
            sampledAtMeasuredFrame: MEASURED / 2,
            shadowMapsEnabled: false,
            submittedDrawCalls: null,
            submittedTriangles: null,
          }
        : {
            admittedFoxes: fixture.counts.foxes,
            authoredFoxes: fixture.counts.foxes,
            mixers: fixture.counts.foxes,
            sampledAtMeasuredFrame: MEASURED / 2,
            shadowMapsEnabled: false,
            submittedDrawCalls: 5,
            submittedTriangles: 9,
          },
    ...overrides,
  };
}

function compare(fixture: IFoxesFixture, bevy?: unknown, tn?: unknown) {
  return compareFoxesRuns(
    fixture,
    parseFoxesRun(bevy ?? makeRun(fixture, "bevy-desktop")),
    parseFoxesRun(tn ?? makeRun(fixture, "tn-desktop")),
  );
}

describe("PRD-449 many-foxes comparator", () => {
  it("accepts a matched pair as qualified and withholds a verdict", () => {
    const fixture = makeFixture();
    const comparison = compare(fixture);
    expect(comparison.outcome.problems).toEqual([]);
    expect(comparison.outcome.valid).toBe(true);
    expect(comparison.outcome.comparability).toBe("qualified");
    // One smoke block supports no faster/slower statement, and the ratio is still reported.
    expect(comparison.ratio?.verdict).toBe("insufficient");
    expect(comparison.ratio?.ratio).toBeCloseTo(2 / 2.5, 6);
    expect(comparison.conformance.distinctPoses).toEqual({ bevy: 4, tn: 4 });
  });

  it("refuses a staggered cell whose foxes share one pose on either arm", () => {
    // §5.1's substitution this family exists to catch: a shared pose instead of independently
    // evaluated skeletons. The comparator must notice it on the competitor's side too.
    const fixture = makeFixture();
    const shared = makeRun(fixture, "bevy-desktop");
    const states = (shared.states as { state: { poseScalars: number[] } }[]).map((state) => {
      state.state.poseScalars = state.state.poseScalars.map(() => 1);
      return state;
    });
    shared.states = states;
    expect(compare(fixture, shared).outcome.problems).toContain(
      "TN_BENCH_FOXES_STAGGERED_SHARED_POSE:bevy:1",
    );
    // A run whose variant is not the fixture's is refused before anything else is compared.
    const sync = makeFixture({ variant: "sync" });
    expect(
      compare(sync, undefined, makeRun(sync, "tn-desktop", { variant: "staggered" })).outcome
        .problems,
    ).toContain("TN_BENCH_FOXES_VARIANT_MISMATCH");
  });

  it("refuses a synchronized cell whose foxes do not share one pose", () => {
    // In the synchronized variant upstream seeks no phase, so every fox must land on the same pose.
    // Per-fox distinct poses there mean the arm evaluated something else, on either side, and the
    // happy direction — one shared pose on both arms — is the retained real sync pair below.
    const problems = compare(makeFixture({ variant: "sync" })).outcome.problems;
    expect(problems).toContain("TN_BENCH_FOXES_SYNC_NOT_SHARED:bevy:4");
    expect(problems).toContain("TN_BENCH_FOXES_SYNC_NOT_SHARED:tn:4");
  });

  it("refuses a frozen animation and a paused ring on either arm", () => {
    const fixture = makeFixture();
    const frozen = makeRun(fixture, "tn-desktop");
    frozen.states = (frozen.states as { frameId: number; state: unknown }[]).map((state) => ({
      frameId: state.frameId,
      state: (frozen.states as { state: unknown }[])[0]?.state,
    }));
    const problems = compare(fixture, undefined, frozen).outcome.problems;
    expect(problems).toContain("TN_BENCH_FOXES_ANIMATION_FROZEN:tn");
    expect(problems).toContain("TN_BENCH_FOXES_POSE_FROZEN:tn");
    const paused = makeRun(fixture, "bevy-desktop");
    const states = paused.states as { state: { rings: { rotation: number[] }[] } }[];
    for (const state of states) for (const ring of state.state.rings) ring.rotation = [0, 0, 0, 1];
    expect(compare(fixture, paused).outcome.problems).toContain(
      "TN_BENCH_FOXES_STATE_OUT_OF_TOLERANCE",
    );
  });

  it("refuses a substituted asset, clip, skeleton or mesh", () => {
    const fixture = makeFixture();
    const other = "f".repeat(64);
    expect(
      compare(
        fixture,
        undefined,
        makeRun(fixture, "tn-desktop", { asset: { bytes: 1, sha256: other } }),
      ).outcome.problems,
    ).toContain("TN_BENCH_FOXES_ASSET_MISMATCH:tn");
    expect(
      compare(fixture, undefined, makeRun(fixture, "tn-desktop", { clipDigest: "0".repeat(16) }))
        .outcome.problems,
    ).toContain(`TN_BENCH_FOXES_CLIP_DIGEST:tn:${"0".repeat(16)}`);
    expect(
      compare(
        fixture,
        undefined,
        makeRun(fixture, "tn-desktop", { bindposeDigest: "0".repeat(16) }),
      ).outcome.problems,
    ).toContain(`TN_BENCH_FOXES_BINDPOSE_DIGEST:tn:${"0".repeat(16)}`);
    expect(
      compare(fixture, undefined, makeRun(fixture, "tn-desktop", { meshDigest: "0".repeat(16) }))
        .outcome.problems,
    ).toContain(`TN_BENCH_FOXES_MESH_DIGEST:tn:${"0".repeat(16)}`);
    expect(
      compare(
        fixture,
        undefined,
        makeRun(fixture, "tn-desktop", { jointNames: ["b_Hip_01", "_rootJoint"] }),
      ).outcome.problems,
    ).toContain("TN_BENCH_FOXES_JOINT_ORDER:tn");
  });

  it("refuses a shadow pass, a motion blur and a zero where a counter belongs", () => {
    const fixture = makeFixture();
    expect(
      compare(
        fixture,
        undefined,
        makeRun(fixture, "tn-desktop", {
          work: { admittedFoxes: 4, mixers: 4, shadowMapsEnabled: true },
        }),
      ).outcome.problems,
    ).toContain("TN_BENCH_FOXES_SHADOWS_ENABLED:tn");
    expect(
      compare(
        makeFixture({
          environment: {
            antialias: "Off",
            background: "bevy-window-clear",
            motionBlur: true,
            shadowMapsEnabled: false,
          },
        }),
      ).outcome.problems,
    ).toContain("TN_BENCH_FOXES_MOTION_BLUR_ENABLED");
    expect(
      compare(fixture, makeRun(fixture, "bevy-desktop", { work: { submittedDrawCalls: 0 } }))
        .outcome.problems,
    ).toContain("TN_BENCH_FOXES_DRAW_COUNTER_ZERO");
    // One mixer per fox is the arm's own evidence that each skeleton was evaluated independently.
    expect(
      compare(fixture, undefined, makeRun(fixture, "tn-desktop", { work: { mixers: 1 } })).outcome
        .problems,
    ).toContain("TN_BENCH_FOXES_MIXER_COUNT:tn");
  });

  it("refuses a run with no final completion observation, and one whose mean is zero", () => {
    const fixture = makeFixture();
    const noCompletion = makeRun(fixture, "bevy-desktop");
    const series = noCompletion.rawSeries as Record<string, unknown>;
    // Absent is not zero: an observation never taken is a refusal, not a fast frame.
    expect(series.finalCompletionMs).toBe(MEASURED * 2 + 1);
    series.finalCompletionMs = undefined;
    expect(() => parseFoxesRun(noCompletion)).toThrow(/no final completion/);
    expect(() => parseFoxesRun(makeRun(fixture, "bevy-desktop", { meanMs: 0 }))).toThrow(
      /no frame completed/,
    );
  });

  it("rejects a fixture whose census, schedule or asset lock does not hold", () => {
    expect(() =>
      makeFixture({ asset: { bytes: 1, name: "Fox.glb", sha256: FOXES_ASSET_SHA256 } }),
    ).toThrow(/asset byte length/);
    expect(() =>
      makeFixture({ asset: { bytes: 162852, name: "Fox.glb", sha256: "b".repeat(64) } }),
    ).toThrow(/pinned asset digest/);
    expect(() =>
      makeFixture({
        counts: { directionalLights: 1, foxes: 5, joints: JOINTS, requestedFoxes: 5, rings: 1 },
      }),
    ).toThrow(/counts\.foxes/);
    expect(() =>
      makeFixture({
        frameSchedule: {
          firstScoredFrameTimeDeltas: 0,
          foxSpeed: 0,
          frameDelta: 1 / 60,
          measuredFrames: MEASURED,
          warmupFrames: WARMUP,
        },
      }),
    ).toThrow(/ring speed is positive/);
  });

  it("composes the oracles from the declared step count, not from the arms", () => {
    const fixture = makeFixture();
    // The ring oracle is `sign * speed / radius * dt` per applied delta, from identity.
    const rotation = foxesRingRotation(fixture, 0, 0);
    expect(rotation[1]).toBeCloseTo(Math.sin((2 / 2) * (1 / 60) * DELTAS * 0.5), 12);
    // The oracle channel is a linear lerp of the fixture's own keys at the wrapped clip time, whose
    // keys are 0 and 1 s apart with values 0 and 10, so the value is ten times the clip time.
    expect(foxesOracleTime(fixture, 0, 0)).toBeCloseTo(DELTAS / 60, 12);
    expect(foxesOracleValue(fixture, 0, 0)).toBeCloseTo((DELTAS / 60) * 10, 9);
    // A later frame is further along the same lerp, which is what proves the clock is being read.
    expect(foxesOracleValue(fixture, 0, 1)).toBeGreaterThan(foxesOracleValue(fixture, 0, 0));
    // The declared bounds, restated: this is the arithmetic the tolerances are derived from.
    expect(FOXES_TOLERANCE.quaternionAbs).toBeGreaterThanOrEqual(2 ** -24 * 720 * 12);
  });

  it("recomputes the correspondence digests from bytes, not from a name", () => {
    const fixture = makeFixture();
    // Both digests are order-sensitive and cover the data, so a transposed channel changes them.
    const positions = [0, 1, 2, 3, 4, 5];
    const uvs = [0, 0, 1, 0, 0, 1];
    const joints = [0, 1, 0, 0];
    const indices = [0, 1, 2];
    const base = foxesMeshDigest({ hasNormals: true, indices, joints, positions, uvs });
    expect(
      foxesMeshDigest({
        hasNormals: true,
        indices,
        joints,
        positions: [...positions].reverse(),
        uvs,
      }),
    ).not.toBe(base);
    expect(foxesMeshDigest({ hasNormals: false, indices, joints, positions, uvs })).not.toBe(base);
    expect(
      foxesMeshDigest({ hasNormals: true, indices: [0, 2, 1], joints, positions, uvs }),
    ).not.toBe(base);
    const matrix = Array.from({ length: 16 }, (_unused, index) => index as number);
    expect(foxesBindposeDigest([matrix])).toHaveLength(16);
    expect(foxesBindposeDigest([matrix, matrix])).not.toBe(foxesBindposeDigest([matrix]));
  });

  it("agrees with the retained real 50-fox pairs on both variants", () => {
    // The retained real pairs, read rather than restated: this is what the oracles have to keep
    // matching, and what pins the declared step count and the f32-horizon tolerances.
    for (const variant of ["staggered", "sync"] as const) {
      const fixture = parseFoxesFixture(
        readFileSync(
          `artifacts/engine-load-test/foxes-50-${variant}-600f-bevy-fixture.json`,
          "utf8",
        ),
      );
      const bevy = parseFoxesRun(
        JSON.parse(
          readFileSync(`artifacts/engine-load-test/foxes-50-${variant}-bevy.json`, "utf8"),
        ) as unknown,
      );
      const tn = parseFoxesRun(
        JSON.parse(
          readFileSync(`artifacts/engine-load-test/foxes-50-${variant}-tn.json`, "utf8"),
        ) as unknown,
      );
      const comparison = compareFoxesRuns(fixture, bevy, tn);
      expect(`${variant}:${comparison.outcome.problems.join(",")}`).toBe(`${variant}:`);
      expect(comparison.outcome.comparability).toBe("qualified");
      expect(comparison.conformance.withinTolerance).toBe(true);
      expect(comparison.conformance.crossArm.boneMaxDelta).toBeLessThanOrEqual(
        FOXES_TOLERANCE.boneAbs,
      );
      expect(comparison.conformance.crossArm.skinMatrixMaxDelta).toBeLessThanOrEqual(
        FOXES_TOLERANCE.matrixAbs,
      );
      // The counterexample arm's f32 clock is what these bounds are derived from; its own deviation
      // must stay far above the counterpart arm's, or the bounds are no longer justified.
      expect(comparison.conformance.perArm.bevy.oracleMaxDelta).toBeGreaterThan(
        comparison.conformance.perArm.tn.oracleMaxDelta,
      );
      expect(comparison.conformance.distinctPoses.bevy).toBe(
        variant === "sync" ? 1 : fixture.counts.foxes,
      );
      expect(comparison.ratio?.verdict).toBe("insufficient");
    }
  });
});
