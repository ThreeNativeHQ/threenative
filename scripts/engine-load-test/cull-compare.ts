import {
  CULL_TOLERANCE,
  CULL_UPSTREAM_COMMIT,
  CULL_VARIANTS,
} from "../../examples/engine-load-test/src/cull-fixture.js";

/**
 * PRD-449 `godot-culling`: the comparison between the pinned upstream Godot arm and the ThreeNative
 * counterpart arm on the same exported fixture. Pure, so the conformance rules are unit-proved
 * without a GPU, and deliberately strict: a pair whose fixture, census or per-frame state disagree is
 * reported as non-comparable rather than as a speedup.
 */

export interface ICullTopologyEntry {
  readonly albedo: readonly number[];
  /** SHA-256 over the arm's own canonical mesh-buffer bytes; the only whole-buffer identity. */
  readonly bufferSha256: string;
  readonly indices: number;
  readonly kind: string;
  readonly triangles: number;
  readonly vertices: number;
}

export interface ICullProbe {
  readonly axisX: readonly number[];
  readonly index: number;
  readonly origin: readonly number[];
}

export interface ICullState {
  readonly frameId: number;
  readonly probes: readonly ICullProbe[];
  readonly timeAccum: number;
}

export interface ICullCaptureRecord {
  /** `null` when the capture had no earlier frame to differ from, which is not the same as zero. */
  readonly changedPixels: number | null;
  readonly coveredFraction: number;
  readonly frameId: number;
  readonly meanLuma: number;
  readonly name: string;
  readonly path?: string;
  readonly scored: boolean;
}

export interface ICullRun {
  readonly adapter: Record<string, unknown>;
  readonly arm: string;
  readonly authoring: string;
  readonly captures: readonly ICullCaptureRecord[];
  readonly dynamic: { enabled: boolean; rotate: boolean; rids: number; target: string };
  readonly family: string;
  readonly fixture: {
    hash: string;
    objects: number;
    sourceCommit?: string;
    viewport: { height: number; width: number };
  };
  readonly frameIntervals: readonly number[];
  readonly frameP50Ms?: number;
  readonly frameP95Ms?: number;
  readonly meanMs: number;
  readonly lights: { directional: number; omni: number; requested: number; spot: number };
  /** The host's own effective present mode, or `null` when the record states none. */
  readonly presentMode: "fifo" | "immediate" | "mailbox" | null;
  readonly profile: string;
  readonly states: readonly ICullState[];
  readonly topology: readonly ICullTopologyEntry[];
  readonly unshaded: boolean;
  readonly variant: string;
  readonly wallSemantics: string | null;
  readonly work?: Record<string, unknown>;
}

function fail(code: string, detail: string): never {
  throw new Error(`${code}:${detail}`);
}

/** The native hosts' 60 Hz frame-loop pacing, the value a cadence-bound mean lands on. */
const FRAME_CADENCE_MS = 1000 / 60;
/**
 * How tightly a capped arm's frames cluster on the tick. A present that blocks lands on it within
 * microseconds, so a quarter-millimetre of spread is already generous; real work that happens to
 * cost about one tick spreads over several milliseconds, and a 2 ms proximity band alone cannot tell
 * the two apart — 10,000 independent meshes at 6.06 M submitted triangles measured a p01 of 14.6 ms
 * and a p99 of 28.1 ms around an 18.0 ms mean, and every one of those frames is "near" 16.667 ms.
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

function triple(value: unknown, code: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== 3) fail(code, "expected three numbers");
  return value.map((entry) => {
    if (typeof entry !== "number" || !Number.isFinite(entry)) fail(code, "expected finite numbers");
    return entry;
  });
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
 * §7.4's primary metric is a completed-work mean, which needs a final-completion observation on
 * both arms. The two records do not carry that under one name, so each arm's semantics are read
 * from the metadata it actually has — a declared `drain`, else a boundary completion timestamp in
 * its own frame series — and the two statements are compared. A record with neither says nothing
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

/**
 * The host publishes the surface's effective present mode, which answers "were these frames pinned
 * to the display's tick?" directly instead of inferring it from a frame series: `fifo` pins them,
 * `immediate` and `mailbox` do not. A record that states none is a legacy record from before the
 * host published it and stays `null` rather than assumed. A mode the host never names is a malformed
 * claim, refused here rather than read later as uncapped.
 */
const PRESENT_MODES = ["fifo", "immediate", "mailbox"] as const;

function presentMode(raw: Record<string, unknown>, code: string): ICullRun["presentMode"] {
  const mode = raw.presentMode;
  if (mode === undefined || mode === null) return null;
  if (typeof mode !== "string" || !PRESENT_MODES.includes(mode as (typeof PRESENT_MODES)[number]))
    fail(code, `presentMode ${String(mode)}`);
  return mode as (typeof PRESENT_MODES)[number];
}

export function parseCullRun(value: unknown, code = "TN_BENCH_CULL_RUN_MALFORMED"): ICullRun {
  const raw = object(value, code);
  if (raw.family !== "godot-culling") fail(code, `family ${String(raw.family)}`);
  if (typeof raw.arm !== "string" || raw.arm.length === 0) fail(code, "arm");
  if (
    typeof raw.variant !== "string" ||
    !CULL_VARIANTS.some((entry) => entry.godotVariant === raw.variant)
  )
    fail(code, `variant ${String(raw.variant)}`);
  if (typeof raw.meanMs !== "number" || !(raw.meanMs > 0))
    fail(code, "meanMs must be a positive sample");
  const fixture = object(raw.fixture, code);
  if (typeof fixture.hash !== "string" || !/^[0-9a-f]{64}$/.test(fixture.hash))
    fail(code, "fixture hash");
  if (fixture.sourceCommit !== undefined && fixture.sourceCommit !== CULL_UPSTREAM_COMMIT)
    fail(code, `fixture source commit ${String(fixture.sourceCommit)}`);
  if (count(fixture.objects, code) !== 10000) fail(code, "objects");
  if (!Array.isArray(raw.topology) || raw.topology.length !== 5) fail(code, "topology");
  if (!Array.isArray(raw.states) || raw.states.length === 0) fail(code, "states");
  if (!Array.isArray(raw.captures) || raw.captures.length === 0) fail(code, "captures");
  return {
    adapter: object(raw.adapter, code),
    arm: raw.arm,
    authoring: typeof raw.authoring === "string" ? raw.authoring : "unknown",
    captures: raw.captures.map((entry) => {
      const capture = object(entry, code);
      return {
        changedPixels: capture.changedPixels === null ? null : count(capture.changedPixels, code),
        coveredFraction: typeof capture.coveredFraction === "number" ? capture.coveredFraction : 0,
        frameId: count(capture.frameId, code),
        meanLuma: typeof capture.meanLuma === "number" ? capture.meanLuma : 0,
        name: String(capture.name),
        ...(typeof capture.path === "string" ? { path: capture.path } : {}),
        scored: capture.scored === true,
      };
    }),
    dynamic: (() => {
      const dynamic = object(raw.dynamic, code);
      return {
        enabled: dynamic.enabled === true,
        rotate: dynamic.rotate === true,
        rids: count(dynamic.rids, code),
        target: String(dynamic.target),
      };
    })(),
    family: raw.family,
    fixture: {
      hash: fixture.hash,
      objects: fixture.objects as number,
      ...(typeof fixture.sourceCommit === "string" ? { sourceCommit: fixture.sourceCommit } : {}),
      viewport: (() => {
        const viewport = object(fixture.viewport, code);
        return { height: count(viewport.height, code), width: count(viewport.width, code) };
      })(),
    },
    frameIntervals: frameIntervals(raw, code),
    frameP50Ms: typeof raw.frameP50Ms === "number" ? raw.frameP50Ms : undefined,
    frameP95Ms: typeof raw.frameP95Ms === "number" ? raw.frameP95Ms : undefined,
    lights: (() => {
      const lights = object(raw.lights, code);
      return {
        directional: count(lights.directional, code),
        omni: count(lights.omni, code),
        requested: count(lights.requested, code),
        spot: count(lights.spot, code),
      };
    })(),
    meanMs: raw.meanMs,
    presentMode: presentMode(raw, code),
    profile: typeof raw.profile === "string" ? raw.profile : "unknown",
    states: raw.states.map((entry) => {
      const state = object(entry, code);
      if (!Array.isArray(state.probes) || state.probes.length === 0) fail(code, "state probes");
      return {
        frameId: count(state.frameId, code),
        probes: state.probes.map((probe) => {
          const read = object(probe, code);
          return {
            axisX: triple(read.axisX, code),
            index: count(read.index, code),
            origin: triple(read.origin, code),
          };
        }),
        timeAccum: typeof state.timeAccum === "number" ? state.timeAccum : 0,
      };
    }),
    topology: raw.topology.map((entry) => {
      const mesh = object(entry, code);
      // Each arm's own buffers, under whichever name that arm wrote them: the pinned Godot scene
      // counts its own mesh, the counterpart arm its own. §6.1 wants the two exactly equal, so a
      // record that measured none of the three is malformed here rather than read later as a zero.
      return {
        albedo: triple(mesh.albedo, code),
        // Each arm's own buffer identity, under one name because it is one claim: the SHA-256 of the
        // canonical stream its geometry was built from. A record that measured no buffers is
        // malformed here rather than compared as agreeing on nothing.
        bufferSha256: sha256Digest(mesh.bufferSha256, code),
        indices: count(mesh.indices ?? mesh.tnIndices, code),
        kind: String(mesh.kind),
        triangles: count(mesh.triangles ?? mesh.tnTriangles, code),
        vertices: count(mesh.vertices ?? mesh.tnVertices, code),
      };
    }),
    unshaded: raw.unshaded === true,
    variant: raw.variant,
    wallSemantics: wallSemantics(raw, code),
    ...(raw.work === undefined ? {} : { work: object(raw.work, code) }),
  };
}

export interface ICullComparison {
  readonly blocks: 1;
  readonly conformance: {
    readonly bufferHashesEqual: boolean;
    readonly fixtureHashEqual: boolean;
    readonly lightCountsEqual: boolean;
    readonly maxOriginDeltaMetres: number;
    readonly maxQuaternionDelta: number;
    readonly objectsEqual: boolean;
    readonly sampledFrames: number;
    readonly topology: readonly {
      bufferHashEqual: boolean;
      counterpartTriangles: number;
      kind: string;
      tnTriangles: number;
    }[];
    readonly withinTolerance: boolean;
  };
  readonly coverage: readonly { coveredFractionDelta: number; frameId: number }[];
  readonly outcome: {
    readonly comparability: "matched-task" | "qualified" | "non-comparable";
    readonly comparabilityReasons: readonly string[];
    readonly problems: readonly string[];
    readonly valid: boolean;
  };
  readonly profile: "smoke";
  readonly qualifications: readonly string[];
  readonly ratio: {
    godotMeanMs: number;
    ratio: number;
    timeReductionPercent: number;
    tnMeanMs: number;
  } | null;
}

/**
 * Two arms are `qualified` at best, never `matched-task`, and for stated reasons rather than a
 * disclaimer: the upstream source authors through `RenderingServer` RIDs, each engine tessellates its
 * primitives independently, and the shaded environments differ. A pair whose fixture, census or
 * per-frame state disagree is `non-comparable` and carries no ratio claim beyond the raw means.
 */
export function compareCullRuns(tn: ICullRun, godot: ICullRun): ICullComparison {
  const problems: string[] = [];
  if (tn.variant !== godot.variant)
    problems.push(`TN_BENCH_CULL_VARIANT_MISMATCH:${tn.variant}/${godot.variant}`);
  const fixtureHashEqual = tn.fixture.hash === godot.fixture.hash;
  if (!fixtureHashEqual) problems.push("TN_BENCH_CULL_FIXTURE_MISMATCH");
  const objectsEqual = tn.fixture.objects === godot.fixture.objects;
  if (!objectsEqual) problems.push("TN_BENCH_CULL_OBJECT_COUNT_MISMATCH");
  const lightCountsEqual =
    tn.lights.omni === godot.lights.omni &&
    tn.lights.spot === godot.lights.spot &&
    tn.lights.directional === godot.lights.directional;
  if (!lightCountsEqual) problems.push("TN_BENCH_CULL_LIGHT_COUNT_MISMATCH");
  if (tn.dynamic.enabled !== godot.dynamic.enabled) problems.push("TN_BENCH_CULL_DYNAMIC_MISMATCH");
  if (tn.unshaded !== godot.unshaded) problems.push("TN_BENCH_CULL_UNSHADED_MISMATCH");

  let maxOriginDelta = 0;
  let maxQuaternionDelta = 0;
  let sampledFrames = 0;
  // A frame only one arm sampled is a frame the two did not both render, whichever arm lacks it.
  const tnFrames = new Set(tn.states.map((entry) => entry.frameId));
  for (const godotState of godot.states)
    if (!tnFrames.has(godotState.frameId))
      problems.push(`TN_BENCH_CULL_STATE_FRAME_MISSING:${godotState.frameId}`);
  for (const tnState of tn.states) {
    const godotState = godot.states.find((entry) => entry.frameId === tnState.frameId);
    if (godotState === undefined) {
      problems.push(`TN_BENCH_CULL_STATE_FRAME_MISSING:${tnState.frameId}`);
      continue;
    }
    sampledFrames += 1;
    for (const tnProbe of tnState.probes) {
      const godotProbe = godotState.probes.find((entry) => entry.index === tnProbe.index);
      if (godotProbe === undefined) {
        // Skipping it silently left the pair comparing fewer objects than it claimed to.
        problems.push(`TN_BENCH_CULL_STATE_PROBE_MISSING:${tnProbe.index}`);
        continue;
      }
      for (let axis = 0; axis < 3; axis++) {
        maxOriginDelta = Math.max(
          maxOriginDelta,
          Math.abs((tnProbe.origin[axis] as number) - (godotProbe.origin[axis] as number)),
        );
        maxQuaternionDelta = Math.max(
          maxQuaternionDelta,
          Math.abs((tnProbe.axisX[axis] as number) - (godotProbe.axisX[axis] as number)),
        );
      }
    }
    for (const godotProbe of godotState.probes)
      if (!tnState.probes.some((candidate) => candidate.index === godotProbe.index))
        problems.push(`TN_BENCH_CULL_STATE_PROBE_MISSING:${godotProbe.index}`);
  }
  const withinTolerance =
    maxOriginDelta <= CULL_TOLERANCE.originAbsoluteMetres &&
    maxQuaternionDelta <= CULL_TOLERANCE.quaternionComponentAbsolute;
  if (!withinTolerance) problems.push("TN_BENCH_CULL_STATE_OUT_OF_TOLERANCE");

  // §6.1: exact mesh and index buffers, not a matching total. Two engines that tessellate a sphere
  // into 4,224 and 3,968 triangles are rendering different geometry, so a mean over the two is a
  // mean over different work and carries no ratio however close their wall times land. The digests
  // are the gate; the counts stay because they name what differs when a digest does not.
  const topology = tn.topology.map((entry) => {
    const other = godot.topology.find((candidate) => candidate.kind === entry.kind);
    return {
      bufferHashEqual: other?.bufferSha256 === entry.bufferSha256,
      counterpartTriangles: other?.triangles ?? 0,
      kind: entry.kind,
      tnTriangles: entry.triangles,
    };
  });
  for (const entry of tn.topology) {
    const other = godot.topology.find((candidate) => candidate.kind === entry.kind);
    if (other === undefined) {
      problems.push(`TN_BENCH_CULL_TOPOLOGY_KIND_MISSING:${entry.kind}`);
      continue;
    }
    if (other.bufferSha256 !== entry.bufferSha256)
      problems.push(
        `TN_BENCH_CULL_BUFFER_HASH_MISMATCH:${entry.kind} ${other.bufferSha256}/${entry.bufferSha256}`,
      );
    if (
      other.triangles !== entry.triangles ||
      other.indices !== entry.indices ||
      other.vertices !== entry.vertices
    )
      problems.push(
        `TN_BENCH_CULL_TOPOLOGY_MISMATCH:${entry.kind} triangles ${other.triangles}/${entry.triangles} indices ${other.indices}/${entry.indices} vertices ${other.vertices}/${entry.vertices}`,
      );
  }

  const coverage: { coveredFractionDelta: number; frameId: number }[] = [];
  for (const entry of tn.captures.filter((candidate) => candidate.scored)) {
    const other = godot.captures.find(
      (candidate) => candidate.scored && candidate.frameId === entry.frameId,
    );
    if (other === undefined) {
      problems.push(`TN_BENCH_CULL_COVERAGE_FRAME_MISSING:${entry.frameId}`);
      continue;
    }
    const coveredFractionDelta = Math.abs(entry.coveredFraction - other.coveredFraction);
    coverage.push({ coveredFractionDelta, frameId: entry.frameId });
    if (coveredFractionDelta > CULL_TOLERANCE.coveredFractionAbsolute)
      problems.push(
        `TN_BENCH_CULL_COVERAGE_DIVERGED:${entry.frameId} ${coveredFractionDelta.toFixed(6)} of the frame`,
      );
  }
  const tnMotion = lastScored(tn);
  const godotMotion = lastScored(godot);
  if (tnMotion !== null && godotMotion !== null) {
    if ((tnMotion === 0) !== (godotMotion === 0)) problems.push("TN_BENCH_CULL_MOTION_MISMATCH");
  } else {
    problems.push("TN_BENCH_CULL_CAPTURE_MOTION_UNOBSERVED");
  }

  // Both native hosts drive their frame loop, and the counterpart host paces it at 60 Hz. An arm
  // whose frame intervals land on multiples of that cadence is reporting the present, not the work
  // it was asked to measure — the same present ceiling the mesh family hit. Its mean is then a
  // count of how many frames spilled past one tick, which is why two runs of one cell can differ by
  // 70% and both be pacing. Such a mean cannot carry a ratio.
  //
  // The host publishes the mode its surface actually got, which is that same question answered by
  // the surface rather than inferred from the timings: 10,000 independent meshes cost about one tick
  // each, so 90% of the clean run's frames sit within 2 ms of 16.667 ms and the clustering below
  // cannot tell that work from a blocked present. An explicit `immediate` or `mailbox` says the
  // surface was never pinned to the tick, so the timing is not the accusation; `fifo` says it was,
  // and a record that states no mode is judged on timing alone as before.
  for (const [label, run] of [
    ["tn", tn],
    ["godot", godot],
  ] as const) {
    if (run.presentMode !== "immediate" && run.presentMode !== "mailbox") {
      const onTick = run.frameIntervals.filter((interval) => {
        const ticks = interval / FRAME_CADENCE_MS;
        return ticks >= 0.5 && Math.abs(ticks - Math.round(ticks)) * FRAME_CADENCE_MS < 2;
      });
      const share = onTick.length / run.frameIntervals.length;
      const spread = quartileSpread(onTick);
      if (share >= 0.5 && spread <= CAP_CLUSTER_MS)
        problems.push(
          `TN_BENCH_CULL_${label.toUpperCase()}_CADENCE_CAPPED:${onTick.length}/${run.frameIntervals.length} frames on the ${FRAME_CADENCE_MS.toFixed(3)} ms host frame loop, mean ${run.meanMs.toFixed(3)} ms`,
        );
    }
    if (run.wallSemantics === null)
      problems.push(
        `TN_BENCH_CULL_${label.toUpperCase()}_WALL_SEMANTICS_UNDECLARED: neither a drain nor a boundary completion timestamp, so the record does not say what its ${run.meanMs.toFixed(3)} ms mean measured`,
      );
  }
  if (
    tn.wallSemantics !== null &&
    godot.wallSemantics !== null &&
    tn.wallSemantics !== godot.wallSemantics
  )
    // Both means are real measurements; one paces on submission and the other drains once at the
    // boundary, and the ratio of those two is a ratio of two different metrics.
    problems.push(
      `TN_BENCH_CULL_WALL_SEMANTICS_MISMATCH:${tn.wallSemantics}/${godot.wallSemantics}`,
    );

  const valid = problems.length === 0;
  return {
    blocks: 1,
    conformance: {
      bufferHashesEqual: topology.every((entry) => entry.bufferHashEqual),
      fixtureHashEqual,
      lightCountsEqual,
      maxOriginDeltaMetres: maxOriginDelta,
      maxQuaternionDelta: maxQuaternionDelta,
      objectsEqual,
      sampledFrames,
      topology,
      withinTolerance,
    },
    coverage,
    outcome: {
      comparability: !valid ? "non-comparable" : "qualified",
      comparabilityReasons: valid
        ? [
            "the pinned Godot arm authors 10,000 RenderingServer instance RIDs, not one scene node per object, so this pair compares a renderer-server workload with the counterpart arm's scene-node authoring rather than each engine's ordinary node API",
            "the shaded environments differ: Godot's Forward+ world environment with sky-derived ambient and dual-paraboloid omni shadows against three.js' forward renderer with a hemisphere light and cube-map point shadows",
          ]
        : [],
      problems,
      valid,
    },
    profile: "smoke",
    qualifications: [
      "one smoke block of one variant: no paired-block interval, no A/A calibration, and no verdict of faster or slower is supported",
      "a private Xvfb display would make any native arm's completed-work mean a present ceiling rather than a rendering cost; the retained runs name their display so a reader can tell which was used",
    ],
    // Withheld rather than reported small: a ratio over a pair that disagrees on the geometry, the
    // picture, the sampled state or the wall metric's semantics is a number with no meaning, and
    // the named problems above are why it is absent.
    ratio: valid
      ? {
          godotMeanMs: godot.meanMs,
          ratio: godot.meanMs / tn.meanMs,
          timeReductionPercent: 100 * (1 - tn.meanMs / godot.meanMs),
          tnMeanMs: tn.meanMs,
        }
      : null,
  };
}

function lastScored(run: ICullRun): number | null {
  const scored = run.captures.filter((entry) => entry.scored);
  const last = scored[scored.length - 1];
  return last === undefined ? null : last.changedPixels;
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
