import {
  CUBES_TOLERANCE,
  CUBES_UPSTREAM_COMMIT,
  type ICubesFixture,
  canonicalAdmittedCubes,
  cubesCameraRotation,
  cubesObjectRotation,
  cubesRotationDelta,
} from "../../examples/engine-load-test/src/cubes-fixture.js";

/**
 * PRD-449 `bevy-many-cubes`: the comparison between the pinned upstream Bevy arm and the ThreeNative
 * counterpart arm on the fixture Bevy exported. Pure, so every rule here is unit-proved without a
 * GPU, and deliberately strict: a pair whose fixture, census, viewport, frame schedule or per-frame
 * state disagrees is reported as non-comparable rather than as a speedup.
 *
 * What it deliberately does *not* do is settle a winner. One smoke block with no A/A calibration
 * supports no faster/slower verdict (§8), so the ratio is reported as an observation and the
 * verdict is `insufficient`.
 */

/**
 * How far the two arms' admitted-object counts may differ, preregistered. Both render the same
 * exported vertices through the same camera, so the admitted sets should be identical; the band
 * exists only because one engine tests a bounding sphere and the other a triangle, which can disagree
 * for an object straddling a plane. One percent of the frame's cubes is far above the handful of
 * straddling objects and far below a dropped set.
 */
export const CUBES_ADMITTED_TOLERANCE = 0.01;

export interface ICubesState {
  readonly frameId: number;
  readonly cameraRotation: readonly number[];
  readonly probes: readonly { readonly index: number; readonly rotation: readonly number[] }[];
}

export interface ICubesRun {
  readonly adapter: Record<string, unknown> | null;
  readonly arm: string;
  readonly authoring?: string;
  readonly boundarySemantics: string | null;
  readonly drain: { boundaryFrame: number; includesUntimedFrames: number } | null;
  readonly family: string;
  readonly fixture: { hash: string | null; objects: number; sourceCommit?: string };
  readonly frameIntervals: readonly number[];
  readonly frameSchedule: Record<string, unknown> | null;
  readonly meanMs: number;
  readonly profile: string;
  readonly rawSeries?: unknown;
  readonly states: readonly ICubesState[];
  readonly variant: string;
  readonly viewport: { height: number; width: number } | null;
  readonly work: Record<string, unknown> | null;
}

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

/** A rotation component is signed, so the non-negative timing reader must not be used on one. */
function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail("TN_BENCH_CUBES_RUN", "not finite");
  return value;
}

/**
 * The two arms time their frames differently and neither shares a definition with the other, so the
 * reader takes the intervals where the producer left them: `N+1` boundary timestamps whose
 * differences are the intervals, plus the final completion observation §7.4's completed-work mean
 * needs. A run that keeps neither is refused rather than scored from a mean.
 */
function readSeries(
  raw: Record<string, unknown>,
  code: string,
): {
  frameIntervals: readonly number[];
  finalCompletionMs: number;
} {
  const series = object(raw.rawSeries, code);
  const boundaries = series.boundaries;
  if (!Array.isArray(boundaries) || boundaries.length < 2) fail(code, "no frame boundaries");
  const stamps = boundaries.map((entry) => sample(object(entry, code).monotonicMs, code));
  if (stamps.some((value) => value === null)) fail(code, "a frame boundary is missing");
  const ordered = stamps as number[];
  const out: number[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const delta = (ordered[index] as number) - (ordered[index - 1] as number);
    if (delta < 0) fail(code, "frame boundaries must not decrease");
    out.push(delta);
  }
  const finalCompletionMs = sample(series.finalCompletionMs, code);
  if (finalCompletionMs === null) fail(code, "no final completion observation");
  return { finalCompletionMs, frameIntervals: out };
}

export function parseCubesRun(raw: unknown): ICubesRun {
  const root = object(raw, "TN_BENCH_CUBES_RUN");
  if (root.family !== "bevy-many-cubes") fail("TN_BENCH_CUBES_RUN", "family");
  const meanMs = sample(root.meanMs, "TN_BENCH_CUBES_RUN");
  if (meanMs === null || meanMs <= 0)
    fail("TN_BENCH_CUBES_RUN", "a completed-work mean of zero means no frame completed");
  const { frameIntervals, finalCompletionMs } = readSeries(root, "TN_BENCH_CUBES_RUN");
  const fixture = object(root.fixture, "TN_BENCH_CUBES_RUN.fixture");
  if (fixture.sourceCommit !== CUBES_UPSTREAM_COMMIT)
    fail("TN_BENCH_CUBES_RUN", "the fixture must name the pinned upstream commit");
  const rawStates = root.states;
  if (!Array.isArray(rawStates) || rawStates.length === 0)
    fail("TN_BENCH_CUBES_RUN", "a run with no sampled state has no conformance evidence");
  const states: ICubesState[] = rawStates.map((entry, index) => {
    const state = object(entry, `TN_BENCH_CUBES_RUN.states[${index}]`);
    const probes = state.probes;
    if (!Array.isArray(probes) || probes.length === 0)
      fail("TN_BENCH_CUBES_RUN", "a sampled state carried no probe");
    const cameraRotation = state.cameraRotation;
    if (!Array.isArray(cameraRotation) || cameraRotation.length !== 4)
      fail("TN_BENCH_CUBES_RUN", "a sampled camera rotation is not four components");
    return {
      cameraRotation: cameraRotation.map((value) => finite(value)),
      frameId: count(state.frameId, "state.frameId"),
      probes: probes.map((probe, probeIndex) => {
        const read = object(probe, `TN_BENCH_CUBES_RUN.states[${index}].probes[${probeIndex}]`);
        const rotation = read.rotation;
        if (!Array.isArray(rotation) || rotation.length !== 4)
          fail("TN_BENCH_CUBES_RUN", "a probe rotation is not four components");
        return {
          index: count(read.index, "probe.index"),
          rotation: rotation.map((value) => finite(value)),
        };
      }),
    };
  });
  return {
    adapter: (root.adapter ?? null) as Record<string, unknown> | null,
    arm: String(root.arm),
    authoring: typeof root.authoring === "string" ? root.authoring : undefined,
    boundarySemantics: typeof root.boundarySemantics === "string" ? root.boundarySemantics : null,
    drain: (root.drain ?? null) as ICubesRun["drain"],
    family: root.family as string,
    fixture: {
      hash: typeof fixture.hash === "string" ? fixture.hash : null,
      objects: count(fixture.objects, "fixture.objects"),
      sourceCommit: fixture.sourceCommit as string,
    },
    frameIntervals,
    frameSchedule: (root.frameSchedule ?? null) as Record<string, unknown> | null,
    meanMs,
    profile: String(root.profile ?? "smoke"),
    rawSeries: root.rawSeries,
    states,
    variant: String(root.variant),
    viewport: (root.viewport ?? null) as ICubesRun["viewport"],
    work: (root.work ?? null) as Record<string, unknown> | null,
  };
}

export interface ICubesComparison {
  /** Both arms' own means, always: the observation does not wait for a verdict to exist. */
  readonly arms: {
    bevy: { arm: string; meanMs: number };
    tn: { arm: string; authoring: string | null; meanMs: number };
  };
  readonly outcome: {
    comparability: "matched-task" | "non-comparable" | "qualified";
    comparabilityReason: string | null;
    problems: readonly string[];
    valid: boolean;
  };
  readonly ratio: {
    /** Competitor mean over ThreeNative mean: greater than one means ThreeNative is faster. */
    ratio: number;
    tnMeanMs: number;
    bevyMeanMs: number;
    verdict: "insufficient";
    reason: string;
  } | null;
  readonly conformance: {
    /** The preregistered per-component quaternion tolerance both arms were checked against. */
    tolerance: number;
    cameraMaxDelta: number;
    probeMaxDelta: number;
    /** Per arm, so a divergence names which side it is on instead of only the worse of the two. */
    perArm: {
      bevy: { cameraMaxDelta: number; probeMaxDelta: number };
      tn: { cameraMaxDelta: number; probeMaxDelta: number };
    };
    /** The frame each arm's worst probe disagreement fell on, for the same reason. */
    worstFrame: { bevy: number | null; tn: number | null };
    frames: readonly number[];
    withinTolerance: boolean;
  };
  readonly census: Record<string, unknown>;
  readonly admitted: {
    canonical: number;
    cubes: number;
    tolerance: number;
    bevy: number | null;
    tn: number | null;
    withinTolerance: boolean;
  };
  readonly blocks: number;
  readonly profile: string;
}

export function compareCubesRuns(
  fixture: ICubesFixture,
  bevy: ICubesRun,
  tn: ICubesRun,
): ICubesComparison {
  const problems: string[] = [];
  const push = (code: string): void => {
    problems.push(code);
  };

  if (bevy.arm !== "bevy-desktop") push("TN_BENCH_CUBES_BAD_ARM:bevy");
  if (tn.arm !== "tn-desktop") push("TN_BENCH_CUBES_BAD_ARM:tn");
  if (bevy.variant !== tn.variant) push("TN_BENCH_CUBES_VARIANT_MISMATCH");
  if (bevy.variant !== fixture.variant) push("TN_BENCH_CUBES_VARIANT_FIXTURE_MISMATCH");
  if (bevy.fixture.objects !== fixture.counts.cubes || tn.fixture.objects !== fixture.counts.cubes)
    push("TN_BENCH_CUBES_CENSUS_MISMATCH");
  // The shared input bytes, not merely the same numbers: one arm's record is the file the other read.
  if (tn.fixture.hash === null) push("TN_BENCH_CUBES_FIXTURE_HASH_ABSENT");
  if (bevy.variant === "rotating" && !fixture.frameSchedule.rotateCubes)
    push("TN_BENCH_CUBES_ROTATION_SCHEDULE_MISMATCH");
  if (bevy.variant === "static" && fixture.frameSchedule.rotateCubes)
    push("TN_BENCH_CUBES_ROTATION_SCHEDULE_MISMATCH");

  for (const [name, run] of [
    ["bevy", bevy],
    ["tn", tn],
  ] as const) {
    if (run.frameIntervals.length !== fixture.frameSchedule.measuredFrames)
      push(`TN_BENCH_CUBES_FRAME_COUNT_MISMATCH:${name}`);
    if (run.drain === null) push(`TN_BENCH_CUBES_DRAIN_ABSENT:${name}`);
    if (run.boundarySemantics === null) push(`TN_BENCH_CUBES_BOUNDARY_SEMANTICS_ABSENT:${name}`);
    if (run.viewport === null) push(`TN_BENCH_CUBES_VIEWPORT_ABSENT:${name}`);
  }
  if (
    tn.viewport !== null &&
    (tn.viewport.width !== fixture.viewport.width || tn.viewport.height !== fixture.viewport.height)
  )
    push("TN_BENCH_CUBES_VIEWPORT_MISMATCH:tn");
  if (bevy.frameSchedule === null) push("TN_BENCH_CUBES_SCHEDULE_ABSENT:bevy");

  // State conformance against the f64 oracle, per arm, over the frames both sampled.
  const bevyFrames = new Map(bevy.states.map((state) => [state.frameId, state]));
  const tnFrames = new Map(tn.states.map((state) => [state.frameId, state]));
  if (bevyFrames.size !== tnFrames.size) push("TN_BENCH_CUBES_STATE_FRAME_SET_MISMATCH");
  let cameraMaxDelta = 0;
  let probeMaxDelta = 0;
  const perArm = {
    bevy: { cameraMaxDelta: 0, probeMaxDelta: 0 },
    tn: { cameraMaxDelta: 0, probeMaxDelta: 0 },
  };
  const worstFrame = { bevy: null as number | null, tn: null as number | null };
  const frames: number[] = [];
  for (const [frameId, bevyState] of bevyFrames) {
    const tnState = tnFrames.get(frameId);
    if (tnState === undefined) {
      push(`TN_BENCH_CUBES_STATE_UNPAIRED:${frameId}`);
      continue;
    }
    frames.push(frameId);
    const expectedCamera = cubesCameraRotation(fixture, frameId);
    for (const [name, state] of [
      ["bevy", bevyState],
      ["tn", tnState],
    ] as const) {
      const delta = cubesRotationDelta(state.cameraRotation, expectedCamera);
      perArm[name].cameraMaxDelta = Math.max(perArm[name].cameraMaxDelta, delta);
      cameraMaxDelta = Math.max(cameraMaxDelta, delta);
    }
    for (const index of fixture.probeIndices) {
      const expected = cubesObjectRotation(fixture, index, frameId);
      for (const [name, state] of [
        ["bevy", bevyState],
        ["tn", tnState],
      ] as const) {
        const probe = state.probes.find((entry) => entry.index === index);
        if (probe === undefined) {
          push(`TN_BENCH_CUBES_PROBE_UNOBSERVED:${index}`);
          continue;
        }
        const delta = cubesRotationDelta(probe.rotation, expected);
        if (delta > perArm[name].probeMaxDelta) {
          perArm[name].probeMaxDelta = delta;
          worstFrame[name] = frameId;
        }
        probeMaxDelta = Math.max(probeMaxDelta, delta);
      }
    }
  }
  const withinTolerance =
    cameraMaxDelta <= CUBES_TOLERANCE.quaternionAbs &&
    probeMaxDelta <= CUBES_TOLERANCE.quaternionAbs;
  if (!withinTolerance) push("TN_BENCH_CUBES_STATE_OUT_OF_TOLERANCE");

  // §5.1's "validate actual switch effects rather than trusting option names": a static arm must not
  // move and a rotating one must. Both are checked on the arms' own samples, not on the option name.
  const moved = (run: ICubesRun): boolean =>
    run.states.length > 1 &&
    run.states.some((state) =>
      state.probes.some((probe, position) => {
        const first = run.states[0]?.probes[position];
        return (
          first !== undefined &&
          first.index === probe.index &&
          first.rotation.some(
            (value, component) => Math.abs(value - (probe.rotation[component] as number)) > 1e-6,
          )
        );
      }),
    );
  if (fixture.variant === "static") {
    if (moved(bevy)) push("TN_BENCH_CUBES_STATIC_ARM_MOVED:bevy");
    if (moved(tn)) push("TN_BENCH_CUBES_STATIC_ARM_MOVED:tn");
  } else {
    if (!moved(bevy)) push("TN_BENCH_CUBES_ROTATION_NOT_OBSERVED:bevy");
    if (!moved(tn)) push("TN_BENCH_CUBES_ROTATION_NOT_OBSERVED:tn");
  }

  const midpoint = Math.floor(fixture.frameSchedule.measuredFrames / 2);
  const canonical = canonicalAdmittedCubes(fixture, midpoint);
  const bevyAdmitted = readAdmitted(bevy.work, "visibleObjects");
  const tnAdmitted = readAdmitted(tn.work, "admittedCubes");
  const band = Math.max(1, Math.round(canonical.cubes * CUBES_ADMITTED_TOLERANCE));
  const withinAdmitted = (value: number | null): boolean =>
    value === null || Math.abs(value - canonical.admitted) <= band;
  if (!withinAdmitted(bevyAdmitted)) push("TN_BENCH_CUBES_ADMITTED_DIVERGED:bevy");
  if (!withinAdmitted(tnAdmitted)) push("TN_BENCH_CUBES_ADMITTED_DIVERGED:tn");

  // Bevy exposes no submitted-draw counter to the main world. That is a null with a reason, which is
  // the PRD's rule for an unavailable metric, and never a zero that would look like free work.
  if (bevy.work !== null && bevy.work.submittedDrawCalls === 0)
    push("TN_BENCH_CUBES_DRAW_COUNTER_ZERO");

  const valid = problems.length === 0;
  const ratio =
    valid && bevy.meanMs > 0 && tn.meanMs > 0
      ? {
          bevyMeanMs: bevy.meanMs,
          // One smoke block, no A/A calibration: §8 supports no faster/slower verdict here, and the
          // ratio is the observation, not the claim.
          ratio: bevy.meanMs / tn.meanMs,
          reason:
            "one smoke block and no A/A calibration band, so §8 supports no faster/slower verdict; this is an observation to be re-measured over seven paired blocks",
          tnMeanMs: tn.meanMs,
          verdict: "insufficient" as const,
        }
      : null;

  return {
    admitted: {
      bevy: bevyAdmitted,
      canonical: canonical.admitted,
      cubes: canonical.cubes,
      tn: tnAdmitted,
      tolerance: band,
      withinTolerance: withinAdmitted(bevyAdmitted) && withinAdmitted(tnAdmitted),
    },
    arms: {
      bevy: { arm: bevy.arm, meanMs: bevy.meanMs },
      tn: { arm: tn.arm, authoring: tn.authoring ?? null, meanMs: tn.meanMs },
    },
    blocks: 1,
    census: {
      cubes: fixture.counts.cubes,
      directionalLights: fixture.counts.directionalLights,
      enclosing: fixture.counts.enclosing,
      frameSchedule: fixture.frameSchedule,
      meshes: fixture.meshes.length,
      materials: fixture.materials.length,
      probeIndices: fixture.probeIndices,
      requestedInstances: fixture.counts.requestedInstances,
      viewport: fixture.viewport,
    },
    conformance: {
      cameraMaxDelta,
      frames: frames.sort((a, b) => a - b),
      perArm,
      probeMaxDelta,
      tolerance: CUBES_TOLERANCE.quaternionAbs,
      withinTolerance,
      worstFrame,
    },
    outcome: {
      comparability: valid ? "qualified" : "non-comparable",
      // Never `matched-task`: the two renderers shade differently and Bevy's window background is
      // not three's, which §3.2 says belongs on a qualified comparison.
      comparabilityReason: valid
        ? "identical fixture bytes, census, viewport and frame schedule; the shaded environments differ (Bevy PBR with its own window clear colour against three's MeshStandardMaterial on a black background), which §3.2 makes a qualification rather than a mismatch"
        : null,
      problems,
      valid,
    },
    profile: "smoke",
    ratio,
  };
}

function readAdmitted(work: Record<string, unknown> | null, key: string): number | null {
  if (work === null) return null;
  const value = work[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}
