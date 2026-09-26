import {
  LIGHTS_ACTUAL_LIGHTS,
  LIGHTS_ACTUAL_OBJECTS,
  LIGHTS_CELL,
  LIGHTS_REQUESTED_LIGHTS,
  LIGHTS_TOGGLE_ARC_RADIANS,
  LIGHTS_TOLERANCE,
  LIGHTS_UPSTREAM_COMMIT,
  LIGHTS_VIEWPORT,
} from "../../examples/engine-load-test/src/lights-fixture.js";

/**
 * PRD-449 `godot-lights-meshes`: the comparison between the pinned upstream Godot arm and the
 * ThreeNative counterpart arm on the same exported fixture. Pure, so the conformance rules are
 * unit-proved without a GPU.
 *
 * Only comparable metrics are compared. A metric is comparable when both arms measured the same
 * thing with the same definition from the same bytes; everything else is recorded with its delta and
 * named as a disclosure, never as a pass. The two shaded-pipeline metrics — mean luma and the
 * per-sample luma difference — are exactly that: Godot's Forward+ and three's forward renderer do not
 * shade this scene the same way, and §6.2 forbids a universal pixel-equality threshold between two
 * PBR implementations. What is gated instead is the evidence §6.2 does ask for: non-blank frames,
 * observed motion, a light census that agrees, a per-frame workload state that agrees, and a proof
 * that the lights lit the frame in both arms.
 *
 * A pair that fails any gate is `non-comparable` and carries no ratio beyond the raw means.
 */

export interface ILightsProbe {
  readonly axisX: readonly number[];
  readonly index: number;
  readonly origin: readonly number[];
}

export interface ILightsLightProbe extends Omit<ILightsProbe, "axisX"> {
  readonly accum: number;
  /**
   * Recorded, never gated. Godot's `OmniLight3D` global basis is identity even under a parent scaled
   * `2/s` — the cell and the `Lighter` above it both carry 0.666667 and the light still reports a
   * unit X column, while its origin composes correctly — and three's `matrixWorld` inherits the whole
   * parent chain. An omni light has no orientation, so this cell is unaffected; a spot cell's
   * direction would be, and that is a different cell with a different exclusion to argue.
   */
  readonly axisX?: readonly number[];
  readonly energy: number;
  readonly visible: boolean;
}

export interface ILightsState {
  readonly elapsedFrames: number;
  readonly frameId: number;
  readonly lightProbes: readonly ILightsLightProbe[];
  readonly lightsVisible: number;
  readonly lightRotationY: number;
  readonly meshProbes: readonly ILightsProbe[];
  readonly meshRotationY: number;
}

export interface ILightsCaptureRecord {
  /** `null` when the capture had no earlier frame to differ from, which is not the same as zero. */
  readonly changedPixels: number | null;
  readonly coveredFraction: number;
  readonly frameId: number;
  readonly meanLuma: number;
  readonly name: string;
  readonly path?: string;
  readonly scored: boolean;
}

export interface ILightsRun {
  readonly adapter: Record<string, unknown>;
  readonly arm: string;
  readonly authoring: string;
  readonly captures: readonly ILightsCaptureRecord[];
  readonly census: {
    readonly actualMeshInstances: number;
    readonly actualOmniLights: number;
    readonly actualSpotLights: number;
    readonly requestedLights: number;
    readonly requestedObjects: number;
  };
  readonly cell: string;
  readonly effective: { lightsAffectFrame: boolean; lightsChangedSamples: number };
  readonly environment: {
    readonly ambientColor: readonly number[];
    readonly ambientSource: string;
    readonly backgroundColor: readonly number[];
    readonly backgroundMode: string;
  };
  readonly family: string;
  readonly fixture: { hash: string; rngSeed: number; sourceCommit?: string; viewport: unknown };
  readonly frameIntervals: readonly number[];
  readonly frameP50Ms?: number;
  readonly frameP95Ms?: number;
  readonly lights: {
    readonly actual: number;
    readonly attenuation: number;
    readonly kind: string;
    readonly range: number;
    readonly requested: number;
  };
  readonly meanMs: number;
  readonly mesh: {
    readonly bufferSha256: string;
    readonly indices: number;
    readonly kind: string;
    readonly triangles: number;
    readonly vertices: number;
  };
  readonly motion: { changedSampledPixels: number; observed: boolean };
  readonly profile: string;
  readonly states: readonly ILightsState[];
  readonly updateSchedule: {
    readonly advanceOrder: string;
    readonly frameDelta: number;
    readonly lightRotaterSpeed: number;
    readonly meshRotaterSpeed: number;
  };
  readonly wallSemantics: string | null;
}

function fail(code: string, detail: string): never {
  throw new Error(`${code}:${detail}`);
}

/** The native hosts' 60 Hz frame-loop pacing, the value a cadence-bound mean lands on. */
const FRAME_CADENCE_MS = 1000 / 60;
/**
 * How tightly a capped arm's frames cluster on the tick. A present that blocks lands on it within
 * microseconds, so a one-millimetre spread is already generous; real work that happens to cost about
 * one tick spreads over several milliseconds, and proximity alone cannot tell the two apart.
 */
const CAP_CLUSTER_MS = 1;

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

function number(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(code, "expected a finite number");
  return value;
}

function triple(value: unknown, code: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== 3) fail(code, "expected three numbers");
  return value.map((entry) => number(entry, code));
}

function sha256Digest(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail(code, "buffer SHA-256");
  return value;
}

/**
 * The two arms time their frames differently and neither shares a definition with the other, so the
 * reader takes the intervals where the producer left them: the competitor reports its own array, the
 * counterpart reports `N+1` boundary timestamps whose differences are the intervals. A run that
 * keeps neither has no frame-level evidence at all and is refused rather than scored from its mean.
 */
function frameIntervals(raw: Record<string, unknown>, code: string): readonly number[] {
  const sample = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  if (Array.isArray(raw.frameIntervalMs)) {
    const out = raw.frameIntervalMs.map(sample);
    if (out.length === 0 || out.some((value) => value === null)) fail(code, "frame intervals");
    return out as number[];
  }
  const series = raw.rawSeries;
  if (series === undefined) fail(code, "no frame interval series");
  const boundaries = object(series, code).boundaries;
  if (!Array.isArray(boundaries) || boundaries.length < 2) fail(code, "no frame boundaries");
  const stamps = boundaries.map((entry) => sample(object(entry, code).monotonicMs));
  if (stamps.some((value) => value === null)) fail(code, "frame boundaries");
  const ordered = stamps as number[];
  const out: number[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const delta = (ordered[index] as number) - (ordered[index - 1] as number);
    if (delta < 0) fail(code, "frame boundaries must not decrease");
    out.push(delta);
  }
  return out;
}

/**
 * §7.4's primary metric is a completed-work mean, which needs a final-completion observation on both
 * arms. The two records do not carry that under one name, so each arm's semantics are read from the
 * metadata it actually has, and the two statements are compared. A record with neither says nothing
 * about what its mean measured, so it is `null` and refused rather than assumed.
 */
function wallSemantics(raw: Record<string, unknown>, code: string): string | null {
  if (typeof raw.drain === "string" && raw.drain.length > 0) return `drain:${raw.drain}`;
  if (raw.rawSeries !== undefined) {
    const completion = object(raw.rawSeries, code).finalCompletionMs;
    if (typeof completion === "number" && Number.isFinite(completion))
      return "drain:measurement-boundary-completion";
  }
  return null;
}

export function parseLightsRun(value: unknown, code = "TN_BENCH_LIGHTS_RUN_MALFORMED"): ILightsRun {
  const raw = object(value, code);
  if (raw.family !== "godot-lights-meshes") fail(code, `family ${String(raw.family)}`);
  if (raw.cell !== LIGHTS_CELL) fail(code, `cell ${String(raw.cell)}`);
  if (typeof raw.arm !== "string" || raw.arm.length === 0) fail(code, "arm");
  if (typeof raw.meanMs !== "number" || !(raw.meanMs > 0)) fail(code, "meanMs must be positive");
  const fixture = object(raw.fixture, code);
  if (typeof fixture.hash !== "string" || !/^[0-9a-f]{64}$/.test(fixture.hash))
    fail(code, "fixture hash");
  if (fixture.sourceCommit !== undefined && fixture.sourceCommit !== LIGHTS_UPSTREAM_COMMIT)
    fail(code, `fixture source commit ${String(fixture.sourceCommit)}`);
  if (!Array.isArray(raw.states) || raw.states.length === 0) fail(code, "states");
  if (!Array.isArray(raw.captures) || raw.captures.length === 0) fail(code, "captures");
  const census = object(raw.census, code);
  const mesh = object(raw.mesh, code);
  const schedule = object(raw.updateSchedule, code);
  const environment = object(raw.environment, code);
  const effective = object(raw.effective, code);
  return {
    adapter: object(raw.adapter, code),
    arm: raw.arm,
    authoring: typeof raw.authoring === "string" ? raw.authoring : "unknown",
    captures: raw.captures.map((entry) => {
      const capture = object(entry, code);
      return {
        changedPixels: capture.changedPixels === null ? null : count(capture.changedPixels, code),
        coveredFraction: number(capture.coveredFraction, code),
        frameId: count(capture.frameId, code),
        meanLuma: number(capture.meanLuma, code),
        name: String(capture.name),
        ...(typeof capture.path === "string" ? { path: capture.path } : {}),
        scored: capture.scored === true,
      };
    }),
    census: {
      actualMeshInstances: count(census.actualMeshInstances, code),
      actualOmniLights: count(census.actualOmniLights, code),
      actualSpotLights: count(census.actualSpotLights, code),
      requestedLights: count(census.requestedLights, code),
      requestedObjects: count(census.requestedObjects, code),
    },
    cell: String(raw.cell),
    effective: {
      lightsAffectFrame: effective.lightsAffectFrame === true,
      lightsChangedSamples: count(effective.lightsChangedSamples, code),
    },
    environment: {
      ambientColor: triple(environment.ambientColor, code),
      ambientSource: String(environment.ambientSource),
      backgroundColor: triple(environment.backgroundColor, code),
      backgroundMode: String(environment.backgroundMode),
    },
    family: raw.family,
    fixture: {
      hash: fixture.hash,
      rngSeed: count(fixture.rngSeed, code),
      ...(typeof fixture.sourceCommit === "string" ? { sourceCommit: fixture.sourceCommit } : {}),
      viewport: fixture.viewport,
    },
    frameIntervals: frameIntervals(raw, code),
    frameP50Ms: typeof raw.frameP50Ms === "number" ? raw.frameP50Ms : undefined,
    frameP95Ms: typeof raw.frameP95Ms === "number" ? raw.frameP95Ms : undefined,
    lights: (() => {
      const lights = object(raw.lights, code);
      return {
        actual: count(lights.actual, code),
        attenuation: number(lights.attenuation, code),
        kind: String(lights.kind),
        range: number(lights.range, code),
        requested: count(lights.requested, code),
      };
    })(),
    meanMs: raw.meanMs,
    mesh: {
      bufferSha256: sha256Digest(mesh.bufferSha256, code),
      indices: count(mesh.indices, code),
      kind: String(mesh.kind),
      triangles: count(mesh.triangles, code),
      vertices: count(mesh.vertices, code),
    },
    motion: (() => {
      const motion = object(raw.motion, code);
      return {
        changedSampledPixels:
          motion.changedSampledPixels === null ? -1 : number(motion.changedSampledPixels, code),
        observed: motion.observed === true,
      };
    })(),
    profile: typeof raw.profile === "string" ? raw.profile : "unknown",
    states: raw.states.map((entry) => {
      const state = object(entry, code);
      if (!Array.isArray(state.meshProbes) || state.meshProbes.length === 0)
        fail(code, "state mesh probes");
      if (!Array.isArray(state.lightProbes) || state.lightProbes.length === 0)
        fail(code, "state light probes");
      return {
        elapsedFrames: count(state.elapsedFrames, code),
        frameId: count(state.frameId, code),
        lightProbes: state.lightProbes.map((probe) => {
          const read = object(probe, code);
          return {
            accum: number(read.accum, code),
            ...(read.axisX === undefined ? {} : { axisX: triple(read.axisX, code) }),
            energy: number(read.energy, code),
            index: count(read.index, code),
            origin: triple(read.origin, code),
            visible: read.visible === true,
          };
        }),
        lightsVisible: count(state.lightsVisible, code),
        lightRotationY: number(state.lightRotationY, code),
        meshProbes: state.meshProbes.map((probe) => {
          const read = object(probe, code);
          return {
            axisX: triple(read.axisX, code),
            index: count(read.index, code),
            origin: triple(read.origin, code),
          };
        }),
        meshRotationY: number(state.meshRotationY, code),
      };
    }),
    updateSchedule: {
      advanceOrder: String(schedule.advanceOrder),
      frameDelta: number(schedule.frameDelta, code),
      lightRotaterSpeed: number(schedule.lightRotaterSpeed, code),
      meshRotaterSpeed: number(schedule.meshRotaterSpeed, code),
    },
    wallSemantics: wallSemantics(raw, code),
  };
}

export interface ILightsComparison {
  readonly blocks: 1;
  /** Everything compared, so a reader can see the compatible-metric boundary rather than infer it. */
  readonly comparedMetrics: readonly string[];
  readonly conformance: {
    readonly accumulatorDelta: number;
    readonly bufferHashesEqual: boolean;
    readonly censusEqual: boolean;
    readonly energyDelta: number;
    readonly fixtureHashEqual: boolean;
    readonly lightsVisibleEqual: boolean;
    readonly maxOriginDeltaMetres: number;
    readonly maxRotationDeltaRadians: number;
    readonly oppositeRotationsObserved: { light: boolean; mesh: boolean };
    readonly sampledFrames: number;
    readonly togglesObserved: { godot: boolean; tn: boolean };
    readonly withinTolerance: boolean;
  };
  readonly disclosed: {
    readonly lightAxisXNote: string;
    readonly meanLumaDelta: { frameId: number; tn: number; godot: number }[];
    readonly note: string;
    readonly shadedPixelsCompared: boolean;
  };
  readonly evidence: {
    readonly lightsAffectFrame: { godot: boolean; tn: boolean };
    readonly nonBlankCaptures: { godot: boolean; tn: boolean };
    readonly observedMotion: { godot: boolean; tn: boolean };
  };
  readonly outcome: {
    readonly comparability: "matched-task" | "qualified" | "non-comparable";
    readonly comparabilityReasons: readonly string[];
    readonly problems: readonly string[];
    readonly valid: boolean;
  };
  readonly profile: "smoke";
  readonly qualifications: readonly string[];
  readonly ratio: {
    readonly godotMeanMs: number;
    readonly ratio: number;
    readonly timeReductionPercent: number;
    readonly tnMeanMs: number;
  } | null;
  readonly visuals: { coveredFractionDelta: number; frameId: number }[];
}

/**
 * Two arms are `qualified` at best, never `matched-task`, and for stated reasons: this cell's two
 * shaded pipelines differ (Godot Forward+ with a physical BRDF and no ambient against three's forward
 * renderer with the same black ambient), the light attenuation model is the same curve but the two
 * implementations round it differently, and one smoke block supports no verdict at all.
 */
export function compareLightsRuns(tn: ILightsRun, godot: ILightsRun): ILightsComparison {
  const problems: string[] = [];
  if (tn.cell !== godot.cell)
    problems.push(`TN_BENCH_LIGHTS_CELL_MISMATCH:${tn.cell}/${godot.cell}`);
  if (tn.fixture.hash !== godot.fixture.hash) problems.push("TN_BENCH_LIGHTS_FIXTURE_MISMATCH");
  if (tn.fixture.rngSeed !== godot.fixture.rngSeed) problems.push("TN_BENCH_LIGHTS_SEED_MISMATCH");
  // Both arms must have rendered the same 240x135 lattice, or the coverage numbers count different
  // pixels and the silhouette comparison below means nothing.
  for (const [label, run] of [
    ["tn", tn],
    ["godot", godot],
  ] as const) {
    const viewport = object(run.fixture.viewport, "TN_BENCH_LIGHTS_RUN_MALFORMED");
    if (viewport.width !== LIGHTS_VIEWPORT.width || viewport.height !== LIGHTS_VIEWPORT.height)
      problems.push(
        `TN_BENCH_LIGHTS_${label.toUpperCase()}_VIEWPORT:${String(viewport.width)}x${String(viewport.height)}`,
      );
  }
  // §5.1: requested and actual counts are both part of the claim. Requested 10 lights is nine nodes
  // because `create_scattered` squares a rounded root, and an arm that agreed on the wrong number
  // would be agreeing on the wrong scene.
  const censusEqual =
    tn.census.actualMeshInstances === godot.census.actualMeshInstances &&
    tn.census.actualOmniLights === godot.census.actualOmniLights &&
    tn.census.actualSpotLights === godot.census.actualSpotLights &&
    tn.census.requestedObjects === godot.census.requestedObjects &&
    tn.census.requestedLights === godot.census.requestedLights;
  if (!censusEqual)
    problems.push(
      `TN_BENCH_LIGHTS_CENSUS_MISMATCH:tn ${tn.census.actualMeshInstances}/${tn.census.actualOmniLights}/${tn.census.actualSpotLights} godot ${godot.census.actualMeshInstances}/${godot.census.actualOmniLights}/${godot.census.actualSpotLights}`,
    );
  if (godot.census.actualMeshInstances !== LIGHTS_ACTUAL_OBJECTS)
    problems.push(`TN_BENCH_LIGHTS_OBJECT_COUNT:${godot.census.actualMeshInstances}`);
  if (godot.census.actualOmniLights !== LIGHTS_ACTUAL_LIGHTS)
    problems.push(`TN_BENCH_LIGHTS_LIGHT_COUNT:${godot.census.actualOmniLights}`);
  if (godot.census.requestedLights !== LIGHTS_REQUESTED_LIGHTS)
    problems.push(`TN_BENCH_LIGHTS_LIGHT_REQUESTED:${godot.census.requestedLights}`);
  // The two light authors must be the same kind with the same range, or the arms are not lighting the
  // same volume.
  if (tn.lights.kind !== godot.lights.kind)
    problems.push(`TN_BENCH_LIGHTS_KIND_MISMATCH:${tn.lights.kind}/${godot.lights.kind}`);
  if (Math.abs(tn.lights.range - godot.lights.range) > 1e-9)
    problems.push(`TN_BENCH_LIGHTS_RANGE_MISMATCH:${tn.lights.range}/${godot.lights.range}`);
  if (Math.abs(tn.lights.attenuation - godot.lights.attenuation) > 1e-9)
    problems.push(
      `TN_BENCH_LIGHTS_ATTENUATION_MISMATCH:${tn.lights.attenuation}/${godot.lights.attenuation}`,
    );
  // The environment the workload runs in, not a shading choice: a different background or ambient
  // changes what "covered" means, so it is compared and a difference fails the pair.
  if (
    tn.environment.backgroundMode !== godot.environment.backgroundMode ||
    tn.environment.ambientSource !== godot.environment.ambientSource
  )
    problems.push("TN_BENCH_LIGHTS_ENVIRONMENT_MISMATCH");
  for (let axis = 0; axis < 3; axis += 1)
    if (
      Math.abs(
        (tn.environment.backgroundColor[axis] as number) -
          (godot.environment.backgroundColor[axis] as number),
      ) > 1e-6
    )
      problems.push(`TN_BENCH_LIGHTS_BACKGROUND_MISMATCH:${axis}`);
  for (let axis = 0; axis < 3; axis += 1)
    if (
      Math.abs(
        (tn.environment.ambientColor[axis] as number) -
          (godot.environment.ambientColor[axis] as number),
      ) > 1e-6
    )
      problems.push(`TN_BENCH_LIGHTS_AMBIENT_MISMATCH:${axis}`);
  // §6.1: exact mesh and index buffers, not a matching total. The digest is the gate; the counts stay
  // because they name what differs when a digest does not.
  const bufferHashesEqual = tn.mesh.bufferSha256 === godot.mesh.bufferSha256;
  if (!bufferHashesEqual)
    problems.push(
      `TN_BENCH_LIGHTS_BUFFER_HASH_MISMATCH:${godot.mesh.bufferSha256}/${tn.mesh.bufferSha256}`,
    );
  if (
    tn.mesh.triangles !== godot.mesh.triangles ||
    tn.mesh.indices !== godot.mesh.indices ||
    tn.mesh.vertices !== godot.mesh.vertices
  )
    problems.push(
      `TN_BENCH_LIGHTS_MESH_TOPOLOGY_MISMATCH:triangles ${godot.mesh.triangles}/${tn.mesh.triangles} indices ${godot.mesh.indices}/${tn.mesh.indices} vertices ${godot.mesh.vertices}/${tn.mesh.vertices}`,
    );
  // The update schedule is the frame clock both arms ran. A different delta or a same-direction pair
  // of rotaters means frame k is a different workload state in each arm.
  if (Math.abs(tn.updateSchedule.frameDelta - godot.updateSchedule.frameDelta) > 1e-12)
    problems.push("TN_BENCH_LIGHTS_FRAME_DELTA_MISMATCH");
  if (tn.updateSchedule.advanceOrder !== godot.updateSchedule.advanceOrder)
    problems.push("TN_BENCH_LIGHTS_ADVANCE_ORDER_MISMATCH");
  for (const [name, key] of [
    ["mesh", "meshRotaterSpeed"],
    ["light", "lightRotaterSpeed"],
  ] as const) {
    const left = tn.updateSchedule[key];
    const right = godot.updateSchedule[key];
    if (Math.abs(left - right) > 1e-9)
      problems.push(`TN_BENCH_LIGHTS_ROTATER_MISMATCH:${name} ${left}/${right}`);
  }
  if (godot.updateSchedule.meshRotaterSpeed * godot.updateSchedule.lightRotaterSpeed >= 0)
    problems.push("TN_BENCH_LIGHTS_ROTATION_SENSE");

  let maxOriginDelta = 0;
  let maxRotationDelta = 0;
  let energyDelta = 0;
  let accumulatorDelta = 0;
  let sampledFrames = 0;
  let lightsVisibleEqual = true;
  // A frame only one arm sampled is a frame the two did not both render, whichever arm lacks it.
  const tnFrames = new Set(tn.states.map((entry) => entry.frameId));
  for (const godotState of godot.states)
    if (!tnFrames.has(godotState.frameId))
      problems.push(`TN_BENCH_LIGHTS_STATE_FRAME_MISSING:${godotState.frameId}`);
  for (const tnState of tn.states) {
    const godotState = godot.states.find((entry) => entry.frameId === tnState.frameId);
    if (godotState === undefined) {
      problems.push(`TN_BENCH_LIGHTS_STATE_FRAME_MISSING:${tnState.frameId}`);
      continue;
    }
    sampledFrames += 1;
    if (tnState.elapsedFrames !== godotState.elapsedFrames)
      problems.push(`TN_BENCH_LIGHTS_CLOCK_MISMATCH:${tnState.frameId}`);
    if (tnState.lightsVisible !== godotState.lightsVisible) lightsVisibleEqual = false;
    maxRotationDelta = Math.max(
      maxRotationDelta,
      Math.abs(tnState.meshRotationY - godotState.meshRotationY),
      Math.abs(tnState.lightRotationY - godotState.lightRotationY),
    );
    // The pinned source authors the probes from the same cell list on both sides, so a probe present
    // on one arm and not the other is a pair comparing fewer objects than it claims to.
    for (const [kind, tnProbes, godotProbes] of [
      ["mesh", tnState.meshProbes, godotState.meshProbes],
      ["light", tnState.lightProbes, godotState.lightProbes],
    ] as const) {
      for (const tnProbe of tnProbes) {
        const godotProbe = godotProbes.find((entry) => entry.index === tnProbe.index);
        if (godotProbe === undefined) {
          problems.push(`TN_BENCH_LIGHTS_STATE_PROBE_MISSING:${kind}-${tnProbe.index}`);
          continue;
        }
        for (let axis = 0; axis < 3; axis += 1) {
          maxOriginDelta = Math.max(
            maxOriginDelta,
            Math.abs((tnProbe.origin[axis] as number) - (godotProbe.origin[axis] as number)),
          );
          // The world X column is gated for meshes, whose orientation the picture depends on, and
          // recorded but not gated for lights: Godot's `OmniLight3D` global basis is identity even
          // under a parent scaled `2/s`, while three's `matrixWorld` inherits the whole chain. An
          // omni light has no orientation, so nothing in this cell depends on it — and a spot cell,
          // where the direction would, is a different cell with a different argument to settle.
          if (kind === "mesh" && tnProbe.axisX !== undefined && godotProbe.axisX !== undefined)
            maxRotationDelta = Math.max(
              maxRotationDelta,
              Math.abs((tnProbe.axisX[axis] as number) - (godotProbe.axisX[axis] as number)),
            );
        }
        if (kind !== "light") continue;
        const light = tnProbe as ILightsLightProbe;
        const other = godotProbe as ILightsLightProbe;
        accumulatorDelta = Math.max(accumulatorDelta, Math.abs(light.accum - other.accum));
        // The pinned `Lighter` writes an energy only while the light is on, so a hidden light's energy
        // is whatever it last had in each engine. Comparing it there would compare a leftover, so the
        // energy gate applies exactly where both arms agree the light is lit.
        if (light.visible !== other.visible)
          problems.push(`TN_BENCH_LIGHTS_VISIBILITY_MISMATCH:${light.index}@${tnState.frameId}`);
        else if (light.visible)
          energyDelta = Math.max(energyDelta, Math.abs(light.energy - other.energy));
      }
      for (const godotProbe of godotProbes)
        if (!tnProbes.some((candidate) => candidate.index === godotProbe.index))
          problems.push(`TN_BENCH_LIGHTS_STATE_PROBE_MISSING:${kind}-${godotProbe.index}`);
    }
  }
  if (!lightsVisibleEqual) problems.push("TN_BENCH_LIGHTS_VISIBLE_COUNT_MISMATCH");
  const withinTolerance =
    maxOriginDelta <= LIGHTS_TOLERANCE.originAbsoluteMetres &&
    maxRotationDelta <= LIGHTS_TOLERANCE.rotationAbsoluteRadians &&
    energyDelta <= LIGHTS_TOLERANCE.energyAbsolute &&
    accumulatorDelta <= LIGHTS_TOLERANCE.accumAbsolute;
  if (!withinTolerance) problems.push("TN_BENCH_LIGHTS_STATE_OUT_OF_TOLERANCE");

  // The opposite-direction evidence, read from each arm's own sampled rotations. A workload where the
  // two grids turned the same way would keep every light over the same mesh, which is the opposite of
  // what the pinned source is for.
  const oppositeRotationsObserved = {
    light: godotTurnsNegative(godot.states),
    mesh: godotTurnsPositive(godot.states),
  };
  if (!oppositeRotationsObserved.light || !oppositeRotationsObserved.mesh)
    problems.push("TN_BENCH_LIGHTS_GRID_ROTATION_NOT_OPPOSITE");

  // Light energy and visibility must actually change across the sampled frames. A frozen light set
  // would leave every other field in this record intact while rendering a different scene. The
  // pinned `Lighter` crosses zero every pi/2 of accum, so a sample set spanning twice that cannot
  // have missed a toggle; a shorter one is reported as unobserved rather than accused of being frozen.
  const togglesObserved = {
    godot: godotToggled(godot),
    tn: tnToggled(tn),
  };
  if (!togglesObserved.godot || !togglesObserved.tn)
    problems.push("TN_BENCH_LIGHTS_UPDATE_UNOBSERVED");

  // Visual and feature evidence. Missing evidence fails the pair; a *different* picture from two
  // different shaded pipelines is disclosed below, never gated as equality.
  const tnBlank = !hasCoverage(tn);
  const godotBlank = !hasCoverage(godot);
  if (tnBlank || godotBlank) problems.push("TN_BENCH_LIGHTS_CAPTURE_BLANK");
  if (!tn.motion.observed || !godot.motion.observed)
    problems.push("TN_BENCH_LIGHTS_CAPTURE_MOTION_UNOBSERVED");
  if (tn.motion.changedSampledPixels <= 0 || godot.motion.changedSampledPixels <= 0)
    problems.push("TN_BENCH_LIGHTS_FRAME_FROZEN");
  if (!tn.effective.lightsAffectFrame || !godot.effective.lightsAffectFrame)
    problems.push("TN_BENCH_LIGHTS_NOT_EFFECTIVE");
  if (tn.effective.lightsChangedSamples === 0 || godot.effective.lightsChangedSamples === 0)
    problems.push("TN_BENCH_LIGHTS_EFFECT_UNQUANTIFIED");

  // Coverage is the silhouette comparison §6.2 asks for, and it is gated: byte-identical geometry
  // through the exported camera basis can only differ by rasterizer edge effects, bounded in
  // `LIGHTS_TOLERANCE`. The shaded mean luma beside it is *not* gated and is never compared as
  // equality.
  const visuals: { coveredFractionDelta: number; frameId: number }[] = [];
  const meanLumaDelta: { frameId: number; godot: number; tn: number }[] = [];
  for (const entry of tn.captures.filter((candidate) => candidate.scored)) {
    const other = godot.captures.find(
      (candidate) => candidate.scored && candidate.frameId === entry.frameId,
    );
    if (other === undefined) {
      problems.push(`TN_BENCH_LIGHTS_COVERAGE_FRAME_MISSING:${entry.frameId}`);
      continue;
    }
    const coveredFractionDelta = Math.abs(entry.coveredFraction - other.coveredFraction);
    visuals.push({ coveredFractionDelta, frameId: entry.frameId });
    if (coveredFractionDelta > LIGHTS_TOLERANCE.coveredFractionAbsolute)
      problems.push(
        `TN_BENCH_LIGHTS_COVERAGE_DIVERGED:${entry.frameId} ${coveredFractionDelta.toFixed(6)} of the frame`,
      );
    meanLumaDelta.push({ frameId: entry.frameId, godot: other.meanLuma, tn: entry.meanLuma });
  }

  // Both native hosts drive their frame loop, and the counterpart host paces it at 60 Hz. An arm
  // whose frame intervals land on multiples of that cadence is reporting the present, not the work it
  // was asked to measure, and its mean is then a count of how many frames spilled past one tick.
  for (const [label, run] of [
    ["tn", tn],
    ["godot", godot],
  ] as const) {
    const onTick = run.frameIntervals.filter((interval) => {
      const ticks = interval / FRAME_CADENCE_MS;
      return ticks >= 0.5 && Math.abs(ticks - Math.round(ticks)) * FRAME_CADENCE_MS < 2;
    });
    // A cluster needs a cluster. With one or two frames on the tick the interquartile spread of that
    // set is zero by construction, so the rule would read any short validation run as a present; the
    // 2-frame gate this family runs first is exactly that case.
    if (onTick.length >= 8 && onTick.length / run.frameIntervals.length >= 0.5) {
      if (quartileSpread(onTick) <= CAP_CLUSTER_MS)
        problems.push(
          `TN_BENCH_LIGHTS_${label.toUpperCase()}_CADENCE_CAPPED:${onTick.length}/${run.frameIntervals.length} frames on the ${FRAME_CADENCE_MS.toFixed(3)} ms host frame loop, mean ${run.meanMs.toFixed(3)} ms`,
        );
    }
    if (run.wallSemantics === null)
      problems.push(
        `TN_BENCH_LIGHTS_${label.toUpperCase()}_WALL_SEMANTICS_UNDECLARED: neither a drain nor a boundary completion timestamp, so the record does not say what its ${run.meanMs.toFixed(3)} ms mean measured`,
      );
  }
  if (
    tn.wallSemantics !== null &&
    godot.wallSemantics !== null &&
    tn.wallSemantics !== godot.wallSemantics
  )
    problems.push(
      `TN_BENCH_LIGHTS_WALL_SEMANTICS_MISMATCH:${tn.wallSemantics}/${godot.wallSemantics}`,
    );

  const valid = problems.length === 0;
  return {
    blocks: 1,
    comparedMetrics: [
      "fixture SHA-256 and RNG seed",
      "requested and actual mesh/omni/spot counts",
      "mesh buffer SHA-256 and vertex/index/triangle counts",
      "camera environment: background mode, background colour, ambient source and colour",
      "light kind, range and attenuation exponent",
      "update schedule: frame delta, advance order and both rotater speeds",
      "per-frame grid rotations, mesh and light world origins and world X axis",
      "per-light accum, energy where both arms agree the light is lit, and visibility",
      "silhouette covered-fraction per captured frame",
      "completed-work mean and its drain semantics",
    ],
    conformance: {
      accumulatorDelta,
      bufferHashesEqual,
      censusEqual,
      energyDelta,
      fixtureHashEqual: tn.fixture.hash === godot.fixture.hash,
      lightsVisibleEqual,
      maxOriginDeltaMetres: maxOriginDelta,
      maxRotationDeltaRadians: maxRotationDelta,
      oppositeRotationsObserved,
      sampledFrames,
      togglesObserved,
      withinTolerance,
    },
    disclosed: {
      meanLumaDelta,
      lightAxisXNote:
        "a light's world X column is recorded by both arms and compared by neither: Godot's OmniLight3D global basis is identity under a parent scaled 2/s (the cell and the Lighter above it both report 0.666667 while the light reports 1.0) and three's matrixWorld inherits the parent chain. An omni light has no orientation, so this cell's workload and picture do not depend on it.",
      note: "shaded mean luma is recorded per frame and deliberately not gated: two shaded pipelines put different values on the same light energy, and §6.2 forbids a universal pixel-equality threshold between different PBR implementations. The coverage grid beside it is the silhouette comparison, and that one is gated.",
      shadedPixelsCompared: false,
    },
    evidence: {
      lightsAffectFrame: {
        godot: godot.effective.lightsAffectFrame,
        tn: tn.effective.lightsAffectFrame,
      },
      nonBlankCaptures: { godot: !godotBlank, tn: !tnBlank },
      observedMotion: { godot: godot.motion.observed, tn: tn.motion.observed },
    },
    outcome: {
      comparability: !valid ? "non-comparable" : "qualified",
      comparabilityReasons: valid
        ? [
            "both arms author through the ordinary scene-graph node API — one Node3D per grid cell with a MeshInstance3D or an OmniLight3D under it, against one Object3D per cell with a Mesh or a PointLight under it — so unlike the culling family neither arm is a renderer-server workload",
            "the light attenuation curve is the same `pow(clamp(1 - d/range, 0, 1), k)` function on both sides, but Godot's Forward+ and three's forward renderer shade the same energy differently, so the frame is the same picture and not the same pixel values",
          ]
        : [],
      problems,
      valid,
    },
    profile: "smoke",
    qualifications: [
      "one smoke block of one cell of a thirteen-variant family: no paired-block interval, no A/A calibration, and no verdict of faster or slower is supported",
      "the cell is a composition of the pinned source's named axes (box, 100 objects, omni, 10 requested lights, speed 1.0), not one of the thirteen upstream `benchmark_*` functions; the other twelve stay open",
      "a private Xvfb display would make any native arm's completed-work mean a present ceiling rather than a rendering cost; the retained runs name their display so a reader can tell which was used",
    ],
    // Withheld rather than reported small: a ratio over a pair that disagrees on the census, the
    // geometry, the per-frame state, the visual evidence or the wall metric's semantics is a number
    // with no meaning, and the named problems above are why it is absent.
    ratio: valid
      ? {
          godotMeanMs: godot.meanMs,
          ratio: godot.meanMs / tn.meanMs,
          timeReductionPercent: 100 * (1 - tn.meanMs / godot.meanMs),
          tnMeanMs: tn.meanMs,
        }
      : null,
    visuals,
  };
}

/** The mesh grid turns the way the pinned `-0.1 * speed` rotater does, and the light grid the other. */
function godotTurnsPositive(states: readonly ILightsState[]): boolean {
  if (states.length < 2) return false;
  const first = states[0] as ILightsState;
  const last = states[states.length - 1] as ILightsState;
  return first.meshRotationY < 0 && last.meshRotationY < first.meshRotationY;
}

function godotTurnsNegative(states: readonly ILightsState[]): boolean {
  if (states.length < 2) return false;
  const first = states[0] as ILightsState;
  const last = states[states.length - 1] as ILightsState;
  return first.lightRotationY > 0 && last.lightRotationY > first.lightRotationY;
}

/** Whether a run's sampled frames contain a light whose visibility or energy actually moved. */
function runToggled(run: ILightsRun): { energy: boolean; span: number; visible: boolean } {
  let energy = false;
  let visible = false;
  let span = 0;
  for (let index = 1; index < run.states.length; index += 1) {
    const before = run.states[index - 1] as ILightsState;
    const after = run.states[index] as ILightsState;
    span += after.elapsedFrames - before.elapsedFrames;
    if (after.lightsVisible !== before.lightsVisible) visible = true;
    for (const probe of after.lightProbes) {
      const other = before.lightProbes.find((entry) => entry.index === probe.index);
      if (other !== undefined && Math.abs(probe.energy - other.energy) > 0) energy = true;
    }
  }
  return { energy, span, visible };
}

function godotToggled(run: ILightsRun): boolean {
  const { energy, span, visible } = runToggled(run);
  // A toggle is a crossing of `sin(accum) * 5`, so the pinned `Lighter` flips one every pi/2 of
  // accum, which at `delta * speed * 2` is every 47 rendered frames. A run whose sample set spans less
  // than twice that has not had the room to show one and is not accused of not having one.
  const room = (2 * LIGHTS_TOGGLE_ARC_RADIANS) / 0.0333333333333333;
  return energy && (visible || span < room);
}

function tnToggled(run: ILightsRun): boolean {
  return godotToggled(run);
}

/** At least one scored capture with real coverage: a non-blank frame is the minimum visual evidence. */
function hasCoverage(run: ILightsRun): boolean {
  return run.captures.some(
    (entry) => entry.scored && entry.coveredFraction > 0.001 && entry.changedPixels !== 0,
  );
}

/** The interquartile spread of a sample, the width that separates a blocked present from real work. */
function quartileSpread(samples: readonly number[]): number {
  if (samples.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (fraction: number): number =>
    sorted[
      Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
    ] as number;
  return at(0.75) - at(0.25);
}
