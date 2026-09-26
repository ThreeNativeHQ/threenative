import {
  FOXES_ACTIVE_CLIP,
  FOXES_ASSET_SHA256,
  FOXES_TOLERANCE,
  FOXES_UPSTREAM_COMMIT,
  type IFoxesFixture,
  foxesMaxDelta,
  foxesOracleTime,
  foxesOracleValue,
  foxesRingRotation,
  foxesRotationDelta,
  foxesTimeDeltas,
} from "../../examples/engine-load-test/src/foxes-fixture.js";

/**
 * PRD-449 `bevy-many-foxes`: the comparison between the pinned upstream Bevy arm and the ThreeNative
 * counterpart arm on the fixture Bevy exported. Pure, so every rule is unit-proved without a GPU, and
 * deliberately strict: a pair whose asset, clip, skeleton, census, viewport, frame schedule or
 * per-frame state disagrees is reported as non-comparable rather than as a speedup.
 *
 * Two classes of check live here, and the difference matters. The **oracles** — each ring's rotation,
 * each fox's clip time and the oracle channel's value at it — are composed in f64 from the fixture's
 * own schedule, so each arm is checked against the schedule rather than against the other arm. The
 **bone poses have no f64 oracle**: they are the product of the evaluation under test, so the only
 * honest check is that the two engines agree with each other within tolerance, that they move when
 * the animation is active, and that the staggered variant's foxes differ from one another while the
 * synchronized variant's do not.
 *
 * What this deliberately does not do is settle a winner. One smoke block with no A/A calibration
 * supports no faster/slower verdict (§8), so the ratio is an observation and the verdict is
 * `insufficient`.
 */

export interface IFoxesBonePose {
  readonly bonePoses: readonly (readonly number[])[];
  readonly index: number;
  readonly joints: number;
  readonly oracleRotation: readonly number[];
  readonly oracleTranslation: readonly number[];
  readonly poseScalar: number;
  readonly ring: number;
  readonly skinMatrices: readonly (readonly number[])[];
}

export interface IFoxesState {
  readonly foxes: readonly IFoxesBonePose[];
  readonly frameId: number;
  readonly poseScalars: readonly number[];
  readonly ringSystemRuns: number;
  readonly rings: readonly { index: number; rotation: readonly number[] }[];
}

export interface IFoxesRun {
  readonly adapter: Record<string, unknown> | null;
  readonly arm: string;
  readonly asset: { bytes: number; sha256: string };
  readonly bindposeDigest: string | null;
  readonly boundarySemantics: string | null;
  readonly clipDigest: string | null;
  readonly clipName: string | null;
  readonly drain: { boundaryFrame: number; includesUntimedFrames: number } | null;
  readonly family: string;
  readonly fixture: { hash: string | null; foxes: number; sourceCommit?: string };
  readonly frameIntervals: readonly number[];
  readonly frameSchedule: Record<string, unknown> | null;
  readonly jointNames: readonly string[] | null;
  readonly meanMs: number;
  readonly meshDigest: string | null;
  readonly profile: string;
  readonly states: readonly IFoxesState[];
  readonly variant: string;
  readonly viewport: { height: number; width: number } | null;
  readonly work: Record<string, unknown> | null;
}

const RUN = "TN_BENCH_FOXES_RUN";

function fail(code: string, detail: string): never {
  throw new Error(`${code}:${detail}`);
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(code, "expected an object");
  return value as Record<string, unknown>;
}

function count(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    fail(code, "expected a non-negative integer");
  return value;
}

function sample(value: unknown, code: string): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/** A component may be signed, so the non-negative timing reader must not be used on one. */
function finite(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(code, "not finite");
  return value;
}

function hexOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !/^[0-9a-f]{16}$/.test(value)) return null;
  return value;
}

function readMatrix(value: unknown, code: string): number[] {
  if (!Array.isArray(value) || value.length !== 16) fail(code, "a skin matrix is not 4x4");
  return value.map((entry) => finite(entry, code));
}

function readPose(value: unknown, code: string): IFoxesBonePose {
  const pose = object(value, code);
  const poses = pose.bonePoses;
  if (!Array.isArray(poses) || poses.length === 0) fail(code, "no bone poses");
  const joints = count(pose.joints, `${code}.joints`);
  if (poses.length !== joints) fail(code, "the bone pose count must be the joint count");
  const bones = poses.map((bone, index) => {
    if (!Array.isArray(bone) || bone.length !== 7)
      fail(`${code}.bonePoses[${index}]`, "a bone pose is position plus quaternion");
    return bone.map((entry) => finite(entry, `${code}.bonePoses[${index}]`));
  });
  const matrices = pose.skinMatrices;
  if (!Array.isArray(matrices) || matrices.length === 0) fail(code, "no skin matrices");
  return {
    bonePoses: bones,
    index: count(pose.index, `${code}.index`),
    joints,
    oracleRotation: Array.isArray(pose.oracleRotation)
      ? pose.oracleRotation.map((entry) => finite(entry, `${code}.oracleRotation`))
      : fail(code, "no oracle rotation"),
    oracleTranslation: Array.isArray(pose.oracleTranslation)
      ? pose.oracleTranslation.map((entry) => finite(entry, `${code}.oracleTranslation`))
      : fail(code, "no oracle translation"),
    poseScalar: finite(pose.poseScalar, `${code}.poseScalar`),
    ring: count(pose.ring, `${code}.ring`),
    skinMatrices: matrices.map((entry) => readMatrix(entry, `${code}.skinMatrices`)),
  };
}

/**
 * The two arms time their frames differently and neither shares a definition with the other, so the
 * reader takes the intervals where the producer left them: `N+1` boundary timestamps whose
 * differences are the intervals, plus the final completion observation §7.4's completed-work mean
 * needs. A run that keeps neither is refused rather than scored from a mean.
 */
function readSeries(raw: Record<string, unknown>): {
  frameIntervals: readonly number[];
  finalCompletionMs: number;
} {
  const series = object(raw.rawSeries, RUN);
  const boundaries = series.boundaries;
  if (!Array.isArray(boundaries) || boundaries.length < 2) fail(RUN, "no frame boundaries");
  const stamps = boundaries.map((entry) => sample(object(entry, RUN).monotonicMs, RUN));
  if (stamps.some((value) => value === null)) fail(RUN, "a frame boundary is missing");
  const ordered = stamps as number[];
  const out: number[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const delta = (ordered[index] as number) - (ordered[index - 1] as number);
    if (delta < 0) fail(RUN, "frame boundaries must not decrease");
    out.push(delta);
  }
  const finalCompletionMs = sample(series.finalCompletionMs, RUN);
  if (finalCompletionMs === null) fail(RUN, "no final completion observation");
  return { finalCompletionMs, frameIntervals: out };
}

export function parseFoxesRun(raw: unknown): IFoxesRun {
  const root = object(raw, RUN);
  if (root.family !== "bevy-many-foxes") fail(RUN, "family");
  const meanMs = sample(root.meanMs, RUN);
  if (meanMs === null || meanMs <= 0)
    fail(RUN, "a completed-work mean of zero means no frame completed");
  const { frameIntervals } = readSeries(root);
  const fixture = object(root.fixture, `${RUN}.fixture`);
  if (fixture.sourceCommit !== FOXES_UPSTREAM_COMMIT)
    fail(RUN, "the fixture must name the pinned upstream commit");
  const rawStates = root.states;
  if (!Array.isArray(rawStates) || rawStates.length === 0)
    fail(RUN, "a run with no sampled state has no conformance evidence");
  const states: IFoxesState[] = rawStates.map((entry, index) => {
    const state = object(entry, `${RUN}.states[${index}]`);
    const inner = object(state.state, `${RUN}.states[${index}].state`);
    const foxes = inner.foxes;
    if (!Array.isArray(foxes) || foxes.length === 0)
      fail(RUN, "a sampled state carried no probed fox");
    const rings = inner.rings;
    if (!Array.isArray(rings) || rings.length === 0) fail(RUN, "a sampled state carried no ring");
    const scalars = inner.poseScalars;
    if (!Array.isArray(scalars) || scalars.length === 0)
      fail(RUN, "a sampled state carried no pose scalar");
    return {
      foxes: foxes.map((fox, foxIndex) =>
        readPose(fox, `${RUN}.states[${index}].foxes[${foxIndex}]`),
      ),
      frameId: count(state.frameId, `${RUN}.states[${index}].frameId`),
      poseScalars: scalars.map((scalar) => finite(scalar, `${RUN}.poseScalars`)),
      ringSystemRuns: count(inner.ringSystemRuns, `${RUN}.ringSystemRuns`),
      rings: rings.map((ring, ringIndex) => {
        const row = object(ring, `${RUN}.states[${index}].rings[${ringIndex}]`);
        const rotation = row.rotation;
        if (!Array.isArray(rotation) || rotation.length !== 4)
          fail(RUN, "a ring rotation is not four components");
        return {
          index: count(row.index, `${RUN}.rings[${ringIndex}].index`),
          rotation: rotation.map((entry) => finite(entry, `${RUN}.rings[${ringIndex}].rotation`)),
        };
      }),
    };
  });
  const asset = object(root.asset, `${RUN}.asset`);
  return {
    adapter: (root.adapter ?? null) as Record<string, unknown> | null,
    arm: String(root.arm),
    asset: {
      bytes: count(asset.bytes, `${RUN}.asset.bytes`),
      sha256: typeof asset.sha256 === "string" ? asset.sha256 : "",
    },
    bindposeDigest: hexOrNull(root.bindposeDigest),
    boundarySemantics: typeof root.boundarySemantics === "string" ? root.boundarySemantics : null,
    clipDigest: hexOrNull(root.clipDigest),
    clipName: typeof root.clipName === "string" ? root.clipName : null,
    drain: (root.drain ?? null) as IFoxesRun["drain"],
    family: root.family as string,
    fixture: {
      foxes: count(fixture.foxes, `${RUN}.fixture.foxes`),
      hash: typeof fixture.hash === "string" ? fixture.hash : null,
      sourceCommit: fixture.sourceCommit as string,
    },
    frameIntervals,
    frameSchedule: (root.frameSchedule ?? null) as Record<string, unknown> | null,
    jointNames: Array.isArray(root.jointNames) ? (root.jointNames as string[]) : null,
    meanMs,
    meshDigest: hexOrNull(root.meshDigest),
    profile: String(root.profile ?? "smoke"),
    states,
    variant: String(root.variant),
    viewport: (root.viewport ?? null) as IFoxesRun["viewport"],
    work: (root.work ?? null) as Record<string, unknown> | null,
  };
}

export interface IFoxesComparison {
  readonly arms: {
    bevy: { arm: string; meanMs: number };
    tn: { arm: string; meanMs: number };
  };
  readonly asset: {
    readonly bytes: number;
    readonly bevy: string | null;
    readonly clip: { bevy: string | null; expected: string; tn: string | null };
    readonly expected: string;
    readonly mesh: { bevy: string | null; expected: string; tn: string | null };
    readonly skin: { bevy: string | null; expected: string; tn: string | null };
    readonly tn: string | null;
  };
  readonly blocks: number;
  readonly census: Record<string, unknown>;
  readonly conformance: {
    /** Per arm, so a divergence names which side it is on instead of only the worse of the two. */
    readonly perArm: {
      bevy: IFoxesArmConformance;
      tn: IFoxesArmConformance;
    };
    readonly crossArm: {
      boneMaxDelta: number;
      poseScalarMaxDelta: number;
      skinMatrixMaxDelta: number;
    };
    readonly distinctPoses: { bevy: number; tn: number };
    readonly frames: readonly number[];
    readonly tolerance: typeof FOXES_TOLERANCE;
    readonly withinTolerance: boolean;
  };
  readonly outcome: {
    readonly comparability: "matched-task" | "non-comparable" | "qualified";
    readonly comparabilityReason: string | null;
    readonly problems: readonly string[];
    readonly valid: boolean;
  };
  readonly profile: string;
  readonly ratio: {
    readonly bevyMeanMs: number;
    readonly ratio: number;
    readonly reason: string;
    readonly tnMeanMs: number;
    readonly verdict: "insufficient";
  } | null;
}

export interface IFoxesArmConformance {
  boneMoved: boolean;
  oracleMaxDelta: number;
  poseScalarMoved: boolean;
  ringMaxDelta: number;
  worstOracleFrame: number | null;
  worstRingFrame: number | null;
}

/** The pose scalars' rounding that decides whether two foxes carry the same pose. */
const POSE_KEY_DIGITS = 6;

function distinctPoses(scalars: readonly number[]): number {
  return new Set(scalars.map((value) => value.toFixed(POSE_KEY_DIGITS))).size;
}

export function compareFoxesRuns(
  fixture: IFoxesFixture,
  bevy: IFoxesRun,
  tn: IFoxesRun,
): IFoxesComparison {
  const problems: string[] = [];
  const push = (code: string): void => {
    problems.push(code);
  };

  if (bevy.arm !== "bevy-desktop") push("TN_BENCH_FOXES_BAD_ARM:bevy");
  if (tn.arm !== "tn-desktop") push("TN_BENCH_FOXES_BAD_ARM:tn");
  if (bevy.variant !== tn.variant) push("TN_BENCH_FOXES_VARIANT_MISMATCH");
  if (tn.variant !== fixture.variant) push("TN_BENCH_FOXES_VARIANT_FIXTURE_MISMATCH");
  if (bevy.fixture.foxes !== fixture.counts.foxes || tn.fixture.foxes !== fixture.counts.foxes)
    push("TN_BENCH_FOXES_CENSUS_MISMATCH");
  if (tn.fixture.hash === null) push("TN_BENCH_FOXES_FIXTURE_HASH_ABSENT");

  // The same asset bytes, on both sides and in the fixture. The Bevy arm's own digest is absent by
  // construction — the pinned Rust dependencies carry no SHA-256 — so its half of this is the fixture
  // it wrote, which the runner hashed from the same path the counterpart arm's build read.
  const expectedClip = fixture.clips[FOXES_ACTIVE_CLIP]?.digest ?? "";
  if (bevy.asset.sha256 !== FOXES_ASSET_SHA256)
    push(`TN_BENCH_FOXES_ASSET_MISMATCH:bevy:${bevy.asset.sha256}`);
  if (tn.asset.sha256 !== FOXES_ASSET_SHA256) push("TN_BENCH_FOXES_ASSET_MISMATCH:tn");
  if (tn.asset.bytes !== fixture.asset.bytes) push("TN_BENCH_FOXES_ASSET_BYTES:tn");
  if (tn.clipDigest === null || tn.clipDigest !== expectedClip)
    push(`TN_BENCH_FOXES_CLIP_DIGEST:tn:${String(tn.clipDigest)}`);
  if (tn.clipName !== fixture.clips[FOXES_ACTIVE_CLIP]?.name) push("TN_BENCH_FOXES_CLIP_NAME:tn");
  if (tn.bindposeDigest === null || tn.bindposeDigest !== fixture.skin.bindposeDigest)
    push(`TN_BENCH_FOXES_BINDPOSE_DIGEST:tn:${String(tn.bindposeDigest)}`);
  if (tn.meshDigest === null || tn.meshDigest !== fixture.mesh.digest)
    push(`TN_BENCH_FOXES_MESH_DIGEST:tn:${String(tn.meshDigest)}`);
  if (tn.jointNames === null || tn.jointNames.join("\u0000") !== fixture.skin.joints.join("\u0000"))
    push("TN_BENCH_FOXES_JOINT_ORDER:tn");

  for (const [name, run] of [
    ["bevy", bevy],
    ["tn", tn],
  ] as const) {
    if (run.frameIntervals.length !== fixture.frameSchedule.measuredFrames)
      push(`TN_BENCH_FOXES_FRAME_COUNT_MISMATCH:${name}`);
    if (run.drain === null) push(`TN_BENCH_FOXES_DRAIN_ABSENT:${name}`);
    if (run.boundarySemantics === null) push(`TN_BENCH_FOXES_BOUNDARY_SEMANTICS_ABSENT:${name}`);
    if (run.viewport === null) push(`TN_BENCH_FOXES_VIEWPORT_ABSENT:${name}`);
    if (run.work === null) push(`TN_BENCH_FOXES_WORK_ABSENT:${name}`);
  }
  if (bevy.frameSchedule === null) push("TN_BENCH_FOXES_SCHEDULE_ABSENT:bevy");
  if (
    tn.viewport !== null &&
    (tn.viewport.width !== fixture.viewport.width || tn.viewport.height !== fixture.viewport.height)
  )
    push("TN_BENCH_FOXES_VIEWPORT_MISMATCH:tn");
  if (bevy.viewport !== null && tn.viewport !== null && bevy.viewport.width !== tn.viewport.width)
    push("TN_BENCH_FOXES_VIEWPORT_MISMATCH:bevy");
  if (fixture.environment.shadowMapsEnabled) push("TN_BENCH_FOXES_SHADOWS_ENABLED");
  if (fixture.environment.motionBlur) push("TN_BENCH_FOXES_MOTION_BLUR_ENABLED");
  if (fixture.camera.msaa !== "Off") push(`TN_BENCH_FOXES_MSAA:${fixture.camera.msaa}`);
  if (fixture.light.shadowMapsEnabled) push("TN_BENCH_FOXES_LIGHT_SHADOWS_ENABLED");
  // §5.1's required mutations in reverse: a shadow-enabled cell here would be a different cell, and
  // a zero where a counter should be is the lie the family already refused once.
  if (bevy.work !== null && bevy.work.submittedDrawCalls === 0)
    push("TN_BENCH_FOXES_DRAW_COUNTER_ZERO");
  if (tn.work !== null) {
    if (tn.work.shadowMapsEnabled === true) push("TN_BENCH_FOXES_SHADOWS_ENABLED:tn");
    const mixers = tn.work.mixers;
    if (typeof mixers !== "number" || mixers !== fixture.counts.foxes)
      push("TN_BENCH_FOXES_MIXER_COUNT:tn");
  }

  const empty = (): IFoxesArmConformance => ({
    boneMoved: false,
    oracleMaxDelta: 0,
    poseScalarMoved: false,
    ringMaxDelta: 0,
    worstOracleFrame: null,
    worstRingFrame: null,
  });
  const perArm = { bevy: empty(), tn: empty() };
  const crossArm = { boneMaxDelta: 0, poseScalarMaxDelta: 0, skinMatrixMaxDelta: 0 };
  const bevyFrames = new Map(bevy.states.map((state) => [state.frameId, state]));
  const tnFrames = new Map(tn.states.map((state) => [state.frameId, state]));
  if (bevyFrames.size !== tnFrames.size) push("TN_BENCH_FOXES_STATE_FRAME_SET_MISMATCH");
  const frames: number[] = [];
  for (const [frameId, bevyState] of bevyFrames) {
    const tnState = tnFrames.get(frameId);
    if (tnState === undefined) {
      push(`TN_BENCH_FOXES_STATE_UNPAIRED:${frameId}`);
      continue;
    }
    frames.push(frameId);
    for (const [name, state] of [
      ["bevy", bevyState],
      ["tn", tnState],
    ] as const) {
      if (state.rings.length !== fixture.rings.length)
        push(`TN_BENCH_FOXES_RING_COUNT:${name}:${frameId}`);
      if (state.poseScalars.length !== fixture.counts.foxes)
        push(`TN_BENCH_FOXES_POSE_CENSUS:${name}:${frameId}`);
      if (state.ringSystemRuns < 1) push(`TN_BENCH_FOXES_RINGS_NOT_RUN:${name}:${frameId}`);
      for (const ring of state.rings) {
        const expected = foxesRingRotation(fixture, ring.index, frameId);
        const delta = foxesRotationDelta(ring.rotation, expected);
        if (delta > perArm[name].ringMaxDelta) {
          perArm[name].ringMaxDelta = delta;
          perArm[name].worstRingFrame = frameId;
        }
      }
      for (const probe of state.foxes) {
        if (!fixture.probeFoxIndices.includes(probe.index))
          push(`TN_BENCH_FOXES_PROBE_UNEXPECTED:${name}:${probe.index}`);
        if (probe.joints !== fixture.counts.joints)
          push(`TN_BENCH_FOXES_PROBE_JOINTS:${name}:${probe.index}`);
        // The oracle channel's value, from the fixture's own keys at the f64 clip time this fox must
        // have reached. This is the check the declared step count exists for.
        const channel = fixture.oracleChannel;
        const observed =
          channel.property === "translation"
            ? (probe.oracleTranslation[channel.component] as number)
            : (probe.oracleRotation[channel.component] as number);
        const expected = foxesOracleValue(fixture, probe.index, frameId);
        const delta = Math.abs(observed - expected);
        if (delta > perArm[name].oracleMaxDelta) {
          perArm[name].oracleMaxDelta = delta;
          perArm[name].worstOracleFrame = frameId;
        }
      }
    }
    // Cross-arm: the bone poses have no f64 oracle, so agreement is the evidence.
    for (const probe of bevyState.foxes) {
      const other = tnState.foxes.find((entry) => entry.index === probe.index);
      if (other === undefined) {
        push(`TN_BENCH_FOXES_PROBE_UNPAIRED:${probe.index}`);
        continue;
      }
      if (other.bonePoses.length !== probe.bonePoses.length) {
        push(`TN_BENCH_FOXES_PROBE_JOINT_COUNT:${probe.index}`);
        continue;
      }
      for (let bone = 0; bone < probe.bonePoses.length; bone += 1) {
        crossArm.boneMaxDelta = Math.max(
          crossArm.boneMaxDelta,
          foxesMaxDelta(other.bonePoses[bone] as number[], probe.bonePoses[bone] as number[]),
        );
      }
      if (other.skinMatrices.length !== probe.skinMatrices.length) {
        push(`TN_BENCH_FOXES_SKIN_MATRIX_COUNT:${probe.index}`);
        continue;
      }
      for (let joint = 0; joint < probe.skinMatrices.length; joint += 1) {
        crossArm.skinMatrixMaxDelta = Math.max(
          crossArm.skinMatrixMaxDelta,
          foxesMaxDelta(
            other.skinMatrices[joint] as number[],
            probe.skinMatrices[joint] as number[],
          ),
        );
      }
      crossArm.poseScalarMaxDelta = Math.max(
        crossArm.poseScalarMaxDelta,
        Math.abs(other.poseScalar - probe.poseScalar),
      );
    }
    if (bevyState.poseScalars.length === tnState.poseScalars.length)
      for (let fox = 0; fox < bevyState.poseScalars.length; fox += 1)
        crossArm.poseScalarMaxDelta = Math.max(
          crossArm.poseScalarMaxDelta,
          Math.abs((tnState.poseScalars[fox] as number) - (bevyState.poseScalars[fox] as number)),
        );
  }

  // §5.1: every character needs its own evaluated skeleton. In the synchronized variant every fox
  // must therefore carry the *same* pose, and in the staggered variant every fox must carry its own —
  // a single shared pose there is the exact substitution the family forbids.
  const first = bevy.states[0];
  const distinct = {
    bevy: first === undefined ? 0 : distinctPoses(first.poseScalars),
    tn: tn.states[0] === undefined ? 0 : distinctPoses(tn.states[0].poseScalars),
  };
  if (fixture.variant === "sync") {
    if (distinct.bevy !== 1) push(`TN_BENCH_FOXES_SYNC_NOT_SHARED:bevy:${distinct.bevy}`);
    if (distinct.tn !== 1) push(`TN_BENCH_FOXES_SYNC_NOT_SHARED:tn:${distinct.tn}`);
  } else {
    if (distinct.bevy !== fixture.counts.foxes)
      push(`TN_BENCH_FOXES_STAGGERED_SHARED_POSE:bevy:${distinct.bevy}`);
    if (distinct.tn !== fixture.counts.foxes)
      push(`TN_BENCH_FOXES_STAGGERED_SHARED_POSE:tn:${distinct.tn}`);
  }

  // The animation must be live on both arms: a pose that never moves is the frozen-animation mutation
  // §6.2 names, and it would otherwise pass every cross-arm comparison unchanged. The comparison is
  // over the whole pose, not one bone: joint 0 is `_rootJoint`, which the clip never drives, so a
  // check pinned to it would report every arm frozen whatever it did.
  for (const [name, run] of [
    ["bevy", bevy],
    ["tn", tn],
  ] as const) {
    const first = run.states[0];
    if (first === undefined || run.states.length < 2) {
      // A single sampled frame cannot show motion; saying so is better than reporting a freeze.
      push(`TN_BENCH_FOXES_TOO_FEW_STATES:${name}`);
      continue;
    }
    const reference = first.foxes[0];
    if (reference === undefined) {
      push(`TN_BENCH_FOXES_NO_PROBED_FOX:${name}`);
      continue;
    }
    let bones = 0;
    let scalars = 0;
    for (const state of run.states) {
      const probe = state.foxes.find((entry) => entry.index === reference.index);
      if (probe === undefined) continue;
      for (let bone = 0; bone < reference.bonePoses.length; bone += 1) {
        const other = probe.bonePoses[bone];
        if (other === undefined) continue;
        bones = Math.max(bones, foxesMaxDelta(other, reference.bonePoses[bone] as number[]));
      }
      const scalar = state.poseScalars[reference.index];
      if (scalar !== undefined)
        scalars = Math.max(
          scalars,
          Math.abs(scalar - (first.poseScalars[reference.index] ?? scalar)),
        );
    }
    perArm[name].boneMoved = bones > FOXES_TOLERANCE.boneAbs;
    perArm[name].poseScalarMoved = scalars > FOXES_TOLERANCE.poseScalarAbs;
    if (!perArm[name].boneMoved) push(`TN_BENCH_FOXES_ANIMATION_FROZEN:${name}`);
    if (!perArm[name].poseScalarMoved) push(`TN_BENCH_FOXES_POSE_FROZEN:${name}`);
  }

  const withinTolerance =
    perArm.bevy.ringMaxDelta <= FOXES_TOLERANCE.quaternionAbs &&
    perArm.tn.ringMaxDelta <= FOXES_TOLERANCE.quaternionAbs &&
    perArm.bevy.oracleMaxDelta <= FOXES_TOLERANCE.oracleAbs &&
    perArm.tn.oracleMaxDelta <= FOXES_TOLERANCE.oracleAbs &&
    crossArm.boneMaxDelta <= FOXES_TOLERANCE.boneAbs &&
    crossArm.skinMatrixMaxDelta <= FOXES_TOLERANCE.matrixAbs &&
    crossArm.poseScalarMaxDelta <= FOXES_TOLERANCE.poseScalarAbs;
  if (!withinTolerance) push("TN_BENCH_FOXES_STATE_OUT_OF_TOLERANCE");

  const valid = problems.length === 0;
  const ratio =
    valid && bevy.meanMs > 0 && tn.meanMs > 0
      ? {
          bevyMeanMs: bevy.meanMs,
          ratio: bevy.meanMs / tn.meanMs,
          reason:
            "one smoke block and no A/A calibration band, so §8 supports no faster/slower verdict; this is an observation to be re-measured over seven paired blocks",
          tnMeanMs: tn.meanMs,
          verdict: "insufficient" as const,
        }
      : null;

  return {
    arms: {
      bevy: { arm: bevy.arm, meanMs: bevy.meanMs },
      tn: { arm: tn.arm, meanMs: tn.meanMs },
    },
    asset: {
      bevy: bevy.asset.sha256,
      bytes: fixture.asset.bytes,
      // The Bevy arm's own digests of the pinned file are what the fixture carries; the counterpart
      // arm recomputes each from the bytes its own loader parsed, and the equality is the check.
      clip: { bevy: expectedClip, expected: expectedClip, tn: tn.clipDigest },
      expected: FOXES_ASSET_SHA256,
      mesh: { bevy: fixture.mesh.digest, expected: fixture.mesh.digest, tn: tn.meshDigest },
      skin: {
        bevy: fixture.skin.bindposeDigest,
        expected: fixture.skin.bindposeDigest,
        tn: tn.bindposeDigest,
      },
      tn: tn.asset.sha256,
    },
    blocks: 1,
    census: {
      activeClip: fixture.clips[FOXES_ACTIVE_CLIP]?.name ?? null,
      activeClipDuration: fixture.clips[FOXES_ACTIVE_CLIP]?.duration ?? null,
      clipChannels: fixture.clips[FOXES_ACTIVE_CLIP]?.channels ?? null,
      clipInterpolation: fixture.clips[FOXES_ACTIVE_CLIP]?.interpolation ?? null,
      firstScoredFrameTimeDeltas: fixture.frameSchedule.firstScoredFrameTimeDeltas,
      frameSchedule: fixture.frameSchedule,
      foxes: fixture.counts.foxes,
      joints: fixture.counts.joints,
      mesh: fixture.mesh,
      oracleChannel: {
        component: fixture.oracleChannel.component,
        keys: fixture.oracleChannel.times.length,
        node: fixture.oracleChannel.node,
        property: fixture.oracleChannel.property,
      },
      probeFoxIndices: fixture.probeFoxIndices,
      rings: fixture.rings,
      viewport: fixture.viewport,
    },
    conformance: {
      crossArm,
      distinctPoses: distinct,
      frames: frames.sort((a, b) => a - b),
      perArm,
      tolerance: FOXES_TOLERANCE,
      withinTolerance,
    },
    outcome: {
      // Never `matched-task`: the two renderers shade differently, Bevy's window background is not
      // three's, and each side generates the normals the pinned asset does not carry. §3.2 makes
      // those qualifications on a comparison that agrees on everything else.
      comparability: valid ? "qualified" : "non-comparable",
      comparabilityReason: valid
        ? "identical asset bytes, clip digest, skeleton digest, mesh digest, census, viewport and frame schedule; the shaded environments differ (bevy PBR with its own window clear colour against three's MeshStandardMaterial on a black background, and each side generates the normals the pinned asset declares no values for), which §3.2 makes qualifications rather than mismatches"
        : null,
      problems,
      valid,
    },
    profile: "smoke",
    ratio,
  };
}

export { foxesOracleTime, foxesTimeDeltas };
