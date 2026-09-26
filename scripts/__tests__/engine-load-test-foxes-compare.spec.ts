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
  foxesTimeDeltas,
  parseFoxesFixture,
} from "../../examples/engine-load-test/src/foxes-fixture.js";
import { compareFoxesRuns, parseFoxesRun } from "../engine-load-test/foxes-compare.js";

/**
 * The comparator's rules, proved without a GPU, and every one of them fed on a full-schedule pair:
 * the 50-fox cells are where this family found that the competitor's own f32 clock drifts over the
 * measured horizon while the counterpart arm's does not, so the arms here are built with the
 * arithmetic they actually use, and the band the oracles are checked against is pinned at the same
 * horizon the real cell ran. Nothing here reads `artifacts/`, so the suite is as green on a clean
 * checkout as it is beside a measured run.
 */

const DIGEST = "a".repeat(64);
const SHORT = "0123456789abcdef";
const WARMUP = 4;
const MEASURED = 600;
const DELTAS = 3;
/** The six frames §6.2's conformance inspection names, the last of which is the measured horizon. */
const STATE_FRAMES = [0, 1, 60, 120, 300, 599];
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

/**
 * The counterexample arm's clock, in the arithmetic it actually keeps: `elapsed` accumulated one
 * `frameDelta` at a time in f32, and each ring's turn one f32 rotation quaternion multiplied per
 * applied delta. The declared band is derived from exactly this drift, so a pair built only from f64
 * values cannot tell whether the band is wide enough for the arms it is meant to compare.
 */
const f32 = Math.fround;
const add = (a: number, b: number): number => f32(a + b);
const sub = (a: number, b: number): number => f32(a - b);
const mul = (a: number, b: number): number => f32(a * b);

function f32Elapsed(fixture: IFoxesFixture, frame: number): number {
  const step = f32(fixture.frameSchedule.frameDelta);
  let elapsed = 0;
  for (let delta = 0; delta < foxesTimeDeltas(fixture, frame); delta += 1)
    elapsed = add(elapsed, step);
  return elapsed;
}

/** The Hamilton product with every operation rounded, which is the f32 the arms actually multiply. */
function f32QuatProduct(a: readonly number[], b: readonly number[]): number[] {
  const [ax, ay, az, aw] = [a[0] as number, a[1] as number, a[2] as number, a[3] as number];
  const [bx, by, bz, bw] = [b[0] as number, b[1] as number, b[2] as number, b[3] as number];
  return [
    sub(add(add(mul(aw, bx), mul(ax, bw)), mul(ay, bz)), mul(az, by)),
    add(add(sub(mul(aw, by), mul(ax, bz)), mul(ay, bw)), mul(az, bx)),
    add(add(add(mul(aw, bz), mul(ax, by)), mul(-ay, bx)), mul(az, bw)),
    sub(sub(sub(mul(aw, bw), mul(ax, bx)), mul(ay, by)), mul(az, bz)),
  ];
}

/** The oracle channel's value at the f32 clip time: the fixture's own linear lerp, entered at it. */
function f32OracleValue(fixture: IFoxesFixture, fox: number, frame: number): number {
  const channel = fixture.oracleChannel;
  const first = channel.times[0] as number;
  const last = channel.times.length - 1;
  const from = channel.values[0] as number;
  const to = channel.values[last] as number;
  const time =
    (f32(fixture.foxes[fox]?.phase ?? 0) + f32Elapsed(fixture, frame)) %
    f32(fixture.clips[FOXES_ACTIVE_CLIP]?.duration ?? 0);
  const span = (channel.times[last] as number) - first;
  const weight = span > 0 ? (time - first) / span : 0;
  return f32(from + weight * (to - from));
}

/** The angle a ring has turned by, in the arithmetic that arm used to turn it. */
function ringAngle(
  fixture: IFoxesFixture,
  frame: number,
  arm: "bevy-desktop" | "tn-desktop",
): number {
  const ring = fixture.rings[0];
  if (ring === undefined) return 0;
  const schedule = fixture.frameSchedule;
  const step = (ring.sign * schedule.foxSpeed * schedule.frameDelta) / ring.radius;
  if (arm !== "bevy-desktop") return step * foxesTimeDeltas(fixture, frame);
  const half = f32(step / 2);
  const increment = [0, f32(Math.sin(half)), 0, f32(Math.cos(half))];
  let turned = [0, 0, 0, 1];
  for (let delta = 0; delta < foxesTimeDeltas(fixture, frame); delta += 1)
    turned = f32QuatProduct(turned, increment);
  return 2 * Math.atan2(turned[1] as number, turned[3] as number);
}

/** The ring rotation the f32 chain reached, reported back in the four components the arms carry. */
function f32RingRotation(fixture: IFoxesFixture, frame: number): number[] {
  const half = f32(ringAngle(fixture, frame, "bevy-desktop") / 2);
  return [0, f32(Math.sin(half)), 0, f32(Math.cos(half))];
}

/**
 * A pose that moves with the frame and differs per fox, which is what a live staggered arm reports.
 * `bevy-desktop` reads the fixture through f32 the way the counterexample arm does; `tn-desktop`
 * reads the same f64 oracles the comparator composes, which is the whole disagreement between them.
 */
function pose(
  fixture: IFoxesFixture,
  frame: number,
  fox: number,
  arm: "bevy-desktop" | "tn-desktop",
): Record<string, unknown> {
  const row = fixture.foxes[fox];
  const t = (DELTAS + frame) / 60;
  const arm32 = arm === "bevy-desktop";
  const value = arm32 ? f32OracleValue(fixture, fox, frame) : foxesOracleValue(fixture, fox, frame);
  // A skin-matrix entry is a world position: the ring's turn applied to a bone one rig unit out and
  // scaled by the fixture's own instance scale, so it inherits the same f32 drift on a short lever.
  const scale = row?.scale[0] ?? 1;
  const entry = f32(scale * Math.cos(ringAngle(fixture, frame, arm)));
  return {
    bonePoses: [
      [0, 0, 0, 0, 0, 0, 1],
      [0, value, 0, 0, 0, 0, 1],
    ],
    index: fox,
    joints: JOINTS,
    oracleRotation: [0, 0, 0, 1],
    oracleTranslation: [0, value, 0],
    poseScalar: arm32 ? f32((row?.phase ?? 0) + t) : (row?.phase ?? 0) + t,
    ring: 0,
    skinMatrices: [[entry, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]],
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
        foxes: fixture.probeFoxIndices.map((fox) => pose(fixture, frame, fox, arm)),
        poseScalars: fixture.foxes.map((fox) => fox.phase + (DELTAS + frame) / 60),
        rings: fixture.rings.map((ring) => ({
          index: ring.index,
          rotation:
            arm === "bevy-desktop"
              ? f32RingRotation(fixture, frame)
              : foxesRingRotation(fixture, ring.index, frame),
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

/** The synchronized cell: upstream seeks no phase there, so every fox's phase is zero. */
function syncFixture(): IFoxesFixture {
  return makeFixture({
    variant: "sync",
    foxes: [0, 1, 2, 3].map((index) => ({
      entityIndex: 10 + index,
      index,
      joints: JOINTS,
      phase: 0,
      ring: 0,
      ringRadius: 2,
      rotation: [0, 0, 0, 1],
      scale: [0.01, 0.01, 0.01],
      translation: [2, 0, 0],
    })),
  });
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

  it("keeps both variants inside the frozen band over the whole sampled schedule", () => {
    // This replaces the retained-pair regression that read `artifacts/engine-load-test/foxes-50-*`,
    // which is gitignored and therefore absent on a clean checkout: the suite has to prove the band
    // from the fixture's own schedule or it proves nothing for anyone but the machine that ran the
    // cell. The arithmetic is reproduced instead — the counterexample arm's f32 clock and f32 ring
    // quaternions against the counterpart arm's f64 oracles, over the six frames §6.2 names, on both
    // variants including the synchronized one that shares a single pose.
    //
    // The band was widened from 1e-4/1e-5 to 1e-3/4e-3 after the first real 600-frame pair failed it
    // at 1.76e-4 on a bone and 4.96e-4 on a skin matrix, so this pins the frozen band as it stands
    // and is not preregistration. The f32 clock's drift is reproduced — 1.9e-4 here against 1.76e-4
    // measured — and the skin-matrix arm is a single f32 lever, not the real rig's 24-joint chain,
    // so that half only proves the band is not exceeded, never that it is needed.
    for (const fixture of [makeFixture(), syncFixture()]) {
      const variant = fixture.variant;
      const comparison = compare(fixture);
      expect(`${variant}:${comparison.outcome.problems.join(",")}`).toBe(`${variant}:`);
      expect(comparison.outcome.comparability).toBe("qualified");
      expect(comparison.conformance.frames).toEqual(STATE_FRAMES);
      expect(comparison.conformance.withinTolerance).toBe(true);
      // The f32 clock's own drift at the measured horizon: above the 1e-4 it failed, inside the
      // frozen 1e-3, and far above the counterpart arm's double-accumulated oracle.
      expect(comparison.conformance.perArm.bevy.oracleMaxDelta).toBeGreaterThan(1e-4);
      expect(comparison.conformance.perArm.bevy.oracleMaxDelta).toBeLessThanOrEqual(
        FOXES_TOLERANCE.oracleAbs,
      );
      expect(comparison.conformance.perArm.tn.oracleMaxDelta).toBeLessThan(1e-9);
      expect(comparison.conformance.perArm.bevy.oracleMaxDelta).toBeGreaterThan(
        comparison.conformance.perArm.tn.oracleMaxDelta,
      );
      expect(comparison.conformance.crossArm.boneMaxDelta).toBeGreaterThan(1e-4);
      expect(comparison.conformance.crossArm.boneMaxDelta).toBeLessThanOrEqual(
        FOXES_TOLERANCE.boneAbs,
      );
      expect(comparison.conformance.crossArm.skinMatrixMaxDelta).toBeLessThanOrEqual(
        FOXES_TOLERANCE.matrixAbs,
      );
      expect(comparison.conformance.crossArm.poseScalarMaxDelta).toBeLessThanOrEqual(
        FOXES_TOLERANCE.poseScalarAbs,
      );
      // One pose per fox staggered, one shared pose synchronized, on both sides.
      expect(comparison.conformance.distinctPoses).toEqual({
        bevy: variant === "sync" ? 1 : fixture.counts.foxes,
        tn: variant === "sync" ? 1 : fixture.counts.foxes,
      });
      expect(comparison.ratio?.verdict).toBe("insufficient");
    }
  });
});
