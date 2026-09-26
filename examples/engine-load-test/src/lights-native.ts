import type { ICullCapture } from "./cull-harness.js";
import {
  type ILightsFixture,
  LIGHTS_CELL,
  LIGHTS_LIGHT_PROBES,
  LIGHTS_MESH_PROBES,
  LIGHTS_TOGGLE_ARC_RADIANS,
  LIGHTS_TOLERANCE,
  LIGHTS_VIEWPORT,
  lightsBase64,
  lightsFixtureHash,
  lightsRotations,
  parseLightsFixture,
} from "./lights-fixture.js";
import { createLightsHarness } from "./lights-harness.js";

declare global {
  var canvas: HTMLCanvasElement | undefined;
}

declare const __TN_LIGHTS_CONFIG__: Readonly<{
  fixtureJson: string;
  frames: number;
  warmup: number;
}>;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function percentile(samples: readonly number[], fraction: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(fraction * sorted.length) - 1] as number;
}

const STATE_FRAMES = [0, 1, 60, 120, 300, 599];
const CAPTURE_FRAMES = [0, 1, 60, 119, 300, 599];

/**
 * How many of the shared 240x135 sample lattice changed luma by more than the coverage threshold
 * between two captures. This is the same changed-sample detector the pinned arm uses, because a
 * mean-luma delta is too weak to see nine small-range omni lights go out.
 */
function changedSamples(left: ICullCapture, right: ICullCapture): number {
  if (left.luma.length !== right.luma.length) return 0;
  let changed = 0;
  for (let index = 0; index < left.luma.length; index += 1)
    if (Math.abs((left.luma[index] as number) - (right.luma[index] as number)) > 0.02) changed += 1;
  return changed;
}

async function main(): Promise<void> {
  const config = __TN_LIGHTS_CONFIG__;
  const surface = globalThis.canvas;
  if (surface === undefined) throw new Error("TN_BENCH_NO_CANVAS");
  surface.width = LIGHTS_VIEWPORT.width;
  surface.height = LIGHTS_VIEWPORT.height;
  const fixture = parseLightsFixture(config.fixtureJson);
  const fixtureHash = await lightsFixtureHash(config.fixtureJson);
  const harness = await createLightsHarness(
    surface,
    fixture,
    LIGHTS_MESH_PROBES,
    LIGHTS_LIGHT_PROBES,
  );
  const captures: Record<string, unknown>[] = [];
  const pngs: { name: string; bytes: Uint8Array }[] = [];
  /** Untimed probes: a baseline frame, then the same frame with the lights hidden. */
  const probes: { name: string; capture: ICullCapture }[] = [];
  try {
    const captureFrames = CAPTURE_FRAMES.filter((frame) => frame < config.warmup);
    const warmupStart = performance.now();
    for (let frame = 0; frame < config.warmup; frame++) {
      harness.step(frame);
      if (captureFrames.includes(frame)) {
        const shot = await harness.capture();
        // `luma` is the next capture's difference basis, not a record field: it is 32,400 samples of
        // scratch state and the record carries the numbers derived from it instead.
        const { luma: _luma, ...capture } = shot.capture;
        captures.push({ frameId: frame, name: "frame", scored: true, ...capture });
        if (shot.png !== null) pngs.push({ bytes: shot.png, name: `frame-${frame}` });
      } else await harness.render();
      await nextFrame();
    }
    // The pinned `_process(delta)` methods take their advance as an argument and keep no clock, so
    // the scored interval restarts from the same initial state the warmup started at. `step(0)` puts
    // the rotations and every `accum` back, which is what makes captured warmup frame k the same
    // workload state as scored frame k.
    harness.step(0);
    await harness.drain();
    const start = performance.now();
    const boundaries = [{ frameId: 0, monotonicMs: start }];
    let stats = { drawCalls: 0, triangles: 0 };
    const states: Record<string, unknown>[] = [];
    for (let frame = 0; frame < config.frames; frame++) {
      harness.step(frame);
      await harness.render();
      if (frame === Math.floor(config.frames / 2)) stats = harness.stats();
      if (STATE_FRAMES.includes(frame)) states.push({ ...harness.state(frame) });
      await nextFrame();
      boundaries.push({ frameId: frame + 1, monotonicMs: performance.now() });
    }
    // One synchronisation, once, at the boundary §7.4's completed-work mean is defined at: the whole
    // span from the first scored boundary to the end of this wait, so the asynchronous tail of the
    // last frames is inside the mean rather than outside it.
    await harness.drain();
    const finalCompletionMs = performance.now();
    // Untimed, after the measured frames and outside the scored span: the same frame with the nine
    // omni lights hidden. A changed-sample count above zero is the evidence that they lit something,
    // which no flag the arm set could establish.
    const baselineShot = await harness.capture();
    harness.setLightsVisible(false);
    const withoutLightsShot = await harness.capture();
    probes.push(
      { capture: baselineShot.capture, name: "baseline" },
      { capture: withoutLightsShot.capture, name: "no-lights" },
    );
    const lightsChangedSamples = changedSamples(baselineShot.capture, withoutLightsShot.capture);
    if (lightsChangedSamples === 0)
      throw new Error(
        `TN_BENCH_LIGHTS_NOT_EFFECTIVE: hiding the ${harness.lightCount.omni} omni lights changed none of ${baselineShot.capture.sampledPixels} sampled pixels`,
      );
    const intervals = boundaries
      .slice(1)
      .map(
        (boundary, index) =>
          boundary.monotonicMs - (boundaries[index] as { monotonicMs: number }).monotonicMs,
      );
    const lightsArm = {
      ...harness.state(0),
      cell: LIGHTS_CELL,
      census: {
        actualMeshInstances: fixture.meshGrid.cells.length,
        actualOmniLights: fixture.lights.actual,
        actualSpotLights: 0,
        requestedLights: fixture.lights.requested,
        requestedObjects: fixture.meshGrid.cells.length,
      },
      effective: {
        latticeSamples: baselineShot.capture.sampledPixels,
        lightsAffectFrame: true,
        lightsChangedSamples,
        probe: "changed-sample-count",
      },
      fixture: {
        hash: fixtureHash,
        path: null,
        rngSeed: fixture.rngSeed,
        schemaVersion: 1,
        sourceCommit: fixture.sourceCommit,
        viewport: LIGHTS_VIEWPORT,
      },
      lights: {
        actual: fixture.lights.actual,
        attenuation: fixture.lights.attenuation,
        color: fixture.lights.color,
        kind: fixture.lights.kind,
        range: fixture.lights.range,
        requested: fixture.lights.requested,
        shadowEnabled: fixture.lights.shadowEnabled,
      },
      environment: {
        ambientColor: fixture.environment.ambientColor,
        ambientEnergy: fixture.environment.ambientEnergy,
        ambientSource: fixture.environment.ambientSource,
        backgroundColor: fixture.environment.backgroundColor,
        backgroundMode: fixture.environment.backgroundMode,
        // The counterpart of Godot's AMBIENT_SOURCE_COLOR with a black colour, which contributes
        // nothing: the frame is lit by the workload's own nine omni lights and nothing else.
        ambientLight: fixture.environment.ambientColor.some((channel) => channel !== 0)
          ? "ambient-light"
          : "none",
      },
      mesh: {
        bufferSha256: harness.bufferSha256,
        indices: fixture.meshes[0]?.indices ?? 0,
        kind: fixture.meshes[0]?.kind ?? "unknown",
        triangles: fixture.meshes[0]?.triangles ?? 0,
        vertices: fixture.meshes[0]?.vertices ?? 0,
      },
      updateSchedule: {
        advanceOrder: fixture.schedule.advanceOrder,
        energyScale: fixture.schedule.energyScale,
        frameDelta: fixture.schedule.frameDelta,
        lightSpeed: fixture.schedule.lightSpeed,
        meshRotaterSpeed: fixture.meshGrid.rotaterSpeed,
        lightRotaterSpeed: fixture.lightGrid.rotaterSpeed,
      },
    };
    const scored = captures.filter((entry) => entry.scored === true);
    const last = scored[scored.length - 1] as { changedPixels: number | null } | undefined;
    const result = {
      ...lightsArm,
      adapter: harness.adapter,
      arm: "tn-desktop",
      authoring: "scene-node-mesh",
      authoringNote:
        "one three.js Mesh per grid cell under an Object3D rotater, with a PointLight per light cell — the ordinary scene-graph counterpart to the pinned source's Node3D/MeshInstance3D/OmniLight3D authoring",
      captures,
      drain: "measurement-boundary-completion",
      drainBoundaryFrame: config.frames,
      family: "godot-lights-meshes",
      frameP50Ms: percentile(intervals, 0.5),
      frameP95Ms: percentile(intervals, 0.95),
      frameP99Ms: percentile(intervals, 0.99),
      meanMs: (finalCompletionMs - start) / config.frames,
      meshProbes: LIGHTS_MESH_PROBES,
      lightProbes: LIGHTS_LIGHT_PROBES,
      motion: {
        changedSampledPixels: last?.changedPixels ?? -1,
        observed: last !== undefined && last.changedPixels !== null,
      },
      profile: "smoke",
      probes: probes.map((entry) => ({
        changedSamples: changedSamples(baselineShot.capture, entry.capture),
        name: entry.name,
        sampledPixels: entry.capture.sampledPixels,
      })),
      rawSeries: { boundaries, finalCompletionMs, schemaVersion: 1, unit: "ms" },
      rotationAtZero: lightsRotations(fixture, 0),
      states,
      stats,
      tolerance: LIGHTS_TOLERANCE,
      toggleArcRadians: LIGHTS_TOGGLE_ARC_RADIANS,
      threeRevision: harness.threeRevision,
      viewport: LIGHTS_VIEWPORT,
      warmupFrames: config.warmup,
      warmupMs: start - warmupStart,
    };
    for (const png of pngs) {
      const encoded = lightsBase64(png.bytes);
      for (let offset = 0; offset < encoded.length; offset += 800)
        console.log(`TNPNG:${png.name}:${offset}:${encoded.slice(offset, offset + 800)}`);
    }
    console.log("ENGINE_LOAD_TEST_PNG_END");
    const payload = JSON.stringify(result);
    console.log("ENGINE_LOAD_TEST_JSON_BEGIN");
    for (let offset = 0; offset < payload.length; offset += 800)
      console.log(`TNJSON:${payload.slice(offset, offset + 800)}`);
    console.log("ENGINE_LOAD_TEST_JSON_END");
  } finally {
    harness.dispose();
  }
}

main().catch((error: unknown) => {
  console.log(
    `ENGINE_LOAD_TEST_FAILED ${String(error)} ${error instanceof Error ? (error.stack ?? "") : ""}`,
  );
});
