import {
  CITY_TOLERANCE,
  CITY_UPSTREAM_COMMIT,
  type ICityFixture,
  cityCameraRotation,
  cityCarDistance,
  cityCarLocalPosition,
  cityNodeWorldPosition,
  cityRotationDelta,
  cityTranslationDelta,
} from "../../examples/engine-load-test/src/city-fixture.js";

/**
 * PRD-449 `bevy-city`: the comparison between the pinned upstream Bevy arm and the ThreeNative
 * counterpart arm on the fixture Bevy exported. Pure, so every rule here is unit-proved without a
 * GPU, and deliberately strict: a pair whose fixture, census, viewport, frame schedule, per-frame
 * state or car behaviour disagrees is reported as non-comparable rather than as a speedup.
 *
 * What it deliberately does *not* do is settle a winner. One smoke block with no A/A calibration
 * supports no faster/slower verdict (§8), so the ratio is an observation and the verdict is
 * `insufficient`.
 */

/**
 * How far the two arms' admitted mesh-node counts may differ, preregistered. Both render the same
 * exported triangles through the same camera, so the admitted sets should be identical; the band
 * exists because one engine culls a bounding sphere and the other a box, which can disagree for an
 * object straddling a plane. One percent of the frame's mesh nodes is far above the handful of
 * straddling objects and far below a dropped set.
 */
export const CITY_ADMITTED_TOLERANCE = 0.01;

/** How far a car's distance may sit from the recurrence, in world units. */
const CAR_DISTANCE_TOLERANCE = 1e-3;

export interface ICityProbe {
  readonly index: number;
  readonly translation: readonly number[];
}

export interface ICityState {
  readonly camera: {
    readonly rotation: readonly number[];
    readonly translation: readonly number[];
  };
  readonly cars: readonly (ICityProbe & { readonly distanceTraveled?: number })[];
  readonly frameId: number;
  readonly nodes: readonly ICityProbe[];
  readonly simulateCarsApplications?: number;
}

export interface ICityRun {
  readonly adapter: Record<string, unknown> | null;
  readonly arm: string;
  readonly authoring?: string;
  readonly boundarySemantics: string | null;
  readonly census: Record<string, unknown> | null;
  readonly drain: { boundaryFrame: number; includesUntimedFrames: number } | null;
  readonly family: string;
  readonly fixture: { hash: string | null; nodes: number; sourceCommit?: string };
  readonly frameIntervals: readonly number[];
  readonly frameSchedule: Record<string, unknown> | null;
  readonly lightIntensityMapping?: string;
  readonly meanMs: number;
  readonly meshBuffers?: readonly { index: number; observedSha256: string; triangles: number }[];
  readonly profile: string;
  readonly settings: Record<string, unknown> | null;
  readonly simulateCarsApplications: Record<string, unknown> | null;
  readonly states: readonly ICityState[];
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

/** A rotation or translation component is signed, so the non-negative timing reader is not for one. */
function finite(value: unknown, code: string): number {
  const parsed =
    typeof value === "string" && /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
      ? Number(value)
      : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) fail(code, "not finite");
  return parsed;
}

function readTriple(value: unknown, code: string): readonly number[] {
  const raw = value;
  if (!Array.isArray(raw) || raw.length !== 3) fail(code, "expected three numbers");
  return raw.map((entry) => finite(entry, code));
}

function readQuat(value: unknown, code: string): readonly number[] {
  const raw = value;
  if (!Array.isArray(raw) || raw.length !== 4) fail(code, "expected four numbers");
  return raw.map((entry) => finite(entry, code));
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
): { frameIntervals: readonly number[]; finalCompletionMs: number } {
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

function parseState(value: unknown, code: string): ICityState {
  const raw = object(value, code);
  const camera = object(raw.camera, `${code}.camera`);
  const probes = (key: "cars" | "nodes") => {
    const list = raw[key];
    if (!Array.isArray(list) || list.length === 0) fail(code, `a sampled state carried no ${key}`);
    return list.map((entry, at) => {
      const probe = object(entry, `${code}.${key}[${at}]`);
      const distance = probe.distanceTraveled;
      return {
        index: count(probe.index, `${code}.${key}[${at}].index`),
        ...(distance === undefined ? {} : { distanceTraveled: finite(distance, code) }),
        translation: readTriple(probe.translation, `${code}.${key}[${at}].translation`),
      };
    });
  };
  const applications = raw.simulateCarsApplications;
  return {
    camera: {
      rotation: readQuat(camera.rotation, `${code}.camera.rotation`),
      translation: readTriple(camera.translation, `${code}.camera.translation`),
    },
    cars: probes("cars"),
    frameId: count(raw.frameId, `${code}.frameId`),
    nodes: probes("nodes"),
    ...(applications === undefined
      ? {}
      : { simulateCarsApplications: count(applications, `${code}.simulateCarsApplications`) }),
  };
}

export function parseCityRun(raw: unknown): ICityRun {
  const root = object(raw, "TN_BENCH_CITY_RUN");
  if (root.family !== "bevy-city") fail("TN_BENCH_CITY_RUN", "family");
  const meanMs = sample(root.meanMs, "TN_BENCH_CITY_RUN");
  if (meanMs === null || meanMs <= 0)
    fail("TN_BENCH_CITY_RUN", "a completed-work mean of zero means no frame completed");
  const { frameIntervals } = readSeries(root, "TN_BENCH_CITY_RUN");
  const fixture = object(root.fixture, "TN_BENCH_CITY_RUN.fixture");
  if (fixture.sourceCommit !== CITY_UPSTREAM_COMMIT)
    fail("TN_BENCH_CITY_RUN", "the fixture must name the pinned upstream commit");
  const rawStates = root.states;
  if (!Array.isArray(rawStates) || rawStates.length === 0)
    fail("TN_BENCH_CITY_RUN", "a run with no sampled state has no conformance evidence");
  const states = rawStates.map((entry, index) =>
    parseState(entry, `TN_BENCH_CITY_RUN.states[${index}]`),
  );
  return {
    adapter: (root.adapter ?? null) as Record<string, unknown> | null,
    arm: String(root.arm),
    authoring: typeof root.authoring === "string" ? root.authoring : undefined,
    boundarySemantics: typeof root.boundarySemantics === "string" ? root.boundarySemantics : null,
    census: (root.census ?? null) as Record<string, unknown> | null,
    drain: (root.drain ?? null) as ICityRun["drain"],
    family: root.family as string,
    fixture: {
      hash: typeof fixture.hash === "string" ? fixture.hash : null,
      nodes: count(fixture.nodes, "fixture.nodes"),
      sourceCommit: fixture.sourceCommit as string,
    },
    frameIntervals,
    frameSchedule: (root.frameSchedule ?? null) as Record<string, unknown> | null,
    lightIntensityMapping:
      typeof root.lightIntensityMapping === "string" ? root.lightIntensityMapping : undefined,
    meanMs,
    meshBuffers: (root.meshBuffers ?? undefined) as ICityRun["meshBuffers"],
    profile: String(root.profile ?? "smoke"),
    settings: (root.settings ?? null) as Record<string, unknown> | null,
    simulateCarsApplications: (root.simulateCarsApplications ?? null) as Record<
      string,
      unknown
    > | null,
    states,
    variant: String(root.variant),
    viewport: (root.viewport ?? null) as ICityRun["viewport"],
    work: (root.work ?? null) as Record<string, unknown> | null,
  };
}

/**
 * A metric either arm did not produce. `null` with the fact that it is absent, never a zero, which
 * would read as free work.
 */
function readCount(work: Record<string, unknown> | null, key: string): number | null {
  if (work === null) return null;
  const value = work[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

export interface ICityAdmitted {
  readonly bevy: number | null;
  readonly canonical: number;
  readonly meshNodes: number;
  readonly tn: number | null;
  readonly tolerance: number;
  readonly withinTolerance: boolean;
}
export interface ICityComparison {
  readonly admitted: ICityAdmitted;
  readonly arms: {
    bevy: { arm: string; meanMs: number };
    tn: { arm: string; authoring: string | null; meanMs: number };
  };
  readonly blocks: number;
  readonly carMotion: {
    /** A moving arm must move and a static one must not, checked on the arms' own samples. */
    observed: { bevy: boolean; tn: boolean };
    required: boolean;
    /** The worst per-car distance disagreement, over the probed cars and the sampled frames. */
    maxDistanceDelta: number;
    withinTolerance: boolean;
    tolerance: number;
  };
  readonly census: Record<string, unknown>;
  readonly conformance: {
    cameraMaxDelta: number;
    frames: readonly number[];
    nodeMaxDelta: number;
    perArm: {
      bevy: { cameraMaxDelta: number; nodeMaxDelta: number };
      tn: { cameraMaxDelta: number; nodeMaxDelta: number };
    };
    withinTolerance: boolean;
    worstFrame: { bevy: number | null; tn: number | null };
  };
  readonly disclosed: readonly string[];
  readonly outcome: {
    comparability: "matched-task" | "non-comparable" | "qualified";
    comparabilityReason: string | null;
    problems: readonly string[];
    valid: boolean;
  };
  readonly profile: string;
  readonly ratio: {
    bevyMeanMs: number;
    ratio: number;
    reason: string;
    tnMeanMs: number;
    verdict: "insufficient";
  } | null;
}

export function compareCityRuns(
  fixture: ICityFixture,
  bevy: ICityRun,
  tn: ICityRun,
): ICityComparison {
  const problems: string[] = [];
  const push = (code: string): void => {
    problems.push(code);
  };

  if (bevy.arm !== "bevy-desktop") push("TN_BENCH_CITY_BAD_ARM:bevy");
  if (tn.arm !== "tn-desktop") push("TN_BENCH_CITY_BAD_ARM:tn");
  if (tn.authoring !== undefined && tn.authoring !== "default")
    push("TN_BENCH_CITY_BAD_AUTHORING:tn");
  if (bevy.variant !== tn.variant) push("TN_BENCH_CITY_VARIANT_MISMATCH");
  if (bevy.variant !== fixture.variant) push("TN_BENCH_CITY_VARIANT_FIXTURE_MISMATCH");
  if (bevy.fixture.nodes !== fixture.census.nodes || tn.fixture.nodes !== fixture.census.nodes)
    push("TN_BENCH_CITY_CENSUS_MISMATCH");
  // The shared input bytes, not merely the same numbers: one arm's record names the file the other
  // read, and the reader refuses a fixture from another commit.
  if (tn.fixture.hash === null) push("TN_BENCH_CITY_FIXTURE_HASH_ABSENT");

  for (const [name, run] of [
    ["bevy", bevy],
    ["tn", tn],
  ] as const) {
    if (run.frameIntervals.length !== fixture.frameSchedule.measuredFrames)
      push(`TN_BENCH_CITY_FRAME_COUNT_MISMATCH:${name}`);
    if (run.drain === null) push(`TN_BENCH_CITY_DRAIN_ABSENT:${name}`);
    if (run.boundarySemantics === null) push(`TN_BENCH_CITY_BOUNDARY_SEMANTICS_ABSENT:${name}`);
    if (run.viewport === null) push(`TN_BENCH_CITY_VIEWPORT_ABSENT:${name}`);
    if (run.states.length === 0) push(`TN_BENCH_CITY_STATE_ABSENT:${name}`);
  }
  for (const [name, run] of [
    ["bevy", bevy],
    ["tn", tn],
  ] as const) {
    if (
      run.viewport !== null &&
      (run.viewport.width !== fixture.viewport.width ||
        run.viewport.height !== fixture.viewport.height)
    )
      push(`TN_BENCH_CITY_VIEWPORT_MISMATCH:${name}`);
  }
  if (bevy.frameSchedule === null) push("TN_BENCH_CITY_SCHEDULE_ABSENT:bevy");

  // The `simulate_cars` application count each arm reached at its first scored frame, read from its
  // own record. The oracle is composed from these, so a disagreement is a named cause rather than a
  // number the comparator invented.
  const applications = (run: ICityRun): number | null => {
    const record = run.simulateCarsApplications;
    if (record === null) return null;
    const value = record.atFirstScoredFrame;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
    return value;
  };
  const bevyApplications = applications(bevy);
  const tnApplications = applications(tn);
  if (bevyApplications === null) push("TN_BENCH_CITY_CAR_RUNS_ABSENT:bevy");
  if (tnApplications === null) push("TN_BENCH_CITY_CAR_RUNS_ABSENT:tn");

  const cameraExpected = cityCameraRotation(fixture);
  const bevyFrames = new Map(bevy.states.map((state) => [state.frameId, state]));
  const tnFrames = new Map(tn.states.map((state) => [state.frameId, state]));
  if (bevyFrames.size !== tnFrames.size) push("TN_BENCH_CITY_STATE_FRAME_SET_MISMATCH");
  let cameraMaxDelta = 0;
  let nodeMaxDelta = 0;
  const perArm = {
    bevy: { cameraMaxDelta: 0, nodeMaxDelta: 0 },
    tn: { cameraMaxDelta: 0, nodeMaxDelta: 0 },
  };
  const worstFrame = { bevy: null as number | null, tn: null as number | null };
  const frames: number[] = [];
  for (const [frameId, bevyState] of bevyFrames) {
    const tnState = tnFrames.get(frameId);
    if (tnState === undefined) {
      push(`TN_BENCH_CITY_STATE_UNPAIRED:${frameId}`);
      continue;
    }
    frames.push(frameId);
    for (const [name, state] of [
      ["bevy", bevyState],
      ["tn", tnState],
    ] as const) {
      const delta = cityRotationDelta(state.camera.rotation, cameraExpected);
      perArm[name].cameraMaxDelta = Math.max(perArm[name].cameraMaxDelta, delta);
      cameraMaxDelta = Math.max(cameraMaxDelta, delta);
    }
    // The hierarchy's own arithmetic: the expected world translation is composed from the exported
    // parent chain, so a counterpart arm that authored the nodes flat lands somewhere else.
    for (const index of fixture.probeNodes) {
      const expected = cityNodeWorldPosition(fixture, index);
      for (const [name, state] of [
        ["bevy", bevyState],
        ["tn", tnState],
      ] as const) {
        const probe = state.nodes.find((entry) => entry.index === index);
        if (probe === undefined) {
          push(`TN_BENCH_CITY_NODE_PROBE_UNOBSERVED:${index}`);
          continue;
        }
        const delta = cityTranslationDelta(probe.translation, expected);
        if (delta > perArm[name].nodeMaxDelta) {
          perArm[name].nodeMaxDelta = delta;
          worstFrame[name] = frameId;
        }
        nodeMaxDelta = Math.max(nodeMaxDelta, delta);
      }
    }
  }
  const withinTolerance =
    cameraMaxDelta <= CITY_TOLERANCE.quaternionAbs && nodeMaxDelta <= CITY_TOLERANCE.translationAbs;
  if (!withinTolerance) push("TN_BENCH_CITY_STATE_OUT_OF_TOLERANCE");

  // `simulate_cars`' own arithmetic, per arm: the expected local translation comes from the exported
  // road and the recurrence, and the reported one is that car's world position, so the parent chain
  // is exercised on the very nodes that move.
  let maxDistanceDelta = 0;
  for (const [frameId, bevyState] of bevyFrames) {
    const tnState = tnFrames.get(frameId);
    if (tnState === undefined) continue;
    for (const [name, state, count] of [
      ["bevy", bevyState, bevyApplications],
      ["tn", tnState, tnApplications],
    ] as const) {
      if (count === null) continue;
      const sampledCount = state.simulateCarsApplications;
      if (sampledCount === undefined || sampledCount !== count + frameId) {
        push(`TN_BENCH_CITY_CAR_RUNS_MISMATCH:${name}@${frameId}`);
        continue;
      }
      for (const probe of state.cars) {
        const car = fixture.cars[probe.index];
        if (car === undefined) {
          push(`TN_BENCH_CITY_CAR_PROBE_UNKNOWN:${probe.index}`);
          continue;
        }
        const local = cityCarLocalPosition(fixture, probe.index, sampledCount);
        const expected = cityNodeWorldPosition(fixture, car.nodeIndex, [local.x, local.y, local.z]);
        const delta = cityTranslationDelta(probe.translation, expected);
        maxDistanceDelta = Math.max(maxDistanceDelta, delta);
        if (delta > CITY_TOLERANCE.translationAbs)
          push(`TN_BENCH_CITY_CAR_STATE_OUT_OF_TOLERANCE:${name}:${probe.index}@${frameId}`);
        if (probe.distanceTraveled !== undefined) {
          const expectedDistance = cityCarDistance(fixture, probe.index, sampledCount);
          if (Math.abs(probe.distanceTraveled - expectedDistance) > CAR_DISTANCE_TOLERANCE)
            push(`TN_BENCH_CITY_CAR_DISTANCE_OUT_OF_TOLERANCE:${name}:${probe.index}@${frameId}`);
        }
      }
    }
  }
  const carWithinTolerance = !problems.some((code) => code.includes("CAR_STATE_OUT_OF_TOLERANCE"));

  // §5.1's "validate actual switch effects rather than trusting option names": a static arm must not
  // move and a moving one must. Checked on the arms' own samples.
  const moved = (run: ICityRun): boolean => {
    if (run.states.length < 2) return false;
    const first = new Map((run.states[0] as ICityState).cars.map((probe) => [probe.index, probe]));
    return run.states.some((state) =>
      state.cars.some((probe) => {
        const was = first.get(probe.index);
        if (was === undefined) return false;
        return was.translation.some(
          (value, at) => Math.abs(value - (probe.translation[at] as number)) > 1e-6,
        );
      }),
    );
  };
  const observed = { bevy: moved(bevy), tn: moved(tn) };
  const required = fixture.variant === "moving";
  if (required && (!observed.bevy || !observed.tn)) push("TN_BENCH_CITY_CAR_MOTION_NOT_OBSERVED");
  if (!required && (observed.bevy || observed.tn)) push("TN_BENCH_CITY_STATIC_ARM_MOVED");

  // Bevy exposes no submitted-draw counter to the main world. That is a null with a reason, which is
  // the PRD's rule for an unavailable metric, and never a zero that would look like free work.
  if (bevy.work !== null && bevy.work.submittedDrawCalls === 0)
    push("TN_BENCH_CITY_DRAW_COUNTER_ZERO");
  if (
    tn.work !== null &&
    typeof tn.work.submittedDrawCalls === "number" &&
    tn.work.submittedDrawCalls === 0
  )
    push("TN_BENCH_CITY_DRAW_COUNTER_ZERO:tn");

  const disclosed: string[] = [
    fixture.profile === "common"
      ? "the common profile disables Bevy atmosphere, HDR, bloom, TAA and shadows; Bevy and three still shade their materials differently against a black background, so the picture remains qualified under §3.2"
      : "the upstream Bevy profile uses HDR, atmosphere, fog, bloom and TAA while this arm renders three's MeshStandardMaterial on black; the picture remains qualified under §3.2",
    `bevy's light is ${fixture.light.illuminanceLux} lux under Exposure::OVERCAST and three's has neither unit nor exposure compensation, so only the direction is carried over; ${tn.lightIntensityMapping ?? "the counterpart did not say what it used"}`,
    "three's MeshStandardMaterial expresses glTF occlusion-roughness-metalness by binding the same packed image to aoMap, roughnessMap and metalnessMap, and Bevy's perceptual roughness is three's roughness; the bindings are the same texture, the response curve is not",
  ];
  if (fixture.viewport.deviation !== null)
    disclosed.push(`render attachment: ${fixture.viewport.deviation}`);

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
      bevy: readCount(bevy.work, "admittedMeshNodes"),
      canonical: fixture.census.meshNodes,
      meshNodes: fixture.census.meshNodes,
      tn: readCount(tn.work, "admittedMeshNodes"),
      tolerance: Math.max(1, Math.round(fixture.census.meshNodes * CITY_ADMITTED_TOLERANCE)),
      withinTolerance: true,
    },
    arms: {
      bevy: { arm: bevy.arm, meanMs: bevy.meanMs },
      tn: { arm: tn.arm, authoring: tn.authoring ?? null, meanMs: tn.meanMs },
    },
    blocks: 1,
    carMotion: {
      maxDistanceDelta,
      observed,
      required,
      tolerance: CITY_TOLERANCE.translationAbs,
      withinTolerance: carWithinTolerance,
    },
    census: {
      cars: fixture.census.cars,
      images: fixture.census.images,
      materials: fixture.census.materials,
      meshNodes: fixture.census.meshNodes,
      meshes: fixture.census.meshes,
      nodes: fixture.census.nodes,
      roads: fixture.census.roads,
      seed: fixture.seed,
      size: fixture.size,
      trianglesInCensus: fixture.census.trianglesInCensus,
      viewport: fixture.viewport,
    },
    conformance: {
      cameraMaxDelta,
      frames: frames.sort((a, b) => a - b),
      nodeMaxDelta,
      perArm,
      withinTolerance,
      worstFrame,
    },
    disclosed,
    outcome: {
      comparability: valid ? "qualified" : "non-comparable",
      // Never `matched-task`: §6.3's own note is that the two renderers shade differently, and the
      // atmosphere, the exposure and the light units are named above.
      comparabilityReason: valid
        ? "identical fixture bytes, census, viewport, hierarchy, frame schedule and car recurrence; the shaded environments differ, which §3.2 makes a qualification rather than a mismatch"
        : null,
      problems,
      valid,
    },
    profile: "smoke",
    ratio,
  };
}
